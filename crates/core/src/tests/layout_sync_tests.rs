use super::*;
use kaleidoscope_contract::registry::LayoutChanges;

#[test]
fn desktop_shortcut_commands_keep_position_and_survive_restart() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        registry_client(),
    );
    let (_, desktop) = active_ids(&core);
    let add = || {
        serde_json::from_value(
            json!({"op":"desktop.shortcut.add", "desktop_id":desktop, "app_id":"test-md-editor"}),
        )
        .unwrap()
    };
    let first = core.handle(add()).unwrap();
    assert_eq!(core.handle(add()).unwrap(), first);
    let id = format!("{desktop}/test-md-editor");
    let invalid = core
        .handle(CoreRequest::DesktopShortcutMove {
            shortcut_id: id.clone(),
            column: -1,
            row: 0,
        })
        .unwrap_err();
    assert_eq!(
        invalid.id.as_deref(),
        Some("DESK_SHORTCUT_MOVE_POSITION_INVALID")
    );
    let second = core
        .handle(CoreRequest::DesktopShortcutAdd {
            desktop_id: desktop.clone(),
            app_id: "agent".into(),
        })
        .unwrap();
    assert!(
        matches!(second, CoreReply::DesktopShortcutAdd { shortcut } if shortcut.column == 1 && shortcut.row == 0)
    );
    core.handle(
        serde_json::from_value(
            json!({"op":"desktop.shortcut.move", "shortcut_id":id, "column":3, "row":2}),
        )
        .unwrap(),
    )
    .unwrap();
    let third = core.handle(CoreRequest::DesktopShortcutAdd { desktop_id: desktop.clone(), app_id: "explorer".into() }).unwrap();
    assert!(matches!(third, CoreReply::DesktopShortcutAdd { shortcut } if shortcut.column == 0 && shortcut.row == 0));
    drop(core);
    let reopened = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        registry_client(),
    );
    let state = serde_json::to_value(snapshot(&reopened)).unwrap();
    assert_eq!(state["shared"]["desktop_shortcuts"][0]["column"], 3);
    assert_eq!(state["shared"]["desktop_shortcuts"][0]["row"], 2);
    let remove = || {
        serde_json::from_value(json!({"op":"desktop.shortcut.remove", "shortcut_id":id})).unwrap()
    };
    reopened.handle(remove()).unwrap();
    reopened.handle(remove()).unwrap();
    assert_eq!(snapshot(&reopened).shared.desktop_shortcuts.len(), 2);
}

#[test]
fn shortcut_only_workspace_survives_first_merge_and_offline_pending() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        registry_client(),
    );
    mark_connected(&core);
    let (local_workspace, local_desktop) = active_ids(&core);
    let added = core
        .handle(CoreRequest::DesktopShortcutAdd {
            desktop_id: local_desktop.clone(),
            app_id: "test-md-editor".into(),
        })
        .unwrap();
    let CoreReply::DesktopShortcutAdd { shortcut } = added else {
        unreachable!()
    };
    let remote_workspace = crate::state_commands::new_workspace("서버 작업".into(), "now".into());
    let remote_desktop = crate::state_commands::new_desktop(
        remote_workspace.id.clone(),
        "서버 화면".into(),
        0,
        "now".into(),
    );
    {
        let mut state = core.inner.state.lock().unwrap();
        crate::layout_apply::apply_snapshot(
            &mut state,
            "device",
            LayoutChanges {
                workspaces: vec![remote_workspace],
                desktops: vec![remote_desktop],
                ..Default::default()
            },
        );
        assert!(state
            .shared
            .workspaces
            .iter()
            .any(|w| w.id == local_workspace));
        assert!(state
            .sync
            .contains(crate::sync_state::EntityKind::DesktopShortcut, &shortcut.id));
        let mut stale = shortcut.clone();
        stale.column = 9;
        crate::layout_apply::apply_changes(
            &mut state,
            LayoutChanges {
                desktop_shortcuts: vec![stale],
                ..Default::default()
            },
        );
        assert_eq!(state.shared.desktop_shortcuts[0].column, 0);
        crate::layout_apply::apply_changes(
            &mut state,
            LayoutChanges {
                deleted_desktops: vec![local_desktop],
                ..Default::default()
            },
        );
        // 최초 병합에서 부모가 미전송이면 삭제도 보호한다.
        assert_eq!(state.shared.desktop_shortcuts.len(), 1);
        state.sync.pending.clear();
        crate::layout_apply::apply_changes(
            &mut state,
            LayoutChanges {
                deleted_desktops: vec![shortcut.desktop_id.clone()],
                ..Default::default()
            },
        );
        assert!(state.shared.desktop_shortcuts.is_empty());
    }
}

