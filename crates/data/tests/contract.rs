use kaleidoscope_contract::{
    data::{BindingValue, SourceStatus},
    AppDefinition,
};
use kaleidoscope_data::{evaluate_page_next, CompiledApp, Env, SourcePlan, Step};
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
fn store_sources_resolve_bindings_and_stay_idle_for_null() {
    let mut value = serde_json::to_value(fixture()).unwrap();
    value["sources"] = json!({
        "index":{"kind":"store","store":"index","permission":"catalog","server":{"state":"server"}},
        "detail":{"kind":"store","store":"app","permission":"catalog","server":{"state":"server"},"id":{"state":"selected"}}
    });
    let app = CompiledApp::compile(&serde_json::from_value(value).unwrap());
    let state = map(json!({"server":"https://store.example", "selected":"notes"}));
    assert!(matches!(app.plan_source("index", &state), SourcePlan::StoreIndex { permission, server } if permission == "catalog" && server == "https://store.example"));
    assert!(matches!(app.plan_source("detail", &state), SourcePlan::StoreApp { permission, server, id } if permission == "catalog" && server == "https://store.example" && id == "notes"));
    let mut state = state;
    state.insert("selected".into(), Value::Null);
    assert_eq!(app.plan_source("detail", &state), SourcePlan::Idle);
    state.insert("server".into(), Value::Null);
    assert_eq!(app.plan_source("index", &state), SourcePlan::Idle);
    state.insert("server".into(), json!(123));
    assert!(matches!(app.plan_source("index", &state), SourcePlan::StoreInvalid(error) if error.id.as_deref() == Some("STORECLIENT_INDEX_SERVER_INVALID")));
    state.insert("server".into(), json!("https://store.example"));
    state.insert("selected".into(), json!(123));
    assert!(matches!(app.plan_source("detail", &state), SourcePlan::StoreInvalid(error) if error.id.as_deref() == Some("STORECLIENT_DETAIL_ID_INVALID")));
}

#[test]
fn store_indexes_plan_validates_the_server_list() {
    let mut value = serde_json::to_value(fixture()).unwrap();
    value["sources"] = json!({"indexes":{"kind":"store","store":"indexes","permission":"catalog","servers":{"state":"servers"}}});
    let app = CompiledApp::compile(&serde_json::from_value(value).unwrap());
    for servers in [Value::Null, json!([])] {
        assert_eq!(app.plan_source("indexes", &map(json!({"servers":servers}))), SourcePlan::Idle);
    }
    for (servers, position) in [(json!(42), "servers"), (json!(["https://example.com", 42]), "servers[1]")] {
        let plan = app.plan_source("indexes", &map(json!({"servers":servers})));
        assert!(matches!(plan, SourcePlan::StoreInvalid(error) if error.id.as_deref() == Some("STORECLIENT_INDEXES_SERVERS_INVALID") && error.message.contains(position)));
    }
    let plan = app.plan_source("indexes", &map(json!({"servers":["https://example.com"]})));
    assert_ne!(plan, SourcePlan::Idle);
    assert!(!matches!(plan, SourcePlan::StoreInvalid(_)));
}

#[test]
fn store_actions_resolve_event_and_state_bindings() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["ui"]["children"][0]["on_select"] = json!([
        {"store.install":{"permission":"catalog","server":"https://store.example","id":{"state":"selected"},"release":{"expr":"$event.release"}}},
        {"store.remove":{"permission":"catalog","id":{"state":"selected"}}}
    ]);
    let app = CompiledApp::compile(&serde_json::from_value(definition).unwrap());
    let state = map(json!({"selected":"notes"}));
    let empty = BTreeMap::new();
    let event = json!({"release":2});
    let env = Env { state: &state, data: &empty, data_meta: &empty, storage: &empty, storage_meta: &empty, apps: None, event: &event, item: &Value::Null, modifiers: None };
    assert_eq!(app.action_step("/ui/children/0/on_select", 0, &env).unwrap(), Step::StoreInstall { permission:"catalog".into(), server:json!("https://store.example"), id:json!("notes"), release:json!(2.0) });
    assert_eq!(app.action_step("/ui/children/0/on_select", 1, &env).unwrap(), Step::StoreRemove { permission:"catalog".into(), id:json!("notes") });
}

