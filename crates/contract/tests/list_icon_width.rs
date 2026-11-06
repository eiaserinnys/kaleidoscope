use kaleidoscope_contract::validate::{parse_app_definition, parse_cached_app_definition};
use serde_json::{json, Value};

fn definition(blocks: u32, ui: Value) -> Value {
    json!({"id":"list-icon-test", "name":"목록 시험", "requires":{"blocks":blocks,"modules":{}},
        "permissions":[], "state":{"choice":null}, "ui":ui})
}

#[test]
fn list_current_and_stack_scroll_reset_require_version_50() {
    for (ui, field, code) in [
        (json!({"type":"list", "items":[], "current":"a"}), "current", "APP_LIST_CURRENT_VERSION_LOW"),
        (json!({"type":"stack", "direction":"column", "scroll_reset":"a", "children":[{"type":"text", "value":"내용"}]}), "scroll_reset", "APP_STACK_SCROLL_RESET_VERSION_LOW"),
    ] {
        assert_eq!(parse_app_definition(&definition(49, ui.clone()).to_string()).unwrap_err().id.as_deref(), Some(code));
        let parsed = parse_app_definition(&definition(50, ui.clone()).to_string()).unwrap();
        assert_eq!(parsed.ui.introduced_in(), 50);
        let value = serde_json::to_value(parsed).unwrap();
        assert_eq!(value["ui"][field], ui[field]);
        assert!(parse_cached_app_definition(&value.to_string()).is_ok());
        let mut old = ui;
        old.as_object_mut().unwrap().remove(field);
        assert!(parse_app_definition(&definition(49, old).to_string()).is_ok());
    }
}

#[test]
fn new_bindings_are_exposed_to_the_data_runtime_and_schema() {
    let app = definition(50, json!({"type":"stack", "direction":"column", "scroll_reset":{"state":"choice"},
        "children":[{"type":"list", "items":[], "current":{"state":"choice"}}]}));
    let parsed = parse_app_definition(&app.to_string()).unwrap();
    let pointers: Vec<String> = kaleidoscope_contract::data::all_ui_bindings(&parsed).into_iter().map(|(pointer, _)| pointer).collect();
    assert!(pointers.contains(&"/ui/scroll_reset".to_string()));
    assert!(pointers.contains(&"/ui/children/0/current".to_string()));
    let schema = serde_json::to_string(&kaleidoscope_contract::app_definition_schema()).unwrap();
    assert!(schema.contains("scroll_reset"));
    assert!(schema.contains("current"));
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

#[test]
fn multiple_selection_and_activation_require_their_contract() {
    let mut ui = json!({"type":"list", "items":[{"key":"a", "title":"A"}],
        "selection":"multiple", "selected":{"state":"choice"}, "on_select":{"set_state":"choice"}});
    assert_eq!(parse_app_definition(&definition(48, ui.clone()).to_string()).unwrap_err().id.as_deref(), Some("APP_LIST_MULTIPLE_VERSION_LOW"));
    let parsed = parse_app_definition(&definition(49, ui.clone()).to_string()).unwrap();
    assert_eq!(parsed.ui.introduced_in(), 49);
    assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["selection"], "multiple");
    for selected in [json!(null), json!({"expr":"[]"}), json!({"state":"missing"})] {
        ui["selected"] = selected;
        assert_eq!(parse_app_definition(&definition(49, ui.clone()).to_string()).unwrap_err().id.as_deref(), Some("APP_LIST_MULTIPLE_SELECTED_INVALID"));
    }
    ui["selected"] = json!({"state":"choice"});
    ui.as_object_mut().unwrap().remove("on_select");
    assert_eq!(parse_app_definition(&definition(49, ui).to_string()).unwrap_err().id.as_deref(), Some("APP_LIST_MULTIPLE_SELECTED_INVALID"));
    for extra in [json!({"on_activate":{"set_state":"choice"}}), json!({"items":[{"key":"a", "title":"A", "selectable":false}]})] {
        let mut list = json!({"type":"list", "items":[]});
        list.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        assert_eq!(parse_app_definition(&definition(48, list.clone()).to_string()).unwrap_err().id.as_deref(), Some("APP_LIST_ACTIVATE_VERSION_LOW"));
        let parsed = parse_app_definition(&definition(49, list).to_string()).unwrap();
        if extra.get("on_activate").is_some() { assert_eq!(parsed.ui.introduced_in(), 49); }
    }
}
