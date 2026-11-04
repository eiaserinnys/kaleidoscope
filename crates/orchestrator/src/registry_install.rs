//! 기기가 확인한 배포 묶음과 레지스트리 출처를 검증한다.
use super::*;
use axum::extract::Extension;
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    errors,
    store::{
        DeviceInstallReply, DeviceInstallRequest, StoreOrigin, STORE_APP_JSON_MAX_BYTES,
        STORE_ASSETS_MAX_BYTES, STORE_MANIFEST_MAX_BYTES,
    },
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Installation {
    pub origin: StoreOrigin,
    pub installed_version: Option<u32>,
}

pub(super) struct InstallGuard {
    pub origin: StoreOrigin,
    pub expected: Option<u32>,
    pub account: String,
}

pub(super) fn read_installation(
    raw: Option<String>,
    id: &str,
) -> Result<Option<Installation>, CoreError> {
    raw.map(|raw| {
        serde_json::from_str(&raw).map_err(|error| {
            errors::REGISTRYINSTALL_DATABASE_FAILED(id).and_details(vec![error.to_string()])
        })
    })
    .transpose()
}

/// 현재 행을 읽은 트랜잭션 안에서 판과 출처를 검사한다. true면 이미 설치된 배포판이다.
pub(super) fn check_guard(
    guard: &InstallGuard,
    current: Option<(u32, Option<&Installation>)>,
    id: &str,
) -> Result<bool, CoreError> {
    if current.map(|(version, _)| version) != guard.expected {
        return Err(errors::REGISTRYINSTALL_EXPECTED_VERSION_CONFLICT(id));
    }
    let Some((version, installation)) = current else {
        return Ok(false);
    };
    let installation = installation.ok_or_else(|| errors::REGISTRYINSTALL_ORIGIN_CONFLICT(id))?;
    let old = &installation.origin;
    let new = &guard.origin;
    if old.store_url != new.store_url || old.store_app_id != new.store_app_id {
        return Err(errors::REGISTRYINSTALL_ORIGIN_CONFLICT(id));
    }
    if installation.installed_version != Some(version) {
        return Err(errors::REGISTRYINSTALL_LOCAL_MODIFIED(id));
    }
    if new.release < old.release {
        return Err(errors::REGISTRYINSTALL_RELEASE_DOWNGRADE(id));
    }
    if new.release == old.release {
        if new.digest != old.digest {
            return Err(errors::REGISTRYINSTALL_RELEASE_DIGEST_CONFLICT(id));
        }
        return Ok(true);
    }
    Ok(false)
}

