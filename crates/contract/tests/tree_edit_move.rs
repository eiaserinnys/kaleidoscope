use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition, BLOCK_SET_VERSION};
use serde_json::{json, Value};

/// 바로 입력, 끌어 옮기기, 구역 메뉴와 이름 바꾸기가 처음 들어온 블록 세트 판.
const V60: u32 = 60;

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "tree-edit-move-test", "name": "트리 편집 이동 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {"picked": null}, "ui": ui
    })
}

fn tree() -> Value {
    json!({"type":"tree", "items":[
        {"key":"one", "title":"하나"},
        {"key":"two", "title":"둘", "children":[{"key":"child", "title":"아이"}]}
    ]})
}

#[test]
fn tree_edit_move_fields_round_trip_and_expose_action_slots() {
    assert!(BLOCK_SET_VERSION >= V60);
    let mut ui = tree();
    ui["by"] = json!("children");
    ui["items"][0]["editing"] = json!(true);
    ui["on_edit"] = json!([{"set_state":"picked", "value":{"expr":"$event"}}]);
    ui["on_edit_cancel"] = json!([{"set_state":"picked"}]);
    ui["on_move"] = json!([{"set_state":"picked", "value":{"expr":"$event.position"}}]);
    let parsed = parse_app_definition(&definition(ui.clone(), V60).to_string()).unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(encoded["ui"], ui);
    for slot in ["on_edit", "on_edit_cancel", "on_move"] {
        assert!(
            data::all_ui_actions(&parsed)
                .iter()
                .any(|(pointer, _)| pointer == &format!("/ui/{slot}")),
            "{slot}"
        );
    }
    let schema = app_definition_schema().to_string();
    for field in ["editing", "on_edit", "on_edit_cancel", "on_move"] {
        assert!(schema.contains(&format!("\"{field}\"")), "{field}");
    }
}

#[test]
fn tree_edit_move_omits_absent_fields() {
    let ui = json!({"type":"tree", "items":[{"key":"one", "title":"하나"}]});
    let parsed = parse_app_definition(&definition(ui, 4).to_string()).unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert!(encoded["ui"].get("on_edit").is_none());
    assert!(encoded["ui"].get("on_edit_cancel").is_none());
    assert!(encoded["ui"].get("on_move").is_none());
    assert!(encoded["ui"]["items"][0].get("editing").is_none());
    parse_app_definition(&definition(tree(), V60).to_string()).unwrap();
}

#[test]
fn tree_edit_move_requires_block_set_version() {
    for field in ["on_edit", "on_edit_cancel", "on_move"] {
        let mut ui = tree();
        ui[field] = json!([{"set_state":"picked"}]);
        assert_eq!(
            parse_app_definition(&definition(ui, V60 - 1).to_string())
                .unwrap_err()
                .id
                .as_deref(),
            Some("APP_TREE_EDIT_MOVE_VERSION_LOW"),
            "{field}"
        );
    }
    let mut editing = tree();
    editing["items"][0]["editing"] = json!(true);
    assert_eq!(
        parse_app_definition(&definition(editing, V60 - 1).to_string())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_TREE_EDIT_MOVE_VERSION_LOW")
    );
    let mut nested = tree();
    nested["items"][1]["children"][0]["editing"] = json!(true);
    assert_eq!(
        parse_app_definition(&definition(nested, V60 - 1).to_string())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_TREE_EDIT_MOVE_VERSION_LOW")
    );
    let mut off = tree();
    off["items"][0]["editing"] = json!(false);
    parse_app_definition(&definition(off, V60 - 1).to_string()).unwrap();
}

