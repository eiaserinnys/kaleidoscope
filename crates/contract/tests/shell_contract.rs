use kaleidoscope_contract::{app_definition_schema, validate::parse_app_definition};
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id":"shell-test", "name":"쉘 시험",
        "requires":{"blocks":43,"modules":{"shell":1}},
        "state":{"selected":"example"},
        "ui":{"type":"toolbar","start":[],"end":[
            {
                "type":"button","label":"바탕화면에 추가",
                "on_click":[{"shell.add_shortcut":{"app_id":{"state":"selected"}}}]
            },
            {
                "type":"button","label":"열기","variant":"primary",
                "on_click":[{"shell.open":{"app_id":{"state":"selected"}}}]
            }
        ]}
    })
}

#[test]
fn shell_actions_roundtrip_and_are_valid() {
    let value = definition();
    let parsed = parse_app_definition(&value.to_string()).unwrap();
    let roundtrip = serde_json::to_value(&parsed).unwrap();
    for index in 0..2 {
        assert_eq!(
            roundtrip["ui"]["end"][index]["on_click"],
            value["ui"]["end"][index]["on_click"]
        );
    }
    let schema = app_definition_schema().to_string();
    assert!(schema.contains("shell.open"));
    assert!(schema.contains("shell.add_shortcut"));
}

#[test]
fn shell_actions_require_the_shell_module() {
    let mut no_module = definition();
    no_module["requires"]["modules"] = json!({"storage":1});
    assert_eq!(
        parse_app_definition(&no_module.to_string())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_SHELL_MODULE_REQUIRED")
    );
    let mut plain = definition();
    plain["requires"]["modules"] = json!({});
    plain["ui"] = json!({"type":"button","label":"열기","on_click":[{"set_state":"selected"}]});
    parse_app_definition(&plain.to_string()).unwrap();
}

#[test]
fn current_shell_supports_shell_two_and_rejects_newer_versions() {
    parse_app_definition(&definition().to_string()).unwrap();
    let mut newer = definition();
    newer["requires"]["modules"]["shell"] = json!(2);
    parse_app_definition(&newer.to_string()).unwrap();
    newer["requires"]["modules"]["shell"] = json!(3);
    assert_eq!(
        parse_app_definition(&newer.to_string())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_DEFINITION_REQUIRES_NEWER_SHELL")
    );
}