#[test]
fn old_state_and_sync_files_read_without_shortcuts() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("state.json"), serde_json::to_vec(&json!({"format":1,"apps":[],"app_versions":[],"workspaces":[],"desktops":[],"windows":[]})).unwrap()).unwrap();
    fs::write(dir.path().join("sync.json"), serde_json::to_vec(&json!({"format":1,"device_id":"device-id","merged":true,"pending":[{"kind":"desktop","id":"desktop"}]})).unwrap()).unwrap();
    let shared = crate::storage::load_shared(dir.path()).unwrap();
    assert!(shared.desktop_shortcuts.is_empty());
    let sync = crate::sync_state::load(dir.path(), Some(&connected_link_file())).unwrap();
    assert!(sync.merged && sync.contains(crate::sync_state::EntityKind::Desktop, "desktop"));
}

#[test]
fn rejected_shortcut_batch_remains_pending() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(dir.path(), vec![], &host, client.clone());
    mark_connected(&core);
    let (workspace, desktop) = active_ids(&core);
    let CoreReply::DesktopShortcutAdd { shortcut } = core.handle(CoreRequest::DesktopShortcutAdd { desktop_id:desktop, app_id:"agent".into() }).unwrap() else { unreachable!() };
    client.layout_change_replies.lock().unwrap().push_back(Err(RegistryError::Validation(kaleidoscope_contract::errors::SERVER_LAYOUT_CHANGE_BODY_INVALID())));
    crate::registry_events::apply_event(&core.inner, 0, DeviceEvent::LayoutSnapshot { workspaces:vec![], desktops:vec![], windows:vec![], desktop_shortcuts:vec![] });
    wait_until(|| !core.inner.state.lock().unwrap().sync.contains(crate::sync_state::EntityKind::Workspace, &workspace));
    assert!(core.inner.state.lock().unwrap().sync.contains(crate::sync_state::EntityKind::DesktopShortcut, &shortcut.id));
    core.inner.generation.fetch_add(1, Ordering::SeqCst);
}

