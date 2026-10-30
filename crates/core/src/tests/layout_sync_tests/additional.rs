use super::*;

#[test]
fn offline_changes_wait_for_snapshot_and_changed_during_send_stays_pending() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(dir.path(), vec![], &host, client.clone());
    mark_connected(&core);
    let (id, _) = active_ids(&core);
    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        server_url: "https://registry.test".into(),
        device_name: "test".into(),
        reason: "끊김".into(),
    };
    core.handle(CoreRequest::WorkspaceRename {
        workspace_id: id.clone(),
        name: "끊김 중".into(),
    })
    .unwrap();
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppsSnapshot {
            apps: vec![],
            deleted: vec![],
        },
    );
    thread::sleep(Duration::from_millis(100));
    assert!(client.layout_changes.lock().unwrap().is_empty());
    let (sender, receiver) = mpsc::channel();
    *client.layout_change_pause.lock().unwrap() = Some(receiver);
    let state = snapshot(&core).shared;
    client
        .layout_change_replies
        .lock()
        .unwrap()
        .push_back(Ok(LayoutChanges {
            workspaces: state.workspaces.clone(),
            desktops: state.desktops.clone(),
            ..Default::default()
        }));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: vec![],
            desktops: vec![],
            windows: vec![],
        },
    );
    wait_until(|| !client.layout_changes.lock().unwrap().is_empty());
    assert_eq!(
        client.layout_changes.lock().unwrap()[0].workspaces[0].name,
        "끊김 중"
    );
    core.handle(CoreRequest::WorkspaceRename {
        workspace_id: id.clone(),
        name: "전송 중".into(),
    })
    .unwrap();
    sender.send(()).unwrap();
    wait_until(|| client.layout_changes.lock().unwrap().len() >= 2);
    assert!(is_pending(
        &core,
        crate::sync_state::EntityKind::Workspace,
        &id
    ));
    assert_eq!(snapshot(&core).shared.workspaces[0].name, "전송 중");
    assert_eq!(
        client.layout_changes.lock().unwrap()[1].workspaces[0].name,
        "전송 중"
    );
    core.inner.generation.fetch_add(1, Ordering::SeqCst);
}

#[test]
fn rejected_batch_clears_sent_pending() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(dir.path(), vec![], &host, client.clone());
    mark_connected(&core);
    let (id, _) = active_ids(&core);
    core.handle(CoreRequest::WorkspaceRename {
        workspace_id: id,
        name: "수정".into(),
    })
    .unwrap();
    client
        .layout_change_replies
        .lock()
        .unwrap()
        .push_back(Err(RegistryError::Validation(CoreError::new(
            ErrorCode::InvalidRequest,
        ))));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: vec![],
            desktops: vec![],
            windows: vec![],
        },
    );
    wait_until(|| {
        !client.layout_changes.lock().unwrap().is_empty()
            && core.inner.state.lock().unwrap().sync.pending.is_empty()
    });
    core.inner.generation.fetch_add(1, Ordering::SeqCst);
}

#[test]
fn snapshot_keeps_pending_deletion_and_server_order() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(dir.path(), vec![], &host, registry_client());
    let second = match core
        .handle(CoreRequest::WorkspaceCreate {
            name: "둘째".into(),
        })
        .unwrap()
    {
        CoreReply::WorkspaceCreate { workspace, .. } => workspace,
        _ => unreachable!(),
    };
    let before = snapshot(&core).shared;
    mark_connected(&core);
    core.inner.state.lock().unwrap().sync.merged = true;
    core.handle(CoreRequest::WorkspaceDelete {
        workspace_id: second.id.clone(),
    })
    .unwrap();
    let mut first = before.workspaces[0].clone();
    first.name = "서버 변경".into();
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: vec![second.clone(), first],
            desktops: before.desktops,
            windows: vec![],
        },
    );
    let after = snapshot(&core);
    assert_eq!(after.shared.workspaces.len(), 1);
    assert_eq!(after.shared.workspaces[0].name, "서버 변경");
    assert!(is_pending(
        &core,
        crate::sync_state::EntityKind::Workspace,
        &second.id
    ));
    core.inner.generation.fetch_add(1, Ordering::SeqCst);
}

#[test]
fn unlink_and_revocation_remove_sync_file() {
    for revoked in [false, true] {
        let dir = TempDir::new().unwrap();
        let host = Arc::new(FakeHost::default());
        let core = open_core_with_client(dir.path(), vec![], &host, registry_client());
        let file = connected_link_file();
        crate::storage::save_link(dir.path(), &file).unwrap();
        mark_connected(&core);
        let (id, _) = active_ids(&core);
        core.handle(CoreRequest::WorkspaceRename {
            workspace_id: id,
            name: "수정".into(),
        })
        .unwrap();
        assert!(dir.path().join("sync.json").exists());
        if revoked {
            crate::link::token_rejected(&core.inner, file);
        } else {
            core.handle(CoreRequest::LinkUnlink {}).unwrap();
        }
        assert!(!dir.path().join("sync.json").exists());
        assert!(core.inner.state.lock().unwrap().sync.pending.is_empty());
    }
}
