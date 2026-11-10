use kaleidoscope_contract::{
    data::{BindingValue, SourceStatus},
    store::InstalledAppValue,
    validate::parse_app_definition,
};
use kaleidoscope_data::{CompiledApp, Env, SourcePlan, Step};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn custom_apps() -> Vec<InstalledAppValue> {
    serde_json::from_value(json!([
        {"id":"my-tool","builtin":false,"name":"내 도구","version":3,"origin":null,"latest":null,"installed_version":null,"modified":false,"icon":null},
        {"id":"store","builtin":true,"name":"앱스토어","version":9,"origin":null,"latest":null,"installed_version":null,"modified":false,"icon":null},
        {"id":"from-store","builtin":false,"name":"스토어 앱","version":1,"origin":{"store_url":"https://a.example","store_app_id":"from-store","release":1,"digest":"abc"},"latest":null,"installed_version":1,"modified":false,"icon":null}
    ]))
    .unwrap()
}

fn map(value: Value) -> BTreeMap<String, Value> { serde_json::from_value(value).unwrap() }

fn value(values: &BTreeMap<String, BindingValue>, pointer: &str) -> Value {
    match values.get(pointer) {
        Some(BindingValue::Ready { value, .. }) => value.clone(),
        Some(other) => panic!("{pointer}: {other:?}"),
        None => panic!("{pointer}: 값이 없습니다"),
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
    let groups = value(&values, "/ui/children/1/children/2/child/items");
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
        {"id":"same","builtin":false,"name":"첫 메모","version":1,"origin":{"store_url":"https://a.example","store_app_id":"same","release":1,"digest":"abc"},"latest":null,"installed_version":1,"modified":false,"icon":null},
        {"id":"gone","builtin":false,"name":"내려간 앱","version":1,"origin":{"store_url":"https://b.example","store_app_id":"gone","release":1,"digest":"def"},"latest":null,"installed_version":1,"modified":false,"icon":null}
    ])).unwrap();
    let mut state = definition.state.clone();
    state.insert("category".into(), json!("__installed"));
    let empty = BTreeMap::new();
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    let groups = value(&values, "/ui/children/1/children/2/child/items");
    assert_eq!(groups[0]["items"][0]["id"], "same");
    assert_eq!(groups[1]["items"].as_array().unwrap().len(), 1);
    assert_eq!(groups[1]["items"][0]["id"], "gone");
    state.insert("query".into(), json!("내려간"));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    let groups = value(&values, "/ui/children/1/children/2/child/items");
    assert_eq!(groups[1]["items"][0]["id"], "gone");
}

#[test]
fn store_icon_tiles_mark_apps_with_available_updates() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let data = map(json!({"catalog":{"stores":[
        {"server":"https://a.example", "state":"ready", "items":[
            {"id":"notes","name":"메모","category":"도구","summary":""},
            {"id":"clock","name":"시계","category":"도구","summary":""}
        ]}
    ]}}));
    let apps: Vec<kaleidoscope_contract::store::InstalledAppValue> = serde_json::from_value(json!([
        {"id":"notes","builtin":false,"name":"메모","version":1,"origin":{"store_url":"https://a.example","store_app_id":"notes","release":1,"digest":"abc"},"latest":{"release":2,"compatible":true},"installed_version":1,"modified":false,"icon":null},
        {"id":"clock","builtin":false,"name":"시계","version":1,"origin":{"store_url":"https://a.example","store_app_id":"clock","release":1,"digest":"def"},"latest":{"release":1,"compatible":true},"installed_version":1,"modified":false,"icon":null},
        {"id":"old","builtin":false,"name":"옛 앱","version":1,"origin":{"store_url":"https://gone.example","store_app_id":"old","release":1,"digest":"ghi"},"latest":{"release":3,"compatible":true},"installed_version":1,"modified":false,"icon":null}
    ])).unwrap();
    let empty = BTreeMap::new();
    let values = app.evaluate_profiled(&definition.state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    let groups = value(&values, "/ui/children/1/children/2/child/items");
    let items = groups[0]["items"].as_array().unwrap();
    assert_eq!(items[0]["id"], "notes");
    assert_eq!(items[0]["dot"], json!(true));
    assert_eq!(items[1]["id"], "clock");
    assert_eq!(items[1]["dot"], json!(false));
    let mut state = definition.state.clone();
    state.insert("category".into(), json!("__updates"));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    let groups = value(&values, "/ui/children/1/children/2/child/items");
    assert_eq!(groups[1]["title"], "그 밖의 스토어");
    assert_eq!(groups[1]["items"][0]["id"], "old");
    assert_eq!(groups[1]["items"][0]["dot"], json!(true));
}

