use kaleidoscope_contract::{
    app_storage::{
        storage_key_matches, validate_storage_upgrade, JsonValueType, StorageDecl, StorageKind,
        StorageSchemaType, StorageWriteRequest, StoredStorageEntry,
    },
    data,
    validate::parse_app_definition,
    CoreReply, CoreRequest, ErrorCode,
};
use serde_json::{json, Value};
use ts_rs::{Config, TS};

fn workspace_pas_v2() -> Value {
    serde_json::from_str(include_str!("../../../examples/workspace-pas-v2.json")).unwrap()
}

#[test]
fn agent_settings_reject_window_state_and_runtime_variables() {
    for field in [
        "namespace",
        "profile",
        "collection",
        "model_order",
        "selected_model",
        "title_template",
        "initial_instruction_template",
        "instructions_template",
    ] {
        for binding in [
            json!({"state":"choice"}),
            json!({"expr":"$state.choice"}),
            json!({"expr":"$data.choice"}),
            json!({"expr":"$event.choice"}),
            json!({"expr":"$item.choice"}),
        ] {
            let mut definition = workspace_pas_v2();
            definition["state"] = json!({"choice":"value"});
            definition["agent"][field] = binding.clone();
            let error = parse_app_definition(&definition.to_string())
                .expect_err(&format!("{field}: {binding}"));
            assert!(
                error.details.iter().any(|detail| detail
                    .contains("대화 설정은 창마다 다를 수 없으니 저장소 항목으로 선언하라")),
                "{field}: {binding}: {error:?}"
            );
        }
    }
}

#[test]
fn agent_expression_allows_storage_and_variable_names_in_string_literals() {
    let mut definition = workspace_pas_v2();
    definition["agent"]["instructions_template"] =
        json!({"expr":"$storage.role & ' $state $data $event $item'"});
    assert!(parse_app_definition(&definition.to_string()).is_ok());
}

#[test]
fn agent_json_schema_excludes_state_bindings_and_describes_expression_scope() {
    let schema = kaleidoscope_contract::app_definition_schema();
    let provider = &schema["$defs"]["AgentProvider"]["properties"];
    for field in [
        "namespace",
        "profile",
        "collection",
        "model_order",
        "selected_model",
        "title_template",
        "initial_instruction_template",
        "instructions_template",
    ] {
        assert_eq!(
            provider[field]["not"]["required"],
            json!(["state"]),
            "{field}"
        );
        assert!(
            provider[field]["description"]
                .as_str()
                .unwrap()
                .contains("$storage"),
            "{field}"
        );
    }
}

#[test]
fn agent_typescript_exposes_a_storage_only_binding_type() {
    let provider = <kaleidoscope_contract::AgentProvider as TS>::decl(&Config::new());
    for field in [
        "namespace",
        "profile",
        "collection",
        "model_order",
        "selected_model",
        "title_template",
        "initial_instruction_template",
        "instructions_template",
    ] {
        assert!(
            provider.contains(&format!("{field}: AgentBinding")),
            "{field}: {provider}"
        );
    }
}

#[test]
fn contract_11_workspace_pas_example_accepts_storage_provider_and_document() {
    let definition = workspace_pas_v2();
    let parsed = parse_app_definition(&definition.to_string());
    assert!(
        parsed.is_ok(),
        "contract 11 app definition rejected: {parsed:?}"
    );
    let role_document = include_str!("../../../examples/workspace-pas-role.md");
    assert!(role_document.starts_with("이 작업의 목적"));
}

#[test]
fn collection_document_refs_and_actions_require_a_document_path() {
    let mut definition = workspace_pas_v2();
    definition.as_object_mut().unwrap().remove("agent");
    definition["requires"]["modules"]["storage"] = json!(3);
    definition["storage"]["entries"] = json!([{
        "id":"docs", "key":"documents", "kind":"md", "collection":true,
        "default":"", "label":"문서", "presentation":"hidden"
    }]);
    definition["state"]["current_doc"] = json!("draft.md");
    definition["ui"] = json!({
        "type":"button", "label":"저장", "on_click":[{
            "set_storage":{"entry":"docs","doc":{"state":"current_doc"},"value":{"expr":"$event"}}
        }]
    });
    assert!(parse_app_definition(&definition.to_string()).is_ok());

    definition["ui"]["children"] = json!([{
        "type":"markdown", "document":{"entry":"docs"}
    }]);
    definition["ui"] =
        json!({"type":"stack","direction":"column","children":definition["ui"]["children"]});
    let missing_doc = parse_app_definition(&definition.to_string()).unwrap_err();
    assert!(missing_doc
        .details
        .iter()
        .any(|detail| detail.contains("doc이 필요합니다")));

    definition["ui"]["children"][0]["document"]["doc"] = json!("../draft.md");
    assert!(parse_app_definition(&definition.to_string()).is_err());
}

