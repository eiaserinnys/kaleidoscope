use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::{json, Value};

fn definition(block: Value, version: u32) -> String {
    json!({"id":"date-fixture", "name":"날짜", "requires":{"blocks":version,"modules":{}}, "permissions":[], "state":{"value":null}, "ui":block}).to_string()
}
fn input(kind: &str) -> Value {
    json!({"type":"input", "kind":kind, "value":{"state":"value"}, "on_change":{"set_state":"value"}})
}
fn error_id(block: Value, version: u32) -> String {
    parse_app_definition(&definition(block, version))
        .unwrap_err()
        .id
        .unwrap()
}
#[test]
fn date_time_version_and_literal_validation() {
    assert_eq!(
        error_id(input("date"), 34),
        "APP_INPUT_DATE_TIME_VERSION_LOW"
    );
    assert!(parse_app_definition(&definition(input("time"), 35)).is_ok());
    let mut date = input("date");
    date["multiline"] = json!(true);
    assert_eq!(error_id(date, 35), "APP_INPUT_DATE_MULTILINE_INVALID");
    let mut time = input("time");
    time["rows"] = json!(2);
    assert_eq!(error_id(time, 35), "APP_INPUT_TIME_MULTILINE_INVALID");
    let mut date = input("date");
    date["step"] = json!(1);
    assert_eq!(error_id(date, 35), "APP_INPUT_DATE_STEP_UNSUPPORTED");
    let mut date = input("date");
    date["min"] = json!("2023-02-29");
    assert_eq!(error_id(date, 35), "APP_INPUT_DATE_BOUND_INVALID");
    let mut time = input("time");
    time["max"] = json!("24:00");
    assert_eq!(error_id(time, 35), "APP_INPUT_TIME_BOUND_INVALID");
    let mut time = input("time");
    time["step"] = json!(0);
    assert_eq!(error_id(time, 35), "APP_INPUT_TIME_STEP_INVALID");
}
