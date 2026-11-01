use super::*;
use kaleidoscope_contract::app_storage::StorageKind;

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
            workspace_id: None,
        }))
        .await
        .unwrap();
    assert!(!read.is_error.unwrap_or(false));
    let listed = server
        .list_app_storage(Parameters(AppStorageArgs {
            app_id: "html-report".into(),
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
        .reset_app_value(&account, "agent", "settings/agents", Some(revision), None)
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
            kind: None,
            workspace_id: None,
            content: original.clone(),
            expected_revision: None,
        }))
        .await
        .unwrap();
    assert_eq!(written.is_error, Some(false));
    let _ = events.try_recv().unwrap();
    let before = state
        .read_app_value(&account, "html-report", "reports")
        .unwrap();

    let invalid_mcp = server
        .write_app_storage(Parameters(AppStorageWriteArgs {
            app_id: "html-report".into(),
            entry_id: Some("reports".into()),
            key: None,
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
