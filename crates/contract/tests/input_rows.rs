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
    assert_eq!(BLOCK_SET_VERSION, 12);
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