#[test]
fn two_cores_sync_shortcut_through_embedded_server_and_restart() {
    use sha2::{Digest, Sha256};
    let temp = TempDir::new().unwrap();
    let db_path = temp.path().join("shortcut_test_db.sqlite");
    std::env::set_var("TEST_DATABASE_URL", &db_path);
    let db_path = PathBuf::from(std::env::var_os("TEST_DATABASE_URL").unwrap());
    assert_eq!(db_path.parent(), Some(temp.path()));
    assert!(db_path.to_string_lossy().contains("test"));
    let empty_db = rusqlite::Connection::open(&db_path).unwrap();
    let tables: i64 = empty_db
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tables, 0);
    drop(empty_db);
    let token_path = temp.path().join("embedded-token");
    let (ready_tx, ready_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
    let server_db = db_path.clone();
    let server = thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            let server = kaleidoscope_orchestrator::EmbeddedServer::start(
                kaleidoscope_orchestrator::EmbeddedConfig {
                    db_path: server_db,
                    token_path,
                    device_name: "첫 기기".into(),
                },
            )
            .await
            .unwrap();
            ready_tx
                .send((
                    server.server_url.clone(),
                    server.device_id.clone(),
                    server.token.clone(),
                ))
                .unwrap();
            let _ = stop_rx.await;
        });
    });
    let (url, device, token) = ready_rx.recv_timeout(Duration::from_secs(20)).unwrap();
    let second_token = "second-test-token";
    let db = rusqlite::Connection::open(&db_path).unwrap();
    let hash = format!("{:x}", Sha256::digest(second_token.as_bytes()));
    db.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('second','둘째',(SELECT account_id FROM mcp_principal WHERE id=1),?1,'now')", [&hash]).unwrap();
    drop(db);
    let first_dir = temp.path().join("first");
    let second_dir = temp.path().join("second");
    fs::create_dir_all(&second_dir).unwrap();
    crate::storage::save_link(
        &second_dir,
        &LinkFile {
            revoked: false,
            mode: kaleidoscope_contract::ServerMode::Remote,
            format: 1,
            server_url: url.clone(),
            device_id: "second".into(),
            device_name: "둘째".into(),
            token: second_token.into(),
        },
    )
    .unwrap();
    let host = Arc::new(FakeHost::default());
    let first_config = || CoreConfig {
        media_origin: None,
        data_dir: first_dir.clone(),
        seed_definitions: vec![],
        server_url: url.clone(),
        device_name: "첫 기기".into(),
        embedded_server: Some(crate::EmbeddedServerInfo {
            server_url: url.clone(),
            device_id: device.clone(),
            token: token.clone(),
        }),
    };
    let second_config = || CoreConfig {
        media_origin: None,
        data_dir: second_dir.clone(),
        seed_definitions: vec![],
        server_url: url.clone(),
        device_name: "둘째".into(),
        embedded_server: None,
    };
    let wait = |condition: &dyn Fn() -> bool| {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !condition() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(25));
        }
        assert!(condition(), "동기화가 끝나지 않았습니다");
    };
    let first = Core::open(first_config(), host.clone()).unwrap();
    wait(&|| {
        let state = first.inner.state.lock().unwrap();
        state.sync.merged && state.sync.pending.is_empty()
    });
    let (_, desktop) = active_ids(&first);
    let second = Core::open(second_config(), host.clone()).unwrap();
    wait(&|| {
        snapshot(&second)
            .shared
            .desktops
            .iter()
            .any(|d| d.id == desktop)
    });
    let CoreReply::DesktopShortcutAdd { shortcut } = first
        .handle(CoreRequest::DesktopShortcutAdd {
            desktop_id: desktop,
            app_id: "agent".into(),
        })
        .unwrap()
    else {
        unreachable!()
    };
    wait(&|| {
        snapshot(&second)
            .shared
            .desktop_shortcuts
            .iter()
            .any(|s| s.id == shortcut.id)
    });
    first
        .handle(CoreRequest::DesktopShortcutMove {
            shortcut_id: shortcut.id.clone(),
            column: 2,
            row: 3,
        })
        .unwrap();
    wait(&|| {
        snapshot(&second)
            .shared
            .desktop_shortcuts
            .iter()
            .any(|s| s.id == shortcut.id && s.column == 2 && s.row == 3)
    });
    second.shutdown();
    drop(second);
    first.handle(CoreRequest::DesktopShortcutMove { shortcut_id: shortcut.id.clone(), column: 4, row: 3 }).unwrap();
    wait(&|| first.inner.state.lock().unwrap().sync.pending.is_empty());
    let second = Core::open(second_config(), host.clone()).unwrap();
    wait(&|| snapshot(&second).shared.desktop_shortcuts.iter().any(|s| s.id == shortcut.id && s.column == 4));
    first.shutdown();
    second.shutdown();
    drop(first);
    drop(second);
    let first = Core::open(first_config(), host.clone()).unwrap();
    let second = Core::open(second_config(), host).unwrap();
    wait(&|| {
        snapshot(&first)
            .shared
            .desktop_shortcuts
            .iter()
            .any(|s| s.id == shortcut.id && s.column == 4)
    });
    wait(&|| {
        snapshot(&second)
            .shared
            .desktop_shortcuts
            .iter()
            .any(|s| s.id == shortcut.id && s.row == 3)
    });
    first
        .handle(CoreRequest::DesktopShortcutRemove {
            shortcut_id: shortcut.id.clone(),
        })
        .unwrap();
    wait(&|| {
        snapshot(&second)
            .shared
            .desktop_shortcuts
            .iter()
            .all(|s| s.id != shortcut.id)
    });
    first.shutdown();
    second.shutdown();
    drop(first);
    drop(second);
    let first = Core::open(first_config(), Arc::new(FakeHost::default())).unwrap();
    let second = Core::open(second_config(), Arc::new(FakeHost::default())).unwrap();
    wait(&|| first.inner.state.lock().unwrap().sync.pending.is_empty());
    wait(&|| {
        snapshot(&second)
            .shared
            .desktop_shortcuts
            .iter()
            .all(|s| s.id != shortcut.id)
    });
    assert!(snapshot(&first)
        .shared
        .desktop_shortcuts
        .iter()
        .all(|s| s.id != shortcut.id));
    first.shutdown();
    second.shutdown();
    drop(first);
    drop(second);
    let _ = stop_tx.send(());
    server.join().unwrap();
}

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
            desktop_shortcuts: vec![],
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
fn share_is_local_but_sent_context_changes_mark_desktop_pending_for_sync() {
    use crate::sync_state::EntityKind::Desktop;
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        registry_client(),
    );
    mark_connected(&core);
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    core.inner.state.lock().unwrap().sync.pending.clear();
    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: true,
    })
    .unwrap();
    assert!(!is_pending(&core, Desktop, &desktop_id));

    let clear_pending = || {
        let mut state = core.inner.state.lock().unwrap();
        state.sync.pending.clear();
        crate::sync_state::save(&dir.path(), &state.sync).unwrap();
    };
    clear_pending();
    crate::share::mark_sent_text(
        &core.inner,
        "thread",
        BTreeMap::from([(
            window_id.clone(),
            kaleidoscope_data::share::SentView {
                app_name: "마크다운 편집기".into(),
                text: "마지막으로 보낸 글".into(),
            },
        )]),
    );
    assert!(is_pending(&core, Desktop, &desktop_id));

    clear_pending();
    crate::share::mark_sent_visuals(
        &core.inner,
        "thread",
        vec![(window_id, "image-hash".into())],
    );
    assert!(is_pending(&core, Desktop, &desktop_id));
    let sync: Value =
        serde_json::from_slice(&fs::read(dir.path().join("sync.json")).unwrap()).unwrap();
    assert!(sync["pending"]
        .as_array()
        .unwrap()
        .iter()
        .any(|key| key["kind"] == "desktop" && key["id"] == desktop_id));
}

