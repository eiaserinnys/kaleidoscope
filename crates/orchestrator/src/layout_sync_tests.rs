use super::*;
use axum::body::Body;
use futures::StreamExt;
use kaleidoscope_contract::{
    registry::{DeviceLayout, LayoutChanges},
    AppWindow, Desktop, Rect, Workspace,
};
use std::collections::BTreeMap;
use tower::ServiceExt;

const EDITOR: &str = include_str!("../../../examples/md-editor.json");
const LEGACY_APP: &str = include_str!("../../../examples/workspace-pas.json");

fn workspace(id: &str, name: &str) -> Workspace {
    Workspace {
        id: id.into(),
        name: name.into(),
        created_at: format!("{id}-created"),
        updated_at: format!("{id}-updated"),
    }
}

fn desktop(id: &str, workspace_id: &str) -> Desktop {
    Desktop {
        id: id.into(),
        workspace_id: workspace_id.into(),
        name: id.into(),
        position: 0,
        created_at: format!("{id}-created"),
        updated_at: format!("{id}-updated"),
    }
}

fn window(id: &str, desktop_id: &str, app_id: &str) -> AppWindow {
    AppWindow {
        id: id.into(),
        desktop_id: desktop_id.into(),
        app_id: app_id.into(),
        app_version: 1,
        rect: Rect {
            x: 0,
            y: 0,
            width: 200,
            height: 120,
        },
        z: 1,
        state: Default::default(),
        created_at: format!("{id}-created"),
        updated_at: format!("{id}-updated"),
    }
}

fn insert_device(state: &AppState, id: &str, name: &str) -> String {
    let token = random_token();
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO devices(id,name,token_sha256,created_at) VALUES(?1,?2,?3,?4)",
            params![id, name, sha256_hex(token.as_bytes()), timestamp()],
        )
        .unwrap();
    token
}

async fn next_sse_event(stream: &mut axum::body::BodyDataStream) -> Value {
    tokio::time::timeout(Duration::from_secs(2), async {
        let mut pending = String::new();
        loop {
            let bytes = stream.next().await.unwrap().unwrap();
            pending.push_str(std::str::from_utf8(&bytes).unwrap());
            if let Some(start) = pending.find("data: ") {
                let data = &pending[start + 6..];
                if let Some(end) = data.find('\n') {
                    return serde_json::from_str(data[..end].trim()).unwrap();
                }
            }
        }
    })
    .await
    .expect("기기 이벤트를 받지 못했습니다")
}

