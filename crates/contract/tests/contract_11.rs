use kaleidoscope_contract::{
    app_storage::{
        storage_key_matches, validate_storage_upgrade, JsonValueType, StorageDecl, StorageKind,
        StorageSchemaType, StorageWriteRequest, StoredStorageEntry,
    },
    validate::parse_app_definition,
    CoreReply, CoreRequest, ErrorCode,
};
use serde_json::{json, Value};
use ts_rs::{Config, TS};

fn workspace_pas_v2() -> Value {
    serde_json::from_str(include_str!("../../../examples/workspace-pas-v2.json")).unwrap()
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
fn legacy_agent_wire_shapes_remain_unchanged() {
    for request in [
        json!({"op":"agent.get","workspace_id":"w"}),
        json!({"op":"agent.create","workspace_id":"w","model_preset":"model"}),
        json!({"op":"agent.send","workspace_id":"w","text":"안녕","attachments":[]}),
        json!({"op":"agent.attachment","workspace_id":"w","item_id":"7","index":0}),
        json!({"op":"agent.attachment_open","workspace_id":"w","item_id":"7","index":0}),
    ] {
        let parsed: CoreRequest = serde_json::from_value(request.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), request);
    }
    let agent = json!({"workspace_id":"w","model_preset":"model","model_label":"Model","busy":false,"tool":null,"created_at":"2026-10-30"});
    for reply in [
        json!({"op":"agent.get","agent":agent,"items":[],"models":[{"preset":"model","label":"Model"}]}),
        json!({"op":"agent.create","agent":agent}),
        json!({"op":"agent.send"}),
        json!({"op":"agent.attachment","name":"그림.png","mime":"image/png","data_base64":"aGk="}),
        json!({"op":"agent.attachment_open"}),
    ] {
        let parsed: CoreReply = serde_json::from_value(reply.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), reply);
    }
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
        "models":[{"id":"model-1","label":"Model 1","available":true}]
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
        json!({"op":"conversation.history","window_id":"window-1","before":"cursor-0"}),
        json!({"op":"conversation.create","window_id":"window-1","model":"model-1"}),
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
