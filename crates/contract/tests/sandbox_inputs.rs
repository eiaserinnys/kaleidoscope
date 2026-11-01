use kaleidoscope_contract::{validate::parse_app_definition, Supported};
use serde_json::{json, Value};

fn app(ui: Value) -> String {
    json!({"id":"interactive-test", "name":"상호작용 시험", "requires":{"blocks":11,"modules":{"assets":1,"storage":1}},
        "permissions":[], "assets":[{"id":"page","version":1}], "state":{"amount":50,"color":"#000000"},
        "storage":{"entries":[{"id":"draft","key":"draft","kind":"md","label":"문서","presentation":"hidden","default":""}]},
        "ui":ui}).to_string()
}

#[test]
fn sandbox_sources_and_input_controls_follow_contract_eleven() {
    for block in [
        json!({"type":"sandbox","asset":"page","state_keys":["amount"],"storage_entries":["draft"]}),
        json!({"type":"interactive_html","value":"<canvas></canvas>"}),
        json!({"type":"sandbox","document":{"entry":"draft"}}),
        json!({"type":"slider","value":{"state":"amount"},"on_change":{"set_state":"amount"},"min":0,"max":100,"step":5}),
        json!({"type":"color","value":{"state":"color"},"on_change":{"set_state":"color"}}),
    ] {
        let definition = parse_app_definition(&app(block)).unwrap();
        assert_eq!(definition.ui.introduced_in(), 11);
        let mut old = Supported::current();
        old.blocks = 10;
        assert!(!old.renders(&definition.requires));
    }
    for block in [
        json!({"type":"sandbox"}),
        json!({"type":"sandbox","asset":"page","value":"x"}),
        json!({"type":"sandbox","asset":"unknown"}),
        json!({"type":"sandbox","value":"x","state_keys":["missing"]}),
        json!({"type":"sandbox","value":"x","storage_entries":["missing"]}),
        json!({"type":"slider","value":{"state":"amount"},"on_change":{"set_state":"amount"},"min":2,"max":1}),
        json!({"type":"color","value":{"state":"missing"},"on_change":{"set_state":"color"}}),
    ] {
        assert!(parse_app_definition(&app(block)).is_err());
    }
}

#[test]
fn interactive_app_layout_passes_validation() {
    let ui = json!({"type":"stack","direction":"column","gap":"small","fill":2,"children":[
        {"type":"toolbar","start":[
            {"type":"select","value":{"state":"color"},"on_change":{"set_state":"color"},"options":["a","b"]},
            {"type":"slider","value":{"state":"amount"},"on_change":{"set_state":"amount"},"min":0,"max":100},
            {"type":"color","value":{"state":"color"},"on_change":{"set_state":"color"}}
        ]},
        {"type":"section","title":"입력","collapsible":true,"collapsed":true,"child":{"type":"input","value":{"state":"color"},"on_change":{"set_state":"color"},"rows":4}},
        {"type":"sandbox","asset":"page","state_keys":["amount","color"],"storage_entries":["draft"]}
    ]});
    parse_app_definition(&app(ui)).unwrap();
}

#[test]
fn sandbox_min_height_alias_is_validated_and_serialized_as_height() {
    for kind in ["sandbox", "interactive_html"] {
        let parsed = parse_app_definition(&app(json!({
            "type": kind, "value": "<canvas></canvas>", "min_height": 620
        })))
        .unwrap();
        let normalized = serde_json::to_value(&parsed.ui).unwrap();
        assert_eq!(normalized["height"], 620);
        assert!(normalized.get("min_height").is_none());
        for invalid in [119, 2401] {
            assert!(parse_app_definition(&app(json!({
                "type": kind, "value": "<canvas></canvas>", "min_height": invalid
            })))
            .is_err());
        }
    }
}
