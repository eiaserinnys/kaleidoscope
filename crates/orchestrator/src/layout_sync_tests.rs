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
        minimized: false,
        maximized: false,
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

async fn next_sse_data(stream: &mut axum::body::BodyDataStream) -> Vec<u8> {
    tokio::time::timeout(Duration::from_secs(2), async {
        let mut pending = String::new();
        loop {
            let bytes = stream.next().await.unwrap().unwrap();
            pending.push_str(std::str::from_utf8(&bytes).unwrap());
            if let Some(start) = pending.find("data: ") {
                let data = &pending[start + 6..];
                if let Some(end) = data.find('\n') {
                    return data[..end].trim().as_bytes().to_vec();
                }
            }
        }
    })
    .await
    .expect("기기 이벤트를 받지 못했습니다")
}

async fn next_sse_event(stream: &mut axum::body::BodyDataStream) -> Value {
    serde_json::from_slice(&next_sse_data(stream).await).unwrap()
}

async fn open_device_stream(
    state: &AppState,
    token: &str,
    registry_version: u32,
) -> axum::body::BodyDataStream {
    let request = Request::builder()
        .method("GET")
        .uri("/api/device/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(registry::REGISTRY_HEADER, registry_version.to_string())
        .body(Body::empty())
        .unwrap();
    router(state.clone())
        .oneshot(request)
        .await
        .unwrap()
        .into_body()
        .into_data_stream()
}

async fn next_layout_snapshot(stream: &mut axum::body::BodyDataStream) -> Vec<u8> {
    loop {
        let data = next_sse_data(stream).await;
        let event: Value = serde_json::from_slice(&data).unwrap();
        if event["event"] == "layout.snapshot" {
            return data;
        }
    }
}

#[test]
fn shortcuts_survive_legacy_desktop_updates_and_parent_deletion_cascades() {
    let state = AppState::in_memory("secret");
    insert_device(&state, "legacy-report", "이전 기기");
    let changes: LayoutChanges = serde_json::from_value(json!({
        "workspaces":[workspace("w", "작업"), workspace("w2", "다른 작업")],
        "desktops":[desktop("d", "w")],
        "desktop_shortcuts":[{"id":"d/app", "desktop_id":"d", "app_id":"app", "column":0, "row":0, "created_at":"now", "updated_at":"now"}]
    })).unwrap();
    state.apply_layout_changes(None, &changes).unwrap();
    let app = json!({"id":"app", "name":"시험", "requires":{"blocks":4,"modules":{}}, "permissions":[], "state":{}, "ui":{"type":"text", "value":"시험"}}).to_string();
    state.publish_app(&app, "test", false, None).unwrap();
    state.delete_app("app", None, None).unwrap();
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                desktops: vec![desktop("d", "w")],
                ..Default::default()
            },
        )
        .unwrap();
    state
        .save_layout(
            "legacy-report",
            &DeviceLayout {
                workspaces: vec![workspace("w", "작업")],
                desktops: vec![desktop("d", "w")],
                ..Default::default()
            },
        )
        .unwrap();
    let account = state.mcp_account_id().unwrap();
    assert_eq!(
        state
            .export_data(&account)
            .unwrap()
            .layout
            .desktop_shortcuts
            .len(),
        1
    );
    let (reply, changed) = state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                deleted_desktops: vec!["d".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(reply.deleted_desktop_shortcuts, vec!["d/app"]);
    assert_eq!(changed.deleted_desktop_shortcuts, vec!["d/app"]);
    assert!(state
        .export_data(&account)
        .unwrap()
        .layout
        .desktop_shortcuts
        .is_empty());
}