#[test]
fn collection_documents_are_not_available_through_storage_expressions() {
    let mut definition = workspace_pas_v2();
    definition.as_object_mut().unwrap().remove("agent");
    definition["requires"]["modules"]["storage"] = json!(3);
    definition["storage"]["entries"] = json!([{
        "id":"docs", "key":"documents", "kind":"md", "collection":true,
        "default":"", "label":"문서", "presentation":"hidden"
    }]);
    definition["ui"] = json!({
        "type":"button", "label":"저장", "on_click":[{
            "set_storage":{"entry":"docs","doc":"draft.md","value":{"expr":"$storage.docs"}}
        }]
    });
    let error = parse_app_definition(&definition.to_string()).unwrap_err();
    assert!(error
        .details
        .iter()
        .any(|detail| detail.contains("문서 모음은 $storage 식에 포함되지 않습니다")));
}

#[test]
fn settings_entry_accepts_description_and_dynamic_choices_binding() {
    let mut definition = workspace_pas_v2();
    definition["requires"]["modules"]["storage"] = json!(2);
    definition["storage"]["entries"][0]["description"] =
        json!("대화 제공자에서 가져온 프로필입니다.");
    definition["storage"]["entries"][3]["choices"] = json!({"expr":"$data.models"});
    definition["sources"]["models"] = json!({
        "kind":"request", "permission":"conversation", "path":"/models"
    });

    let parsed = parse_app_definition(&definition.to_string()).expect("설정 설명과 선택지");
    let pointer = "/storage/entries/3/choices";
    assert!(data::ui_bindings(&parsed)
        .iter()
        .any(|(at, _)| at == pointer));
    assert!(data::all_exprs(&parsed)
        .iter()
        .any(|(at, expr)| at == pointer && *expr == "$data.models"));
}

#[test]
fn settings_description_rejects_blank_multiline_and_over_120_characters() {
    for description in [
        "  ".to_owned(),
        "첫 줄\n둘째 줄".to_owned(),
        "가".repeat(121),
    ] {
        let mut definition = workspace_pas_v2();
        definition["requires"]["modules"]["storage"] = json!(2);
        definition["storage"]["entries"][0]["description"] = json!(description);
        let error = parse_app_definition(&definition.to_string()).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
        assert!(error
            .details
            .iter()
            .any(|detail| detail.contains("description")));
    }
}

#[test]
fn literal_storage_choices_accept_strings_and_labeled_strings_only() {
    for choices in [
        json!(["default", {"value":"fast", "label":"빠른 모델"}]),
        json!(["only"]),
        json!("single"),
        json!({"value":"labeled"}),
    ] {
        let mut definition = workspace_pas_v2();
        definition["requires"]["modules"]["storage"] = json!(2);
        definition["storage"]["entries"][0]["choices"] = choices;
        assert!(parse_app_definition(&definition.to_string()).is_ok());
    }

    for choices in [
        json!(["valid", 3]),
        json!([{"label":"이름만 있음"}]),
        json!([{"value":3}]),
        json!([{"value":"x", "label":3}]),
        json!([{"value":"x", "extra":true}]),
    ] {
        let mut definition = workspace_pas_v2();
        definition["requires"]["modules"]["storage"] = json!(2);
        definition["storage"]["entries"][0]["choices"] = choices;
        assert!(parse_app_definition(&definition.to_string()).is_err());
    }
}

