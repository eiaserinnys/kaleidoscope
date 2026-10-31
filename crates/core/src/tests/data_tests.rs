use super::*;
use kaleidoscope_contract::data::{BindingValue, SourceStatus};

fn definition() -> String {
    json!({
        "id":"data-app","name":"Data","requires":{"blocks":4,"modules":{"files":1}},
        "permissions":[{"module":"files","id":"docs","access":"read","label":"Docs"}],
        "state":{"path":"one.json","selected":"first"},
        "sources":{
            "file":{"kind":"file","permission":"docs","path":{"state":"path"}},
            "folder":{"kind":"folder","permission":"docs"}
        },
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"text","value":{"expr":"$data.file.title"}},
            {"type":"text","value":{"expr":"$state.selected"}},
            {"type":"list","items":{"expr":"$data.folder"}}
        ]}
    })
    .to_string()
}

#[test]
fn attach_fetches_and_state_change_sends_only_changed_values() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("one.json"), r#"{"title":"One"}"#).unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().to_path_buf()));
    let core = open_core(temp.path(), vec![definition()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "data-app");
    pick_folder(&core, &window);
    let (sender, receiver) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = sender.send(event.clone());
    }));
    let reply = core
        .handle(CoreRequest::DataAttach {
            window_id: window.clone(),
        })
        .unwrap();
    assert!(
        matches!(reply,CoreReply::DataAttach{view} if matches!(view.sources["file"],SourceStatus::Loading{..}))
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut ready = false;
    let mut folder_ready = false;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) =
            receiver.recv_timeout(Duration::from_millis(100))
        {
            if matches!(view.values.get("/ui/children/0/value"),Some(BindingValue::Ready{value}) if value == "One")
            {
                ready = true;
            }
            if matches!(view.values.get("/ui/children/2/items"),Some(BindingValue::Ready{value}) if value.as_array().is_some_and(|items| items.iter().any(|item| item["path"] == "one.json")))
            {
                folder_ready = true;
            }
            if ready && folder_ready {
                break;
            }
        }
    }
    assert!(ready, "file value arrived");
    assert!(folder_ready, "folder value arrived");
    while receiver.try_recv().is_ok() {}
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: BTreeMap::from([
            ("path".into(), json!("one.json")),
            ("selected".into(), json!("second")),
        ]),
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut changed = false;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) =
            receiver.recv_timeout(Duration::from_millis(100))
        {
            if view.values.get("/ui/children/1/value")
                == Some(&BindingValue::Ready {
                    value: json!("second"),
                })
            {
                assert!(!view.values.contains_key("/ui/children/0/value"));
                changed = true;
                break;
            }
        }
    }
    assert!(changed, "state value changed");
}

