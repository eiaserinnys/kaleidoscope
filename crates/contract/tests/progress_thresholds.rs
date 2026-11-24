use kaleidoscope_contract::{
    app_definition_schema, validate::parse_app_definition, BLOCK_SET_VERSION,
};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "progress-thresholds-test", "name": "진행 막대 색 기준 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {}, "ui": ui
    })
}

#[test]
fn inline_progress_label_round_trips_and_requires_block_set_68() {
    let ui = json!({"type": "progress", "value": 42, "max": 100, "label": "사용량", "label_position": "inline"});
    assert!(parse_app_definition(&definition(ui.clone(), 67).to_string()).is_err());
    let parsed = parse_app_definition(&definition(ui, 68).to_string()).unwrap();
    assert_eq!(parsed.ui.introduced_in(), 68);
    assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["label_position"], "inline");
    assert!(app_definition_schema().to_string().contains("label_position"));
    let old = parse_app_definition(&definition(json!({"type": "progress", "value": 1, "max": 2}), 14).to_string()).unwrap();
    assert!(serde_json::to_value(old).unwrap()["ui"].get("label_position").is_none());
}

#[test]
fn thresholds_round_trip_and_require_block_set_65() {
    assert!(BLOCK_SET_VERSION >= 65);
    for value in [79, 80, 94, 95] {
        let ui = json!({"type": "progress", "value": value, "max": 100, "warning_at": 80, "danger_at": 95});
        assert!(parse_app_definition(&definition(ui.clone(), 64).to_string()).is_err());
        let parsed = parse_app_definition(&definition(ui, 65).to_string()).unwrap();
        assert_eq!(parsed.ui.introduced_in(), 65);
        let encoded = serde_json::to_value(parsed).unwrap();
        assert_eq!(encoded["ui"]["warning_at"], json!(80.0));
        assert_eq!(encoded["ui"]["danger_at"], json!(95.0));
    }
    for field in ["warning_at", "danger_at"] {
        let mut ui = json!({"type": "progress", "value": 1, "max": 2});
        ui[field] = json!(1);
        assert!(parse_app_definition(&definition(ui.clone(), 64).to_string()).is_err());
        parse_app_definition(&definition(ui, 65).to_string()).unwrap();
        assert!(app_definition_schema()
            .to_string()
            .contains(&format!("\"{field}\"")));
    }
    let parsed = parse_app_definition(
        &definition(json!({"type": "progress", "value": 95, "max": 100}), 14).to_string(),
    )
    .unwrap();
    assert_eq!(parsed.ui.introduced_in(), 14);
    assert!(serde_json::to_value(parsed).unwrap()["ui"]
        .get("warning_at")
        .is_none());
}
