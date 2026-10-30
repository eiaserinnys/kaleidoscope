use kaleidoscope_contract::{validate::parse_app_definition, ErrorCode};
use serde_json::{json, Value};

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