fn connection_definition() -> String {
    json!({
        "id":"connection-app","name":"Connection","requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"readwrite","label":"API"}],
        "state":{"path":"/old","selected":null},
        "sources":{"items":{"kind":"request","permission":"api","path":{"state":"path"},"query":{"n":3}}},
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"list","items":{"expr":"$data.items"},"on_select":[
                {"set_state":"selected","value":{"expr":"$item.key"}},
                {"refresh":["items"]},
                {"call":{"permission":"api","method":"POST","path":"/save","body":{"expr":"$state.selected"}}},
                {"set_state":"selected","value":"should-not-run"}
            ]},
            {"type":"button","label":"clear","on_click":[{"set_state":"selected","value":null}]},
            {"type":"button","label":"event","on_click":[{"set_state":"selected"}]}
        ]}
    }).to_string()
}
fn info(
    kind: kaleidoscope_contract::registry::ConnectionKind,
) -> kaleidoscope_contract::registry::ConnectionInfo {
    kaleidoscope_contract::registry::ConnectionInfo {
        name: "example".into(),
        kind,
        base_url: "https://example.test".into(),
        writable: true,
        paths: vec![],
        issuer: None,
        scopes: None,
        resource: None,
    }
}
fn response(status: u16, body: Value) -> kaleidoscope_contract::registry::ConnectionReply {
    kaleidoscope_contract::registry::ConnectionReply {
        status,
        mime: "application/json".into(),
        json: Some(body),
        text: None,
        data_base64: None,
    }
}
fn wait_until(mut predicate: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(5);
    while Instant::now() < end {
        if predicate() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("상태를 기다리다 시간 초과");
}

#[test]
fn late_source_results_are_discarded_and_calls_are_ordered() {
    use kaleidoscope_contract::registry::{ConnectionAccept, ConnectionKind};
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().extend([
        ("/old".into(), response(200, json!([{"key":"old"}]))),
        ("/new".into(), response(200, json!([{"key":"new"}]))),
        ("/save".into(), response(500, json!({"error":"failure"}))),
    ]);
    let (release, wait) = mpsc::channel();
    *client.connection_pause.lock().unwrap() = Some(wait);
    let core = open_core_with_client(
        temp.path(),
        vec![connection_definition()],
        &host,
        client.clone(),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    wait_until(|| !client.connection_requests.lock().unwrap().is_empty());
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: BTreeMap::from([
            ("path".into(), json!("/new")),
            ("selected".into(), Value::Null),
        ]),
    })
    .unwrap();
    wait_until(|| {
        client
            .connection_requests
            .lock()
            .unwrap()
            .iter()
            .any(|request| request.path == "/new")
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut new_value = false;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) = rx.recv_timeout(Duration::from_millis(100))
        {
            if matches!(view.values.get("/ui/children/0/items"), Some(BindingValue::Ready { value }) if value == &json!([{"key":"new"}]))
            {
                new_value = true;
                break;
            }
        }
    }
    assert!(new_value);
    release.send(()).unwrap();
    let deadline = Instant::now() + Duration::from_millis(300);
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) = rx.recv_timeout(Duration::from_millis(50)) {
            assert!(
                !matches!(view.values.get("/ui/children/0/items"), Some(BindingValue::Ready { value }) if value == &json!([{"key":"old"}]))
            );
        }
    }
    let err = core
        .handle(CoreRequest::DataAct {
            window_id: window.clone(),
            pointer: "/ui/children/0/on_select".into(),
            event: json!("event"),
            item: json!({"key":"picked"}),
        })
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Server);
    assert!(err.message.contains("500"));
    assert_eq!(
        snapshot(&core)
            .shared
            .windows
            .iter()
            .find(|w| w.id == window)
            .unwrap()
            .state["selected"],
        json!("picked")
    );
    let requests = client.connection_requests.lock().unwrap();
    let new = requests.iter().find(|r| r.path == "/new").unwrap();
    assert_eq!(new.app_id, "connection-app");
    assert_eq!(new.query.get("n").map(String::as_str), Some("3"));
    assert_eq!(new.accept, ConnectionAccept::Json);
    let tail = &requests[requests.len() - 2..];
    assert_eq!(tail[0].path, "/new");
    assert_eq!(tail[1].path, "/save");
    assert_eq!(tail[1].body, Some(json!("picked")));
}

#[test]
fn oauth_requires_login_and_media_is_resized_and_cached() {
    use kaleidoscope_contract::{data::MediaRef, registry::ConnectionKind};
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![connection_definition()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Oauth)];
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    core.handle(CoreRequest::DataAttach { window_id: window })
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut login = false;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) = rx.recv_timeout(Duration::from_millis(100))
        {
            if matches!(view.sources.get("items"),Some(SourceStatus::LoginRequired{permission}) if permission=="api")
            {
                login = true;
                break;
            }
        }
    }
    assert!(login);

    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    image::RgbaImage::from_pixel(80, 40, image::Rgba([255, 0, 0, 128]))
        .save(folder.path().join("test.png"))
        .unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().to_path_buf()));
    let core = open_core(temp.path(), vec![definition()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "data-app");
    pick_folder(&core, &window);
    let media = MediaRef::Resource(kaleidoscope_contract::data::ResourceMediaRef {
        permission: "docs".into(),
        path: "test.png".into(),
        query: BTreeMap::new(),
        crop: None,
    });
    let first = core
        .handle(CoreRequest::DataMedia {
            window_id: window.clone(),
            media: media.clone(),
            max_px: Some(20),
        })
        .unwrap();
    let count = core.inner.media_cache.len();
    let second = core
        .handle(CoreRequest::DataMedia {
            window_id: window,
            media,
            max_px: Some(20),
        })
        .unwrap();
    assert_eq!(first, second);
    assert_eq!(count, core.inner.media_cache.len());
    assert!(
        matches!(first,CoreReply::DataMedia{media} if media.mime=="image/png" && media.width==Some(20) && media.height==Some(10))
    );
}

