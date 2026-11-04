use kaleidoscope_contract::{
    app_definition_schema, data, validate::parse_app_definition, BLOCK_SET_VERSION, CONTRACT_VERSION,
};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "copy-text-test", "name": "복사 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {"target": "https://example.com"}, "ui": ui
    })
}

fn copy_button(action: Value) -> Value {
    json!({"type": "button", "label": "복사", "icon": "copy", "on_click": action})
}

#[test]
fn copy_text_is_a_local_single_action_and_requires_block_set_eighteen() {
    assert_eq!(CONTRACT_VERSION, 32);
    assert!(BLOCK_SET_VERSION >= 18);
    let binding = json!({"expr": "$state.target"});
    for action in [
        json!({"copy_text": binding}),
        json!([{"copy_text": binding}]),
    ] {
        let parsed = parse_app_definition(&definition(copy_button(action), 18).to_string())
            .unwrap_or_else(|error| panic!("copy_text should parse: {error:?}"));
        let actions = data::all_ui_actions(&parsed);
        assert_eq!(actions.len(), 1);
        assert!(data::local_actions(actions[0].1));
        assert!(data::ui_actions(&parsed).is_empty());
    }

    let mixed = definition(
        copy_button(json!([
            {"copy_text": {"expr": "$state.target"}},
            {"set_state": "target", "value": "changed"}
        ])),
        18,
    );
    assert!(parse_app_definition(&mixed.to_string()).is_err());

    for action in [
        json!({"copy_text": {"expr": "$state.target"}}),
        json!([{"copy_text": {"expr": "$state.target"}}]),
    ] {
        let old = definition(copy_button(action), 17);
        assert!(parse_app_definition(&old.to_string()).is_err());
    }
}

#[test]
fn generated_schema_exposes_the_copy_text_action() {
    assert!(app_definition_schema().to_string().contains("copy_text"));
}

#[test]
fn copy_text_expression_uses_the_action_binding_pointer() {
    let action = json!({"copy_text": {"expr": "$state.target"}});
    for (action, expected) in [
        (action.clone(), "/ui/on_click/copy_text"),
        (json!([action]), "/ui/on_click/0/copy_text"),
    ] {
        let parsed = parse_app_definition(&definition(copy_button(action), 18).to_string())
            .unwrap_or_else(|error| panic!("copy_text should parse: {error:?}"));
        assert!(data::ui_bindings(&parsed).iter().any(|(pointer, binding)| {
            pointer == expected
                && serde_json::to_value(binding).unwrap() == json!({"expr":"$state.target"})
        }));
    }
}

#[test]
fn copy_text_is_limited_to_icon_button_clicks() {
    let action = json!({"copy_text": {"expr": "$state.target"}});
    parse_app_definition(&definition(copy_button(action.clone()), 18).to_string())
        .expect("icon button on_click should allow copy_text");

    let iconless = json!({"type":"button","label":"복사","on_click":action});
    assert!(parse_app_definition(&definition(iconless, 18).to_string()).is_err());

    let list = json!({"type":"list","items":[],"on_select":action});
    assert!(parse_app_definition(&definition(list, 18).to_string()).is_err());

    let mut shortcut = definition(json!({"type":"text","value":"내용"}), 18);
    shortcut["requires"]["modules"] = json!({"assets":1,"client":2});
    shortcut["assets"] = json!([{"id":"client-code","version":1}]);
    shortcut["client"] = json!({"runtime":"javascript","entry":{"id":"client-code","version":1}});
    shortcut["shortcuts"] = json!([
        {"code":"KeyC","modifiers":[],"action":action}
    ]);
    assert!(parse_app_definition(&shortcut.to_string()).is_err());
}