#[test]
fn settings_json_schema_only_accepts_scalar_and_string_array_controls() {
    for (schema, default) in [
        (json!({"type":"boolean"}), json!(true)),
        (json!({"type":["boolean","null"]}), Value::Null),
        (json!({"type":"number","enum":[1,2]}), json!(1)),
        (json!({"type":"integer"}), json!(2)),
        (
            json!({"type":"array","items":{"type":"string"}}),
            json!(["a"]),
        ),
    ] {
        let mut definition = workspace_pas_v2();
        definition["storage"]["entries"][0]["schema"] = schema;
        definition["storage"]["entries"][0]["default"] = default;
        assert!(parse_app_definition(&definition.to_string()).is_ok());
    }

    for (schema, default) in [
        (
            json!({"type":"object","properties":{"name":{"type":"string"}}}),
            json!({}),
        ),
        (
            json!({"type":"array","items":{"type":"integer"}}),
            json!([]),
        ),
        (json!({"type":["string","null","boolean"]}), Value::Null),
    ] {
        let mut definition = workspace_pas_v2();
        definition["storage"]["entries"][0]["schema"] = schema;
        definition["storage"]["entries"][0]["default"] = default;
        let error = parse_app_definition(&definition.to_string()).unwrap_err();
        assert!(error.details.iter().any(|detail| detail.contains("hidden")));
    }

    let mut hidden_object = workspace_pas_v2();
    hidden_object["storage"]["entries"][7]["presentation"] = json!("hidden");
    assert!(parse_app_definition(&hidden_object.to_string()).is_ok());
}

#[test]
fn choices_require_a_settings_json_string_or_string_array_entry() {
    let invalid = [
        ("md", "settings", json!({"type":"string"})),
        ("json", "hidden", json!({"type":"string"})),
        ("json", "settings", json!({"type":"boolean"})),
        (
            "json",
            "settings",
            json!({"type":"array","items":{"type":"integer"}}),
        ),
    ];
    for (kind, presentation, schema) in invalid {
        let mut definition = workspace_pas_v2();
        definition["requires"]["modules"]["storage"] = json!(2);
        let entry = &mut definition["storage"]["entries"][0];
        entry["kind"] = json!(kind);
        entry["presentation"] = json!(presentation);
        entry["schema"] = schema;
        entry["default"] = json!("default");
        entry["choices"] = json!(["a"]);
        assert!(parse_app_definition(&definition.to_string()).is_err());
    }
}

#[test]
fn settings_fields_require_storage_module_two_and_legacy_entries_stay_at_one() {
    let unchanged = workspace_pas_v2();
    assert!(parse_app_definition(&unchanged.to_string()).is_ok());

    for (field, value) in [
        ("description", json!("보조 설명")),
        ("choices", json!(["default"])),
    ] {
        let mut definition = workspace_pas_v2();
        definition["storage"]["entries"][0][field] = value;
        let error = parse_app_definition(&definition.to_string()).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
        assert!(error
            .details
            .iter()
            .any(|detail| detail.contains("storage 모듈 2판")));

        definition["requires"]["modules"]["storage"] = json!(2);
        let accepted = parse_app_definition(&definition.to_string());
        assert!(accepted.is_ok(), "{field}: {accepted:?}");
    }
}

#[test]
fn storage_schema_unknown_keyword_is_rejected() {
    let mut definition = workspace_pas_v2();
    definition["storage"]["entries"][0]["schema"]["pattern"] = json!(".*");
    let error = parse_app_definition(&definition.to_string()).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
    assert!(error
        .details
        .iter()
        .any(|detail| detail.contains("pattern")));
}

#[test]
fn provider_template_rejects_placeholders_outside_workspace_id_and_name() {
    let mut definition = workspace_pas_v2();
    definition["storage"]["entries"][4]["default"] = json!("작업 {workspace.owner}");
    let error = parse_app_definition(&definition.to_string()).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
    assert!(error
        .details
        .iter()
        .any(|detail| detail.contains("workspace.id")));
}

#[test]
fn storage_key_rejects_unsupported_placeholder_and_empty_segments() {
    for key in [
        "workspaces/{desktop_id}/thread",
        "settings//profile",
        "settings/../profile",
    ] {
        let mut definition = workspace_pas_v2();
        definition["storage"]["entries"][0]["key"] = json!(key);
        let error = parse_app_definition(&definition.to_string()).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidAppDefinition, "{key}");
    }
}

