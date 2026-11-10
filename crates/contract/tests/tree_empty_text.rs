use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition, BLOCK_SET_VERSION};
use serde_json::{json, Value};

/// 데이터 트리의 빈 자리 글(empty_text)이 처음 들어온 블록 세트 판.
const V61: u32 = 61;

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "tree-empty-text-test", "name": "트리 빈 자리 글 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {"note": null}, "ui": ui
    })
}

#[test]
fn tree_empty_text_round_trips_and_exposes_binding() {
    assert!(BLOCK_SET_VERSION >= V61);
    let ui = json!({"type":"tree", "items":[], "empty_text":"아직 항목이 없습니다"});
    let parsed = parse_app_definition(&definition(ui.clone(), V61).to_string()).unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(encoded["ui"]["empty_text"], ui["empty_text"]);
    assert_eq!(encoded["ui"]["items"], ui["items"]);
    let bindings: Vec<String> = data::all_ui_bindings(&parsed)
        .into_iter()
        .map(|(pointer, _)| pointer)
        .collect();
    assert!(bindings.iter().any(|pointer| pointer == "/ui/empty_text"));
    let schema = app_definition_schema().to_string();
    assert!(schema.contains("\"empty_text\""));
}

#[test]
fn tree_empty_text_accepts_empty_string_and_expression() {
    for empty_text in [json!(""), json!({"expr": "$state.note"})] {
        let mut ui = json!({"type":"tree", "items":[]});
        ui["empty_text"] = empty_text;
        parse_app_definition(&definition(ui, V61).to_string()).unwrap();
    }
}

#[test]
fn tree_empty_text_is_optional() {
    let ui = json!({"type":"tree", "items":[]});
    let parsed = parse_app_definition(&definition(ui, 4).to_string()).unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert!(encoded["ui"].get("empty_text").is_none());
}

#[test]
fn tree_empty_text_requires_block_set_version() {
    let mut ui = json!({"type":"tree", "items":[]});
    ui["empty_text"] = json!("없습니다");
    assert_eq!(
        parse_app_definition(&definition(ui.clone(), V61 - 1).to_string())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_TREE_EMPTY_TEXT_VERSION_LOW")
    );
    parse_app_definition(&definition(ui, V61).to_string()).unwrap();
}
