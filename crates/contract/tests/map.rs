use kaleidoscope_contract::{validate::parse_app_definition, Supported};
use serde_json::json;

fn app(block: serde_json::Value) -> String {
    json!({"id":"map-test","name":"지도 시험","requires":{"blocks":10,"modules":{}},"permissions":[],"state":{"selected":null},"ui":block}).to_string()
}

#[test]
fn map_contract_accepts_points_and_alias_and_checks_selection_and_coordinates() {
    for field in ["points", "markers"] {
        let mut block = json!({"type":"map","selected":{"state":"selected"},"on_select":{"set_state":"selected"}});
        block[field] = json!([{"key":"a","lat":37.5,"lng":127.0,"size":3.0}]);
        let def = parse_app_definition(&app(block)).unwrap();
        assert_eq!(def.ui.introduced_in(), 10);
        let mut old = Supported::current();
        old.blocks = 9;
        assert!(!old.renders(&def.requires));
    }
    for point in [
        json!({"key":"a","lat":91,"lng":0}),
        json!({"key":"a","lat":0,"lng":-181}),
        json!({"key":"a","lat":0,"lng":0,"size":-1}),
    ] {
        assert!(parse_app_definition(&app(json!({"type":"map","points":[point]}))).is_err());
    }
    assert!(parse_app_definition(&app(
        json!({"type":"map","points":[],"selected":{"state":"missing"}})
    ))
    .is_err());
    assert!(parse_app_definition(&app(json!({"type":"map","points":{}}))).is_err());
}
