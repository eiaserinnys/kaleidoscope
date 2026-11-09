use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition, TREE_CHECK_BLOCK_SET_VERSION};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "tree-check-test", "name": "트리 확인 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {"picked": null}, "ui": ui
    })
}

fn tree() -> Value {
    json!({"type":"tree", "items":[
        {"key":"one", "title":"하나", "checked":true},
        {"key":"two", "title":"둘", "checked":false},
        {"key":"three", "title":"셋", "children":[{"key":"child", "title":"아이", "checked":true}]}
    ]})
}

#[test]
fn tree_check_fields_round_trip_and_expose_action_slot() {
    let mut ui = tree();
    ui["by"] = json!("children");
    ui["on_check"] = json!([{"set_state":"picked", "value":{"expr":"$item.key"}}]);
    ui["default_expanded"] = json!(true);
    let parsed = parse_app_definition(&definition(ui.clone(), TREE_CHECK_BLOCK_SET_VERSION).to_string()).unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(encoded["ui"], ui);
    assert!(data::all_ui_actions(&parsed)
        .iter()
        .any(|(pointer, _)| pointer == "/ui/on_check"));
    assert!(app_definition_schema().to_string().contains("\"on_check\""));
    assert!(app_definition_schema().to_string().contains("\"default_expanded\""));
}

#[test]
fn tree_check_omits_absent_fields() {
    let ui = json!({"type":"tree", "items":[{"key":"one", "title":"하나"}]});
    let parsed = parse_app_definition(&definition(ui, 4).to_string()).unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert!(encoded["ui"].get("on_check").is_none());
    assert!(encoded["ui"].get("default_expanded").is_none());
    assert!(encoded["ui"]["items"][0].get("checked").is_none());
    parse_app_definition(&definition(tree(), TREE_CHECK_BLOCK_SET_VERSION).to_string()).unwrap();
}

#[test]
fn tree_check_requires_block_set_version() {
    for field in ["on_check", "default_expanded"] {
        let mut ui = tree();
        ui[field] = if field == "on_check" { json!({"set_state":"picked"}) } else { json!(true) };
        assert_eq!(
            parse_app_definition(&definition(ui.clone(), TREE_CHECK_BLOCK_SET_VERSION - 1).to_string())
                .unwrap_err()
                .id
                .as_deref(),
            Some("APP_TREE_CHECK_VERSION_LOW"),
            "{field}"
        );
    }
    let mut ui = tree();
    ui["default_expanded"] = json!(false);
    parse_app_definition(&definition(ui, TREE_CHECK_BLOCK_SET_VERSION - 1).to_string()).unwrap();
}

#[test]
fn tree_check_rejects_folder_root_mode() {
    let folder_app = |ui: Value| {
        let mut value = definition(ui, TREE_CHECK_BLOCK_SET_VERSION);
        value["requires"]["modules"] = json!({"files": 1});
        value["permissions"] = json!([{"module":"files", "id":"docs", "access":"read", "label":"문서"}]);
        value
    };
    let root_tree = |extra: Value| {
        let mut ui = json!({"type":"tree", "root":{"permission":"docs"}, "selected":{"state":"picked"}, "on_select":{"set_state":"picked"}});
        if let Some(extra) = extra.as_object() {
            for (key, value) in extra {
                ui[key] = value.clone();
            }
        }
        ui
    };
    for field in ["on_check", "default_expanded"] {
        let extra = if field == "on_check" { json!({"on_check":{"set_state":"picked"}}) } else { json!({"default_expanded":true}) };
        assert_eq!(
            parse_app_definition(&folder_app(root_tree(extra)).to_string()).unwrap_err().id.as_deref(),
            Some("APP_TREE_CHECK_ROOT_UNSUPPORTED"),
            "{field}"
        );
    }
    parse_app_definition(&folder_app(root_tree(json!(null))).to_string()).unwrap();
}