#[test]
fn share_remote_layout_cannot_enable_or_disable_local_permission() {
    let first_dir = TempDir::new().unwrap();
    let second_dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let first = open_core(
        &first_dir.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
    );
    let (_, desktop_id) = active_ids(&first);
    let window_id = open_window(&first, &desktop_id, "test-md-editor");
    let first_snapshot = snapshot(&first);
    let mut legacy_desktop = first_snapshot.shared.desktops[0].clone();
    legacy_desktop.sharing = vec![window_id.clone()];

    let client = registry_client();
    let second = open_core_with_client(
        &second_dir.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
        Arc::clone(&client),
    );
    mark_connected(&second);
    crate::registry_events::apply_event(
        &second.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: first_snapshot.shared.workspaces,
            desktops: vec![legacy_desktop.clone()],
            windows: first_snapshot.shared.windows,
            desktop_shortcuts: vec![],
        },
    );
    assert!(snapshot(&second).sharing.is_empty());
    assert!(snapshot(&second).shared.desktops[0].sharing.is_empty());
    let view = kaleidoscope_contract::VisibleView {
        text: "다른 기기 글".into(),
        visual: false,
        occluded: false,
        image_base64: None,
        bounds: Rect {
            x: 0,
            y: 0,
            width: 100,
            height: 80,
        },
    };
    second
        .handle(CoreRequest::ShareView {
            window_id: window_id.clone(),
            view: view.clone(),
        })
        .unwrap();
    crate::share::on_connected(&second.inner);
    assert!(client.share_puts.lock().unwrap().is_empty());

    second
        .handle(CoreRequest::ShareSet {
            window_id: window_id.clone(),
            on: true,
        })
        .unwrap();
    legacy_desktop.sharing.clear();
    crate::registry_events::apply_event(
        &second.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges {
                desktops: vec![legacy_desktop],
                ..Default::default()
            },
        },
    );
    assert_eq!(snapshot(&second).sharing, vec![window_id.clone()]);
    second
        .handle(CoreRequest::ShareView { window_id, view })
        .unwrap();
    assert_eq!(client.share_puts.lock().unwrap().len(), 1);
}

