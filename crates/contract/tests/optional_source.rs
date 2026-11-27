use kaleidoscope_contract::validate::parse_app_definition;
use kaleidoscope_contract::BLOCK_SET_VERSION;
use serde_json::{json, Value};

fn app(blocks: u32, optional: Option<bool>) -> String {
    let mut extra = json!({"kind": "request", "permission": "api", "path": "/extra"});
    if let Some(optional) = optional {
        extra["optional"] = json!(optional);
    }
    json!({
        "id": "test-optional", "name": "선택 원천",
        "requires": {"blocks": blocks, "modules": {"connection": 1}},
        "permissions": [{"module": "connection", "id": "api", "connection": "test", "access": "readwrite", "label": "API"}],
        "sources": {"extra": extra},
        "ui": {"type": "text", "value": "x"}
    })
    .to_string()
}

#[test]
fn block_set_is_71() {
    assert_eq!(BLOCK_SET_VERSION, 71);
}

#[test]
fn optional_source_needs_blocks_71() {
    assert!(parse_app_definition(&app(70, Some(true))).is_err());
    assert!(parse_app_definition(&app(71, Some(true))).is_ok());
}

#[test]
fn optional_false_or_absent_keeps_the_old_set() {
    assert!(parse_app_definition(&app(70, Some(false))).is_ok());
    assert!(parse_app_definition(&app(50, None)).is_ok());
}

#[test]
fn optional_is_read_and_written_in_the_same_shape() {
    let on = parse_app_definition(&app(71, Some(true))).unwrap();
    assert_eq!(serde_json::to_value(&on).unwrap()["sources"]["extra"]["optional"], json!(true));
    let off = parse_app_definition(&app(50, None)).unwrap();
    let written: Value = serde_json::to_value(&off).unwrap();
    assert!(written["sources"]["extra"].get("optional").is_none());
}
