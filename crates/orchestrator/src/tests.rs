use super::*;
use axum::body::Body;
use tower::ServiceExt;

const EDITOR: &str = include_str!("../../../examples/md-editor.json");
const BROWSER: &str = include_str!("../../../examples/web-browser.json");
const LEGACY_APP: &str = include_str!("../../../examples/workspace-pas.json");
const CARD_BOARD: &str = include_str!("../../../examples/card-board.json");

#[test]
fn app_upload_versions_and_deduplicates_identical_definitions() {
    let state = AppState::in_memory("secret");
    let (first, unchanged) = state.publish_app(EDITOR, "agent", false, None).unwrap();
    assert_eq!(first.version.version, 1);
    assert!(!unchanged);
    let (same, unchanged) = state.publish_app(EDITOR, "agent", false, None).unwrap();
    assert_eq!(same.version.version, 1);
    assert!(unchanged);
    let modified = EDITOR.replace("마크다운 편집기", "편집기 변경");
    assert_ne!(modified, EDITOR);
    let (second, unchanged) = state.publish_app(&modified, "agent", false, None).unwrap();
    assert_eq!(second.version.version, 2);
    assert!(!unchanged);
}

#[test]
fn invalid_definitions_and_outside_paths_are_rejected_without_saving() {
    let state = AppState::in_memory("secret");
    let malformed = r#"{"id":"bad","name":"Bad"}"#;
    let err = state
        .publish_app(malformed, "agent", false, None)
        .unwrap_err();
    assert!(!err.details.is_empty());
    let outside = EDITOR.replace(
        r#""path": { "state": "current_file" }"#,
        r#""path": "../secret.md""#,
    );
    assert_ne!(outside, EDITOR);
    let err = state
        .publish_app(&outside, "agent", false, None)
        .unwrap_err();
    assert!(err
        .details
        .iter()
        .any(|detail| detail.contains("고른 폴더 밖")));
    let count: i64 = state
        .lock_db()
        .unwrap()
        .query_row("SELECT count(*) FROM apps", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn pairing_start_pending_approve_consumes_token_once_and_expires() {
    let state = AppState::in_memory("secret");
    let start = state.start_pairing("my-pc".into()).await.unwrap();
    assert!(matches!(
        state.poll_pairing(&start.device_code).await.unwrap(),
        PairPollReply::Pending {}
    ));
    let (id, name) = state
        .approve_pairing(&start.user_code.to_lowercase())
        .await
        .unwrap();
    assert_eq!(name, "my-pc");
    let PairPollReply::Approved { device_id, token } =
        state.poll_pairing(&start.device_code).await.unwrap()
    else {
        panic!("승인되어야 함")
    };
    assert_eq!(device_id, id);
    assert_eq!(state.authenticate_device(&token).unwrap().unwrap().0, id);
    assert_eq!(
        state.poll_pairing(&start.device_code).await.unwrap_err().0,
        StatusCode::NOT_FOUND
    );
    let expired = state.start_pairing("old".into()).await.unwrap();
    state
        .0
        .pairings
        .lock()
        .await
        .get_mut(&expired.device_code)
        .unwrap()
        .expires_at_unix = Utc::now().timestamp() - 1;
    assert_eq!(
        state
            .poll_pairing(&expired.device_code)
            .await
            .unwrap_err()
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn pending_pairing_limit_is_twenty() {
    let state = AppState::in_memory("secret");
    for _ in 0..registry::PAIRING_MAX_PENDING {
        state.start_pairing("pc".into()).await.unwrap();
    }
    assert_eq!(
        state.start_pairing("pc".into()).await.unwrap_err().0,
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[tokio::test]
async fn invalid_and_revoked_device_tokens_receive_401() {
    let state = AppState::in_memory("secret");
    let (id, token) = make_device(&state);
    let app = router(state.clone());
    let invalid = app
        .clone()
        .oneshot(request(
            "GET",
            "/api/device/events",
            Some("wrong"),
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);
    state.revoke_device(&id).unwrap();
    let revoked = app
        .oneshot(request(
            "POST",
            "/api/device/apps",
            Some(&token),
            Body::from(r#"{"definition_json":"{}"}"#),
        ))
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn mcp_requires_bearer_token() {
    let app = router(AppState::in_memory("secret"));
    let response=app.oneshot(request("POST","/mcp",None,Body::from(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}"#))).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn event_stream_starts_with_snapshot_then_published_app() {
    use futures::StreamExt;
    let state = AppState::in_memory("secret");
    let (id, token) = make_device(&state);
    let response = router(state.clone())
        .oneshot(request(
            "GET",
            "/api/device/events",
            Some(&token),
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body();
    let mut body_stream = body.into_data_stream();
    let first = String::from_utf8(body_stream.next().await.unwrap().unwrap().to_vec()).unwrap();
    assert!(first.contains("apps.snapshot"), "{first}");
    state.publish_app(LEGACY_APP, "agent", true, None).unwrap();
    let second = String::from_utf8(body_stream.next().await.unwrap().unwrap().to_vec()).unwrap();
    assert!(second.contains("app.published"), "{second}");
    assert!(second.contains("\"open\":true"), "{second}");
    assert_eq!(state.0.connections.lock().unwrap().get(&id), Some(&1));
}

#[tokio::test]
async fn event_stream_snapshot_filters_apps_by_supported_header() {
    use kaleidoscope_contract::{registry::SUPPORTED_HEADER, Supported};

    let state = AppState::in_memory("secret");
    state.publish_app(LEGACY_APP, "agent", false, None).unwrap();
    state.publish_app(BROWSER, "agent", false, None).unwrap();
    let (old_id, old_token) = make_device(&state);
    let (_, current_token) = make_device(&state);

    let old = router(state.clone())
        .oneshot(request(
            "GET",
            "/api/device/events",
            Some(&old_token),
            Body::empty(),
        ))
        .await
        .unwrap();
    let mut old_stream = old.into_body().into_data_stream();
    let old_snapshot = next_device_event(&mut old_stream).await;
    let old_ids: Vec<_> = serde_json::from_value::<Vec<RegistryApp>>(old_snapshot["apps"].clone())
        .unwrap()
        .into_iter()
        .map(|app| app.app.id)
        .collect();
    assert_eq!(old_ids, ["workspace-pas"]);

    let supported = serde_json::to_string(&Supported::current()).unwrap();
    let current_request = Request::builder()
        .method("GET")
        .uri("/api/device/events")
        .header(header::AUTHORIZATION, format!("Bearer {current_token}"))
        .header(SUPPORTED_HEADER, supported)
        .body(Body::empty())
        .unwrap();
    let current = router(state.clone())
        .oneshot(current_request)
        .await
        .unwrap();
    let mut current_stream = current.into_body().into_data_stream();
    let current_snapshot = next_device_event(&mut current_stream).await;
    let current_ids: Vec<_> =
        serde_json::from_value::<Vec<RegistryApp>>(current_snapshot["apps"].clone())
            .unwrap()
            .into_iter()
            .map(|app| app.app.id)
            .collect();
    assert_eq!(current_ids, ["web-browser", "workspace-pas"]);
    assert!(state.0.connections.lock().unwrap().contains_key(&old_id));
}

#[tokio::test]
async fn legacy_stream_does_not_receive_unrenderable_publish_or_open_events() {
    let state = AppState::in_memory("secret");
    let (device_id, token) = make_device(&state);
    let response = router(state.clone())
        .oneshot(request(
            "GET",
            "/api/device/events",
            Some(&token),
            Body::empty(),
        ))
        .await
        .unwrap();
    let mut stream = response.into_body().into_data_stream();
    let _ = next_device_event(&mut stream).await;

    let (browser, _) = state.publish_app(BROWSER, "agent", false, None).unwrap();
    let published = state.event_for_device(
        &device_id,
        DeviceEvent::AppPublished {
            app: browser.clone(),
            open: false,
            workspace_id: None,
        },
    );
    let opened = state.event_for_device(
        &device_id,
        DeviceEvent::AppOpen {
            app_id: browser.app.id,
            workspace_id: None,
        },
    );
    assert!(published.is_none());
    assert!(opened.is_none());
}

fn request(method: &str, path: &str, token: Option<&str>, body: Body) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    builder.body(body).unwrap()
}

fn current_shell_request(method: &str, path: &str, token: &str, body: Body) -> Request<Body> {
    use kaleidoscope_contract::registry::SUPPORTED_HEADER;
    let mut request = request(method, path, Some(token), body);
    request.headers_mut().insert(
        SUPPORTED_HEADER,
        serde_json::to_string(&kaleidoscope_contract::Supported::current())
            .unwrap()
            .parse()
            .unwrap(),
    );
    request
}

pub(super) fn make_device(state: &AppState) -> (String, String) {
    let id = Uuid::new_v4().to_string();
    let token = random_token();
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,'test',(SELECT account_id FROM mcp_principal WHERE id=1),?2,?3)",
            params![id, sha256_hex(token.as_bytes()), timestamp()],
        )
        .unwrap();
    (id, token)
}

async fn next_device_event(stream: &mut axum::body::BodyDataStream) -> Value {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let bytes = stream.next().await.unwrap().unwrap();
            let text = std::str::from_utf8(&bytes).unwrap();
            if let Some(data) = text.strip_prefix("data: ") {
                return serde_json::from_str(data.trim()).unwrap();
            }
        }
    })
    .await
    .expect("기기 이벤트를 받지 못했습니다")
}

#[test]
fn migration_upgrades_v1_without_losing_devices() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE devices (id TEXT PRIMARY KEY,name TEXT NOT NULL,token_sha256 TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,last_seen_at TEXT,revoked_at TEXT); INSERT INTO devices(id,name,token_sha256,created_at) VALUES('d','PC','hash','now'); PRAGMA user_version=1;").unwrap();
    migrate(&db).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 7);
    assert_eq!(
        db.query_row("SELECT count(*) FROM devices", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM agents", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='connections'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}

#[test]
fn migration_upgrades_v2_agent_history_with_empty_attachments() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE apps (id TEXT PRIMARY KEY,name TEXT NOT NULL,current_version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE app_versions (app_id TEXT NOT NULL REFERENCES apps(id),version INTEGER NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,PRIMARY KEY(app_id,version));
        CREATE TABLE devices (id TEXT PRIMARY KEY,name TEXT NOT NULL,token_sha256 TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,last_seen_at TEXT,revoked_at TEXT);
        CREATE TABLE device_layouts (device_id TEXT PRIMARY KEY REFERENCES devices(id), layout TEXT NOT NULL, reported_at TEXT NOT NULL);
        CREATE TABLE agents (workspace_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE, model_preset TEXT NOT NULL, workspace_name TEXT NOT NULL, created_at TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE agent_items (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
        INSERT INTO agent_items(workspace_id,kind,text,at) VALUES('w','user','예전 기록','now');
        PRAGMA user_version=2;").unwrap();
    migrate(&db).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 7);
    assert_eq!(
        db.query_row(
            "SELECT text || ':' || attachments FROM agent_items WHERE workspace_id='w'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap(),
        "예전 기록:[]"
    );
}

#[tokio::test]
async fn layout_and_agent_endpoints_validate_and_keep_working_without_soulstream() {
    use http_body_util::BodyExt;
    let state = AppState::in_memory("secret");
    let (_, token) = make_device(&state);
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![kaleidoscope_contract::Workspace {
                    id: "w".into(),
                    name: "작업".into(),
                    created_at: "t".into(),
                    updated_at: "t".into(),
                }],
                ..Default::default()
            },
        )
        .unwrap();
    let app = router(state);
    let call = |method, path, body: &'static str| {
        Request::builder()
            .method(method)
            .uri(path)
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap()
    };
    let layout = r#"{"workspaces":[],"desktops":[],"windows":[],"folders":[],"active_workspace_id":null,"active_desktop_ids":{}}"#;
    assert_eq!(
        app.clone()
            .oneshot(call("PUT", "/api/device/layout", layout))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let invalid = app
        .clone()
        .oneshot(call("PUT", "/api/device/layout", r#"{"unknown":true}"#))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    let response = app
        .clone()
        .oneshot(call("GET", "/api/device/workspaces/w/agent", ""))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["agent"], Value::Null);
    assert_eq!(body["models"].as_array().unwrap().len(), 3);
    let missing = app
        .clone()
        .oneshot(call(
            "POST",
            "/api/device/workspaces/w/agent/messages",
            r#"{"text":"안녕"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let unavailable = app
        .oneshot(call(
            "POST",
            "/api/device/workspaces/w/agent",
            r#"{"workspace_name":"작업","model_preset":"claude-opus"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(unavailable.status(), StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn workspace_layout_is_reported_with_ordered_windows_and_folders() {
    let state = AppState::in_memory("secret");
    let (device_id, token) = make_device(&state);
    let layout = json!({"workspaces":[{"id":"w","name":"작업","created_at":"t","updated_at":"t"}],"desktops":[{"id":"d","workspace_id":"w","name":"화면","position":0,"created_at":"t","updated_at":"t"}],"windows":[{"id":"one","desktop_id":"d","app_id":"missing","app_version":1,"rect":{"x":0,"y":0,"width":10,"height":10},"z":1,"state":{},"created_at":"t","updated_at":"t"},{"id":"two","desktop_id":"d","app_id":"missing","app_version":1,"rect":{"x":0,"y":0,"width":10,"height":10},"z":2,"state":{"file":"a.md"},"created_at":"t","updated_at":"t"}],"folders":[{"window_id":"two","permission":"docs","root_name":"문서"}],"active_workspace_id":"w","active_desktop_ids":{"w":"d"},"data_errors":[{"window_id":"two","pointer":"/sources/cards","message":"원천 실패"}]});
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: serde_json::from_value(layout["workspaces"].clone()).unwrap(),
                desktops: serde_json::from_value(layout["desktops"].clone()).unwrap(),
                windows: serde_json::from_value(layout["windows"].clone()).unwrap(),
                ..Default::default()
            },
        )
        .unwrap();
    let req = Request::builder()
        .method("PUT")
        .uri("/api/device/layout")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(layout.to_string()))
        .unwrap();
    assert_eq!(
        router(state.clone()).oneshot(req).await.unwrap().status(),
        StatusCode::OK
    );
    let workspace = state.get_workspace("w").unwrap().unwrap();
    assert_eq!(workspace["device"]["id"], device_id);
    assert_eq!(workspace["active"], true);
    assert_eq!(workspace["desktops"][0]["windows"][0]["window_id"], "two");
    assert_eq!(
        workspace["desktops"][0]["windows"][0]["folders"]["docs"],
        "문서"
    );
    assert_eq!(
        workspace["desktops"][0]["windows"][0]["data_errors"][0]["pointer"],
        "/sources/cards"
    );
    assert_eq!(
        workspace["desktops"][0]["windows"][0]["data_errors"][0]["message"],
        "원천 실패"
    );
    let list = state.list_workspaces().unwrap();
    assert_eq!(list[0]["window_count"], 2);
}

#[path = "device_sync_tests.rs"]
mod device_sync_tests;

#[path = "relay_integration_tests.rs"]
mod relay_integration_tests;
