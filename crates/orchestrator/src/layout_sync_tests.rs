use super::*;
use axum::body::Body;
use futures::StreamExt;
use kaleidoscope_contract::{
    registry::{DeviceLayout, LayoutChanges},
    AppWindow, Desktop, Rect, SentShareContext, Workspace,
};
use std::collections::BTreeMap;
use tower::ServiceExt;

const EDITOR: &str = include_str!("fixtures/editor-app.json");
const LEGACY_APP: &str = include_str!("fixtures/simple-app.json");

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
        sharing: Vec::new(),
        last_sent_context: Default::default(),
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
            "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?2,(SELECT account_id FROM mcp_principal WHERE id=1),?3,?4)",
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

#[test]
fn layout_changes_validate_shared_context_ids_and_text_size() {
    let mut value = desktop("d", "w");
    value.sharing = vec!["window".into()];
    value.last_sent_context.insert(
        "thread".into(),
        BTreeMap::from([(
            "window".into(),
            SentShareContext {
                app_name: Some("앱".into()),
                text: Some("화면".into()),
                visual_hash: Some("hash".into()),
            },
        )]),
    );
    let valid = LayoutChanges {
        desktops: vec![value.clone()],
        ..Default::default()
    };
    assert!(layout_changes::validate_changes(&valid));

    value.sharing = vec!["  ".into()];
    assert!(!layout_changes::validate_changes(&LayoutChanges {
        desktops: vec![value.clone()],
        ..Default::default()
    }));
    value.sharing = vec!["x".repeat(129)];
    assert!(!layout_changes::validate_changes(&LayoutChanges {
        desktops: vec![value.clone()],
        ..Default::default()
    }));
    value.sharing = vec!["window".into()];
    value
        .last_sent_context
        .get_mut("thread")
        .unwrap()
        .get_mut("window")
        .unwrap()
        .text = Some("x".repeat(kaleidoscope_contract::SHARE_TEXT_MAX_BYTES + 1));
    assert!(!layout_changes::validate_changes(&LayoutChanges {
        desktops: vec![value],
        ..Default::default()
    }));
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
async fn desktop_share_context_changes_reach_post_event_and_another_device_snapshot() {
    use http_body_util::BodyExt;

    let state = AppState::in_memory("secret");
    let first_token = insert_device(&state, "first", "첫 기기");
    let second_token = insert_device(&state, "second", "둘째 기기");
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w", "작업")],
                desktops: vec![desktop("d", "w")],
                windows: vec![window("win", "d", "unknown")],
                ..Default::default()
            },
        )
        .unwrap();

    let first_request = Request::builder()
        .method("GET")
        .uri("/api/device/events")
        .header(header::AUTHORIZATION, format!("Bearer {first_token}"))
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
    let first_response = router(state.clone()).oneshot(first_request).await.unwrap();
    let mut first_stream = first_response.into_body().into_data_stream();
    assert_eq!(
        next_sse_event(&mut first_stream).await["event"],
        "apps.snapshot"
    );
    assert_eq!(
        next_sse_event(&mut first_stream).await["event"],
        "connections.snapshot"
    );
    assert_eq!(
        next_sse_event(&mut first_stream).await["event"],
        "layout.snapshot"
    );

    let mut updated_desktop = desktop("d", "w");
    updated_desktop.sharing = vec!["win".into()];
    updated_desktop.last_sent_context.insert(
        "thread".into(),
        BTreeMap::from([(
            "win".into(),
            SentShareContext {
                app_name: Some("문서".into()),
                text: Some("마지막 글".into()),
                visual_hash: Some("image-hash".into()),
            },
        )]),
    );
    let changes = LayoutChanges {
        desktops: vec![updated_desktop.clone()],
        ..Default::default()
    };
    let request = Request::builder()
        .method("POST")
        .uri("/api/device/layout/changes")
        .header(header::AUTHORIZATION, format!("Bearer {first_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&changes).unwrap()))
        .unwrap();
    let response = router(state.clone()).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reply: LayoutChanges =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(reply.desktops, vec![updated_desktop.clone()]);

    let changed = next_sse_event(&mut first_stream).await;
    assert_eq!(changed["event"], "layout.changed");
    assert_eq!(changed["changes"]["desktops"][0]["sharing"][0], "win");
    assert_eq!(
        changed["changes"]["desktops"][0]["last_sent_context"]["thread"]["win"]["text"],
        "마지막 글"
    );

    let second_request = Request::builder()
        .method("GET")
        .uri("/api/device/events")
        .header(header::AUTHORIZATION, format!("Bearer {second_token}"))
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
    let second_response = router(state.clone()).oneshot(second_request).await.unwrap();
    let mut second_stream = second_response.into_body().into_data_stream();
    assert_eq!(
        next_sse_event(&mut second_stream).await["event"],
        "apps.snapshot"
    );
    assert_eq!(
        next_sse_event(&mut second_stream).await["event"],
        "connections.snapshot"
    );
    let snapshot = next_sse_event(&mut second_stream).await;
    assert_eq!(snapshot["event"], "layout.snapshot");
    assert_eq!(snapshot["desktops"][0]["sharing"][0], "win");
    assert_eq!(
        snapshot["desktops"][0]["last_sent_context"]["thread"]["win"]["visual_hash"],
        "image-hash"
    );
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
        state.open_sent_to(
            target.as_ref(),
            Some("w"),
            &app.version.definition.requires,
            &app.version.definition.assets
        ),
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

#[test]
fn revoking_device_drops_its_layout_report_from_workspace_queries() {
    let state = AppState::in_memory("secret");
    insert_device(&state, "pc", "PC");
    insert_device(&state, "probe", "Probe");
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w", "작업")],
                ..Default::default()
            },
        )
        .unwrap();
    let report = |active: &str| DeviceLayout {
        workspaces: vec![workspace("w", "작업")],
        active_workspace_id: Some(active.into()),
        ..Default::default()
    };
    state.save_layout("pc", &report("w")).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    state.save_layout("probe", &report("w")).unwrap();
    assert_eq!(
        state.get_workspace("w").unwrap().unwrap()["device"]["name"],
        "Probe"
    );

    assert!(state.revoke_device("probe").unwrap());
    let rows: i64 = state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM device_layouts WHERE device_id='probe'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rows, 0);
    assert_eq!(
        state.get_workspace("w").unwrap().unwrap()["device"]["name"],
        "PC"
    );
}

