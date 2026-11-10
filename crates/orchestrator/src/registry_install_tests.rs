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

fn connection_bundle(id: &str, connections: Value) -> Value {
    let mut request = bundle(id, 1, "연결 앱", None);
    let mut definition: Value = serde_json::from_str(request["definition_json"].as_str().unwrap()).unwrap();
    definition["requires"]["modules"]["connection"] = json!(1);
    definition["permissions"] = json!([{"module":"connection","id":"api","connection":"fixture","access":"read","label":"연결"}]);
    let raw = definition.to_string();
    let bytes = STANDARD.decode(request["manifest_base64"].as_str().unwrap()).unwrap();
    let mut manifest: Value = serde_json::from_slice(&bytes).unwrap();
    manifest["requires"] = definition["requires"].clone();
    manifest["permissions"] = definition["permissions"].clone();
    manifest["connections"] = connections.clone();
    manifest["files"][format!("apps/{id}/1/app.json")] = json!({"sha256":sha256_hex(raw.as_bytes()),"bytes":raw.len()});
    let manifest = manifest.to_string();
    let digest = sha256_hex(manifest.as_bytes());
    request["definition_json"] = json!(raw);
    request["manifest_base64"] = json!(STANDARD.encode(manifest));
    request["approved_digest"] = json!(digest);
    request["origin"]["digest"] = json!(digest);
    request["connections"] = connections;
    request
}

fn bundle_with_storage(id: &str, release: u32, name: &str, expected: Option<u32>) -> Value {
    let mut request = bundle(id, release, name, expected);
    let mut definition: Value =
        serde_json::from_str(request["definition_json"].as_str().unwrap()).unwrap();
    definition["requires"]["blocks"] = json!(6);
    definition["requires"]["modules"]["storage"] = json!(1);
    definition["storage"] = json!({"entries":[{"id":"title","key":"settings/title","kind":"json","schema":{"type":"string"},"default":"","label":"제목","presentation":"settings"}]});
    let raw = definition.to_string();
    let bytes = STANDARD.decode(request["manifest_base64"].as_str().unwrap()).unwrap();
    let mut manifest: Value = serde_json::from_slice(&bytes).unwrap();
    manifest["requires"] = definition["requires"].clone();
    manifest["files"][format!("apps/{id}/{release}/app.json")] =
        json!({"sha256":sha256_hex(raw.as_bytes()),"bytes":raw.len()});
    let manifest = manifest.to_string();
    let digest = sha256_hex(manifest.as_bytes());
    request["definition_json"] = json!(raw);
    request["manifest_base64"] = json!(STANDARD.encode(manifest));
    request["approved_digest"] = json!(digest);
    request["origin"]["digest"] = json!(digest);
    request
}

