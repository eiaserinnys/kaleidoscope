use kaleidoscope_contract::{validate::parse_app_definition, ErrorCode};
use serde_json::{json, Value};

fn feed_definition(blocks: u32, field: &str) -> Value {
    json!({
        "id": "feed-contract-test",
        "name": "흐름 계약 시험",
        "requires": { "blocks": blocks, "modules": {} },
        "permissions": [],
        "state": {},
        "ui": {
            "type": "feed",
            "entries": [{ "key": "one", "meta": "id-1", "body": ["첫째", "둘째"] }],
            (field): true
        }
    })
}

#[test]
fn feed_columns_requires_block_set_seven() {
    let old = feed_definition(6, "columns");
    let error = parse_app_definition(&old.to_string()).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
    assert!(error.details.iter().any(|detail| detail.contains("블록 세트 7판")));

    let current = feed_definition(7, "columns");
    assert!(parse_app_definition(&current.to_string()).is_ok());
}

#[test]
fn feed_copy_requires_block_set_seven() {
    let old = feed_definition(6, "copy");
    let error = parse_app_definition(&old.to_string()).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
    assert!(error.details.iter().any(|detail| detail.contains("블록 세트 7판")));

    let current = feed_definition(7, "copy");
    assert!(parse_app_definition(&current.to_string()).is_ok());
}