#[test]
fn explicit_null_and_absent_action_value_are_distinct() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![connection_definition()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::DataAct {
        window_id: window.clone(),
        pointer: "/ui/children/1/on_click".into(),
        event: json!("event"),
        item: Value::Null,
    })
    .unwrap();
    assert_eq!(
        snapshot(&core).shared.windows[0].state["selected"],
        Value::Null
    );
    core.handle(CoreRequest::DataAct {
        window_id: window.clone(),
        pointer: "/ui/children/2/on_click".into(),
        event: json!("event"),
        item: Value::Null,
    })
    .unwrap();
    assert_eq!(
        snapshot(&core).shared.windows[0].state["selected"],
        json!("event")
    );
}

#[test]
fn failed_relay_has_retry_and_read_permission_rejects_post() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(500, json!({"reason":"error"})));
    let core = open_core_with_client(temp.path(), vec![connection_definition()], &host, client);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut failed = false;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) = rx.recv_timeout(Duration::from_millis(100))
        {
            if matches!(view.values.get("/ui/children/0/items"),Some(BindingValue::Failed{message,retry}) if message.contains("500") && retry == &vec!["items".to_owned()])
            {
                failed = true;
                break;
            }
        }
    }
    assert!(failed, "서버 오류와 다시 받기 원천");
    {
        let mut state = core.inner.state.lock().unwrap();
        let version = state
            .shared
            .app_versions
            .iter_mut()
            .find(|v| v.app_id == "connection-app")
            .unwrap();
        if let kaleidoscope_contract::PermissionDecl::Connection { access, .. } =
            &mut version.definition.permissions[0]
        {
            *access = kaleidoscope_contract::FileAccess::Read;
        }
    }
    let err = core
        .handle(CoreRequest::DataAct {
            window_id: window,
            pointer: "/ui/children/0/on_select".into(),
            event: json!("x"),
            item: json!({"key":"x"}),
        })
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionDenied);
}

#[test]
fn closing_window_discards_pending_fetch() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!([{"key":"old"}])));
    let (release, wait) = mpsc::channel();
    *client.connection_pause.lock().unwrap() = Some(wait);
    let core = open_core_with_client(
        temp.path(),
        vec![connection_definition()],
        &host,
        client.clone(),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    wait_until(|| !client.connection_requests.lock().unwrap().is_empty());
    core.handle(CoreRequest::WindowClose {
        window_id: window.clone(),
    })
    .unwrap();
    while rx.try_recv().is_ok() {}
    release.send(()).unwrap();
    assert!(!matches!(
        rx.recv_timeout(Duration::from_millis(300)),
        Ok(CoreEvent::DataUpdate { .. })
    ));
    assert!(matches!(
        core.handle(CoreRequest::DataAttach { window_id: window }),
        Err(CoreError {
            code: ErrorCode::NotFound,
            ..
        })
    ));
}

#[test]
fn source_safety_failed_refresh_keeps_value_and_reports_error_in_layout() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!([{"key":"cached"}])));
    let core = open_core_with_client(
        temp.path(),
        vec![connection_definition()],
        &host,
        client.clone(),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut loaded = false;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) = rx.recv_timeout(Duration::from_millis(100))
        {
            if matches!(
                view.values.get("/ui/children/0/items"),
                Some(BindingValue::Ready { .. })
            ) {
                loaded = true;
                break;
            }
        }
    }
    assert!(loaded);
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(500, json!({"error":"failure"})));
    core.handle(CoreRequest::DataRefresh {
        window_id: window.clone(),
        sources: vec!["items".into()],
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut failed = false;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) = rx.recv_timeout(Duration::from_millis(100))
        {
            if matches!(
                view.sources.get("items"),
                Some(SourceStatus::Failed {
                    has_value: true,
                    ..
                })
            ) {
                assert!(!view.values.contains_key("/ui/children/0/items"));
                failed = true;
                break;
            }
        }
    }
    assert!(failed);
    let CoreReply::DataAttach { view } = core
        .handle(CoreRequest::DataAttach {
            window_id: window.clone(),
        })
        .unwrap()
    else {
        panic!("data.attach");
    };
    assert!(
        matches!(view.values.get("/ui/children/0/items"), Some(BindingValue::Ready { value }) if value == &json!([{"key":"cached"}]))
    );
    let errors = crate::data_runtime::layout_errors(&core.inner);
    assert!(errors.iter().any(|entry| entry.window_id == window
        && entry.pointer == "/sources/items"
        && entry.message.contains("500")));
}