fn validate_bundle(request: &DeviceInstallRequest) -> Result<(), CoreError> {
    let id = &request.origin.store_app_id;
    let invalid = || errors::REGISTRYINSTALL_MANIFEST_INVALID(id);
    let mismatch = || errors::REGISTRYINSTALL_DECLARATION_MISMATCH(id);
    let manifest_bytes = STANDARD
        .decode(&request.manifest_base64)
        .map_err(|_| errors::REGISTRYINSTALL_MANIFEST_ENCODING_INVALID(id))?;
    if manifest_bytes.len() as u64 > STORE_MANIFEST_MAX_BYTES {
        return Err(errors::REGISTRYINSTALL_MANIFEST_TOO_LARGE(id));
    }
    let digest = sha256_hex(&manifest_bytes);
    if digest != request.approved_digest || digest != request.origin.digest {
        return Err(errors::REGISTRYINSTALL_MANIFEST_DIGEST_MISMATCH(id));
    }
    let manifest: Value = serde_json::from_slice(&manifest_bytes).map_err(|_| invalid())?;
    let strings = [
        "name",
        "summary",
        "description",
        "category",
        "publisher",
        "published_at",
    ];
    if strings.iter().any(|field| !manifest[*field].is_string())
        || !matches!(manifest.get("icon"), Some(Value::Null | Value::String(_)))
        || ["screenshots", "badges"].iter().any(|field| {
            manifest[*field]
                .as_array()
                .is_none_or(|items| items.iter().any(|item| !item.is_string()))
        })
        || !manifest["requires"].is_object()
        || !manifest["permissions"].is_array()
    {
        return Err(invalid());
    }
    if manifest["format"] != 1 {
        return Err(errors::REGISTRYINSTALL_MANIFEST_FORMAT_UNSUPPORTED(id));
    }
    let definition: Value = serde_json::from_str(&request.definition_json)
        .map_err(|_| errors::REGISTRYINSTALL_APP_JSON_INVALID(id))?;
    if manifest["store_app_id"] != *id
        || manifest["release"] != request.origin.release
        || request.origin.release == 0
        || definition["id"] != *id
        || manifest["permissions"]
            != definition
                .get("permissions")
                .cloned()
                .unwrap_or_else(|| json!([]))
        || manifest["requires"] != definition["requires"]
    {
        return Err(mismatch());
    }
    let files = manifest["files"].as_object().ok_or_else(invalid)?;
    let prefix = format!("apps/{}/{}/", id, request.origin.release);
    let app_file = files
        .get(&format!("{prefix}app.json"))
        .ok_or_else(mismatch)?;
    let raw = request.definition_json.as_bytes();
    if raw.len() as u64 > STORE_APP_JSON_MAX_BYTES {
        return Err(errors::REGISTRYINSTALL_APP_TOO_LARGE(id));
    }
    if app_file["bytes"].as_u64() != Some(raw.len() as u64) {
        return Err(errors::REGISTRYINSTALL_APP_SIZE_MISMATCH(id));
    }
    if app_file["sha256"] != sha256_hex(raw) {
        return Err(errors::REGISTRYINSTALL_APP_DIGEST_MISMATCH(id));
    }
    let declared = definition
        .get("assets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut expected = HashSet::new();
    for asset in declared {
        let asset_id = asset["id"].as_str().ok_or_else(mismatch)?;
        let version = asset["version"].as_u64().ok_or_else(mismatch)?;
        if !expected.insert(format!("{prefix}assets/{asset_id}/{version}")) {
            return Err(mismatch());
        }
    }
    let manifest_assets: HashSet<String> = files
        .keys()
        .filter(|path| path.starts_with(&format!("{prefix}assets/")))
        .cloned()
        .collect();
    if expected != manifest_assets || expected.len() != request.asset_uploads.len() {
        return Err(mismatch());
    }
    let mut total = 0u64;
    for upload in &request.asset_uploads {
        let path = format!("{prefix}assets/{}/{}", upload.id, upload.version);
        if !expected.remove(&path) {
            return Err(mismatch());
        }
        let file = files.get(&path).ok_or_else(mismatch)?;
        if file["format"] != serde_json::to_value(upload.format).map_err(|_| mismatch())?
            || file["source"] != upload.source
            || file["license"] != upload.license
        {
            return Err(mismatch());
        }
        let bytes = STANDARD
            .decode(&upload.data_base64)
            .map_err(|_| errors::REGISTRYINSTALL_ASSET_ENCODING_INVALID(id, &upload.id))?;
        total += bytes.len() as u64;
        if total > STORE_ASSETS_MAX_BYTES {
            return Err(errors::REGISTRYINSTALL_ASSETS_TOO_LARGE(id));
        }
        if file["bytes"].as_u64() != Some(bytes.len() as u64) {
            return Err(errors::REGISTRYINSTALL_ASSET_SIZE_MISMATCH(id, &upload.id));
        }
        if file["sha256"] != sha256_hex(&bytes) || upload.sha256 != sha256_hex(&bytes) {
            return Err(errors::REGISTRYINSTALL_ASSET_DIGEST_MISMATCH(
                id, &upload.id,
            ));
        }
    }
    Ok(())
}

pub(super) async fn device_install(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Json(request): Json<DeviceInstallRequest>,
) -> Response {
    let result = (|| {
        validate_bundle(&request)?;
        let account = state.device_account_id(&device.0)?;
        let guard = InstallGuard {
            origin: request.origin,
            expected: request.expected_current_version.map(|v| v.get()),
            account,
        };
        let (app, unchanged, _) = state.publish_install(
            &request.definition_json,
            &format!("device:{}", device.0),
            &request.asset_uploads,
            guard,
        )?;
        Ok::<_, CoreError>(DeviceInstallReply { app, unchanged })
    })();
    match result {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err(error) => super::http::error_response(StatusCode::BAD_REQUEST, error),
    }
}
