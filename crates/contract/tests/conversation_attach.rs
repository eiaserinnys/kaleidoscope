use kaleidoscope_contract::conversation::{AdoptableConversation, ConversationStart};
use kaleidoscope_contract::validate::parse_app_definition;
use kaleidoscope_contract::{CoreReply, CoreRequest};
use serde_json::{json, Value};

fn definition(agent: u32, attached: bool) -> Value {
    let mut provider = json!({
        "protocol": "conversation-v1",
        "permission": "conversation",
        "base_path": "/api/conversations/v1",
        "namespace": "n",
        "profile": "p",
        "collection": "c",
        "model_order": ["model-a"],
        "selected_model": "",
        "title_template": "",
        "initial_instruction_template": "",
        "instructions_template": "",
        "thread_entry": "thread"
    });
    if attached {
        provider["attached_instructions_template"] = json!("{workspace.name}의 대화입니다.");
    }
    json!({
        "id": "attach-test",
        "name": "연결 시험",
        "requires": {"blocks": 6, "modules": {"agent": agent, "connection": 2, "storage": 1}},
        "permissions": [{"module": "connection", "id": "conversation", "connection": "conversation", "access": "readwrite", "label": "대화 제공자"}],
        "storage": {"entries": [{"id": "thread", "key": "workspaces/{workspace_id}/thread", "kind": "json", "schema": {"type": ["object", "null"]}, "default": null, "label": "대화", "presentation": "hidden", "agent_context": true}]},
        "agent": provider,
        "ui": {"type": "chat"}
    })
}

#[test]
fn attached_instructions_require_agent_four() {
    let mut value = definition(3, true);
    assert_eq!(
        parse_app_definition(&value.to_string())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_AGENT_ATTACHED_INSTRUCTIONS_VERSION_LOW")
    );
    value["requires"]["modules"]["agent"] = json!(4);
    let parsed = parse_app_definition(&value.to_string()).unwrap();
    assert!(parsed.agent.unwrap().attached_instructions_template.is_some());
    parse_app_definition(&definition(3, false).to_string()).unwrap();
}

#[test]
fn attach_and_detach_commands_use_window_and_thread() {
    let attach: CoreRequest = serde_json::from_value(
        json!({"op":"conversation.attach","window_id":"w","thread_id":"t"}),
    )
    .unwrap();
    assert!(matches!(
        attach,
        CoreRequest::ConversationAttach { ref window_id, ref thread_id }
            if window_id == "w" && thread_id == "t"
    ));
    assert_eq!(
        serde_json::to_value(CoreRequest::ConversationAttach {
            window_id: "w".into(),
            thread_id: "t".into()
        })
        .unwrap(),
        json!({"op":"conversation.attach","window_id":"w","thread_id":"t"})
    );
    let detach: CoreRequest =
        serde_json::from_value(json!({"op":"conversation.detach","window_id":"w"})).unwrap();
    assert!(matches!(detach, CoreRequest::ConversationDetach { ref window_id } if window_id == "w"));
    assert_eq!(
        serde_json::to_value(CoreRequest::ConversationDetach {
            window_id: "w".into()
        })
        .unwrap(),
        json!({"op":"conversation.detach","window_id":"w"})
    );

    let thread = json!({"id":"thread-1","external":{"namespace":"n","key":"k"},"title":"대화","model":{"id":"m","label":"모델"},"created_at":"2026-11-08T12:00:00Z","archived":false});
    let reply: CoreReply =
        serde_json::from_value(json!({"op":"conversation.attach","thread":thread})).unwrap();
    assert!(matches!(reply, CoreReply::ConversationAttach { .. }));
    assert_eq!(
        serde_json::to_value(reply).unwrap(),
        json!({"op":"conversation.attach","thread":thread})
    );
    assert_eq!(
        serde_json::to_value(CoreReply::ConversationDetach {}).unwrap(),
        json!({"op":"conversation.detach"})
    );
}

#[test]
fn conversation_get_reports_attached_own_and_adoptable() {
    let thread = json!({"id":"thread-1","external":{"namespace":"n","key":"k"},"title":"대화","model":{"id":"m","label":"모델"},"created_at":"2026-11-08T12:00:00Z","archived":false});
    let legacy: CoreReply = serde_json::from_value(json!({
        "op":"conversation.get","thread":null,"items":[],"cursor":"c",
        "models":[],"profiles":[],"start":{"profile":"p","model":"m"}
    }))
    .unwrap();
    match &legacy {
        CoreReply::ConversationGet {
            attached,
            own,
            adoptable,
            ..
        } => {
            assert!(!attached);
            assert!(own.is_none());
            assert!(adoptable.is_empty());
        }
        other => panic!("unexpected reply: {other:?}"),
    }
    assert!(serde_json::to_value(&legacy).unwrap().get("attached").is_none());

    let reply = CoreReply::ConversationGet {
        thread: None,
        items: vec![],
        cursor: "c".into(),
        next_before: None,
        models: vec![],
        profiles: vec![],
        start: ConversationStart {
            profile: "p".into(),
            model: Some("m".into()),
        },
        attached: true,
        own: Some(serde_json::from_value(thread.clone()).unwrap()),
        adoptable: vec![AdoptableConversation {
            id: "session-2".into(),
            title: String::new(),
            profile: None,
            model: None,
            updated_at: "2026-11-07T09:00:00.000Z".into(),
        }],
    };
    let value = serde_json::to_value(reply).unwrap();
    assert_eq!(value["attached"], json!(true));
    assert_eq!(value["own"], thread);
    assert_eq!(value["adoptable"][0]["id"], json!("session-2"));
    assert!(value["adoptable"][0].get("profile").is_none());
    assert!(value["adoptable"][0].get("model").is_none());
}

#[test]
fn attached_instructions_expression_is_compiled_and_checked_like_other_agent_fields() {
    // 식 모으기에서 이 필드가 빠져 운영 작업 PAS의 연결한 대화 보내기가 「없는 식」으로 거절됐다(카드 #1106).
    let mut value = definition(4, false);
    value["requires"]["modules"]["storage"] = json!(2);
    value["storage"]["entries"].as_array_mut().unwrap().push(json!({
        "id": "attached_role",
        "key": "instructions/attached-role",
        "kind": "md",
        "default": "",
        "label": "연결한 대화에 덧붙일 지시",
        "presentation": "settings"
    }));
    value["agent"]["attached_instructions_template"] = json!({"expr": "$storage.attached_role"});
    let parsed = parse_app_definition(&value.to_string()).unwrap();
    assert!(kaleidoscope_contract::data::all_exprs(&parsed)
        .iter()
        .any(|(pointer, expr)| pointer == "/agent/attached_instructions_template"
            && *expr == "$storage.attached_role"));

    value["agent"]["attached_instructions_template"] = json!({"expr": "$state.role"});
    let error = parse_app_definition(&value.to_string()).unwrap_err();
    assert!(
        error.details.iter().any(|detail| detail.contains("attached_instructions_template")
            && detail.contains("창마다 다를 수 없으니")),
        "{error:?}"
    );

    value["agent"]["attached_instructions_template"] = json!("{workspace.title}에서 보냈다");
    let error = parse_app_definition(&value.to_string()).unwrap_err();
    assert!(
        error.details.iter().any(|detail| detail.contains("attached_instructions_template")
            && detail.contains("{workspace.id}와 {workspace.name}만")),
        "{error:?}"
    );
}
