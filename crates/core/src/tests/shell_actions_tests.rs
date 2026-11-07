use super::*;

fn actor() -> String {
    json!({
        "id":"shell-actor", "name":"쉘 시험",
        "requires":{"blocks":4,"modules":{"shell":1}},
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"button","label":"열기","on_click":[{"shell.open":{"app_id":"target"}}]},
            {"type":"button","label":"추가","on_click":[{"shell.add_shortcut":{"app_id":"target"}}]},
            {"type":"button","label":"없는 앱 열기","on_click":[{"shell.open":{"app_id":"missing"}}]},
            {"type":"button","label":"없는 앱 추가","on_click":[{"shell.add_shortcut":{"app_id":"missing"}}]}
        ]}
    })
    .to_string()
}

fn target() -> String {
    json!({"id":"target","name":"대상","requires":{"blocks":4,"modules":{}},"ui":{"type":"text","value":"대상"}}).to_string()
}

fn link() -> LinkFile {
    LinkFile {
        revoked: false,
        mode: Default::default(),
        format: 1,
        server_url: "http://127.0.0.1:4219".into(),
        device_id: "device".into(),
        device_name: "시험".into(),
        token: "test".into(),
    }
}

fn press(core: &Core, window: &str, pointer: &str) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::DataAct {
        window_id: window.into(),
        pointer: pointer.into(),
        event: Value::Null,
        item: Value::Null,
        modifiers: None,
    })
}

#[test]
fn shell_actions_use_the_calling_windows_desktop_and_mark_sync() {
    let temp = TempDir::new().unwrap();
    let core = Arc::new(open_core(
        temp.path(),
        vec![actor(), target()],
        &Arc::new(FakeHost::default()),
    ));
    let (workspace, desktop) = active_ids(&core);
    let caller = open_window(&core, &desktop, "shell-actor");
    core.handle(CoreRequest::DataAttach {
        window_id: caller.clone(),
        dormant: vec![],
    })
    .unwrap();
    *core.inner.link_file.lock().unwrap() = Some(link());
    let CoreReply::DesktopCreate { desktop: second } = core
        .handle(CoreRequest::DesktopCreate {
            workspace_id: workspace,
            name: "둘째".into(),
        })
        .unwrap()
    else {
        panic!("desktop.create 응답")
    };
    core.handle(CoreRequest::DesktopActivate {
        desktop_id: second.id.clone(),
    })
    .unwrap();

    press(&core, &caller, "/ui/children/0/on_click").unwrap();
    press(&core, &caller, "/ui/children/0/on_click").unwrap();
    {
        let state = core.inner.state.lock().unwrap();
        let opened: Vec<_> = state
            .shared
            .windows
            .iter()
            .filter(|window| window.app_id == "target")
            .collect();
        assert_eq!(opened.len(), 2, "누를 때마다 새 창을 연다");
        assert!(opened.iter().all(|window| window.desktop_id == desktop));
        assert!(opened.iter().all(|window| window.desktop_id != second.id));
        assert!(state.sync.pending.keys().any(|key| {
            key.kind == crate::sync_state::EntityKind::Window && key.id == opened[0].id
        }));
    }

    press(&core, &caller, "/ui/children/1/on_click").unwrap();
    let shortcut_id = format!("{desktop}/target");
    {
        let state = core.inner.state.lock().unwrap();
        let shortcuts: Vec<_> = state
            .shared
            .desktop_shortcuts
            .iter()
            .filter(|shortcut| shortcut.app_id == "target")
            .collect();
        assert_eq!(shortcuts.len(), 1);
        assert_eq!(shortcuts[0].id, shortcut_id);
        assert_eq!(shortcuts[0].desktop_id, desktop);
        assert!(state.sync.pending.keys().any(|key| {
            key.kind == crate::sync_state::EntityKind::DesktopShortcut && key.id == shortcut_id
        }));
    }
    press(&core, &caller, "/ui/children/1/on_click").unwrap();
    assert_eq!(
        core.inner
            .state
            .lock()
            .unwrap()
            .shared
            .desktop_shortcuts
            .iter()
            .filter(|shortcut| shortcut.id == shortcut_id)
            .count(),
        1,
        "같은 데스크톱에 두 번 놓지 않는다"
    );
}

