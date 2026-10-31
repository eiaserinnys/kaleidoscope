use super::*;
use axum::body::{to_bytes, Body};
use kaleidoscope_contract::Workspace;
use tower::ServiceExt;

const EDITOR: &str = include_str!("fixtures/editor-app.json");
const BROWSER: &str = include_str!("fixtures/browser-app.json");
const LEGACY_APP: &str = include_str!("fixtures/simple-app.json");

#[test]
fn builtin_apps_are_listed_and_upload_is_rejected() {
    let state = AppState::in_memory("secret");
    let apps = state.list_apps().unwrap();
    for id in ["agent", "explorer", "md-editor", "md-viewer", "web-browser"] {
        assert!(apps.iter().any(|app| app.id == id && app.builtin));
    }
    assert_eq!(apps.len(), 7);
    assert!(state.publish_app(EDITOR, "agent", false, None).is_err());
}

#[tokio::test]
async fn device_upload_rejects_builtin_id() {
    let state = AppState::in_memory("secret");
    let (_, token) = make_device(&state);
    let body = serde_json::to_string(&registry::DeviceUploadRequest {
        definition_json: EDITOR.into(),
    })
    .unwrap();
    let mut request = request("POST", "/api/device/apps", Some(&token), Body::from(body));
    request
        .headers_mut()
        .insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    let response = router(state).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn migration_v8_adds_soft_delete_without_changing_existing_rows() {
    let state = AppState::in_memory("secret");
    let (app, _) = state
        .publish_app(&test_definition(EDITOR), "agent", false, None)
        .unwrap();
    let db = state.lock_db().unwrap();
    db.execute_batch("ALTER TABLE apps DROP COLUMN deleted_at; PRAGMA user_version=8;")
        .unwrap();
    migrate(&db).unwrap();
    let row: (String, u32, Option<String>) = db
        .query_row(
            "SELECT id,current_version,deleted_at FROM apps WHERE id=?1",
            [&app.app.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(row, (app.app.id, 1, None));
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        11
    );
}

#[test]
fn app_upload_versions_and_deduplicates_identical_definitions() {
    let state = AppState::in_memory("secret");
    let (first, unchanged) = state
        .publish_app(&test_definition(EDITOR), "agent", false, None)
        .unwrap();
    assert_eq!(first.version.version, 1);
    assert!(!unchanged);
    let (same, unchanged) = state
        .publish_app(&test_definition(EDITOR), "agent", false, None)
        .unwrap();
    assert_eq!(same.version.version, 1);
    assert!(unchanged);
    let modified = test_definition(EDITOR).replace("시험 편집기", "편집기 변경");
    assert_ne!(modified, test_definition(EDITOR));
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
    let outside = test_definition(EDITOR).replace(
        r#""path": { "state": "current_file" }"#,
        r#""path": "../secret.md""#,
    );
    assert_ne!(outside, test_definition(EDITOR));
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
async fn mcp_http_uses_workspace_header_defaults_and_requires_explicit_delete_id() {
    let state = AppState::in_memory("secret");
    let make_workspace = |id: &str| Workspace {
        id: id.into(),
        name: format!("작업 {id}"),
        created_at: "now".into(),
        updated_at: "now".into(),
    };
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![make_workspace("w1"), make_workspace("w2")],
                ..Default::default()
            },
        )
        .unwrap();
    let (device_id, device_token) = make_device(&state);

    let mut storage_app: Value = serde_json::from_str(&test_definition(LEGACY_APP)).unwrap();
    storage_app["requires"]["blocks"] = json!(6);
    storage_app["requires"]["modules"]["storage"] = json!(1);
    storage_app["storage"] = json!({"entries":[{
        "id":"workspace_value",
        "key":"workspaces/{workspace_id}/value",
        "kind":"json",
        "schema":{"type":"string"},
        "default":"default",
        "label":"Workspace value",
        "presentation":"hidden"
    }]});
    let app_id = storage_app["id"].as_str().unwrap().to_string();
    state
        .publish_app(&storage_app.to_string(), "test", false, None)
        .unwrap();

    let app = router(state.clone());
    let session = initialize_mcp_session(&app, &device_token, Some("w1"))
        .await
        .unwrap();
    let default_workspace = mcp_call(
        &app,
        &device_token,
        Some("w1"),
        &session,
        "get_workspace",
        json!({}),
    )
    .await;
    assert_eq!(default_workspace["result"]["isError"], false);
    assert_eq!(mcp_tool_json(&default_workspace)["workspace_id"], "w1");

    let explicit_workspace = mcp_call(
        &app,
        &device_token,
        Some("w1"),
        &session,
        "get_workspace",
        json!({"workspace_id":"w2"}),
    )
    .await;
    assert_eq!(mcp_tool_json(&explicit_workspace)["workspace_id"], "w2");

    let listed = mcp_call(
        &app,
        &device_token,
        Some("w1"),
        &session,
        "list_app_storage",
        json!({"app_id":app_id}),
    )
    .await;
    assert_eq!(
        mcp_tool_json(&listed)["items"][0]["key"],
        "workspaces/w1/value"
    );
    let explicit_storage = mcp_call(
        &app,
        &device_token,
        Some("w1"),
        &session,
        "read_app_storage",
        json!({"app_id":app_id,"entry_id":"workspace_value","workspace_id":"w2"}),
    )
    .await;
    let explicit_read = mcp_tool_json(&explicit_storage);
    assert_eq!(explicit_read["exists"], false);
    assert_eq!(explicit_read["content"], "default");

    let missing_delete_id = mcp_call(
        &app,
        &device_token,
        Some("w1"),
        &session,
        "delete_workspace",
        json!({}),
    )
    .await;
    assert_eq!(missing_delete_id["result"]["isError"], true);
    assert!(state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id='w1')",
            [],
            |row| row.get::<_, bool>(0)
        )
        .unwrap());
    assert_eq!(
        state.authenticate_device(&device_token).unwrap().unwrap().0,
        device_id
    );
}

