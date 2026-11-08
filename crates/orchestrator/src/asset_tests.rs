use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::assets::{AssetFormat, AssetUpload};
use sha2::{Digest, Sha256};
use tower::ServiceExt;

const PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

fn device(state: &AppState, id: &str) -> String {
    let token = format!("token-{id}");
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,(SELECT account_id FROM mcp_principal WHERE id=1),?2,'now')",
            params![id, sha256_hex(token.as_bytes())],
        )
        .unwrap();
    token
}

fn png_upload(id: &str, bytes: &[u8]) -> AssetUpload {
    AssetUpload {
        id: id.into(),
        version: 1,
        format: AssetFormat::Png,
        sha256: format!("{:x}", Sha256::digest(bytes)),
        source: "시험".into(),
        license: "user-provided".into(),
        data_base64: STANDARD.encode(bytes),
    }
}

async fn post_upload(state: &AppState, token: &str, upload: &AssetUpload) -> (StatusCode, Vec<u8>) {
    let request = Request::builder()
        .method("POST")
        .uri("/api/device/assets")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(upload).unwrap()))
        .unwrap();
    let response = router(state.clone()).oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 64 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, body)
}

#[tokio::test]
async fn device_asset_post_and_get_round_trip_png() {
    let state = AppState::in_memory("secret");
    let token = device(&state, "assets");
    let bytes = STANDARD.decode(PNG_BASE64).unwrap();
    let (status, body) = post_upload(&state, &token, &png_upload("wall-1", &bytes)).await;
    assert_eq!(status, StatusCode::OK);
    let record: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(record["meta"]["id"], "wall-1");
    assert_eq!(record["meta"]["format"], "png");
    assert_eq!(record["meta"]["byte_size"], bytes.len());

    let request = Request::builder()
        .uri("/api/device/assets/wall-1/1")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = router(state).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
    let served = to_bytes(response.into_body(), 64 * 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(served.as_ref(), bytes.as_slice());
}

#[tokio::test]
async fn device_asset_post_rejects_body_over_32_mib() {
    let state = AppState::in_memory("secret");
    let token = device(&state, "assets");
    let request = Request::builder()
        .method("POST")
        .uri("/api/device/assets")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(vec![
            b' ';
            registry::DEVICE_ASSETS_BODY_MAX_BYTES + 1
        ]))
        .unwrap();
    let response = router(state).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn device_asset_post_rejects_originals_over_20_mib() {
    let state = AppState::in_memory("secret");
    let token = device(&state, "assets");
    let bytes = vec![
        0u8;
        (kaleidoscope_contract::data::MEDIA_MAX_BYTES + 1) as usize
    ];
    let (status, body) = post_upload(&state, &token, &png_upload("huge", &bytes)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let error: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(error["id"], "ASSET_UPLOAD_BYTES_TOO_LARGE");
}

fn upload(id: &str, svg: &str) -> AssetUpload {
    AssetUpload {
        id: id.into(),
        version: 1,
        format: AssetFormat::Svg,
        sha256: format!("{:x}", Sha256::digest(svg.as_bytes())),
        source: "시험".into(),
        license: "MIT".into(),
        data_base64: STANDARD.encode(svg),
    }
}

#[test]
fn asset_versions_are_immutable_and_account_scoped() {
    let state = AppState::in_memory("secret");
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M1 1\"/></svg>";
    let item = upload("icon", svg);
    let first = state.upload_asset(&item).unwrap();
    assert_eq!(state.upload_asset(&item).unwrap(), first);
    let mut resourced = item.clone();
    resourced.source = "스토어".into();
    resourced.license = "Apache-2.0".into();
    let updated = state.upload_asset(&resourced).unwrap();
    assert_eq!(updated.source, "스토어");
    assert_eq!(updated.license, "Apache-2.0");
    let account = state.mcp_account_id().unwrap();
    let (stored, stored_bytes) = state.get_asset(&account, "icon", 1).unwrap().unwrap();
    assert_eq!(stored, updated);
    assert_eq!(stored_bytes, svg.as_bytes());
    assert_eq!(
        state
            .upload_asset(&upload("icon", "<svg/>"))
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    let mut bad_hash = upload("wrong-hash", "<svg/>");
    bad_hash.sha256 = "0".repeat(64);
    assert!(state.upload_asset(&bad_hash).is_err());
    assert!(state
        .upload_asset(&upload("builtin-icon", "<svg/>"))
        .is_err());
    assert_eq!(state.list_assets().unwrap(), vec![updated]);
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES('other','다른 계정','now')",
            [],
        )
        .unwrap();
    assert!(state.get_asset("other", "icon", 1).unwrap().is_none());
}

#[test]
fn html_asset_round_trips_as_immutable_bytes() {
    let state = AppState::in_memory("secret");
    let html = "<!doctype html><script>document.body.textContent = '안녕'</script>";
    let mut item = upload("page", html);
    item.format = AssetFormat::Html;
    let meta = state.upload_asset(&item).unwrap();
    let account = state.mcp_account_id().unwrap();
    let (read_meta, bytes) = state.get_asset(&account, "page", 1).unwrap().unwrap();
    assert_eq!(meta, read_meta);
    assert_eq!(read_meta.format, AssetFormat::Html);
    assert_eq!(bytes, html.as_bytes());
    assert_eq!(state.upload_asset(&item).unwrap(), meta);
}

#[test]
fn missing_dependency_rolls_back_attached_upload() {
    let state = AppState::in_memory("secret");
    let item = upload("icon", "<svg/>");
    let definition = json!({"id":"asset-example", "name":"자산 시험", "requires":{"blocks":4,"modules":{"assets":1}},
        "assets":[{"id":"missing","version":1}], "permissions":[], "ui":{"type":"text","value":"시험"}});
    let result = state.publish_app_with_assets_for_device(
        &definition.to_string(),
        "시험",
        false,
        None,
        None,
        &[item],
    );
    assert!(result.is_err());
    assert!(state.list_assets().unwrap().is_empty());
    assert!(state.app("asset-example", None).unwrap().is_none());
}

#[test]
fn client_entry_must_be_javascript_and_upload_is_atomic() {
    let state = AppState::in_memory("secret");
    let definition = json!({"id":"client-example", "name":"클라이언트 시험", "requires":{"blocks":12,"modules":{"assets":1,"client":1}},
        "assets":[{"id":"entry","version":1}], "permissions":[], "state":{},
        "client":{"runtime":"javascript","entry":{"id":"entry","version":1},"inputs":{},"outputs":{},"actions":[],"commands":{},"state_keys":[],"storage_entries":[]},
        "ui":{"type":"text","value":"시험"}});
    let wrong = upload("entry", "<svg/>");
    assert!(state
        .publish_app_with_assets_for_device(
            &definition.to_string(),
            "시험",
            false,
            None,
            None,
            &[wrong]
        )
        .is_err());
    assert!(state.list_assets().unwrap().is_empty());
    let script = "window.ready = true;";
    let mut valid = upload("entry", script);
    valid.format = AssetFormat::Javascript;
    assert!(state
        .publish_app_with_assets_for_device(
            &definition.to_string(),
            "시험",
            false,
            None,
            None,
            &[valid]
        )
        .is_ok());
}

fn icon_app(id: &str, asset: &str) -> serde_json::Value {
    json!({"id":id, "name":"아이콘 시험", "requires":{"blocks":kaleidoscope_contract::APP_ICON_BLOCK_SET_VERSION,"modules":{"assets":1}},
        "assets":[{"id":asset,"version":1}], "icon":{"asset":asset,"version":1},
        "permissions":[], "ui":{"type":"text","value":"시험"}})
}

#[test]
fn app_icon_accepts_registered_images_and_bundled_svg() {
    let state = AppState::in_memory("secret");
    let images: &[(AssetFormat, &[u8])] = &[
        (
            AssetFormat::Svg,
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
        ),
        (
            AssetFormat::Png,
            include_bytes!("../../../ui/harness/assets/shapes.png"),
        ),
        (
            AssetFormat::Webp,
            include_bytes!("../../../app/src/assets/wallpaper.webp"),
        ),
    ];
    for (index, (format, bytes)) in images.iter().enumerate() {
        let id = format!("icon-{index}");
        let item = AssetUpload {
            id: id.clone(),
            version: 1,
            format: *format,
            sha256: format!("{:x}", Sha256::digest(bytes)),
            source: "시험".into(),
            license: "MIT".into(),
            data_base64: STANDARD.encode(bytes),
        };
        state
            .publish_app_with_assets_for_device(
                &icon_app(&format!("app-{index}"), &id).to_string(),
                "시험",
                false,
                None,
                None,
                &[item],
            )
            .unwrap();
    }
    state
        .publish_app_with_assets_for_device(
            &icon_app("bundled-icon", "builtin-weather-clear").to_string(),
            "시험",
            false,
            None,
            None,
            &[],
        )
        .unwrap();
}

#[test]
fn app_icon_rejects_non_images_and_rolls_back_attached_assets() {
    let state = AppState::in_memory("secret");
    let mut html = upload("page", "<p>시험</p>");
    html.format = AssetFormat::Html;
    let extra = upload("extra", "<svg/>");
    let error = state
        .publish_app_with_assets_for_device(
            &icon_app("bad-icon", "page").to_string(),
            "시험",
            false,
            None,
            None,
            &[html, extra],
        )
        .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("ASSET_APP_ICON_FORMAT_INVALID"));
    assert!(state.list_assets().unwrap().is_empty());
    assert!(state.app("bad-icon", None).unwrap().is_none());
    let error = state
        .publish_app_with_assets_for_device(
            &icon_app("bad-bundled-icon", "builtin-agent-client").to_string(),
            "시험",
            false,
            None,
            None,
            &[],
        )
        .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("ASSET_APP_ICON_FORMAT_INVALID"));
}

#[test]
fn app_icon_declaration_errors_leave_attached_assets_unregistered() {
    let state = AppState::in_memory("secret");
    let item = upload("mark", "<svg/>");
    let mut definition = icon_app("bad-declaration", "mark");
    for (assets, expected) in [
        (json!([]), "APP_ICON_ASSET_UNDECLARED"),
        (
            json!([{"id":"mark","version":2}]),
            "APP_ICON_VERSION_MISMATCH",
        ),
    ] {
        definition["assets"] = assets;
        let error = state
            .publish_app_with_assets_for_device(
                &definition.to_string(),
                "시험",
                false,
                None,
                None,
                &[item.clone()],
            )
            .unwrap_err();
        assert_eq!(error.id.as_deref(), Some(expected));
        assert!(state.list_assets().unwrap().is_empty());
        assert!(state.app("bad-declaration", None).unwrap().is_none());
    }
}
