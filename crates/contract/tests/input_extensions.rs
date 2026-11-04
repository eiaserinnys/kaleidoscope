use kaleidoscope_contract::{data::all_ui_bindings, validate::parse_app_definition, BUTTON_DESCRIPTION_BLOCK_SET_VERSION, INPUT_SPIN_BLOCK_SET_VERSION};
use serde_json::{json, Value};

fn definition(blocks: u32) -> Value {
    json!({"id":"tooltip-fixture", "name":"설명", "requires":{"blocks":blocks,"modules":{}}, "permissions":[], "state":{"hint":"설명"},
        "ui":{"type":"stack","direction":"column","children":[{"type":"button","label":"실행","description":{"state":"hint"},"on_click":[{"set_state":"hint","value":"실행"}]}]}})
}

#[test]
fn button_description_requires_its_version_and_joins_binding_walk() {
    let low = parse_app_definition(&definition(25).to_string()).unwrap_err();
    assert_eq!(low.id.as_deref(), Some("APP_BUTTON_DESCRIPTION_VERSION_LOW"));
    let parsed = parse_app_definition(&definition(BUTTON_DESCRIPTION_BLOCK_SET_VERSION).to_string()).unwrap();
    assert!(all_ui_bindings(&parsed).iter().any(|(path, _)| path == "/ui/children/0/description"));
    assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["children"][0]["description"]["state"], "hint");
}

#[test]
fn spin_requires_version_and_number_kind() {
    let mut app = definition(INPUT_SPIN_BLOCK_SET_VERSION - 1);
    app["ui"]["children"][0] = json!({"type":"input", "kind":"number", "spin":false, "value":{"state":"hint"}, "on_change":{"set_state":"hint"}});
    assert_eq!(parse_app_definition(&app.to_string()).unwrap_err().id.as_deref(), Some("APP_INPUT_SPIN_VERSION_LOW"));
    app["requires"]["blocks"] = json!(INPUT_SPIN_BLOCK_SET_VERSION);
    let parsed = parse_app_definition(&app.to_string()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["children"][0]["spin"], false);
    app["ui"]["children"][0]["kind"] = json!("text");
    assert_eq!(parse_app_definition(&app.to_string()).unwrap_err().id.as_deref(), Some("APP_INPUT_SPIN_KIND_INVALID"));
}
