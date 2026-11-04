use kaleidoscope_contract::{app_definition_schema, validate::parse_app_definition, Supported, BLOCK_SET_VERSION, CONTRACT_VERSION};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u64) -> Value {
    json!({
        "id": "blocks-18-fixture",
        "name": "Blocks 18 fixture",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [],
        "state": {"message": "선택하세요", "code": "FILES_ACCESS_PERMISSION_UNDECLARED"},
        "ui": ui
    })
}

#[test]
fn center_stack_and_notice_round_trip_in_block_set_18() {
    let value = definition(json!({
        "type": "stack", "direction": "column", "place": "center", "children": [
            {"type": "notice", "message": "작업을 마치지 못했습니다", "error_id": "FILES_ACCESS_PERMISSION_UNDECLARED", "kind": "error",
             "actions": [{"label": "다시 시도", "on_click": [{"set_state": "message", "value": {"state": "message"}}]}]}
        ]
    }), 18);

    let parsed = parse_app_definition(&value.to_string()).unwrap();
    let serialized = serde_json::to_value(parsed).unwrap();
    assert_eq!(serialized["ui"]["place"], "center");
    assert_eq!(serialized["ui"]["children"][0]["type"], "notice");
    assert_eq!(serialized["ui"]["children"][0]["kind"], "error");
    assert_eq!(serialized["ui"]["children"][0]["message"], "작업을 마치지 못했습니다");
    assert_eq!(serialized["ui"]["children"][0]["actions"][0]["label"], "다시 시도");
}

#[test]
fn block_set_18_fields_are_rejected_by_version_17_and_earlier() {
    let fields = [
        json!({"type":"stack", "direction":"column", "place":"center", "children":[{"type":"text", "value":"x"}]}),
        json!({"type":"select", "value":"a", "on_change":{"set_state":"choice"}, "options":["a"], "disabled":true}),
        json!({"type":"toggle", "value":false, "on_change":{"set_state":"enabled"}, "label":"사용", "disabled":true}),
        json!({"type":"notice", "message":"내용"}),
    ];
    for blocks in [16, 17] {
        for ui in &fields {
            let value = definition(ui.clone(), blocks);
            let error = parse_app_definition(&value.to_string()).expect_err("block sets 17 and earlier must reject block set 18 fields");
            assert!(error.details.iter().any(|detail| detail.contains("18판")), "{error:?}");
        }
    }
}

#[test]
fn block_set_18_schema_exposes_new_fields_and_types() {
    let schema = app_definition_schema();
    let schema_text = schema.to_string();
    for field in ["place", "notice", "error_id", "disabled", "loading"] {
        assert!(schema_text.contains(field), "schema omitted {field}");
    }
}

#[test]
fn current_contract_versions_include_block_set_21() {
    assert_eq!(CONTRACT_VERSION, 29);
    let supported = Supported::current();
    assert_eq!(supported.blocks, BLOCK_SET_VERSION);
    assert_eq!(supported.blocks, 21);
    assert_eq!(supported.modules.get("client"), Some(&4));
}

#[test]
fn block_set_18_remains_supported_by_current_contract() {
    assert_eq!(CONTRACT_VERSION, 29);
    let supported = Supported::current();
    assert_eq!(supported.blocks, BLOCK_SET_VERSION);
    assert!(supported.blocks >= 18);
    assert_eq!(supported.modules.get("client"), Some(&4));
}