#[test]
fn another_store_install_offers_conversion_instead_of_update() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("same"));
    state.insert("selected_store".into(), json!("https://b.example"));
    let data = map(json!({"catalog":{"stores":[
        {"server":"https://b.example","state":"ready","items":[{"id":"same","name":"메모"}]}
    ]},"detail":{"release":2,"compatible":true}}));
    let data_meta = map(json!({"detail":{"state":"ready"}}));
    let apps: Vec<kaleidoscope_contract::store::InstalledAppValue> = serde_json::from_value(json!([{"id":"same","builtin":false,"name":"메모","version":1,"origin":{"store_url":"https://a.example","store_app_id":"same","release":1,"digest":"abc"},"latest":{"release":2,"compatible":true},"installed_version":1,"modified":false,"icon":null}])).unwrap();
    let empty = BTreeMap::new();
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    // 다른 스토어에서 설치한 앱은 보통 업데이트 줄 대신 바꾸기 줄을 쓴다.
    assert_eq!(value(&values, "/ui/children/2/children/6/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/7/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/7/child/end/0/label"), "스토어 판으로 바꾸기");
    assert_eq!(value(&values, "/ui/children/2/children/7/child/end/0/disabled"), json!(false));
    let status = value(&values, "/ui/children/2/children/2/child/children/0/fields/7/value");
    assert!(status.as_str().unwrap().contains("다른 스토어"));
    assert!(!status.as_str().unwrap().contains("바꿀 수 있습니다"));
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
    assert_eq!(app.action_step("/settings/ui/children/2/children/2/children/0/on_click", 0, &env).unwrap(),
        Step::SetStorage { entry:"invites".into(), doc:None, value:json!({}) });
    assert_eq!(app.action_step("/settings/ui/children/2/children/2/children/0/on_click", 1, &env).unwrap(),
        Step::SetStorage { entry:"servers".into(), doc:None, value:json!(["http://one","http://two"]) });
    assert_eq!(app.action_step("/settings/ui/children/2/children/0/on_submit", 0, &env).unwrap(),
        Step::SetStorage { entry:"invites".into(), doc:None, value:json!({}) });
    assert_eq!(app.action_step("/settings/ui/children/2/children/0/on_submit", 1, &env).unwrap(),
        Step::SetStorage { entry:"servers".into(), doc:None, value:json!(["http://one","http://two"]) });
    assert_eq!(app.action_step("/settings/ui/children/1/on_remove", 0, &env).unwrap(),
        Step::SetStorage { entry:"servers".into(), doc:None, value:json!([]) });
    let mut same_state = state.clone();
    same_state.insert("new_server".into(), json!("http://one/"));
    let legacy_with_slash = map(json!({"servers":null,"custom_url":"http://one/"}));
    let env = Env { state:&same_state, storage:&legacy_with_slash, ..env };
    assert_eq!(app.action_step("/settings/ui/children/2/children/2/children/0/on_click", 1, &env).unwrap(),
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
    let groups = value(&result, "/ui/children/1/children/2/child/items");
    assert_eq!(groups[0]["items"][0]["id"], "one");
    assert_eq!(groups[1]["items"][0]["id"], "two");
    state.insert("query".into(), json!("private-id"));
    let result = app.evaluate_with_data_meta(&state, &data, &empty, &empty, &empty, &BTreeMap::new(), None);
    let groups = value(&result, "/ui/children/1/children/2/child/items");
    assert_eq!(groups[0]["items"][0]["id"], "private-id");
    assert!(groups[1]["items"].as_array().unwrap().is_empty());
    state.insert("query".into(), json!("two"));
    let result = app.evaluate_with_data_meta(&state, &data, &empty, &empty, &empty, &BTreeMap::new(), None);
    let groups = value(&result, "/ui/children/1/children/2/child/items");
    assert!(groups[0]["items"].as_array().unwrap().is_empty());
    assert_eq!(groups[1]["items"][0]["id"], "two");
    state.insert("query".into(), json!("private-id"));
    let first_offline = map(json!({"catalog":{"stores":[
        {"server":"https://a.example", "state":"error", "items":[], "error":{"id":"OFFLINE","message":"오류"}},
        {"server":"https://b.example", "state":"ready", "items":[]}
    ]}}));
    let result = app.evaluate_with_data_meta(&state, &first_offline, &empty, &empty, &empty, &BTreeMap::new(), None);
    let groups = value(&result, "/ui/children/1/children/2/child/items");
    assert!(groups[0]["items"].as_array().unwrap().is_empty());
    assert_eq!(groups[1]["items"][0]["id"], "private-id");
}

