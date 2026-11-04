use kaleidoscope_contract::{data::all_ui_bindings, validate::parse_app_definition, BUTTON_VARIANT_ICON_BLOCK_SET_VERSION};
use serde_json::{json, Value};

fn definition(blocks: u32) -> Value {
    json!({"id":"tooltip-fixture", "name":"설명", "requires":{"blocks":blocks,"modules":{}}, "permissions":[], "state":{"hint":"설명"},
        "ui":{"type":"stack","direction":"column","children":[{"type":"button","label":"실행","description":{"state":"hint"},"on_click":[{"set_state":"hint","value":"실행"}]}]}})
}

#[test]
fn button_variant_binding_and_new_icons_require_their_block_set() {
    let mut app = definition(BUTTON_VARIANT_ICON_BLOCK_SET_VERSION - 1);
    let button = &mut app["ui"]["children"][0];
    button.as_object_mut().unwrap().remove("description");
    button["variant"] = json!({"state":"hint"});
    let err = parse_app_definition(&app.to_string()).unwrap_err();
    assert_eq!(err.id.as_deref(), Some("APP_BUTTON_VARIANT_VERSION_LOW"));
    app["requires"]["blocks"] = json!(BUTTON_VARIANT_ICON_BLOCK_SET_VERSION);
    let parsed = parse_app_definition(&app.to_string()).unwrap();
    assert!(all_ui_bindings(&parsed).iter().any(|(path, _)| path == "/ui/children/0/variant"));
    for icon in ["film", "sticker", "image-play"] {
        let button = &mut app["ui"]["children"][0];
        button["variant"] = json!("default");
        button["icon"] = json!(icon);
        app["requires"]["blocks"] = json!(BUTTON_VARIANT_ICON_BLOCK_SET_VERSION - 1);
        let err = parse_app_definition(&app.to_string()).unwrap_err();
        assert_eq!(err.id.as_deref(), Some("APP_BUTTON_ICON_VERSION_LOW"));
        app["requires"]["blocks"] = json!(BUTTON_VARIANT_ICON_BLOCK_SET_VERSION);
        parse_app_definition(&app.to_string()).unwrap();
    }
}

#[test]
fn button_grid_new_icon_requires_its_block_set() {
    let mut app = definition(BUTTON_VARIANT_ICON_BLOCK_SET_VERSION - 1);
    app["ui"]["children"][0] = json!({"type":"button_grid", "columns":1,
        "buttons":[{"key":"gif", "label":"움직이는 그림", "icon":"image-play"}],
        "on_press":{"set_state":"hint"}});
    let err = parse_app_definition(&app.to_string()).unwrap_err();
    assert_eq!(err.id.as_deref(), Some("APP_BUTTON_GRID_ICON_VERSION_LOW"));
    app["requires"]["blocks"] = json!(BUTTON_VARIANT_ICON_BLOCK_SET_VERSION);
    parse_app_definition(&app.to_string()).unwrap();
}
