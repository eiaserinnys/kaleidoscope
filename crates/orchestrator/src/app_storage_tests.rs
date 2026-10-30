use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use kaleidoscope_contract::{Supported, Workspace};
use rmcp::handler::server::wrapper::Parameters;
use serde_json::Value;
use tower::ServiceExt;

fn definition() -> String {
    let mut value: Value = serde_json::from_str(include_str!("fixtures/simple-app.json")).unwrap();
    value["id"] = json!("storage-test");
    value["name"] = json!("Storage Test");
    value["requires"]["blocks"] = json!(6);
    value["requires"]["modules"]["storage"] = json!(1);
    value["storage"] = json!({"entries":[
        {"id":"title","key":"settings/title","kind":"json","schema":{"type":"string","minLength":1},"default":"default","label":"Title","presentation":"settings","agent_context":true},
        {"id":"note","key":"notes/role","kind":"md","default":"# default","label":"Note","presentation":"settings"},
        {"id":"fixed_workspace_note","key":"workspaces/workspace-a/note","kind":"md","default":"# fixed","label":"Fixed workspace note","presentation":"hidden"},
        {"id":"workspace_value","key":"workspaces/{workspace_id}/value","kind":"json","schema":{"type":"string","minLength":1},"default":"unset","label":"Workspace value","presentation":"hidden"}
    ]});
    serde_json::to_string(&value).unwrap()
}

fn add_device(state: &AppState, id: &str, account_id: &str, token: &str) {
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,?2,?3,'now')",
        params![id,account_id,sha256_hex(token.as_bytes())],
    ).unwrap();
}

