use super::*;
use kaleidoscope_contract::Workspace;

fn decode(result: CallToolResult) -> Value {
    let result = serde_json::to_value(result).unwrap();
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn workspace_tools_read_and_delete_canonical_entities() {
    let state = AppState::in_memory("secret");
    let make_workspace = |id: &str| Workspace {
        id: id.into(),
        name: format!("작업 {id}"),
        created_at: format!("{id}-created"),
        updated_at: format!("{id}-updated"),
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
    let foreign_account = Uuid::new_v4().to_string();
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES(?1,'Other','now')",
            [&foreign_account],
        )
        .unwrap();
        db.execute(
            "INSERT INTO workspaces(id,account_id,data,created_at) VALUES(?1,?2,?3,'now')",
            params![
                foreign_account,
                foreign_account,
                serde_json::to_string(&make_workspace(&foreign_account)).unwrap()
            ],
        )
        .unwrap();
    }
    let server = McpServer::new(state);

    let listed = decode(server.list_workspaces().await.unwrap());
    assert_eq!(listed.as_array().unwrap().len(), 2);
    assert_eq!(listed[0]["workspace_id"], "w1");
    let found = decode(
        server
            .get_workspace(Parameters(WorkspaceArgs {
                workspace_id: "w1".into(),
            }))
            .await
            .unwrap(),
    );
    assert_eq!(found["workspace_id"], "w1");
    assert_eq!(found["device"], Value::Null);
    assert_eq!(found["desktops"], json!([]));

    let deleted = decode(
        server
            .delete_workspace(Parameters(WorkspaceArgs {
                workspace_id: "w1".into(),
            }))
            .await
            .unwrap(),
    );
    assert_eq!(deleted["deleted"], true);
    assert_eq!(deleted["workspace_id"], "w1");
    let last = server
        .delete_workspace(Parameters(WorkspaceArgs {
            workspace_id: "w2".into(),
        }))
        .await
        .unwrap();
    assert!(last.is_error.unwrap_or_default());
    let foreign = decode(
        server
            .delete_workspace(Parameters(WorkspaceArgs {
                workspace_id: foreign_account.clone(),
            }))
            .await
            .unwrap(),
    );
    assert_eq!(foreign["deleted"], true);
    assert!(server
        .state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2)",
            params![foreign_account, foreign_account],
            |row| row.get::<_, bool>(0)
        )
        .unwrap());
    let remaining = decode(server.list_workspaces().await.unwrap());
    assert_eq!(remaining.as_array().unwrap().len(), 1);
    assert_eq!(remaining[0]["workspace_id"], "w2");
}