#[tokio::test]
async fn mcp_http_authentication_keeps_global_token_and_rejects_invalid_foreign_and_revoked_tokens()
{
    let state = AppState::in_memory("secret");
    let (device_id, device_token) = make_device(&state);
    let foreign_account = Uuid::new_v4().to_string();
    let foreign_token = "valid-device-token-for-another-account";
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES(?1,'Other','now')",
            [&foreign_account],
        )
        .unwrap();
        db.execute(
            "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('foreign','Other',?1,?2,'now')",
            params![foreign_account, sha256_hex(foreign_token.as_bytes())],
        )
        .unwrap();
        db.execute(
            "INSERT INTO workspaces(id,account_id,data,created_at) VALUES('foreign-workspace',?1,?2,'now')",
            params![
                foreign_account,
                serde_json::to_string(&Workspace {
                    id: "foreign-workspace".into(),
                    name: "Other workspace".into(),
                    created_at: "now".into(),
                    updated_at: "now".into(),
                })
                .unwrap()
            ],
        )
        .unwrap();
    }
    let app = router(state.clone());

    let global_session = initialize_mcp_session(&app, "secret", None).await.unwrap();
    let global_list = mcp_call(
        &app,
        "secret",
        None,
        &global_session,
        "list_workspaces",
        json!({}),
    )
    .await;
    assert_eq!(global_list["result"]["isError"], false);

    let wrong = mcp_initialize(&app, "wrong-token", None).await;
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    let foreign_device = mcp_initialize(&app, foreign_token, None).await;
    assert_eq!(foreign_device.status(), StatusCode::FORBIDDEN);
    let foreign_workspace = mcp_initialize(&app, &device_token, Some("foreign-workspace")).await;
    assert_eq!(foreign_workspace.status(), StatusCode::FORBIDDEN);

    state.revoke_device(&device_id).unwrap();
    let revoked = mcp_initialize(&app, &device_token, None).await;
    assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn mcp_http_open_uses_origin_device_and_global_token_uses_last_active_device() {
    use kaleidoscope_contract::Supported;

    let state = AppState::in_memory("secret");
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![Workspace {
                    id: "w".into(),
                    name: "Work".into(),
                    created_at: "now".into(),
                    updated_at: "now".into(),
                }],
                ..Default::default()
            },
        )
        .unwrap();
    let (origin_id, origin_token) = make_device(&state);
    let (recent_id, _) = make_device(&state);
    let (offline_id, offline_token) = make_device(&state);
    let (legacy_id, _) = make_device(&state);
    state
        .lock_db()
        .unwrap()
        .execute(
            "UPDATE devices SET name=CASE id WHEN ?1 THEN 'Origin PC' WHEN ?2 THEN 'Recent PC' WHEN ?3 THEN 'Offline PC' WHEN ?4 THEN 'Legacy PC' END WHERE id IN (?1,?2,?3,?4)",
            params![origin_id, recent_id, offline_id, legacy_id],
        )
        .unwrap();
    let _origin_stream = state
        .stream_with_registry(
            origin_id.clone(),
            Some(Supported::current()),
            registry::LAYOUT_SYNC_REGISTRY_VERSION,
        )
        .unwrap();
    let _recent_stream = state
        .stream_with_registry(
            recent_id.clone(),
            Some(Supported::current()),
            registry::LAYOUT_SYNC_REGISTRY_VERSION,
        )
        .unwrap();
    let _legacy_stream = state
        .stream_with_registry(
            legacy_id.clone(),
            None,
            registry::LAYOUT_SYNC_REGISTRY_VERSION - 1,
        )
        .unwrap();
    state
        .save_layout(
            &legacy_id,
            &kaleidoscope_contract::registry::DeviceLayout {
                workspaces: vec![Workspace {
                    id: "w".into(),
                    name: "Work".into(),
                    created_at: "now".into(),
                    updated_at: "now".into(),
                }],
                ..Default::default()
            },
        )
        .unwrap();
    state
        .lock_db()
        .unwrap()
        .execute(
            "UPDATE devices SET last_active_at=CASE id WHEN ?1 THEN '2026-10-29T00:00:00Z' WHEN ?2 THEN '2026-10-30T00:00:00Z' END WHERE id IN (?1,?2)",
            params![origin_id, recent_id],
        )
        .unwrap();

    let app = router(state.clone());
    let upload_session = initialize_mcp_session(&app, &origin_token, Some("w"))
        .await
        .unwrap();
    let definition: Value = serde_json::from_str(&test_definition(LEGACY_APP)).unwrap();
    let app_id = definition["id"].as_str().unwrap().to_string();
    let mut events = state.0.events.subscribe();
    let uploaded = mcp_call(
        &app,
        &origin_token,
        Some("w"),
        &upload_session,
        "upload_app",
        json!({"definition":definition,"open":true}),
    )
    .await;
    let uploaded = mcp_tool_json(&uploaded);
    assert_eq!(uploaded["open_sent_to"], 1);
    assert_eq!(uploaded["open_target"], "Origin PC");
    let published = events.try_recv().unwrap();
    assert!(matches!(
        state.event_for_broadcast(&origin_id, published.clone()),
        Some(DeviceEvent::AppPublished { open: true, .. })
    ));
    assert!(matches!(
        state.event_for_broadcast(&recent_id, published.clone()),
        Some(DeviceEvent::AppPublished { open: false, .. })
    ));
    assert!(matches!(
        state.event_for_broadcast(&legacy_id, published),
        Some(DeviceEvent::AppPublished { open: false, .. })
    ));

    let origin_open = mcp_call(
        &app,
        &origin_token,
        Some("w"),
        &upload_session,
        "open_app",
        json!({"app_id":app_id}),
    )
    .await;
    let origin_open = mcp_tool_json(&origin_open);
    assert_eq!(origin_open["open_sent_to"], 1);
    assert_eq!(origin_open["open_target"], "Origin PC");
    let origin_open_event = events.try_recv().unwrap();
    assert!(matches!(
        state.event_for_broadcast(&origin_id, origin_open_event.clone()),
        Some(DeviceEvent::AppOpen { app_id: id, .. }) if id == app_id
    ));
    assert!(state
        .event_for_broadcast(&recent_id, origin_open_event.clone())
        .is_none());
    assert!(state
        .event_for_broadcast(&legacy_id, origin_open_event)
        .is_none());

    let offline_session = initialize_mcp_session(&app, &offline_token, Some("w"))
        .await
        .unwrap();
    let offline_open = mcp_call(
        &app,
        &offline_token,
        Some("w"),
        &offline_session,
        "open_app",
        json!({"app_id":app_id}),
    )
    .await;
    let offline_open = mcp_tool_json(&offline_open);
    assert_eq!(offline_open["open_sent_to"], 0);
    assert_eq!(offline_open["open_reason"], "origin_device_unavailable");
    assert!(events.try_recv().is_err());

    let global_session = initialize_mcp_session(&app, "secret", Some("w"))
        .await
        .unwrap();
    let global_open = mcp_call(
        &app,
        "secret",
        Some("w"),
        &global_session,
        "open_app",
        json!({"app_id":app_id}),
    )
    .await;
    let global_open = mcp_tool_json(&global_open);
    assert_eq!(global_open["open_sent_to"], 2);
    assert_eq!(global_open["open_target"], "Recent PC");
    let global_open_event = events.try_recv().unwrap();
    assert!(matches!(
        state.event_for_broadcast(&recent_id, global_open_event.clone()),
        Some(DeviceEvent::AppOpen { app_id: id, .. }) if id == app_id
    ));
    assert!(matches!(
        state.event_for_broadcast(&legacy_id, global_open_event),
        Some(DeviceEvent::AppOpen { app_id: id, .. }) if id == app_id
    ));
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
    state
        .publish_app(&test_definition(BROWSER), "agent", false, None)
        .unwrap();
    let mut settings_definition: Value =
        serde_json::from_str(include_str!("../../../examples/workspace-pas-v2.json")).unwrap();
    settings_definition["id"] = json!("workspace-pas-settings");
    settings_definition["name"] = json!("작업 PAS 설정 선택지 시험");
    settings_definition["requires"]["modules"]["storage"] = json!(2);
    settings_definition["storage"]["entries"][0]["description"] = json!("프로필 설명");
    settings_definition["storage"]["entries"][0]["choices"] = json!(["default", "other"]);
    state
        .publish_app(&settings_definition.to_string(), "agent", false, None)
        .unwrap();
    let (old_id, old_token) = make_device(&state);
    let (_, storage_one_token) = make_device(&state);
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

    let mut storage_one = Supported::current();
    storage_one.modules.insert("storage".into(), 1);
    let storage_one_request = Request::builder()
        .method("GET")
        .uri("/api/device/events")
        .header(header::AUTHORIZATION, format!("Bearer {storage_one_token}"))
        .header(
            SUPPORTED_HEADER,
            serde_json::to_string(&storage_one).unwrap(),
        )
        .body(Body::empty())
        .unwrap();
    let storage_one_response = router(state.clone())
        .oneshot(storage_one_request)
        .await
        .unwrap();
    let mut storage_one_stream = storage_one_response.into_body().into_data_stream();
    let storage_one_snapshot = next_device_event(&mut storage_one_stream).await;
    let storage_one_ids: Vec<_> =
        serde_json::from_value::<Vec<RegistryApp>>(storage_one_snapshot["apps"].clone())
            .unwrap()
            .into_iter()
            .map(|app| app.app.id)
            .collect();
    assert!(!storage_one_ids.contains(&"workspace-pas-settings".to_string()));

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
    assert!(current_ids.contains(&"workspace-pas-settings".to_string()));
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

    let (browser, _) = state
        .publish_app(&test_definition(BROWSER), "agent", false, None)
        .unwrap();
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

