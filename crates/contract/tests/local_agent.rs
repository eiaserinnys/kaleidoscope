use kaleidoscope_contract::{
    local_agent::{agent_spec_hash, validate_agent_specs},
    validate::parse_app_definition,
    ErrorCode,
};
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id": "local-agent-contract-test",
        "name": "로컬 에이전트 계약 시험",
        "requires": {
            "blocks": 8,
            "modules": { "local_agent": 1, "files": 1 }
        },
        "permissions": [
            { "module": "local_agent", "id": "run", "label": "에이전트 실행" },
            { "module": "files", "id": "work", "access": "readwrite", "label": "작업 폴더" }
        ],
        "state": { "agent_id": null },
        "ui": {
            "type": "agent_session",
            "permission": "run",
            "root": { "permission": "work" },
            "agents": [
                { "id": "codex", "name": "Codex", "command": "codex", "args": [], "env": {} }
            ],
            "selected": { "state": "agent_id" },
            "on_select": { "set_state": "agent_id" }
        }
    })
}

fn assert_invalid(definition: Value) {
    let error = parse_app_definition(&definition.to_string()).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
}

#[test]
fn agent_session_definition_passes_contract_validation() {
    assert!(parse_app_definition(&definition().to_string()).is_ok());
}

#[test]
fn example_agent_definition_passes_contract_validation() {
    let app: Value = serde_json::from_str(include_str!("../../../examples/agent.json")).unwrap();
    assert!(parse_app_definition(&app.to_string()).is_ok());
}

#[test]
fn agent_session_requires_local_agent_module() {
    let mut app = definition();
    app["requires"]["modules"] = json!({ "files": 1 });
    assert_invalid(app);
}

#[test]
fn agent_session_requires_local_agent_permission() {
    let mut app = definition();
    app["permissions"][0] = json!({
        "module": "connection",
        "id": "run",
        "connection": "agent-service",
        "access": "read",
        "label": "에이전트 실행"
    });
    app["requires"]["modules"]["connection"] = json!(2);
    assert_invalid(app);
}

#[test]
fn agent_session_root_requires_folder_readwrite_permission() {
    for (access, scope) in [("read", "folder"), ("readwrite", "pc")] {
        let mut app = definition();
        app["permissions"][1]["access"] = json!(access);
        if scope == "pc" {
            app["permissions"][1]["scope"] = json!(scope);
            app["requires"]["modules"]["files"] = json!(2);
        }
        assert_invalid(app);
    }
}

#[test]
fn agent_session_selection_and_update_must_use_same_state_key() {
    let mut app = definition();
    app["ui"]["on_select"]["set_state"] = json!("another_key");
    app["state"]["another_key"] = Value::Null;
    assert_invalid(app);
}

#[test]
fn app_may_have_only_one_agent_session_block() {
    let mut app = definition();
    app["ui"] = json!({
        "type": "stack",
        "direction": "column",
        "children": [definition()["ui"].clone(), definition()["ui"].clone()]
    });
    assert_invalid(app);
}

#[test]
fn agent_session_requires_block_set_eight() {
    let mut app = definition();
    app["requires"]["blocks"] = json!(7);
    assert_invalid(app);
}

#[test]
fn agent_spec_parser_rejects_unknown_fields_and_invalid_values() {
    let unknown = json!([{
        "id": "codex", "name": "Codex", "command": "codex", "args": [], "env": {}, "extra": true
    }]);
    assert!(validate_agent_specs(&unknown).is_err());

    let duplicate = json!([
        { "id": "codex", "name": "Codex", "command": "codex", "args": [], "env": {} },
        { "id": "codex", "name": "Other", "command": "other", "args": [], "env": {} }
    ]);
    assert!(validate_agent_specs(&duplicate).is_err());

    let invalid_env = json!([{
        "id": "codex", "name": "Codex", "command": "codex", "args": [], "env": { "bad-name": "x" }
    }]);
    assert!(validate_agent_specs(&invalid_env).is_err());

    let empty_required_value = json!([{
        "id": "codex", "name": "Codex", "command": " ", "args": [], "env": {}
    }]);
    assert!(validate_agent_specs(&empty_required_value).is_err());

    let nul = json!([{
        "id": "codex", "name": "Codex", "command": format!("codex{}", '\0'), "args": [], "env": {}
    }]);
    assert!(validate_agent_specs(&nul).is_err());
}

#[test]
fn agent_execution_hash_is_canonical_and_excludes_id_and_auth_methods() {
    let first = json!([{
        "id": "one", "name": "Agent", "command": "run", "args": ["a", "b"],
        "env": { "B": "2", "A": "1" }, "auth_methods": ["oauth"]
    }]);
    let second = json!([{
        "id": "two", "name": "Agent", "command": "run", "args": ["a", "b"],
        "env": { "A": "1", "B": "2" }, "auth_methods": ["api"]
    }]);
    let a = validate_agent_specs(&first).unwrap();
    let b = validate_agent_specs(&second).unwrap();
    assert_eq!(agent_spec_hash(&a[0]), agent_spec_hash(&b[0]));

    let reordered_args = json!([{
        "id": "one", "name": "Agent", "command": "run", "args": ["b", "a"], "env": {}
    }]);
    let original = json!([{
        "id": "one", "name": "Agent", "command": "run", "args": ["a", "b"], "env": {}
    }]);
    assert_ne!(
        agent_spec_hash(&validate_agent_specs(&original).unwrap()[0]),
        agent_spec_hash(&validate_agent_specs(&reordered_args).unwrap()[0])
    );
}
