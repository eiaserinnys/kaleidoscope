use kaleidoscope_contract::{validate::parse_app_definition_with_supported, Supported, STACK_FILL_LIST_BLOCK_SET_VERSION};
use serde_json::{json, Value};

fn app(fill: Value, blocks: u32) -> Value {
    json!({"id":"stack-fill-test", "name":"채움", "requires":{"blocks":blocks,"modules":{}},
        "permissions":[], "state":{}, "ui":{"type":"stack","direction":"column","fill":fill,
        "children":[{"type":"text","value":"하나"},{"type":"text","value":"둘"}]}})
}

fn parse(value: Value) -> Result<kaleidoscope_contract::AppDefinition, kaleidoscope_contract::CoreError> {
    let mut supported = Supported::current();
    supported.blocks = STACK_FILL_LIST_BLOCK_SET_VERSION;
    parse_app_definition_with_supported(&value.to_string(), &supported)
}

#[test]
fn list_fill_round_trips_and_scalar_remains_compatible() {
    for (fill, version) in [(json!([0, 1]), STACK_FILL_LIST_BLOCK_SET_VERSION), (json!(1), 4)] {
        let parsed = parse(app(fill.clone(), version)).expect("채움 정의를 읽는다");
        assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["fill"], fill);
    }
}

#[test]
fn invalid_fill_has_a_specific_error() {
    for (fill, version, code) in [
        (json!([0, 1]), STACK_FILL_LIST_BLOCK_SET_VERSION - 1, "APP_STACK_FILL_VERSION_LOW"),
        (json!([]), STACK_FILL_LIST_BLOCK_SET_VERSION, "APP_STACK_FILL_EMPTY"),
        (json!([0, 2]), STACK_FILL_LIST_BLOCK_SET_VERSION, "APP_STACK_FILL_INDEX_OUT_OF_RANGE"),
        (json!([0, 0]), STACK_FILL_LIST_BLOCK_SET_VERSION, "APP_STACK_FILL_DUPLICATE"),
    ] {
        let error = parse(app(fill, version)).unwrap_err();
        assert_eq!(error.id.as_deref(), Some(code), "{error:?}");
    }
}