#[cfg(unix)]
#[test]
fn source_safety_folder_source_filters_hidden_and_outside_symlinks() {
    use kaleidoscope_contract::data::SourceFormat;
    use kaleidoscope_data::SourcePlan;
    use std::os::unix::fs::symlink;
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::create_dir(folder.path().join("nested")).unwrap();
    fs::write(folder.path().join("nested/b.json"), "{}").unwrap();
    fs::write(folder.path().join("A.json"), "{}").unwrap();
    fs::write(folder.path().join(".hidden.json"), "{}").unwrap();
    fs::write(outside.path().join("outside.json"), "{}").unwrap();
    symlink(
        outside.path().join("outside.json"),
        folder.path().join("outside.json"),
    )
    .unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().to_path_buf()));
    let core = open_core(temp.path(), vec![definition()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "data-app");
    pick_folder(&core, &window);
    let plan = SourcePlan::Folder {
        permission: "docs".into(),
        dir: String::new(),
        recursive: true,
        extensions: vec!["json".into()],
    };
    let value =
        crate::data_sources::fetch(&core.inner, &window, &plan, SourceFormat::Json).unwrap();
    let paths: Vec<_> = value
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, ["A.json", "nested/b.json"]);
}

#[test]
fn concurrent_actions_preserve_both_state_keys() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let definition = json!({
        "id":"state-app", "name":"State", "requires":{"blocks":4},
        "state":{"a":null,"b":null},
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"button","label":"a","on_click":{"set_state":"a"}},
            {"type":"button","label":"b","on_click":{"set_state":"b"}}
        ]}
    })
    .to_string();
    let core = Arc::new(open_core(temp.path(), vec![definition], &host));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "state-app");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    for _ in 0..20 {
        core.handle(CoreRequest::WindowSetState {
            window_id: window.clone(),
            state: BTreeMap::from([("a".into(), Value::Null), ("b".into(), Value::Null)]),
        })
        .unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let handles: Vec<_> = (0..2)
            .map(|index| {
                let core = Arc::clone(&core);
                let barrier = Arc::clone(&barrier);
                let window = window.clone();
                thread::spawn(move || {
                    barrier.wait();
                    core.handle(CoreRequest::DataAct {
                        window_id: window,
                        pointer: format!("/ui/children/{index}/on_click"),
                        event: json!("set"),
                        item: Value::Null,
                    })
                    .unwrap();
                })
            })
            .collect();
        barrier.wait();
        for handle in handles {
            handle.join().unwrap();
        }
        let actual = snapshot(&core)
            .shared
            .windows
            .into_iter()
            .find(|item| item.id == window)
            .unwrap()
            .state;
        assert_eq!(actual["a"], json!("set"));
        assert_eq!(actual["b"], json!("set"));
    }
}

#[test]
fn reattach_during_version_notification_uses_new_definition() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let app = |label: &str| {
        json!({
            "id":"versioned", "name":"Versioned", "requires":{"blocks":4},
            "ui":{"type":"text","value":{"expr":format!("'{label}'")}}
        })
        .to_string()
    };
    let core = Arc::new(open_core(temp.path(), vec![app("old")], &host));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "versioned");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    let (sender, receiver) = mpsc::channel();
    let target = Arc::downgrade(&core);
    let window_for_listener = window.clone();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::StateChanged { snapshot } = event {
            if snapshot
                .shared
                .windows
                .iter()
                .any(|item| item.id == window_for_listener && item.app_version == 2)
            {
                let reply = target.upgrade().unwrap().handle(CoreRequest::DataAttach {
                    window_id: window_for_listener.clone(),
                });
                let _ = sender.send(reply);
            }
        }
    }));
    core.handle(CoreRequest::AppImport {
        definition_json: app("new"),
    })
    .unwrap();
    let CoreReply::DataAttach { view } = receiver
        .recv_timeout(Duration::from_secs(3))
        .unwrap()
        .unwrap()
    else {
        panic!("data.attach");
    };
    assert_eq!(
        view.values["/ui/value"],
        BindingValue::Ready {
            value: json!("new")
        }
    );
}

