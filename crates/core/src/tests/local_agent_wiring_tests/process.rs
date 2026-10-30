use super::*;

#[cfg(target_os = "linux")]
#[test]
fn closing_and_remote_deletion_stop_only_the_owned_process_tree() {
    use kaleidoscope_contract::registry::LayoutChanges;
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let mut definition = fake_definition(temp.path());
    for (index, name) in ["one", "two"].iter().enumerate() {
        definition["storage"]["entries"][0]["default"][index]["env"] = json!({
            "TEST_SCENARIO":"tree", "TEST_PID_LOG":temp.path().join(name).to_string_lossy()
        });
    }
    let core = open_core(temp.path(), vec![definition.to_string()], &host);
    let (workspace, desktop) = active_ids(&core);
    let mut windows = Vec::new();
    for name in ["one", "two"] {
        let window = open_window(&core, &desktop, "test-agent");
        attach(&core, &window);
        select(&core, &window, name);
        until(&core, &window, LocalAgentPhase::ChoosingFolder);
        core.handle(CoreRequest::FilesPickFolder {
            window_id: window.clone(),
            permission: "work".into(),
        })
        .unwrap();
        let ready = allow_and_start(&core, &window);
        let pidfile = temp.path().join(name);
        wait_for(|| pidfile.exists());
        let pids: Vec<u32> = fs::read_to_string(pidfile)
            .unwrap()
            .split_whitespace()
            .map(|v| v.parse().unwrap())
            .collect();
        assert_eq!(pids.len(), 2);
        windows.push((window, ready.generation, pids));
    }
    let other = match core
        .handle(CoreRequest::DesktopCreate {
            workspace_id: workspace,
            name: "다른 화면".into(),
        })
        .unwrap()
    {
        CoreReply::DesktopCreate { desktop } => desktop.id,
        other => panic!("{other:?}"),
    };
    core.handle(CoreRequest::LocalAgentDetach {
        window_id: windows[1].0.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::DesktopActivate { desktop_id: other })
        .unwrap();
    assert_eq!(attach(&core, &windows[1].0).generation, windows[1].1);
    let first_dir = temp
        .path()
        .join("local-agent")
        .join(format!("{:x}", Sha256::digest(windows[0].0.as_bytes())));
    let second_dir = temp
        .path()
        .join("local-agent")
        .join(format!("{:x}", Sha256::digest(windows[1].0.as_bytes())));
    core.handle(CoreRequest::WindowClose {
        window_id: windows[0].0.clone(),
    })
    .unwrap();
    wait_for(|| {
        windows[0]
            .2
            .iter()
            .all(|pid| !Path::new(&format!("/proc/{pid}")).exists())
    });
    assert!(!first_dir.exists());
    assert!(windows[1]
        .2
        .iter()
        .all(|pid| Path::new(&format!("/proc/{pid}")).exists()));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges {
                deleted_windows: vec![windows[1].0.clone()],
                ..Default::default()
            },
        },
    );
    wait_for(|| {
        windows[1]
            .2
            .iter()
            .all(|pid| !Path::new(&format!("/proc/{pid}")).exists())
    });
    assert!(!second_dir.exists());
    fs::remove_file(temp.path().join("one")).unwrap();
    let last = open_window(&core, &desktop, "test-agent");
    attach(&core, &last);
    select(&core, &last, "one");
    until(&core, &last, LocalAgentPhase::ChoosingFolder);
    core.handle(CoreRequest::FilesPickFolder {
        window_id: last.clone(),
        permission: "work".into(),
    })
    .unwrap();
    until(&core, &last, LocalAgentPhase::Ready);
    let last_pids: Vec<u32> = fs::read_to_string(temp.path().join("one"))
        .unwrap()
        .split_whitespace()
        .map(|v| v.parse().unwrap())
        .collect();
    core.shutdown();
    wait_for(|| {
        last_pids
            .iter()
            .all(|pid| !Path::new(&format!("/proc/{pid}")).exists())
    });
    fs::remove_file(temp.path().join("one")).unwrap();
    let final_window = open_window(&core, &desktop, "test-agent");
    attach(&core, &final_window);
    select(&core, &final_window, "one");
    until(&core, &final_window, LocalAgentPhase::ChoosingFolder);
    core.handle(CoreRequest::FilesPickFolder {
        window_id: final_window.clone(),
        permission: "work".into(),
    })
    .unwrap();
    until(&core, &final_window, LocalAgentPhase::Ready);
    let final_pids: Vec<u32> = fs::read_to_string(temp.path().join("one"))
        .unwrap()
        .split_whitespace()
        .map(|v| v.parse().unwrap())
        .collect();
    let background_owner = Arc::clone(&core.inner);
    drop(core);
    wait_for(|| {
        final_pids
            .iter()
            .all(|pid| !Path::new(&format!("/proc/{pid}")).exists())
    });
    drop(background_owner);
}
