use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::{json, Value};

fn definition(ui: Value) -> Value {
    json!({
        "id": "legacy-agent-test",
        "name": "옛 실행 계약 시험",
        "requires": { "blocks": 19, "modules": {} },
        "permissions": [],
        "state": { "agent_id": null },
        "ui": ui
    })
}

#[test]
fn removed_local_agent_definitions_are_rejected() {
    let legacy_chats = [
        ("permission", json!("run")),
        ("root", json!({ "permission": "work" })),
        ("agents", json!([])),
        ("selected", json!({ "state": "agent_id" })),
        ("on_select", json!({ "set_state": "agent_id" })),
    ]
    .map(|(field, value)| {
        let mut chat = json!({ "type": "chat" });
        chat[field] = value;
        definition(chat)
    });
    let legacy_alias = json!({
        "type": "agent_session",
        "permission": "run",
        "root": { "permission": "work" },
        "agents": [],
        "selected": { "state": "agent_id" },
        "on_select": { "set_state": "agent_id" }
    });
    let mut old_module = definition(json!({ "type": "text", "value": "test" }));
    old_module["requires"]["modules"] = json!({ "local_agent": 1 });
    let mut old_permission = definition(json!({ "type": "text", "value": "test" }));
    old_permission["permissions"] = json!([
        { "module": "local_agent", "id": "run", "label": "실행" }
    ]);
    let old_block_alias = definition(legacy_alias);

    let cases = [
        (
            old_module,
            "APP_DEFINITION_REMOVED_LOCAL_AGENT_MODULE",
            "process 모듈",
        ),
        (
            old_permission,
            "APP_DEFINITION_REMOVED_LOCAL_AGENT_PERMISSION",
            "process 모듈",
        ),
        (
            old_block_alias,
            "APP_DEFINITION_REMOVED_AGENT_SESSION_BLOCK",
            "chat.client",
        ),
    ];
    for (legacy, id, replacement) in
        cases
            .into_iter()
            .chain(legacy_chats.into_iter().map(|legacy| {
                (
                    legacy,
                    "APP_DEFINITION_REMOVED_CHAT_LOCAL_FIELDS",
                    "chat.client",
                )
            }))
    {
        let error = parse_app_definition(&legacy.to_string())
            .expect_err("옛 실행 정의는 거부되어야 합니다");
        assert_eq!(error.id.as_deref(), Some(id), "{legacy}");
        assert!(error.message.contains(replacement), "{}", error.message);
    }
}
