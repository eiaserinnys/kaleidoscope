use kaleidoscope_contract::validate::{parse_app_definition, parse_cached_app_definition};
use serde_json::{json, Value};

fn app(kind: &str, blocks: u32) -> Value {
    let mut block = json!({"type":kind,"value":{"state":"value"},"on_change":{"set_state":"value"},"label":"Label"});
    if kind == "select" {
        block["options"] = json!({"state":"options"});
    }
    if kind == "slider" {
        block["min"] = json!(0);
        block["max"] = json!(100);
    }
    json!({"id":"field-layout-test","name":"Fields","requires":{"blocks":blocks,"modules":{}},"permissions":[],"state":{"value":0,"options":["one"]},"ui":block})
}

#[test]
fn positions_roundtrip_and_require_21() {
    for kind in ["input", "select", "slider", "color"] {
        for position in ["inline", "top", "hidden"] {
            let mut definition = app(kind, 21);
            definition["ui"]["label_position"] = json!(position);
            let parsed = parse_app_definition(&definition.to_string()).unwrap();
            let serialized = serde_json::to_value(parsed).unwrap();
            if position == "inline" {
                assert!(serialized["ui"].get("label_position").is_none());
            } else {
                assert_eq!(serialized["ui"]["label_position"], position);
            }
            assert_eq!(
                serde_json::to_value(parse_cached_app_definition(&serialized.to_string()).unwrap())
                    .unwrap(),
                serialized
            );
            definition["requires"]["blocks"] = json!(20);
            assert!(parse_app_definition(&definition.to_string()).is_err());
            assert!(parse_cached_app_definition(&definition.to_string()).is_err());
        }
    }
}

#[test]
fn slider_value_visibility_roundtrips_and_requires_21() {
    for shown in [true, false] {
        let mut definition = app("slider", 21);
        definition["ui"]["show_value"] = json!(shown);
        let serialized =
            serde_json::to_value(parse_app_definition(&definition.to_string()).unwrap()).unwrap();
        if shown {
            assert!(serialized["ui"].get("show_value").is_none());
        } else {
            assert_eq!(serialized["ui"]["show_value"], false);
        }
        assert_eq!(
            serde_json::to_value(parse_cached_app_definition(&serialized.to_string()).unwrap())
                .unwrap(),
            serialized
        );
        definition["requires"]["blocks"] = json!(20);
        assert!(parse_app_definition(&definition.to_string()).is_err());
    }
}

#[test]
fn sample_and_settings_obey_the_same_version_boundary() {
    let sample = include_str!("../../../examples/field-layout.json");
    parse_app_definition(sample).expect("sample app validates");
    let mut definition = app("input", 20);
    definition["ui"] = json!({"type":"text","value":"본문"});
    definition["settings"] = json!({"ui": {"type":"slider", "value":{"state":"value"}, "min":0, "max":100, "on_change":{"set_state":"value"}, "show_value":false}});
    assert!(parse_app_definition(&definition.to_string()).is_err());
    assert!(parse_cached_app_definition(&definition.to_string()).is_err());
    definition["requires"]["blocks"] = json!(21);
    assert!(parse_app_definition(&definition.to_string()).is_ok());
}

#[test]
fn schema_exposes_layout_fields() {
    let schema = kaleidoscope_contract::app_definition_schema().to_string();
    for expected in ["label_position", "show_value", "inline", "top", "hidden"] {
        assert!(schema.contains(expected), "schema omitted {expected}");
    }
}
