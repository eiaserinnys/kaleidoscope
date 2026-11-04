use super::*;
use kaleidoscope_contract::registry::ConnectionKind;

fn definition(next: &str) -> String {
    json!({
        "id":"paging", "name":"쪽 넘김 시험", "requires":{"blocks":21,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"read","label":"API"}],
        "state":{"query":"one"},
        "sources":{"items":{"kind":"request","permission":"api","path":"/old", "query":{"q":{"state":"query"}},
            "page":{"param":"cursor","next":next,"items":"items"},"refresh_secs":30}},
        "ui":{"type":"list","items":{"expr":"$data.items.items"}}
    }).to_string()
}

fn value(core: &Core, window: &str) -> Value {
    serde_json::to_value(crate::data_runtime::binding_value(&core.inner, window, "/ui/items")).unwrap()
}

fn more(core: &Core, window: &str) -> Value {
    let request = serde_json::from_value(json!({"op":"data.more","window_id":window,"source":"items"})).unwrap();
    serde_json::to_value(core.handle(request).unwrap()).unwrap()
}

#[test]
fn first_page_declaration_errors_preserve_ready_value_without_retry() {
    for (body, next, id) in [
        (json!({"items":"not an array","cursor":"2"}), "cursor", "DATA_SOURCE_PAGE_ITEMS_NOT_ARRAY"),
        (json!({"items":[{"key":"a","title":"A"}]}), "$number('bad')", "DATA_SOURCE_PAGE_NEXT_FAILED"),
    ] {
        let temp = TempDir::new().unwrap();
        let host = Arc::new(FakeHost::default());
        let client = registry_client();
        client.connection_replies.lock().unwrap().insert("/old".into(), response(200, body));
        let core = open_core_with_client(temp.path(), vec![definition(next)], &host, client.clone());
        let (_, desktop) = active_ids(&core);
        let window = open_window(&core, &desktop, "paging");
        mark_connected(&core);
        *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
        core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap()).unwrap();
        wait_until(|| value(&core, &window)["more"]["state"] == "failed");
        let result = value(&core, &window);
        assert_eq!(result["status"], "ready");
        assert_eq!(result["more"]["id"], id);
        assert_eq!(result["more"]["retry"], false);
        assert_eq!(more(&core, &window)["started"], false);
        assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
    }
}

#[test]
fn more_retries_same_cursor_and_appends_without_losing_first_page() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"a","title":"A"}],"cursor":"two"})));
    let core = open_core_with_client(temp.path(), vec![definition("cursor")], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "paging");
    assert_eq!(more(&core, &window)["started"], false);
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap()).unwrap();
    wait_until(|| value(&core, &window)["more"]["state"] == "ready");
    client.connection_replies.lock().unwrap().insert("/old".into(), response(500, json!({"error":"failed"})));
    assert_eq!(more(&core, &window)["started"], true);
    wait_until(|| value(&core, &window)["more"]["state"] == "failed");
    assert_eq!(value(&core, &window)["more"]["retry"], true);
    assert_eq!(value(&core, &window)["value"], json!([{"key":"a","title":"A"}]));
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"b","title":"B"}],"cursor":"three"})));
    assert_eq!(more(&core, &window)["started"], true);
    wait_until(|| value(&core, &window)["value"].as_array().is_some_and(|items| items.len() == 2));
    assert_eq!(value(&core, &window)["more"]["state"], "ready");
    let requests = client.connection_requests.lock().unwrap();
    assert_eq!(requests[1].query.get("cursor").map(String::as_str), Some("two"));
    assert_eq!(requests[2].query.get("cursor").map(String::as_str), Some("two"));
}

#[test]
fn refresh_reloads_received_pages_and_query_change_starts_at_first_page() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"a","title":"A"}],"cursor":"two"})));
    let core = open_core_with_client(temp.path(), vec![definition("cursor")], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "paging");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap()).unwrap();
    wait_until(|| value(&core, &window)["more"]["state"] == "ready");
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"b","title":"B"}],"cursor":null})));
    assert_eq!(more(&core, &window)["started"], true);
    wait_until(|| value(&core, &window)["value"].as_array().is_some_and(|items| items.len() == 2));
    assert!(value(&core, &window).get("more").is_none());
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"c","title":"C"}],"cursor":"two"})));
    core.handle(CoreRequest::DataRefresh { window_id: window.clone(), sources: vec!["items".into()] }).unwrap();
    wait_until(|| value(&core, &window)["value"] == json!([{"key":"c","title":"C"},{"key":"c","title":"C"}]));
    assert_eq!(client.connection_requests.lock().unwrap()[3].query.get("cursor").map(String::as_str), Some("two"));
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"d","title":"D"}],"cursor":null})));
    core.handle(CoreRequest::WindowSetState { window_id: window.clone(), state: BTreeMap::from([("query".into(), json!("two"))]) }).unwrap();
    wait_until(|| value(&core, &window)["value"] == json!([{"key":"d","title":"D"}]));
    let requests = client.connection_requests.lock().unwrap();
    assert_eq!(requests.last().unwrap().query.get("q").map(String::as_str), Some("two"));
    assert!(!requests.last().unwrap().query.contains_key("cursor"));
}

