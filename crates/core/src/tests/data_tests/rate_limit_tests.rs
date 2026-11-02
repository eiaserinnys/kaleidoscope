use super::*;

#[test]
fn 릴레이_한도_403은_시간_헤더가_없어도_지수_대기로_들어간다() {
    use kaleidoscope_contract::registry::{ConnectionKind, RateLimitHint};
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let mut limited = response(403, json!({"error":"rate limit"}));
    limited.rate_limit = Some(RateLimitHint {
        retry_after_secs: None,
    });
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), limited);
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
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
        .unwrap();
    wait_until(|| {
        let CoreReply::DataAttach { view } = core
            .handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
            .unwrap()
        else {
            return false;
        };
        matches!(
            view.sources.get("items"),
            Some(SourceStatus::Loading { has_value: false })
        ) && view.source_meta["items"].message.is_some()
    });
    core.handle(CoreRequest::DataRefresh {
        window_id: window,
        sources: vec!["items".into()],
    })
    .unwrap();
    thread::sleep(Duration::from_millis(200));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
}

#[test]
fn 한도_대기에는_마지막_값을_보존하고_시간이_지나면_다시_받는다() {
    use kaleidoscope_contract::registry::{ConnectionKind, RateLimitHint};
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!([{"key":"old"}])));
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
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
        .unwrap();
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/items")
            == Some(BindingValue::Ready {
                value: json!([{"key":"old"}]),
            })
    });
    let mut limited = response(429, json!({"error":"limit"}));
    limited.rate_limit = Some(RateLimitHint {
        retry_after_secs: Some(2),
    });
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), limited);
    core.handle(CoreRequest::DataRefresh {
        window_id: window.clone(),
        sources: vec!["items".into()],
    })
    .unwrap();
    wait_until(|| {
        let CoreReply::DataAttach { view } = core
            .handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap())
            .unwrap()
        else {
            return false;
        };
        view.source_meta["items"].stale
            && view.source_meta["items"].message.is_some()
            && matches!(
                view.sources["items"],
                SourceStatus::Loading { has_value: true }
            )
    });
    assert_eq!(
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/items"),
        Some(BindingValue::Ready {
            value: json!([{"key":"old"}])
        })
    );
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!([{"key":"new"}])));
    thread::sleep(Duration::from_millis(500));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 2);
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/items")
            == Some(BindingValue::Ready {
                value: json!([{"key":"new"}]),
            })
    });
    assert_eq!(client.connection_requests.lock().unwrap().len(), 3);
}

#[test]
fn 한도에_걸린_연결의_다른_원천도_관문이_열릴_때까지_대기한다() {
    use kaleidoscope_contract::registry::{ConnectionKind, RateLimitHint};
    let definition = json!({"id":"same-host","name":"연결 대기 시험","requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"read","label":"API"}],"state":{},
        "sources":{"first":{"kind":"request","permission":"api","path":"/old"},"second":{"kind":"request","permission":"api","path":"/new"}},
        "ui":{"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$data.first"}},{"type":"text","value":{"expr":"$data.second"}}]}}).to_string();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let mut limited = response(429, json!({"error":"limit"}));
    limited.rate_limit = Some(RateLimitHint {
        retry_after_secs: Some(2),
    });
    client.connection_replies.lock().unwrap().extend([
        ("/old".into(), limited),
        ("/new".into(), response(200, json!("second"))),
    ]);
    let core = open_core_with_client(temp.path(), vec![definition], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "same-host");
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
        let CoreReply::DataAttach { view } = core
            .handle(
                serde_json::from_value(
                    json!({"op":"data.attach","window_id":window,"dormant":["/ui/children/1"]}),
                )
                .unwrap(),
            )
            .unwrap()
        else {
            return false;
        };
        view.source_meta["first"].message.is_some()
    });
    core.handle(
        serde_json::from_value(json!({"op":"data.dormant","window_id":window,"dormant":[]}))
            .unwrap(),
    )
    .unwrap();
    thread::sleep(Duration::from_millis(400));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!("first")));
    wait_until(|| client.connection_requests.lock().unwrap().len() >= 3);
}

#[test]
fn 한도_응답_뒤_늦게_온_성공은_대기_관문을_지우지_않는다() {
    use kaleidoscope_contract::registry::{ConnectionKind, RateLimitHint};
    let definition = json!({"id":"same-host-race","name":"연결 경쟁 시험","requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"read","label":"API"}],"state":{},
        "sources":{"limited":{"kind":"request","permission":"api","path":"/new"},"slow":{"kind":"request","permission":"api","path":"/old"}},
        "ui":{"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$data.limited"}},{"type":"text","value":{"expr":"$data.slow"}}]}}).to_string();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let mut limited = response(429, json!({"error":"limit"}));
    limited.rate_limit = Some(RateLimitHint {
        retry_after_secs: Some(3),
    });
    client.connection_replies.lock().unwrap().extend([
        ("/new".into(), limited),
        ("/old".into(), response(200, json!("slow success"))),
    ]);
    let (release_slow, wait_slow) = mpsc::channel();
    let (release_limited, wait_limited) = mpsc::channel();
    *client.connection_pause.lock().unwrap() = Some(wait_slow);
    *client.connection_pause_new.lock().unwrap() = Some(wait_limited);
    let core = open_core_with_client(temp.path(), vec![definition], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "same-host-race");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 2);
    release_limited.send(()).unwrap();
    wait_until(|| {
        let CoreReply::DataAttach { view } = core
            .handle(CoreRequest::DataAttach {
                window_id: window.clone(),
                dormant: vec![],
            })
            .unwrap()
        else {
            return false;
        };
        view.source_meta["limited"].message.is_some()
    });
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/new".into(), response(200, json!("retry success")));
    release_slow.send(()).unwrap();
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/1/value")
            == Some(BindingValue::Ready {
                value: json!("slow success"),
            })
    });
    core.handle(CoreRequest::DataRefresh {
        window_id: window.clone(),
        sources: vec!["limited".into()],
    })
    .unwrap();
    thread::sleep(Duration::from_millis(200));
    assert_eq!(
        client.connection_requests.lock().unwrap().len(),
        2,
        "대기 중 새로고침은 추가 요청을 보내지 않는다"
    );
    wait_until(|| {
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/value")
            == Some(BindingValue::Ready {
                value: json!("retry success"),
            })
    });
    assert_eq!(client.connection_requests.lock().unwrap().len(), 3);
    core.handle(CoreRequest::DataRefresh {
        window_id: window,
        sources: vec!["limited".into()],
    })
    .unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 4);
}

#[test]
fn 두_창이_같은_한도에서_깨어나도_재시도는_한_번만_나간다() {
    use kaleidoscope_contract::registry::{ConnectionKind, RateLimitHint};
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let mut limited = response(429, json!({"error":"limit"}));
    limited.rate_limit = Some(RateLimitHint {
        retry_after_secs: Some(2),
    });
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), limited);
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
            view.source_meta["items"].message.is_some()
        });
    }
    client
        .connection_replies
        .lock()
        .unwrap()
        .insert("/old".into(), response(200, json!([{"key":"ready"}])));
    for window in [&first, &second] {
        wait_until(|| {
            crate::data_runtime::binding_value(&core.inner, window, "/ui/children/0/items")
                == Some(BindingValue::Ready {
                    value: json!([{"key":"ready"}]),
                })
        });
    }
    assert_eq!(client.connection_requests.lock().unwrap().len(), 2);
}
