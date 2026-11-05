use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition};
use serde_json::{json, Value};

fn definition(blocks: u64, chat: Value, client: Value) -> Value {
    json!({
        "id": "chat-client-test",
        "name": "Chat client test",
        "requires": {"blocks": blocks, "modules": {"assets": 1, "client": 4}},
        "permissions": [],
        "state": {},
        "assets": [{"id": "chat-client-test", "version": 1}],
        "client": client,
        "ui": chat
    })
}

fn client_decl(channels: Value, actions: Value) -> Value {
    json!({
        "runtime": "javascript",
        "entry": {"id": "chat-client-test", "version": 1},
        "inputs": {},
        "outputs": {"footer": {"default": "도구 승인"}},
        "channels": channels,
        "actions": actions,
        "commands": {},
        "state_keys": [],
        "storage_entries": []
    })
}

fn chat_block() -> Value {
    json!({
        "type": "chat",
        "client": {
            "channel": "conversation",
            "on_send": "send",
            "on_cancel": "cancel",
            "on_attachment": "attachment"
        },
        "footer": {"type": "text", "value": {"client": "footer"}}
    })
}

#[test]
fn client_chat_is_block_set_18_and_client_module_4_and_footer_is_a_client_bound_child() {
    let app = parse_app_definition(
        &definition(
            18,
            chat_block(),
            client_decl(
                json!(["conversation"]),
                json!(["send", "cancel", "attachment"]),
            ),
        )
        .to_string(),
    )
    .expect("valid client chat");

    let bindings = data::all_ui_bindings(&app);
    assert!(bindings
        .iter()
        .any(|(pointer, _)| pointer == "/ui/footer/value"));

    let old_block_set = parse_app_definition(
        &definition(
            17,
            chat_block(),
            client_decl(
                json!(["conversation"]),
                json!(["send", "cancel", "attachment"]),
            ),
        )
        .to_string(),
    )
    .expect_err("chat client fields need block set 18");
    assert!(
        old_block_set
            .details
            .iter()
            .any(|detail| detail.contains("18판")),
        "{old_block_set:?}"
    );

    let mut old_client_module = definition(
        18,
        chat_block(),
        client_decl(
            json!(["conversation"]),
            json!(["send", "cancel", "attachment"]),
        ),
    );
    old_client_module["requires"]["modules"]["client"] = json!(3);
    let old_client_module = parse_app_definition(&old_client_module.to_string())
        .expect_err("chat client fields need client module 4");
    assert!(
        old_client_module
            .details
            .iter()
            .any(|detail| detail.contains("client") && detail.contains("4")),
        "{old_client_module:?}"
    );
}

#[test]
fn client_chat_requires_declared_channel_and_actions_and_rejects_other_modes() {
    let missing_channel = parse_app_definition(
        &definition(
            18,
            chat_block(),
            client_decl(json!([]), json!(["send", "cancel", "attachment"])),
        )
        .to_string(),
    )
    .expect_err("channel must be declared");
    assert!(
        missing_channel
            .details
            .iter()
            .any(|detail| detail.contains("channel")),
        "{missing_channel:?}"
    );

    let missing_action = parse_app_definition(
        &definition(
            18,
            chat_block(),
            client_decl(json!(["conversation"]), json!(["send", "cancel"])),
        )
        .to_string(),
    )
    .expect_err("chat actions must be declared");
    assert!(
        missing_action
            .details
            .iter()
            .any(|detail| detail.contains("on_attachment")),
        "{missing_action:?}"
    );

    let mut mixed = chat_block();
    mixed["permission"] = json!("agent");
    let error = parse_app_definition(
        &definition(
            18,
            mixed,
            client_decl(
                json!(["conversation"]),
                json!(["send", "cancel", "attachment"]),
            ),
        )
        .to_string(),
    )
    .expect_err("client and local agent modes cannot mix");
    assert_eq!(
        error.id.as_deref(),
        Some("APP_DEFINITION_REMOVED_CHAT_LOCAL_FIELDS"),
        "{error:?}"
    );
}

#[test]
fn app_definition_schema_contains_client_channels_and_chat_client_footer() {
    let schema = app_definition_schema().to_string();
    for key in [
        "channels",
        "on_send",
        "on_cancel",
        "on_attachment",
        "footer",
    ] {
        assert!(schema.contains(key), "schema does not expose {key}");
    }
}

#[test]
fn chat_loading_requires_block_set_38_and_registers_binding() {
    let client = client_decl(json!(["conversation"]), json!(["send", "cancel", "attachment"]));
    for loading in [json!(false), json!(true), json!({"state":"switching"}), json!({"expr":"switching"}), json!({"client":"footer"})] {
        let mut chat = chat_block();
        chat["loading"] = loading.clone();
        let mut old = definition(37, chat.clone(), client.clone());
        old["state"]["switching"] = json!(false);
        let error = parse_app_definition(&old.to_string()).expect_err("loading에는 38판이 필요하다");
        assert!(error.details.iter().any(|detail| detail.contains("38판")), "{error:?}");
        old["requires"]["blocks"] = json!(38);
        let app = parse_app_definition(&old.to_string()).expect("38판 loading 바인딩");
        assert_eq!(serde_json::to_value(&app).unwrap()["ui"]["loading"], loading);
        assert!(data::all_ui_bindings(&app).iter().any(|(pointer, _)| pointer == "/ui/loading"));
    }
    let mut invalid = chat_block();
    invalid["loading"] = json!({"client":"missing"});
    let error = parse_app_definition(&definition(38, invalid, client).to_string()).unwrap_err();
    assert!(error.details.iter().any(|detail| detail.contains("missing")), "{error:?}");
}

#[test]
fn chat_loading_is_in_chat_schema() {
    let schema = app_definition_schema();
    let text = schema.to_string();
    let value: Value = serde_json::from_str(&text).unwrap();
    fn chat_has_loading(value: &Value) -> bool {
        match value {
            Value::Object(map) => {
                let properties = map.get("properties");
                let is_chat = properties.and_then(|p| p.get("type")).is_some_and(|kind|
                    kind.get("const") == Some(&json!("chat")) || kind.get("enum") == Some(&json!(["chat"])));
                (is_chat && properties.is_some_and(|p| p.get("loading").is_some()))
                    || map.values().any(chat_has_loading)
            }
            Value::Array(values) => values.iter().any(chat_has_loading),
            _ => false,
        }
    }
    assert!(chat_has_loading(&value), "chat schema에 loading이 없다");
}