#[test]
fn more_does_not_start_during_first_or_next_request_or_when_hidden() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"a","title":"A"}],"cursor":"two"})));
    let (release, pause) = mpsc::channel();
    *client.connection_pause.lock().unwrap() = Some(pause);
    let core = open_core_with_client(temp.path(), vec![definition("cursor")], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "paging");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap()).unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 1);
    assert_eq!(more(&core, &window)["started"], false);
    release.send(()).unwrap();
    wait_until(|| value(&core, &window)["more"]["state"] == "ready");
    core.set_shell_visible(false);
    assert_eq!(more(&core, &window)["started"], false);
    core.set_shell_visible(true);
    let (release, pause) = mpsc::channel();
    *client.connection_pause.lock().unwrap() = Some(pause);
    assert_eq!(more(&core, &window)["started"], true);
    wait_until(|| client.connection_requests.lock().unwrap().len() == 2);
    assert_eq!(more(&core, &window)["started"], false);
    assert_eq!(client.connection_requests.lock().unwrap().len(), 2);
    release.send(()).unwrap();
}

#[test]
fn page_expression_receives_loaded_and_pages_and_numeric_cursors_are_query_strings() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"a","title":"A"}]})));
    let core = open_core_with_client(temp.path(), vec![definition("$pages < 3 ? $loaded : null")], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "paging");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap()).unwrap();
    wait_until(|| value(&core, &window)["more"]["state"] == "ready");
    assert_eq!(more(&core, &window)["started"], true);
    wait_until(|| value(&core, &window)["value"].as_array().is_some_and(|items| items.len() == 2));
    assert_eq!(more(&core, &window)["started"], true);
    wait_until(|| value(&core, &window)["value"].as_array().is_some_and(|items| items.len() == 3));
    assert!(value(&core, &window).get("more").is_none());
    let requests = client.connection_requests.lock().unwrap();
    assert_eq!(requests[1].query.get("cursor").map(String::as_str), Some("1"));
    assert_eq!(requests[2].query.get("cursor").map(String::as_str), Some("2"));
}

#[test]
fn multiple_pages_pause_automatic_refresh_but_become_stale() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"a","title":"A"}],"cursor":"two"})));
    let mut app: Value = serde_json::from_str(&definition("cursor")).unwrap();
    app["sources"]["items"]["refresh_secs"] = json!(10);
    let core = open_core_with_client(temp.path(), vec![app.to_string()], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "paging");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap()).unwrap();
    wait_until(|| value(&core, &window)["more"]["state"] == "ready");
    assert_eq!(more(&core, &window)["started"], true);
    wait_until(|| value(&core, &window)["value"].as_array().is_some_and(|items| items.len() == 2));
    thread::sleep(Duration::from_secs(11));
    assert_eq!(client.connection_requests.lock().unwrap().len(), 2);
    let CoreReply::DataAttach { view } = core.handle(CoreRequest::DataAttach { window_id: window, dormant: vec![] }).unwrap() else { panic!("data.attach"); };
    assert!(view.source_meta["items"].stale);
}

#[test]
fn rate_limit_blocks_more_and_preserves_the_existing_items() {
    use kaleidoscope_contract::registry::RateLimitHint;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[{"key":"a","title":"A"}],"cursor":"two"})));
    let core = open_core_with_client(temp.path(), vec![definition("cursor")], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "paging");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(serde_json::from_value(json!({"op":"data.attach","window_id":window})).unwrap()).unwrap();
    wait_until(|| value(&core, &window)["more"]["state"] == "ready");
    let mut limited = response(429, json!({"error":"rate limit"}));
    limited.rate_limit = Some(RateLimitHint { retry_after_secs: Some(2) });
    client.connection_replies.lock().unwrap().insert("/old".into(), limited);
    assert_eq!(more(&core, &window)["started"], true);
    wait_until(|| value(&core, &window)["more"]["state"] == "failed");
    assert_eq!(value(&core, &window)["more"]["id"], "DATA_SOURCE_MORE_RATE_LIMITED");
    assert_eq!(value(&core, &window)["more"]["retry"], true);
    assert_eq!(more(&core, &window)["started"], false);
    assert_eq!(client.connection_requests.lock().unwrap().len(), 2);
    assert_eq!(value(&core, &window)["value"], json!([{"key":"a","title":"A"}]));
}