#[test]
fn tree_edit_move_rejects_folder_root_mode() {
    let folder_app = |ui: Value| {
        let mut value = definition(ui, V60);
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
    for field in ["on_edit", "on_edit_cancel", "on_move"] {
        let extra = json!({field: [{"set_state":"picked"}]});
        assert_eq!(
            parse_app_definition(&folder_app(root_tree(extra)).to_string()).unwrap_err().id.as_deref(),
            Some("APP_TREE_EDIT_MOVE_ROOT_UNSUPPORTED"),
            "{field}"
        );
    }
    parse_app_definition(&folder_app(root_tree(json!(null))).to_string()).unwrap();
}

fn section(extra: Value) -> Value {
    let mut value = json!({
        "type": "section",
        "title": "구역",
        "child": {"type": "text", "value": "본문"}
    });
    if let Some(extra) = extra.as_object() {
        for (key, item) in extra {
            value[key] = item.clone();
        }
    }
    value
}

#[test]
fn section_menu_and_edit_fields_round_trip_and_expose_slots() {
    let ui = section(json!({
        "menu": [
            {"label": "이름 바꾸기", "on_select": [{"set_state": "picked", "value": {"expr": "$item.key"}}]},
            {"label": "지우기", "danger": true, "on_select": [{"set_state": "picked"}],
             "confirm": {"title": "지울까요", "body": {"expr": "$item.title"}, "ok": "지우기"}}
        ],
        "editing": {"state": "picked"},
        "on_edit": [{"set_state": "picked", "value": {"expr": "$event"}}],
        "on_edit_cancel": [{"set_state": "picked"}]
    }));
    let parsed = parse_app_definition(&definition(ui.clone(), V60).to_string()).unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    for field in ["menu", "editing", "on_edit", "on_edit_cancel"] {
        assert_eq!(encoded["ui"][field], ui[field], "{field}");
    }
    let actions: Vec<String> = data::all_ui_actions(&parsed)
        .into_iter()
        .map(|(pointer, _)| pointer)
        .collect();
    for slot in [
        "/ui/menu/0/on_select",
        "/ui/menu/1/on_select",
        "/ui/on_edit",
        "/ui/on_edit_cancel",
    ] {
        assert!(actions.iter().any(|pointer| pointer == slot), "{slot}");
    }
    let bindings: Vec<String> = data::all_ui_bindings(&parsed)
        .into_iter()
        .map(|(pointer, _)| pointer)
        .collect();
    for slot in ["/ui/editing", "/ui/menu/1/confirm/body"] {
        assert!(bindings.iter().any(|pointer| pointer == slot), "{slot}");
    }
    let schema = app_definition_schema().to_string();
    for field in ["menu", "editing", "on_edit", "on_edit_cancel"] {
        assert!(schema.contains(&format!("\"{field}\"")), "{field}");
    }
}

#[test]
fn section_edit_menu_requires_block_set_version() {
    let fields = [
        (
            "menu",
            json!([{"label": "이름 바꾸기", "on_select": [{"set_state": "picked"}]}]),
        ),
        ("editing", json!(true)),
        ("on_edit", json!([{"set_state": "picked"}])),
        ("on_edit_cancel", json!([{"set_state": "picked"}])),
    ];
    for (field, value) in fields {
        let ui = section(json!({(field): value.clone()}));
        assert_eq!(
            parse_app_definition(&definition(ui, V60 - 1).to_string())
                .unwrap_err()
                .id
                .as_deref(),
            Some("APP_SECTION_EDIT_MENU_VERSION_LOW"),
            "{field}"
        );
        parse_app_definition(&definition(section(json!({(field): value})), V60).to_string()).unwrap();
    }
    parse_app_definition(&definition(section(json!(null)), V60 - 1).to_string()).unwrap();
}

#[test]
fn section_menu_requires_one_to_four_entries() {
    let parse = |count: usize| {
        let menu: Vec<Value> = (0..count)
            .map(|index| {
                json!({"label": format!("항목 {index}"), "on_select": [{"set_state": "picked"}]})
            })
            .collect();
        parse_app_definition(&definition(section(json!({"menu": menu})), V60).to_string())
    };
    for count in [1, 4] {
        parse(count).unwrap_or_else(|error| panic!("{count}: {error:?}"));
    }
    for count in [0, 5] {
        let error = parse(count).unwrap_err();
        assert_eq!(error.id.as_deref(), Some("APP_DEFINITION_CHECK_FAILED"), "{count}");
        assert!(
            error
                .details
                .iter()
                .any(|detail| detail.contains("메뉴는 1개 이상 4개 이하여야 합니다")),
            "{count}: {:?}",
            error.details
        );
    }
    let blank = section(json!({"menu": [{"label": "  ", "on_select": [{"set_state": "picked"}]}]}));
    let error = parse_app_definition(&definition(blank, V60).to_string()).unwrap_err();
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("메뉴 항목의 이름이 비어 있습니다")),
        "{:?}",
        error.details
    );
}