#[test]
fn reattach_during_state_notification_uses_new_state() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let definition = json!({
        "id":"state-view", "name":"State view", "requires":{"blocks":4},
        "state":{"selection":"old"},
        "ui":{"type":"text","value":{"expr":"$state.selection"}}
    })
    .to_string();
    let core = Arc::new(open_core(temp.path(), vec![definition], &host));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "state-view");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    let (sender, receiver) = mpsc::channel();
    let target = Arc::downgrade(&core);
    let window_for_listener = window.clone();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::StateChanged { snapshot } = event {
            if snapshot
                .shared
                .windows
                .iter()
                .any(|item| item.id == window_for_listener && item.state["selection"] == "new")
            {
                let reply = target.upgrade().unwrap().handle(CoreRequest::DataAttach {
                    window_id: window_for_listener.clone(),
                });
                let _ = sender.send(reply);
            }
        }
    }));
    core.handle(CoreRequest::WindowSetState {
        window_id: window,
        state: BTreeMap::from([("selection".into(), json!("new"))]),
    })
    .unwrap();
    let CoreReply::DataAttach { view } = receiver
        .recv_timeout(Duration::from_secs(3))
        .unwrap()
        .unwrap()
    else {
        panic!("data.attach");
    };
    assert_eq!(
        view.values["/ui/value"],
        BindingValue::Ready {
            value: json!("new")
        }
    );
}

#[test]
fn path_change_failed_fetch_clears_prior_value() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().extend([
        ("/old".into(), response(200, json!([{"key":"previous"}]))),
        ("/new".into(), response(500, json!({"error":"failure"}))),
    ]);
    let core = open_core_with_client(temp.path(), vec![connection_definition()], &host, client);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(Instant::now() < deadline, "initial value");
        if let Ok(CoreEvent::DataUpdate { view, .. }) = rx.recv_timeout(Duration::from_millis(100))
        {
            if matches!(view.values.get("/ui/children/0/items"), Some(BindingValue::Ready { value }) if value == &json!([{"key":"previous"}]))
            {
                break;
            }
        }
    }
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: BTreeMap::from([
            ("path".into(), json!("/new")),
            ("selected".into(), Value::Null),
        ]),
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(Instant::now() < deadline, "failed refresh");
        if let Ok(CoreEvent::DataUpdate { view, .. }) = rx.recv_timeout(Duration::from_millis(100))
        {
            if matches!(view.sources.get("items"), Some(SourceStatus::Failed { .. })) {
                assert!(matches!(
                    view.sources.get("items"),
                    Some(SourceStatus::Failed {
                        has_value: false,
                        ..
                    })
                ));
                break;
            }
        }
    }
    let CoreReply::DataAttach { view } = core
        .handle(CoreRequest::DataAttach { window_id: window })
        .unwrap()
    else {
        panic!("data.attach");
    };
    assert!(!matches!(
        view.values.get("/ui/children/0/items"),
        Some(BindingValue::Ready { .. })
    ));
    assert!(view.source_meta["items"].updated_at.is_none());
}

#[test]
fn unavailable_storage_never_looks_like_a_null_default() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let definition = json!({
        "id":"storage-app","name":"Storage","requires":{"blocks":6,"modules":{"storage":1}},
        "state":{},"permissions":[],
        "storage":{"entries":[{"id":"choice","key":"settings/choice","kind":"json","schema":{"type":["string","null"]},"default":null,"label":"선택","presentation":"hidden"}]},
        "ui":{"type":"text","value":{"expr":"$storage.choice"}}
    }).to_string();
    let core = open_core(temp.path(), vec![definition], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "storage-app");
    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        server_url: "https://registry.test".into(),
        device_name: "test-device".into(),
        reason: "offline".into(),
    };
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    wait_until(|| {
        let view = core
            .handle(CoreRequest::DataAttach {
                window_id: window.clone(),
            })
            .unwrap();
        matches!(view, CoreReply::DataAttach { view } if matches!(view.values.get("/ui/value"), Some(BindingValue::Failed { .. })))
    });
}

#[test]
fn storage_binding_drops_unlinked_defaults_when_the_link_goes_offline() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let definition = json!({
        "id":"storage-transition","name":"Storage","requires":{"blocks":6,"modules":{"storage":1}},
        "state":{},"permissions":[],
        "storage":{"entries":[{"id":"choice","key":"settings/choice","kind":"json","schema":{"type":"string"},"default":"local","label":"선택","presentation":"hidden"}]},
        "ui":{"type":"text","value":{"expr":"$storage.choice"}}
    }).to_string();
    let core = open_core(temp.path(), vec![definition], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "storage-transition");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    wait_until(
        || matches!(crate::data_runtime::binding_value(&core.inner, &window, "/ui/value"), Some(BindingValue::Ready { value }) if value == "local"),
    );
    *core.inner.link_file.lock().unwrap() = Some(connected_link_file());
    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        server_url: "https://registry.test".into(),
        device_name: "test-device".into(),
        reason: "offline".into(),
    };
    let event = CoreEvent::StateChanged {
        snapshot: crate::snapshot(&core.inner.state.lock().unwrap()),
    };
    core.inner.emit(&event);
    wait_until(|| {
        matches!(
            crate::data_runtime::binding_value(&core.inner, &window, "/ui/value"),
            Some(BindingValue::Failed { .. })
        )
    });
}

