use kaleidoscope_contract::{
    app_definition_schema,
    validate::{parse_app_definition, parse_cached_app_definition},
};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u64) -> Value {
    json!({
        "id": "dialog-footer",
        "name": "대화상자 바닥 단추",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [],
        "state": {"confirmed": false, "dialog_open": true},
        "ui": ui
    })
}

fn dialog(on_confirm: Option<Value>, danger: Option<Value>) -> Value {
    let mut ui = json!({
        "type": "dialog",
        "open": true,
        "title": "확인",
        "child": {"type": "text", "value": "내용"},
        "on_close": [{"set_state": "dialog_open", "value": false}]
    });
    if let Some(on_confirm) = on_confirm {
        ui["on_confirm"] = on_confirm;
    }
    if let Some(danger) = danger {
        ui["danger"] = danger;
    }
    ui
}

#[test]
fn dialog_footer_fields_require_block_set_19_by_source_field_presence() {
    let fields = [
        (
            Some(json!([{"set_state": "confirmed", "value": true}])),
            None,
        ),
        (None, Some(json!(false))),
    ];

    for (on_confirm, danger) in fields {
        for older_version in [17, 18] {
            let older = definition(dialog(on_confirm.clone(), danger.clone()), older_version);
            let error = parse_app_definition(&older.to_string())
                .expect_err("dialog footer fields must reject block sets 17 and 18");
            assert!(
                error.details.iter().any(|detail| detail.contains("19판")),
                "{error:?}"
            );
        }

        let current = definition(dialog(on_confirm, danger), 19);
        parse_app_definition(&current.to_string())
            .expect("block set 19 accepts dialog footer fields");
    }
}

#[test]
fn dialog_footer_defaults_are_omitted_and_cached_round_trip_keeps_legacy_shape() {
    let value = definition(dialog(None, None), 14);
    let parsed = parse_app_definition(&value.to_string()).unwrap();
    let serialized = serde_json::to_value(parsed).unwrap();

    assert!(serialized["ui"].get("on_confirm").is_none());
    assert!(serialized["ui"].get("danger").is_none());
    let cached = parse_cached_app_definition(&serialized.to_string()).unwrap();
    assert_eq!(serde_json::to_value(cached).unwrap(), serialized);
}

#[test]
fn dialog_confirm_action_and_danger_round_trip_through_cached_definition() {
    let on_confirm = json!([{"set_state": "confirmed", "value": true}]);
    let value = definition(dialog(Some(on_confirm.clone()), Some(json!(true))), 19);
    let parsed = parse_app_definition(&value.to_string()).unwrap();
    let serialized = serde_json::to_value(&parsed).unwrap();

    assert_eq!(serialized["ui"]["on_confirm"], on_confirm);
    assert_eq!(serialized["ui"]["danger"], true);
    assert!(kaleidoscope_contract::data::ui_actions(&parsed)
        .iter()
        .any(|(pointer, _)| pointer == "/ui/on_confirm"));
    let cached = parse_cached_app_definition(&serialized.to_string()).unwrap();
    assert_eq!(serde_json::to_value(cached).unwrap(), serialized);
}

#[test]
fn block_set_19_schema_exposes_dialog_footer_fields() {
    assert_eq!(kaleidoscope_contract::BLOCK_SET_VERSION, 20);
    let schema = app_definition_schema().to_string();
    assert!(schema.contains("on_confirm"));
    assert!(schema.contains("danger"));
}
