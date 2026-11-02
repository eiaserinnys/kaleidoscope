use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::assets::{AssetFormat, AssetUpload};
use sha2::{Digest, Sha256};

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
    let item = upload(
        "icon",
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M1 1\"/></svg>",
    );
    let first = state.upload_asset(&item).unwrap();
    assert_eq!(state.upload_asset(&item).unwrap(), first);
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
    assert_eq!(state.list_assets().unwrap(), vec![first]);
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
