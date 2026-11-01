use super::*;

#[test]
fn state_notification_does_not_restore_older_snapshot_after_share_delete() {
    let dir = TempDir::new().unwrap();
    let client = registry_client();
    let core = Arc::new(open_core_with_client(
        dir.path(),
        vec![],
        &Arc::new(FakeHost::default()),
        client.clone(),
    ));
    mark_connected(&core);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "calculator");
    core.handle(CoreRequest::ShareSet {
        window_id: window.clone(),
        on: true,
    })
    .unwrap();
    let (release, pause) = mpsc::channel();
    *client.share_delete_pause.lock().unwrap() = Some(pause);
    let (send, receive) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::StateChanged { snapshot } = event {
            let _ = send.send(snapshot.clone());
        }
    }));
    let closing_core = core.clone();
    let closing_window = window.clone();
    let closing = thread::spawn(move || {
        closing_core.handle(CoreRequest::WindowClose {
            window_id: closing_window,
        })
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while client.share_deletes.lock().unwrap().is_empty() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    assert!(!client.share_deletes.lock().unwrap().is_empty());
    core.set_update_status(kaleidoscope_contract::UpdateStatus::Idle {
        current_version: "최신".into(),
    });
    release.send(()).unwrap();
    closing.join().unwrap().unwrap();
    let latest = receive.try_iter().last().unwrap();
    assert_eq!(
        latest.update,
        kaleidoscope_contract::UpdateStatus::Idle {
            current_version: "최신".into()
        }
    );
    assert!(!latest.shared.windows.iter().any(|item| item.id == window));
}

#[test]
fn state_listener_can_make_another_change_in_order() {
    let dir = TempDir::new().unwrap();
    let core = Arc::new(open_core(
        dir.path(),
        vec![],
        &Arc::new(FakeHost::default()),
    ));
    let target = Arc::downgrade(&core);
    let observed = Arc::new(Mutex::new(Vec::new()));
    let listener_observed = observed.clone();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::StateChanged { snapshot } = event {
            if let kaleidoscope_contract::UpdateStatus::Idle { current_version } = &snapshot.update
            {
                listener_observed
                    .lock()
                    .unwrap()
                    .push(current_version.clone());
                if current_version == "첫째" {
                    target.upgrade().unwrap().set_update_status(
                        kaleidoscope_contract::UpdateStatus::Idle {
                            current_version: "둘째".into(),
                        },
                    );
                }
            }
        }
    }));
    core.set_update_status(kaleidoscope_contract::UpdateStatus::Idle {
        current_version: "첫째".into(),
    });
    assert_eq!(*observed.lock().unwrap(), vec!["첫째", "둘째"]);
}

#[test]
fn app_binding_totals_count_each_evaluation_once() {
    let profiler = crate::profiler::Profiler::default();
    profiler.span("data.view", "화면", "example", "예제", 1.0, 2, 22, "");
    profiler.span(
        "data.state_change",
        "상태",
        "example",
        "예제",
        2.0,
        2,
        22,
        "",
    );
    let snapshot = profiler.snapshot("all");
    let app = &snapshot["apps"][0];
    assert_eq!(app["evaluated_bindings"], 2);
    assert_eq!(app["skipped_bindings"], 22);
}

#[test]
fn action_uses_current_state_after_a_waiting_call() {
    use kaleidoscope_contract::registry::{ConnectionInfo, ConnectionKind};
    let dir = TempDir::new().unwrap();
    let client = registry_client();
    client.connection_replies.lock().unwrap().insert(
        "/old".into(),
        kaleidoscope_contract::registry::ConnectionReply {
            status: 200,
            mime: "application/json".into(),
            json: Some(json!({})),
            text: None,
            data_base64: None,
        },
    );
    let definition = json!({"id":"action-wait", "name":"동작 시험", "requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"readwrite","label":"API"}],
        "state":{"amount":1,"result":0}, "ui":{"type":"button","label":"실행","on_click":[
            {"call":{"permission":"api","method":"POST","path":"/old"}},
            {"set_state":"result","value":{"expr":"$state.amount * 2"}}
        ]}}).to_string();
    let core = Arc::new(open_core_with_client(
        dir.path(),
        vec![definition],
        &Arc::new(FakeHost::default()),
        client.clone(),
    ));
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![ConnectionInfo {
        name: "example".into(),
        kind: ConnectionKind::Relay,
        base_url: "https://example.test".into(),
        writable: true,
        paths: vec![],
        issuer: None,
        scopes: None,
        resource: None,
    }];
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "action-wait");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    let (release, pause) = mpsc::channel();
    *client.connection_pause.lock().unwrap() = Some(pause);
    let action_core = core.clone();
    let action_window = window.clone();
    let action = thread::spawn(move || {
        action_core.handle(CoreRequest::DataAct {
            window_id: action_window,
            pointer: "/ui/on_click".into(),
            event: Value::Null,
            item: Value::Null,
        })
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while client.connection_requests.lock().unwrap().is_empty() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    assert!(!client.connection_requests.lock().unwrap().is_empty());
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: BTreeMap::from([("amount".into(), json!(7)), ("result".into(), json!(0))]),
    })
    .unwrap();
    release.send(()).unwrap();
    action.join().unwrap().unwrap();
    let state = snapshot(&core)
        .shared
        .windows
        .into_iter()
        .find(|item| item.id == window)
        .unwrap()
        .state;
    assert_eq!(state["amount"], json!(7));
    assert_eq!(state["result"], json!(14.0));
}
