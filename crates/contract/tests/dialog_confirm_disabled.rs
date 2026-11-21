use kaleidoscope_contract::validate::parse_app_definition;
use kaleidoscope_contract::{BLOCK_SET_VERSION, ITEM_IMAGE_BLOCK_SET_VERSION};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "dialog-confirm-disabled-test", "name": "대화상자 확정 잠금 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {"open": true, "name": ""}, "ui": ui
    })
}

fn dialog(confirm_disabled: Option<Value>) -> Value {
    let mut block = json!({
        "type": "dialog", "open": {"state": "open"}, "title": "새 폴더", "close_label": "만들기",
        "on_confirm": [{"set_state": "open", "value": false}],
        "on_close": [{"set_state": "open", "value": false}],
        "child": {"type": "input", "value": {"state": "name"}, "on_change": {"set_state": "name"}, "label": "이름"}
    });
    if let Some(binding) = confirm_disabled {
        block["confirm_disabled"] = binding;
    }
    block
}

#[test]
fn dialog_confirm_disabled_stays_in_block_set_67() {
    assert!(BLOCK_SET_VERSION >= ITEM_IMAGE_BLOCK_SET_VERSION);
    assert_eq!(ITEM_IMAGE_BLOCK_SET_VERSION, 67);
}

#[test]
fn dialog_confirm_disabled_requires_block_set_67() {
    let ui = dialog(Some(json!({"expr": "$state.name = ''"})));
    let error = parse_app_definition(&definition(ui.clone(), ITEM_IMAGE_BLOCK_SET_VERSION - 1).to_string())
        .unwrap_err();
    assert!(
        error.details.iter().any(|detail| detail.contains("블록 세트 67판")),
        "{:?}",
        error.details
    );
    parse_app_definition(&definition(ui, ITEM_IMAGE_BLOCK_SET_VERSION).to_string()).unwrap();
}

#[test]
fn dialog_confirm_disabled_round_trips_and_is_omitted_when_absent() {
    let binding = json!({"expr": "$state.name = ''"});
    let parsed = parse_app_definition(
        &definition(dialog(Some(binding.clone())), ITEM_IMAGE_BLOCK_SET_VERSION).to_string(),
    )
    .unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(encoded["ui"]["confirm_disabled"], binding);

    let literal = parse_app_definition(
        &definition(dialog(Some(json!(true))), ITEM_IMAGE_BLOCK_SET_VERSION).to_string(),
    )
    .unwrap();
    assert_eq!(serde_json::to_value(&literal).unwrap()["ui"]["confirm_disabled"], json!(true));

    let plain = parse_app_definition(&definition(dialog(None), 19).to_string()).unwrap();
    let encoded = serde_json::to_value(&plain).unwrap();
    assert!(encoded["ui"].get("confirm_disabled").is_none());
}