async fn mcp_initialize(
    app: &Router,
    token: &str,
    workspace_id: Option<&str>,
) -> axum::response::Response {
    let mut request = request(
        "POST",
        "/mcp",
        Some(token),
        Body::from(
            json!({
                "jsonrpc":"2.0",
                "id":1,
                "method":"initialize",
                "params":{
                    "protocolVersion":"2025-03-26",
                    "capabilities":{},
                    "clientInfo":{"name":"test","version":"1"}
                }
            })
            .to_string(),
        ),
    );
    request
        .headers_mut()
        .insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    request
        .headers_mut()
        .insert(header::HOST, "localhost".parse().unwrap());
    request.headers_mut().insert(
        header::ACCEPT,
        "application/json, text/event-stream".parse().unwrap(),
    );
    if let Some(workspace_id) = workspace_id {
        request
            .headers_mut()
            .insert(registry::WORKSPACE_HEADER, workspace_id.parse().unwrap());
    }
    app.clone().oneshot(request).await.unwrap()
}

async fn initialize_mcp_session(
    app: &Router,
    token: &str,
    workspace_id: Option<&str>,
) -> Option<String> {
    let response = mcp_initialize(app, token, workspace_id).await;
    let status = response.status();
    let session_id = response
        .headers()
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "MCP initialize body: {}",
        String::from_utf8_lossy(&body)
    );
    let session_id = session_id?;

    let mut notification = request(
        "POST",
        "/mcp",
        Some(token),
        Body::from(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),
    );
    notification
        .headers_mut()
        .insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    notification
        .headers_mut()
        .insert(header::HOST, "localhost".parse().unwrap());
    notification.headers_mut().insert(
        header::ACCEPT,
        "application/json, text/event-stream".parse().unwrap(),
    );
    notification
        .headers_mut()
        .insert("mcp-session-id", session_id.parse().unwrap());
    notification
        .headers_mut()
        .insert("mcp-protocol-version", "2025-03-26".parse().unwrap());
    if let Some(workspace_id) = workspace_id {
        notification
            .headers_mut()
            .insert(registry::WORKSPACE_HEADER, workspace_id.parse().unwrap());
    }
    let initialized = app.clone().oneshot(notification).await.unwrap();
    assert_eq!(initialized.status(), StatusCode::ACCEPTED);
    Some(session_id)
}