#[test]
fn removed_stores_remain_removable_in_installed_and_updates() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let data = map(json!({"catalog":{"stores":[{"server":"https://a.example","state":"ready","items":[]}]}}));
    let apps: Vec<kaleidoscope_contract::store::InstalledAppValue> = serde_json::from_value(json!([
        {"id":"gone","builtin":false,"name":"남은 앱","version":1,"origin":{"store_url":"https://removed.example","store_app_id":"gone","release":1,"digest":"abc"},"latest":{"release":2,"compatible":true},"installed_version":1,"modified":false,"icon":null}
    ])).unwrap();
    let empty = BTreeMap::new();
    let mut state = definition.state.clone();
    for category in ["__installed", "__updates"] {
        state.insert("category".into(), json!(category));
        let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
        let groups = value(&values, "/ui/children/1/children/2/child/items");
        let orphan = groups.as_array().unwrap().last().unwrap();
        assert_eq!(orphan["title"], "그 밖의 스토어");
        assert_eq!(orphan["items"][0]["server"], "https://removed.example");
        assert_eq!(orphan["items"][0]["id"], "gone");
    }
    state.insert("category".into(), json!(""));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert!(!value(&values, "/ui/children/1/children/2/child/items").to_string().contains("그 밖의 스토어"));
    state.insert("selected".into(), json!("gone"));
    state.insert("selected_store".into(), json!("https://removed.example"));
    assert!(matches!(app.plan_source_with_apps("detail", &state, &data, &empty, &empty, Some(&apps)), SourcePlan::StoreApp { id, .. } if id == "gone"));
    let data_meta = map(json!({"detail":{"state":"loading"}}));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/8/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/10/value"), json!(false));
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
        {"id":"same","builtin":false,"name":"메모","version":1,"origin":{"store_url":"https://b.example","store_app_id":"same","release":1,"digest":"abc"},"latest":null,"installed_version":1,"modified":false,"icon":null}
    ])).unwrap();
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("same"));
    state.insert("selected_store".into(), json!("https://a.example"));
    let empty = BTreeMap::new();
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert!(value(&values, "/ui/children/1/children/2/child/items")[1].get("action").is_none());
    assert_eq!(value(&values, "/ui/children/2/children/2/child/children/0/fields/7/value"), "사설 1에서 설치한 앱입니다.");
    state.insert("selected_store".into(), json!("https://b.example"));
    let mut first_apps = apps.clone();
    first_apps[0].origin.as_mut().unwrap().store_url = "https://a.example".into();
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&first_apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/2/child/children/0/fields/7/value"), "기본 앱스토어에서 설치한 앱입니다.");
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
    assert_eq!(value(&values, "/ui/children/2/children/2/child/children/0/fields/3/value"), json!("2026년 11월 5일"));
    assert_eq!(value(&values, "/ui/children/2/children/2/child/children/0/fields/4/value"), Value::Null);
    assert_eq!(value(&values, "/ui/children/2/children/2/child/children/0/fields/5/value"), json!("없음"));

    let with_permission = json!({"detail":{
        "release":2,
        "releases":[{"release":2,"published_at":"2026-11-05T04:21:00.123Z"}],
        "permissions":[{"module":"http","label":"공개 API"}],
        "badges":[]
    }});
    let values = app.evaluate_profiled(&state, &map(with_permission), &empty, &empty, &empty, Some(&[]), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/2/child/children/0/fields/4/value")[0]["text"], "공개 API");
    assert_eq!(value(&values, "/ui/children/2/children/2/child/children/0/fields/5/value"), Value::Null);

    let worker_badge = json!({"detail":{
        "release":2,
        "releases":[{"release":2,"published_at":"2026-11-05T04:21:00.123Z"}],
        "permissions":[],
        "badges":["worker"]
    }});
    let values = app.evaluate_profiled(&state, &map(worker_badge), &empty, &empty, &empty, Some(&[]), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/2/child/children/0/fields/5/value"), Value::Null);
}

#[test]
fn delete_button_shows_only_for_store_installed_apps() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("notes"));
    state.insert("selected_store".into(), json!("https://default.example"));
    let empty = BTreeMap::new();
    let data = map(json!({"catalog":{"stores":[{"server":"https://default.example","state":"ready","items":[]}]},"detail":{"release":2,"compatible":true}}));
    let ready_meta = map(json!({"detail":{"state":"ready"}}));
    let not_ready_meta = map(json!({"detail":{"state":"loading"}}));
    let installed = |origin: Value| -> Vec<kaleidoscope_contract::store::InstalledAppValue> {
        serde_json::from_value(json!([{"id":"notes","builtin":false,"name":"메모","version":1,"origin":origin,"latest":null,"installed_version":1,"modified":false,"icon":null}])).unwrap()
    };
    let no_origin = installed(Value::Null);
    let with_origin = installed(json!({"store_url":"https://default.example","store_app_id":"notes","release":1,"digest":"abc"}));

    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &ready_meta, Some(&[]), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/6/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/9/value"), json!(true));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &ready_meta, Some(&no_origin), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/6/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/9/value"), json!(true));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &ready_meta, Some(&with_origin), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/6/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/9/value"), json!(false));

    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &not_ready_meta, Some(&[]), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/8/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/10/value"), json!(true));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &not_ready_meta, Some(&no_origin), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/8/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/10/value"), json!(true));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &not_ready_meta, Some(&with_origin), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/8/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/10/value"), json!(false));
}

#[test]
fn settings_address_input_and_add_button_are_separate_vertical_children() {
    let definition: Value = serde_json::from_str(include_str!("../../../apps/store.json")).unwrap();
    let settings = &definition["settings"]["ui"];
    assert_eq!(settings["direction"], "column");
    let input = &settings["children"][2]["children"][0];
    let invite = &settings["children"][2]["children"][1];
    let button = &settings["children"][2]["children"][2]["children"][0];
    assert_eq!(input["type"], "input");
    assert_eq!(invite["on_submit"], button["on_click"]);
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
    assert_eq!(value(&values, "/settings/ui/children/2/children/2/children/0/disabled"), json!(true));
    let invalid_storage = map(json!({"servers":[], "custom_url":""}));
    let event = Value::Null;
    let env = Env { state:&state, data:&empty, data_meta:&empty, storage:&invalid_storage, storage_meta:&empty, apps:None, event:&event, item:&event, modifiers:None };
    let submit = "/settings/ui/children/2/children/0/on_submit";
    assert_eq!(app.action_step(submit, 0, &env).unwrap(), Step::SetStorage { entry:"invites".into(), doc:None, value:json!({}) });
    assert_eq!(app.action_step(submit, 1, &env).unwrap(), Step::SetStorage { entry:"servers".into(), doc:None, value:json!([]) });
    assert_eq!(app.action_step(submit, 2, &env).unwrap(), Step::SetState { key:"new_invite".into(), value:json!("") });
    assert_eq!(app.action_step(submit, 3, &env).unwrap(), Step::SetState { key:"new_server".into(), value:json!("private.local") });
    state.insert("new_server".into(), json!("https://private.local"));
    let storage = map(json!({"servers":["http://one", "https://two"], "custom_url":""}));
    let values = app.evaluate_with_data_meta(&state, &empty, &storage, &empty, &empty, &BTreeMap::new(), None);
    assert_eq!(value(&values, "/settings/ui/children/2/children/2/children/0/disabled"), json!(false));
    let rows = value(&values, "/settings/ui/children/1/items");
    assert_eq!(rows[0]["meta"], "사설 1");
    assert_eq!(rows[1]["meta"], "사설 2");
}

