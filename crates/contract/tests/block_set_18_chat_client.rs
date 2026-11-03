use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition};
use serde_json::{Value, json};

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
    assert!(
        bindings
            .iter()
            .any(|(pointer, _)| pointer == "/ui/footer/value")
    );

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
    assert!(
        error.details.iter().any(|detail| detail.contains("client")),
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
