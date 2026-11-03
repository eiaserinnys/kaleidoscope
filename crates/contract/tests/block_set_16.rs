use kaleidoscope_contract::{data, validate::parse_app_definition, Block};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u64) -> Value {
    json!({
        "id": "localized-controls",
        "name": "Localized controls",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [],
        "state": {
            "language": "en", "enabled": false, "amount": 2,
            "color": "#123456", "name": "", "choice": "one"
        },
        "messages": {
            "en": {
                "tab": "Details", "toggle": "Enabled", "slider": "Amount",
                "color": "Color", "input": "Name", "input_hint": "Type a name",
                "select": "Choice", "select_hint": "Choose one"
            },
            "ko": {
                "tab": "상세", "toggle": "사용", "slider": "양",
                "color": "색", "input": "이름", "input_hint": "이름 입력",
                "select": "선택", "select_hint": "하나 고르기"
            }
        },
        "locale": {"state": "language"},
        "ui": ui
    })
}

fn parsed(value: &Value) -> kaleidoscope_contract::AppDefinition {
    parse_app_definition(&value.to_string()).unwrap_or_else(|error| panic!("{error:?}"))
}

fn all_controls(label: Value) -> Value {
    json!({
        "type": "stack", "direction": "column", "children": [
            {"type":"tabs", "tabs":[{"label":label["tab"], "child":{"type":"text", "value":"Content"}}]},
            {"type":"toggle", "value":{"state":"enabled"}, "on_change":{"set_state":"enabled"}, "label":label["toggle"]},
            {"type":"slider", "value":{"state":"amount"}, "on_change":{"set_state":"amount"}, "label":label["slider"], "min":0, "max":10},
            {"type":"color", "value":{"state":"color"}, "on_change":{"set_state":"color"}, "label":label["color"]},
            {"type":"input", "value":{"state":"name"}, "on_change":{"set_state":"name"}, "label":label["input"], "placeholder":label["input_hint"]},
            {"type":"select", "value":{"state":"choice"}, "on_change":{"set_state":"choice"}, "options":["one", "two"], "label":label["select"], "placeholder":label["select_hint"]}
        ]
    })
}

#[test]
fn bindable_control_labels_accept_messages_and_require_block_set_16() {
    let labels = json!({
        "tab":{"message":"tab"}, "toggle":{"message":"toggle"},
        "slider":{"message":"slider"}, "color":{"message":"color"},
        "input":{"message":"input"}, "input_hint":{"message":"input_hint"},
        "select":{"message":"select"}, "select_hint":{"message":"select_hint"}
    });

    let old_version = definition(all_controls(labels.clone()), 15);
    let error = parse_app_definition(&old_version.to_string()).expect_err("block set 15 must reject message labels");
    assert!(error.details.iter().any(|detail| detail.contains("16판")), "{error:?}");

    let app = parsed(&definition(all_controls(labels), 16));
    let bindings = data::all_ui_bindings(&app);
    for path in [
        "/ui/children/0/tabs/0/label",
        "/ui/children/1/label",
        "/ui/children/2/label",
        "/ui/children/3/label",
        "/ui/children/4/label",
        "/ui/children/4/placeholder",
        "/ui/children/5/label",
        "/ui/children/5/placeholder",
    ] {
        assert!(bindings.iter().any(|(pointer, _)| pointer == path), "missing binding slot {path}");
    }
}

#[test]
fn plain_control_labels_keep_string_wire_shape_on_block_set_15() {
    let labels = json!({
        "tab":"Details", "toggle":"Enabled", "slider":"Amount", "color":"Color",
        "input":"Name", "input_hint":"Type a name", "select":"Choice", "select_hint":"Choose one"
    });
    let app = parsed(&definition(all_controls(labels), 15));
    let wire = serde_json::to_value(app).unwrap();
    for path in [
        "/ui/children/0/tabs/0/label",
        "/ui/children/1/label",
        "/ui/children/2/label",
        "/ui/children/3/label",
        "/ui/children/4/label",
        "/ui/children/4/placeholder",
        "/ui/children/5/label",
        "/ui/children/5/placeholder",
    ] {
        assert!(wire.pointer(path).is_some_and(Value::is_string), "{path}: {wire}");
    }
}

#[test]
fn repeat_item_can_supply_a_control_label() {
    let ui = json!({
        "type":"repeat", "items":[{"id":"one", "label":"First"}], "key":"id", "layout":"column",
        "template":{"type":"toggle", "value":{"state":"enabled"}, "on_change":{"set_state":"enabled"}, "label":{"item":"label"}}
    });
    let app = parsed(&definition(ui, 16));
    let wire = serde_json::to_value(&app).unwrap();
    assert_eq!(wire.pointer("/ui/template/label"), Some(&json!({"item":"label"})));
    assert!(data::all_ui_bindings(&app).iter().any(|(pointer, binding)| {
        pointer == "/ui/template/label" && matches!(binding, kaleidoscope_contract::data::Binding::Item(_))
    }));
}

#[test]
fn expression_label_keeps_its_source_live() {
    let mut app = definition(
        json!({
            "type":"slider", "value":{"state":"amount"},
            "on_change":{"set_state":"amount"},
            "label":{"expr":"$data.labels.amount"}, "min":0, "max":10
        }),
        16,
    );
    app["requires"]["modules"] = json!({"http":1});
    app["permissions"] = json!([{
        "id":"net", "module":"http", "label":"Web",
        "base_url":"https://example.com", "paths":["/labels"]
    }]);
    app["sources"] = json!({
        "labels":{"kind":"request", "permission":"net", "path":"/labels"}
    });

    let app = parsed(&app);
    assert!(data::all_exprs(&app).iter().any(|(pointer, expr)| {
        pointer == "/ui/label" && *expr == "$data.labels.amount"
    }));
    assert!(data::live_sources(&app, &[]).contains("labels"));
}

#[test]
fn missing_message_key_in_a_new_label_is_rejected() {
    let app = definition(all_controls(json!({
        "tab":{"message":"missing"}, "toggle":"Enabled", "slider":"Amount", "color":"Color",
        "input":"Name", "input_hint":"Type a name", "select":"Choice", "select_hint":"Choose one"
    })), 16);
    let error = parse_app_definition(&app.to_string()).expect_err("missing message key must be rejected");
    assert!(error.details.iter().any(|detail| detail.contains("모든 언어에 메시지 키")), "{error:?}");
}

#[test]
fn block_type_deserialization_preserves_the_plain_and_bound_forms() {
    let plain = json!({"type":"tabs", "tabs":[{"label":"Details", "child":{"type":"text", "value":"x"}}]});
    let block: Block = serde_json::from_value(plain.clone()).unwrap();
    let wire = serde_json::to_value(block).unwrap();
    assert_eq!(wire.pointer("/tabs/0/label"), plain.pointer("/tabs/0/label"));

    let bound = json!({"type":"tabs", "tabs":[{"label":{"message":"tab"}, "child":{"type":"text", "value":"x"}}]});
    let block: Block = serde_json::from_value(bound.clone()).unwrap();
    let wire = serde_json::to_value(block).unwrap();
    assert_eq!(wire.pointer("/tabs/0/label"), bound.pointer("/tabs/0/label"));
}
