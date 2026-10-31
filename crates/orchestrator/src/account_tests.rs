use super::*;
use kaleidoscope_contract::{AppWindow, Desktop, Rect, Workspace};
use tower::ServiceExt;

fn legacy_v5_state() -> AppState {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "CREATE TABLE apps (id TEXT PRIMARY KEY,name TEXT NOT NULL,current_version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
         CREATE TABLE app_versions (app_id TEXT NOT NULL REFERENCES apps(id),version INTEGER NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,PRIMARY KEY(app_id,version));
         CREATE TABLE devices (id TEXT PRIMARY KEY,name TEXT NOT NULL,token_sha256 TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,last_seen_at TEXT,revoked_at TEXT,last_active_at TEXT);
         CREATE TABLE device_layouts (device_id TEXT PRIMARY KEY REFERENCES devices(id),layout TEXT NOT NULL,reported_at TEXT NOT NULL);
         CREATE TABLE agents (workspace_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,session_id TEXT NOT NULL UNIQUE,model_preset TEXT NOT NULL,workspace_name TEXT NOT NULL,created_at TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE agent_items (id INTEGER PRIMARY KEY AUTOINCREMENT,workspace_id TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,at TEXT NOT NULL,attachments TEXT NOT NULL DEFAULT '[]');
         CREATE TABLE connections (name TEXT PRIMARY KEY,kind TEXT NOT NULL,base_url TEXT NOT NULL,writable INTEGER NOT NULL,paths TEXT NOT NULL DEFAULT '[]',headers TEXT NOT NULL DEFAULT '{}',issuer TEXT,scopes TEXT,resource TEXT,description TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
         CREATE TABLE workspaces (id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL);
         CREATE TABLE desktops (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
         CREATE TABLE windows (id TEXT PRIMARY KEY,desktop_id TEXT NOT NULL,app_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
         INSERT INTO devices VALUES('old-device','Old PC','legacy-token-hash','created',NULL,NULL,NULL);
         INSERT INTO connections VALUES('board','relay','https://example.test',0,'[]','{}',NULL,NULL,NULL,'board','updated');
         INSERT INTO workspaces VALUES('old-workspace','{\"id\":\"old-workspace\",\"name\":\"Old\",\"created_at\":\"created\",\"updated_at\":\"updated\"}','created');
         INSERT INTO desktops VALUES('old-desktop','old-workspace','{\"id\":\"old-desktop\",\"workspace_id\":\"old-workspace\",\"name\":\"Desktop\",\"position\":0,\"created_at\":\"created\",\"updated_at\":\"updated\"}','created');
         INSERT INTO windows VALUES('old-window','old-desktop','editor','{\"id\":\"old-window\",\"desktop_id\":\"old-desktop\",\"app_id\":\"editor\",\"app_version\":1,\"rect\":{\"x\":0,\"y\":0,\"width\":200,\"height\":120},\"z\":1,\"state\":{},\"created_at\":\"created\",\"updated_at\":\"updated\"}','created');
         PRAGMA user_version=5;",
    )
    .unwrap();
    let definition: AppDefinition =
        serde_json::from_str(include_str!("../../../apps/md-editor.json")).unwrap();
    db.execute(
        "INSERT INTO apps(id,name,current_version,created_at,updated_at) VALUES(?1,?2,1,'created','updated')",
        params![definition.id, definition.name],
    )
    .unwrap();
    db.execute(
        "INSERT INTO app_versions(app_id,version,definition,created_at,created_by) VALUES(?1,1,?2,'created','agent')",
        params![definition.id, serde_json::to_string(&definition).unwrap()],
    )
    .unwrap();
    db.execute(
        "UPDATE devices SET token_sha256=?1 WHERE id='old-device'",
        [sha256_hex(b"legacy-token")],
    )
    .unwrap();
    AppState::from_connection(db, "mcp-token".into(), None).unwrap()
}

#[tokio::test]
async fn v5_migration_attaches_existing_rows_and_preserves_existing_credentials_and_apps() {
    let state = legacy_v5_state();
    let db = state.lock_db().unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 10);

    let (
        account_id,
        principal_account_id,
        device_account_id,
        workspace_account_id,
        connection_account_id,
    ): (String, String, String, String, String) = db
        .query_row(
            "SELECT a.id,p.account_id,d.account_id,w.account_id,c.account_id
             FROM accounts a
             JOIN mcp_principal p ON p.account_id=a.id
             JOIN devices d ON d.id='old-device'
             JOIN workspaces w ON w.id='old-workspace'
             JOIN connections c ON c.name='board'",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(account_id, principal_account_id);
    assert_eq!(account_id, device_account_id);
    assert_eq!(account_id, workspace_account_id);
    assert_eq!(account_id, connection_account_id);
    assert_eq!(
        db.query_row("SELECT count(*) FROM accounts", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM desktops WHERE id='old-desktop'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM windows WHERE id='old-window'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM apps WHERE id='md-editor'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    drop(db);

    assert_eq!(
        state.authenticate_device("legacy-token").unwrap(),
        Some(("old-device".into(), "Old PC".into()))
    );
    assert_eq!(
        state.get_workspace("old-workspace").unwrap().unwrap()["workspace_id"],
        "old-workspace"
    );
    assert_eq!(
        state.connection("board").unwrap().unwrap().info.name,
        "board"
    );
    let response = crate::router(state)
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/device/workspaces/old-workspace/agent")
                .header(axum::http::header::AUTHORIZATION, "Bearer legacy-token")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn second_account_workspaces_connections_and_devices_are_hidden_from_mcp_principal() {
    let state = legacy_v5_state();
    let second_account = Uuid::new_v4().to_string();
    let principal: String = state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT account_id FROM mcp_principal WHERE id=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES(?1,'Second','now')",
            [&second_account],
        )
        .unwrap();
        db.execute(
            "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('second-device','Second PC',?1,'second-token','now')",
            [&second_account],
        )
        .unwrap();
        db.execute(
            "INSERT INTO workspaces(id,account_id,data,created_at) VALUES(?1,?1,?2,'created')",
            params![
                second_account,
                serde_json::to_string(&Workspace {
                    id: second_account.clone(),
                    name: "Second".into(),
                    created_at: "created".into(),
                    updated_at: "updated".into(),
                })
                .unwrap()
            ],
        )
        .unwrap();
        let desktop = Desktop {
            id: "second-desktop".into(),
            workspace_id: second_account.clone(),
            name: "Desktop".into(),
            position: 0,
            sharing: Vec::new(),
            last_sent_context: Default::default(),
            created_at: "created".into(),
            updated_at: "updated".into(),
        };
        db.execute(
            "INSERT INTO desktops(id,workspace_id,data,created_at) VALUES(?1,?2,?3,'created')",
            params![
                desktop.id,
                desktop.workspace_id,
                serde_json::to_string(&desktop).unwrap()
            ],
        )
        .unwrap();
        let window = AppWindow {
            id: "second-window".into(),
            desktop_id: "second-desktop".into(),
            app_id: "md-editor".into(),
            app_version: 1,
            rect: Rect {
                x: 0,
                y: 0,
                width: 200,
                height: 120,
            },
            z: 1,
            state: Default::default(),
            created_at: "created".into(),
            updated_at: "updated".into(),
        };
        db.execute(
            "INSERT INTO windows(id,desktop_id,app_id,data,created_at) VALUES(?1,?2,?3,?4,'created')",
            params![window.id, window.desktop_id, window.app_id, serde_json::to_string(&window).unwrap()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO connections(account_id,name,kind,base_url,writable,paths,headers,description,updated_at)
             VALUES(?1,'board','relay','https://second.test',0,'[]','{}','second','now')",
            [&second_account],
        )
        .unwrap();
    }

    assert_ne!(principal, second_account);
    assert!(state.get_workspace(&second_account).unwrap().is_none());
    assert_eq!(
        state.list_workspaces().unwrap().as_array().unwrap().len(),
        1
    );
    assert_eq!(state.list_connections().unwrap().len(), 1);
    assert_eq!(state.device_summaries().unwrap().len(), 1);
    assert_eq!(
        state
            .connection_snapshot_for_device("old-device")
            .unwrap()
            .iter()
            .map(|item| item.base_url.as_str())
            .collect::<Vec<_>>(),
        ["https://example.test"]
    );
    assert_eq!(
        state
            .connection_snapshot_for_device("second-device")
            .unwrap()
            .iter()
            .map(|item| item.base_url.as_str())
            .collect::<Vec<_>>(),
        ["https://second.test"]
    );
    let DeviceEvent::LayoutSnapshot {
        workspaces,
        desktops,
        windows,
    } = state.layout_snapshot("old-device").unwrap()
    else {
        panic!("expected layout snapshot")
    };
    assert_eq!(
        workspaces
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["old-workspace"]
    );
    assert_eq!(
        desktops
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["old-desktop"]
    );
    assert_eq!(
        windows
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["old-window"]
    );
    let (reply, changed) = state
        .apply_layout_changes(
            Some("old-device"),
            &registry::LayoutChanges {
                deleted_workspaces: vec![second_account.clone()],
                ..Default::default()
            },
        )
        .unwrap();
    assert!(changed.is_empty());
    assert_eq!(reply.deleted_workspaces, vec![second_account.clone()]);
    assert!(state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2)",
            params![second_account, second_account],
            |row| row.get::<_, bool>(0)
        )
        .unwrap());
    let response = crate::router(state.clone())
        .oneshot(
            axum::http::Request::builder()
                .uri(format!("/api/device/workspaces/{second_account}/agent"))
                .header(axum::http::header::AUTHORIZATION, "Bearer legacy-token")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
    let same_name_count: i64 = state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM connections WHERE name='board'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(same_name_count, 2);
    assert!(state.delete_connection("board").unwrap());
    assert_eq!(state.list_connections().unwrap().len(), 0);
    assert_eq!(
        state
            .connection_snapshot_for_device("second-device")
            .unwrap()[0]
            .base_url,
        "https://second.test"
    );
    let remaining_name_count: i64 = state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM connections WHERE name='board'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(remaining_name_count, 1);
}
