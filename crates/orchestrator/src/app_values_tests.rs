use super::*;
use kaleidoscope_contract::app_storage::StorageKind;

#[tokio::test]
async fn builtin_entry_id_writes_global_json_and_broadcasts() {
    use super::mcp::app_storage_tools::{AppStorageEntryArgs, AppStorageWriteArgs};
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
                content: json!({"documents": [{"id":"doc"}]}),
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
            json!(["a"]),
            None,
            None,
        )
        .unwrap();
    let read = state
        .read_app_value(&account, "agent", "settings/agents")
        .unwrap();
    assert_eq!(read.content, Some(json!(["a"])));
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
            json!(["saved"]),
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
        Some(json!(["saved"]))
    );
}