#[test]
fn markdown_editor_rejects_both_file_and_document() {
    let mut definition = workspace_pas_v2();
    definition["permissions"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "module":"files", "id":"docs", "access":"readwrite", "label":"문서"
        }));
    definition["ui"]["children"][0] = json!({
        "type":"markdown_editor", "file":{"permission":"docs", "path":"role.md"},
        "document":{"entry":"role"}
    });
    let error = parse_app_definition(&definition.to_string()).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
}

#[test]
fn agent_rejects_missing_or_non_workspace_thread_entry() {
    let mut definition = workspace_pas_v2();
    definition["agent"]["thread_entry"] = json!("missing");
    assert!(parse_app_definition(&definition.to_string()).is_err());

    let mut definition = workspace_pas_v2();
    definition["storage"]["entries"][7]["key"] = json!("settings/thread");
    assert!(parse_app_definition(&definition.to_string()).is_err());
}

fn stored_thread() -> (StorageDecl, StoredStorageEntry) {
    let definition = workspace_pas_v2();
    let storage: StorageDecl = serde_json::from_value(definition["storage"].clone()).unwrap();
    let stored = StoredStorageEntry {
        entry_id: "thread".into(),
        key: "workspaces/ws-1/thread".into(),
        kind: StorageKind::Json,
        content: json!({
            "connection": "conversation",
            "namespace": "account-app",
            "external_key": "ws-1",
            "thread_id": "thread-1",
            "created_at": "2026-10-30T00:00:00Z"
        }),
    };
    (storage, stored)
}

#[test]
fn storage_upgrade_accepts_same_declaration_with_resolved_workspace_key() {
    let (previous, stored) = stored_thread();
    assert!(storage_key_matches(
        "workspaces/{workspace_id}/thread",
        &stored.key
    ));
    assert!(validate_storage_upgrade(&previous, &previous, &[stored]).is_empty());
}

#[test]
fn storage_upgrade_allows_adding_an_entry_while_workspace_values_exist() {
    let (previous, stored) = stored_thread();
    let mut next = previous.clone();
    next.entries.push(
        serde_json::from_value(json!({
            "id":"new_setting",
            "key":"settings/new-setting",
            "kind":"json",
            "schema":{"type":"string"},
            "default":"ready",
            "label":"New setting",
            "presentation":"settings"
        }))
        .unwrap(),
    );
    assert!(validate_storage_upgrade(&previous, &next, &[stored]).is_empty());
}

#[test]
fn storage_upgrade_rejects_kind_key_template_and_json_type_changes() {
    let (previous, stored) = stored_thread();

    let mut changed_kind = previous.clone();
    let thread = changed_kind
        .entries
        .iter_mut()
        .find(|entry| entry.id == "thread")
        .unwrap();
    thread.kind = StorageKind::Md;
    assert!(!validate_storage_upgrade(&previous, &changed_kind, &[stored.clone()]).is_empty());
    assert!(!validate_storage_upgrade(&previous, &changed_kind, &[]).is_empty());

    let mut changed_key = previous.clone();
    changed_key
        .entries
        .iter_mut()
        .find(|entry| entry.id == "thread")
        .unwrap()
        .key = "workspaces/{workspace_id}/conversation".into();
    assert!(!validate_storage_upgrade(&previous, &changed_key, &[stored.clone()]).is_empty());
    assert!(!validate_storage_upgrade(&previous, &changed_key, &[]).is_empty());

    let mut changed_type = previous.clone();
    changed_type
        .entries
        .iter_mut()
        .find(|entry| entry.id == "thread")
        .unwrap()
        .schema
        .as_mut()
        .unwrap()
        .value_type = StorageSchemaType::One(JsonValueType::Object);
    assert!(!validate_storage_upgrade(&previous, &changed_type, &[stored]).is_empty());
    assert!(!validate_storage_upgrade(&previous, &changed_type, &[]).is_empty());
}

#[test]
fn storage_upgrade_rejects_rows_that_fail_the_new_key_or_schema() {
    let (previous, mut stored) = stored_thread();
    stored.key = "workspaces/ws-1/other".into();
    assert!(!validate_storage_upgrade(&previous, &previous, &[stored.clone()]).is_empty());

    stored.key = "workspaces/ws-1/thread".into();
    stored.content = json!({"thread_id":"thread-1"});
    assert!(!validate_storage_upgrade(&previous, &previous, &[stored]).is_empty());
}