#[test]
fn shell_actions_report_missing_apps() {
    let temp = TempDir::new().unwrap();
    let core = Arc::new(open_core(
        temp.path(),
        vec![actor(), target()],
        &Arc::new(FakeHost::default()),
    ));
    let (_, desktop) = active_ids(&core);
    let caller = open_window(&core, &desktop, "shell-actor");
    core.handle(CoreRequest::DataAttach {
        window_id: caller.clone(),
        dormant: vec![],
    })
    .unwrap();
    let error = press(&core, &caller, "/ui/children/2/on_click").unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DESK_WINDOW_OPEN_APP_NOT_FOUND"));
    let error = press(&core, &caller, "/ui/children/3/on_click").unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DESK_SHORTCUT_ADD_APP_NOT_FOUND"));
}

#[test]
fn store_detail_opens_and_adds_the_selected_builtin_app() {
    let temp = TempDir::new().unwrap();
    let core = Arc::new(open_core(temp.path(), vec![], &Arc::new(FakeHost::default())));
    let (_, desktop) = active_ids(&core);
    let store = open_window(&core, &desktop, "store");
    *core.inner.store_transport.lock().unwrap() = Some(Arc::new(crate::store::tests::fixture().0));
    core.handle(CoreRequest::DataAttach {
        window_id: store.clone(),
        dormant: vec!["catalog".into(), "detail".into()],
    })
    .unwrap();

    let item = json!({
        "key":"https://kaleidoscope.eiaserinnys.me/appstore/calculator",
        "title":"계산기",
        "server":"https://kaleidoscope.eiaserinnys.me/appstore",
        "id":"calculator"
    });
    core.handle(CoreRequest::DataAct {
        window_id: store.clone(),
        pointer: "/ui/children/1/children/1/on_select".into(),
        event: Value::Null,
        item,
        modifiers: None,
    })
    .unwrap();
    assert!(matches!(
        crate::data_runtime::binding_value(&core.inner, &store, "/ui/children/2/children/3/value"),
        Some(kaleidoscope_contract::data::BindingValue::Ready { value, .. }) if value == json!(true)
    ), "설치된 앱을 고르면 열기와 바탕화면에 추가 줄이 보인다");

    let open = "/ui/children/2/children/3/child/end/1/on_click";
    let add = "/ui/children/2/children/3/child/end/0/on_click";
    press(&core, &store, open).unwrap();
    assert_eq!(calculator_windows(&core, &desktop), 1);
    press(&core, &store, open).unwrap();
    assert_eq!(calculator_windows(&core, &desktop), 2);

    press(&core, &store, add).unwrap();
    let shortcut_id = format!("{desktop}/calculator");
    assert_eq!(
        core.inner
            .state
            .lock()
            .unwrap()
            .shared
            .desktop_shortcuts
            .iter()
            .filter(|shortcut| shortcut.id == shortcut_id)
            .count(),
        1
    );
    press(&core, &store, add).unwrap();
    assert_eq!(
        core.inner
            .state
            .lock()
            .unwrap()
            .shared
            .desktop_shortcuts
            .iter()
            .filter(|shortcut| shortcut.id == shortcut_id)
            .count(),
        1,
        "단추를 다시 눌러도 아이콘은 하나다"
    );
    assert!(matches!(
        crate::data_runtime::binding_value(&core.inner, &store, "/ui/children/2/children/3/child/end/0/label"),
        Some(kaleidoscope_contract::data::BindingValue::Ready { value, .. }) if value == json!("바탕화면에 있음")
    ));
    assert!(matches!(
        crate::data_runtime::binding_value(&core.inner, &store, "/ui/children/2/children/3/child/end/0/disabled"),
        Some(kaleidoscope_contract::data::BindingValue::Ready { value, .. }) if value == json!(true)
    ));
}

fn calculator_windows(core: &Core, desktop: &str) -> usize {
    core.inner
        .state
        .lock()
        .unwrap()
        .shared
        .windows
        .iter()
        .filter(|window| window.app_id == "calculator" && window.desktop_id == desktop)
        .count()
}