async fn mcp_call(
    app: &Router,
    token: &str,
    workspace_id: Option<&str>,
    session_id: &str,
    name: &str,
    arguments: Value,
) -> Value {
    let mut request = request(
        "POST",
        "/mcp",
        Some(token),
        Body::from(
            json!({
                "jsonrpc":"2.0",
                "id":2,
                "method":"tools/call",
                "params":{"name":name,"arguments":arguments}
            })
            .to_string(),
        ),
    );
    request
        .headers_mut()
        .insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    request
        .headers_mut()
        .insert(header::HOST, "localhost".parse().unwrap());
    request.headers_mut().insert(
        header::ACCEPT,
        "application/json, text/event-stream".parse().unwrap(),
    );
    request
        .headers_mut()
        .insert("mcp-session-id", session_id.parse().unwrap());
    request
        .headers_mut()
        .insert("mcp-protocol-version", "2025-03-26".parse().unwrap());
    if let Some(workspace_id) = workspace_id {
        request
            .headers_mut()
            .insert(registry::WORKSPACE_HEADER, workspace_id.parse().unwrap());
    }
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let body = String::from_utf8(body.to_vec()).unwrap();
    let json = body
        .lines()
        .find_map(|line| line.strip_prefix("data: ").filter(|data| !data.is_empty()))
        .unwrap_or(&body);
    serde_json::from_str(json).unwrap_or_else(|error| panic!("MCP call body {body:?}: {error}"))
}

