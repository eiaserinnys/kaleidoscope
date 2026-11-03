use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition, Block};
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
                "select": "Choice", "select_hint": "Choose one",
                "dialog_close": "Close", "dialog_cancel": "Cancel",
                "tour_previous": "Previous", "tour_next": "Next",
                "tour_done": "Done", "tour_skip": "Skip"
            },
            "ko": {
                "tab": "상세", "toggle": "사용", "slider": "양",
                "color": "색", "input": "이름", "input_hint": "이름 입력",
                "select": "선택", "select_hint": "하나 고르기",
                "dialog_close": "닫기", "dialog_cancel": "취소",
                "tour_previous": "이전", "tour_next": "다음",
                "tour_done": "끝내기", "tour_skip": "건너뛰기"
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

fn dialog_and_tour(close_label: Value, cancel_label: Value, labels: Value) -> Value {
    json!({
        "type":"stack", "direction":"column", "children":[
            {
                "type":"dialog", "open":false, "title":"Dialog",
                "close_label":close_label, "cancel_label":cancel_label,
                "child":{"type":"text", "value":"Dialog content"},
                "on_close":{"set_state":"language"}
            },
            {"type":"anchor", "id":"tour-target", "child":{"type":"text", "value":"Tour target"}},
            {
                "type":"tour", "open":false, "step":"first",
                "steps":[
                    {"key":"first", "target":"tour-target", "title":"Guide", "body":"Guide body"},
                    {"key":"last", "target":"tour-target", "title":"Summary", "body":"Summary body"}
                ],
                "on_step":{"set_state":"language"}, "on_close":{"set_state":"language"},
                "labels":labels
            }
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

#[test]
fn dialog_and_tour_labels_roundtrip_and_require_block_set_16_when_bound() {
    let labels = json!({
        "previous":{"message":"tour_previous"}, "next":{"message":"tour_next"},
        "done":{"message":"tour_done"}, "skip":{"message":"tour_skip"}
    });
    let ui = dialog_and_tour(
        json!({"message":"dialog_close"}),
        json!({"message":"dialog_cancel"}),
        labels,
    );

    let error = parse_app_definition(&definition(ui.clone(), 15).to_string())
        .expect_err("message-bound dialog and tour labels must require block set 16");
    assert!(
        error.details.iter().any(|detail| detail.contains("16판")),
        "{error:?}"
    );

    let app = parsed(&definition(ui.clone(), 16));
    let bindings = data::all_ui_bindings(&app);
    for path in [
        "/ui/children/0/close_label",
        "/ui/children/0/cancel_label",
        "/ui/children/2/labels/previous",
        "/ui/children/2/labels/next",
        "/ui/children/2/labels/done",
        "/ui/children/2/labels/skip",
    ] {
        assert!(
            bindings.iter().any(|(pointer, _)| pointer == path),
            "missing binding slot {path}"
        );
    }
    let wire = serde_json::to_value(app).unwrap();
    assert_eq!(
        wire.pointer("/ui/children/0/close_label"),
        Some(&json!({"message":"dialog_close"}))
    );
    assert_eq!(
        wire.pointer("/ui/children/0/cancel_label"),
        Some(&json!({"message":"dialog_cancel"}))
    );
    for label in ["previous", "next", "done", "skip"] {
        assert_eq!(
            wire.pointer(&format!("/ui/children/2/labels/{label}")),
            Some(&json!({"message":format!("tour_{label}")})),
        );
    }

    let schema = app_definition_schema().to_string();
    for field in ["close_label", "cancel_label", "labels", "previous", "next", "done", "skip"] {
        assert!(schema.contains(&format!("\"{field}\"")), "missing schema field {field}");
    }
}

#[test]
fn plain_dialog_and_tour_labels_keep_string_wire_shape_on_block_set_15() {
    let labels = json!({
        "previous":"Previous", "next":"Next", "done":"Done", "skip":"Skip"
    });
    let app = parsed(&definition(
        dialog_and_tour(json!("Close"), json!("Cancel"), labels),
        15,
    ));
    let wire = serde_json::to_value(app).unwrap();
    assert_eq!(
        wire.pointer("/ui/children/0/close_label"),
        Some(&json!("Close"))
    );
    assert_eq!(
        wire.pointer("/ui/children/0/cancel_label"),
        Some(&json!("Cancel"))
    );
    for (label, expected) in [
        ("previous", "Previous"),
        ("next", "Next"),
        ("done", "Done"),
        ("skip", "Skip"),
    ] {
        assert_eq!(
            wire.pointer(&format!("/ui/children/2/labels/{label}")),
            Some(&json!(expected))
        );
    }
}

#[test]
fn missing_message_keys_in_dialog_and_tour_labels_are_rejected() {
    let ui = dialog_and_tour(
        json!({"message":"missing_close"}),
        json!({"message":"dialog_cancel"}),
        json!({"next":{"message":"missing_next"}}),
    );
    let error = parse_app_definition(&definition(ui, 16).to_string())
        .expect_err("missing dialog and tour labels must be rejected");
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("missing_close")),
        "{error:?}"
    );
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("missing_next")),
        "{error:?}"
    );
}

#[test]
fn dialog_and_tour_expression_labels_keep_their_sources_live() {
    let mut app = definition(
        dialog_and_tour(
            json!({"expr":"$data.labels.close"}),
            json!("Cancel"),
            json!({"next":{"expr":"$data.labels.next"}}),
        ),
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
        pointer == "/ui/children/0/close_label" && *expr == "$data.labels.close"
    }));
    assert!(data::all_exprs(&app).iter().any(|(pointer, expr)| {
        pointer == "/ui/children/2/labels/next" && *expr == "$data.labels.next"
    }));
    assert!(data::live_sources(&app, &[]).contains("labels"));
}
