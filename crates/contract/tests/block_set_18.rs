use kaleidoscope_contract::{app_definition_schema, validate::parse_app_definition, Supported, BLOCK_SET_VERSION, CONTRACT_VERSION, LAYOUT_FIELDS_BLOCK_SET_VERSION};
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
fn current_contract_versions_include_realtime() {
    assert!(CONTRACT_VERSION >= 33);
    let supported = Supported::current();
    assert_eq!(supported.blocks, BLOCK_SET_VERSION);
    assert!(supported.blocks >= kaleidoscope_contract::APP_ICON_BLOCK_SET_VERSION);
    assert!(supported.blocks >= LAYOUT_FIELDS_BLOCK_SET_VERSION);
    assert!(supported.blocks >= kaleidoscope_contract::BUTTON_DESCRIPTION_BLOCK_SET_VERSION);
    assert!(supported.blocks >= kaleidoscope_contract::LIST_ICONS_BLOCK_SET_VERSION);
    assert!(supported.blocks >= kaleidoscope_contract::INPUT_READ_ONLY_BLOCK_SET_VERSION);
    assert!(supported.blocks >= kaleidoscope_contract::INPUT_SPIN_BLOCK_SET_VERSION);
    assert!(supported.blocks >= kaleidoscope_contract::INPUT_OPTIONS_BLOCK_SET_VERSION);
    assert!(supported.blocks >= kaleidoscope_contract::TIMELINE_DATES_BLOCK_SET_VERSION);
    assert_eq!(supported.blocks, kaleidoscope_contract::INPUT_DATE_TIME_BLOCK_SET_VERSION);
    assert!(supported.blocks >= kaleidoscope_contract::realtime::REALTIME_BLOCK_SET_VERSION);
    assert_eq!(supported.modules.get("client"), Some(&kaleidoscope_contract::RECEIVE_MESSAGE_CLIENT_VERSION));
}

#[test]
fn block_set_18_remains_supported_by_current_contract() {
    assert!(CONTRACT_VERSION >= 33);
    let supported = Supported::current();
    assert_eq!(supported.blocks, BLOCK_SET_VERSION);
    assert!(supported.blocks >= 18);
    assert!(supported.modules.get("client").is_some_and(|version| *version >= 4));
}

#[test]
fn responsive_split_and_repeat_gap_require_their_block_set() {
    let split = json!({"type":"split", "direction":"row", "column_below":700, "children":[{"type":"text","value":"a"},{"type":"text","value":"b"}]});
    let repeat = json!({"type":"repeat", "items":[], "key":"id", "gap":"large", "template":{"type":"text","value":"x"}});
    for (ui, code) in [
        (split.clone(), "APP_SPLIT_COLUMN_BELOW_VERSION_REQUIRED"),
        (repeat.clone(), "APP_REPEAT_GAP_VERSION_REQUIRED"),
    ] {
        let error =
            parse_app_definition(&definition(ui.clone(), LAYOUT_FIELDS_BLOCK_SET_VERSION as u64 - 1).to_string())
                .unwrap_err();
        assert_eq!(error.id.as_deref(), Some(code));
        let parsed =
            parse_app_definition(&definition(ui.clone(), LAYOUT_FIELDS_BLOCK_SET_VERSION as u64).to_string())
                .unwrap();
        let serialized = serde_json::to_value(parsed).unwrap();
        for field in ["column_below", "gap"] {
            if let Some(value) = ui.get(field) {
                assert_eq!(&serialized["ui"][field], value);
            }
        }
    }
    let mut column = split.clone();
    column["direction"] = json!("column");
    assert_eq!(
        parse_app_definition(&definition(column, LAYOUT_FIELDS_BLOCK_SET_VERSION as u64).to_string())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_SPLIT_COLUMN_BELOW_DIRECTION_INVALID")
    );
    let mut zero = split;
    zero["column_below"] = json!(0);
    assert_eq!(
        parse_app_definition(&definition(zero, LAYOUT_FIELDS_BLOCK_SET_VERSION as u64).to_string())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_SPLIT_COLUMN_BELOW_ZERO")
    );
}
