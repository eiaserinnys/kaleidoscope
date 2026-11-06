use kaleidoscope_contract::{validate::parse_app_definition, Supported, BLOCK_SET_VERSION};
use serde_json::json;

fn app(blocks: u32, rows: u8, kind: &str) -> String {
    json!({
        "id": "input-rows-test", "name": "입력 시험",
        "requires": {"blocks": blocks, "modules": {}}, "permissions": [],
        "state": {"text": ""},
        "ui": {"type": kind, "value": {"state": "text"}, "on_change": {"set_state": "text"}, "rows": rows}
    }).to_string()
}

#[test]
fn rows_requires_eleven_and_accepts_one_to_twenty() {
    assert!(BLOCK_SET_VERSION >= 11);
    for kind in ["input", "textarea"] {
        let definition = parse_app_definition(&app(11, 4, kind)).unwrap();
        let mut old = Supported::current();
        old.blocks = 10;
        assert!(!old.renders(&definition.requires));
        assert!(parse_app_definition(&app(10, 4, kind)).is_err());
        assert!(parse_app_definition(&app(11, 0, kind)).is_err());
        assert!(parse_app_definition(&app(11, 21, kind)).is_err());
    }
}

#[test]
fn textarea_alias_is_multiline_without_rows() {
    let definition = json!({"id":"input-alias-test","name":"입력 시험", "requires":{"blocks":4,"modules":{}},
        "permissions":[],"state":{"text":""},
        "ui":{"type":"textarea","value":{"state":"text"},"on_change":{"set_state":"text"}}});
    let parsed = parse_app_definition(&definition.to_string()).unwrap();
    assert!(matches!(
        parsed.ui,
        kaleidoscope_contract::Block::Input {
            multiline: true,
            ..
        }
    ));
}

#[test]
fn max_rows_requires_new_block_set_and_matches_rows_range() {
    let mut value: serde_json::Value = serde_json::from_str(&app(51, 1, "input")).unwrap();
    value["ui"]["multiline"] = json!(true);
    value["ui"]["max_rows"] = json!(4);
    let definition = parse_app_definition(&value.to_string()).expect("새 판에서 최대 줄 수 허용");
    assert_eq!(serde_json::to_value(&definition).unwrap()["ui"]["max_rows"], 4);
    value["requires"]["blocks"] = json!(50);
    assert!(parse_app_definition(&value.to_string()).is_err());
    value["requires"]["blocks"] = json!(51);
    for max in [0, 21] {
        value["ui"]["max_rows"] = json!(max);
        assert!(parse_app_definition(&value.to_string()).is_err());
    }
    assert!(kaleidoscope_contract::app_definition_schema().to_string().contains("max_rows"));
}