#[tokio::test]
async fn store_connections_are_atomic_preserved_and_broadcast() {
    let (_dir, state) = setup();
    let oauth = json!({"name":"fixture","kind":"oauth","base_url":"https://example.com/","paths":["/api/"],"writable":false,"description":"시험"});
    let mut events = state.0.events.subscribe();
    let (status, reply) = call(&state,"POST","/api/device/app-installs",connection_bundle("connected",json!([oauth.clone()]))).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(state.connection("fixture").unwrap().unwrap().info.base_url, "https://example.com");
    let mut saw_snapshot = false;
    while let Ok(event) = events.try_recv() { saw_snapshot |= matches!(event.event, DeviceEvent::ConnectionsSnapshot { .. }); }
    assert!(saw_snapshot);
    let mut replacement = oauth.clone(); replacement["base_url"] = json!("https://different.example");
    let (status, reply) = call(&state,"POST","/api/device/app-installs",connection_bundle("second",json!([replacement]))).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(state.connection("fixture").unwrap().unwrap().info.base_url, "https://example.com");
    assert_eq!(call(&state,"DELETE","/api/device/apps/connected",json!({"expected_current_version":1})).await.0, StatusCode::OK);
    assert!(state.connection("fixture").unwrap().is_some());
    let mut bad = oauth; bad["base_url"] = json!("https://example.com/?secret=x");
    let (status, reply) = call(&state,"POST","/api/device/app-installs",connection_bundle("invalid",json!([bad]))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{reply}");
    assert_eq!(reply["id"], "REGISTRYINSTALL_CONNECTION_INVALID");
    assert!(state.app("invalid",None).unwrap().is_none());
}

#[tokio::test]
async fn store_connection_manifest_is_checked_and_old_shell_is_supported() {
    let (_dir, state) = setup();
    let oauth = json!({"name":"fixture","kind":"oauth","base_url":"https://example.com","paths":["/api/"],"writable":false,"description":"시험"});
    let mut mismatch = connection_bundle("mismatch",json!([oauth.clone()]));
    mismatch["connections"][0]["base_url"] = json!("https://other.example");
    let (_, reply) = call(&state,"POST","/api/device/app-installs",mismatch).await;
    assert_eq!(reply["id"], "REGISTRYINSTALL_CONNECTION_MISMATCH");
    assert!(state.app("mismatch",None).unwrap().is_none());
    let mut secret = oauth.clone(); secret["headers"] = json!({"Authorization":"secret"});
    let (_, reply) = call(&state,"POST","/api/device/app-installs",connection_bundle("secret",json!([secret]))).await;
    assert_eq!(reply["id"], "REGISTRYINSTALL_CONNECTION_FORMAT_INVALID");
    assert!(state.app("secret",None).unwrap().is_none());
    let mut wrong_name = oauth.clone(); wrong_name["name"] = json!("other");
    let (_, reply) = call(&state,"POST","/api/device/app-installs",connection_bundle("wrong-name",json!([wrong_name]))).await;
    assert_eq!(reply["id"], "REGISTRYINSTALL_CONNECTION_NAMES_MISMATCH");
    let mut old_shell = connection_bundle("old-shell",json!([oauth]));
    old_shell.as_object_mut().unwrap().remove("connections");
    let (status, reply) = call(&state,"POST","/api/device/app-installs",old_shell).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert!(state.connection("fixture").unwrap().is_none());
}

async fn call(state: &AppState, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    call_as(state, "test-token", method, path, body).await
}

async fn call_as(
    state: &AppState,
    token: &str,
    method: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
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
        storage::STORAGE_SCOPE_SCHEMA_VERSION
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
    bundle_with_asset_meta(id, svg, extra, "시험", "MIT")
}

fn bundle_with_asset_meta(id: &str, svg: &str, extra: bool, source: &str, license: &str) -> Value {
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
        uploads.push(json!({"id":asset_id,"version":1,"format":"svg","sha256":digest,"source":source,"license":license,"data_base64":STANDARD.encode(bytes)}));
        files.insert(format!("apps/{id}/1/assets/{asset_id}/1"), json!({"sha256":digest,"bytes":bytes.len(),"format":"svg","source":source,"license":license}));
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
async fn same_asset_bytes_with_updated_source_installs_without_conflict() {
    let (_dir, state) = setup();
    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle_with_asset("asset-source-first", "<svg/>", false)
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, reply) = call(
        &state,
        "POST",
        "/api/device/app-installs",
        bundle_with_asset_meta(
            "asset-source-second",
            "<svg/>",
            false,
            "스토어",
            "Apache-2.0",
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert!(state.app("asset-source-second", None).unwrap().is_some());
    let account = state.mcp_account_id().unwrap();
    let (meta, bytes) = state
        .get_asset(&account, "shared-icon", 1)
        .unwrap()
        .unwrap();
    assert_eq!(meta.source, "스토어");
    assert_eq!(meta.license, "Apache-2.0");
    assert_eq!(bytes, b"<svg/>");
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

fn window_layout(app_id: &str, window_id: &str) -> registry::LayoutChanges {
    serde_json::from_value(json!({
        "workspaces":[{"id":"w","name":"작업","created_at":"t","updated_at":"t"}],
        "desktops":[{"id":"d","workspace_id":"w","name":"화면","position":0,"created_at":"t","updated_at":"t"}],
        "windows":[{"id":window_id,"desktop_id":"d","app_id":app_id,"app_version":1,"rect":{"x":0,"y":0,"width":100,"height":100},"z":1,"state":{},"created_at":"t","updated_at":"t"}]
    }))
    .unwrap()
}

fn insert_store_storage_item(state: &AppState, app_id: &str) {
    let account = state.mcp_account_id().unwrap();
    let db = state.lock_db().unwrap();
    db.execute(
        "INSERT INTO app_storage_buckets(id,account_id,app_id) VALUES('bucket-' || ?1,?2,?1)",
        params![app_id, account],
    )
    .unwrap();
    db.execute(
        "INSERT INTO app_storage_items(bucket_id,key,kind,content,revision,updated_at) VALUES('bucket-' || ?1,'settings/title','json','\"kept\"','rev','now')",
        [app_id],
    )
    .unwrap();
}

#[tokio::test]
async fn replace_turns_a_custom_app_into_the_store_app_and_keeps_window_and_storage() {
    let (_dir, state) = setup();
    let custom = bundle_with_storage("custom-replace", 1, "개인", None);
    state
        .publish_app(
            custom["definition_json"].as_str().unwrap(),
            "agent",
            false,
            None,
        )
        .unwrap();
    state
        .apply_layout_changes(None, &window_layout("custom-replace", "win-custom"))
        .unwrap();
    insert_store_storage_item(&state, "custom-replace");
    let mut request = bundle_with_storage("custom-replace", 2, "스토어 판", Some(1));
    request["replace"] = json!(true);
    let (status, reply) = call(&state, "POST", "/api/device/app-installs", request).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["unchanged"], false);
    assert_eq!(reply["app"]["app"]["origin"]["store_url"], "https://store.example");
    assert_eq!(reply["app"]["app"]["origin"]["release"], 2);
    assert_eq!(reply["app"]["app"]["current_version"], 2);
    assert_eq!(reply["app"]["app"]["installed_version"], 2);
    let db = state.lock_db().unwrap();
    let window_version: u32 = db
        .query_row(
            "SELECT json_extract(data,'$.app_version') FROM windows WHERE id='win-custom'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(window_version, 2);
    let stored: String = db
        .query_row(
            "SELECT content FROM app_storage_items WHERE bucket_id='bucket-custom-replace' AND key='settings/title'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "\"kept\"");
}

#[tokio::test]
async fn replace_changes_only_the_origin_when_the_definition_is_identical() {
    let (_dir, state) = setup();
    let same = bundle("same-def", 1, "같은 정의", None);
    state
        .publish_app(
            same["definition_json"].as_str().unwrap(),
            "agent",
            false,
            None,
        )
        .unwrap();
    let mut request = same;
    request["expected_current_version"] = json!(1);
    request["replace"] = json!(true);
    let (status, reply) = call(&state, "POST", "/api/device/app-installs", request).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["unchanged"], false);
    assert_eq!(reply["app"]["app"]["current_version"], 1);
    assert_eq!(reply["app"]["app"]["installed_version"], 1);
    assert_eq!(reply["app"]["app"]["origin"]["store_url"], "https://store.example");
}

#[tokio::test]
async fn replace_switches_between_store_origins() {
    let (_dir, state) = setup();
    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle("origin-switch", 1, "첫 판", None)
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut request = bundle("origin-switch", 2, "둘째 판", Some(1));
    request["origin"]["store_url"] = json!("https://other.example");
    request["replace"] = json!(true);
    let (status, reply) = call(&state, "POST", "/api/device/app-installs", request).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["app"]["app"]["origin"]["store_url"], "https://other.example");
    assert_eq!(reply["app"]["app"]["origin"]["release"], 2);
    assert_eq!(reply["app"]["app"]["current_version"], 2);
    assert_eq!(reply["app"]["app"]["installed_version"], 2);
}

#[tokio::test]
async fn replace_restores_a_modified_store_app_from_the_same_release() {
    let (_dir, state) = setup();
    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle("restore-test", 1, "원래", None)
        )
        .await
        .0,
        StatusCode::OK
    );
    let changed = json!({"id":"restore-test","name":"수정","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"안녕"}}).to_string();
    state.publish_app(&changed, "agent", false, None).unwrap();
    let modified = state.app("restore-test", None).unwrap().unwrap();
    assert_eq!(modified.app.installed_version, Some(1));
    assert_eq!(modified.app.current_version, 2);
    let mut request = bundle("restore-test", 1, "원래", Some(2));
    request["replace"] = json!(true);
    let (status, reply) = call(&state, "POST", "/api/device/app-installs", request).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["unchanged"], false);
    assert_eq!(reply["app"]["app"]["current_version"], 3);
    assert_eq!(reply["app"]["app"]["installed_version"], 3);
    assert_eq!(reply["app"]["version"]["definition"]["name"], "원래");
}

#[tokio::test]
async fn replace_does_not_bypass_builtin_expected_version_or_downgrade_checks() {
    let (_dir, state) = setup();
    let mut builtin = bundle("explorer", 1, "탐색기", None);
    builtin["replace"] = json!(true);
    let (status, error) = call(&state, "POST", "/api/device/app-installs", builtin).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert_eq!(error["id"], "REGISTRYINSTALL_ORIGIN_CONFLICT");

    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle("guard-replace", 1, "가드", None)
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut stale = bundle("guard-replace", 2, "가드", Some(5));
    stale["replace"] = json!(true);
    let (_, error) = call(&state, "POST", "/api/device/app-installs", stale).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_EXPECTED_VERSION_CONFLICT");

    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle("down-replace", 2, "둘", None)
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut down = bundle("down-replace", 1, "하나", Some(1));
    down["replace"] = json!(true);
    let (_, error) = call(&state, "POST", "/api/device/app-installs", down).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_RELEASE_DOWNGRADE");

    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle("digest-replace", 1, "에이", None)
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut digest = bundle("digest-replace", 1, "비", Some(1));
    digest["replace"] = json!(true);
    let (_, error) = call(&state, "POST", "/api/device/app-installs", digest).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_RELEASE_DIGEST_CONFLICT");
}

#[tokio::test]
async fn replace_on_a_modified_app_keeps_downgrade_and_digest_checks() {
    let (_dir, state) = setup();
    let modify = |id: &str| {
        let changed = json!({"id":id,"name":"수정","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"안녕"}}).to_string();
        state.publish_app(&changed, "agent", false, None).unwrap();
    };
    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle("modified-down", 2, "둘", None)
        )
        .await
        .0,
        StatusCode::OK
    );
    modify("modified-down");
    let mut down = bundle("modified-down", 1, "하나", Some(2));
    down["replace"] = json!(true);
    let (_, error) = call(&state, "POST", "/api/device/app-installs", down).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_RELEASE_DOWNGRADE");

    assert_eq!(
        call(
            &state,
            "POST",
            "/api/device/app-installs",
            bundle("modified-digest", 1, "에이", None)
        )
        .await
        .0,
        StatusCode::OK
    );
    modify("modified-digest");
    let mut digest = bundle("modified-digest", 1, "비", Some(2));
    digest["replace"] = json!(true);
    let (_, error) = call(&state, "POST", "/api/device/app-installs", digest).await;
    assert_eq!(error["id"], "REGISTRYINSTALL_RELEASE_DIGEST_CONFLICT");

    let mut newer = bundle("modified-digest", 2, "비", Some(2));
    newer["replace"] = json!(true);
    let (status, reply) = call(&state, "POST", "/api/device/app-installs", newer).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["app"]["version"]["definition"]["name"], "비");
}

