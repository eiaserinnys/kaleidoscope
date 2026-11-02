use kaleidoscope_contract::{
    data::{call_budget, CALL_BUDGET_PER_MINUTE},
    validate::parse_app_definition,
};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

fn parse(value: Value) -> kaleidoscope_contract::AppDefinition {
    parse_app_definition(&value.to_string()).unwrap()
}

fn budget(definition: &kaleidoscope_contract::AppDefinition, host: &str) -> (f64, f64) {
    let budgets = call_budget(definition);
    let item = budgets.iter().find(|item| item.host == host).unwrap();
    (item.default_per_minute, item.all_per_minute)
}

#[test]
fn every_builtin_stays_within_the_default_screen_budget() {
    let apps = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps");
    for entry in fs::read_dir(apps).unwrap() {
        let entry = entry.unwrap();
        if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let definition = parse(serde_json::from_slice(&fs::read(entry.path()).unwrap()).unwrap());
        for item in call_budget(&definition) {
            assert!(
                item.default_per_minute <= CALL_BUDGET_PER_MINUTE,
                "{} calls {} {} times per minute on its default screen",
                definition.id,
                item.host,
                item.default_per_minute
            );
        }
    }
}

#[test]
fn market_default_and_all_binance_call_rates_are_measured() {
    let definition =
        parse(serde_json::from_slice(include_bytes!("../../../apps/market.json")).unwrap());
    let (default, all) = budget(&definition, "api.binance.com");
    assert_eq!(default, 2.0);
    assert!((all - 3.6).abs() < 0.0001);
}

#[test]
fn an_over_budget_definition_is_reported_as_over_budget() {
    let definition = parse(json!({
        "id":"too-many-calls", "name":"호출 초과", "requires":{"blocks":4,"modules":{"http":1}},
        "permissions":[{"module":"http","id":"api","label":"API","base_url":"https://example.com","paths":["/a","/b"]}],
        "state":{},
        "sources":{
            "a":{"kind":"request","permission":"api","path":"/a","refresh_secs":10},
            "b":{"kind":"request","permission":"api","path":"/b","refresh_secs":10}
        },
        "ui":{"type":"text","value":{"expr":"$data.a & $data.b"}}
    }));
    assert!(budget(&definition, "example.com").0 > CALL_BUDGET_PER_MINUTE);
}

#[test]
fn default_tab_and_collapsed_section_determine_live_sources() {
    let definition = parse(json!({
        "id":"default-screen", "name":"기본 화면", "requires":{"blocks":4,"modules":{"http":1}},
        "permissions":[{"module":"http","id":"api","label":"API","base_url":"https://example.com","paths":["/a","/b"]}],
        "state":{"tab":1},
        "sources":{
            "first":{"kind":"request","permission":"api","path":"/a","refresh_secs":30},
            "second":{"kind":"request","permission":"api","path":"/b","refresh_secs":60},
            "collapsed":{"kind":"request","permission":"api","path":"/a","refresh_secs":60}
        },
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"tabs","selected":{"state":"tab"},"tabs":[
                {"label":"첫째","child":{"type":"text","value":{"expr":"$data.first"}}},
                {"label":"둘째","child":{"type":"text","value":{"expr":"$data.second"}}}
            ]},
            {"type":"section","title":"접힘","collapsed":true,"child":{"type":"text","value":{"expr":"$data.collapsed"}}}
        ]}
    }));
    let (default, all) = budget(&definition, "example.com");
    assert_eq!(default, 1.0);
    assert_eq!(all, 4.0);
}