#[test]
fn layout_changes_report_skipped_upserts_delete_precedence_cascades_and_last_workspace() {
    let state = AppState::in_memory("secret");
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w1", "첫 작업"), workspace("w2", "둘째 작업")],
                desktops: vec![desktop("d1", "w1"), desktop("d2", "w2")],
                windows: vec![
                    window("win1", "d1", "unknown"),
                    window("win2", "d2", "unknown"),
                ],
                ..Default::default()
            },
        )
        .unwrap();

    let (reply, changed) = state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w1", "upserted then deleted")],
                desktops: vec![desktop("missing-desktop", "missing-workspace")],
                windows: vec![window("missing-window", "missing-desktop", "unknown")],
                deleted_workspaces: vec!["w1".into()],
                deleted_windows: vec!["win1".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert!(reply.deleted_workspaces.contains(&"w1".to_string()));
    assert!(reply.deleted_desktops.contains(&"d1".to_string()));
    assert!(reply
        .deleted_desktops
        .contains(&"missing-desktop".to_string()));
    assert!(reply.deleted_windows.contains(&"win1".to_string()));
    assert!(reply
        .deleted_windows
        .contains(&"missing-window".to_string()));
    assert!(changed.deleted_workspaces.contains(&"w1".to_string()));
    assert!(changed.deleted_desktops.contains(&"d1".to_string()));
    assert!(changed.deleted_windows.contains(&"win1".to_string()));
    assert!(changed.workspaces.is_empty());

    let (refused, changed) = state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                deleted_workspaces: vec!["w2".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert!(changed.is_empty());
    assert_eq!(refused.workspaces, vec![workspace("w2", "둘째 작업")]);
    assert_eq!(refused.desktops, vec![desktop("d2", "w2")]);
    assert_eq!(refused.windows, vec![window("win2", "d2", "unknown")]);
}

#[tokio::test]
async fn registry_six_stream_sends_layout_snapshot_after_other_snapshots() {
    let state = AppState::in_memory("secret");
    let token = insert_device(&state, "sync", "Sync PC");
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w", "작업")],
                ..Default::default()
            },
        )
        .unwrap();
    let request = Request::builder()
        .method("GET")
        .uri("/api/device/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(
            registry::SUPPORTED_HEADER,
            serde_json::to_string(&Supported::current()).unwrap(),
        )
        .header(
            registry::REGISTRY_HEADER,
            registry::LAYOUT_SYNC_REGISTRY_VERSION.to_string(),
        )
        .body(Body::empty())
        .unwrap();
    let response = router(state.clone()).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let mut stream = response.into_body().into_data_stream();
    assert_eq!(next_sse_event(&mut stream).await["event"], "apps.snapshot");
    assert_eq!(
        next_sse_event(&mut stream).await["event"],
        "connections.snapshot"
    );
    let layout = next_sse_event(&mut stream).await;
    assert_eq!(layout["event"], "layout.snapshot");
    assert_eq!(layout["workspaces"][0]["id"], "w");
    assert!(state.0.layout_sync_devices.lock().unwrap().contains("sync"));
    assert!(state
        .event_for_device(
            "legacy",
            DeviceEvent::LayoutChanged {
                changes: LayoutChanges::default()
            }
        )
        .is_none());
}

#[tokio::test]
async fn latest_sync_device_gets_open_while_legacy_targeting_remains() {
    let state = AppState::in_memory("secret");
    for (id, name) in [
        ("older", "Older PC"),
        ("latest", "Latest PC"),
        ("legacy", "Legacy PC"),
    ] {
        insert_device(&state, id, name);
    }
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w", "작업")],
                ..Default::default()
            },
        )
        .unwrap();
    let _older = state
        .stream_with_registry(
            "older".into(),
            Some(Supported::current()),
            registry::LAYOUT_SYNC_REGISTRY_VERSION,
        )
        .unwrap();
    let _latest = state
        .stream_with_registry(
            "latest".into(),
            Some(Supported::current()),
            registry::LAYOUT_SYNC_REGISTRY_VERSION,
        )
        .unwrap();
    let _legacy = state
        .stream_with_registry("legacy".into(), None, 0)
        .unwrap();
    state
        .save_layout(
            "legacy",
            &DeviceLayout {
                workspaces: vec![workspace("w", "작업")],
                ..Default::default()
            },
        )
        .unwrap();
    state
        .lock_db()
        .unwrap()
        .execute(
            "UPDATE devices SET last_active_at=CASE id WHEN 'older' THEN '2026-10-29T00:00:00Z' ELSE '2026-10-30T00:00:00Z' END",
            [],
        )
        .unwrap();

    let mut events = state.0.events.subscribe();
    let (app, unchanged, target) = state
        .publish_app_with_target(LEGACY_APP, "agent", true, Some("w".into()))
        .unwrap();
    assert!(!unchanged);
    assert_eq!(
        target.as_ref().map(|target| target.name.as_str()),
        Some("Latest PC")
    );
    assert_eq!(
        state.open_sent_to(target.as_ref(), Some("w"), &app.version.definition.requires),
        2
    );
    let broadcast = events.try_recv().unwrap();
    let other_sync = state
        .event_for_broadcast("older", broadcast.clone())
        .unwrap();
    assert!(matches!(
        other_sync,
        DeviceEvent::AppPublished {
            open: false,
            workspace_id: None,
            ..
        }
    ));
    let target_sync = state
        .event_for_broadcast("latest", broadcast.clone())
        .unwrap();
    assert!(
        matches!(target_sync, DeviceEvent::AppPublished { open: true, workspace_id: Some(id), .. } if id == "w")
    );
    let legacy = state.event_for_broadcast("legacy", broadcast).unwrap();
    assert!(
        matches!(legacy, DeviceEvent::AppPublished { open: true, workspace_id: Some(id), .. } if id == "w")
    );
}

