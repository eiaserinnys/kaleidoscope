use super::*;
use kaleidoscope_contract::data::{BindingValue, HttpMethod};
use kaleidoscope_contract::registry::ConnectionAccept;

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

fn benchmark_definition() -> String {
    let mut children: Vec<Value> = (0..24).map(|index| json!({"type":"text","value":{"expr":if index < 2 {"$state.active_tab"} else {"$state.other"}}})).collect();
    let steps: Vec<_> = ["a", "b", "c", "d"]
        .into_iter()
        .map(|key| json!({"set_state":key,"value":{"expr":"$state.active_tab + 1"}}))
        .collect();
    children.push(json!({"type":"button","label":"실행","on_click":steps}));
    json!({"id":"speed-test","name":"속도 시험","requires":{"blocks":4,"modules":{}},"state":{"active_tab":0,"other":1,"a":0,"b":0,"c":0,"d":0},"ui":{"type":"stack","direction":"column","children":children}}).to_string()
}

#[test]
fn profiler_builtin_app_renders_metrics_and_supports_share_view() {
    let dir = TempDir::new().unwrap();
    let core = open_core(dir.path(), vec![], &Arc::new(FakeHost::default()));
    let (workspace, desktop) = active_ids(&core);
    let profiler = open_window(&core, &desktop, "profiler");
    let calculator = open_window(&core, &desktop, "calculator");
    core.handle(CoreRequest::DataAttach {
        window_id: calculator.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::DataAct {
        window_id: calculator.clone(),
        pointer: "/ui/children/1/on_press".into(),
        event: json!("1"),
        item: Value::Null,
    })
    .unwrap();
    let mut calc_state = snapshot(&core)
        .shared
        .windows
        .into_iter()
        .find(|w| w.id == calculator)
        .unwrap()
        .state;
    calc_state.get_mut("calc").unwrap()["display"] = json!("2");
    core.handle(CoreRequest::WindowSetState {
        window_id: calculator,
        state: calc_state,
    })
    .unwrap();
    core.handle(CoreRequest::DataAttach {
        window_id: profiler.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::DataAct {
        window_id: profiler.clone(),
        pointer: "/ui/children/0/end/0/on_click".into(),
        event: Value::Null,
        item: Value::Null,
    })
    .unwrap();
    let reply = crate::connections::request(
        &core.inner,
        &profiler,
        "core_profiler",
        HttpMethod::Get,
        "/snapshot",
        BTreeMap::new(),
        None,
        ConnectionAccept::Json,
    )
    .unwrap()
    .json
    .unwrap();
    assert!(reply["summary"]["total_spans"].as_u64().unwrap() > 0);
    let filtered = crate::connections::request(
        &core.inner,
        &profiler,
        "core_profiler",
        HttpMethod::Get,
        "/snapshot",
        BTreeMap::from([("category".into(), "data.view".into())]),
        None,
        ConnectionAccept::Json,
    )
    .unwrap()
    .json
    .unwrap();
    for key in ["recent_spans", "slowest_spans"] {
        let rows = filtered[key].as_array().unwrap();
        assert!(!rows.is_empty());
        assert!(rows.iter().all(|row| row["category"] == "data.view"));
    }
    for key in [
        "metrics",
        "categories",
        "apps",
        "slowest_spans",
        "slowest_bindings",
        "recent_spans",
    ] {
        assert!(!reply[key].as_array().unwrap().is_empty(), "{key}");
    }
    assert!(
        matches!(crate::data_runtime::binding_value(&core.inner, &profiler, "/ui/children/1/items"), Some(BindingValue::Ready { value }) if value.as_array().is_some_and(|items| items.len() == 4))
    );
    for pointer in [
        "/ui/children/2/tabs/0/child/children/0/child/series",
        "/ui/children/2/tabs/0/child/children/1/children/0/rows",
        "/ui/children/2/tabs/0/child/children/1/children/1/rows",
        "/ui/children/2/tabs/1/child/children/0/rows",
        "/ui/children/2/tabs/1/child/children/1/rows",
        "/ui/children/2/tabs/2/child/rows",
    ] {
        assert!(
            matches!(crate::data_runtime::binding_value(&core.inner, &profiler, pointer), Some(BindingValue::Ready { value }) if value.as_array().is_some_and(|rows| !rows.is_empty()) || value.is_object()),
            "{pointer}"
        );
    }
    let text = format!("평균 명령 응답 {} ms", reply["summary"]["avg_command_ms"]);
    core.handle(CoreRequest::ShareSet {
        window_id: profiler.clone(),
        on: true,
    })
    .unwrap();
    core.handle(CoreRequest::ShareView {
        window_id: profiler.clone(),
        view: kaleidoscope_contract::VisibleView {
            text: text.clone(),
            visual: false,
            bounds: Rect {
                x: 0,
                y: 0,
                width: 900,
                height: 620,
            },
        },
    })
    .unwrap();
    let (share, _) = crate::share::prepare_text(&core.inner, &workspace, "conv-1").unwrap();
    assert!(
        share.contains("<kaleidoscope-share>")
            && share.contains("프로파일러")
            && share.contains(&text)
    );
    core.flush_storage().unwrap();
    core.handle(CoreRequest::DataAct {
        window_id: profiler.clone(),
        pointer: "/ui/children/0/end/2/on_click".into(),
        event: Value::Null,
        item: Value::Null,
    })
    .unwrap();
    let cleared = crate::connections::request(
        &core.inner,
        &profiler,
        "core_profiler",
        HttpMethod::Get,
        "/snapshot",
        BTreeMap::new(),
        None,
        ConnectionAccept::Json,
    )
    .unwrap()
    .json
    .unwrap();
    assert_eq!(cleared["summary"]["total_spans"], 0);
    assert!(cleared["recent_spans"].as_array().unwrap().is_empty());
}

#[test]
fn action_preserves_completed_state_when_later_step_fails() {
    let dir = TempDir::new().unwrap();
    let def = json!({"id":"failure-test","name":"실패 시험","requires":{"blocks":4,"modules":{}},"state":{"first":0,"second":0},"ui":{"type":"button","label":"실행","on_click":[{"set_state":"first","value":1},{"set_state":"second","value":{"expr":"$error('중단')"}}]}}).to_string();
    let core = open_core(dir.path(), vec![def], &Arc::new(FakeHost::default()));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "failure-test");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    assert!(core
        .handle(CoreRequest::DataAct {
            window_id: window.clone(),
            pointer: "/ui/on_click".into(),
            event: Value::Null,
            item: Value::Null
        })
        .is_err());
    let state = snapshot(&core)
        .shared
        .windows
        .into_iter()
        .find(|w| w.id == window)
        .unwrap()
        .state;
    assert_eq!(state["first"], 1);
    assert_eq!(state["second"], 0);
}

#[test]
fn responsiveness_benchmark_compares_legacy_and_optimized_paths() {
    let definition = benchmark_definition();
    let app = kaleidoscope_contract::validate::parse_app_definition(&definition).unwrap();
    let compiled = kaleidoscope_data::CompiledApp::compile(&app);
    let legacy_dir = TempDir::new().unwrap();
    let legacy = open_core(
        legacy_dir.path(),
        vec![definition.clone()],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&legacy);
    let legacy_id = open_window(&legacy, &desktop, "speed-test");
    let mut values = app.state.clone();
    let started = Instant::now();
    for iteration in 0..70 {
        if iteration < 30 {
            values.insert("active_tab".into(), json!(iteration));
        } else {
            let key = ["a", "b", "c", "d"][(iteration - 30) % 4];
            values.insert(key.into(), json!(30.0));
        }
        let mut state = legacy.inner.state.lock().unwrap();
        crate::state_commands::handle(
            &mut state,
            CoreRequest::WindowSetState {
                window_id: legacy_id.clone(),
                state: values.clone(),
            },
        )
        .unwrap();
        crate::storage::save_state(&legacy.inner.data_dir, &state.shared, &state.device).unwrap();
        crate::sync_state::save(&legacy.inner.data_dir, &state.sync).unwrap();
        let _ = compiled.evaluate_with_data_meta(
            &values,
            &BTreeMap::new(),
            &BTreeMap::new(),
            &BTreeMap::new(),
            &BTreeMap::new(),
            &BTreeMap::new(),
            None,
        );
    }
    let legacy_ms = started.elapsed().as_secs_f64() * 1000.0;
    let dir = TempDir::new().unwrap();
    let core = open_core(dir.path(), vec![definition], &Arc::new(FakeHost::default()));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "speed-test");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    let mut values = app.state.clone();
    let started = Instant::now();
    for iteration in 0..30 {
        values.insert("active_tab".into(), json!(iteration));
        core.handle(CoreRequest::WindowSetState {
            window_id: window.clone(),
            state: values.clone(),
        })
        .unwrap();
    }
    for _ in 0..10 {
        core.handle(CoreRequest::DataAct {
            window_id: window.clone(),
            pointer: "/ui/children/24/on_click".into(),
            event: Value::Null,
            item: Value::Null,
        })
        .unwrap();
    }
    core.flush_storage().unwrap();
    let optimized_ms = started.elapsed().as_secs_f64() * 1000.0;
    let stored = crate::storage::load_shared(dir.path()).unwrap();
    let actual = snapshot(&core).shared;
    let legacy_state = snapshot(&legacy)
        .shared
        .windows
        .into_iter()
        .find(|window| window.id == legacy_id)
        .unwrap()
        .state;
    assert_eq!(
        stored
            .windows
            .iter()
            .find(|w| w.id == window)
            .unwrap()
            .state,
        actual
            .windows
            .iter()
            .find(|w| w.id == window)
            .unwrap()
            .state
    );
    assert_eq!(
        stored
            .windows
            .iter()
            .find(|w| w.id == window)
            .unwrap()
            .state,
        legacy_state
    );
    let summary = core.inner.profiler.snapshot("all")["summary"].clone();
    println!("개선 전 {legacy_ms:.3} ms, 회당 {:.3} ms; 개선 후 {optimized_ms:.3} ms, 회당 {:.3} ms; 향상 {:.2}배; 생략 {}, 저장 병합 {}, 액션 병합 {}", legacy_ms / 40.0, optimized_ms / 40.0, legacy_ms / optimized_ms, summary["skipped_bindings"], summary["coalesced_disk_writes"], summary["batched_action_steps"]);
    assert!(summary["skipped_bindings"].as_u64().unwrap() > 0);
    assert!(summary["coalesced_disk_writes"].as_u64().unwrap() > 0);
    assert_eq!(summary["batched_action_steps"], 30);
    assert!(
        optimized_ms < legacy_ms,
        "개선 전 {legacy_ms:.3} ms, 개선 후 {optimized_ms:.3} ms"
    );
}

#[test]
fn deferred_save_and_immediate_change_keep_latest_state() {
    let dir = TempDir::new().unwrap();
    let core = open_core(
        dir.path(),
        vec![benchmark_definition()],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "speed-test");
    let mut values = snapshot(&core)
        .shared
        .windows
        .into_iter()
        .find(|w| w.id == window)
        .unwrap()
        .state;
    values.insert("active_tab".into(), json!(7));
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: values,
    })
    .unwrap();
    let second = open_window(&core, &desktop, "calculator");
    let stored = crate::storage::load_shared(dir.path()).unwrap();
    assert_eq!(
        stored
            .windows
            .iter()
            .find(|w| w.id == window)
            .unwrap()
            .state["active_tab"],
        7
    );
    assert!(stored.windows.iter().any(|w| w.id == second));
    drop(core);
    let stored = crate::storage::load_shared(dir.path()).unwrap();
    assert!(stored.windows.iter().any(|w| w.id == second));
}