#[test]
fn shortcut_row_shows_for_installed_apps_and_tracks_the_selection() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    // 이전에 저장한 창 상태에는 이 키가 없다.
    state.remove("shortcut_added");
    state.insert("selected".into(), json!("notes"));
    let empty = BTreeMap::new();
    let data = map(json!({"catalog":{"stores":[{"server":"https://default.example","state":"ready","items":[]}]},"detail":{"release":2,"compatible":true}}));
    let installed: Vec<kaleidoscope_contract::store::InstalledAppValue> = serde_json::from_value(json!([
        {"id":"notes","builtin":false,"name":"기본 메모","version":1,"origin":null,"latest":null,"installed_version":null,"modified":false,"icon":null},
        {"id":"weather","builtin":false,"name":"날씨","version":1,"origin":null,"latest":null,"installed_version":null,"modified":false,"icon":null}
    ])).unwrap();
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&installed), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/5/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/0/label"), "바탕화면에 추가");
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/0/disabled"), json!(false));
    let raw: Value = serde_json::from_str(include_str!("../../../apps/store.json")).unwrap();
    let end = &raw["ui"]["children"][2]["children"][5]["child"]["end"];
    assert_eq!(end[0]["on_click"][0], json!({"shell.add_shortcut":{"app_id":{"state":"selected"}}}));
    assert_eq!(end[1]["label"], "열기");
    assert_eq!(end[1]["on_click"][0], json!({"shell.open":{"app_id":{"state":"selected"}}}));
    // 바꾸기 후보가 없는 커스텀 앱은 열기가 강조다.
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/1/variant"), "primary");

    state.insert("shortcut_added".into(), json!("notes"));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&installed), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/0/label"), "바탕화면에 있음");
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/0/disabled"), json!(true));

    state.insert("selected".into(), json!("weather"));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&installed), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/0/label"), "바탕화면에 추가");
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/0/disabled"), json!(false));

    state.insert("selected".into(), json!("missing"));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &empty, Some(&installed), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/5/value"), json!(false));
}

#[test]
fn shortcut_row_actions_compile_to_shell_steps() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("notes"));
    let empty = BTreeMap::new();
    let event = Value::Null;
    let env = Env { state:&state, data:&empty, data_meta:&empty, storage:&empty, storage_meta:&empty, apps:None, event:&event, item:&event, modifiers:None };
    let add = "/ui/children/2/children/5/child/end/0/on_click";
    let open = "/ui/children/2/children/5/child/end/1/on_click";
    assert_eq!(app.action_step(add, 0, &env).unwrap(), Step::ShellAddShortcut { app_id:"notes".into() });
    assert_eq!(app.action_step(add, 1, &env).unwrap(), Step::SetState { key:"shortcut_added".into(), value:json!("notes") });
    assert_eq!(app.action_step(open, 0, &env).unwrap(), Step::ShellOpen { app_id:"notes".into() });
    assert!(matches!(app.action_step(add, 2, &env), Err(error) if error.id.as_deref() == Some("DATA_ACT_STEP_INVALID")));

    state.insert("selected".into(), json!(5));
    let env = Env { state:&state, data:&empty, data_meta:&empty, storage:&empty, storage_meta:&empty, apps:None, event:&event, item:&event, modifiers:None };
    assert_eq!(app.action_step(open, 0, &env).unwrap_err().id.as_deref(), Some("DATA_SHELL_OPEN_APP_ID_INVALID"));
    assert_eq!(app.action_step(add, 0, &env).unwrap_err().id.as_deref(), Some("DATA_SHELL_SHORTCUT_APP_ID_INVALID"));
}

