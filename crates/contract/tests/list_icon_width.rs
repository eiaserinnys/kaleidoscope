use kaleidoscope_contract::validate::{parse_app_definition, parse_cached_app_definition};
use serde_json::{json, Value};

fn definition(blocks: u32, ui: Value) -> Value {
    json!({"id":"list-icon-test", "name":"목록 시험", "requires":{"blocks":blocks,"modules":{}},
        "permissions":[], "state":{"choice":null}, "ui":ui})
}

#[test]
fn static_icons_require_version_and_known_names_in_both_list_shapes() {
    for grouped in [false, true] {
        let items = if grouped { json!([{ "title":"도구", "items":[{"key":"a", "title":"자르기", "icon":"crop"}] }]) }
                    else { json!([{ "key":"a", "title":"자르기", "icon":"crop" }]) };
        let mut ui = json!({"type":"list", "grouped":grouped, "items":items});
        let error = parse_app_definition(&definition(45, ui.clone()).to_string()).unwrap_err();
        assert_eq!(error.id.as_deref(), Some("APP_LIST_ICON_VERSION_LOW"));
        let app = definition(46, ui.clone());
        let parsed = parse_app_definition(&app.to_string()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["items"], ui["items"]);
        if grouped { ui["items"][0]["items"][0]["icon"] = json!("unknown"); }
        else { ui["items"][0]["icon"] = json!("unknown"); }
        let error = parse_app_definition(&definition(46, ui).to_string()).unwrap_err();
        assert_eq!(error.id.as_deref(), Some("APP_LIST_ICON_NAME_INVALID"));
    }
}

#[test]
fn grid_width_requires_grid_and_version_and_roundtrips() {
    let base = json!({"type":"list", "layout":"grid", "items":[]});
    let old = definition(44, base.clone());
    let parsed = parse_app_definition(&old.to_string()).unwrap();
    let serialized = serde_json::to_value(parsed).unwrap();
    assert!(serialized["ui"].get("item_width").is_none());
    assert!(parse_cached_app_definition(&serialized.to_string()).is_ok());
    for width in ["small", "medium", "large"] {
        let mut ui = base.clone();
        ui["item_width"] = json!(width);
        assert_eq!(parse_app_definition(&definition(45, ui.clone()).to_string()).unwrap_err().id.as_deref(), Some("APP_LIST_ITEM_WIDTH_VERSION_LOW"));
        let parsed = parse_app_definition(&definition(46, ui.clone()).to_string()).unwrap();
        let serialized = serde_json::to_value(parsed).unwrap();
        assert_eq!(serialized["ui"]["item_width"], width);
        assert!(parse_cached_app_definition(&serialized.to_string()).is_ok());
        ui["layout"] = json!("rows");
        assert_eq!(parse_app_definition(&definition(46, ui).to_string()).unwrap_err().id.as_deref(), Some("APP_LIST_ITEM_WIDTH_LAYOUT_INVALID"));
    }
}

#[test]
fn new_icon_names_require_version_in_buttons_and_button_grids() {
    for (ui, code) in [(json!({"type":"button", "label":"자르기", "icon":"crop", "on_click":{"set_state":"choice"}}), "APP_BUTTON_ICON_VERSION_LOW"),
               (json!({"type":"button_grid", "columns":1, "buttons":[{"key":"a", "label":"자르기", "icon":"crop"}], "on_press":{"set_state":"choice"}}), "APP_BUTTON_GRID_ICON_VERSION_LOW")] {
        assert_eq!(parse_app_definition(&definition(45, ui.clone()).to_string()).unwrap_err().id.as_deref(), Some(code));
        assert!(parse_app_definition(&definition(46, ui).to_string()).is_ok());
    }
}
