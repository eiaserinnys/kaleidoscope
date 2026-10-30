use super::tests::make_device;
use super::*;
use axum::body::Body;
use tower::ServiceExt;

#[test]
fn migration_v5_builds_canonical_layout_from_live_reports_in_report_order() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,last_seen_at TEXT,revoked_at TEXT);
        CREATE TABLE device_layouts(device_id TEXT PRIMARY KEY,layout TEXT NOT NULL,reported_at TEXT NOT NULL);
        CREATE TABLE agents(workspace_id TEXT PRIMARY KEY);
        CREATE TABLE agent_items(id INTEGER PRIMARY KEY,attachments TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE connections(name TEXT PRIMARY KEY,kind TEXT NOT NULL,base_url TEXT NOT NULL,writable INTEGER NOT NULL,paths TEXT NOT NULL DEFAULT '[]',headers TEXT NOT NULL DEFAULT '{}',issuer TEXT,scopes TEXT,resource TEXT,description TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
        INSERT INTO devices(id,name,token_sha256,created_at) VALUES('early','Early','a','now'),('late','Late','b','now');
        INSERT INTO devices(id,name,token_sha256,created_at,revoked_at) VALUES('revoked','Revoked','c','now','revoked');
        PRAGMA user_version=4;").unwrap();
    let report = |name: &str| {
        json!({
        "workspaces":[{"id":"w","name":name,"created_at":"created","updated_at":"updated"}],
        "desktops":[{"id":"d","workspace_id":"w","name":"Desktop","position":0,"created_at":"created","updated_at":"updated"},{"id":"orphan-desktop","workspace_id":"missing","name":"Orphan","position":0,"created_at":"created","updated_at":"updated"}],
        "windows":[{"id":"win","desktop_id":"d","app_id":"unknown","app_version":1,"rect":{"x":0,"y":0,"width":10,"height":10},"z":1,"state":{},"created_at":"created","updated_at":"updated"},{"id":"orphan-window","desktop_id":"orphan-desktop","app_id":"unknown","app_version":1,"rect":{"x":0,"y":0,"width":10,"height":10},"z":1,"state":{},"created_at":"created","updated_at":"updated"}],
        "folders":[],"active_workspace_id":"w","active_desktop_ids":{"w":"d"},"data_errors":[]
    }).to_string()
    };
    db.execute(
        "INSERT INTO device_layouts VALUES('early',?1,'2026-01-01T00:00:00Z')",
        [report("old")],
    )
    .unwrap();
    db.execute(
        "INSERT INTO device_layouts VALUES('late',?1,'2026-01-02T00:00:00Z')",
        [report("new")],
    )
    .unwrap();
    db.execute(
        "INSERT INTO device_layouts VALUES('revoked',?1,'2026-01-03T00:00:00Z')",
        [report("revoked")],
    )
    .unwrap();

    migrate(&db).unwrap();

    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 8);
    let workspace: String = db
        .query_row("SELECT data FROM workspaces WHERE id='w'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&workspace).unwrap()["name"],
        "new"
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM desktops WHERE id='orphan-desktop'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM windows WHERE id='orphan-window'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT last_active_at FROM devices WHERE id='late'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "2026-01-02T00:00:00Z"
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM device_layouts WHERE device_id='revoked'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM workspaces WHERE id='revoked'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[tokio::test]
async fn layout_changes_route_returns_current_state_and_broadcasts_only_real_changes() {
    use http_body_util::BodyExt;
    use kaleidoscope_contract::{registry::LayoutChanges, AppWindow, Desktop, Rect, Workspace};
    let state = AppState::in_memory("secret");
    let (_, token) = make_device(&state);
    let mut events = state.0.events.subscribe();
    let workspace = Workspace {
        id: "w".into(),
        name: "작업".into(),
        created_at: "created".into(),
        updated_at: "updated".into(),
    };
    let desktop = Desktop {
        id: "d".into(),
        workspace_id: "w".into(),
        name: "화면".into(),
        position: 0,
        created_at: "created".into(),
        updated_at: "updated".into(),
    };
    let window = AppWindow {
        id: "win".into(),
        desktop_id: "d".into(),
        app_id: "not-installed".into(),
        app_version: 1,
        rect: Rect {
            x: 0,
            y: 0,
            width: 20,
            height: 20,
        },
        z: 1,
        state: Default::default(),
        created_at: "created".into(),
        updated_at: "updated".into(),
    };
    let changes = LayoutChanges {
        workspaces: vec![workspace],
        desktops: vec![desktop],
        windows: vec![window],
        ..Default::default()
    };
    let call = |changes: &LayoutChanges| {
        Request::builder()
            .method("POST")
            .uri(registry::DEVICE_LAYOUT_CHANGES_PATH)
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(changes).unwrap()))
            .unwrap()
    };
    let response = router(state.clone()).oneshot(call(&changes)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reply: LayoutChanges =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(reply.workspaces[0].id, "w");
    assert_eq!(reply.desktops[0].id, "d");
    assert_eq!(reply.windows[0].id, "win");
    let event = events.try_recv().unwrap();
    assert!(matches!(event.event,DeviceEvent::LayoutChanged{changes} if changes.windows.len()==1));
    let response = router(state.clone()).oneshot(call(&changes)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(events.try_recv().is_err());
}

#[test]
fn canonical_workspace_delete_cascades_and_last_workspace_delete_is_refused() {
    use kaleidoscope_contract::{registry::LayoutChanges, AppWindow, Desktop, Rect, Workspace};
    let state = AppState::in_memory("secret");
    let workspace = |id: &str| Workspace {
        id: id.into(),
        name: id.into(),
        created_at: id.into(),
        updated_at: id.into(),
    };
    let desktop = Desktop {
        id: "d".into(),
        workspace_id: "w".into(),
        name: "화면".into(),
        position: 0,
        created_at: "d".into(),
        updated_at: "d".into(),
    };
    let window = AppWindow {
        id: "win".into(),
        desktop_id: "d".into(),
        app_id: "unknown".into(),
        app_version: 1,
        rect: Rect {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
        },
        z: 0,
        state: Default::default(),
        created_at: "win".into(),
        updated_at: "win".into(),
    };
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w"), workspace("w2"), workspace("w3")],
                desktops: vec![desktop],
                windows: vec![window],
                ..Default::default()
            },
        )
        .unwrap();
    let (last, changed) = state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                deleted_workspaces: vec!["w2".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert!(last.deleted_workspaces.contains(&"w2".to_string()));
    assert!(changed.deleted_workspaces.contains(&"w2".to_string()));
    let (_, changed) = state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                deleted_workspaces: vec!["w".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert!(changed.deleted_desktops.contains(&"d".to_string()));
    assert!(changed.deleted_windows.contains(&"win".to_string()));
    let (refused, changed) = state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                deleted_workspaces: vec!["w3".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert!(refused.workspaces.iter().any(|item| item.id == "w3"));
    assert!(changed.is_empty());
}

#[test]
fn layout_events_are_only_delivered_to_registry_six_devices() {
    use kaleidoscope_contract::registry::LayoutChanges;
    let state = AppState::in_memory("secret");
    let event = DeviceEvent::LayoutChanged {
        changes: LayoutChanges::default(),
    };
    assert!(state.event_for_device("legacy", event.clone()).is_none());
    state
        .0
        .layout_sync_devices
        .lock()
        .unwrap()
        .insert("current".into());
    assert!(matches!(
        state.event_for_device("current", event),
        Some(DeviceEvent::LayoutChanged { .. })
    ));
}
