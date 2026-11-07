use kaleidoscope_contract::validate::parse_app_definition;
use kaleidoscope_data::{CompiledApp, Env, Step};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn map(value: Value) -> BTreeMap<String, Value> {
    serde_json::from_value(value).unwrap()
}

fn app() -> CompiledApp {
    let definition = parse_app_definition(
        &json!({
            "id":"shell-test", "name":"쉘 시험",
            "requires":{"blocks":43,"modules":{"shell":1}},
            "state":{"selected":"notes"},
            "ui":{"type":"stack","direction":"column","children":[
                {"type":"button","label":"열기","on_click":[{"shell.open":{"app_id":{"state":"selected"}}}]},
                {"type":"button","label":"추가","on_click":[{"shell.add_shortcut":{"app_id":{"state":"selected"}}}]},
                {"type":"button","label":"식","on_click":[{"shell.open":{"app_id":{"expr":"$state.selected"}}}]}
            ]}
        })
        .to_string(),
    )
    .unwrap();
    CompiledApp::compile(&definition)
}

fn env_of<'a>(
    state: &'a BTreeMap<String, Value>,
    empty: &'a BTreeMap<String, Value>,
    event: &'a Value,
) -> Env<'a> {
    Env {
        state,
        data: empty,
        data_meta: empty,
        storage: empty,
        storage_meta: empty,
        apps: None,
        event,
        item: event,
        modifiers: None,
    }
}

#[test]
fn shell_steps_read_app_id_from_state_and_expr() {
    let app = app();
    let state = map(json!({"selected":"notes"}));
    let empty = BTreeMap::new();
    let event = Value::Null;
    let env = env_of(&state, &empty, &event);
    assert_eq!(
        app.action_step("/ui/children/0/on_click", 0, &env).unwrap(),
        Step::ShellOpen { app_id: "notes".into() }
    );
    assert_eq!(
        app.action_step("/ui/children/1/on_click", 0, &env).unwrap(),
        Step::ShellAddShortcut { app_id: "notes".into() }
    );
    assert_eq!(
        app.action_step("/ui/children/2/on_click", 0, &env).unwrap(),
        Step::ShellOpen { app_id: "notes".into() }
    );
}

#[test]
fn shell_steps_reject_non_string_and_empty_app_ids() {
    let app = app();
    let empty = BTreeMap::new();
    let event = Value::Null;
    for (selected, id) in [
        (json!(5), "DATA_SHELL_OPEN_APP_ID_INVALID"),
        (json!(""), "DATA_SHELL_OPEN_APP_ID_INVALID"),
        (json!(null), "DATA_SHELL_OPEN_APP_ID_INVALID"),
    ] {
        let state = map(json!({"selected":selected}));
        let env = env_of(&state, &empty, &event);
        let error = app.action_step("/ui/children/0/on_click", 0, &env).unwrap_err();
        assert_eq!(error.id.as_deref(), Some(id));
    }
    let state = map(json!({"selected":5}));
    let env = env_of(&state, &empty, &event);
    let error = app.action_step("/ui/children/1/on_click", 0, &env).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DATA_SHELL_SHORTCUT_APP_ID_INVALID"));
    assert!(error.message.contains("받은 값: 5"));

    let missing = BTreeMap::new();
    let env = env_of(&missing, &empty, &event);
    let error = app.action_step("/ui/children/0/on_click", 0, &env).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DATA_SHELL_OPEN_APP_ID_INVALID"));
}
