use super::*;
use axum::body::{to_bytes, Body};
use base64::{engine::general_purpose::STANDARD, Engine};
use tower::ServiceExt;

fn setup() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(dir.path().join("test.sqlite"), "secret".into()).unwrap();
    let account = state.mcp_account_id().unwrap();
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('device','PC',?1,?2,'now')",
        params![account, sha256_hex(b"test-token")],
    ).unwrap();
    (dir, state)
}

fn bundle(id: &str, release: u32, name: &str, expected: Option<u32>) -> Value {
    let definition = json!({"id":id,"name":name,"requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"안녕"}});
    let raw = definition.to_string();
    let path = format!("apps/{id}/{release}/app.json");
    let manifest = json!({"format":1,"store_app_id":id,"release":release,
        "name":name,"summary":"시험","description":"시험","category":"시험","publisher":"tester",
        "icon":null,"screenshots":[],"requires":definition["requires"],"permissions":[],"badges":[],
        "files":{path:{"sha256":sha256_hex(raw.as_bytes()),"bytes":raw.len()}},"published_at":"2026-11-05T00:00:00Z"}).to_string();
    let digest = sha256_hex(manifest.as_bytes());
    json!({"definition_json":raw,"asset_uploads":[],"manifest_base64":STANDARD.encode(manifest),
        "approved_digest":digest,"origin":{"store_url":"https://store.example","store_app_id":id,"release":release,"digest":digest},"expected_current_version":expected})
}

async fn call(state: &AppState, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::AUTHORIZATION, "Bearer test-token")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = router(state.clone()).oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn install_versions_origins_and_conflicts() {
    let (_dir, state) = setup();
    let first = bundle("store-test", 1, "첫 앱", None);
    let (status, reply) = call(&state, "POST", "/api/device/app-installs", first.clone()).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["app"]["app"]["origin"]["release"], 1);
    assert_eq!(reply["app"]["app"]["installed_version"], 1);
    let mut events = state.0.events.subscribe();
    let mut repeat = first.clone();
    repeat["expected_current_version"] = json!(1);
    let (_, reply) = call(&state, "POST", "/api/device/app-installs", repeat).await;
    assert_eq!(reply["unchanged"], true);
    assert!(events.try_recv().is_err());
    let (same, unchanged) = state
        .publish_app(
            first["definition_json"].as_str().unwrap(),
            "agent",
            false,
            None,
        )
        .unwrap();
    assert!(unchanged);
    assert_eq!(same.app.installed_version, Some(1));
    let (_, same_definition) = call(
        &state,
        "POST",
        "/api/device/app-installs",
        bundle("store-test", 2, "첫 앱", Some(1)),
    )
    .await;
    assert_eq!(same_definition["app"]["app"]["current_version"], 1);
    assert_eq!(same_definition["app"]["app"]["origin"]["release"], 2);
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::AppPublished { app, .. } if app.app.origin.as_ref().unwrap().release == 2)
    );
    let (_, updated) = call(
        &state,
        "POST",
        "/api/device/app-installs",
        bundle("store-test", 3, "새 이름", Some(1)),
    )
    .await;
    assert_eq!(updated["app"]["app"]["installed_version"], 2);
    let (_, stale) = call(
        &state,
        "POST",
        "/api/device/app-installs",
        bundle("store-test", 4, "다음", Some(1)),
    )
    .await;
    assert_eq!(stale["id"], "REGISTRYINSTALL_EXPECTED_VERSION_CONFLICT");
    let (_, downgrade) = call(
        &state,
        "POST",
        "/api/device/app-installs",
        bundle("store-test", 2, "첫 앱", Some(2)),
    )
    .await;
    assert_eq!(downgrade["id"], "REGISTRYINSTALL_RELEASE_DOWNGRADE");
    let mut foreign = bundle("store-test", 4, "다음", Some(2));
    foreign["origin"]["store_url"] = json!("https://other.example");
    let (_, conflict) = call(&state, "POST", "/api/device/app-installs", foreign).await;
    assert_eq!(conflict["id"], "REGISTRYINSTALL_ORIGIN_CONFLICT");
    let changed = json!({"id":"store-test","name":"사용자 수정","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"안녕"}}).to_string();
    let (changed_app, _) = state.publish_app(&changed, "agent", false, None).unwrap();
    assert_eq!(changed_app.app.installed_version, Some(2));
    assert_eq!(changed_app.app.origin.unwrap().release, 3);
    let (_, modified) = call(
        &state,
        "POST",
        "/api/device/app-installs",
        bundle("store-test", 4, "다음", Some(3)),
    )
    .await;
    assert_eq!(modified["id"], "REGISTRYINSTALL_LOCAL_MODIFIED");
}

#[tokio::test]
async fn delete_checks_version_closes_windows_and_allows_reinstall() {
    let (_dir, state) = setup();
    let first = bundle("delete-test", 1, "지울 앱", None);
    assert_eq!(
        call(&state, "POST", "/api/device/app-installs", first.clone())
            .await
            .0,
        StatusCode::OK
    );
    let layout: registry::LayoutChanges = serde_json::from_value(json!({
        "workspaces":[{"id":"w","name":"작업","created_at":"t","updated_at":"t"}],
        "desktops":[{"id":"d","workspace_id":"w","name":"화면","position":0,"created_at":"t","updated_at":"t"}],
        "windows":[{"id":"win","desktop_id":"d","app_id":"delete-test","app_version":1,"rect":{"x":0,"y":0,"width":100,"height":100},"z":1,"state":{},"created_at":"t","updated_at":"t"}]})).unwrap();
    state.apply_layout_changes(None, &layout).unwrap();
    let (_, conflict) = call(
        &state,
        "DELETE",
        "/api/device/apps/delete-test",
        json!({"expected_current_version":2}),
    )
    .await;
    assert_eq!(conflict["id"], "REGISTRYINSTALL_EXPECTED_VERSION_CONFLICT");
    assert!(state.app("delete-test", None).unwrap().is_some());
    let mut events = state.0.events.subscribe();
    let (status, _) = call(
        &state,
        "DELETE",
        "/api/device/apps/delete-test",
        json!({"expected_current_version":1}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::LayoutChanged { changes } if changes.deleted_windows == ["win"])
    );
    assert!(matches!(
        events.try_recv().unwrap().event,
        DeviceEvent::AppDeleted { .. }
    ));
    assert!(state.app("delete-test", None).unwrap().is_none());
    let mut different_store = first;
    different_store["origin"]["store_url"] = json!("https://other.example");
    let (status, reinstalled) =
        call(&state, "POST", "/api/device/app-installs", different_store).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        reinstalled["app"]["app"]["origin"]["store_url"],
        "https://other.example"
    );
    assert_eq!(reinstalled["app"]["app"]["current_version"], 1);
}

