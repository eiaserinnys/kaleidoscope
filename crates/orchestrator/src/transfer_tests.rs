use super::*;
use kaleidoscope_contract::app_storage::StorageKind;
use kaleidoscope_contract::{registry::LayoutChanges, transfer::*};

fn app() -> AppDefinition {
    parse_app_definition(r#"{"id":"personal-test","name":"시험","requires":{"blocks":6,"modules":{"storage":1}},"permissions":[],"state":{},"storage":{"entries":[{"id":"setting","key":"setting","kind":"json","default":0,"schema":{"type":"integer"},"label":"값","presentation":"hidden"}]},"ui":{"type":"text","value":"시험"}}"#).unwrap()
}
#[test]
fn transfer_keeps_remote_values_and_is_repeatable() {
    let local = AppState::in_memory("local");
    let remote = AppState::in_memory("remote");
    let la = local.mcp_account_id().unwrap();
    let ra = remote.mcp_account_id().unwrap();
    let definition = app();
    local
        .publish_app(
            &serde_json::to_string(&definition).unwrap(),
            "test",
            false,
            None,
        )
        .unwrap();
    local
        .write_app_storage(&la, &definition.id, "setting", None, json!(1), None)
        .unwrap();
    let bundle = local.export_data(&la).unwrap();
    assert_eq!(remote.import_data(&ra, bundle.clone()).unwrap().imported, 2);
    assert_eq!(remote.import_data(&ra, bundle.clone()).unwrap().imported, 0);
    let previous = remote
        .read_app_storage(&ra, &definition.id, "setting", None)
        .unwrap();
    remote
        .write_app_storage(
            &ra,
            &definition.id,
            "setting",
            None,
            json!(2),
            previous.revision,
        )
        .unwrap();
    let result = remote.import_data(&ra, bundle).unwrap();
    assert!(result
        .skipped
        .contains(&"value:personal-test/setting".into()));
    assert_eq!(
        remote
            .read_app_storage(&ra, &definition.id, "setting", None)
            .unwrap()
            .content,
        json!(2)
    );
}
#[test]
fn transfer_orders_workspace_before_scoped_values_and_rejects_deletes() {
    let state = AppState::in_memory("test");
    let account = state.mcp_account_id().unwrap();
    let workspace = kaleidoscope_contract::Workspace {
        id: "new-workspace".into(),
        name: "작업".into(),
        created_at: timestamp(),
        updated_at: timestamp(),
    };
    let mut bundle = TransferBundle {
        layout: LayoutChanges {
            workspaces: vec![workspace],
            ..Default::default()
        },
        ..Default::default()
    };
    bundle.values.push(TransferValue {
        app_id: "agent".into(),
        key: "agents/new-workspace".into(),
        kind: StorageKind::Json,
        content: json!([]),
        workspace_id: Some("new-workspace".into()),
    });
    state.import_data(&account, bundle).unwrap();
    assert!(
        state
            .read_app_value(&account, "agent", "agents/new-workspace")
            .unwrap()
            .exists
    );
    let bad = TransferBundle {
        layout: LayoutChanges {
            deleted_workspaces: vec!["new-workspace".into()],
            ..Default::default()
        },
        ..Default::default()
    };
    assert!(state.import_data(&account, bad).is_err());
}

#[test]
fn transfer_assets_precede_apps_and_conflicts_preserve_remote_asset() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use kaleidoscope_contract::assets::{AssetDep, AssetFormat, AssetUpload};
    let upload = |svg: &str| AssetUpload {
        id: "transfer-icon".into(),
        version: 1,
        format: AssetFormat::Svg,
        sha256: sha256_hex(svg.as_bytes()),
        source: "시험".into(),
        license: "MIT".into(),
        data_base64: STANDARD.encode(svg),
    };
    let local = AppState::in_memory("local");
    let remote = AppState::in_memory("remote");
    let account = remote.mcp_account_id().unwrap();
    local.upload_asset(&upload("<svg/>")).unwrap();
    let mut definition = app();
    definition.requires.modules.insert("assets".into(), 1);
    definition.assets = vec![AssetDep {
        id: "transfer-icon".into(),
        version: 1,
    }];
    local
        .publish_app(
            &serde_json::to_string(&definition).unwrap(),
            "test",
            false,
            None,
        )
        .unwrap();
    let bundle = local.export_data(&local.mcp_account_id().unwrap()).unwrap();
    remote.import_data(&account, bundle.clone()).unwrap();
    assert!(remote.app(&definition.id, None).unwrap().is_some());
    assert_eq!(
        remote
            .get_asset(&account, "transfer-icon", 1)
            .unwrap()
            .unwrap()
            .1,
        b"<svg/>"
    );
    assert_eq!(
        remote
            .import_data(&account, bundle.clone())
            .unwrap()
            .imported,
        0
    );
    let conflicting = AppState::in_memory("conflict");
    conflicting
        .upload_asset(&upload("<svg><path d=\"M1 1\"/></svg>"))
        .unwrap();
    let result = conflicting
        .import_data(&conflicting.mcp_account_id().unwrap(), bundle)
        .unwrap();
    assert!(result.skipped.contains(&"asset:transfer-icon/1".into()));
    assert!(result.skipped.contains(&"app:personal-test".into()));
    assert!(conflicting.app("personal-test", None).unwrap().is_none());
}

#[test]
fn deleted_apps_retained_values_do_not_block_transfer() {
    let local = AppState::in_memory("local");
    let remote = AppState::in_memory("remote");
    let definition = app();
    local
        .publish_app(
            &serde_json::to_string(&definition).unwrap(),
            "test",
            false,
            None,
        )
        .unwrap();
    local
        .write_app_storage(
            &local.mcp_account_id().unwrap(),
            &definition.id,
            "setting",
            None,
            json!(7),
            None,
        )
        .unwrap();
    local
        .lock_db()
        .unwrap()
        .execute(
            "UPDATE apps SET deleted_at=?1 WHERE id=?2",
            params![timestamp(), definition.id],
        )
        .unwrap();
    let bundle = local.export_data(&local.mcp_account_id().unwrap()).unwrap();
    assert!(bundle.apps.is_empty());
    assert!(bundle.values.is_empty());
    assert_eq!(
        remote
            .import_data(&remote.mcp_account_id().unwrap(), bundle)
            .unwrap()
            .imported,
        0
    );
    let count: i64 = local
        .lock_db()
        .unwrap()
        .query_row("SELECT count(*) FROM app_storage_items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}