#[test]
fn layout_report_counts_as_activity_only_when_device_choices_change() {
    let state = AppState::in_memory("secret");
    insert_device(&state, "pc", "PC");
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w", "작업"), workspace("v", "다른 작업")],
                ..Default::default()
            },
        )
        .unwrap();
    let last_active = |state: &AppState| -> Option<String> {
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT last_active_at FROM devices WHERE id='pc'",
                [],
                |row| row.get(0),
            )
            .unwrap()
    };
    let mut layout = DeviceLayout {
        workspaces: vec![workspace("w", "작업")],
        active_workspace_id: Some("w".into()),
        ..Default::default()
    };
    state.save_layout("pc", &layout).unwrap();
    assert!(last_active(&state).is_some(), "첫 보고는 활동이다");

    let marker = "2000-01-01T00:00:00Z".to_string();
    let reset = |state: &AppState| {
        state
            .lock_db()
            .unwrap()
            .execute(
                "UPDATE devices SET last_active_at=?1 WHERE id='pc'",
                [&marker],
            )
            .unwrap();
    };
    reset(&state);
    // 다른 기기의 변경을 반영해 다시 보고한 것(공유 배치만 바뀜)은 활동이 아니다.
    layout.windows = vec![window("x", "d", "test-md-editor")];
    state.save_layout("pc", &layout).unwrap();
    assert_eq!(last_active(&state), Some(marker.clone()));

    // 지금 보는 워크스페이스를 바꾼 것은 활동이다.
    layout.active_workspace_id = Some("v".into());
    state.save_layout("pc", &layout).unwrap();
    assert_ne!(last_active(&state), Some(marker.clone()));
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
    let (first, unchanged) = state
        .publish_app(&test_definition(EDITOR), "agent", false, None)
        .unwrap();
    assert!(!unchanged);
    let mut saved = window("win", "d", "test-md-editor");
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
    let mut definition: Value = serde_json::from_str(&test_definition(EDITOR)).unwrap();
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
        matches!(events.try_recv().unwrap().event, DeviceEvent::AppOpen { app_id, workspace_id: Some(id) } if app_id == "test-md-editor" && id == "w")
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