#[test]
fn shortcuts_without_owned_parent_are_returned_as_deletions() {
    let state = AppState::in_memory("secret");
    let token = insert_device(&state, "foreign", "다른 계정");
    let _ = token;
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES('other','다른 계정','now')",
            [],
        )
        .unwrap();
        db.execute(
            "UPDATE devices SET account_id='other' WHERE id='foreign'",
            [],
        )
        .unwrap();
    }
    let seed: LayoutChanges = serde_json::from_value(json!({
        "workspaces":[workspace("w", "작업")], "desktops":[desktop("d", "w")],
        "desktop_shortcuts":[{"id":"d/app", "desktop_id":"d", "app_id":"app", "column":1, "row":0, "created_at":"now", "updated_at":"now"}]
    })).unwrap();
    state.apply_layout_changes(None, &seed).unwrap();
    let mut foreign = seed.desktop_shortcuts[0].clone();
    foreign.column = 9;
    let (reply, changed) = state
        .apply_layout_changes(
            Some("foreign"),
            &LayoutChanges {
                desktop_shortcuts: vec![foreign],
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(reply.deleted_desktop_shortcuts, vec!["d/app"]);
    assert!(changed.is_empty());
    let (reply, _) = state.apply_layout_changes(None, &LayoutChanges { desktop_shortcuts: vec![serde_json::from_value(json!({"id":"missing/app", "desktop_id":"missing", "app_id":"app", "column":0, "row":0, "created_at":"now", "updated_at":"now"})).unwrap()], ..Default::default() }).unwrap();
    assert_eq!(reply.deleted_desktop_shortcuts, vec!["missing/app"]);
    let account = state.mcp_account_id().unwrap();
    assert_eq!(
        state
            .export_data(&account)
            .unwrap()
            .layout
            .desktop_shortcuts[0]
            .column,
        1
    );
}

// b77e6ed의 배치 DTO 필드와 unknown field 거부를 그대로 쓴다.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyChanges {
    #[serde(default)]
    workspaces: Vec<Workspace>,
    #[serde(default)]
    desktops: Vec<Desktop>,
    #[serde(default)]
    windows: Vec<AppWindow>,
    #[serde(default)]
    deleted_workspaces: Vec<String>,
    #[serde(default)]
    deleted_desktops: Vec<String>,
    #[serde(default)]
    deleted_windows: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "event")]
enum LegacyLayoutEvent {
    #[serde(rename = "layout.snapshot")]
    Snapshot {
        workspaces: Vec<Workspace>,
        desktops: Vec<Desktop>,
        windows: Vec<AppWindow>,
    },
    #[serde(rename = "layout.changed")]
    Changed { changes: LegacyChanges },
}

