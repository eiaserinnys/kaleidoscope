use kaleidoscope_contract::data::{ListDot, ListItem, MetricTone};
use kaleidoscope_contract::validate::parse_app_definition;
use kaleidoscope_contract::{Block, BLOCK_SET_VERSION, LIST_DOT_TONE_BLOCK_SET_VERSION as N};
use serde_json::{json, Value};

fn item(dot: Value) -> serde_json::Result<ListItem> {
    serde_json::from_value(json!({"key": "a", "title": "가", "dot": dot}))
}

fn list(layout: &str, items: Value) -> Block {
    serde_json::from_value(json!({"type": "list", "layout": layout, "items": items})).unwrap()
}

fn app(blocks: u32, layout: &str, items: Value) -> String {
    json!({
        "id": "test-list-dot", "name": "점",
        "requires": {"blocks": blocks, "modules": {}}, "permissions": [],
        "ui": {"type": "list", "layout": layout, "items": items}
    })
    .to_string()
}

#[test]
fn dot_reads_bool_and_six_tones_and_round_trips_in_the_same_shape() {
    assert_eq!(item(json!(true)).unwrap().dot, Some(ListDot::On(true)));
    assert_eq!(item(json!(false)).unwrap().dot, Some(ListDot::On(false)));
    let none: ListItem = serde_json::from_value(json!({"key": "a", "title": "가"})).unwrap();
    assert_eq!(none.dot, None);
    for (name, tone) in [
        ("default", MetricTone::Default),
        ("muted", MetricTone::Muted),
        ("positive", MetricTone::Positive),
        ("negative", MetricTone::Negative),
        ("warning", MetricTone::Warning),
        ("error", MetricTone::Error),
    ] {
        let parsed = item(json!(name)).unwrap();
        assert_eq!(parsed.dot, Some(ListDot::Tone(tone)));
        assert_eq!(serde_json::to_value(&parsed).unwrap()["dot"], json!(name));
    }
    assert_eq!(serde_json::to_value(item(json!(true)).unwrap()).unwrap()["dot"], json!(true));
    assert_eq!(serde_json::to_value(item(json!(false)).unwrap()).unwrap()["dot"], json!(false));
    assert!(serde_json::to_value(none).unwrap().get("dot").is_none());
}

#[test]
fn dot_rejects_strings_that_are_not_a_tone() {
    assert!(item(json!("green")).is_err());
    assert!(item(json!("#00ff00")).is_err());
}

#[test]
fn block_set_is_70() {
    assert_eq!(N, 70);
    assert_eq!(BLOCK_SET_VERSION, 70);
}

#[test]
fn introduced_in_asks_the_new_set_only_for_what_is_new() {
    let tone = json!([{"key": "a", "title": "가", "dot": "positive"}]);
    let on = json!([{"key": "a", "title": "가", "dot": true}]);
    let off = json!([{"key": "a", "title": "가", "dot": false}, {"key": "b", "title": "나"}]);
    for layout in ["rows", "icons", "grid"] {
        assert_eq!(list(layout, tone.clone()).introduced_in(), N, "{layout} tone");
    }
    assert_eq!(list("rows", on.clone()).introduced_in(), N);
    assert!(list("icons", on.clone()).introduced_in() < N);
    assert!(list("grid", on).introduced_in() < N);
    assert!(list("rows", off).introduced_in() < N);
    let default_layout: Block = serde_json::from_value(json!({"type": "list", "items": [{"key": "a", "title": "가", "dot": true}]})).unwrap();
    assert_eq!(default_layout.introduced_in(), N);
}

#[test]
fn introduced_in_sees_dots_inside_grouped_literals() {
    let grouped = json!([{"title": "묶음", "items": [{"key": "a", "title": "가", "dot": "warning"}]}]);
    assert_eq!(list("rows", grouped).introduced_in(), N);
}

#[test]
fn definition_with_a_literal_tone_dot_needs_blocks_70() {
    let tone = json!([{"key": "a", "title": "가", "dot": "positive"}]);
    assert!(parse_app_definition(&app(N, "rows", tone.clone())).is_ok());
    assert!(parse_app_definition(&app(69, "rows", tone)).is_err());
    let on = json!([{"key": "a", "title": "가", "dot": true}]);
    assert!(parse_app_definition(&app(69, "rows", on)).is_err());
    let icons_on = json!([{"key": "a", "title": "가", "dot": true}]);
    assert!(parse_app_definition(&app(30, "icons", icons_on)).is_ok());
}

#[test]
fn store_app_with_an_expression_dot_still_parses() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/store.json");
    let text = std::fs::read_to_string(path).expect("apps/store.json을 읽는다");
    parse_app_definition(&text).expect("식으로 준 dot은 판을 올리지 않는다");
}
