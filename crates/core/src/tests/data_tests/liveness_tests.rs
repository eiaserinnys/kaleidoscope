use super::*;

#[test]
fn 숨긴_쉘과_쉬는_블록의_원천은_보일_때만_요청한다() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!([{"key":"a"}])));
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
    core.set_shell_visible(false);
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
        .unwrap();
    thread::sleep(Duration::from_millis(1100));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 0);
    core.handle(
        serde_json::from_value(
            json!({"op":"data.dormant","window_id":window,"dormant":["/ui/children/0"]}),
        )
        .unwrap(),
    )
    .unwrap();
    core.set_shell_visible(true);
    thread::sleep(Duration::from_millis(150));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 0);
    core.handle(
        serde_json::from_value(json!({"op":"data.dormant","window_id":window,"dormant":[]}))
            .unwrap(),
    )
    .unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 1);
}

#[test]
fn 두_창은_같은_요청을_공유하고_명시적_갱신은_다시_요청한다() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!([{"key":"a"}])));
    let (release, wait) = mpsc::channel();
    *client.connection_pause.lock().unwrap() = Some(wait);
    let core = open_core_with_client(
        temp.path(),
        vec![connection_definition()],
        &host,
        client.clone(),
    );
    let (_, desktop) = active_ids(&core);
    let first = open_window(&core, &desktop, "connection-app");
    let second = open_window(&core, &desktop, "connection-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    for window in [&first, &second] {
        core.handle(
            serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap(),
        )
        .unwrap();
    }
    wait_until(|| client.connection_requests.lock().unwrap().len() == 1);
    thread::sleep(Duration::from_millis(200));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
    release.send(()).unwrap();
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &second, "/ui/children/0/items")
            == Some(BindingValue::Ready {
                value: json!([{"key":"a"}]),
            })
    });
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &first, "/ui/children/0/items")
            == Some(BindingValue::Ready {
                value: json!([{"key":"a"}]),
            })
    });
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
    let (release, wait) = mpsc::channel();
    *client.connection_pause.lock().unwrap() = Some(wait);
    core.handle(CoreRequest::DataRefresh {
        window_id: first.clone(),
        sources: vec!["items".into()],
    })
    .unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 2);
    core.handle(CoreRequest::DataRefresh {
        window_id: second.clone(),
        sources: vec!["items".into()],
    })
    .unwrap();
    thread::sleep(Duration::from_millis(200));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 2);
    release.send(()).unwrap();
    for window in [&first, &second] {
        wait_until(|| {
            let CoreReply::DataAttach { view } = core
                .handle(
                    serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap(),
                )
                .unwrap()
            else {
                return false;
            };
            matches!(view.sources["items"], SourceStatus::Ready { .. })
        });
    }
    assert_eq!(client.connection_requests.lock().unwrap().len(), 2);
}

#[test]
fn 상류_값이_오기_전에는_종속_원천을_요청하지_않는다() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let definition = json!({"id":"dependency-app","name":"의존 시험","requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"read","label":"API"}],"state":{},
        "sources":{"upstream":{"kind":"request","permission":"api","path":"/old"},
                   "downstream":{"kind":"request","permission":"api","path":"/new","query":{"id":{"expr":"$data.upstream.id"}}}},
        "ui":{"type":"text","value":{"expr":"$data.downstream.value"}}}).to_string();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().extend([
        ("/old".into(), response(200, json!({"id":"ready"}))),
        ("/new".into(), response(200, json!({"value":"done"}))),
    ]);
    let (release, wait) = mpsc::channel();
    *client.connection_pause.lock().unwrap() = Some(wait);
    let core = open_core_with_client(temp.path(), vec![definition], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "dependency-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
        .unwrap();
    wait_until(|| !client.connection_requests.lock().unwrap().is_empty());
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
    release.send(()).unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 2);
    let requests = client.connection_requests.lock().unwrap();
    assert_eq!(requests[1].path, "/new");
    assert_eq!(
        requests[1].query.get("id").map(String::as_str),
        Some("ready")
    );
}

#[test]
fn 다른_데스크톱과_최대화_뒤에서는_쉬고_재개와_재열기에서_캐시를_쓴다() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let mut definition: Value = serde_json::from_str(&connection_definition()).unwrap();
    definition["sources"]["items"]["refresh_secs"] = json!(10);
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().extend([
        ("/old".into(), response(200, json!([{"key":"old"}]))),
        ("/new".into(), response(200, json!([{"key":"new"}]))),
    ]);
    let core = open_core_with_client(
        temp.path(),
        vec![definition.to_string()],
        &host,
        client.clone(),
    );
    let (workspace, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(CoreRequest::WindowMinimize {
        window_id: window.clone(),
    })
    .unwrap();
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
        .unwrap();
    thread::sleep(Duration::from_millis(1100));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 0);
    let CoreReply::DesktopCreate { desktop: other } = core
        .handle(CoreRequest::DesktopCreate {
            workspace_id: workspace.clone(),
            name: "다른 데스크톱".into(),
        })
        .unwrap()
    else {
        panic!("desktop.create")
    };
    core.handle(CoreRequest::DesktopActivate {
        desktop_id: other.id,
    })
    .unwrap();
    core.handle(CoreRequest::WindowRestore {
        window_id: window.clone(),
    })
    .unwrap();
    thread::sleep(Duration::from_millis(1100));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 0);
    core.handle(CoreRequest::WorkspaceCreate {
        name: "다른 작업".into(),
    })
    .unwrap();
    thread::sleep(Duration::from_millis(1100));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 0);
    core.handle(CoreRequest::WorkspaceActivate {
        workspace_id: workspace,
    })
    .unwrap();
    core.handle(CoreRequest::DesktopActivate {
        desktop_id: desktop.clone(),
    })
    .unwrap();
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/items")
            == Some(BindingValue::Ready {
                value: json!([{"key":"old"}]),
            })
    });
    let cover = open_window(&core, &desktop, "calculator");
    core.handle(CoreRequest::WindowMaximize {
        window_id: cover.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: BTreeMap::from([
            ("path".into(), json!("/new")),
            ("selected".into(), Value::Null),
        ]),
    })
    .unwrap();
    thread::sleep(Duration::from_millis(1100));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
    core.handle(CoreRequest::WindowClose { window_id: cover })
        .unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 2);
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/items")
            == Some(BindingValue::Ready {
                value: json!([{"key":"new"}]),
            })
    });
    core.handle(CoreRequest::WindowClose { window_id: window })
        .unwrap();
    let reopened = open_window(&core, &desktop, "connection-app");
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":reopened})).unwrap())
        .unwrap();
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &reopened, "/ui/children/0/items")
            == Some(BindingValue::Ready {
                value: json!([{"key":"old"}]),
            })
    });
    assert_eq!(client.connection_requests.lock().unwrap().len(), 2);
}