#[tokio::test]
async fn legacy_stream_and_post_project_shortcuts_without_losing_them() {
    use http_body_util::BodyExt;
    let state = AppState::in_memory("secret");
    let token = insert_device(&state, "legacy", "옛 기기");
    let initial: LayoutChanges = serde_json::from_value(json!({
        "workspaces":[workspace("w", "작업")], "desktops":[desktop("d", "w")],
        "desktop_shortcuts":[{"id":"d/app", "desktop_id":"d", "app_id":"app", "column":0, "row":0, "created_at":"now", "updated_at":"now"}]
    })).unwrap();
    state.apply_layout_changes(None, &initial).unwrap();
    let request = Request::builder()
        .uri("/api/device/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(
            registry::REGISTRY_HEADER,
            registry::LAYOUT_SYNC_REGISTRY_VERSION.to_string(),
        )
        .body(Body::empty())
        .unwrap();
    let mut stream = router(state.clone())
        .oneshot(request)
        .await
        .unwrap()
        .into_body()
        .into_data_stream();
    assert_eq!(next_sse_event(&mut stream).await["event"], "apps.snapshot");
    let snapshot = next_sse_event(&mut stream).await;
    assert!(snapshot.get("desktop_shortcuts").is_none());
    let old: LegacyLayoutEvent =
        serde_json::from_slice(&serde_json::to_vec(&snapshot).unwrap()).unwrap();
    assert!(
        matches!(old, LegacyLayoutEvent::Snapshot { workspaces, desktops, windows } if workspaces.len() == 1 && desktops.len() == 1 && windows.is_empty())
    );
    let changed: LayoutChanges = serde_json::from_value(json!({
        "desktop_shortcuts":[{"id":"d/app", "desktop_id":"d", "app_id":"app", "column":2, "row":1, "created_at":"now", "updated_at":"later"}]
    })).unwrap();
    let (_, actual) = state.apply_layout_changes(None, &changed).unwrap();
    let account = state.mcp_account_id().unwrap();
    state.send_event_for_account(DeviceEvent::LayoutChanged { changes: actual }, &account);
    let mut post_changes = changed.clone();
    post_changes.desktop_shortcuts[0].column = 3;
    post_changes.desktops.push(desktop("d", "w"));
    let request = Request::builder()
        .method("POST")
        .uri("/api/device/layout/changes")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&post_changes).unwrap()))
        .unwrap();
    let response = router(state.clone()).oneshot(request).await.unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let old: LegacyChanges = serde_json::from_slice(&body).unwrap();
    assert_eq!(old.desktops.len(), 1);
    assert!(
        old.workspaces.is_empty()
            && old.windows.is_empty()
            && old.deleted_workspaces.is_empty()
            && old.deleted_desktops.is_empty()
            && old.deleted_windows.is_empty()
    );
    let mut updated = desktop("d", "w");
    updated.name = "변경".into();
    let (_, actual) = state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                desktops: vec![updated],
                ..Default::default()
            },
        )
        .unwrap();
    state.send_event_for_account(DeviceEvent::LayoutChanged { changes: actual }, &account);
    let event = next_sse_event(&mut stream).await;
    let old: LegacyLayoutEvent =
        serde_json::from_slice(&serde_json::to_vec(&event).unwrap()).unwrap();
    assert!(
        matches!(old, LegacyLayoutEvent::Changed { changes } if changes.desktops.len() == 1 && changes.desktops[0].name == "변경")
    );
    assert_eq!(
        state
            .export_data(&account)
            .unwrap()
            .layout
            .desktop_shortcuts[0]
            .column,
        3
    );
}

