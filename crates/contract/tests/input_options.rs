use kaleidoscope_contract::{
    data::{all_ui_bindings, Binding},
    validate::parse_app_definition,
};
use serde_json::{json, Value};

fn definition(block: Value, version: u32) -> Value {
    json!({"id":"options-fixture", "name":"선택지", "requires":{"blocks":version,"modules":{}}, "permissions":[], "state":{"value":"a"}, "ui":block})
}

fn input(options: Value) -> Value {
    json!({"type":"input", "value":{"state":"value"}, "on_change":{"set_state":"value"}, "options":options})
}

fn error_id(block: Value, version: u32) -> String {
    parse_app_definition(&definition(block, version).to_string())
        .unwrap_err()
        .id
        .unwrap()
}

#[test]
fn options_require_their_version_and_join_the_binding_walk() {
    let block = input(json!(["a", "b"]));
    assert_eq!(error_id(block.clone(), 31), "APP_INPUT_OPTIONS_VERSION_LOW");
    let parsed = parse_app_definition(&definition(block, 33).to_string()).unwrap();
    assert!(all_ui_bindings(&parsed)
        .iter()
        .any(|(path, _)| path == "/ui/options"));
}

#[test]
fn one_string_option_is_a_literal_and_passes_validation() {
    let parsed =
        parse_app_definition(&definition(input(json!(["alpha"])), 33).to_string()).unwrap();
    let bindings = all_ui_bindings(&parsed);
    let binding = bindings
        .iter()
        .find(|(path, _)| path == "/ui/options")
        .unwrap()
        .1;
    assert!(matches!(binding, Binding::Literal(value) if value == &json!(["alpha"])));
}

#[test]
fn invalid_combinations_and_literal_values_have_specific_errors() {
    let mut block = input(json!(["a", "b"]));
    block["kind"] = json!("number");
    assert_eq!(error_id(block, 33), "APP_INPUT_OPTIONS_KIND_INVALID");
    let mut block = input(json!(["a", "b"]));
    block["multiline"] = json!(true);
    assert_eq!(error_id(block, 33), "APP_INPUT_OPTIONS_MULTILINE_INVALID");
    let mut block = input(json!(["a", "b"]));
    block.as_object_mut().unwrap().remove("options");
    block["options_only"] = json!(true);
    assert_eq!(
        error_id(block, 33),
        "APP_INPUT_OPTIONS_ONLY_WITHOUT_OPTIONS"
    );
    assert_eq!(
        error_id(input(json!(["a", {"value": 2, "label":"둘"}])), 33),
        "APP_INPUT_OPTIONS_KEY_NOT_STRING"
    );
}

#[test]
fn select_literal_description_requires_the_options_version() {
    let block = json!({"type":"select", "value":{"state":"value"}, "on_change":{"set_state":"value"}, "options":[{"value":"a","label":"A","description":"설명"}, "b"]});
    assert_eq!(
        error_id(block.clone(), 31),
        "APP_SELECT_DESCRIPTION_VERSION_LOW"
    );
    assert!(parse_app_definition(&definition(block, 33).to_string()).is_ok());
}

#[test]
fn option_errors_distinguish_causes_and_values() {
    for (value, suffix, text) in [
        (json!(12), "ARRAY_INVALID", "12"),
        (json!([12]), "ITEM_INVALID", "12"),
        (json!([{}]), "KEY_MISSING", "value"),
        (
            json!([{"value":"a", "label":12}]),
            "KEY_NOT_STRING",
            "label",
        ),
        (
            json!([{"value":"a", "label":"A", "description":12}]),
            "KEY_NOT_STRING",
            "description",
        ),
    ] {
        let error = parse_app_definition(&definition(input(value), 33).to_string()).unwrap_err();
        assert_eq!(error.id.unwrap(), format!("APP_INPUT_OPTIONS_{suffix}"));
        assert!(error.message.contains(text));
    }
}
