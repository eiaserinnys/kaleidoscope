use super::*;
use kaleidoscope_contract::registry::LayoutChanges;

#[test]
fn linked_commands_record_pending_and_server_events_preserve_it() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(dir.path(), vec![], &host, registry_client());
    mark_connected(&core);
    let (workspace_id, _) = active_ids(&core);
    core.handle(CoreRequest::WorkspaceRename {
        workspace_id: workspace_id.clone(),
        name: "이 기기".into(),
    })
    .unwrap();
    let sync: Value =
        serde_json::from_slice(&fs::read(dir.path().join("sync.json")).unwrap()).unwrap();
    assert!(sync["pending"]
        .as_array()
        .unwrap()
        .iter()
        .any(|key| key["kind"] == "workspace" && key["id"] == workspace_id));

    let mut remote = snapshot(&core).shared.workspaces[0].clone();
    remote.name = "다른 기기".into();
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges {
                workspaces: vec![remote],
                ..Default::default()
            },
        },
    );
    assert_eq!(snapshot(&core).shared.workspaces[0].name, "이 기기");
}

#[test]
fn first_snapshot_replaces_empty_local_workspace_and_selects_server_workspace() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(dir.path(), vec![], &host, registry_client());
    mark_connected(&core);
    let (old_workspace, _) = active_ids(&core);
    let workspace = crate::state_commands::new_workspace("서버 작업".into(), "now".into());
    let desktop = crate::state_commands::new_desktop(
        workspace.id.clone(),
        "서버 화면".into(),
        0,
        "now".into(),
    );
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: vec![workspace.clone()],
            desktops: vec![desktop.clone()],
            windows: vec![],
        },
    );
    let current = snapshot(&core);
    assert!(!current
        .shared
        .workspaces
        .iter()
        .any(|w| w.id == old_workspace));
    assert_eq!(
        current.device.active_workspace_id.as_deref(),
        Some(workspace.id.as_str())
    );
    assert_eq!(current.device.active_desktop_ids[&workspace.id], desktop.id);
}

#[test]
fn server_deletion_cleans_selected_workspace_and_grants() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        registry_client(),
    );
    let (old_workspace, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    host.choose(Some(dir.path().to_path_buf()));
    pick_folder(&core, &window);
    let other = match core
        .handle(CoreRequest::WorkspaceCreate {
            name: "다른 작업".into(),
        })
        .unwrap()
    {
        CoreReply::WorkspaceCreate { workspace, .. } => workspace.id,
        _ => unreachable!(),
    };
    core.handle(CoreRequest::WorkspaceActivate {
        workspace_id: old_workspace.clone(),
    })
    .unwrap();
    mark_connected(&core);
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges {
                deleted_workspaces: vec![old_workspace],
                ..Default::default()
            },
        },
    );
    let current = snapshot(&core);
    assert_eq!(
        current.device.active_workspace_id.as_deref(),
        Some(other.as_str())
    );
    assert!(current.device.grants.is_empty());
    assert!(!current.shared.windows.iter().any(|w| w.id == window));
}

fn is_pending(core: &Core, kind: crate::sync_state::EntityKind, id: &str) -> bool {
    core.inner.state.lock().unwrap().sync.contains(kind, id)
}

