use super::*;
use kaleidoscope_contract::registry::ConnectionKind;

fn definition() -> String {
    json!({
        "id":"read-app", "name":"현재 값 읽기 시험", "requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"read","label":"API"}],
        "state":{"text":"옛 글"},
        "sources":{"items":{"kind":"request","permission":"api","path":"/old"}},
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"text","value":{"expr":"$state.text & '!'"}},
            {"type":"input","value":{"state":"text"},"on_change":{"set_state":"text"}},
            {"type":"list","items":{"expr":"$data.items.items"}}
        ]}
    }).to_string()
}

fn read(core: &Core, window: &str) -> Result<Value, kaleidoscope_contract::CoreError> {
    let request = serde_json::from_value(json!({"op":"data.read","window_id":window})).unwrap();
    core.handle(request).map(|reply| serde_json::to_value(reply).unwrap())
}

#[test]
fn read_right_after_input_act_returns_new_state_and_view_without_side_effects() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!({"items":[]})));
    let core = open_core_with_client(temp.path(), vec![definition()], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "read-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(CoreRequest::DataAttach { window_id: window.clone(), dormant: vec![] }).unwrap();
    wait_until(|| client.connection_requests.lock().unwrap().len() == 1);
    let updates = Arc::new(Mutex::new(0usize));
    let received = updates.clone();
    core.subscribe(Box::new(move |event| {
        if serde_json::to_value(event).unwrap()["event"] == "data.update" { *received.lock().unwrap() += 1; }
    }));

    core.handle(CoreRequest::DataAct {
        window_id: window.clone(), pointer: "/ui/children/1/on_change".into(),
        event: json!("새 글"), item: Value::Null, modifiers: None,
    }).unwrap();
    // 이벤트 전달을 기다리지 않고 응답 직후에 읽는다.
    let first = read(&core, &window).unwrap();
    assert_eq!(first["op"], "data.read");
    assert_eq!(first["state"]["text"], "새 글");
    assert_eq!(first["view"]["values"]["/ui/children/0/value"], json!({"status":"ready","value":"새 글!"}));

    wait_until(|| *updates.lock().unwrap() >= 1);
    let events = *updates.lock().unwrap();
    for _ in 0..3 { assert_eq!(read(&core, &window).unwrap(), first); }
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(*updates.lock().unwrap(), events);
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
}

#[test]
fn read_without_attached_runtime_is_not_found_with_window_detail() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![definition()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "read-app");
    let error = read(&core, &window).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DATA_READ_RUNTIME_NOT_FOUND"));
    assert_eq!(error.code, ErrorCode::NotFound);
    assert_eq!(error.details, vec![format!("window: {window}")]);
}
