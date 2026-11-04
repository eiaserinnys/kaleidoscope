use super::*;

#[test]
fn control_requests_without_pending_request_return_registered_error() {
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    let error = kaleidoscope_contract::errors::SHARE_CONTEXT_ID_EMPTY();
    let commands = [
        json!({"op":"window.control.respond","response":{"request_id":"r","window_id":"w","result":{"status":"error","error":error,"applied":false}}}),
        json!({"op":"window.control.capture","request_id":"r","window_id":"w","bounds":{"x":0,"y":0,"width":100,"height":100}}),
        json!({"op":"web.control","request_id":"r","window_id":"w","operation":{"kind":"read","image":false}}),
    ];
    for command in commands {
        let request = serde_json::from_value(command).unwrap();
        let err = core.handle(request).unwrap_err();
        assert_eq!(err.id.as_deref(), Some("SHARE_CONTROL_RESPONSE_UNEXPECTED"));
        assert!(err.message.contains("대기 요청이 없습니다"));
    }
}