#[test]
fn storage_actions_and_remote_change_replan_file_source() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("one.json"), r#"{"title":"One"}"#).unwrap();
    fs::write(folder.path().join("two.json"), r#"{"title":"Two"}"#).unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().to_path_buf()));
    let registry = Arc::new(FakeRegistryClient::default());
    let definition = json!({
        "id":"storage-flow","name":"Storage flow","requires":{"blocks":6,"modules":{"storage":1,"files":1}},
        "permissions":[{"module":"files","id":"docs","access":"read","label":"Docs"}],
        "state":{"seen":null},
        "storage":{"entries":[{"id":"path","key":"workspaces/{workspace_id}/path","kind":"json","schema":{"type":"string"},"default":"one.json","label":"경로","presentation":"hidden"}]},
        "sources":{"file":{"kind":"file","permission":"docs","path":{"expr":"$storage.path"}}},
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"text","value":{"expr":"$data.file.title"}},
            {"type":"text","value":{"expr":"$storage.path"}},
            {"type":"button","label":"저장","on_click":[{"set_storage":{"entry":"path","value":"two.json"}},{"set_state":"seen","value":{"expr":"$storage.path"}}]}
        ]}
    }).to_string();
    let core = open_core_with_client(temp.path(), vec![definition], &host, registry.clone());
    let (workspace, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "storage-flow");
    pick_folder(&core, &window);
    mark_connected(&core);
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    wait_until(
        || matches!(core.handle(CoreRequest::DataAttach { window_id: window.clone() }).unwrap(), CoreReply::DataAttach {view} if view.values.get("/ui/children/0/value") == Some(&BindingValue::Ready { value: json!("One") })),
    );
    core.handle(CoreRequest::DataAct {
        window_id: window.clone(),
        pointer: "/ui/children/2/on_click".into(),
        event: Value::Null,
        item: Value::Null,
    })
    .unwrap();
    let current = snapshot(&core);
    assert_eq!(
        current
            .shared
            .windows
            .iter()
            .find(|w| w.id == window)
            .unwrap()
            .state["seen"],
        "two.json"
    );
    wait_until(
        || matches!(core.handle(CoreRequest::DataAttach { window_id: window.clone() }).unwrap(), CoreReply::DataAttach {view} if view.values.get("/ui/children/0/value") == Some(&BindingValue::Ready { value: json!("Two") })),
    );
    assert_eq!(*registry.storage_workspace.lock().unwrap(), workspace);
    let revision = "remote-revision".to_string();
    *registry.storage_value.lock().unwrap() = Some((json!("one.json"), revision.clone()));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::StorageChanged {
            app_id: "storage-flow".into(),
            changed: kaleidoscope_contract::app_storage::StorageChanged {
                bucket_id: "bucket".into(),
                item: kaleidoscope_contract::app_storage::StorageItemMeta {
                    entry_id: "path".into(),
                    key: format!("workspaces/{workspace}/path"),
                    kind: kaleidoscope_contract::app_storage::StorageKind::Json,
                    revision: Some(revision),
                    exists: true,
                },
            },
        },
    );
    wait_until(
        || matches!(core.handle(CoreRequest::DataAttach { window_id: window.clone() }).unwrap(), CoreReply::DataAttach {view} if view.values.get("/ui/children/0/value") == Some(&BindingValue::Ready { value: json!("One") })),
    );
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: BTreeMap::from([("seen".into(), json!("before"))]),
    })
    .unwrap();
    *registry.storage_value.lock().unwrap() = Some((json!("one.json"), "newer-revision".into()));
    let error = core
        .handle(CoreRequest::DataAct {
            window_id: window.clone(),
            pointer: "/ui/children/2/on_click".into(),
            event: Value::Null,
            item: Value::Null,
        })
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Conflict);
    assert_eq!(
        snapshot(&core)
            .shared
            .windows
            .iter()
            .find(|w| w.id == window)
            .unwrap()
            .state["seen"],
        "before"
    );
}