#[test]
fn invite_code_is_stored_separately_from_the_clean_store_address() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    state.insert("new_server".into(), json!(" https://store.example/team/ "));
    state.insert("new_invite".into(), json!(" AB12-cd34 "));
    let storage = map(json!({"servers":["https://one.example"], "invites":{"https://two.example":"old-code"}}));
    let empty = BTreeMap::new();
    let event = Value::Null;
    let env = Env { state:&state, data:&empty, data_meta:&empty, storage:&storage, storage_meta:&empty, apps:None, event:&event, item:&Value::Null, modifiers:None };
    for (path, index) in [
        ("/settings/ui/children/2/children/2/children/0/on_click", 0),
        ("/settings/ui/children/2/children/0/on_submit", 0),
        ("/settings/ui/children/2/children/1/on_submit", 0),
    ] {
        assert_eq!(
            app.action_step(path, index, &env).unwrap(),
            Step::SetStorage {
                entry:"invites".into(), doc:None,
                value:json!({"https://two.example":"old-code","https://store.example/team":"ab12-cd34"}),
            }
        );
        assert_eq!(
            app.action_step(path, index + 1, &env).unwrap(),
            Step::SetStorage {
                entry:"servers".into(), doc:None,
                value:json!(["https://one.example","https://store.example/team"]),
            }
        );
    }
    assert_eq!(app.action_step("/settings/ui/children/2/children/1/on_submit", 2, &env).unwrap(),
        Step::SetState { key:"new_invite".into(), value:json!("") });

    let mut state = definition.state.clone();
    state.insert("new_server".into(), json!("https://one.example/"));
    state.insert("new_invite".into(), json!(" NEW-code "));
    let env = Env { state:&state, data:&empty, data_meta:&empty, storage:&storage, storage_meta:&empty, apps:None, event:&event, item:&Value::Null, modifiers:None };
    assert_eq!(
        app.action_step("/settings/ui/children/2/children/2/children/0/on_click", 0, &env).unwrap(),
        Step::SetStorage {
            entry:"invites".into(), doc:None,
            value:json!({"https://two.example":"old-code","https://one.example":"new-code"}),
        }
    );
    assert_eq!(
        app.action_step("/settings/ui/children/2/children/2/children/0/on_click", 1, &env).unwrap(),
        Step::SetStorage { entry:"servers".into(), doc:None, value:json!(["https://one.example"]) }
    );

    let item = json!({"key":"https://store.example/team"});
    let env = Env { state:&state, data:&empty, data_meta:&empty, storage:&storage, storage_meta:&empty, apps:None, event:&event, item:&item, modifiers:None };
    assert_eq!(
        app.action_step("/settings/ui/children/1/on_remove", 0, &env).unwrap(),
        Step::SetStorage { entry:"servers".into(), doc:None, value:json!(["https://one.example"]) }
    );
    assert_eq!(
        app.action_step("/settings/ui/children/1/on_remove", 1, &env).unwrap(),
        Step::SetStorage {
            entry:"invites".into(), doc:None,
            value:json!({"https://two.example":"old-code"}),
        }
    );
}

