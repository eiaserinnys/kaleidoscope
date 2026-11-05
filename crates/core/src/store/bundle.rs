//! manifest 원문과 파일을 대조해 설치 전 묶음을 준비한다.
use super::{
    fetch::{Manifest, StoreClient, StoreFailure, Transport},
    release_path,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    assets::{AssetFormat, AssetUpload},
    errors,
    store::{
        STORE_APP_JSON_MAX_BYTES, STORE_ASSETS_MAX_BYTES, STORE_MANIFEST_MAX_BYTES,
        STORE_SCREENSHOT_MAX_BYTES, STORE_SCREENSHOT_MAX_COUNT,
    },
    AppDefinition,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub(crate) struct PreparedBundle {
    pub definition: AppDefinition,
    pub definition_json: String,
    pub assets: Vec<AssetUpload>,
    pub manifest: Vec<u8>,
    pub digest: String,
    pub connections: Option<serde_json::Value>,
}

impl<T: Transport> StoreClient<T> {
    pub(crate) fn prepare(
        &self,
        id: &str,
        release: u32,
        manifest_path: &str,
    ) -> Result<PreparedBundle, StoreFailure> {
        let prefix = release_path(id, release)?;
        if manifest_path != format!("{prefix}manifest.json") {
            return Err(super::path_error(manifest_path).into());
        }
        let (manifest, manifest_bytes): (Manifest, _) =
            self.json(manifest_path, STORE_MANIFEST_MAX_BYTES)?;
        if manifest.format != 1
            || manifest.store_app_id != id
            || manifest.release != release
            || manifest.screenshots.len() > STORE_SCREENSHOT_MAX_COUNT
        {
            return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
        }
        let app_path = format!("{prefix}app.json");
        let asset_prefix = format!("{prefix}assets/");
        let screenshot_prefix = format!("{prefix}screenshots/");
        if !manifest.files.contains_key(&app_path)
            || manifest
                .screenshots
                .iter()
                .any(|p| !p.starts_with(&screenshot_prefix) || !manifest.files.contains_key(p))
            || manifest
                .icon
                .as_ref()
                .is_some_and(|p| !p.starts_with(&asset_prefix) || !manifest.files.contains_key(p))
        {
            return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
        }
        let screenshots: BTreeSet<_> = manifest.screenshots.iter().collect();
        if screenshots.len() != manifest.screenshots.len() {
            return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
        }
        let mut app = None;
        let mut assets = Vec::new();
        let mut asset_total = 0u64;
        let mut screenshot_count = 0usize;
        for (path, file) in &manifest.files {
            self.server.path(path)?;
            let (kind, limit) = if path == &app_path {
                (0, STORE_APP_JSON_MAX_BYTES)
            } else if path.starts_with(&asset_prefix) {
                asset_total = asset_total.saturating_add(file.bytes);
                (1, STORE_ASSETS_MAX_BYTES)
            } else if path.starts_with(&screenshot_prefix) {
                screenshot_count += 1;
                if screenshot_count > STORE_SCREENSHOT_MAX_COUNT {
                    return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
                }
                (2, STORE_SCREENSHOT_MAX_BYTES)
            } else {
                return Err(super::path_error(path).into());
            };
            if file.bytes > limit || asset_total > STORE_ASSETS_MAX_BYTES {
                let limit = if kind == 1 {
                    STORE_ASSETS_MAX_BYTES
                } else {
                    limit
                };
                return Err(errors::STORECLIENT_FETCH_TOO_LARGE(
                    path,
                    kaleidoscope_contract::size::format_byte_limit(limit),
                )
                .into());
            }
            let bytes = self.bytes(path, limit)?.bytes;
            if bytes.len() as u64 != file.bytes {
                return Err(errors::STORECLIENT_BUNDLE_SIZE_MISMATCH(path).into());
            }
            if format!("{:x}", Sha256::digest(&bytes)) != file.sha256 {
                return Err(errors::STORECLIENT_BUNDLE_HASH_MISMATCH(path).into());
            }
            match kind {
                0 => {
                    app = Some(String::from_utf8(bytes).map_err(|e| {
                        errors::STORECLIENT_JSON_INVALID(path).and_details(vec![e.to_string()])
                    })?)
                }
                1 => {
                    let rest = path.strip_prefix(&asset_prefix).unwrap();
                    let (asset_id, version) = rest
                        .split_once('/')
                        .ok_or_else(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH)?;
                    let version: u32 = version
                        .parse()
                        .map_err(|_| errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH())?;
                    if asset_id.is_empty()
                        || version == 0
                        || rest != format!("{asset_id}/{version}")
                    {
                        return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
                    }
                    let upload = AssetUpload {
                        id: asset_id.into(),
                        version,
                        format: file
                            .format
                            .ok_or_else(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH)?,
                        sha256: file.sha256.clone(),
                        source: file
                            .source
                            .clone()
                            .ok_or_else(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH)?,
                        license: file
                            .license
                            .clone()
                            .ok_or_else(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH)?,
                        data_base64: STANDARD.encode(bytes),
                    };
                    kaleidoscope_data::asset_validation::validate_upload(&upload)?;
                    assets.push(upload);
                }
                _ => {
                    let format = if path.ends_with(".png") {
                        AssetFormat::Png
                    } else if path.ends_with(".webp") {
                        AssetFormat::Webp
                    } else {
                        return Err(errors::STORECLIENT_MEDIA_FORMAT_INVALID(path).into());
                    };
                    kaleidoscope_data::asset_validation::validate_bytes(format, &bytes).map_err(
                        |e| {
                            errors::STORECLIENT_MEDIA_FORMAT_INVALID(path)
                                .and_details(vec![e.message])
                        },
                    )?;
                }
            }
        }
        let definition_json = app.ok_or_else(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH)?;
        let definition = kaleidoscope_contract::validate::parse_app_definition(&definition_json)?;
        let definition_value: serde_json::Value =
            serde_json::from_str(&definition_json).map_err(|e| {
                errors::STORECLIENT_JSON_INVALID(&app_path).and_details(vec![e.to_string()])
            })?;
        let manifest_value: serde_json::Value =
            serde_json::from_slice(&manifest_bytes).map_err(|e| {
                errors::STORECLIENT_JSON_INVALID(manifest_path).and_details(vec![e.to_string()])
            })?;
        let empty_permissions = serde_json::json!([]);
        if definition.id != id
            || definition.requires != manifest.requires
            || definition.permissions != manifest.permissions
            || definition_value.get("requires") != manifest_value.get("requires")
            || definition_value
                .get("permissions")
                .unwrap_or(&empty_permissions)
                != &manifest_value["permissions"]
            || definition.assets.len() != assets.len()
            || definition.assets.iter().any(|dep| {
                !assets
                    .iter()
                    .any(|asset| asset.id == dep.id && asset.version == dep.version)
            })
        {
            return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
        }
        let expected_icon = definition
            .icon
            .as_ref()
            .map(|i| format!("{asset_prefix}{}/{}", i.asset, i.version));
        if manifest.icon != expected_icon {
            return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
        }
        if let Some(icon) = &definition.icon {
            let asset = assets
                .iter()
                .find(|a| a.id == icon.asset && a.version == icon.version)
                .ok_or_else(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH)?;
            icon.validate_format(&definition.id, asset.format)?;
        }
        Ok(PreparedBundle {
            definition,
            definition_json,
            assets,
            connections: manifest_value.get("connections").cloned(),
            digest: format!("{:x}", Sha256::digest(&manifest_bytes)),
            manifest: manifest_bytes,
        })
    }
}
