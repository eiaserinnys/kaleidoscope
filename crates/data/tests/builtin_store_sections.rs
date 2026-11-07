use kaleidoscope_contract::{data::BindingValue, validate::parse_app_definition};
use kaleidoscope_data::{CompiledApp, Env, SourcePlan, Step};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn map(value: Value) -> BTreeMap<String, Value> { serde_json::from_value(value).unwrap() }

fn value(values: &BTreeMap<String, BindingValue>, pointer: &str) -> Value {
    match &values[pointer] {
        BindingValue::Ready { value, .. } => value.clone(),
        other => panic!("{pointer}: {other:?}"),
    }
}

#[test]
fn store_groups_indexes_and_keeps_same_ids_separate() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let data = map(json!({"catalog":{"stores":[
        {"server":"https://default.example", "state":"ready", "items":[{"id":"notes","name":"기본 메모","category":"도구","summary":""}]},
        {"server":"http://private", "state":"ready", "items":[{"id":"notes","name":"사설 메모","category":"도구","summary":""}]},
        {"server":"http://blocked", "state":"permission_required", "items":[], "error":{"id":"DENIED","message":"연결을 허용하세요"}}
    ]}}));
    let empty = BTreeMap::new();
    let values = app.evaluate_with_data_meta(&definition.state, &data, &empty, &empty, &empty, &BTreeMap::new(), None);
    let groups = value(&values, "/ui/children/1/children/1/items");
    assert_eq!(groups.as_array().unwrap().len(), 3);
    assert_eq!(groups[0]["title"], "기본 앱스토어");
    assert!(groups[0].get("meta").is_none());
    assert_eq!(groups[1]["title"], "사설 1");
    assert_eq!(groups[1]["meta"], "http://private");
    assert_eq!(groups[2]["status"]["state"], "empty");
    assert_eq!(groups[2]["status"]["message"], "이 PC에서 연결을 허용하면 앱을 볼 수 있습니다.");
    assert!(groups[2]["status"].get("code").is_none());
    assert_eq!(groups[2]["action"], "allow");
    assert_ne!(groups[0]["items"][0]["key"], groups[1]["items"][0]["key"]);
}

#[test]
fn store_settings_preserve_legacy_and_empty_list() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let empty = BTreeMap::new();
    let legacy = map(json!({"servers":null,"custom_url":" http://private/ ","store":"custom"}));
    let SourcePlan::StoreIndexes { servers, .. } = app.plan_source_with_storage("catalog", &definition.state, &legacy, &empty) else { panic!("다중 스토어 원천 필요") };
    assert_eq!(servers.len(), 2);
    assert_eq!(servers[1], "http://private/");
    let cleared = map(json!({"servers":[],"custom_url":"http://private","store":"custom"}));
    let SourcePlan::StoreIndexes { servers, .. } = app.plan_source_with_storage("catalog", &definition.state, &cleared, &empty) else { panic!("다중 스토어 원천 필요") };
    assert_eq!(servers.len(), 1);
}

#[test]
fn installed_filter_uses_store_origin_and_keeps_unlisted_apps() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let data = map(json!({"catalog":{"stores":[
        {"server":"https://a.example", "state":"ready", "items":[{"id":"same","name":"첫 메모","category":"도구","summary":""}]},
        {"server":"https://b.example", "state":"ready", "items":[{"id":"same","name":"둘째 메모","category":"도구","summary":""}]}
    ]}}));
    let apps: Vec<kaleidoscope_contract::store::InstalledAppValue> = serde_json::from_value(json!([
        {"id":"same","name":"첫 메모","version":1,"origin":{"store_url":"https://a.example","store_app_id":"same","release":1,"digest":"abc"},"latest":null,"installed_version":1,"modified":false,"icon":null},
        {"id":"gone","name":"내려간 앱","version":1,"origin":{"store_url":"https://b.example","store_app_id":"gone","release":1,"digest":"def"},"latest":null,"installed_version":1,"modified":false,"icon":null}
    ])).unwrap();
    let mut state = definition.state.clone();
    state.insert("category".into(), json!("__installed"));
    let empty = BTreeMap::new();
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    let groups = value(&values, "/ui/children/1/children/1/items");
    assert_eq!(groups[0]["items"][0]["id"], "same");
    assert_eq!(groups[1]["items"].as_array().unwrap().len(), 1);
    assert_eq!(groups[1]["items"][0]["id"], "gone");
    state.insert("query".into(), json!("내려간"));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    let groups = value(&values, "/ui/children/1/children/1/items");
    assert_eq!(groups[1]["items"][0]["id"], "gone");
}