#[test]
fn list_group_action_evaluates_original_item_and_action_event() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["ui"]["children"][0]["group_actions"] = json!([{
        "key":"retry", "label":"다시 받기", "on_click":[
            {"set_state":"selected", "value":{"expr":"{'address': $item.address, 'action': $event}"}}
        ]
    }]);
    let app = CompiledApp::compile(&serde_json::from_value(definition).unwrap());
    let empty = BTreeMap::new();
    let event = json!("retry");
    let item = json!({"title":"둘째", "items":[], "address":"local", "action":"retry"});
    let env = Env { state:&empty, data:&empty, data_meta:&empty, storage:&empty, storage_meta:&empty, apps:None, event:&event, item:&item, modifiers:None };
    assert_eq!(app.action_step("/ui/children/0/group_actions/0/on_click", 0, &env).unwrap(),
        Step::SetState { key:"selected".into(), value:json!({"address":"local", "action":"retry"}) });
}

#[test]
fn apps_expression_only_recalculates_the_selected_binding() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["ui"]["children"][1]["value"] = json!({"expr":"$count($apps)"});
    let app = CompiledApp::compile(&serde_json::from_value(definition).unwrap());
    let apps = vec![serde_json::from_value(json!({"id":"notes","name":"메모","version":1,"origin":null,"installed_version":null,"modified":false,"icon":null})).unwrap()];
    let selected = app.binding_dependencies().iter().filter(|b| b.apps).map(|b| b.pointer.clone()).collect();
    let mut evaluated = Vec::new();
    let values = app.evaluate_profiled(&BTreeMap::new(), &BTreeMap::new(), &BTreeMap::new(), &BTreeMap::new(), &BTreeMap::new(), Some(&apps), &BTreeMap::new(), Some(&selected), &mut |binding, _| evaluated.push(binding.pointer.clone()));
    assert_eq!(evaluated, vec!["/ui/children/1/value"]);
    assert!(matches!(&values["/ui/children/1/value"], BindingValue::Ready { value, .. } if value.as_f64() == Some(1.0)));
    assert!(!kaleidoscope_contract::data::apps_ref("'$apps' & $apps_extra /* $apps */"));
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
        apps: None,
        event: &event,
        item: &item,
        modifiers: None,
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

#[test]
fn set_storage_resolves_collection_doc_from_window_state() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["requires"]["modules"]["storage"] = json!(3);
    definition["storage"] = json!({"entries":[{
        "id":"docs", "key":"documents", "kind":"md", "collection":true,
        "default":"", "label":"문서", "presentation":"hidden"
    }]});
    definition["ui"]["children"][0]["on_select"] = json!([{
        "set_storage":{"entry":"docs","doc":{"state":"selected"},"value":{"expr":"$event"}}
    }]);
    let app = CompiledApp::compile(&serde_json::from_value(definition).unwrap());
    let state = map(json!({"path":null,"selected":"draft.md"}));
    let empty = BTreeMap::new();
    let event = json!("문서 본문");
    let item = Value::Null;
    let env = Env {
        state: &state,
        data: &empty,
        data_meta: &empty,
        storage: &empty,
        storage_meta: &empty,
        apps: None,
        event: &event,
        item: &item,
        modifiers: None,
    };
    assert_eq!(
        app.action_step("/ui/children/0/on_select", 0, &env)
            .unwrap(),
        Step::SetStorage {
            entry: "docs".into(),
            doc: Some("draft.md".into()),
            value: event,
        }
    );
}
fn map(value: Value) -> BTreeMap<String, Value> {
    serde_json::from_value(value).unwrap()
}

#[test]
fn url_encoding_follows_javascript_in_page_and_source_expressions() {
    let cases = [
        ("$encodeUrlComponent('tweet-2117_a.b~c')", "tweet-2117_a.b~c"),
        ("$encodeUrlComponent(\"a b/c?d=é!'()*\")", "a%20b%2Fc%3Fd%3D%C3%A9!'()*"),
        ("$encodeUrl('https://x.com/a b?q=1&r=é')", "https://x.com/a%20b?q=1&r=%C3%A9"),
    ];
    let actual: Vec<_> = cases.iter().map(|(expression, _)| evaluate_page_next(expression, &Value::Null, 0, 0).unwrap()).collect();
    let expected: Vec<_> = cases.iter().map(|(_, expected)| json!(expected)).collect();
    assert_eq!(actual, expected);
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["sources"]["a"]["path"] = json!({"expr": "'/a/' & $encodeUrlComponent('tweet-2117_a.b~c')"});
    let app = CompiledApp::compile(&serde_json::from_value(definition).unwrap());
    assert!(matches!(app.plan_source("a", &BTreeMap::new()), SourcePlan::Request { path, .. } if path == "/a/tweet-2117_a.b~c"));
}

