use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use tower::ServiceExt;

fn insert_receiver_fixture(state: &AppState, id: &str, receiver: &str) {
    let mut definition = json!({
        "id": id, "name": id,
        "requires": {"blocks": 1, "modules": {}},
        "permissions": [], "state": {},
        "ui": {"type": "text", "value": "시험"}
    });
    match receiver {
        "agent" => {
            definition["agent"] = json!({
                "protocol": "conversation-v1", "permission": "service", "base_path": "/api",
                "namespace": "test", "profile": "test", "collection": "test", "model_order": [],
                "selected_model": "test", "title_template": "test",
                "initial_instruction_template": "test", "instructions_template": "test",
                "thread_entry": "thread"
            })
        }
        "client" => {
            definition["client"] = json!({
                "runtime": "javascript", "entry": {"id": "script", "version": 1},
                "capabilities": ["receive_message"]
            })
        }
        "none" => {}
        _ => unreachable!(),
    }
    let definition: AppDefinition = serde_json::from_value(definition).unwrap();
    let db = state.lock_db().unwrap();
    db.execute("INSERT INTO apps(id,name,current_version,created_at,updated_at) VALUES(?1,?1,1,'now','now')", [id]).unwrap();
    db.execute("INSERT INTO app_versions(app_id,version,definition,created_at,created_by) VALUES(?1,1,?2,'now','test')", params![id, serde_json::to_string(&definition).unwrap()]).unwrap();
}

fn device(state: &AppState, id: &str, account: &str) -> String {
    let token = format!("token-{id}");
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,?2,?3,'now')",
        params![id, account, sha256_hex(token.as_bytes())],
    ).unwrap();
    token
}
async fn request(
    state: &AppState,
    token: &str,
    method: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = router(state.clone()).oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn preferences_are_account_scoped_and_answers_preserve_or_change_default() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES('other','other','now')",
            [],
        )
        .unwrap();
    let first = device(&state, "first", &account);
    let other = device(&state, "other", "other");
    let path = "/api/device/preferences";
    let (status, empty) = request(&state, &first, "GET", path, json!(null)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        empty,
        json!({"revision":0,"default_message_app_id":null,"asked_message_app_ids":[]})
    );
    let (status, selected) = request(
        &state,
        &first,
        "POST",
        "/api/device/preferences/default",
        json!({"app_id":"agent"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(selected["revision"], 1);
    let (_, denied) = request(
        &state,
        &first,
        "POST",
        "/api/device/preferences/answer",
        json!({"app_id":"explorer","use_as_default":false}),
    )
    .await;
    assert_eq!(denied["default_message_app_id"], "agent");
    assert_eq!(denied["asked_message_app_ids"], json!(["explorer"]));
    let (_, accepted) = request(
        &state,
        &first,
        "POST",
        "/api/device/preferences/answer",
        json!({"app_id":"explorer","use_as_default":true}),
    )
    .await;
    assert_eq!(accepted["revision"], 3);
    assert_eq!(accepted["default_message_app_id"], "explorer");
    assert_eq!(accepted["asked_message_app_ids"], json!(["explorer"]));
    let (_, isolated) = request(&state, &other, "GET", path, json!(null)).await;
    assert_eq!(isolated, empty);
    let (status, error) = request(
        &state,
        &first,
        "POST",
        "/api/device/preferences/default",
        json!({"app_id":"missing"}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error["id"], "SERVER_PREFERENCES_APP_NOT_FOUND");
}

async fn events(state: &AppState, token: &str, version: u32) -> axum::body::BodyDataStream {
    let req = Request::builder()
        .uri("/api/device/events")
        .header("authorization", format!("Bearer {token}"))
        .header(registry::REGISTRY_HEADER, version.to_string())
        .body(Body::empty())
        .unwrap();
    router(state.clone())
        .oneshot(req)
        .await
        .unwrap()
        .into_body()
        .into_data_stream()
}
async fn next_event(stream: &mut axum::body::BodyDataStream) -> Value {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let bytes = stream.next().await.unwrap().unwrap();
            let text = std::str::from_utf8(&bytes).unwrap();
            if let Some(line) = text.lines().find_map(|line| line.strip_prefix("data: ")) {
                return serde_json::from_str(line).unwrap();
            }
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn preferences_broadcast_to_two_devices_and_reconnect_snapshot() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let first = device(&state, "first", &account);
    let second = device(&state, "second", &account);
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES('other','other','now')",
            [],
        )
        .unwrap();
    let other = device(&state, "other", "other");
    let old = device(&state, "old", &account);
    let mut a = events(&state, &first, registry::PREFERENCES_REGISTRY_VERSION).await;
    let mut b = events(&state, &second, registry::PREFERENCES_REGISTRY_VERSION).await;
    let mut outsider = events(&state, &other, registry::PREFERENCES_REGISTRY_VERSION).await;
    let mut legacy = events(&state, &old, registry::PREFERENCES_REGISTRY_VERSION - 1).await;
    for stream in [&mut a, &mut b] {
        assert_eq!(next_event(stream).await["event"], "apps.snapshot");
        assert_eq!(next_event(stream).await["event"], "preferences.snapshot");
        assert_eq!(next_event(stream).await["event"], "layout.snapshot");
    }
    assert_eq!(next_event(&mut outsider).await["event"], "apps.snapshot");
    assert_eq!(
        next_event(&mut outsider).await["event"],
        "preferences.snapshot"
    );
    assert_eq!(next_event(&mut outsider).await["event"], "layout.snapshot");
    assert_eq!(next_event(&mut legacy).await["event"], "apps.snapshot");
    assert_eq!(next_event(&mut legacy).await["event"], "layout.snapshot");
    let (_, value) = request(
        &state,
        &first,
        "POST",
        "/api/device/preferences/default",
        json!({"app_id":"agent"}),
    )
    .await;
    for stream in [&mut a, &mut b] {
        let changed = next_event(stream).await;
        assert_eq!(changed["event"], "preferences.changed");
        assert_eq!(changed["preferences"], value);
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(200), next_event(&mut outsider))
            .await
            .is_err()
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(200), next_event(&mut legacy))
            .await
            .is_err()
    );
    drop(b);
    let mut b = events(&state, &second, registry::PREFERENCES_REGISTRY_VERSION).await;
    assert_eq!(next_event(&mut b).await["event"], "apps.snapshot");
    let snapshot = next_event(&mut b).await;
    assert_eq!(snapshot["event"], "preferences.snapshot");
    assert_eq!(snapshot["preferences"], value);
}