#[test]
fn custom_category_lists_origin_less_apps_while_the_store_source_fails() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let apps = custom_apps();
    let empty = BTreeMap::new();
    let statuses: BTreeMap<String, SourceStatus> = serde_json::from_value(json!({
        "catalog":{"state":"failed","message":"연결 실패","has_value":false}
    })).unwrap();
    let data_meta = map(json!({"catalog":{"state":"failed","message":"연결 실패","stale":false}}));
    let mut state = definition.state.clone();
    state.insert("category".into(), json!("__custom"));
    let values = app.evaluate_profiled(&state, &empty, &empty, &empty, &data_meta, Some(&apps), &statuses, None, &mut |_, _| {});
    // 왼쪽 분류의 커스텀 줄은 스토어 원천 상태와 상관없이 남는다.
    let rows = value(&values, "/ui/children/0/children/1/children/1/items");
    assert_eq!(rows[0]["key"], "__custom");
    assert_eq!(rows[0]["title"], "커스텀 앱");
    assert_eq!(rows[0]["meta"], "1");
    // 목록 머리의 가져오기 toolbar는 분류가 비어도 남는다.
    assert_eq!(value(&values, "/ui/children/1/children/1/value"), json!(true));
    let raw: Value = serde_json::from_str(include_str!("../../../apps/store.json")).unwrap();
    let import = &raw["ui"]["children"][1]["children"][1]["child"]["end"][0];
    assert_eq!(import["icon"], "upload");
    assert_eq!(import["label"], "파일에서 가져오기");
    assert_eq!(import["icon_only"], json!(true));
    assert_eq!(import["on_click"], json!([{"shell.import_app":{}}]));
    // 커스텀 목록은 $apps만으로 채워진다. 묶음 머리 없이 항목이 바로 온다.
    let rows = value(&values, "/ui/children/1/children/3/child/items");
    assert_eq!(rows[0]["key"], "my-tool");
    assert_eq!(rows[0]["title"], "내 도구");
    assert_eq!(rows[0]["id"], "my-tool");
    assert_eq!(rows[0]["server"], Value::Null);
    assert_eq!(value(&values, "/ui/children/1/children/2/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/1/children/3/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/1/children/4/value"), json!(false));

    state.insert("query".into(), json!("도구"));
    let values = app.evaluate_profiled(&state, &empty, &empty, &empty, &data_meta, Some(&apps), &statuses, None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/1/children/3/child/items")[0]["id"], "my-tool");
    state.insert("query".into(), json!("스토어 앱"));
    let values = app.evaluate_profiled(&state, &empty, &empty, &empty, &data_meta, Some(&apps), &statuses, None, &mut |_, _| {});
    let rows = value(&values, "/ui/children/1/children/3/child/items");
    assert!(rows.as_array().unwrap().is_empty());
    assert_eq!(value(&values, "/ui/children/1/children/3/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/1/children/4/value"), json!(false));

    // 스토어 원천이 실패해도 선택한 커스텀 앱의 상세와 열기와 지우기는 열린다.
    state.insert("query".into(), json!(""));
    state.insert("selected".into(), json!("my-tool"));
    state.insert("selected_name".into(), json!("내 도구"));
    state.insert("selected_store".into(), Value::Null);
    let values = app.evaluate_profiled(&state, &empty, &empty, &empty, &data_meta, Some(&apps), &statuses, None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/0/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/1/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/4/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/5/value"), json!(true));
    // 후보 스토어를 읽을 수 없으면 바꾸기 없이 지우기만 남는다.
    assert_eq!(value(&values, "/ui/children/2/children/11/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/12/value"), json!(true));
    let row = &raw["ui"]["children"][2]["children"][12]["child"]["children"][1];
    assert_eq!(row["start"][0]["label"], "지우기");
    assert!(row["end"].as_array().unwrap().is_empty());

    state.insert("category".into(), json!(""));
    let values = app.evaluate_profiled(&state, &empty, &empty, &empty, &data_meta, Some(&apps), &statuses, None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/1/children/1/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/1/children/2/value"), json!(true));
}

#[test]
fn custom_detail_shows_version_and_single_store_conversion() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let apps = custom_apps();
    let empty = BTreeMap::new();
    let data = map(json!({
        "catalog":{"stores":[{"server":"https://a.example","state":"ready","items":[{"id":"my-tool","name":"내 도구","category":"도구","summary":""}]}]},
        "convert":{"server":"https://a.example","release":2,"compatible":true}
    }));
    let data_meta = map(json!({"catalog":{"state":"ready"},"convert":{"state":"ready"}}));
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("my-tool"));
    state.insert("selected_name".into(), json!("내 도구"));
    state.insert("selected_store".into(), Value::Null);
    state.insert("custom_store".into(), json!("https://a.example"));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    let raw: Value = serde_json::from_str(include_str!("../../../apps/store.json")).unwrap();
    assert_eq!(value(&values, "/ui/children/2/children/0/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/1/value"), json!(true));
    // 제목·판·id·고른 스토어는 상태 바인딩이라 화면이 그대로 읽는다.
    assert_eq!(raw["ui"]["children"][2]["children"][1]["child"]["start"][0]["value"], json!({"state":"selected_name"}));
    assert_eq!(value(&values, "/ui/children/2/children/4/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/4/child/children/0/fields/0/value"), json!("3"));
    assert_eq!(raw["ui"]["children"][2]["children"][4]["child"]["children"][0]["fields"][1]["value"], json!({"state":"selected"}));
    assert_eq!(value(&values, "/ui/children/2/children/5/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/11/value"), json!(true));
    // JSONata는 한 원소 배열을 값 하나로 접는다. 화면은 asArray로 읽으므로 같게 맞춘다.
    let options = value(&values, "/ui/children/2/children/11/child/children/1/end/0/options");
    let options = Value::Array(options.as_array().cloned().unwrap_or_else(|| vec![options]));
    assert_eq!(options, json!([{"value":"https://a.example","label":"기본 앱스토어"}]));
    assert_eq!(raw["ui"]["children"][2]["children"][11]["child"]["children"][1]["end"][0]["value"], json!({"state":"custom_store"}));
    assert_eq!(raw["ui"]["children"][2]["children"][11]["child"]["children"][1]["end"][1]["label"], "스토어 판으로 바꾸기");
    assert_eq!(value(&values, "/ui/children/2/children/11/child/children/1/end/1/disabled"), json!(false));
    // 후보가 있으면 지우기만 있는 줄은 뜨지 않는다.
    assert_eq!(value(&values, "/ui/children/2/children/12/value"), json!(false));

    let delete = &raw["ui"]["children"][2]["children"][11]["child"]["children"][1]["start"][0];
    assert_eq!(delete["variant"], "danger");
    assert_eq!(delete["confirm"]["body"], json!({"state":"selected_name"}));
    assert_eq!(
        delete["on_click"][0],
        json!({"store.remove":{"permission":"catalog","id":{"state":"selected"},"allow_custom":true}})
    );

    let event = Value::Null;
    let env = Env { state:&state, data:&data, data_meta:&data_meta, storage:&empty, storage_meta:&empty, apps:Some(&apps), event:&event, item:&event, modifiers:None };
    match app.action_step("/ui/children/2/children/11/child/children/1/end/1/on_click", 0, &env).unwrap() {
        Step::StoreInstall { permission, server, id, release, replace } => {
            assert_eq!(permission, "catalog");
            assert_eq!(server, json!("https://a.example"));
            assert_eq!(id, json!("my-tool"));
            assert_eq!(release.as_f64(), Some(2.0));
            assert!(replace);
        }
        other => panic!("예상하지 않은 단계: {other:?}"),
    }
    for (index, key, expected) in [
        (1, "selected", Value::Null),
        (2, "selected_name", json!("")),
        (3, "selected_store", Value::Null),
        (4, "selected_key", Value::Null),
        (5, "custom_store", Value::Null),
    ] {
        assert_eq!(
            app.action_step("/ui/children/2/children/11/child/children/1/end/1/on_click", index, &env).unwrap(),
            Step::SetState { key: key.into(), value: expected }
        );
    }
    // 후보가 한 곳뿐이면 커스텀 앱을 고를 때 그 스토어를 기본으로 기억한다.
    let item = json!({"key":"my-tool","title":"내 도구","id":"my-tool","server":null});
    let item_env = Env { state:&state, data:&data, data_meta:&data_meta, storage:&empty, storage_meta:&empty, apps:Some(&apps), event:&event, item:&item, modifiers:None };
    assert_eq!(
        app.action_step("/ui/children/1/children/3/child/on_select", 4, &item_env).unwrap(),
        Step::SetState { key: "custom_store".into(), value: json!("https://a.example") }
    );
    assert_eq!(
        app.action_step("/ui/children/2/children/11/child/children/1/start/0/on_click", 0, &env).unwrap(),
        Step::StoreRemove { permission:"catalog".into(), id:json!("my-tool"), allow_custom:true }
    );
    assert_eq!(
        app.action_step("/ui/children/2/children/11/child/children/1/start/0/on_click", 1, &env).unwrap(),
        Step::SetState { key:"selected".into(), value:Value::Null }
    );
}

