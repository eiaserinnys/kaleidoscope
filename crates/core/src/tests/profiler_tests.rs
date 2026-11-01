use super::*;
use kaleidoscope_contract::data::{BindingValue, HttpMethod};
use kaleidoscope_contract::registry::ConnectionAccept;

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
