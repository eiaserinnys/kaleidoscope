use kaleidoscope_contract::{
    app_definition_schema, data, validate::parse_app_definition, BLOCK_SET_VERSION,
    CHAT_INPUT_HEADER_BLOCK_SET_VERSION,
};
use serde_json::{json, Value};

fn definition(blocks: u32, chat: Value) -> Value {
    json!({
        "id": "chat-input-header-test",
        "name": "입력창 위 고정 자리 시험",
        "requires": {"blocks": blocks, "modules": {"assets": 1, "client": 4}},
        "permissions": [],
        "state": {},
        "assets": [{"id": "chat-input-header-test", "version": 1}],
        "client": {
            "runtime": "javascript",
            "entry": {"id": "chat-input-header-test", "version": 1},
            "inputs": {},
            "outputs": {"status": {"default": "상태"}, "permission": {"default": "승인"}},
            "channels": ["conversation"],
            "actions": ["send", "cancel", "attachment"],
            "commands": {},
            "state_keys": [],
            "storage_entries": []
        },
        "ui": chat
    })
}

fn chat(with_client: bool) -> Value {
    let mut chat = json!({
        "type": "chat",
        "footer": {"type": "text", "value": {"client": "permission"}},
        "input_header": {"type": "text", "value": {"client": "status"}}
    });
    if with_client {
        chat["client"] = json!({
            "channel": "conversation",
            "on_send": "send",
            "on_cancel": "cancel",
            "on_attachment": "attachment"
        });
    }
    chat
}

#[test]
fn input_header_is_block_set_68_and_its_bindings_are_walked_beside_footer() {
    assert_eq!(CHAT_INPUT_HEADER_BLOCK_SET_VERSION, 68);
    assert!(BLOCK_SET_VERSION >= CHAT_INPUT_HEADER_BLOCK_SET_VERSION);

    let app = parse_app_definition(&definition(68, chat(true)).to_string())
        .expect("block set 68 accepts chat.input_header");
    assert_eq!(app.ui.introduced_in(), 68);
    let pointers: Vec<_> = data::all_ui_bindings(&app)
        .into_iter()
        .map(|(pointer, _)| pointer)
        .collect();
    assert!(pointers.iter().any(|pointer| pointer == "/ui/footer/value"));
    assert!(pointers.iter().any(|pointer| pointer == "/ui/input_header/value"));

    let encoded = serde_json::to_value(&app).unwrap();
    assert_eq!(encoded["ui"]["input_header"]["type"], "text");

    let has_detail = |error: &kaleidoscope_contract::CoreError, needle: &str| {
        error.details.iter().any(|detail| detail.contains(needle))
    };
    let old = parse_app_definition(&definition(67, chat(true)).to_string())
        .expect_err("chat.input_header needs block set 68");
    assert!(has_detail(&old, "68"), "{old:?}");

    let mut header_only = chat(false);
    header_only.as_object_mut().unwrap().remove("footer");
    let header_only = parse_app_definition(&definition(68, header_only).to_string())
        .expect_err("chat.input_header needs chat.client");
    assert!(has_detail(&header_only, "chat.input_header"), "{header_only:?}");

    assert!(app_definition_schema().to_string().contains("\"input_header\""));
}

#[test]
fn chat_without_input_header_keeps_its_old_block_set_and_wire_shape() {
    let mut legacy = chat(true);
    legacy.as_object_mut().unwrap().remove("input_header");
    let app = parse_app_definition(&definition(18, legacy).to_string()).unwrap();
    assert_eq!(app.ui.introduced_in(), 18);
    assert!(serde_json::to_value(&app).unwrap()["ui"]
        .get("input_header")
        .is_none());
}

#[test]
fn when_container_width_scope_is_block_set_68_and_round_trips() {
    let ui = json!({"type": "when", "min_width": 620, "width_scope": "container", "child": {"type": "text", "value": "넓음"}});
    let app = definition(68, ui.clone());
    let parsed = parse_app_definition(&app.to_string()).unwrap();
    assert_eq!(parsed.ui.introduced_in(), 68);
    assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["width_scope"], "container");
    assert!(parse_app_definition(&definition(67, ui).to_string()).is_err());
    let old = definition(19, json!({"type":"when", "min_width":620, "child":{"type":"text", "value":"넓음"}}));
    let parsed = parse_app_definition(&old.to_string()).unwrap();
    assert!(serde_json::to_value(parsed).unwrap()["ui"].get("width_scope").is_none());
}