#[tokio::test]
async fn preference_rejects_unreceivable_deleted_and_invalid_requests() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let token = device(&state, "first", &account);
    let id = "receiver-none";
    insert_receiver_fixture(&state, id, "none");
    let (status, error) = request(
        &state,
        &token,
        "POST",
        "/api/device/preferences/answer",
        json!({"app_id":id,"use_as_default":false}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error["id"], "SERVER_PREFERENCES_APP_NOT_RECEIVABLE");
    state
        .lock_db()
        .unwrap()
        .execute("UPDATE apps SET deleted_at='now' WHERE id=?1", [id])
        .unwrap();
    let (status, error) = request(
        &state,
        &token,
        "POST",
        "/api/device/preferences/answer",
        json!({"app_id":id,"use_as_default":false}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error["id"], "SERVER_PREFERENCES_APP_NOT_FOUND");
    let (status, error) = request(
        &state,
        &token,
        "POST",
        "/api/device/preferences/default",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error["id"], "SERVER_PREFERENCES_BODY_INVALID");
}

#[tokio::test]
async fn current_registered_receiver_is_selectable() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let token = device(&state, "first", &account);
    for (id, receiver) in [("receiver-client", "client"), ("receiver-agent", "agent")] {
        insert_receiver_fixture(&state, id, receiver);
        let (status, value) = request(
            &state,
            &token,
            "POST",
            "/api/device/preferences/default",
            json!({"app_id":id}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["default_message_app_id"], id);
    }
}

#[tokio::test]
async fn null_default_restores_builtin_fallback() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let token = device(&state, "first", &account);
    let (_, initial) = request(
        &state,
        &token,
        "POST",
        "/api/device/preferences/default",
        json!({"app_id":"agent"}),
    )
    .await;
    assert_eq!(initial["default_message_app_id"], "agent");
    let (status, cleared) = request(
        &state,
        &token,
        "POST",
        "/api/device/preferences/default",
        json!({"app_id":null}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cleared["default_message_app_id"], Value::Null);
    assert_eq!(cleared["revision"], 2);
}

#[test]
fn preferences_migration_from_v14_keeps_account_data() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let db = state.lock_db().unwrap();
    db.execute_batch("DROP TABLE account_preferences; ALTER TABLE apps DROP COLUMN installation_json; PRAGMA user_version=14;")
        .unwrap();
    migrate(&db).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, storage::STORAGE_SCOPE_SCHEMA_VERSION);
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?1)",
            [account],
            |r| r.get(0),
        )
        .unwrap();
    assert!(exists);
    assert_eq!(
        db.query_row("SELECT count(*) FROM account_preferences", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
