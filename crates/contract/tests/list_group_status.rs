use kaleidoscope_contract::{data, validate::parse_app_definition};
use serde_json::{json, Value};

fn definition(blocks: u32, actions: Value) -> Value {
    json!({"id":"group-test", "name":"묶음 시험", "requires":{"blocks":blocks,"modules":{}},
        "permissions":[], "state":{"selected":null}, "ui":{"type":"list", "items":[], "grouped":true, "group_actions":actions}})
}

#[test]
fn group_action_slots_round_trip_and_validate() {
    let actions = json!([{"key":"retry", "label":"다시 받기", "on_click":[{"set_state":"selected", "value":{"expr":"$item.address"}}]}]);
    assert!(parse_app_definition(&definition(42, actions.clone()).to_string()).is_err());
    let app = parse_app_definition(&definition(43, actions.clone()).to_string()).unwrap();
    assert_eq!(serde_json::to_value(&app).unwrap()["ui"]["group_actions"], actions);
    assert!(data::ui_actions(&app).iter().any(|(path, _)| path == "/ui/group_actions/0/on_click"));
    let repeated = json!([{ "key":"retry", "label":"하나", "on_click":{"set_state":"selected"} },
                          { "key":"retry", "label":"둘", "on_click":{"set_state":"selected"} }]);
    assert!(parse_app_definition(&definition(43, repeated).to_string()).is_err());
    let invalid = json!([{ "key":"retry", "label":"다시 받기", "on_click":{"set_state":"missing"} }]);
    assert!(parse_app_definition(&definition(43, invalid).to_string()).is_err());
}
