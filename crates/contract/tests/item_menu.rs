use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "item-menu-test", "name": "항목 메뉴 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {"selected": null}, "ui": ui
    })
}

fn blocks() -> Vec<Value> {
    vec![
        json!({"type":"list", "items":[]}),
        json!({"type":"table", "rows":[], "columns":[{"field":"title", "label":"제목"}]}),
        json!({"type":"tree", "items":[]}),
        json!({"type":"feed", "entries":[]}),
        json!({"type":"thread", "entries":[]}),
    ]
}

#[test]
fn item_menus_round_trip_and_expose_action_and_confirmation_slots() {
    for mut ui in blocks() {
        let kind = ui["type"].as_str().unwrap().to_owned();
        ui["item_menu"] = json!([
            {"label":"열기", "on_select":[{"set_state":"selected", "value":{"expr":"$item.url"}}]},
            {"label":"보관", "on_select":{"set_state":"selected"}, "danger":true,
             "confirm":{"title":"보관할까요?", "ok":"보관", "body":{"state":"selected"}}}
        ]);
        let parsed = parse_app_definition(&definition(ui.clone(), 19).to_string())
            .unwrap_or_else(|error| panic!("{kind}: {error:?}"));
        let encoded = serde_json::to_value(&parsed).unwrap();
        assert_eq!(encoded["ui"]["item_menu"], ui["item_menu"], "{kind}");
        let actions = data::all_ui_actions(&parsed);
        assert!(
            actions
                .iter()
                .any(|(pointer, _)| pointer == "/ui/item_menu/0/on_select"),
            "{kind}"
        );
        assert!(
            actions
                .iter()
                .any(|(pointer, _)| pointer == "/ui/item_menu/1/on_select"),
            "{kind}"
        );
        assert!(
            data::all_ui_bindings(&parsed)
                .iter()
                .any(|(pointer, _)| pointer == "/ui/item_menu/1/confirm/body"),
            "{kind}"
        );
    }
}

#[test]
fn item_menu_requires_current_block_set_and_rejects_invalid_entries() {
    for mut ui in blocks() {
        let kind = ui["type"].as_str().unwrap().to_owned();
        ui["item_menu"] = json!([]);
        assert!(
            parse_app_definition(&definition(ui.clone(), 18).to_string()).is_err(),
            "{kind}"
        );
        assert!(
            parse_app_definition(&definition(ui.clone(), 19).to_string()).is_ok(),
            "{kind}"
        );
        for entry in [
            json!({"label":"  ", "on_select":{"set_state":"selected"}}),
            json!({"label":"열기", "on_select":{"set_state":"selected"}, "unknown":true}),
            json!({"label":"열기", "on_select":{"set_state":"missing"}}),
        ] {
            ui["item_menu"] = json!([entry]);
            assert!(
                parse_app_definition(&definition(ui.clone(), 19).to_string()).is_err(),
                "{kind}: {ui}"
            );
        }
    }
}

#[test]
fn item_menu_copy_text_is_local_and_must_be_alone() {
    for mut ui in blocks() {
        for action in [
            json!({"copy_text":{"item":"url"}}),
            json!([{"copy_text":{"item":"url"}}]),
        ] {
            ui["item_menu"] = json!([{"label":"주소 복사", "on_select":action}]);
            let parsed = parse_app_definition(&definition(ui.clone(), 19).to_string())
                .unwrap_or_else(|error| panic!("{ui}: {error:?}"));
            let actions = data::all_ui_actions(&parsed);
            assert!(actions
                .iter()
                .any(|(pointer, action)| pointer == "/ui/item_menu/0/on_select"
                    && data::local_actions(action)));
            assert!(data::ui_actions(&parsed).is_empty());
        }
        ui["item_menu"] = json!([{"label":"주소 복사", "on_select":[
            {"copy_text":{"item":"url"}}, {"set_state":"selected"}
        ]}]);
        assert!(parse_app_definition(&definition(ui, 19).to_string()).is_err());
    }
}

#[test]
fn item_menu_copy_text_rejects_expressions() {
    for mut ui in blocks() {
        ui["item_menu"] = json!([{"label":"복사", "on_select":{"copy_text":{"expr":"$item.url"}}}]);
        let error = parse_app_definition(&definition(ui, 19).to_string()).expect_err("item_menu copy_text expression must fail");
        assert!(error.details.iter().any(|detail| detail.contains("행마다 계산하지 않습니다")), "{error:?}");
    }
}

#[test]
fn item_menu_confirmation_body_accepts_item_bindings() {
    for binding in [json!({"item":"title"}), json!({"parent_item":"title"})] {
        let ui = json!({"type":"list", "items":[], "item_menu":[{"label":"지우기", "on_select":{"set_state":"selected"}, "confirm":{"title":"지울까요?", "body":binding}}]});
        parse_app_definition(&definition(ui, 19).to_string()).expect("confirmation body should accept item scope");
    }
}

#[test]
fn schema_exposes_item_menu_entry() {
    let schema = app_definition_schema().to_string();
    assert!(schema.contains("item_menu"));
    assert!(schema.contains("ItemMenuEntry"));
}
