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

#[test]
fn worker_action_evaluates_arguments_in_event_context() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["ui"]["children"][0]["on_select"] =
        json!([{"worker":{"action":"run","args":{"expr":"$event"}}}]);
    let app = CompiledApp::compile(&serde_json::from_value(definition).unwrap());
    let empty = BTreeMap::new();
    let event = json!({"value":"선택"});
    let item = Value::Null;
    let env = Env {
        state: &empty,
        data: &empty,
        data_meta: &empty,
        storage: &empty,
        storage_meta: &empty,
        event: &event,
        item: &item,
    };
    assert_eq!(
        app.action_step("/ui/children/0/on_select", 0, &env)
            .unwrap(),
        Step::Worker {
            action: "run".into(),
            args: Some(event.clone())
        }
    );
}
fn map(value: Value) -> BTreeMap<String, Value> {
    serde_json::from_value(value).unwrap()
}

#[test]
fn source_meta_is_available_without_waiting_for_source_value() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["ui"]["children"][1]["value"] = json!({"expr":"$data_meta.a.updated_time"});
    let app = CompiledApp::compile(&serde_json::from_value(definition).unwrap());
    let meta = map(json!({"a":{"state":"failed","updated_time":"16:10","stale":true}}));
    let statuses = BTreeMap::from([(
        "a".into(),
        SourceStatus::Failed {
            message: "실패".into(),
            has_value: false,
        },
    )]);
    let values = app.evaluate_with_data_meta(
        &BTreeMap::new(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &meta,
        &statuses,
        None,
    );
    assert_eq!(
        values["/ui/children/1/value"],
        BindingValue::Ready {
            value: json!("16:10")
        }
    );
    assert_eq!(app.binding_dependencies()[1].data_meta, vec!["a"]);
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
        data_meta: &BTreeMap::new(),
        storage: &BTreeMap::new(),
        storage_meta: &BTreeMap::new(),
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
        data_meta: &BTreeMap::new(),
        storage: &BTreeMap::new(),
        storage_meta: &BTreeMap::new(),
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
fn storage_values_flow_through_expressions_source_plans_and_actions() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["sources"]["a"]["path"] = json!({"expr":"$storage.path"});
    definition["ui"]["children"][0]["items"] = json!({"expr":"$storage.name"});
    definition["ui"]["children"][0]["on_select"] = json!([
        {"set_storage":{"entry":"selection","value":{"expr":"$event"}}}
    ]);
    definition["ui"]["children"][1]["value"] = json!({"expr":"$storage_meta.bucket_id"});
    let definition: AppDefinition = serde_json::from_value(definition).unwrap();
    let app = CompiledApp::compile(&definition);
    let state = map(json!({"path":"/old"}));
    let data = BTreeMap::new();
    let storage = map(json!({"path":"/stored","name":"Stored"}));
    let storage_meta = map(json!({"bucket_id":"account-app"}));

    assert!(matches!(
        app.plan_source_with_storage("a", &state, &storage, &storage_meta),
        SourcePlan::Request { path, .. } if path == "/stored"
    ));
    let values =
        app.evaluate_with_storage(&state, &data, &storage, &storage_meta, &BTreeMap::new());
    assert_eq!(
        values["/ui/children/0/items"],
        BindingValue::Ready {
            value: json!("Stored")
        }
    );
    assert_eq!(
        values["/ui/children/1/value"],
        BindingValue::Ready {
            value: json!("account-app")
        }
    );
    let dependency = app
        .binding_dependencies()
        .iter()
        .find(|dependency| dependency.pointer == "/ui/children/0/items")
        .unwrap();
    assert_eq!(dependency.storage, vec!["name"]);

    let event = json!("model-sol");
    let item = Value::Null;
    let env = Env {
        state: &state,
        data: &data,
        data_meta: &BTreeMap::new(),
        storage: &storage,
        storage_meta: &storage_meta,
        event: &event,
        item: &item,
    };
    assert_eq!(
        app.action_step("/ui/children/0/on_select", 0, &env)
            .unwrap(),
        Step::SetStorage {
            entry: "selection".into(),
            value: json!("model-sol")
        }
    );
}

#[test]
fn storage_choices_bindings_are_evaluated_and_track_data_and_storage_dependencies() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["requires"]["blocks"] = json!(6);
    definition["requires"]["modules"]["storage"] = json!(2);
    definition["storage"] = json!({"entries":[
        {"id":"models","key":"settings/models","kind":"json","schema":{"type":"array","items":{"type":"string"}},"default":["argon"],"label":"Models","presentation":"settings","choices":{"expr":"$data.a[active=true].code"}},
        {"id":"selection","key":"settings/selection","kind":"json","schema":{"type":["string","null"]},"default":null,"label":"Selection","presentation":"settings","choices":{"expr":"$storage.models"}}
    ]});
    let definition: AppDefinition = serde_json::from_value(definition).unwrap();
    let app = CompiledApp::compile(&definition);
    let data =
        map(json!({"a":[{"code":"model-a","active":true},{"code":"model-b","active":false}]}));
    let storage = map(json!({"models":["model-a","model-b"]}));
    let values = app.evaluate_with_storage(
        &BTreeMap::new(),
        &data,
        &storage,
        &BTreeMap::new(),
        &BTreeMap::new(),
    );

    assert_eq!(
        values["/storage/entries/0/choices"],
        BindingValue::Ready {
            value: json!("model-a")
        }
    );
    assert_eq!(
        values["/storage/entries/1/choices"],
        BindingValue::Ready {
            value: json!(["model-a", "model-b"])
        }
    );
    let data_dependency = app
        .binding_dependencies()
        .iter()
        .find(|dependency| dependency.pointer == "/storage/entries/0/choices")
        .unwrap();
    assert_eq!(data_dependency.data, vec!["a"]);
    let storage_dependency = app
        .binding_dependencies()
        .iter()
        .find(|dependency| dependency.pointer == "/storage/entries/1/choices")
        .unwrap();
    assert_eq!(storage_dependency.storage, vec!["models"]);
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