#[test]
fn 숨겨진_창의_강제_갱신은_상류만_받고_보일_때_종속_원천을_받는다() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let definition = json!({"id":"force-dependency","name":"강제 의존 시험","requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"read","label":"API"}],"state":{},
        "sources":{"upstream":{"kind":"request","permission":"api","path":"/old"},
                   "downstream":{"kind":"request","permission":"api","path":"/new","query":{"id":{"expr":"$data.upstream.id"}}}},
        "ui":{"type":"text","value":{"expr":"$data.downstream.value"}}}).to_string();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().extend([
        ("/old".into(), response(200, json!({"id":"ready"}))),
        ("/new".into(), response(200, json!({"value":"done"}))),
    ]);
    let core = open_core_with_client(temp.path(), vec![definition], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "force-dependency");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.set_shell_visible(false);
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
        .unwrap();
    core.handle(CoreRequest::DataRefresh {
        window_id: window.clone(),
        sources: vec!["downstream".into()],
    })
    .unwrap();
    wait_until(|| {
        let CoreReply::DataAttach { view } = core
            .handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
            .unwrap()
        else {
            return false;
        };
        matches!(view.sources["upstream"], SourceStatus::Ready { .. })
    });
    thread::sleep(Duration::from_millis(200));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
    core.set_shell_visible(true);
    wait_until(|| client.connection_requests.lock().unwrap().len() == 2);
    let requests = client.connection_requests.lock().unwrap();
    assert_eq!(requests[0].path, "/old");
    assert_eq!(requests[1].path, "/new");
    assert_eq!(
        requests[1].query.get("id").map(String::as_str),
        Some("ready")
    );
}

#[test]
fn 보이는_상류의_강제_갱신은_숨긴_탭의_종속_원천을_부르지_않는다() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let definition = json!({"id":"hidden-dependency","name":"숨긴 종속 시험","requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"read","label":"API"}],"state":{},
        "sources":{"upstream":{"kind":"request","permission":"api","path":"/old"},
                   "downstream":{"kind":"request","permission":"api","path":"/new","query":{"id":{"expr":"$data.upstream.id"}}}},
        "ui":{"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$data.upstream.id"}},{"type":"text","value":{"expr":"$data.downstream.value"}}]}}).to_string();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().extend([
        ("/old".into(), response(200, json!({"id":"first"}))),
        ("/new".into(), response(200, json!({"value":"done"}))),
    ]);
    let core = open_core_with_client(temp.path(), vec![definition], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "hidden-dependency");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(
        serde_json::from_value(
            json!({"op":"data.attach","window_id":window,"dormant":["/ui/children/1"]}),
        )
        .unwrap(),
    )
    .unwrap();
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/value")
            == Some(BindingValue::Ready {
                value: json!("first"),
            })
    });
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!({"id":"second"})));
    core.handle(CoreRequest::DataRefresh {
        window_id: window.clone(),
        sources: vec!["upstream".into()],
    })
    .unwrap();
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/value")
            == Some(BindingValue::Ready {
                value: json!("second"),
            })
    });
    thread::sleep(Duration::from_millis(200));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 2);
    core.handle(
        serde_json::from_value(json!({"op":"data.dormant","window_id":window,"dormant":[]}))
            .unwrap(),
    )
    .unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 3);
    assert_eq!(
        client.connection_requests.lock().unwrap()[2]
            .query
            .get("id")
            .map(String::as_str),
        Some("second")
    );
}

#[test]
fn 최소화된_창의_주기_요청은_멈추고_복원하면_기한_지난_값을_받는다() {
    use kaleidoscope_contract::registry::ConnectionKind;
    let mut definition: Value = serde_json::from_str(&connection_definition()).unwrap();
    definition["sources"]["items"]["refresh_secs"] = json!(10);
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!([{"key":"a"}])));
    let core = open_core_with_client(
        temp.path(),
        vec![definition.to_string()],
        &host,
        client.clone(),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
        .unwrap();
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/items")
            == Some(BindingValue::Ready {
                value: json!([{"key":"a"}]),
            })
    });
    core.handle(CoreRequest::WindowMinimize {
        window_id: window.clone(),
    })
    .unwrap();
    thread::sleep(Duration::from_millis(11000));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
    core.handle(CoreRequest::WindowRestore { window_id: window })
        .unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 2);
}
