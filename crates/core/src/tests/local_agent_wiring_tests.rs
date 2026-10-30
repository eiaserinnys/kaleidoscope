mod link_transition;
mod process;
mod sharing;

use super::*;
use kaleidoscope_contract::conversation::ConversationUpload;
use kaleidoscope_contract::local_agent::{LocalAgentPhase, LocalAgentSnapshot};
use sha2::{Digest, Sha256};

fn attach(core: &Core, window: &str) -> LocalAgentSnapshot {
    match core
        .handle(CoreRequest::LocalAgentAttach {
            window_id: window.into(),
        })
        .unwrap()
    {
        CoreReply::LocalAgentAttach { snapshot } => snapshot,
        other => panic!("{other:?}"),
    }
}

fn until(core: &Core, window: &str, phase: LocalAgentPhase) -> LocalAgentSnapshot {
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        let state = attach(core, window);
        if state.phase == phase {
            return state;
        }
        thread::sleep(Duration::from_millis(20));
    }
    panic!("상태에 도달하지 못함: {phase:?}");
}

#[test]
fn local_agent_window_lifecycle_and_generation() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let mut definition: Value =
        serde_json::from_str(include_str!("../../../../apps/agent.json")).unwrap();
    definition["id"] = json!("test-agent");
    let calls = temp.path().join("calls");
    definition["storage"]["entries"][0]["default"] = json!([{
        "id": "test", "name": "시험", "command": super::local_agent_tests::agent_binary(),
        "args": [], "env": {"TEST_LOG": calls.to_string_lossy()}
    }]);
    let core = open_core(temp.path(), vec![definition.to_string()], &host);
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    core.subscribe(Box::new(move |event| {
        sink.lock().unwrap().push(event.clone())
    }));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-agent");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    assert_eq!(attach(&core, &window).phase, LocalAgentPhase::ChoosingAgent);
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: BTreeMap::from([("agent_id".into(), json!("test"))]),
    })
    .unwrap();
    until(&core, &window, LocalAgentPhase::ChoosingFolder);
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "work".into(),
    })
    .unwrap();
    let awaiting = until(&core, &window, LocalAgentPhase::AwaitingPermission);
    let execution = awaiting.execution.unwrap();
    assert_eq!(execution.name, "시험");
    core.handle(CoreRequest::LocalAgentAllow {
        window_id: window.clone(),
        spec_hash: execution.spec_hash,
    })
    .unwrap();
    let ready = until(&core, &window, LocalAgentPhase::Ready);
    let bad = core
        .handle(CoreRequest::LocalAgentCancel {
            window_id: window.clone(),
            generation: "stale".into(),
        })
        .unwrap_err();
    assert_eq!(bad.code, ErrorCode::InvalidRequest);
    core.handle(CoreRequest::LocalAgentSend {
        window_id: window.clone(),
        generation: ready.generation,
        request_id: "hello".into(),
        text: "hello".into(),
        attachments: vec![ConversationUpload {
            name: "note.txt".into(),
            mime: "text/plain".into(),
            data_base64: "YWJj".into(),
        }],
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if attach(&core, &window).history.len() >= 2 {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    assert!(attach(&core, &window)
        .history
        .iter()
        .any(|item| item.text == "안녕"));
    let history = attach(&core, &window).history;
    let user = history.iter().find(|i| i.id == "hello").unwrap();
    let result = core
        .handle(CoreRequest::LocalAgentAttachment {
            window_id: window.clone(),
            item_id: user.id.clone(),
            attachment_id: user.attachments[0].id.clone(),
        })
        .unwrap();
    assert!(
        matches!(result, CoreReply::LocalAgentAttachment { data_base64, .. } if data_base64 == "YWJj")
    );
    wait_for(|| {
        let events = events.lock().unwrap();
        [LocalAgentPhase::ChoosingAgent, LocalAgentPhase::ChoosingFolder, LocalAgentPhase::AwaitingPermission]
            .iter().all(|phase| events.iter().any(|event| matches!(event,
                CoreEvent::LocalAgentUpdate { window_id, update: kaleidoscope_contract::local_agent::LocalAgentUpdate::Snapshot { snapshot }, .. }
                if window_id == &window && snapshot.phase == *phase)))
            && events.iter().any(|event| matches!(event, CoreEvent::LocalAgentUpdate {
                window_id, update:kaleidoscope_contract::local_agent::LocalAgentUpdate::State { phase:LocalAgentPhase::Ready, .. }, ..
            } if window_id == &window))
            && events.iter().any(|event| matches!(event, CoreEvent::LocalAgentUpdate {
                window_id, update:kaleidoscope_contract::local_agent::LocalAgentUpdate::Conversation {
                    update:kaleidoscope_contract::conversation::ConversationEvent::Item { item } }, ..
            } if window_id == &window && item.text == "안녕"))
    });
    let record_dir = temp
        .path()
        .join("local-agent")
        .join(format!("{:x}", Sha256::digest(window.as_bytes())));
    assert!(record_dir.exists());
    core.handle(CoreRequest::WindowClose { window_id: window })
        .unwrap();
    assert!(!record_dir.exists());
}

fn fake_definition(temp: &Path) -> Value {
    let mut definition: Value =
        serde_json::from_str(include_str!("../../../../apps/agent.json")).unwrap();
    definition["id"] = json!("test-agent");
    definition["storage"]["entries"][0]["default"] = json!([{
        "id":"one", "name":"시험", "command":super::local_agent_tests::agent_binary(), "args":[],
        "env":{"TEST_LOG":temp.join("calls").to_string_lossy()}
    }, {
        "id":"two", "name":"시험", "command":super::local_agent_tests::agent_binary(), "args":[],
        "env":{"TEST_LOG":temp.join("calls").to_string_lossy()}
    }]);
    definition
}

fn select(core: &Core, window: &str, id: &str) {
    core.handle(CoreRequest::WindowSetState {
        window_id: window.into(),
        state: BTreeMap::from([("agent_id".into(), json!(id))]),
    })
    .unwrap();
}
fn allow_and_start(core: &Core, window: &str) -> LocalAgentSnapshot {
    let awaiting = until(core, window, LocalAgentPhase::AwaitingPermission);
    core.handle(CoreRequest::LocalAgentAllow {
        window_id: window.into(),
        spec_hash: awaiting.execution.unwrap().spec_hash,
    })
    .unwrap();
    until(core, window, LocalAgentPhase::Ready)
}
fn emit_state(core: &Core) {
    let event = CoreEvent::StateChanged {
        snapshot: crate::snapshot(&core.inner.state.lock().unwrap()),
    };
    core.inner.emit(&event);
}
fn calls(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}
fn wait_for(mut test: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if test() {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    panic!("조건을 기다리다 시간 초과");
}

#[test]
fn connection_changes_restart_when_idle_and_restore_the_session() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let core = open_core(
        temp.path(),
        vec![fake_definition(temp.path()).to_string()],
        &host,
    );
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
    let first = allow_and_start(&core, &window);
    select(&core, &window, "two");
    assert_eq!(
        until(&core, &window, LocalAgentPhase::Ready).generation,
        first.generation
    );
    let mut file = connected_link_file();
    file.server_url = "https://registry.test/subpath".into();
    *core.inner.link_file.lock().unwrap() = Some(file);
    emit_state(&core);
    wait_for(|| {
        attach(&core, &window).generation != first.generation
            && attach(&core, &window).phase == LocalAgentPhase::Ready
    });
    let second = attach(&core, &window);
    let log = calls(&temp.path().join("calls"));
    let load = log.iter().find(|v| v["method"] == "session/load").unwrap();
    assert_eq!(load["params"]["sessionId"], "session-1");
    assert_eq!(
        load["params"]["mcpServers"][0]["url"],
        "https://registry.test/subpath/mcp"
    );
    let headers = load["params"]["mcpServers"][0]["headers"]
        .as_array()
        .unwrap();
    assert!(headers.iter().any(|h| h["name"] == "Authorization"));
    assert!(headers
        .iter()
        .any(|h| h["name"] == kaleidoscope_contract::registry::WORKSPACE_HEADER));
    assert!(!fs::read_to_string(temp.path().join("calls"))
        .unwrap()
        .contains("secret-device-token"));
    core.handle(CoreRequest::LocalAgentSend {
        window_id: window.clone(),
        generation: second.generation.clone(),
        request_id: "slow".into(),
        text: "slow".into(),
        attachments: vec![],
    })
    .unwrap();
    until(&core, &window, LocalAgentPhase::Responding);
    *core.inner.link_file.lock().unwrap() = None;
    emit_state(&core);
    assert_eq!(attach(&core, &window).generation, second.generation);
    core.handle(CoreRequest::LocalAgentCancel {
        window_id: window.clone(),
        generation: second.generation.clone(),
    })
    .unwrap();
    wait_for(|| {
        attach(&core, &window).generation != second.generation
            && attach(&core, &window).phase == LocalAgentPhase::Ready
    });
    assert_eq!(
        calls(&temp.path().join("calls"))
            .iter()
            .filter(|v| v["method"] == "session/load")
            .count(),
        2
    );
    core.shutdown();
}

#[test]
fn storage_defaults_only_apply_before_a_link() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "agent");
    assert!(
        !crate::app_storage::read(&core.inner, &window, "agents")
            .unwrap()
            .exists
    );
    let err = core
        .handle(CoreRequest::StorageWrite {
            window_id: window.clone(),
            entry: "agents".into(),
            content: json!([]),
            expected_revision: kaleidoscope_contract::app_storage::ExpectedRevision(None),
        })
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Unavailable);
    core.inner.state.lock().unwrap().link = LinkStatus::Pairing {
        server_url: "https://example.test".into(),
        user_code: "1234".into(),
        expires_at: "later".into(),
    };
    assert!(
        !crate::app_storage::read(&core.inner, &window, "agents")
            .unwrap()
            .exists
    );
    *core.inner.link_file.lock().unwrap() = Some(connected_link_file());
    assert_eq!(
        crate::app_storage::read(&core.inner, &window, "agents")
            .unwrap_err()
            .code,
        ErrorCode::Unavailable
    );
    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        server_url: "https://example.test".into(),
        device_name: "test".into(),
        reason: "offline".into(),
    };
    assert_eq!(
        crate::app_storage::read(&core.inner, &window, "agents")
            .unwrap_err()
            .code,
        ErrorCode::Unavailable
    );
}

