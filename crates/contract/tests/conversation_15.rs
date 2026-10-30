use kaleidoscope_contract::{conversation::AdoptThreadRequest, CoreError};
use serde_json::json;

#[test]
fn conversation_errors_have_stable_wire_codes() {
    for code in ["login_required", "binding_conflict"] {
        let error: CoreError =
            serde_json::from_value(json!({"code":code, "message":"오류"})).unwrap();
        assert_eq!(serde_json::to_value(error).unwrap()["code"], code);
    }
}

#[test]
fn adoption_fixture_round_trips() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/conversation-v1/adoption.json")).unwrap();
    let request: AdoptThreadRequest = serde_json::from_value(fixture.clone()).unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), fixture);
}
