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
