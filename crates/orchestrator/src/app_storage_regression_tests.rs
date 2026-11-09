use super::*;

#[tokio::test]
async fn storage_isolated_by_account_and_workspace_owner() {
    let state = AppState::in_memory("secret");
    let account_a = state.mcp_account_id().unwrap();
    let account_b = Uuid::new_v4().to_string();
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES(?1,'Other','now')",
            [&account_b],
        )
        .unwrap();
    }
    add_device(&state, "device-a", &account_a, "token-a");
    add_device(&state, "device-b", &account_b, "token-b");
    state
        .publish_app(&definition(), "test", false, None)
        .unwrap();

    assert_eq!(
        request(
            &state,
            "token-a",
            "PUT",
            "/api/device/app-storage/storage-test/items/title",
            json!({"content":"account-a","expected_revision":null})
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, other) = request(
        &state,
        "token-b",
        "GET",
        "/api/device/app-storage/storage-test/items/title",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(other["content"], "default");
    assert_eq!(other["exists"], false);
    for (token, content) in [("token-a", "a-fixed"), ("token-b", "b-fixed")] {
        let (status, _) = request(
            &state,
            token,
            "PUT",
            "/api/device/app-storage/storage-test/items/fixed_workspace_note",
            json!({"content":content,"expected_revision":null}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    let workspace = Workspace {
        id: "workspace-a".into(),
        name: "A".into(),
        created_at: "now".into(),
        updated_at: "now".into(),
    };
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![
                    workspace,
                    Workspace {
                        id: "workspace-b".into(),
                        name: "B".into(),
                        created_at: "now".into(),
                        updated_at: "now".into(),
                    },
                ],
                ..Default::default()
            },
        )
        .unwrap();
    let path =
        "/api/device/app-storage/storage-test/items/workspace_value?workspace_id=workspace-a";
    assert_eq!(
        request(
            &state,
            "token-a",
            "PUT",
            path,
            json!({"content":"owned","expected_revision":null})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&state, "token-b", "GET", path, json!({})).await.0,
        StatusCode::NOT_FOUND
    );
    state
        .apply_layout_changes(
            Some("device-a"),
            &registry::LayoutChanges {
                deleted_workspaces: vec!["workspace-a".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM app_storage_items WHERE key='workspaces/workspace-a/value'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
    for (token, expected) in [("token-a", "a-fixed"), ("token-b", "b-fixed")] {
        let (status, read) = request(
            &state,
            token,
            "GET",
            "/api/device/app-storage/storage-test/items/fixed_workspace_note",
            json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(read["content"], expected);
    }
}

#[tokio::test]
async fn global_collection_documents_survive_other_workspace_deletion() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    state
        .publish_app(&definition_with_collection(), "test", false, None)
        .unwrap();
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![
                    Workspace {
                        id: "workspace-a".into(),
                        name: "A".into(),
                        created_at: "now".into(),
                        updated_at: "now".into(),
                    },
                    Workspace {
                        id: "workspace-b".into(),
                        name: "B".into(),
                        created_at: "now".into(),
                        updated_at: "now".into(),
                    },
                ],
                ..Default::default()
            },
        )
        .unwrap();
    let (written, _, _) = state
        .write_app_storage_document(
            &account,
            "storage-test",
            "docs",
            "메모.md",
            Some("workspace-a"),
            json!("전역 문서"),
            None,
        )
        .unwrap();
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM app_storage_items WHERE key='documents/메모.md'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );

    state
        .apply_layout_changes(
            Some("device-a"),
            &registry::LayoutChanges {
                deleted_workspaces: vec!["workspace-a".into()],
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM app_storage_items WHERE key='documents/메모.md'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    let read = state
        .read_app_storage_document(
            &account,
            "storage-test",
            "docs",
            "메모.md",
            Some("workspace-b"),
        )
        .unwrap();
    assert_eq!(read.content, json!("전역 문서"));
    assert_eq!(read.revision, Some(written.revision));
}

#[tokio::test]
async fn legacy_workspace_storage_stays_writable_until_deleted_after_canonicalization() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    state
        .publish_app(&definition(), "test", false, None)
        .unwrap();
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![Workspace {
                    id: "workspace-keep".into(),
                    name: "Keep".into(),
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
            "INSERT INTO legacy_workspace_owners(workspace_id,account_id) VALUES('workspace-old',?1)",
            [&account],
        )
        .unwrap();

    let path =
        "/api/device/app-storage/storage-test/items/workspace_value?workspace_id=workspace-old";
    let (status, _) = request(
        &state,
        "token-a",
        "PUT",
        path,
        json!({"content":"legacy-write","expected_revision":null}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![Workspace {
                    id: "workspace-old".into(),
                    name: "Old".into(),
                    created_at: "now".into(),
                    updated_at: "now".into(),
                }],
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM workspaces WHERE id='workspace-old' AND account_id=?1",
                [&account],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                deleted_workspaces: vec!["workspace-old".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM legacy_workspace_owners WHERE workspace_id='workspace-old'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
    assert_eq!(
        request(
            &state,
            "token-a",
            "PUT",
            path,
            json!({"content":"late-write","expected_revision":null}),
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

fn workspace(id: &str) -> Workspace {
    Workspace {
        id: id.into(),
        name: id.into(),
        created_at: "now".into(),
        updated_at: "now".into(),
    }
}

fn definition_with_workspace_collection() -> String {
    let mut value: Value = serde_json::from_str(&definition()).unwrap();
    value["requires"]["modules"]["storage"] = json!(3);
    value["storage"]["entries"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id":"workspace_docs", "key":"workspaces/{workspace_id}/documents", "kind":"md",
            "collection":true, "default":"", "label":"작업 문서", "presentation":"hidden"
        }));
    serde_json::to_string(&value).unwrap()
}

fn definition_with_workspace_values() -> String {
    let mut value: Value = serde_json::from_str(&definition()).unwrap();
    value["storage"]["entries"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id":"workspace_note", "key":"workspaces/{workspace_id}/note", "kind":"md",
            "default":"", "label":"작업 노트", "presentation":"hidden"
        }));
    serde_json::to_string(&value).unwrap()
}

#[tokio::test]
async fn workspace_collection_documents_are_deleted_with_their_workspace() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    state
        .publish_app(&definition_with_workspace_collection(), "test", false, None)
        .unwrap();
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![workspace("workspace-a"), workspace("workspace-b")],
                ..Default::default()
            },
        )
        .unwrap();
    state
        .write_app_storage_document(
            &account,
            "storage-test",
            "workspace_docs",
            "메모.md",
            Some("workspace-a"),
            json!("작업 문서"),
            None,
        )
        .unwrap();
    let (count, owner) = state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT count(*),max(workspace_id) FROM app_storage_items WHERE key='workspaces/workspace-a/documents/메모.md'",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .unwrap();
    assert_eq!(count, 1);
    assert_eq!(owner.as_deref(), Some("workspace-a"));
    state
        .apply_layout_changes(
            Some("device-a"),
            &registry::LayoutChanges {
                deleted_workspaces: vec!["workspace-a".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM app_storage_items WHERE key='workspaces/workspace-a/documents/메모.md'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn workspace_single_items_are_deleted_and_global_items_survive() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    state
        .publish_app(&definition_with_workspace_values(), "test", false, None)
        .unwrap();
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![workspace("workspace-a"), workspace("workspace-b")],
                ..Default::default()
            },
        )
        .unwrap();
    let title = state
        .write_app_storage(
            &account,
            "storage-test",
            "title",
            Some("workspace-a"),
            json!("전역 제목"),
            None,
        )
        .unwrap();
    let note = state
        .write_app_storage(
            &account,
            "storage-test",
            "note",
            Some("workspace-a"),
            json!("# 전역 노트"),
            None,
        )
        .unwrap();
    state
        .write_app_storage(
            &account,
            "storage-test",
            "workspace_value",
            Some("workspace-a"),
            json!("작업 값"),
            None,
        )
        .unwrap();
    state
        .write_app_storage(
            &account,
            "storage-test",
            "workspace_note",
            Some("workspace-a"),
            json!("# 작업 노트"),
            None,
        )
        .unwrap();
    state
        .apply_layout_changes(
            Some("device-a"),
            &registry::LayoutChanges {
                deleted_workspaces: vec!["workspace-a".into()],
                ..Default::default()
            },
        )
        .unwrap();
    let read = state
        .read_app_storage(&account, "storage-test", "title", None)
        .unwrap();
    assert_eq!(read.content, json!("전역 제목"));
    assert_eq!(read.revision, Some(title.0.revision));
    let read = state
        .read_app_storage(&account, "storage-test", "note", None)
        .unwrap();
    assert_eq!(read.content, json!("# 전역 노트"));
    assert_eq!(read.revision, Some(note.0.revision));
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM app_storage_items WHERE key IN ('workspaces/workspace-a/value','workspaces/workspace-a/note')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn transfer_stores_declaration_ownership_instead_of_bundle_value() {
    use kaleidoscope_contract::app_storage::StorageKind;
    use kaleidoscope_contract::transfer::{TransferBundle, TransferValue};
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    add_device(&state, "device-a", &account, "token-a");
    state
        .publish_app(&definition_with_collection(), "test", false, None)
        .unwrap();
    state
        .import_data(
            &account,
            TransferBundle {
                layout: registry::LayoutChanges {
                    workspaces: vec![workspace("workspace-a"), workspace("workspace-b")],
                    ..Default::default()
                },
                values: vec![TransferValue {
                    app_id: "storage-test".into(),
                    key: "documents/메모.md".into(),
                    kind: StorageKind::Md,
                    content: json!("전역 문서"),
                    workspace_id: Some("workspace-a".into()),
                }],
                ..Default::default()
            },
        )
        .unwrap();
    let owner: Option<String> = state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT workspace_id FROM app_storage_items WHERE key='documents/메모.md'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(owner, None);
    state
        .apply_layout_changes(
            Some("device-a"),
            &registry::LayoutChanges {
                deleted_workspaces: vec!["workspace-a".into()],
                ..Default::default()
            },
        )
        .unwrap();
    let read = state
        .read_app_storage_document(
            &account,
            "storage-test",
            "docs",
            "메모.md",
            Some("workspace-b"),
        )
        .unwrap();
    assert_eq!(read.content, json!("전역 문서"));
}