#[test]
fn changed_storage_requires_new_execution_consent() {
    use kaleidoscope_contract::app_storage::{StorageSnapshot, StorageUpdate};
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let definition = fake_definition(temp.path());
    let registry = registry_client();
    let core = open_core_with_client(
        temp.path(),
        vec![definition.to_string()],
        &host,
        registry.clone(),
    );
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
    let ready = allow_and_start(&core, &window);
    let old_hash = kaleidoscope_contract::local_agent::agent_spec_hash(
        &kaleidoscope_contract::local_agent::validate_agent_specs(
            &definition["storage"]["entries"][0]["default"],
        )
        .unwrap()[0],
    );
    let mut changed = definition["storage"]["entries"][0]["default"].clone();
    changed[0]["args"] = json!(["changed"]);
    *registry.storage_value.lock().unwrap() = Some((changed, "revision".into()));
    mark_connected(&core);
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
    let next = until(&core, &window, LocalAgentPhase::AwaitingPermission);
    assert_ne!(next.generation, ready.generation);
    assert_eq!(next.execution.unwrap().args, vec!["changed"]);
    assert_eq!(
        core.handle(CoreRequest::LocalAgentAllow {
            window_id: window,
            spec_hash: old_hash
        })
        .unwrap_err()
        .code,
        ErrorCode::InvalidRequest
    );
}