#[test]
fn another_core_keeps_synced_share_baselines_after_local_opt_in() {
    let first_dir = TempDir::new().unwrap();
    let second_dir = TempDir::new().unwrap();
    let png = test_png(8, 8);
    let make_host = || {
        Arc::new(CaptureTestHost {
            png: Mutex::new(png.clone()),
            web_captures: AtomicUsize::new(0),
            shell_captures: AtomicUsize::new(0),
            freeze_calls: AtomicUsize::new(0),
            unfreeze_calls: AtomicUsize::new(0),
        })
    };
    let open = |data_dir: &Path, host: &Arc<CaptureTestHost>| {
        Core::open(
            CoreConfig {
                media_origin: None,
                embedded_server: None,
                data_dir: data_dir.to_path_buf(),
                seed_definitions: vec![test_definition(MD_EDITOR)],
                server_url: "http://127.0.0.1:4219".into(),
                device_name: "test-device".into(),
            },
            host.clone(),
        )
        .unwrap()
    };
    let first_host = make_host();
    let first = open(first_dir.path(), &first_host);
    let (workspace_id, desktop_id) = active_ids(&first);
    let window_id = open_window(&first, &desktop_id, "test-md-editor");
    first
        .handle(CoreRequest::ShareSet {
            window_id: window_id.clone(),
            on: true,
        })
        .unwrap();
    let view = kaleidoscope_contract::VisibleView {
        text: "동기화된 글".into(),
        visual: true,
        occluded: false,
        image_base64: None,
        bounds: Rect {
            x: 0,
            y: 0,
            width: 8,
            height: 8,
        },
    };
    first
        .handle(CoreRequest::ShareView {
            window_id: window_id.clone(),
            view: view.clone(),
        })
        .unwrap();
    let (text, sent) = crate::share::prepare_text(&first.inner, &workspace_id, "thread").unwrap();
    assert!(text.contains("새로 같이 봄"));
    crate::share::mark_sent_text(&first.inner, "thread", sent);
    let (attachments, visuals) =
        crate::share::capture_for_send(&first.inner, &workspace_id, "thread", 0, 0);
    assert_eq!(attachments.len(), 1);
    crate::share::mark_sent_visuals(&first.inner, "thread", visuals);

    let first_snapshot = snapshot(&first);
    let second_host = make_host();
    let second = open(second_dir.path(), &second_host);
    mark_connected(&second);
    crate::registry_events::apply_event(
        &second.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: first_snapshot.shared.workspaces.clone(),
            desktops: first_snapshot.shared.desktops.clone(),
            windows: first_snapshot.shared.windows.clone(),
            desktop_shortcuts: vec![],
        },
    );
    let second_snapshot = snapshot(&second);
    assert!(second_snapshot.sharing.is_empty());
    assert!(
        crate::share::prepare_text(&second.inner, &workspace_id, "thread")
            .unwrap()
            .0
            .contains("같이 보기 끝")
    );

    second
        .handle(CoreRequest::ShareSet {
            window_id: window_id.clone(),
            on: true,
        })
        .unwrap();
    second
        .handle(CoreRequest::ShareView { window_id, view })
        .unwrap();
    assert!(
        crate::share::prepare_text(&second.inner, &workspace_id, "thread")
            .unwrap()
            .0
            .contains("그대로")
    );
    let (same_attachments, _) =
        crate::share::capture_for_send(&second.inner, &workspace_id, "thread", 0, 0);
    assert_eq!(same_attachments.len(), 1);
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
            desktop_shortcuts: vec![],
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
            desktop_shortcuts: vec![],
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
    received.app_version = 3;
    received.state.clear();
    received
        .state
        .insert("current_file".into(), json!("notes/a.md"));
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
    assert_eq!(
        after.shared.windows[0]
            .state
            .get("source")
            .and_then(Value::as_f64),
        Some(1.0)
    );
    assert_eq!(
        after.shared.windows[0].state.get("current_file"),
        Some(&json!("notes/a.md"))
    );
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
