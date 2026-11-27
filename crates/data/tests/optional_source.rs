use kaleidoscope_contract::data::{BindingValue, SourceStatus};
use kaleidoscope_contract::validate::parse_app_definition;
use kaleidoscope_data::CompiledApp;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const EXTRA_POINTER: &str = "/ui/children/0/value";
const PLAIN_POINTER: &str = "/ui/children/1/value";

fn app(extra_optional: bool) -> CompiledApp {
    let mut extra = json!({"kind": "request", "permission": "api", "path": "/extra"});
    if extra_optional {
        extra["optional"] = json!(true);
    }
    let definition = parse_app_definition(
        &json!({
            "id": "optional-source", "name": "선택 원천",
            "requires": {"blocks": 71, "modules": {"connection": 1}},
            "permissions": [{"module": "connection", "id": "api", "connection": "test", "access": "readwrite", "label": "API"}],
            "sources": {
                "main": {"kind": "request", "permission": "api", "path": "/main"},
                "extra": extra,
                "plain": {"kind": "request", "permission": "api", "path": "/plain"}
            },
            "ui": {"type": "stack", "direction": "column", "children": [
                {"type": "text", "value": {"expr": "$count($data.main) & \"-\" & $count($data.extra)"}},
                {"type": "text", "value": {"expr": "$count($data.main) & \"-\" & $count($data.plain)"}}
            ]}
        })
        .to_string(),
    )
    .unwrap();
    CompiledApp::compile(&definition)
}

fn ready() -> SourceStatus {
    SourceStatus::Ready { updated_at: "now".into() }
}

fn failed(has_value: bool) -> SourceStatus {
    SourceStatus::Failed { message: "서버 오류".into(), has_value, id: None, details: Vec::new() }
}

fn evaluate(app: &CompiledApp, data: Value, extra: SourceStatus, plain: SourceStatus) -> BTreeMap<String, BindingValue> {
    let data: BTreeMap<String, Value> = serde_json::from_value(data).unwrap();
    let statuses = BTreeMap::from([("main".into(), ready()), ("extra".into(), extra), ("plain".into(), plain)]);
    app.evaluate(&BTreeMap::new(), &data, &statuses)
}

fn value(text: &str) -> BindingValue {
    BindingValue::Ready { value: json!(text), more: None }
}

#[test]
fn optional_source_still_loading_without_a_value_reads_as_missing() {
    let values = evaluate(&app(true), json!({"main": [1]}), SourceStatus::Loading { has_value: false }, ready());
    assert_eq!(values[EXTRA_POINTER], value("1-0"));
}

#[test]
fn optional_source_that_failed_on_the_first_fetch_reads_as_missing() {
    let values = evaluate(&app(true), json!({"main": [1]}), failed(false), ready());
    assert_eq!(values[EXTRA_POINTER], value("1-0"));
}

#[test]
fn optional_source_that_needs_a_login_reads_as_missing() {
    let status = SourceStatus::LoginRequired { permission: "api".into() };
    let values = evaluate(&app(true), json!({"main": [1]}), status, ready());
    assert_eq!(values[EXTRA_POINTER], value("1-0"));
}

#[test]
fn optional_source_with_a_value_is_read_as_before() {
    let values = evaluate(&app(true), json!({"main": [1], "extra": [1, 2]}), ready(), ready());
    assert_eq!(values[EXTRA_POINTER], value("1-2"));
}

#[test]
fn source_without_optional_still_loads_and_fails_the_whole_binding() {
    let app = app(false);
    let loading = evaluate(&app, json!({"main": [1]}), SourceStatus::Loading { has_value: false }, ready());
    assert_eq!(loading[EXTRA_POINTER], BindingValue::Loading {});
    let failure = evaluate(&app, json!({"main": [1]}), failed(false), ready());
    assert!(matches!(&failure[EXTRA_POINTER], BindingValue::Failed { retry, .. } if retry == &vec!["extra".to_owned()]));
}

#[test]
fn optional_does_not_change_how_other_sources_are_judged() {
    let app = app(true);
    let loading = evaluate(&app, json!({"main": [1]}), failed(false), SourceStatus::Loading { has_value: false });
    assert_eq!(loading[PLAIN_POINTER], BindingValue::Loading {});
    assert_eq!(loading[EXTRA_POINTER], value("1-0"));
    let failure = evaluate(&app, json!({"main": [1]}), SourceStatus::Loading { has_value: false }, failed(false));
    assert!(matches!(&failure[PLAIN_POINTER], BindingValue::Failed { retry, .. } if retry == &vec!["plain".to_owned()]));
}