#[tokio::test]
async fn custom_app_can_be_removed_by_device_with_allow_custom() {
    let (_dir, state) = setup();
    let custom = bundle("custom-delete", 1, "개인", None);
    state
        .publish_app(
            custom["definition_json"].as_str().unwrap(),
            "agent",
            false,
            None,
        )
        .unwrap();
    state
        .apply_layout_changes(None, &window_layout("custom-delete", "win-custom-delete"))
        .unwrap();
    insert_store_storage_item(&state, "custom-delete");
    let mut events = state.0.events.subscribe();
    let (status, reply) = call(
        &state,
        "DELETE",
        "/api/device/apps/custom-delete",
        json!({"expected_current_version":1,"allow_custom":true}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["closed_windows"], 1);
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::LayoutChanged { changes } if changes.deleted_windows == ["win-custom-delete"])
    );
    assert!(matches!(
        events.try_recv().unwrap().event,
        DeviceEvent::AppDeleted { .. }
    ));
    assert!(state.app("custom-delete", None).unwrap().is_none());
    let stored: String = state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT content FROM app_storage_items WHERE bucket_id='bucket-custom-delete' AND key='settings/title'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "\"kept\"");
}

#[tokio::test]
async fn builtin_app_cannot_be_removed_by_device_even_with_allow_custom() {
    let (_dir, state) = setup();
    let (status, error) = call(
        &state,
        "DELETE",
        "/api/device/apps/explorer",
        json!({"expected_current_version":1,"allow_custom":true}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert_eq!(error["id"], "MCP_DELETE_APP_BUILTIN");
}

fn add_other_device(state: &AppState) {
    let db = state.lock_db().unwrap();
    db.execute("INSERT INTO accounts(id,display_name,created_at) VALUES('other-account','다른 계정','now')", []).unwrap();
    db.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('other-device','다른 기기','other-account',?1,'now')", [sha256_hex(b"other-token")]).unwrap();
}

#[tokio::test]
async fn other_account_cannot_update_installed_app_or_assets() {
    let (_dir, state) = setup();
    add_other_device(&state);
    let first = bundle_with_asset("owned-install", "<svg/>", false);
    assert_eq!(
        call(&state, "POST", "/api/device/app-installs", first)
            .await
            .0,
        StatusCode::OK
    );
    let before = state.app("owned-install", None).unwrap().unwrap();
    let assets = state.list_assets().unwrap();
    let mut update = bundle_with_asset("owned-install", "<svg/>", true);
    change_manifest(&mut update, |manifest| {
        manifest["release"] = json!(2);
        let files = manifest["files"].as_object_mut().unwrap();
        *files = std::mem::take(files)
            .into_iter()
            .map(|(path, value)| {
                (
                    path.replacen("apps/owned-install/1/", "apps/owned-install/2/", 1),
                    value,
                )
            })
            .collect();
    });
    update["origin"]["release"] = json!(2);
    update["expected_current_version"] = json!(1);
    let (status, error) = call_as(
        &state,
        "other-token",
        "POST",
        "/api/device/app-installs",
        update,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{error}");
    assert_eq!(error["id"], "REGISTRYINSTALL_INSTALL_ACCOUNT_FORBIDDEN");
    assert_eq!(state.app("owned-install", None).unwrap().unwrap(), before);
    assert_eq!(state.list_assets().unwrap(), assets);
    assert!(state
        .get_asset("other-account", "new-icon", 1)
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn other_account_cannot_delete_installed_app_or_assets() {
    let (_dir, state) = setup();
    add_other_device(&state);
    let first = bundle_with_asset("owned-delete", "<svg/>", false);
    assert_eq!(
        call(&state, "POST", "/api/device/app-installs", first)
            .await
            .0,
        StatusCode::OK
    );
    let before = state.app("owned-delete", None).unwrap().unwrap();
    let assets = state.list_assets().unwrap();
    let (status, error) = call_as(
        &state,
        "other-token",
        "DELETE",
        "/api/device/apps/owned-delete",
        json!({"expected_current_version":1}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{error}");
    assert_eq!(error["id"], "REGISTRYINSTALL_REMOVE_ACCOUNT_FORBIDDEN");
    assert_eq!(state.app("owned-delete", None).unwrap().unwrap(), before);
    assert_eq!(state.list_assets().unwrap(), assets);
}