#[test]
fn migration_preserves_personal_app_without_origin() {
    let (_dir, state) = setup();
    let definition = json!({"id":"personal","name":"개인","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"안녕"}}).to_string();
    state
        .publish_app(&definition, "agent", false, None)
        .unwrap();
    let db = state.lock_db().unwrap();
    if db
        .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
        .unwrap()
        > 15
    {
        db.execute_batch("ALTER TABLE apps DROP COLUMN installation_json; PRAGMA user_version=15;")
            .unwrap();
    }
    migrate(&db).unwrap();
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        storage::INSTALLATION_SCHEMA_VERSION
    );
    let origin: Option<String> = db
        .query_row(
            "SELECT installation_json FROM apps WHERE id='personal'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(origin.is_none());
    drop(db);
    let app = state.app("personal", None).unwrap().unwrap();
    assert!(app.app.origin.is_none());
    assert!(app.app.installed_version.is_none());
}

#[tokio::test]
async fn personal_app_and_changed_release_bytes_are_rejected() {
    let (_dir, state) = setup();
    let original = bundle("personal-test", 1, "개인", None);
    state
        .publish_app(
            original["definition_json"].as_str().unwrap(),
            "agent",
            false,
            None,
        )
        .unwrap();
    let (_, conflict) = call(
        &state,
        "POST",
        "/api/device/app-installs",
        bundle("personal-test", 1, "개인", Some(1)),
    )
    .await;
    assert_eq!(conflict["id"], "REGISTRYINSTALL_ORIGIN_CONFLICT");
    let first = bundle("immutable-test", 1, "기존", None);
    assert_eq!(
        call(&state, "POST", "/api/device/app-installs", first)
            .await
            .0,
        StatusCode::OK
    );
    let (_, conflict) = call(
        &state,
        "POST",
        "/api/device/app-installs",
        bundle("immutable-test", 1, "변조", Some(1)),
    )
    .await;
    assert_eq!(conflict["id"], "REGISTRYINSTALL_RELEASE_DIGEST_CONFLICT");
    let mut tampered = bundle("tamper-test", 1, "시험", None);
    tampered["definition_json"] = json!("{}");
    assert_ne!(
        call(&state, "POST", "/api/device/app-installs", tampered)
            .await
            .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn personal_apps_cannot_be_removed_by_device() {
    let (_dir, state) = setup();
    let original = bundle("personal-delete", 1, "개인", None);
    state
        .publish_app(
            original["definition_json"].as_str().unwrap(),
            "agent",
            false,
            None,
        )
        .unwrap();
    let (status, error) = call(
        &state,
        "DELETE",
        "/api/device/apps/personal-delete",
        json!({"expected_current_version":1}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error["id"], "REGISTRYINSTALL_NOT_STORE_APP");
    assert!(state.app("personal-delete", None).unwrap().is_some());
}

fn bundle_with_asset(id: &str, svg: &str, extra: bool) -> Value {
    let mut assets = vec![json!({"id":"shared-icon","version":1})];
    if extra {
        assets.insert(0, json!({"id":"new-icon","version":1}));
    }
    let definition = json!({"id":id,"name":"자산 앱","requires":{"blocks":4,"modules":{"assets":1}},"permissions":[],"assets":assets,"ui":{"type":"text","value":"안녕"}});
    let raw = definition.to_string();
    let mut uploads = Vec::new();
    let mut files = serde_json::Map::new();
    files.insert(
        format!("apps/{id}/1/app.json"),
        json!({"sha256":sha256_hex(raw.as_bytes()),"bytes":raw.len()}),
    );
    for asset in definition["assets"].as_array().unwrap() {
        let asset_id = asset["id"].as_str().unwrap();
        let bytes = if asset_id == "shared-icon" {
            svg
        } else {
            "<svg/>"
        };
        let digest = sha256_hex(bytes.as_bytes());
        uploads.push(json!({"id":asset_id,"version":1,"format":"svg","sha256":digest,"source":"시험","license":"MIT","data_base64":STANDARD.encode(bytes)}));
        files.insert(format!("apps/{id}/1/assets/{asset_id}/1"), json!({"sha256":digest,"bytes":bytes.len(),"format":"svg","source":"시험","license":"MIT"}));
    }
    let manifest = json!({"format":1,"store_app_id":id,"release":1,"name":"자산 앱","summary":"시험","description":"시험","category":"시험","publisher":"tester","icon":null,"screenshots":[],"requires":definition["requires"],"permissions":[],"badges":[],"files":files,"published_at":"2026-11-05T00:00:00Z"}).to_string();
    let digest = sha256_hex(manifest.as_bytes());
    json!({"definition_json":raw,"asset_uploads":uploads,"manifest_base64":STANDARD.encode(manifest),"approved_digest":digest,"origin":{"store_url":"https://store.example","store_app_id":id,"release":1,"digest":digest},"expected_current_version":null})
}

#[tokio::test]
async fn conflicting_asset_rolls_back_app_and_other_assets() {
    let (_dir, state) = setup();
    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle_with_asset("asset-first", "<svg/>", false)
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, error) = call(
        &state,
        "POST",
        "/api/device/app-installs",
        bundle_with_asset("asset-second", "<svg><path/></svg>", true),
    )
    .await;
    assert_ne!(status, StatusCode::OK);
    assert_eq!(error["id"], "ASSET_REGISTER_VERSION_CONFLICT");
    assert!(state.app("asset-second", None).unwrap().is_none());
    assert_eq!(state.list_assets().unwrap().len(), 1);
}

#[tokio::test]
async fn installed_origin_survives_restart_and_enters_snapshot() {
    let (dir, state) = setup();
    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle("restart-test", 1, "재기동", None)
        )
        .await
        .0,
        StatusCode::OK
    );
    drop(state);
    let state = AppState::open(dir.path().join("test.sqlite"), "secret".into()).unwrap();
    let app = state.app("restart-test", None).unwrap().unwrap();
    assert_eq!(app.app.origin.unwrap().release, 1);
    assert_eq!(app.app.installed_version, Some(1));
    let snapshot = state.current_apps().unwrap();
    let app = snapshot
        .iter()
        .find(|app| app.app.id == "restart-test")
        .unwrap();
    assert_eq!(app.app.origin.as_ref().unwrap().release, 1);
}

#[tokio::test]
async fn altered_manifest_or_asset_declarations_do_not_install() {
    let (_dir, state) = setup();
    let mut request = bundle("digest-test", 1, "시험", None);
    request["approved_digest"] = json!("0".repeat(64));
    let (_, error) = call(&state, "POST", "/api/device/app-installs", request).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_MANIFEST_DIGEST_MISMATCH");
    let mut request = bundle_with_asset("metadata-test", "<svg/>", false);
    request["asset_uploads"][0]["license"] = json!("다름");
    let (_, error) = call(&state, "POST", "/api/device/app-installs", request).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_DECLARATION_MISMATCH");
    assert!(state.current_apps().unwrap().is_empty());
    assert!(state.list_assets().unwrap().is_empty());
}

#[tokio::test]
async fn omitted_permissions_match_the_stores_empty_permission_list() {
    let (_dir, state) = setup();
    let mut request = bundle("no-permissions", 1, "권한 없음", None);
    let mut definition: Value =
        serde_json::from_str(request["definition_json"].as_str().unwrap()).unwrap();
    definition.as_object_mut().unwrap().remove("permissions");
    let raw = definition.to_string();
    let manifest_bytes = STANDARD
        .decode(request["manifest_base64"].as_str().unwrap())
        .unwrap();
    let mut manifest: Value = serde_json::from_slice(&manifest_bytes).unwrap();
    manifest["files"]["apps/no-permissions/1/app.json"] =
        json!({"sha256":sha256_hex(raw.as_bytes()),"bytes":raw.len()});
    let manifest = manifest.to_string();
    let digest = sha256_hex(manifest.as_bytes());
    request["definition_json"] = json!(raw);
    request["manifest_base64"] = json!(STANDARD.encode(manifest));
    request["approved_digest"] = json!(digest);
    request["origin"]["digest"] = json!(digest);
    let (status, reply) = call(&state, "POST", "/api/device/app-installs", request).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
}

#[tokio::test]
async fn app_named_install_can_be_removed_from_device() {
    let (_dir, state) = setup();
    let request = bundle("install", 1, "설치 앱", None);
    assert_eq!(
        call(&state, "POST", "/api/device/app-installs", request)
            .await
            .0,
        StatusCode::OK
    );
    let (status, reply) = call(
        &state,
        "DELETE",
        "/api/device/apps/install",
        json!({"expected_current_version":1}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert!(state.app("install", None).unwrap().is_none());
}

fn change_manifest(request: &mut Value, edit: impl FnOnce(&mut Value)) {
    let bytes = STANDARD
        .decode(request["manifest_base64"].as_str().unwrap())
        .unwrap();
    let mut manifest: Value = serde_json::from_slice(&bytes).unwrap();
    edit(&mut manifest);
    let raw = manifest.to_string();
    let digest = sha256_hex(raw.as_bytes());
    request["manifest_base64"] = json!(STANDARD.encode(raw));
    request["approved_digest"] = json!(digest);
    request["origin"]["digest"] = json!(digest);
}

#[tokio::test]
async fn byte_count_hash_and_encoding_failures_have_distinct_codes() {
    let (_dir, state) = setup();
    let mut app_size = bundle("app-size", 1, "앱", None);
    change_manifest(&mut app_size, |manifest| {
        manifest["files"]["apps/app-size/1/app.json"]["bytes"] = json!(1)
    });
    let (_, error) = call(&state, "POST", "/api/device/app-installs", app_size).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_APP_SIZE_MISMATCH");

    let mut asset_size = bundle_with_asset("asset-size", "<svg/>", false);
    change_manifest(&mut asset_size, |manifest| {
        manifest["files"]["apps/asset-size/1/assets/shared-icon/1"]["bytes"] = json!(1)
    });
    let (_, error) = call(&state, "POST", "/api/device/app-installs", asset_size).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_ASSET_SIZE_MISMATCH");

    let mut encoding = bundle("encoding", 1, "앱", None);
    encoding["manifest_base64"] = json!("***");
    let (_, error) = call(&state, "POST", "/api/device/app-installs", encoding).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_MANIFEST_ENCODING_INVALID");
}