#[test]
fn storage_key_template_matches_exactly_one_concrete_workspace_segment() {
    assert!(storage_key_matches(
        "workspaces/{workspace_id}/thread",
        "workspaces/ws-1/thread"
    ));
    assert!(!storage_key_matches(
        "workspaces/{workspace_id}/thread",
        "workspaces/ws-1/nested/thread"
    ));
    assert!(!storage_key_matches(
        "workspaces/{workspace_id}/thread",
        "workspaces//thread"
    ));
}

#[test]
fn conversation_get_uses_thread_and_conversation_items() {
    let provider_reply = json!({
        "op":"conversation.get",
        "thread":{
            "id":"thread-1",
            "external":{"namespace":"bucket-1","key":"ws-1"},
            "title":"작업",
            "model":{"id":"model-1","label":"Model 1"},
            "created_at":"2026-10-30T00:00:00Z",
            "archived":false
        },
        "items":[{
            "id":"item-1",
            "kind":"user",
            "text":"attached",
            "at":"2026-10-30T00:00:00Z",
            "attachments":[{"id":"attachment-1","name":"image.png","mime":"image/png"}]
        }],
        "cursor":"cursor-1",
        "next_before":"cursor-0",
        "models":[{"id":"model-1","label":"Model 1","available":true}],
        "profiles":[{"id":"profile-1","label":"Profile 1","available":true}],
        "start":{"profile":"profile-1","model":"model-1"}
    });
    let parsed: CoreReply = serde_json::from_value(provider_reply.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), provider_reply);

    let mut empty_reply = provider_reply;
    empty_reply["thread"] = Value::Null;
    let parsed: CoreReply = serde_json::from_value(empty_reply.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), empty_reply);
}

#[test]
fn conversation_commands_and_replies_round_trip() {
    for request in [
        json!({"op":"conversation.get","window_id":"window-1"}),
        json!({"op":"conversation.get","window_id":"window-1","profile":"profile-1"}),
        json!({"op":"conversation.history","window_id":"window-1","before":"cursor-0"}),
        json!({"op":"conversation.create","window_id":"window-1","model":"model-1"}),
        json!({"op":"conversation.create","window_id":"window-1","model":"model-1","profile":"profile-1"}),
        json!({"op":"conversation.switch","window_id":"window-1","profile":"profile-1","model":"model-1"}),
        json!({"op":"conversation.send","window_id":"window-1","request_id":"request-1","text":"안녕","attachments":[{"name":"그림.png","mime":"image/png","data_base64":"aGk="}]}),
        json!({"op":"conversation.attachment","window_id":"window-1","item_id":"item-1","attachment_id":"attachment-1"}),
        json!({"op":"conversation.attachment_open","window_id":"window-1","item_id":"item-1","attachment_id":"attachment-1"}),
    ] {
        let parsed: CoreRequest = serde_json::from_value(request.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), request);
    }
    for reply in [
        json!({"op":"conversation.history","items":[],"next_before":"cursor-0"}),
        json!({"op":"conversation.create","thread":{"id":"t","external":{"namespace":"n","key":"k"},"title":"작업","model":{"id":"m","label":"M"},"created_at":"2026-10-30","archived":false}}),
        json!({"op":"conversation.switch","thread":{"id":"t","external":{"namespace":"n","key":"k"},"title":"작업","model":{"id":"m","label":"M"},"created_at":"2026-10-30","archived":false},"notices":["notice"]}),
        json!({"op":"conversation.send"}),
        json!({"op":"conversation.attachment","name":"그림.png","mime":"image/png","data_base64":"aGk="}),
        json!({"op":"conversation.attachment_open"}),
    ] {
        let parsed: CoreReply = serde_json::from_value(reply.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), reply);
    }
}

#[test]
fn storage_write_omitted_revision_means_null() {
    let omitted: StorageWriteRequest = serde_json::from_value(json!({"content":"text"})).unwrap();
    let explicit: StorageWriteRequest = serde_json::from_value(json!({
        "content":"text",
        "expected_revision":null
    }))
    .unwrap();
    assert_eq!(omitted, explicit);

    let generated = <StorageWriteRequest as TS>::decl(&Config::new());
    assert!(generated.contains("expected_revision?: ExpectedRevision"));
}