#[test]
fn another_store_install_cannot_be_updated() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("same"));
    state.insert("selected_store".into(), json!("https://b.example"));
    let data = map(json!({"detail":{"release":2,"compatible":true}}));
    let apps: Vec<kaleidoscope_contract::store::InstalledAppValue> = serde_json::from_value(json!([{"id":"same","name":"메모","version":1,"origin":{"store_url":"https://a.example","store_app_id":"same","release":1,"digest":"abc"},"latest":{"release":2,"compatible":true},"installed_version":1,"modified":false,"icon":null}])).unwrap();
    let empty = BTreeMap::new();
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/3/child/end/0/disabled"), json!(true));
    assert_ne!(value(&values, "/ui/children/2/children/3/child/end/0/label"), "업데이트");
    assert!(value(&values, "/ui/children/2/children/1/child/children/0/fields/7/value").as_str().unwrap().contains("다른 스토어"));
}

#[test]
fn adding_and_removing_private_addresses_write_effective_list() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    state.insert("new_server".into(), json!(" http://two/// "));
    let storage = map(json!({"servers":null,"custom_url":"http://one","store":"custom"}));
    let empty = BTreeMap::new();
    let event = Value::Null;
    let item = json!({"key":"http://one", "title":"http://one"});
    let env = Env { state:&state, data:&empty, data_meta:&empty, storage:&storage, storage_meta:&empty, apps:None, event:&event, item:&item, modifiers:None };
    assert_eq!(app.action_step("/settings/ui/children/2/children/1/children/0/on_click", 0, &env).unwrap(),
        Step::SetStorage { entry:"servers".into(), doc:None, value:json!(["http://one","http://two"]) });
    assert_eq!(app.action_step("/settings/ui/children/2/children/0/on_submit", 0, &env).unwrap(),
        Step::SetStorage { entry:"servers".into(), doc:None, value:json!(["http://one","http://two"]) });
    assert_eq!(app.action_step("/settings/ui/children/1/on_remove", 0, &env).unwrap(),
        Step::SetStorage { entry:"servers".into(), doc:None, value:json!([]) });
    let mut same_state = state.clone();
    same_state.insert("new_server".into(), json!("http://one/"));
    let legacy_with_slash = map(json!({"servers":null,"custom_url":"http://one/"}));
    let env = Env { state:&same_state, storage:&legacy_with_slash, ..env };
    assert_eq!(app.action_step("/settings/ui/children/2/children/1/children/0/on_click", 0, &env).unwrap(),
        Step::SetStorage { entry:"servers".into(), doc:None, value:json!(["http://one/"]) });
}

#[test]
fn search_covers_all_stores_and_unlisted_id_only_once() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let data = map(json!({"catalog":{"stores":[
        {"server":"https://a.example", "state":"ready", "items":[{"id":"one","name":"메모", "category":"도구", "summary":""}]},
        {"server":"https://b.example", "state":"ready", "items":[{"id":"two","name":"메모장", "category":"글", "summary":""}]}
    ]}}));
    let mut state = definition.state.clone();
    let empty = BTreeMap::new();
    state.insert("query".into(), json!("메모"));
    let result = app.evaluate_with_data_meta(&state, &data, &empty, &empty, &empty, &BTreeMap::new(), None);
    let groups = value(&result, "/ui/children/1/children/1/items");
    assert_eq!(groups[0]["items"][0]["id"], "one");
    assert_eq!(groups[1]["items"][0]["id"], "two");
    state.insert("query".into(), json!("private-id"));
    let result = app.evaluate_with_data_meta(&state, &data, &empty, &empty, &empty, &BTreeMap::new(), None);
    let groups = value(&result, "/ui/children/1/children/1/items");
    assert_eq!(groups[0]["items"][0]["id"], "private-id");
    assert!(groups[1]["items"].as_array().unwrap().is_empty());
    state.insert("query".into(), json!("two"));
    let result = app.evaluate_with_data_meta(&state, &data, &empty, &empty, &empty, &BTreeMap::new(), None);
    let groups = value(&result, "/ui/children/1/children/1/items");
    assert!(groups[0]["items"].as_array().unwrap().is_empty());
    assert_eq!(groups[1]["items"][0]["id"], "two");
    state.insert("query".into(), json!("private-id"));
    let first_offline = map(json!({"catalog":{"stores":[
        {"server":"https://a.example", "state":"error", "items":[], "error":{"id":"OFFLINE","message":"오류"}},
        {"server":"https://b.example", "state":"ready", "items":[]}
    ]}}));
    let result = app.evaluate_with_data_meta(&state, &first_offline, &empty, &empty, &empty, &BTreeMap::new(), None);
    let groups = value(&result, "/ui/children/1/children/1/items");
    assert!(groups[0]["items"].as_array().unwrap().is_empty());
    assert_eq!(groups[1]["items"][0]["id"], "private-id");
}

