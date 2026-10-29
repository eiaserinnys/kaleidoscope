use kaleidoscope_contract::{
    data::{BindingValue, SourceStatus},
    AppDefinition,
};
use kaleidoscope_data::{CompiledApp, Env, SourcePlan, Step};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn fixture() -> AppDefinition {
    serde_json::from_value(json!({
        "id":"generic", "name":"Generic", "requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"test","access":"readwrite","label":"API"}],
        "state":{"path":null,"selected":null},
        "sources":{
            "a":{"kind":"request","permission":"api","path":{"state":"path"},"query":{"n":3,"flag":true,"missing":null}},
            "b":{"kind":"request","permission":"api","path":"/names"}
        },
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"list","items":{"expr":"$data.a[active = true].{\"key\": code, \"title\": $data.b[code = $$.code].name}"},"on_select":[
                {"set_state":"selected","value":{"expr":"$item.key"}},
                {"refresh":["a"]},
                {"call":{"permission":"api","method":"POST","path":"/write","body":{"expr":"$event"}}}
            ]},
            {"type":"text","value":{"expr":"$state.selected"}},
            {"type":"text","value":{"expr":"$data.b.name"}}
        ]}
    })).unwrap()
}
fn map(value: Value) -> BTreeMap<String, Value> {
    serde_json::from_value(value).unwrap()
}

#[test]
fn source_plans_handle_null_query_and_invalid_path() {
    let app = CompiledApp::compile(&fixture());
    let mut state = map(json!({"path":null}));
    assert_eq!(app.plan_source("a", &state), SourcePlan::Idle);
    state.insert("path".into(), json!("/list"));
    match app.plan_source("a", &state) {
        SourcePlan::Request { path, query, .. } => {
            assert_eq!(path, "/list");
            assert_eq!(
                query,
                map(json!({"n":"3","flag":"true"}))
                    .into_iter()
                    .map(|(k, v)| (k, v.as_str().unwrap().to_owned()))
                    .collect()
            );
        }
        plan => panic!("unexpected {plan:?}"),
    }
    state.insert("path".into(), json!("/../outside"));
    assert!(matches!(
        app.plan_source("a", &state),
        SourcePlan::Invalid(_)
    ));
}

#[test]
fn source_status_is_scoped_to_each_expression_and_actions_are_ordered() {
    let app = CompiledApp::compile(&fixture());
    let state = map(json!({"selected":"old"}));
    let data = map(json!({"b":[{"code":"a","name":"Alpha"}]}));
    let statuses = BTreeMap::from([
        ("a".into(), SourceStatus::Loading { has_value: false }),
        (
            "b".into(),
            SourceStatus::Ready {
                updated_at: "now".into(),
            },
        ),
    ]);
    let values = app.evaluate(&state, &data, &statuses);
    assert_eq!(values["/ui/children/0/items"], BindingValue::Loading {});
    assert_eq!(
        values["/ui/children/1/value"],
        BindingValue::Ready {
            value: json!("old")
        }
    );
    assert!(matches!(
        values["/ui/children/2/value"],
        BindingValue::Ready { .. }
    ));
    let statuses = BTreeMap::from([(
        "a".into(),
        SourceStatus::Failed {
            message: "failed".into(),
            has_value: false,
        },
    )]);
    let values = app.evaluate(&state, &data, &statuses);
    assert!(
        matches!(&values["/ui/children/0/items"],BindingValue::Failed{retry,..} if retry == &vec!["a".to_owned()])
    );
    let event = json!("picked");
    let item = json!({"key":"item"});
    let env = Env {
        state: &state,
        data: &data,
        event: &event,
        item: &item,
    };
    assert_eq!(app.actions_len("/ui/children/0/on_select"), Some(3));
    assert_eq!(
        app.action_step("/ui/children/0/on_select", 0, &env)
            .unwrap(),
        Step::SetState {
            key: "selected".into(),
            value: json!("item")
        }
    );
    assert_eq!(
        app.action_step("/ui/children/0/on_select", 1, &env)
            .unwrap(),
        Step::Refresh {
            names: vec!["a".into()]
        }
    );
}

#[test]
fn explicit_null_differs_from_missing_value() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["ui"]["children"][0]["on_select"] = json!([
        {"set_state":"selected","value":null},{"set_state":"selected"}
    ]);
    let definition: AppDefinition = serde_json::from_value(definition).unwrap();
    let app = CompiledApp::compile(&definition);
    let state = BTreeMap::new();
    let data = BTreeMap::new();
    let event = json!("event");
    let item = Value::Null;
    let env = Env {
        state: &state,
        data: &data,
        event: &event,
        item: &item,
    };
    assert_eq!(
        app.action_step("/ui/children/0/on_select", 0, &env)
            .unwrap(),
        Step::SetState {
            key: "selected".into(),
            value: Value::Null
        }
    );
    assert_eq!(
        app.action_step("/ui/children/0/on_select", 1, &env)
            .unwrap(),
        Step::SetState {
            key: "selected".into(),
            value: json!("event")
        }
    );
}

#[test]
fn transforms_join_groups_and_limit_recursion() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["ui"] = json!({"type":"stack","direction":"column","children":[
        {"type":"text","value":{"expr":"[$data.a[active=true].{\"key\":code,\"title\":name}]"}},
        {"type":"text","value":{"expr":"[$data.a.($row := $; {\"key\":$row.code,\"title\":$lookup($data.b,$row.code)})]"}},
        {"type":"text","value":{"expr":"$data.a{group: $count(code)}"}},
        {"type":"text","value":{"expr":"($f := function($n) { $f($n + 1) }; $f(0))"}}
    ]});
    let definition: AppDefinition = serde_json::from_value(definition).unwrap();
    let app = CompiledApp::compile(&definition);
    let data = map(
        json!({"a":[{"code":"x","name":"X","active":true,"group":"A"},{"code":"y","name":"Y","active":false,"group":"A"}],"b":{"x":"Xavier","y":"Yara"}}),
    );
    let values = app.evaluate(&BTreeMap::new(), &data, &BTreeMap::new());
    assert_eq!(
        values["/ui/children/0/value"],
        BindingValue::Ready {
            value: json!([{"key":"x","title":"X"}])
        }
    );
    assert_eq!(
        values["/ui/children/1/value"],
        BindingValue::Ready {
            value: json!([{"key":"x","title":"Xavier"},{"key":"y","title":"Yara"}])
        }
    );
    assert!(
        matches!(&values["/ui/children/2/value"], BindingValue::Ready { value } if value["A"].as_f64() == Some(2.0))
    );
    assert!(matches!(
        values["/ui/children/3/value"],
        BindingValue::Failed { .. }
    ));
}
