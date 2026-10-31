use super::*;
use kaleidoscope_contract::{
    app_storage::{StorageSnapshot, StorageUpdate},
    data::BindingValue,
};

fn reconnect_while(responding: bool) {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let definition = fake_definition(temp.path());
    let registry = registry_client();
    *registry.storage_value.lock().unwrap() = Some((
        definition["storage"]["entries"][0]["default"].clone(),
        "revision".into(),
    ));
    let core = open_core_with_client(temp.path(), vec![definition.to_string()], &host, registry);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-agent");
    attach(&core, &window);
    select(&core, &window, "one");
    until(&core, &window, LocalAgentPhase::ChoosingFolder);
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "work".into(),
    })
    .unwrap();
    let original = allow_and_start(&core, &window);
    if responding {
        core.handle(CoreRequest::LocalAgentSend {
            window_id: window.clone(),
            generation: original.generation.clone(),
            request_id: "turn".into(),
            text: "permission".into(),
            attachments: vec![],
        })
        .unwrap();
        wait_for(|| !attach(&core, &window).permissions.is_empty());
    }

    let file = connected_link_file();
    *core.inner.link_file.lock().unwrap() = Some(file.clone());
    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        server_url: file.server_url.clone(),
        device_name: file.device_name.clone(),
        reason: "연결하는 중".into(),
    };
    emit_state(&core);
    wait_for(|| {
        matches!(
            crate::data_runtime::binding_value(&core.inner, &window, "/ui/agents"),
            Some(BindingValue::Failed { .. })
        )
    });
    let offline = attach(&core, &window);
    assert_eq!(offline.generation, original.generation);
    assert_eq!(offline.agents, original.agents);
    assert_eq!(
        offline.phase,
        if responding {
            LocalAgentPhase::Responding
        } else {
            LocalAgentPhase::Ready
        }
    );
    if responding {
        assert_eq!(offline.permissions.len(), 1);
    }

    core.inner.state.lock().unwrap().link = LinkStatus::Connected {
        server_url: file.server_url,
        device_name: file.device_name,
    };
    emit_state(&core);
    crate::data_runtime::storage_changed(
        &core.inner,
        &window,
        &StorageUpdate::Snapshot {
            snapshot: StorageSnapshot {
                bucket_id: "bucket".into(),
                items: vec![],
            },
        },
    );
    wait_for(|| {
        matches!(
            crate::data_runtime::binding_value(&core.inner, &window, "/ui/agents"),
            Some(BindingValue::Ready { .. })
        )
    });
    if responding {
        let during_turn = attach(&core, &window);
        assert_eq!(during_turn.generation, original.generation);
        assert_eq!(during_turn.phase, LocalAgentPhase::Responding);
        let prompt = &during_turn.permissions[0];
        core.handle(CoreRequest::LocalAgentPermission {
            window_id: window.clone(),
            generation: original.generation.clone(),
            request_id: prompt.id.clone(),
            option_id: "yes".into(),
        })
        .unwrap();
    }
    wait_for(|| {
        let next = attach(&core, &window);
        next.generation != original.generation && next.phase == LocalAgentPhase::Ready
    });
    let log = calls(&temp.path().join("calls"));
    let load = log
        .iter()
        .find(|event| event["method"] == "session/load")
        .unwrap();
    assert_eq!(load["params"]["sessionId"], "session-1");
    if responding {
        assert!(attach(&core, &window)
            .history
            .iter()
            .any(|item| item.text == "선택: yes"));
    }
}

#[test]
fn offline_transition_preserves_responding_turn_until_it_finishes() {
    reconnect_while(true);
}

#[test]
fn offline_transition_reconnects_ready_worker_after_storage_recovers() {
    reconnect_while(false);
}

#[test]
fn clearing_selection_while_storage_fails_stops_the_old_worker() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let definition = fake_definition(temp.path());
    let core = open_core(temp.path(), vec![definition.to_string()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-agent");
    attach(&core, &window);
    select(&core, &window, "one");
    until(&core, &window, LocalAgentPhase::ChoosingFolder);
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "work".into(),
    })
    .unwrap();
    let original = allow_and_start(&core, &window);
    let file = connected_link_file();
    *core.inner.link_file.lock().unwrap() = Some(file.clone());
    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        server_url: file.server_url,
        device_name: file.device_name,
        reason: "연결하는 중".into(),
    };
    emit_state(&core);
    wait_for(|| {
        matches!(
            crate::data_runtime::binding_value(&core.inner, &window, "/ui/agents"),
            Some(BindingValue::Failed { .. })
        )
    });
    assert_eq!(attach(&core, &window).generation, original.generation);
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: BTreeMap::from([("agent_id".into(), Value::Null)]),
    })
    .unwrap();
    let cleared = attach(&core, &window);
    assert_ne!(cleared.generation, original.generation);
    assert_eq!(cleared.phase, LocalAgentPhase::ChoosingAgent);
    assert_eq!(cleared.selected, None);
    assert_eq!(
        core.handle(CoreRequest::LocalAgentCancel {
            window_id: window,
            generation: original.generation,
        })
        .unwrap_err()
        .code,
        ErrorCode::InvalidRequest
    );
}