#[test]
fn removed_stores_remain_removable_in_installed_and_updates() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let data = map(json!({"catalog":{"stores":[{"server":"https://a.example","state":"ready","items":[]}]}}));
    let apps: Vec<kaleidoscope_contract::store::InstalledAppValue> = serde_json::from_value(json!([
        {"id":"gone","name":"남은 앱","version":1,"origin":{"store_url":"https://removed.example","store_app_id":"gone","release":1,"digest":"abc"},"latest":{"release":2,"compatible":true},"installed_version":1,"modified":false,"icon":null}
    ])).unwrap();
    let empty = BTreeMap::new();
    let mut state = definition.state.clone();
    for category in ["__installed", "__updates"] {
        state.insert("category".into(), json!(category));
        let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
        let groups = value(&values, "/ui/children/1/children/1/items");
        let orphan = groups.as_array().unwrap().last().unwrap();
        assert_eq!(orphan["title"], "그 밖의 스토어");
        assert_eq!(orphan["items"][0]["server"], "https://removed.example");
        assert_eq!(orphan["items"][0]["id"], "gone");
    }
    state.insert("category".into(), json!(""));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert!(!value(&values, "/ui/children/1/children/1/items").to_string().contains("그 밖의 스토어"));
    state.insert("selected".into(), json!("gone"));
    state.insert("selected_store".into(), json!("https://removed.example"));
    assert!(matches!(app.plan_source_with_apps("detail", &state, &data, &empty, &empty, Some(&apps)), SourcePlan::StoreApp { id, .. } if id == "gone"));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/4/child/start/0/disabled"), json!(false));
}

#[test]
fn invalid_store_address_has_no_retry_and_names_the_installed_origin() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let data = map(json!({"catalog":{"stores":[
        {"server":"https://a.example","state":"ready","items":[]},
        {"server":"https://b.example","state":"error","items":[],"error":{"id":"STORECLIENT_URL_COMPONENT_INVALID","message":"주소 오류"}}
    ]},"detail":{"release":2,"compatible":true}}));
    let apps: Vec<kaleidoscope_contract::store::InstalledAppValue> = serde_json::from_value(json!([
        {"id":"same","name":"메모","version":1,"origin":{"store_url":"https://b.example","store_app_id":"same","release":1,"digest":"abc"},"latest":null,"installed_version":1,"modified":false,"icon":null}
    ])).unwrap();
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("same"));
    state.insert("selected_store".into(), json!("https://a.example"));
    let empty = BTreeMap::new();
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert!(value(&values, "/ui/children/1/children/1/items")[1].get("action").is_none());
    assert_eq!(value(&values, "/ui/children/2/children/1/child/children/0/fields/7/value"), "사설 1에서 설치한 앱입니다. 지운 뒤 설치할 수 있습니다.");
    state.insert("selected_store".into(), json!("https://b.example"));
    let mut first_apps = apps.clone();
    first_apps[0].origin.as_mut().unwrap().store_url = "https://a.example".into();
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&first_apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/1/child/children/0/fields/7/value"), "기본 앱스토어에서 설치한 앱입니다. 지운 뒤 설치할 수 있습니다.");
}

#[test]
fn selected_detail_uses_normalized_catalog_server_and_id() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let state = map(json!({"selected":"notes", "selected_store":"http://private"}));
    let storage = map(json!({"servers":null,"custom_url":"http://private/"}));
    let data = map(json!({"catalog":{"stores":[{"server":"http://private", "state":"ready", "items":[]}]}}));
    let empty = BTreeMap::new();
    assert!(matches!(app.plan_source_with_data_and_storage("detail", &state, &data, &storage, &empty), SourcePlan::StoreApp { server, id, .. } if server == "http://private" && id == "notes"));
    let cleared = map(json!({"catalog":{"stores":[]}}));
    assert_eq!(app.plan_source_with_data_and_storage("detail", &state, &cleared, &storage, &empty), SourcePlan::Idle);
}

#[test]
fn legacy_storage_values_remain_compatible_with_new_definition() {
    use kaleidoscope_contract::app_storage::{validate_storage_upgrade, StorageDecl, StorageKind, StoredStorageEntry};
    let old: StorageDecl = serde_json::from_value(json!({"entries":[
        {"id":"store","key":"settings/store","kind":"json","label":"스토어","presentation":"settings","schema":{"type":"string","enum":["default","custom"]},"default":"default","choices":[{"value":"default","label":"기본"},{"value":"custom","label":"직접"}]},
        {"id":"custom_url","key":"settings/custom-url","kind":"json","label":"주소","presentation":"settings","schema":{"type":"string"},"default":""}
    ]})).unwrap();
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let stored = vec![
        StoredStorageEntry { entry_id:"store".into(), key:"settings/store".into(), kind:StorageKind::Json, content:json!("custom") },
        StoredStorageEntry { entry_id:"custom_url".into(), key:"settings/custom-url".into(), kind:StorageKind::Json, content:json!("http://private") },
    ];
    assert_eq!(validate_storage_upgrade(&old, definition.storage.as_ref().unwrap(), &stored), Vec::<String>::new());
}

