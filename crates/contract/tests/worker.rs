use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::{json, Value};

fn definition() -> Value {
    json!({"id":"worker-test","name":"시험","requires":{"blocks":6,"modules":{"worker":1,"storage":1}},
        "permissions":[],"state":{},"ui":{"type":"text","value":"시험"},
        "storage":{"entries":[{"id":"enabled","key":"enabled","kind":"json","schema":{"type":"boolean"},"default":false,"label":"사용","presentation":"hidden"}]},
        "worker":{"runtime":"python3","code":"print('{}')","schedule":{"interval_secs":10,"enabled_entry":"enabled"},"watch_entries":["enabled"],"actions":["run"],"secrets":[{"id":"token"}]}})
}

#[test]
fn worker_declarations_are_validated() {
    let valid = definition();
    assert!(parse_app_definition(&valid.to_string()).is_ok());
    let mut invalid = valid.clone();
    invalid["id"] = json!("explorer");
    assert!(parse_app_definition(&invalid.to_string()).is_ok());
    invalid = valid.clone();
    invalid["storage"]["entries"][0]["default"] = json!(true);
    assert!(parse_app_definition(&invalid.to_string()).is_err());
    for (field, value) in [
        ("watch_entries", json!(["missing"])),
        ("actions", json!(["run", "run"])),
        ("secrets", json!([{"id":"bad id"}])),
    ] {
        invalid = valid.clone();
        invalid["worker"][field] = value;
        assert!(
            parse_app_definition(&invalid.to_string()).is_err(),
            "{field}"
        );
    }
}

#[test]
fn webhook_and_interapp_targets_are_validated() {
    let mut app = definition();
    app["worker"]["webhook"] = json!({"enabled_entry":"enabled", "token_secret":"token"});
    app["worker"]["calls"] = json!(["other-app"]);
    assert!(parse_app_definition(&app.to_string()).is_ok());
    for targets in [
        json!(["worker-test"]),
        json!(["other-app", "other-app"]),
        json!(["wrong id"]),
    ] {
        let mut invalid = app.clone();
        invalid["worker"]["calls"] = targets;
        assert!(parse_app_definition(&invalid.to_string()).is_err());
    }
    for webhook in [
        json!({"enabled_entry":"missing"}),
        json!({"token_secret":"missing"}),
    ] {
        let mut invalid = app.clone();
        invalid["worker"]["webhook"] = webhook;
        assert!(parse_app_definition(&invalid.to_string()).is_err());
    }
}

#[test]
fn ui_worker_action_requires_declared_worker_and_module() {
    let mut app = definition();
    app["ui"] = json!({"type":"button","label":"실행","on_click":[{"worker":{"action":"run","args":{"expr":"$event"}}}]});
    let parsed = parse_app_definition(&app.to_string()).unwrap();
    assert!(kaleidoscope_contract::data::ui_uses_worker_action(&parsed));
    assert!(kaleidoscope_contract::data::all_exprs(&parsed)
        .iter()
        .any(|(pointer, _)| pointer == "/ui/on_click/0/worker/args"));
    app["worker"]["actions"] = json!([]);
    assert!(parse_app_definition(&app.to_string()).is_err());
    app["worker"] = Value::Null;
    assert!(parse_app_definition(&app.to_string()).is_err());
}
