use kaleidoscope_contract::validate::{parse_app_definition, parse_cached_app_definition};
use serde_json::{Value, json};

fn definition(ui: Value, blocks: u64) -> Value {
    json!({
        "id": "message-item-key",
        "name": "자료 항목 메시지",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [],
        "state": {"locale": "en", "rows": [{"id": "one", "label_key": "ready"}]},
        "messages": {"en": {"ready": "Ready"}, "ko": {"ready": "준비"}},
        "locale": {"state": "locale"},
        "ui": ui
    })
}

fn repeated_label(label: Value) -> Value {
    json!({
        "type": "repeat",
        "items": {"state": "rows"},
        "key": "id",
        "virtual": false,
        "template": {"type": "text", "value": label}
    })
}

#[test]
fn object_message_item_requires_block_set_19_and_round_trips() {
    let label = json!({"message": {"item": "label_key"}});
    let current = definition(repeated_label(label.clone()), 19);
    let parsed =
        parse_app_definition(&current.to_string()).expect("block set 19 accepts item keys");
    let serialized = serde_json::to_value(parsed).unwrap();
    assert_eq!(serialized["ui"]["template"]["value"], label);

    let cached = parse_cached_app_definition(&serialized.to_string()).unwrap();
    assert_eq!(serde_json::to_value(cached).unwrap(), serialized);

    let older = definition(repeated_label(label), 18);
    let error =
        parse_app_definition(&older.to_string()).expect_err("item keys require block set 19");
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("블록 세트 19판"))
    );
}

#[test]
fn object_message_item_requires_repeat_scope_and_preserves_legacy_string_keys() {
    let outside = definition(
        json!({"type": "text", "value": {"message": {"item": "label_key"}}}),
        19,
    );
    let error =
        parse_app_definition(&outside.to_string()).expect_err("item key needs repeat scope");
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("repeat.template"))
    );

    let legacy = definition(json!({"type": "text", "value": {"message": "ready"}}), 14);
    let parsed =
        parse_app_definition(&legacy.to_string()).expect("legacy string keys remain valid");
    let serialized = serde_json::to_value(parsed).unwrap();
    assert_eq!(serialized["ui"]["value"], json!({"message": "ready"}));
}

#[test]
fn static_message_keys_still_need_matching_entries_in_every_language() {
    let mut value = definition(json!({"type": "text", "value": {"message": "ready"}}), 14);
    value["messages"]["ko"] = json!({});
    let error = parse_app_definition(&value.to_string())
        .expect_err("every locale must retain the static key");
    assert!(!error.details.is_empty());
}

#[test]
fn object_message_item_requires_messages_and_locale_at_registration() {
    let mut value = definition(
        repeated_label(json!({"message": {"item": "label_key"}})),
        19,
    );
    let object = value.as_object_mut().unwrap();
    object.remove("messages");
    object.remove("locale");

    let error = parse_app_definition(&value.to_string())
        .expect_err("message.item requires message dictionaries and a selected locale");
    assert!(error.details.iter().any(|detail| detail.starts_with("/messages:")));
    assert!(error.details.iter().any(|detail| detail.starts_with("/locale:")));
}