#[tokio::test]
async fn app_version_moves_saved_windows_before_sending_open() {
    let state = AppState::in_memory("secret");
    insert_device(&state, "sync", "Sync PC");
    let _stream = state
        .stream_with_registry(
            "sync".into(),
            Some(Supported::current()),
            registry::LAYOUT_SYNC_REGISTRY_VERSION,
        )
        .unwrap();
    let (first, unchanged) = state.publish_app(EDITOR, "agent", false, None).unwrap();
    assert!(!unchanged);
    let mut saved = window("win", "d", "md-editor");
    saved.app_version = first.version.version;
    saved.state = BTreeMap::from([
        ("current_file".into(), json!("notes/a.md")),
        ("removed".into(), json!(true)),
    ]);
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w", "작업")],
                desktops: vec![desktop("d", "w")],
                windows: vec![saved],
                ..Default::default()
            },
        )
        .unwrap();
    let mut definition: Value = serde_json::from_str(EDITOR).unwrap();
    definition["name"] = json!("편집기 새 버전");
    definition["state"] = json!({"current_file":null,"added":7});
    let mut events = state.0.events.subscribe();

    let (published, unchanged, target) = state
        .publish_app_with_target(&definition.to_string(), "agent", true, Some("w".into()))
        .unwrap();
    assert!(!unchanged);
    assert_eq!(
        target.as_ref().map(|target| target.id.as_str()),
        Some("sync")
    );
    assert_eq!(published.version.version, 2);
    let raw: String = state
        .lock_db()
        .unwrap()
        .query_row("SELECT data FROM windows WHERE id='win'", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap();
    let stored: AppWindow = serde_json::from_str(&raw).unwrap();
    assert_eq!(stored.app_version, 2);
    assert_eq!(stored.state.get("current_file"), Some(&json!("notes/a.md")));
    assert_eq!(stored.state.get("added"), Some(&json!(7)));
    assert!(!stored.state.contains_key("removed"));
    assert!(matches!(
        events.try_recv().unwrap().event,
        DeviceEvent::AppPublished {
            open: false,
            workspace_id: None,
            ..
        }
    ));
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::LayoutChanged { changes } if changes.windows == vec![stored.clone()])
    );
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::AppOpen { app_id, workspace_id: Some(id) } if app_id == "md-editor" && id == "w")
    );
}

#[tokio::test]
async fn desktop_delete_removes_child_window_from_database_reply_and_event() {
    use http_body_util::BodyExt;

    let state = AppState::in_memory("secret");
    let token = insert_device(&state, "sync", "Sync PC");
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w", "작업")],
                desktops: vec![desktop("d", "w")],
                windows: vec![window("x", "d", "unknown")],
                ..Default::default()
            },
        )
        .unwrap();
    let _stream = state
        .stream_with_registry(
            "sync".into(),
            Some(Supported::current()),
            registry::LAYOUT_SYNC_REGISTRY_VERSION,
        )
        .unwrap();
    let mut events = state.0.events.subscribe();
    let changes = LayoutChanges {
        deleted_desktops: vec!["d".into()],
        ..Default::default()
    };
    let request = Request::builder()
        .method("POST")
        .uri("/api/device/layout/changes")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&changes).unwrap()))
        .unwrap();

    let response = router(state.clone()).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reply: LayoutChanges =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert!(reply.windows.is_empty());
    assert_eq!(reply.deleted_desktops, vec!["d"]);
    assert_eq!(reply.deleted_windows, vec!["x"]);
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row("SELECT count(*) FROM windows WHERE id='x'", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
    let event = events.try_recv().unwrap().event;
    assert!(matches!(
        state.event_for_device("sync", event).unwrap(),
        DeviceEvent::LayoutChanged { changes }
            if changes.windows.is_empty()
                && changes.deleted_desktops == vec!["d"]
                && changes.deleted_windows == vec!["x"]
    ));
}
