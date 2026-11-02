use super::*;
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use kaleidoscope_contract::app_storage::StorageKind;
use tower::ServiceExt;

fn add_device(state: &AppState, id: &str, account_id: &str, token: &str) {
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,?2,?3,'now')",
        params![id, account_id, sha256_hex(token.as_bytes())],
    ).unwrap();
}

async fn raw_values_request(
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
async fn builtin_collection_raw_values_support_cas_move_events_and_delete() {
    use kaleidoscope_contract::worker::BuiltinRuntimeSpec;

    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    add_device(&state, "device-b", &account, "token-b");
    let storage = serde_json::from_value(json!({
        "entries":[{"id":"docs","key":"documents","kind":"md","collection":true,"default":"","label":"문서","presentation":"hidden"}]
    })).unwrap();
    state
        .register_builtin_specs(&[BuiltinRuntimeSpec {
            app_id: "agent".into(),
            version: 3,
            storage: Some(storage),
            worker: None,
        }])
        .unwrap();
    let supported = Supported::current();
    let _stream_a = state
        .stream_with_registry(
            "device-a".into(),
            Some(supported.clone()),
            registry::COLLECTION_REGISTRY_VERSION,
        )
        .unwrap();
    let _stream_b = state
        .stream_with_registry(
            "device-b".into(),
            Some(supported),
            registry::COLLECTION_REGISTRY_VERSION,
        )
        .unwrap();
    let collection = "/api/device/app-values/agent?prefix=documents";
    let original_key = "documents/%ED%9A%8C%EC%9D%98%EB%A1%9D.md";

    let (status, empty) = raw_values_request(&state, "token-a", "GET", collection, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert!(empty["items"].as_array().unwrap().is_empty());

    let (status, created) = raw_values_request(
        &state,
        "token-a",
        "PUT",
        &format!("/api/device/app-values/agent/{original_key}"),
        json!({"kind":"md","content":"한글 기본 앱 문서","expected_revision":null}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let revision = created["revision"].as_str().unwrap();

    let (status, listing) =
        raw_values_request(&state, "token-a", "GET", collection, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let listed = &listing["items"][0];
    assert_eq!(listed["doc"], "회의록.md");
    assert_eq!(listed["revision"], revision);
    assert_eq!(listed["byte_size"], "한글 기본 앱 문서".len());
    assert!(listed.get("content").is_none());
    assert!(listed["updated_at"].as_str().is_some());

    let (status, stale) = raw_values_request(
        &state,
        "token-b",
        "PUT",
        &format!("/api/device/app-values/agent/{original_key}"),
        json!({"kind":"md","content":"stale","expected_revision":null}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(stale["current_revision"], revision);

    let occupied_key = "documents/occupied.md";
    let (status, occupied) = raw_values_request(
        &state,
        "token-a",
        "PUT",
        &format!("/api/device/app-values/agent/{occupied_key}"),
        json!({"kind":"md","content":"occupied","expected_revision":null}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(occupied["revision"].as_str().is_some());

    let mut events = state.0.events.subscribe();
    let move_body = json!({
        "operation":"move",
        "from_key":"documents/회의록.md",
        "to_key":"documents/새 문서.md",
        "expected_revision":revision,
    });
    let (status, moved) = raw_values_request(
        &state,
        "token-a",
        "POST",
        "/api/device/app-values/agent",
        move_body,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(moved["revision"], revision);
    let broadcast = events.try_recv().unwrap();
    assert!(matches!(broadcast.event, DeviceEvent::AppValueMoved { .. }));
    assert!(matches!(
        state.event_for_broadcast("device-a", broadcast.clone()),
        Some(DeviceEvent::AppValueMoved { .. })
    ));
    assert!(matches!(
        state.event_for_broadcast("device-b", broadcast),
        Some(DeviceEvent::AppValueMoved { .. })
    ));

    let renamed_key = "documents/%EC%83%88%20%EB%AC%B8%EC%84%9C.md";
    let (status, read) = raw_values_request(
        &state,
        "token-b",
        "GET",
        &format!("/api/device/app-values/agent/{renamed_key}"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(read["content"], "한글 기본 앱 문서");
    assert_eq!(read["revision"], revision);

    let (status, target_conflict) = raw_values_request(
        &state,
        "token-a",
        "POST",
        "/api/device/app-values/agent",
        json!({"operation":"move","from_key":"documents/새 문서.md","to_key":occupied_key,"expected_revision":revision}),
    ).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(target_conflict.get("current_revision").is_some());

    let (status, reset) = raw_values_request(
        &state,
        "token-a",
        "DELETE",
        &format!("/api/device/app-values/agent/{renamed_key}"),
        json!({"expected_revision":revision}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reset["revision"], Value::Null);
    let (status, after_reset) = raw_values_request(
        &state,
        "token-a",
        "GET",
        &format!("/api/device/app-values/agent/{renamed_key}"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(after_reset["exists"], false);
}

#[tokio::test]
async fn builtin_entry_id_writes_global_json_and_broadcasts() {
    use super::mcp::app_storage_tools::{AppStorageArgs, AppStorageEntryArgs, AppStorageWriteArgs};
    use rmcp::handler::server::wrapper::Parameters;
    let state = AppState::in_memory("secret");
    let server = super::mcp::McpServer::new(state.clone());
    let mut events = state.0.events.subscribe();
    let written = server
        .write_app_storage(Parameters(AppStorageWriteArgs {
            app_id: "html-report".into(),
            entry_id: Some("reports".into()),
            key: None,
            doc: None,
            kind: None,
            workspace_id: None,
            content: json!({"documents": []}),
            expected_revision: None,
        }))
        .await
        .unwrap();
    assert!(!written.is_error.unwrap_or(false));
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::AppValueChanged { app_id, item, .. } if app_id == "html-report" && item.key == "reports")
    );
    let account = state.mcp_account_id().unwrap();
    assert_eq!(
        state
            .read_app_value(&account, "html-report", "reports")
            .unwrap()
            .content,
        Some(json!({"documents": []}))
    );
    let read = server
        .read_app_storage(Parameters(AppStorageEntryArgs {
            app_id: "html-report".into(),
            entry_id: Some("reports".into()),
            key: None,
            doc: None,
            workspace_id: None,
        }))
        .await
        .unwrap();
    assert!(!read.is_error.unwrap_or(false));
    let listed = server
        .list_app_storage(Parameters(AppStorageArgs {
            app_id: "html-report".into(),
            entry_id: None,
            workspace_id: None,
        }))
        .await
        .unwrap();
    assert!(!listed.is_error.unwrap_or(false));
    let listing: Value = serde_json::from_str(&listed.content[0].as_text().unwrap().text).unwrap();
    assert_eq!(listing["storage"]["entries"][0]["id"], "reports");
    assert_eq!(listing["items"][0]["key"], "reports");
    let principal = McpPrincipal {
        device_id: Some("device".into()),
        workspace_id: Some("workspace".into()),
    };
    let previous = state
        .read_app_value(&account, "html-report", "reports")
        .unwrap();
    let changed = server
        .write_app_storage_for_principal(
            AppStorageWriteArgs {
                app_id: "html-report".into(),
                entry_id: Some("reports".into()),
                key: None,
                doc: None,
                kind: None,
                workspace_id: None,
                content: json!({"documents": [{"id":"doc", "title":"시안", "revisions":[]}]}),
                expected_revision: previous.revision,
            },
            principal.clone(),
        )
        .await
        .unwrap();
    assert!(!changed.is_error.unwrap_or(false));
    let read = server
        .read_app_storage_for_principal(
            AppStorageEntryArgs {
                app_id: "html-report".into(),
                entry_id: Some("reports".into()),
                key: None,
                doc: None,
                workspace_id: None,
            },
            principal,
        )
        .await
        .unwrap();
    assert!(!read.is_error.unwrap_or(false));
    let db = state.lock_db().unwrap();
    let workspace: Option<String> = db
        .query_row(
            "SELECT workspace_id FROM app_storage_items WHERE key='reports'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(workspace, None);
}

#[test]
fn builtin_raw_values_preserve_cas_and_do_not_supply_defaults() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let empty = state
        .read_app_value(&account, "agent", "settings/agents")
        .unwrap();
    assert!(!empty.exists);
    let revision = state
        .write_app_value(
            &account,
            "agent",
            "settings/agents",
            StorageKind::Json,
            json!([{"id":"a","name":"Agent","command":"agent","args":[],"env":{}}]),
            None,
            None,
        )
        .unwrap();
    let read = state
        .read_app_value(&account, "agent", "settings/agents")
        .unwrap();
    assert_eq!(
        read.content,
        Some(json!([{"id":"a","name":"Agent","command":"agent","args":[],"env":{}}]))
    );
    assert_eq!(read.revision.as_deref(), Some(revision.as_str()));
    assert_eq!(
        state
            .write_app_value(
                &account,
                "agent",
                "settings/agents",
                StorageKind::Json,
                json!([]),
                None,
                None
            )
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    state
        .reset_app_value(&account, "agent", "settings/agents", Some(revision))
        .unwrap();
    assert!(
        !state
            .read_app_value(&account, "agent", "settings/agents")
            .unwrap()
            .exists
    );
}

#[test]
fn migration_removes_builtin_definitions_but_preserves_saved_values() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    {
        let db = state.lock_db().unwrap();
        db.execute("INSERT INTO apps(id,name,current_version,created_at,updated_at) VALUES('agent','test',1,'now','now')", []).unwrap();
        db.execute("INSERT INTO app_versions(app_id,version,definition,created_at,created_by) VALUES('agent',1,'{}','now','test')", []).unwrap();
    }
    state
        .write_app_value(
            &account,
            "agent",
            "settings/agents",
            StorageKind::Json,
            json!([{"id":"saved","name":"Saved","command":"agent","args":[],"env":{}}]),
            None,
            None,
        )
        .unwrap();
    {
        let db = state.lock_db().unwrap();
        db.execute_batch("DROP TABLE asset_versions; ALTER TABLE app_storage_items DROP COLUMN workspace_id; PRAGMA user_version=10;").unwrap();
        migrate(&db).unwrap();
        let apps: i64 = db
            .query_row("SELECT count(*) FROM apps WHERE id='agent'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let versions: i64 = db
            .query_row(
                "SELECT count(*) FROM app_versions WHERE app_id='agent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((apps, versions), (0, 0));
    }
    assert_eq!(
        state
            .read_app_value(&account, "agent", "settings/agents")
            .unwrap()
            .content,
        Some(json!([{"id":"saved","name":"Saved","command":"agent","args":[],"env":{}}]))
    );
}

#[tokio::test]
async fn builtin_write_rejects_undeclared_fields_and_invalid_schema() {
    use super::mcp::app_storage_tools::AppStorageWriteArgs;
    use rmcp::handler::server::wrapper::Parameters;

    let state = AppState::in_memory("secret");
    let server = super::mcp::McpServer::new(state.clone());
    let account = state.mcp_account_id().unwrap();
    let mut events = state.0.events.subscribe();
    let original = json!({"documents":[{"id":"doc","title":"시안","revisions":[]}]});
    let written = server
        .write_app_storage(Parameters(AppStorageWriteArgs {
            app_id: "html-report".into(),
            entry_id: Some("reports".into()),
            key: None,
            doc: None,
            kind: None,
            workspace_id: None,
            content: original.clone(),
            expected_revision: None,
        }))
        .await
        .unwrap();
    assert_eq!(written.is_error, Some(false));
    let _ = events.try_recv().unwrap();
    assert!(matches!(
        events.try_recv().unwrap().event,
        DeviceEvent::StorageChanged { .. }
    ));
    let before = state
        .read_app_value(&account, "html-report", "reports")
        .unwrap();

    let invalid_mcp = server
        .write_app_storage(Parameters(AppStorageWriteArgs {
            app_id: "html-report".into(),
            entry_id: Some("reports".into()),
            key: None,
            doc: None,
            kind: None,
            workspace_id: None,
            content: json!({"documents":[], "kind":"json"}),
            expected_revision: before.revision.clone(),
        }))
        .await
        .unwrap();
    assert_eq!(invalid_mcp.is_error, Some(true));
    let details =
        serde_json::from_str::<CoreError>(&invalid_mcp.content[0].as_text().unwrap().text).unwrap();
    assert_eq!(details.code, ErrorCode::InvalidRequest);
    assert!(details
        .details
        .iter()
        .any(|detail| detail.contains("허용되지 않은 필드입니다")));

    let invalid_http = state.write_app_value(
        &account,
        "html-report",
        "reports",
        StorageKind::Json,
        json!({"documents":[{"id":"doc","title":"시안","revisions":[{"rev":1,"revision":1,"html":"<p>새 값</p>"}]}]}),
        before.revision.clone(),
        None,
    ).unwrap_err();
    assert_eq!(invalid_http.code, ErrorCode::InvalidRequest);
    assert!(invalid_http
        .details
        .iter()
        .any(|detail| detail.contains("허용되지 않은 필드입니다")));
    assert!(events.try_recv().is_err());
    let after = state
        .read_app_value(&account, "html-report", "reports")
        .unwrap();
    assert_eq!(after.content, Some(original));
    assert_eq!(after.revision, before.revision);

    let agent_write = server
        .write_app_storage(Parameters(AppStorageWriteArgs {
            app_id: "agent".into(),
            entry_id: Some("agents".into()),
            key: None,
            doc: None,
            kind: None,
            workspace_id: None,
            content: json!([{"id":"saved","name":"Saved","command":"agent","args":[],"env":{}}]),
            expected_revision: None,
        }))
        .await
        .unwrap();
    assert_eq!(agent_write.is_error, Some(false));
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::AppValueChanged { app_id, item, .. } if app_id == "agent" && item.key == "settings/agents")
    );
    assert!(
        state
            .read_app_value(&account, "agent", "settings/agents")
            .unwrap()
            .exists
    );

    use kaleidoscope_contract::app_storage::{
        AppValueMeta, StorageChanged, StorageItemMeta, StorageKind as Kind,
    };
    let event = DeviceEvent::AppValueChanged {
        app_id: "html-report".into(),
        bucket_id: "bucket".into(),
        item: AppValueMeta {
            key: "reports".into(),
            kind: Kind::Json,
            revision: Some("rev".into()),
        },
    };
    state
        .0
        .storage_devices
        .lock()
        .unwrap()
        .insert("registry-9".into());
    state
        .0
        .app_value_devices
        .lock()
        .unwrap()
        .insert("registry-10".into());
    let legacy = state
        .event_for_broadcast(
            "registry-9",
            Broadcast {
                event: event.clone(),
                open_target: None,
                strict_open_target: false,
                account_id: None,
            },
        )
        .unwrap();
    assert!(
        matches!(legacy, DeviceEvent::StorageChanged { app_id, changed: StorageChanged { item: StorageItemMeta { entry_id, key, kind: Kind::Json, revision: Some(revision), exists: true }, .. } } if app_id == "html-report" && entry_id == "reports" && key == "reports" && revision == "rev")
    );
    let current = state
        .event_for_broadcast(
            "registry-10",
            Broadcast {
                event,
                open_target: None,
                strict_open_target: false,
                account_id: None,
            },
        )
        .unwrap();
    assert!(matches!(current, DeviceEvent::AppValueChanged { .. }));
}
