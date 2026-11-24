use kaleidoscope_contract::validate::parse_app_definition;
use kaleidoscope_contract::{
    BLOCK_SET_VERSION, CONTRACT_VERSION, ITEM_IMAGE_BLOCK_SET_VERSION, MODULE_VERSIONS,
};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "item-image-test", "name": "줄 그림과 모음 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {"picked": null}, "ui": ui
    })
}

fn agent_definition(agent: u32) -> Value {
    json!({
        "id": "item-image-agent-test",
        "name": "대화 모음 판 시험",
        "requires": {"blocks": 6, "modules": {"agent": agent, "connection": 2, "storage": 1}},
        "permissions": [{"module": "connection", "id": "conversation", "connection": "conversation", "access": "readwrite", "label": "대화 제공자"}],
        "storage": {"entries": [
            {"id": "thread", "key": "workspaces/{workspace_id}/thread", "kind": "json", "schema": {"type": ["object", "null"]}, "default": null, "label": "대화", "presentation": "hidden", "agent_context": true},
            {"id": "collection", "key": "settings/collection", "kind": "json", "schema": {"type": "string"}, "default": "default", "label": "모음", "presentation": "settings"}
        ]},
        "agent": {
            "protocol": "conversation-v1",
            "permission": "conversation",
            "base_path": "/api/conversations/v1",
            "namespace": "n",
            "profile": "p",
            "collection": {"expr": "$storage.collection"},
            "model_order": ["model-a"],
            "selected_model": "",
            "title_template": "",
            "initial_instruction_template": "",
            "instructions_template": "",
            "thread_entry": "thread"
        },
        "ui": {"type": "chat"}
    })
}

#[test]
fn item_image_is_the_current_block_set_and_contract_is_49() {
    assert!(BLOCK_SET_VERSION >= ITEM_IMAGE_BLOCK_SET_VERSION);
    assert_eq!(ITEM_IMAGE_BLOCK_SET_VERSION, 67);
    assert_eq!(CONTRACT_VERSION, 51);
    assert_eq!(
        MODULE_VERSIONS
            .iter()
            .find(|(name, _)| *name == "agent")
            .map(|(_, version)| *version),
        Some(5)
    );
}

#[test]
fn list_image_shape_round_trips_and_square_is_omitted() {
    let circle = json!({
        "type": "list", "layout": "rows", "image_shape": "circle",
        "items": [{"key": "a", "title": "가", "image": {"asset": "photo"}}]
    });
    let parsed =
        parse_app_definition(&definition(circle.clone(), ITEM_IMAGE_BLOCK_SET_VERSION).to_string())
            .unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(encoded["ui"]["image_shape"], json!("circle"));
    assert_eq!(encoded["ui"]["items"][0]["image"], json!({"asset": "photo"}));

    let square = json!({"type": "list", "image_shape": "square", "items": [{"key": "a", "title": "가"}]});
    let parsed =
        parse_app_definition(&definition(square, ITEM_IMAGE_BLOCK_SET_VERSION).to_string())
            .unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert!(encoded["ui"].get("image_shape").is_none());

    let plain = json!({"type": "list", "items": [{"key": "a", "title": "가", "image": {"blob": "media/a.png"}}]});
    parse_app_definition(&definition(plain, 4).to_string()).unwrap();
}

#[test]
fn list_image_shape_requires_block_set_67() {
    for ui in [
        json!({"type": "list", "image_shape": "circle", "items": []}),
        json!({"type": "list", "image_shape": "square", "items": []}),
    ] {
        let error =
            parse_app_definition(&definition(ui.clone(), ITEM_IMAGE_BLOCK_SET_VERSION - 1).to_string())
                .unwrap_err();
        assert!(
            error
                .details
                .iter()
                .any(|detail| detail.contains("블록 세트 67판")),
            "{:?}",
            error.details
        );
        parse_app_definition(&definition(ui, ITEM_IMAGE_BLOCK_SET_VERSION).to_string()).unwrap();
    }
}

