use super::*;
use kaleidoscope_contract::app_storage::StorageKind;

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
