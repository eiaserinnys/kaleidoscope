use kaleidoscope_contract::{data, validate::parse_app_definition};
use serde_json::{json, Value};

fn definition(blocks: u32, ui: Value) -> Value {
    json!({"id":"blocks-test", "name":"블록 시험", "requires":{"blocks":blocks,"modules":{}},
        "permissions":[], "state":{"value":0}, "ui":ui})
}

#[test]
fn new_blocks_require_nine_and_expose_binding_and_action_slots() {
    let blocks = [
        json!({"type":"metrics", "items":{"expr":"$state.value"}}),
        json!({"type":"button_grid", "columns":4, "buttons":[{"key":"1", "label":"1"}], "on_press":{"set_state":"value"}}),
        json!({"type":"chart", "series":{"expr":"$state.value"}, "on_select":{"set_state":"value"}}),
    ];
    for ui in blocks {
        assert!(parse_app_definition(&definition(8, ui.clone()).to_string()).is_err());
        let app = parse_app_definition(&definition(9, ui).to_string()).unwrap();
        assert_eq!(app.ui.introduced_in(), 9);
        assert!(!data::all_exprs(&app).is_empty() || app.ui.type_name() == "button_grid");
    }
}

#[test]
fn button_grid_rejects_invalid_columns_and_duplicate_keys() {
    let bad_columns =
        json!({"type":"button_grid", "columns":0, "buttons":[], "on_press":{"set_state":"value"}});
    assert!(parse_app_definition(&definition(9, bad_columns).to_string()).is_err());
    let duplicates = json!({"type":"button_grid", "columns":4, "buttons":[{"key":"1", "label":"1"},{"key":"1", "label":"다시"}], "on_press":{"set_state":"value"}});
    assert!(parse_app_definition(&definition(9, duplicates).to_string()).is_err());
}

#[test]
fn candles_and_table_formats_validate_their_contract() {
    let valid = json!({"type":"chart", "kind":"candlestick", "series":[{"key":"s","name":"값","points":[{"x":"날짜","open":3,"high":5,"low":1,"close":4}]}]});
    assert!(parse_app_definition(&definition(9, valid.clone()).to_string()).is_ok());
    let mut invalid = valid;
    invalid["series"][0]["points"][0]["high"] = json!(2);
    let error = parse_app_definition(&definition(9, invalid).to_string()).unwrap_err();
    assert!(error
        .details
        .iter()
        .any(|detail| detail.contains("candlestick chart 점")));
    for format in ["delta", "sparkline"] {
        let table = json!({"type":"table","rows":[],"columns":[{"field":"v","label":"값","format":format}]});
        assert!(parse_app_definition(&definition(8, table.clone()).to_string()).is_err());
        assert!(parse_app_definition(&definition(9, table).to_string()).is_ok());
    }
}