#[test]
fn agent_three_definitions_are_imported_by_this_core() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![], &host);
    let definition = include_str!("../../../../examples/workspace-pas-v2.json");
    let reply = core
        .handle(CoreRequest::AppImport {
            definition_json: definition.to_string(),
        })
        .unwrap();
    assert!(matches!(reply, CoreReply::AppImport { app, .. } if app.id == "workspace-pas-v2"));
}

#[test]
fn storage_change_recalculates_source_metadata_bindings() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("one.json"), "{}").unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().to_path_buf()));
    let registry = Arc::new(FakeRegistryClient::default());
    let definition = json!({
        "id":"metadata-storage", "name":"메타 시험", "requires":{"blocks":6,"modules":{"storage":1,"files":1}},
        "permissions":[{"module":"files","id":"docs","access":"read","label":"파일"}], "state":{},
        "storage":{"entries":[{"id":"path","key":"workspaces/{workspace_id}/path","kind":"json","schema":{"type":"string"},"default":"one.json","label":"경로","presentation":"hidden"}]},
        "sources":{"file":{"kind":"file","permission":"docs","path":{"expr":"$storage.path = 'none' ? null : $storage.path"}}},
        "ui":{"type":"text","value":{"expr":"$data_meta.file.updated_at"}}
    }).to_string();
    let core = open_core_with_client(temp.path(), vec![definition], &host, registry.clone());
    let (workspace, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "metadata-storage");
    pick_folder(&core, &window);
    mark_connected(&core);
    let (sender, receiver) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = sender.send(event.clone());
    }));
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut received_time = false;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) =
            receiver.recv_timeout(Duration::from_millis(100))
        {
            if matches!(view.values.get("/ui/value"), Some(BindingValue::Ready { value }) if value.is_string())
            {
                received_time = true;
                break;
            }
        }
    }
    assert!(received_time, "원천의 수신 시각을 받지 못했습니다");
    while receiver.try_recv().is_ok() {}
    *registry.storage_value.lock().unwrap() = Some((json!("none"), "changed".into()));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::StorageChanged {
            app_id: "metadata-storage".into(),
            changed: kaleidoscope_contract::app_storage::StorageChanged {
                bucket_id: "bucket".into(),
                item: kaleidoscope_contract::app_storage::StorageItemMeta {
                    entry_id: "path".into(),
                    key: format!("workspaces/{workspace}/path"),
                    kind: kaleidoscope_contract::app_storage::StorageKind::Json,
                    revision: Some("changed".into()),
                    exists: true,
                },
            },
        },
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut cleared = false;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) =
            receiver.recv_timeout(Duration::from_millis(100))
        {
            if matches!(view.values.get("/ui/value"), Some(BindingValue::Ready { value }) if value.is_null())
            {
                cleared = true;
                break;
            }
        }
    }
    assert!(
        cleared,
        "원천이 꺼졌을 때 수신 시각이 초기화되지 않았습니다"
    );
}

#[test]
fn folder_and_file_sources_must_protect_data_dir() {
    use kaleidoscope_contract::data::SourceFormat;
    use kaleidoscope_data::SourcePlan;
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("sandbox");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("readme.json"), "{}").unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root.clone()));
    let core = open_core(&root.join("private-data"), vec![definition()], &host);
    fs::write(root.join("private-data/link.json"), "{}").unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "data-app");
    pick_folder(&core, &window);
    for recursive in [false, true] {
        let plan = SourcePlan::Folder {
            permission: "docs".into(),
            dir: String::new(),
            recursive,
            extensions: vec![],
        };
        let entries =
            crate::data_sources::fetch(&core.inner, &window, &plan, SourceFormat::Json).unwrap();
        let paths = entries
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["path"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert!(paths.contains(&"readme.json"));
        assert!(!paths.iter().any(|path| path.starts_with("private-data")));
    }
    let plan = SourcePlan::File {
        permission: "docs".into(),
        path: "private-data/link.json".into(),
        format: SourceFormat::Json,
    };
    assert!(
        matches!(crate::data_sources::fetch(&core.inner, &window, &plan, SourceFormat::Json), Err(crate::connections::RequestError::Core(error)) if error.code == ErrorCode::PermissionDenied)
    );
}