fn mcp_tool_json(response: &Value) -> Value {
    let text = response["result"]["content"][0]["text"]
        .as_str()
        .expect("tool response has a text block");
    serde_json::from_str(text).expect("tool text contains JSON")
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
    db.execute_batch("CREATE TABLE apps (id TEXT PRIMARY KEY,name TEXT NOT NULL,current_version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE app_versions(app_id TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,PRIMARY KEY(app_id,version)); CREATE TABLE devices (id TEXT PRIMARY KEY,name TEXT NOT NULL,token_sha256 TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,last_seen_at TEXT,revoked_at TEXT); INSERT INTO devices(id,name,token_sha256,created_at) VALUES('d','PC','hash','now'); PRAGMA user_version=1;").unwrap();
    migrate(&db).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 11);
    assert_eq!(
        db.query_row("SELECT count(*) FROM devices", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='agents'",
            [],
            |r| r.get::<_, i64>(0)
        )
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
fn migration_v7_removes_legacy_tables_and_preserves_other_data() {
    let state = AppState::in_memory("secret");
    state
        .publish_app(&test_definition(EDITOR), "agent", false, None)
        .unwrap();
    let db = state.lock_db().unwrap();
    db.execute_batch(
        "ALTER TABLE apps DROP COLUMN deleted_at; CREATE TABLE agents(workspace_id TEXT PRIMARY KEY);
        CREATE TABLE agent_items(id INTEGER PRIMARY KEY, text TEXT);
        INSERT INTO agents VALUES('w'); INSERT INTO agent_items VALUES(1,'기록');
        PRAGMA user_version=7;",
    )
    .unwrap();
    migrate(&db).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 11);
    let old_tables: i64 = db.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('agents','agent_items')", [], |row| row.get(0)).unwrap();
    assert_eq!(old_tables, 0);
    let apps: i64 = db
        .query_row(
            "SELECT count(*) FROM apps WHERE id='test-md-editor'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(apps, 1);
}

#[tokio::test]
async fn layout_endpoint_validates_requests() {
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