#[test]
fn url_encoding_keeps_existing_argument_behavior() {
    use jsonata_core::{evaluator::Evaluator, parser, value::JValue};
    for expression in ["$encodeUrlComponent(null)", "$encodeUrlComponent(42)", "$encodeUrlComponent(missing)", "$encodeUrl(null)", "$encodeUrl(42)", "$encodeUrl(missing)"] {
        for context in [json!(null), json!("a b"), json!(42)] {
            let ast = parser::parse(expression).unwrap();
            let expected = Evaluator::new().evaluate(&ast, &JValue::from(context.clone()))
                .map(|value| Value::from(&value)).map_err(|error| error.to_string());
            let actual = evaluate_page_next(expression, &context, 0, 0);
            assert_eq!(actual, expected, "{expression}, context {context}");
        }
    }
}

#[test]
fn url_encoding_without_an_argument_reports_what_to_supply() {
    for name in ["encodeUrlComponent", "encodeUrl"] {
        let error = evaluate_page_next(&format!("${name}()"), &json!("a b"), 0, 0).unwrap_err();
        assert!(error.contains(&format!("${name}에 인코딩할 글을 인자로 주세요")), "{error}");
    }
}

#[test]
fn url_encoding_functions_work_as_map_callbacks() {
    for (expression, expected) in [
        ("$map(['a-b','a b'], $encodeUrlComponent)", json!(["a-b", "a%20b"])),
        ("$map(['https://x.test/a b?q=1','https://x.test/c d'], $encodeUrl)", json!(["https://x.test/a%20b?q=1", "https://x.test/c%20d"])),
    ] {
        assert_eq!(evaluate_page_next(expression, &Value::Null, 0, 0).unwrap(), expected);
    }
}

#[test]
fn source_pipeline_plans_in_dependency_order() {
    let mut definition = serde_json::to_value(fixture()).unwrap();
    definition["sources"] = json!({
        "a": {"kind":"request","permission":"api","path":{"expr":"'/a/' & $data.b.id"}},
        "b": {"kind":"request","permission":"api","path":{"expr":"'/b/' & $data.c.id"}},
        "c": {"kind":"request","permission":"api","path":"/c"}
    });
    let app = CompiledApp::compile(&serde_json::from_value(definition).unwrap());
    assert_eq!(app.source_order(), ["c", "b", "a"]);
    assert_eq!(app.source_dependencies("a"), ["b"]);
    let data = map(json!({"b":{"id":"42"}}));
    assert!(
        matches!(app.plan_source_with_data_and_storage("a", &BTreeMap::new(), &data, &BTreeMap::new(), &BTreeMap::new()), SourcePlan::Request { path, .. } if path == "/a/42")
    );
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
            id: None,
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
            value: json!("16:10"), more: None
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
            value: json!("old"), more: None
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
            id: None,
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
        apps: None,
        event: &event,
        item: &item,
        modifiers: None,
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
        apps: None,
        event: &event,
        item: &item,
        modifiers: None,
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
            value: json!("Stored"), more: None
        }
    );
    assert_eq!(
        values["/ui/children/1/value"],
        BindingValue::Ready {
            value: json!("account-app"), more: None
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
        apps: None,
        event: &event,
        item: &item,
        modifiers: None,
    };
    assert_eq!(
        app.action_step("/ui/children/0/on_select", 0, &env)
            .unwrap(),
        Step::SetStorage {
            entry: "selection".into(),
            doc: None,
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
            value: json!("model-a"), more: None
        }
    );
    assert_eq!(
        values["/storage/entries/1/choices"],
        BindingValue::Ready {
            value: json!(["model-a", "model-b"]), more: None
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
            value: json!([{"key":"x","title":"X"}]), more: None
        }
    );
    assert_eq!(
        values["/ui/children/1/value"],
        BindingValue::Ready {
            value: json!([{"key":"x","title":"Xavier"},{"key":"y","title":"Yara"}]), more: None
        }
    );
    assert!(
        matches!(&values["/ui/children/2/value"], BindingValue::Ready { value, .. } if value["A"].as_f64() == Some(2.0))
    );
    assert!(matches!(
        values["/ui/children/3/value"],
        BindingValue::Failed { .. }
    ));
}