#[test]
fn changing_folder_while_storage_loads_waits_for_the_spec() {
    use kaleidoscope_contract::app_storage::{StorageSnapshot, StorageUpdate};
    let temp = TempDir::new().unwrap();
    let first = TempDir::new().unwrap();
    let second = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(first.path().into()));
    let definition = fake_definition(temp.path());
    let registry = registry_client();
    *registry.storage_value.lock().unwrap() = Some((
        definition["storage"]["entries"][0]["default"].clone(),
        "revision".into(),
    ));
    let core = open_core_with_client(
        temp.path(),
        vec![definition.to_string()],
        &host,
        registry.clone(),
    );
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
    let first_ready = allow_and_start(&core, &window);
    mark_connected(&core);
    emit_state(&core);
    wait_for(|| {
        let current = attach(&core, &window);
        current.generation != first_ready.generation && current.phase == LocalAgentPhase::Ready
    });
    let current = attach(&core, &window);
    let (release, pause) = mpsc::channel();
    *registry.storage_pause.lock().unwrap() = Some(pause);
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
            Some(kaleidoscope_contract::data::BindingValue::Loading {})
        )
    });
    host.choose(Some(second.path().into()));
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "work".into(),
    })
    .unwrap();
    assert_eq!(attach(&core, &window).generation, current.generation);
    release.send(()).unwrap();
    wait_for(|| {
        let next = attach(&core, &window);
        next.generation != current.generation && next.phase == LocalAgentPhase::Ready
    });
}