#[test]
fn tree_image_shape_and_item_image_round_trip() {
    let ui = json!({
        "type": "tree", "image_shape": "circle", "by": "children",
        "items": [
            {"key": "one", "title": "하나", "image": {"asset": "photo"}},
            {"key": "two", "title": "둘", "children": [
                {"key": "child", "title": "아이", "image": {"blob": "media/child.png"}}
            ]}
        ]
    });
    let parsed =
        parse_app_definition(&definition(ui.clone(), ITEM_IMAGE_BLOCK_SET_VERSION).to_string())
            .unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(encoded["ui"]["image_shape"], json!("circle"));
    assert_eq!(encoded["ui"]["items"][0]["image"], json!({"asset": "photo"}));
    assert_eq!(
        encoded["ui"]["items"][1]["children"][0]["image"],
        json!({"blob": "media/child.png"})
    );

    let square = json!({
        "type": "tree", "image_shape": "square",
        "items": [{"key": "one", "title": "하나"}]
    });
    let encoded =
        serde_json::to_value(&parse_app_definition(&definition(square, ITEM_IMAGE_BLOCK_SET_VERSION).to_string()).unwrap())
            .unwrap();
    assert!(encoded["ui"].get("image_shape").is_none());
}

#[test]
fn trees_without_images_keep_their_block_set() {
    let ui = json!({"type": "tree", "items": [{"key": "one", "title": "하나"}]});
    parse_app_definition(&definition(ui, 4).to_string()).unwrap();
    let folder = json!({
        "type": "tree",
        "root": {"permission": "docs"},
        "selected": {"state": "picked"},
        "on_select": {"set_state": "picked"}
    });
    let mut value = definition(folder, 1);
    value["requires"]["modules"] = json!({"files": 1});
    value["permissions"] = json!([{"module": "files", "id": "docs", "access": "read", "label": "문서"}]);
    parse_app_definition(&value.to_string()).unwrap();
}

#[test]
fn tree_images_require_block_set_67() {
    for ui in [
        json!({"type": "tree", "image_shape": "circle", "items": []}),
        json!({"type": "tree", "items": [{"key": "one", "title": "하나", "image": {"asset": "photo"}}]}),
        json!({"type": "tree", "items": [
            {"key": "one", "title": "하나", "children": [
                {"key": "child", "title": "아이", "image": {"asset": "photo"}}
            ]}
        ]}),
    ] {
        let error =
            parse_app_definition(&definition(ui.clone(), ITEM_IMAGE_BLOCK_SET_VERSION - 1).to_string())
                .unwrap_err();
        assert!(
            error
                .details
                .iter()
                .any(|detail| detail.contains("블록 세트 67판")),
            "{:?}",
            error.details
        );
        parse_app_definition(&definition(ui, ITEM_IMAGE_BLOCK_SET_VERSION).to_string()).unwrap();
    }
}

#[test]
fn tree_subtitle_round_trips_and_requires_block_set_67() {
    let ui = json!({
        "type": "tree", "by": "children",
        "items": [
            {"key": "one", "title": "하나", "subtitle": "프로필 · 서버 · 모델"},
            {"key": "two", "title": "둘", "children": [
                {"key": "child", "title": "아이", "subtitle": "보조 줄"}
            ]}
        ]
    });
    let parsed =
        parse_app_definition(&definition(ui.clone(), ITEM_IMAGE_BLOCK_SET_VERSION).to_string())
            .unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(
        encoded["ui"]["items"][0]["subtitle"],
        json!("프로필 · 서버 · 모델")
    );
    assert_eq!(
        encoded["ui"]["items"][1]["children"][0]["subtitle"],
        json!("보조 줄")
    );

    let error =
        parse_app_definition(&definition(ui.clone(), ITEM_IMAGE_BLOCK_SET_VERSION - 1).to_string())
            .unwrap_err();
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("블록 세트 67판")),
        "{:?}",
        error.details
    );
    parse_app_definition(&definition(ui, ITEM_IMAGE_BLOCK_SET_VERSION).to_string()).unwrap();

    let plain = json!({"type": "tree", "items": [{"key": "one", "title": "하나"}]});
    parse_app_definition(&definition(plain, 4).to_string()).unwrap();
}

#[test]
fn agent_module_five_is_supported_and_six_is_not() {
    parse_app_definition(&agent_definition(5).to_string()).unwrap();
    assert_eq!(
        parse_app_definition(&agent_definition(6).to_string())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_DEFINITION_REQUIRES_NEWER_SHELL")
    );
    parse_app_definition(&agent_definition(4).to_string()).unwrap();
}