#[test]
fn detail_shows_korean_date_and_plain_none_permission() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("notes"));
    state.insert("selected_store".into(), json!("https://default.example"));
    let empty = BTreeMap::new();
    let base = json!({"detail":{
        "release":2,
        "releases":[
            {"release":1,"published_at":"2026-01-01T00:00:00Z"},
            {"release":2,"published_at":"2026-11-05T04:21:00.123Z"}
        ],
        "permissions":[],
        "badges":[]
    }});
    let values = app.evaluate_profiled(&state, &map(base), &empty, &empty, &empty, Some(&[]), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/1/child/children/0/fields/3/value"), json!("2026년 11월 5일"));
    assert_eq!(value(&values, "/ui/children/2/children/1/child/children/0/fields/4/value"), Value::Null);
    assert_eq!(value(&values, "/ui/children/2/children/1/child/children/0/fields/5/value"), json!("없음"));

    let with_permission = json!({"detail":{
        "release":2,
        "releases":[{"release":2,"published_at":"2026-11-05T04:21:00.123Z"}],
        "permissions":[{"module":"http","label":"공개 API"}],
        "badges":[]
    }});
    let values = app.evaluate_profiled(&state, &map(with_permission), &empty, &empty, &empty, Some(&[]), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/1/child/children/0/fields/4/value")[0]["text"], "공개 API");
    assert_eq!(value(&values, "/ui/children/2/children/1/child/children/0/fields/5/value"), Value::Null);

    let worker_badge = json!({"detail":{
        "release":2,
        "releases":[{"release":2,"published_at":"2026-11-05T04:21:00.123Z"}],
        "permissions":[],
        "badges":["worker"]
    }});
    let values = app.evaluate_profiled(&state, &map(worker_badge), &empty, &empty, &empty, Some(&[]), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/1/child/children/0/fields/5/value"), Value::Null);
}

#[test]
fn settings_address_input_and_add_button_are_separate_vertical_children() {
    let definition: Value = serde_json::from_str(include_str!("../../../apps/store.json")).unwrap();
    let settings = &definition["settings"]["ui"];
    assert_eq!(settings["direction"], "column");
    let input = &settings["children"][2]["children"][0];
    let button = &settings["children"][2]["children"][1]["children"][0];
    assert_eq!(input["type"], "input");
    assert!(input.get("label_position").is_none());
    assert_eq!(input["on_submit"], button["on_click"]);
    assert_eq!(settings["gap"], "large");
}

#[test]
fn settings_reject_addresses_without_http_scheme() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let empty = BTreeMap::new();
    let mut state = definition.state.clone();
    state.insert("new_server".into(), json!("private.local"));
    let values = app.evaluate_with_data_meta(&state, &empty, &empty, &empty, &empty, &BTreeMap::new(), None);
    assert_eq!(value(&values, "/settings/ui/children/2/children/1/children/0/disabled"), json!(true));
    let invalid_storage = map(json!({"servers":[], "custom_url":""}));
    let event = Value::Null;
    let env = Env { state:&state, data:&empty, data_meta:&empty, storage:&invalid_storage, storage_meta:&empty, apps:None, event:&event, item:&event, modifiers:None };
    let submit = "/settings/ui/children/2/children/0/on_submit";
    assert_eq!(app.action_step(submit, 0, &env).unwrap(), Step::SetStorage { entry:"servers".into(), doc:None, value:json!([]) });
    assert_eq!(app.action_step(submit, 1, &env).unwrap(), Step::SetState { key:"new_server".into(), value:json!("private.local") });
    state.insert("new_server".into(), json!("https://private.local"));
    let storage = map(json!({"servers":["http://one", "https://two"], "custom_url":""}));
    let values = app.evaluate_with_data_meta(&state, &empty, &storage, &empty, &empty, &BTreeMap::new(), None);
    assert_eq!(value(&values, "/settings/ui/children/2/children/1/children/0/disabled"), json!(false));
    let rows = value(&values, "/settings/ui/children/1/items");
    assert_eq!(rows[0]["meta"], "사설 1");
    assert_eq!(rows[1]["meta"], "사설 2");
}