#[tokio::test]
async fn transfer_layout_snapshot_projects_shortcuts_by_registry_version() {
    use http_body_util::BodyExt;
    let remote = AppState::in_memory("secret");
    let old_token = insert_device(&remote, "old", "옛 기기");
    let new_token = insert_device(&remote, "new", "새 기기");
    let mut old_stream = open_device_stream(
        &remote,
        &old_token,
        registry::DESKTOP_SHORTCUTS_REGISTRY_VERSION - 1,
    )
    .await;
    next_layout_snapshot(&mut old_stream).await;
    let mut new_stream = open_device_stream(
        &remote,
        &new_token,
        registry::DESKTOP_SHORTCUTS_REGISTRY_VERSION,
    )
    .await;
    next_layout_snapshot(&mut new_stream).await;

    let local = AppState::in_memory("local");
    let local_token = insert_device(&local, "local", "로컬 기기");
    let seed: LayoutChanges = serde_json::from_value(json!({
        "workspaces":[workspace("w", "작업")],
        "desktops":[desktop("d", "w")],
        "desktop_shortcuts":[{"id":"d/app", "desktop_id":"d", "app_id":"app", "column":0, "row":0, "created_at":"now", "updated_at":"now"}]
    }))
    .unwrap();
    local.apply_layout_changes(None, &seed).unwrap();
    let request = Request::builder().uri(kaleidoscope_contract::transfer::TRANSFER_PATH)
        .header(header::AUTHORIZATION, format!("Bearer {local_token}"))
        .body(Body::empty()).unwrap();
    let response = router(local.clone()).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bundle = response.into_body().collect().await.unwrap().to_bytes();
    let request = Request::builder().method("POST").uri(kaleidoscope_contract::transfer::TRANSFER_PATH)
        .header(header::AUTHORIZATION, format!("Bearer {new_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(bundle)).unwrap();
    let response = router(remote.clone()).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let result: kaleidoscope_contract::transfer::TransferResult = serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(result.imported, 3);
    let account = remote.mcp_account_id().unwrap();
    assert_eq!(
        remote
            .export_data(&account)
            .unwrap()
            .layout
            .desktop_shortcuts
            .len(),
        1
    );

    let old_snapshot = next_layout_snapshot(&mut old_stream).await;
    let old: LegacyLayoutEvent = serde_json::from_slice(&old_snapshot).unwrap();
    let old_value: Value = serde_json::from_slice(&old_snapshot).unwrap();
    assert!(old_value.get("desktop_shortcuts").is_none());
    assert!(
        matches!(old, LegacyLayoutEvent::Snapshot { ref desktops, .. } if desktops.len() == 1),
        "옛 연결이 받은 이관 스냅샷이 옛 모양이 아닙니다"
    );

    let new_snapshot = next_layout_snapshot(&mut new_stream).await;
    let event: DeviceEvent = serde_json::from_slice(&new_snapshot).unwrap();
    assert!(matches!(event, DeviceEvent::LayoutSnapshot { desktop_shortcuts, .. } if desktop_shortcuts.len() == 1 && desktop_shortcuts[0].id == "d/app"));
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
async fn legacy_layout_sharing_never_populates_shared_views() {
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
    assert!(state.shared_views("w").unwrap().is_empty());
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
    assert!(state.shared_views("w").unwrap().is_empty());
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
            "latest",
            &DeviceLayout {
                workspaces: vec![workspace("w", "작업")],
                active_workspace_id: Some("w".into()),
                ..Default::default()
            },
        )
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

#[tokio::test]
async fn open_target_prefers_the_device_displaying_the_requested_workspace() {
    let state = AppState::in_memory("secret");
    state
        .apply_layout_changes(
            None,
            &LayoutChanges {
                workspaces: vec![workspace("w", "작업"), workspace("other", "다른 작업")],
                ..Default::default()
            },
        )
        .unwrap();
    for (id, active) in [("a", "w"), ("b", "other")] {
        insert_device(&state, id, id);
        state
            .save_layout(
                id,
                &DeviceLayout {
                    workspaces: vec![workspace("w", "작업"), workspace("other", "다른 작업")],
                    active_workspace_id: Some(active.into()),
                    ..Default::default()
                },
            )
            .unwrap();
    }
    let _a = state
        .stream_with_registry(
            "a".into(),
            Some(Supported::current()),
            registry::LAYOUT_SYNC_REGISTRY_VERSION,
        )
        .unwrap();
    let _b = state
        .stream_with_registry(
            "b".into(),
            Some(Supported::current()),
            registry::LAYOUT_SYNC_REGISTRY_VERSION,
        )
        .unwrap();
    state.lock_db().unwrap().execute("UPDATE devices SET last_active_at=CASE id WHEN 'a' THEN '2026-10-29' ELSE '2026-10-30' END", []).unwrap();
    let requires = serde_json::from_str::<kaleidoscope_contract::AppDefinition>(LEGACY_APP)
        .unwrap()
        .requires;
    let target = state
        .choose_open_target(Some("w"), None, &requires, &[])
        .unwrap();
    assert_eq!(target.as_ref().map(|target| target.id.as_str()), Some("a"));
    state
        .save_layout(
            "a",
            &DeviceLayout {
                workspaces: vec![workspace("w", "작업"), workspace("other", "다른 작업")],
                active_workspace_id: Some("other".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(state
        .choose_open_target(Some("w"), None, &requires, &[])
        .unwrap()
        .is_none());
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
    state
        .save_layout(
            "sync",
            &DeviceLayout {
                workspaces: vec![workspace("w", "작업")],
                active_workspace_id: Some("w".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let mut definition: Value = serde_json::from_str(&test_definition(EDITOR)).unwrap();
    definition["name"] = json!("편집기 새 버전");
    definition["requires"]["blocks"] = json!(15);
    definition["state"] = json!({"current_file":null,"source":0,"added":7});
    definition["state_migrate"] = json!({"source":"$state.current_file != null ? 1 : 0"});
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
    assert_eq!(
        stored.state.get("source").and_then(Value::as_f64),
        Some(1.0)
    );
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