#[test]
fn local_commands_track_changed_entities_including_deletions() {
    use crate::sync_state::EntityKind::{Desktop, Window, Workspace};
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        registry_client(),
    );
    mark_connected(&core);
    let (initial, desktop) = active_ids(&core);
    let (created, child) = match core
        .handle(CoreRequest::WorkspaceCreate {
            name: "새 작업".into(),
        })
        .unwrap()
    {
        CoreReply::WorkspaceCreate { workspace, desktop } => (workspace.id, desktop.id),
        _ => unreachable!(),
    };
    assert!(is_pending(&core, Workspace, &created));
    assert!(is_pending(&core, Desktop, &child));
    core.handle(CoreRequest::WorkspaceRename {
        workspace_id: created.clone(),
        name: "수정".into(),
    })
    .unwrap();
    let extra = match core
        .handle(CoreRequest::DesktopCreate {
            workspace_id: initial.clone(),
            name: "화면".into(),
        })
        .unwrap()
    {
        CoreReply::DesktopCreate { desktop } => desktop.id,
        _ => unreachable!(),
    };
    core.handle(CoreRequest::DesktopRename {
        desktop_id: extra.clone(),
        name: "화면 수정".into(),
    })
    .unwrap();
    assert!(is_pending(&core, Desktop, &extra));
    let window = open_window(&core, &desktop, "test-md-editor");
    core.handle(CoreRequest::WindowSetRect {
        window_id: window.clone(),
        rect: Rect {
            x: 20,
            y: 20,
            width: 500,
            height: 400,
        },
    })
    .unwrap();
    let mut next = BTreeMap::new();
    next.insert("current_file".into(), json!("notes.md"));
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: next,
    })
    .unwrap();
    assert!(is_pending(&core, Window, &window));
    core.handle(CoreRequest::WindowClose {
        window_id: window.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::DesktopDelete {
        desktop_id: extra.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::WorkspaceDelete {
        workspace_id: created.clone(),
    })
    .unwrap();
    assert!(is_pending(&core, Window, &window));
    assert!(is_pending(&core, Desktop, &extra));
    assert!(is_pending(&core, Workspace, &created));
    assert!(is_pending(&core, Desktop, &child));
}

#[test]
fn first_sync_keeps_populated_local_work_and_pending_wins_in_both_events() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        registry_client(),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    let local = snapshot(&core).shared;
    mark_connected(&core);
    let mut remote = local.workspaces[0].clone();
    remote.name = "서버".into();
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: vec![remote.clone()],
            desktops: local.desktops.clone(),
            windows: local.windows.clone(),
        },
    );
    assert_eq!(
        snapshot(&core).shared.workspaces[0].name,
        local.workspaces[0].name
    );
    assert!(is_pending(
        &core,
        crate::sync_state::EntityKind::Window,
        &window
    ));
    remote.name = "다른 변경".into();
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges {
                workspaces: vec![remote],
                deleted_windows: vec![window.clone()],
                ..Default::default()
            },
        },
    );
    assert_eq!(
        snapshot(&core).shared.workspaces[0].name,
        local.workspaces[0].name
    );
    assert!(snapshot(&core)
        .shared
        .windows
        .iter()
        .any(|w| w.id == window));
    core.inner.generation.fetch_add(1, Ordering::SeqCst);
}

#[test]
fn snapshot_from_empty_server_uploads_all_local_entities_and_migrates_remote_window() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        registry_client(),
    );
    let (workspace, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    mark_connected(&core);
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: vec![],
            desktops: vec![],
            windows: vec![],
        },
    );
    for (kind, id) in [
        (crate::sync_state::EntityKind::Workspace, &workspace),
        (crate::sync_state::EntityKind::Desktop, &desktop),
        (crate::sync_state::EntityKind::Window, &window),
    ] {
        assert!(is_pending(&core, kind, id));
    }
    core.inner.state.lock().unwrap().sync.pending.clear();
    let mut received = snapshot(&core).shared.windows[0].clone();
    received.app_version = 99;
    received.state.insert("obsolete".into(), json!("value"));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges {
                windows: vec![received],
                ..Default::default()
            },
        },
    );
    let after = snapshot(&core);
    assert_eq!(
        after.shared.windows[0].app_version,
        after
            .shared
            .apps
            .iter()
            .find(|app| app.id == "test-md-editor")
            .unwrap()
            .current_version
    );
    assert!(!after.shared.windows[0].state.contains_key("obsolete"));
    assert!(!is_pending(
        &core,
        crate::sync_state::EntityKind::Window,
        &window
    ));
    core.inner.generation.fetch_add(1, Ordering::SeqCst);
}

#[test]
fn pending_persists_for_same_device_but_is_discarded_for_another() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(dir.path(), vec![], &host, registry_client());
    let file = connected_link_file();
    crate::storage::save_link(dir.path(), &file).unwrap();
    mark_connected(&core);
    let (id, _) = active_ids(&core);
    core.handle(CoreRequest::WorkspaceRename {
        workspace_id: id.clone(),
        name: "보관".into(),
    })
    .unwrap();
    core.inner.generation.fetch_add(1, Ordering::SeqCst);
    let reopened = open_core_with_client(dir.path(), vec![], &host, registry_client());
    assert!(is_pending(
        &reopened,
        crate::sync_state::EntityKind::Workspace,
        &id
    ));
    reopened.inner.generation.fetch_add(1, Ordering::SeqCst);
    let mut other = file;
    other.device_id = "another".into();
    crate::storage::save_link(dir.path(), &other).unwrap();
    let reopened = open_core_with_client(dir.path(), vec![], &host, registry_client());
    assert!(reopened.inner.state.lock().unwrap().sync.pending.is_empty());
    assert!(!reopened.inner.state.lock().unwrap().sync.merged);
    reopened.inner.generation.fetch_add(1, Ordering::SeqCst);
}

mod additional;