#[test]
fn custom_conversion_lists_only_ready_stores_that_have_the_app() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let apps = custom_apps();
    let empty = BTreeMap::new();
    let data = map(json!({"catalog":{"stores":[
        {"server":"https://a.example","state":"ready","items":[{"id":"other","name":"다른 앱"}]},
        {"server":"https://b.example","state":"ready","items":[{"id":"my-tool","name":"내 도구"}]},
        {"server":"https://c.example","state":"ready","items":[{"id":"my-tool","name":"내 도구"}]},
        {"server":"https://d.example","state":"error","items":[],"error":{"id":"OFFLINE","message":"오류"}}
    ]}}));
    let idle_meta = map(json!({"catalog":{"state":"ready"},"convert":{"state":"idle"}}));
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("my-tool"));
    state.insert("selected_name".into(), json!("내 도구"));
    state.insert("selected_store".into(), Value::Null);
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &idle_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/11/value"), json!(true));
    assert_eq!(
        value(&values, "/ui/children/2/children/11/child/children/1/end/0/options"),
        json!([
            {"value":"https://b.example","label":"사설 1"},
            {"value":"https://c.example","label":"사설 2"}
        ])
    );
    // 후보가 둘이면 고르기 전에는 비어 있고 전환할 수 없다. 고르기는 고른 스토어 상태를 그대로 읽는다.
    let raw: Value = serde_json::from_str(include_str!("../../../apps/store.json")).unwrap();
    assert_eq!(raw["ui"]["children"][2]["children"][11]["child"]["children"][1]["end"][0]["value"], json!({"state":"custom_store"}));
    assert_eq!(value(&values, "/ui/children/2/children/11/child/children/1/end/1/disabled"), json!(true));

    state.insert("custom_store".into(), json!("https://c.example"));
    let loading_meta = map(json!({"catalog":{"state":"ready"},"convert":{"state":"loading"}}));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &loading_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/11/child/children/1/end/1/disabled"), json!(true));

    let ready_meta = map(json!({"catalog":{"state":"ready"},"convert":{"state":"ready"}}));
    let with_convert = map(json!({
        "catalog":{"stores":[
            {"server":"https://a.example","state":"ready","items":[{"id":"other","name":"다른 앱"}]},
            {"server":"https://b.example","state":"ready","items":[{"id":"my-tool","name":"내 도구"}]},
            {"server":"https://c.example","state":"ready","items":[{"id":"my-tool","name":"내 도구"}]}
        ]},
        "convert":{"server":"https://c.example","release":4,"compatible":false}
    }));
    let values = app.evaluate_profiled(&state, &with_convert, &empty, &empty, &ready_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/11/child/children/1/end/1/disabled"), json!(true));
    let compatible = map(json!({
        "catalog":{"stores":[
            {"server":"https://a.example","state":"ready","items":[{"id":"other","name":"다른 앱"}]},
            {"server":"https://b.example","state":"ready","items":[{"id":"my-tool","name":"내 도구"}]},
            {"server":"https://c.example","state":"ready","items":[{"id":"my-tool","name":"내 도구"}]}
        ]},
        "convert":{"server":"https://c.example","release":4,"compatible":true}
    }));
    let values = app.evaluate_profiled(&state, &compatible, &empty, &empty, &ready_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/11/child/children/1/end/1/disabled"), json!(false));

    // 후보가 아닌 스토어를 기억하고 있으면 전환 대상을 잡지 않는다.
    state.insert("custom_store".into(), json!("https://a.example"));
    assert_eq!(
        app.plan_source_with_apps("convert", &state, &data, &empty, &empty, Some(&apps)),
        SourcePlan::Idle
    );
    state.insert("custom_store".into(), json!("https://c.example"));
    assert!(matches!(
        app.plan_source_with_apps("convert", &state, &data, &empty, &empty, Some(&apps)),
        SourcePlan::StoreApp { server, id, .. } if server == "https://c.example" && id == "my-tool"
    ));
    state.insert("custom_store".into(), Value::Null);
    assert_eq!(
        app.plan_source_with_apps("convert", &state, &data, &empty, &empty, Some(&apps)),
        SourcePlan::Idle
    );

    // 같은 id가 어느 스토어에도 없으면 전환 줄 없이 지우기만 남는다.
    let none = map(json!({"catalog":{"stores":[{"server":"https://a.example","state":"ready","items":[{"id":"other","name":"다른 앱"}]}]}}));
    let values = app.evaluate_profiled(&state, &none, &empty, &empty, &idle_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/11/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/12/value"), json!(true));
}

#[test]
fn store_detail_conversion_replaces_other_origin_and_modified_apps() {
    let definition = parse_app_definition(include_str!("../../../apps/store.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let empty = BTreeMap::new();
    let data_meta = map(json!({"detail":{"state":"ready"}}));
    let data = map(json!({
        "catalog":{"stores":[{"server":"https://a.example","state":"ready","items":[{"id":"notes","name":"메모"}]}]},
        "detail":{"server":"https://a.example","release":2,"compatible":true}
    }));
    let mut state = definition.state.clone();
    state.insert("selected".into(), json!("notes"));
    state.insert("selected_name".into(), json!("메모"));
    state.insert("selected_store".into(), json!("https://a.example"));
    let installed = |origin: Value, modified: bool, version: u32, installed_version: Option<u32>| -> Vec<InstalledAppValue> {
        serde_json::from_value(json!([{
            "id":"notes","builtin":false,"name":"메모","version":version,"origin":origin,
            "latest":null,"installed_version":installed_version,"modified":modified,"icon":null
        }]))
        .unwrap()
    };
    let other_origin = json!({"store_url":"https://b.example","store_app_id":"notes","release":1,"digest":"def"});
    let same_origin = json!({"store_url":"https://a.example","store_app_id":"notes","release":2,"digest":"abc"});

    // 다른 스토어에서 설치했거나 설치 뒤 고친 앱은 둘째 줄의 설치 단추가 바꾸기를 겸한다.
    for (origin, modified, version, installed_version, label) in [
        (other_origin.clone(), false, 1, Some(1), "스토어 판으로 바꾸기"),
        (same_origin.clone(), true, 2, Some(1), "스토어 판으로 되돌리기"),
    ] {
        let apps = installed(origin, modified, version, installed_version);
        let values = app.evaluate_profiled(&state, &data, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
        assert_eq!(value(&values, "/ui/children/2/children/7/value"), json!(true));
        assert_eq!(value(&values, "/ui/children/2/children/7/child/end/0/label"), label);
        assert_eq!(value(&values, "/ui/children/2/children/7/child/end/0/disabled"), json!(false));
        // 바꾸기 단추가 강조를 가져가고 열기는 기본이다.
        assert_eq!(value(&values, "/ui/children/2/children/5/child/end/1/variant"), "default");
    }

    // 같은 출처 수정본이라도 스토어 판이 설치 판보다 낮으면 바꾸지 않는다.
    let apps = installed(json!({"store_url":"https://a.example","store_app_id":"notes","release":3,"digest":"abc"}), true, 3, Some(2));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/7/child/end/0/label"), "스토어 판으로 되돌리기");
    assert_eq!(value(&values, "/ui/children/2/children/7/child/end/0/disabled"), json!(true));
    // 잠긴 단추는 강조로 그리지 않는다.
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/1/variant"), "primary");

    // 같은 id의 커스텀 앱은 스토어 상세의 설치 판과 섞이지 않고, 바꾸기는 커스텀 상세에서 한다.
    let apps = installed(Value::Null, false, 1, None);
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/7/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/9/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/9/child/end/0/label"), "설치됨");
    assert_eq!(value(&values, "/ui/children/2/children/9/child/end/0/disabled"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/1/variant"), "primary");

    // 고치지 않은 같은 출처 앱은 보통 업데이트 줄을 쓴다.
    let apps = installed(json!({"store_url":"https://a.example","store_app_id":"notes","release":1,"digest":"abc"}), false, 1, Some(1));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/6/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/7/value"), json!(false));
    assert_eq!(value(&values, "/ui/children/2/children/6/child/end/0/label"), "업데이트");
    assert_eq!(value(&values, "/ui/children/2/children/6/child/end/0/variant"), "primary");
    // 업데이트할 일이 있으면 그 단추가 강조이고 열기는 기본이다.
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/1/variant"), "default");

    // 할 일이 없으면 열기가 강조이고 잠긴 설치는 강조가 아니다.
    let apps = installed(same_origin.clone(), false, 2, Some(2));
    let values = app.evaluate_profiled(&state, &data, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/6/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/6/child/end/0/label"), "설치됨");
    assert_eq!(value(&values, "/ui/children/2/children/6/child/end/0/disabled"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/6/child/end/0/variant"), "default");
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/1/variant"), "primary");

    // 호환되지 않는 판이면 바꾸기 줄은 뜨지만 단추는 잠긴다.
    let incompatible = map(json!({
        "catalog":{"stores":[{"server":"https://a.example","state":"ready","items":[{"id":"notes","name":"메모"}]}]},
        "detail":{"server":"https://a.example","release":2,"compatible":false}
    }));
    let apps = installed(other_origin.clone(), false, 1, Some(1));
    let values = app.evaluate_profiled(&state, &incompatible, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/7/value"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/7/child/end/0/disabled"), json!(true));
    assert_eq!(value(&values, "/ui/children/2/children/5/child/end/1/variant"), "primary");

    // 스토어 목록에 같은 id가 없으면 전환 줄이 없다.
    let unlisted = map(json!({
        "catalog":{"stores":[{"server":"https://a.example","state":"ready","items":[{"id":"other","name":"다른 앱"}]}]},
        "detail":{"server":"https://a.example","release":2,"compatible":true}
    }));
    let apps = installed(other_origin.clone(), false, 1, Some(1));
    let values = app.evaluate_profiled(&state, &unlisted, &empty, &empty, &data_meta, Some(&apps), &BTreeMap::new(), None, &mut |_, _| {});
    assert_eq!(value(&values, "/ui/children/2/children/7/value"), json!(false));

    // 전환은 명시적 replace 요청으로 보낸다.
    let apps = installed(other_origin.clone(), false, 1, Some(1));
    let event = Value::Null;
    let env = Env { state:&state, data:&data, data_meta:&data_meta, storage:&empty, storage_meta:&empty, apps:Some(&apps), event:&event, item:&event, modifiers:None };
    match app.action_step("/ui/children/2/children/7/child/end/0/on_click", 0, &env).unwrap() {
        Step::StoreInstall { permission, server, id, release, replace } => {
            assert_eq!(permission, "catalog");
            assert_eq!(server, json!("https://a.example"));
            assert_eq!(id, json!("notes"));
            assert_eq!(release.as_f64(), Some(2.0));
            assert!(replace);
        }
        other => panic!("예상하지 않은 단계: {other:?}"),
    }
}

