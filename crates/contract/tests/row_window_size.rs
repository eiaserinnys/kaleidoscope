use kaleidoscope_contract::{app_definition_schema, validate::parse_app_definition, ROW_WINDOW_SIZE_BLOCK_SET_VERSION};
use serde_json::{json, Value};

fn app() -> Value {
    json!({"id":"row-test", "name":"행 시험", "requires":{"blocks":ROW_WINDOW_SIZE_BLOCK_SET_VERSION,"modules":{}},
        "permissions":[], "state":{},
        "ui":{"type":"button","label":"실행","icon":"copy","variant":"row","on_click":{"copy_text":"값"}}})
}

#[test]
fn row_and_window_size_contract() {
    let mut value = app();
    value["window_size"] = json!({"width":480,"height":360});
    let parsed = parse_app_definition(&value.to_string()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap()["window_size"], value["window_size"]);
    assert!(app_definition_schema().to_string().contains("window_size"));
    value.as_object_mut().unwrap().remove("window_size");
    assert!(serde_json::to_value(parse_app_definition(&value.to_string()).unwrap()).unwrap().get("window_size").is_none());
    value["requires"]["blocks"] = json!(ROW_WINDOW_SIZE_BLOCK_SET_VERSION - 1);
    assert_eq!(parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(), Some("APP_BUTTON_ROW_VERSION_LOW"));
    value["ui"]["variant"] = json!({"state":"variant"});
    value["state"]["variant"] = json!("row");
    parse_app_definition(&value.to_string()).unwrap();
}

#[test]
fn row_rejects_icon_only_and_preview_separately() {
    let mut value = app();
    value["ui"]["icon_only"] = json!(true);
    assert_eq!(parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(), Some("APP_BUTTON_ROW_ICON_ONLY"));
    value["ui"].as_object_mut().unwrap().remove("icon_only");
    value["ui"]["preview"] = json!({"type":"image", "src":"https://example.com/a.png"});
    assert_eq!(parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(), Some("APP_BUTTON_ROW_PREVIEW"));
}

#[test]
fn window_size_requires_version_and_minimum() {
    let mut value = app();
    value["ui"]["variant"] = json!("default");
    value["window_size"] = json!({"width":480,"height":360});
    value["requires"]["blocks"] = json!(ROW_WINDOW_SIZE_BLOCK_SET_VERSION - 1);
    assert_eq!(parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(), Some("APP_WINDOW_SIZE_VERSION_LOW"));
    value["requires"]["blocks"] = json!(ROW_WINDOW_SIZE_BLOCK_SET_VERSION);
    for size in [json!({"width":359,"height":240}), json!({"width":360,"height":239}), json!({"width":-1,"height":240})] {
        value["window_size"] = size;
        assert_eq!(parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(), Some("APP_WINDOW_SIZE_TOO_SMALL"));
    }
    value["window_size"] = json!({"width":360,"height":240});
    parse_app_definition(&value.to_string()).unwrap();
}

#[test]
fn button_grid_keeps_existing_variant_wire_values_and_rejects_row() {
    let mut value = app();
    value["state"]["choice"] = json!("");
    value["ui"] = json!({"type":"button_grid", "columns":1,
        "buttons":[{"key":"one","label":"하나"}], "on_press":{"set_state":"choice"}});
    for name in ["default", "primary", "danger", "ghost", "chip"] {
        value["ui"]["buttons"][0]["variant"] = json!(name);
        let parsed = parse_app_definition(&value.to_string()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["buttons"][0]["variant"], name);
    }
    value["ui"]["buttons"][0]["variant"] = json!("row");
    assert!(parse_app_definition(&value.to_string()).is_err());
}