#[test]
fn storage_migration_from_version_nine_preserves_buckets_and_items() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    state
        .publish_app(&definition(), "test", false, None)
        .unwrap();
    let written = state
        .write_app_storage(&account, "storage-test", "title", None, json!("kept"), None)
        .unwrap();
    let db = state.lock_db().unwrap();
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        10
    );
    let fresh_violations = db
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query_map([], |_| Ok(()))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(fresh_violations.is_empty());
    db.execute_batch(
        "PRAGMA foreign_keys=OFF;
         CREATE TEMP TABLE saved_app_storage_buckets AS
             SELECT id,account_id,app_id FROM app_storage_buckets;
         DROP TABLE app_storage_buckets;
         CREATE TABLE app_storage_buckets (
             id TEXT PRIMARY KEY,
             account_id TEXT NOT NULL REFERENCES accounts(id),
             app_id TEXT NOT NULL REFERENCES apps(id),
             UNIQUE(account_id,app_id)
         );
         INSERT INTO app_storage_buckets(id,account_id,app_id)
             SELECT id,account_id,app_id FROM saved_app_storage_buckets;
         DROP TABLE saved_app_storage_buckets;
         PRAGMA user_version=9;
         PRAGMA foreign_keys=ON;",
    )
    .unwrap();
    let old_bucket_targets = db
        .prepare("PRAGMA foreign_key_list(app_storage_buckets)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(2))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(old_bucket_targets.contains(&"apps".to_string()));

    migrate(&db).unwrap();

    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        10
    );
    let stored: (String, String) = db
        .query_row(
            "SELECT i.content,i.revision FROM app_storage_items i JOIN app_storage_buckets b ON b.id=i.bucket_id WHERE b.account_id=?1 AND b.app_id='storage-test' AND i.key='settings/title'",
            [&account],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(stored.0, "\"kept\"");
    assert_eq!(stored.1, written.0.revision);
    let violations = db
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query_map([], |_| Ok(()))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(violations.is_empty());
    let bucket_fks = db
        .prepare("PRAGMA foreign_key_list(app_storage_buckets)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(2))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(bucket_fks.contains(&"accounts".to_string()));
    assert!(!bucket_fks.contains(&"apps".to_string()));
    let unique_index_count: i64 = db
        .query_row(
            "SELECT count(*) FROM pragma_index_list('app_storage_buckets') WHERE \"unique\"=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(unique_index_count, 2);
    let item_foreign_keys = db
        .prepare("PRAGMA foreign_key_list(app_storage_items)")
        .unwrap()
        .query_map([], |row| {
            Ok((row.get::<_, String>(2)?, row.get::<_, String>(6)?))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(item_foreign_keys.contains(&("app_storage_buckets".to_string(), "CASCADE".to_string())));
}

#[test]
fn builtin_storage_definition_supports_list_read_write_reset_cycle() {
    use kaleidoscope_contract::builtin::BuiltinApp;

    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let fake_builtins = [BuiltinApp {
        id: "agent",
        version: 1,
        updated_at: "2026-10-30T00:00:00Z",
        definition_json: include_str!("../../../examples/agent.json"),
    }];

    let listed = state
        .list_app_storage_with_builtins(&account, "agent", None, &fake_builtins)
        .unwrap();
    assert_eq!(listed.items.len(), 1);
    assert!(!listed.items[0].exists);
    let initial = state
        .read_app_storage_with_builtins(&account, "agent", "agents", None, &fake_builtins)
        .unwrap();
    assert!(!initial.exists);
    assert!(initial.revision.is_none());
    assert_eq!(initial.content.as_array().unwrap().len(), 4);

    let override_value =
        json!([{ "id":"codex", "name":"Codex", "command":"codex", "args":[], "env":{} }]);
    let (written, _, _) = state
        .write_app_storage_with_builtins(
            &account,
            "agent",
            "agents",
            None,
            override_value.clone(),
            None,
            &fake_builtins,
        )
        .unwrap();
    let override_read = state
        .read_app_storage_with_builtins(&account, "agent", "agents", None, &fake_builtins)
        .unwrap();
    assert!(override_read.exists);
    assert_eq!(override_read.content, override_value);
    assert_eq!(
        override_read.revision.as_deref(),
        Some(written.revision.as_str())
    );

    let stale = state.write_app_storage_with_builtins(
        &account,
        "agent",
        "agents",
        None,
        json!([]),
        None,
        &fake_builtins,
    );
    assert_eq!(stale.unwrap_err().code, ErrorCode::Conflict);
    let (reset, _, _) = state
        .reset_app_storage_with_builtins(
            &account,
            "agent",
            "agents",
            None,
            Some(written.revision),
            &fake_builtins,
        )
        .unwrap();
    assert!(reset.revision.is_none());
    let restored = state
        .read_app_storage_with_builtins(&account, "agent", "agents", None, &fake_builtins)
        .unwrap();
    assert!(!restored.exists);
    assert_eq!(restored.content, initial.content);

    assert!(state
        .list_app_storage_with_builtins(&account, "not-builtin", None, &fake_builtins)
        .is_err());
    assert!(state
        .read_app_storage_with_builtins(&account, "agent", "missing", None, &fake_builtins)
        .is_err());
}

async fn request(
    state: &AppState,
    token: &str,
    method: &str,
    uri: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = router(state.clone())
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn device_storage_http_reads_defaults_cas_writes_and_resets() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    state
        .publish_app(&definition(), "test", false, None)
        .unwrap();

    let (status, default) = request(
        &state,
        "token-a",
        "GET",
        "/api/device/app-storage/storage-test/items/title",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(default["content"], "default");
    assert_eq!(default["exists"], false);
    assert_eq!(default["revision"], Value::Null);
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row("SELECT count(*) FROM app_storage_buckets", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );

    let (status, written) = request(
        &state,
        "token-a",
        "PUT",
        "/api/device/app-storage/storage-test/items/title",
        json!({"content":"changed","expected_revision":null}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let revision = written["revision"].as_str().unwrap();
    let (status, read) = request(
        &state,
        "token-a",
        "GET",
        "/api/device/app-storage/storage-test/items/title",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(read["content"], "changed");
    assert_eq!(read["revision"], revision);

    let (status, conflict) = request(
        &state,
        "token-a",
        "PUT",
        "/api/device/app-storage/storage-test/items/title",
        json!({"content":"stale","expected_revision":null}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(conflict["current_revision"], revision);
    let (status, reset) = request(
        &state,
        "token-a",
        "DELETE",
        "/api/device/app-storage/storage-test/items/title",
        json!({"expected_revision":revision}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reset["revision"], Value::Null);
    let (_, after_reset) = request(
        &state,
        "token-a",
        "GET",
        "/api/device/app-storage/storage-test/items/title",
        json!({}),
    )
    .await;
    assert_eq!(after_reset["content"], "default");
}

#[path = "app_storage_regression_tests.rs"]
mod regression_tests;

#[tokio::test]
async fn publish_rejects_incompatible_saved_value_but_accepts_same_definition() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    let initial = definition();
    state.publish_app(&initial, "test", false, None).unwrap();
    assert_eq!(
        request(
            &state,
            "token-a",
            "PUT",
            "/api/device/app-storage/storage-test/items/title",
            json!({"content":"x","expected_revision":null})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(state.publish_app(&initial, "test", false, None).unwrap().1);
    let mut changed: Value = serde_json::from_str(&initial).unwrap();
    changed["storage"]["entries"][0]["schema"]["minLength"] = json!(2);
    changed["storage"]["entries"][0]["default"] = json!("xx");
    assert!(state
        .publish_app(&changed.to_string(), "test", false, None)
        .is_err());
}

#[tokio::test]
async fn storage_snapshot_is_limited_to_registry_eight_devices() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    state
        .publish_app(&definition(), "test", false, None)
        .unwrap();
    let supported = Supported::current();
    let stream = state
        .stream_with_registry(
            "device-a".into(),
            Some(supported.clone()),
            registry::STORAGE_REGISTRY_VERSION,
        )
        .unwrap();
    assert!(state.0.storage_devices.lock().unwrap().contains("device-a"));
    use futures::StreamExt;
    let response = axum::response::Sse::new(stream).into_response();
    let mut body = response.into_body().into_data_stream();
    let mut saw_storage_snapshot = false;
    for _ in 0..4 {
        let data = body.next().await.unwrap().unwrap();
        let text = std::str::from_utf8(&data).unwrap();
        if text.contains("storage.snapshot") {
            saw_storage_snapshot = true;
        }
    }
    assert!(saw_storage_snapshot);
    drop(body);
    let old = state
        .stream_with_registry(
            "device-a".into(),
            Some(supported),
            registry::STORAGE_REGISTRY_VERSION - 1,
        )
        .unwrap();
    assert!(!state.0.storage_devices.lock().unwrap().contains("device-a"));
    drop(old);
}

#[tokio::test]
async fn storage_changed_is_account_and_registry_scoped_without_content() {
    let state = AppState::in_memory("secret");
    let account_a = state.mcp_account_id().unwrap();
    let account_b = Uuid::new_v4().to_string();
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES(?1,'Other','now')",
            [&account_b],
        )
        .unwrap();
    add_device(&state, "device-a", &account_a, "token-a");
    add_device(&state, "device-b", &account_b, "token-b");
    add_device(&state, "device-old", &account_a, "token-old");
    let supported = Supported::current();
    let _current_a = state
        .stream_with_registry(
            "device-a".into(),
            Some(supported.clone()),
            registry::STORAGE_REGISTRY_VERSION,
        )
        .unwrap();
    let _current_b = state
        .stream_with_registry(
            "device-b".into(),
            Some(supported.clone()),
            registry::STORAGE_REGISTRY_VERSION,
        )
        .unwrap();
    let _old = state
        .stream_with_registry(
            "device-old".into(),
            Some(supported),
            registry::STORAGE_REGISTRY_VERSION - 1,
        )
        .unwrap();
    let event = DeviceEvent::StorageChanged {
        app_id: "storage-test".into(),
        changed: kaleidoscope_contract::app_storage::StorageChanged {
            bucket_id: "bucket".into(),
            item: kaleidoscope_contract::app_storage::StorageItemMeta {
                entry_id: "note".into(),
                key: "notes/role".into(),
                kind: kaleidoscope_contract::app_storage::StorageKind::Md,
                revision: Some("revision".into()),
                exists: true,
            },
        },
    };
    let broadcast = Broadcast {
        event: event.clone(),
        open_target: None,
        strict_open_target: false,
        account_id: Some(account_a),
    };
    assert!(state
        .event_for_broadcast("device-a", broadcast.clone())
        .is_some());
    assert!(state
        .event_for_broadcast("device-b", broadcast.clone())
        .is_none());
    assert!(state.event_for_broadcast("device-old", broadcast).is_none());
    assert!(!serde_json::to_string(&event).unwrap().contains("content"));
}

#[tokio::test]
async fn mcp_storage_tools_and_workspace_context_use_declared_account_data() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    state
        .publish_app(&definition(), "test", false, None)
        .unwrap();
    let workspaces = vec![
        Workspace {
            id: "w1".into(),
            name: "One".into(),
            created_at: "now".into(),
            updated_at: "now".into(),
        },
        Workspace {
            id: "w2".into(),
            name: "Two".into(),
            created_at: "now".into(),
            updated_at: "now".into(),
        },
    ];
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces,
                ..Default::default()
            },
        )
        .unwrap();
    let server = super::mcp::McpServer::new(state.clone());
    let listed = decode(
        server
            .list_app_storage(Parameters(super::mcp::app_storage_tools::AppStorageArgs {
                app_id: "storage-test".into(),
                workspace_id: None,
            }))
            .await
            .unwrap(),
    );
    assert_eq!(listed["items"].as_array().unwrap().len(), 3);
    let read = decode(
        server
            .read_app_storage(Parameters(
                super::mcp::app_storage_tools::AppStorageEntryArgs {
                    app_id: "storage-test".into(),
                    entry_id: "title".into(),
                    workspace_id: None,
                },
            ))
            .await
            .unwrap(),
    );
    let revision = read["revision"].as_str().map(str::to_string);
    let written = decode(
        server
            .write_app_storage(Parameters(
                super::mcp::app_storage_tools::AppStorageWriteArgs {
                    app_id: "storage-test".into(),
                    entry_id: "title".into(),
                    workspace_id: None,
                    content: json!("from-mcp"),
                    expected_revision: revision,
                },
            ))
            .await
            .unwrap(),
    );
    assert!(written["revision"].is_string());
    let context = decode(
        server
            .get_workspace(Parameters(super::mcp::WorkspaceArgs {
                workspace_id: Some("w1".into()),
            }))
            .await
            .unwrap(),
    );
    assert_eq!(context["app_data"][0]["value"], "from-mcp");
    assert_eq!(context["app_data"][0]["entry_id"], "title");
    let note = context["app_data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["entry_id"] == "note")
        .unwrap();
    assert_eq!(note["key"], "notes/role");
    assert_eq!(note["kind"], "md");
    assert_eq!(note["revision"], Value::Null);
    assert!(note.get("content").is_none());
    let reset = decode(
        server
            .reset_app_storage(Parameters(
                super::mcp::app_storage_tools::AppStorageResetArgs {
                    app_id: "storage-test".into(),
                    entry_id: "title".into(),
                    workspace_id: None,
                    expected_revision: written["revision"].as_str().map(str::to_string),
                },
            ))
            .await
            .unwrap(),
    );
    assert_eq!(reset["revision"], Value::Null);
}

fn decode(result: rmcp::model::CallToolResult) -> Value {
    let value = serde_json::to_value(result).unwrap();
    serde_json::from_str(value["content"][0]["text"].as_str().unwrap()).unwrap()
}
