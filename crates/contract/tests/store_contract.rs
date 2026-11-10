use kaleidoscope_contract::{
    app_definition_schema,
    data::{self, SourceDecl},
    validate::{parse_app_definition, parse_app_definition_with_supported},
    Supported,
};
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id":"store-test", "name":"스토어 시험",
        "requires":{"blocks":25,"modules":{"store":1,"storage":1}},
        "permissions":[{"module":"store","id":"catalog","label":"앱 목록과 설치"}],
        "storage":{"entries":[{"id":"server","key":"server","kind":"json","schema":{"type":"object","properties":{"url":{"type":"string"}}},"default":{"url":"https://example.test/store"},"label":"스토어","presentation":"hidden"}]},
        "state":{"selected_app":"example","selected_release":3},
        "sources":{
            "catalog":{"kind":"store","store":"index","permission":"catalog","server":{"expr":"$storage.server.url"}},
            "detail":{"kind":"store","store":"app","permission":"catalog","server":{"expr":"$storage.server.url"},"id":{"state":"selected_app"}}
        },
        "ui":{"type":"button","label":"설치","on_click":[
            {"store.install":{"permission":"catalog","server":{"expr":"$data.detail.server"},"id":{"state":"selected_app"},"release":{"state":"selected_release"}}},
            {"store.remove":{"permission":"catalog","id":{"state":"selected_app"}}}
        ]}
    })
}

fn supported() -> Supported {
    let mut supported = Supported::current();
    supported.modules.insert("store".into(), 1);
    supported
}

#[test]
fn badge_requires_current_blocks_and_only_apps_context() {
    let mut value = definition();
    value["requires"]["blocks"] = json!(39);
    value["badge"] = json!({"expr":"$count($apps[latest.compatible = true])"});
    parse_app_definition(&value.to_string()).unwrap();
    value["badge"] = json!({"expr":"$state.selected_app"});
    assert_eq!(parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(), Some("APP_BADGE_VARIABLE_FORBIDDEN"));
    value["badge"] = json!(1);
    value["requires"]["blocks"] = json!(38);
    assert_eq!(parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(), Some("APP_BADGE_VERSION_LOW"));
}

#[test]
fn store_example_roundtrips_and_is_valid_with_store_support() {
    let value = definition();
    let parsed = parse_app_definition_with_supported(&value.to_string(), &supported()).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["sources"],
        value["sources"]
    );
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["ui"]["on_click"],
        value["ui"]["on_click"]
    );
    let source = &parsed.sources["detail"];
    assert!(matches!(source, SourceDecl::Store(_)));
    assert!(data::source_bindings(source)
        .iter()
        .any(|(name, _)| name == "server"));
    assert!(data::source_bindings(source)
        .iter()
        .any(|(name, _)| name == "id"));
    assert!(data::all_exprs(&parsed)
        .iter()
        .any(|(at, _)| at == "/sources/detail/server"));
    assert!(app_definition_schema()
        .to_string()
        .contains("store.install"));
}

#[test]
fn current_shell_supports_store_four_but_rejects_newer_versions() {
    parse_app_definition(&definition().to_string()).unwrap();
    let mut newer = definition();
    newer["requires"]["modules"]["store"] = json!(2);
    parse_app_definition(&newer.to_string()).unwrap();
    newer["requires"]["modules"]["store"] = json!(3);
    parse_app_definition(&newer.to_string()).unwrap();
    newer["requires"]["modules"]["store"] = json!(4);
    parse_app_definition(&newer.to_string()).unwrap();
    newer["requires"]["modules"]["store"] = json!(5);
    let error = parse_app_definition(&newer.to_string()).unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("APP_DEFINITION_REQUIRES_NEWER_SHELL")
    );
}

#[test]
fn install_replace_roundtrips_and_is_omitted_when_false() {
    let mut replaced = definition();
    replaced["requires"]["modules"]["store"] = json!(4);
    replaced["ui"]["on_click"][0]["store.install"]["replace"] = json!(true);
    let parsed = parse_app_definition(&replaced.to_string()).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["ui"]["on_click"],
        replaced["ui"]["on_click"]
    );

    let plain = definition();
    let parsed = parse_app_definition(&plain.to_string()).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["ui"]["on_click"],
        plain["ui"]["on_click"]
    );
    assert!(!serde_json::to_string(&parsed).unwrap().contains("\"replace\""));

    let mut explicit_false = definition();
    explicit_false["ui"]["on_click"][0]["store.install"]["replace"] = json!(false);
    let parsed = parse_app_definition(&explicit_false.to_string()).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["ui"]["on_click"],
        plain["ui"]["on_click"]
    );
}

#[test]
fn replace_requires_store_four() {
    let mut value = definition();
    value["requires"]["modules"]["store"] = json!(3);
    value["ui"]["on_click"][0]["store.install"]["replace"] = json!(true);
    assert_eq!(
        parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(),
        Some("APP_STORE_REPLACE_VERSION_LOW")
    );
    value["requires"]["modules"]["store"] = json!(4);
    parse_app_definition(&value.to_string()).unwrap();
}

#[test]
fn undeclared_permission_module_and_missing_app_id_are_rejected() {
    let mut no_permission = definition();
    no_permission["permissions"] = json!([]);
    let err =
        parse_app_definition_with_supported(&no_permission.to_string(), &supported()).unwrap_err();
    assert_eq!(err.id.as_deref(), Some("APP_STORE_PERMISSION_UNDECLARED"));
    let mut no_module = definition();
    no_module["requires"]["modules"] = json!({"storage":1});
    let err =
        parse_app_definition_with_supported(&no_module.to_string(), &supported()).unwrap_err();
    assert_eq!(err.id.as_deref(), Some("APP_STORE_MODULE_REQUIRED"));
    let mut wrong_permission = definition();
    wrong_permission["requires"]["modules"]["files"] = json!(1);
    wrong_permission["permissions"][0] =
        json!({"module":"files","id":"catalog","label":"폴더","access":"read"});
    assert_eq!(
        parse_app_definition_with_supported(&wrong_permission.to_string(), &supported())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_STORE_PERMISSION_MISMATCH")
    );
    let mut no_id = definition();
    no_id["sources"]["detail"]
        .as_object_mut()
        .unwrap()
        .remove("id");
    assert_eq!(
        parse_app_definition_with_supported(&no_id.to_string(), &supported())
            .unwrap_err()
            .id
            .as_deref(),
        Some("APP_STORE_SOURCE_ID_MISSING")
    );
}

#[test]
fn literal_release_must_be_positive_integer() {
    for release in [json!(0), json!(-1), json!(1.5), json!(null)] {
        let mut value = definition();
        value["ui"]["on_click"][0]["store.install"]["release"] = release;
        assert_eq!(
            parse_app_definition_with_supported(&value.to_string(), &supported())
                .unwrap_err()
                .id
                .as_deref(),
            Some("APP_STORE_RELEASE_INVALID")
        );
    }
}

#[test]
fn store_budget_is_grouped_by_permission_and_counts_only_refresh() {
    let mut value = definition();
    value["sources"]["catalog"]["refresh_secs"] = json!(30);
    value["sources"]["detail"]["refresh_secs"] = json!(60);
    let parsed = parse_app_definition_with_supported(&value.to_string(), &supported()).unwrap();
    let budget = data::call_budget(&parsed);
    assert_eq!(budget.len(), 1);
    assert_eq!(budget[0].host, "store:catalog");
    assert_eq!(budget[0].default_per_minute, 1.0);
    assert_eq!(budget[0].all_per_minute, 3.0);
    value["sources"]["catalog"]
        .as_object_mut()
        .unwrap()
        .remove("refresh_secs");
    value["sources"]["detail"]
        .as_object_mut()
        .unwrap()
        .remove("refresh_secs");
    let parsed = parse_app_definition_with_supported(&value.to_string(), &supported()).unwrap();
    assert!(data::call_budget(&parsed)
        .iter()
        .all(|budget| budget.all_per_minute == 0.0));
}

#[test]
fn consent_and_install_wire_roundtrip_and_legacy_app_omits_origin() {
    use kaleidoscope_contract::{
        store::{DeviceInstallRequest, DeviceRemoveRequest, StoreDetailValue},
        App, CoreEvent, CoreRequest,
    };
    let app_json = definition();
    let event = json!({"event":"app.install_permission", "window_id":"window", "request_id":"request", "app_name":"앱", "release":3, "store_url":"https://example.test/store", "digest":"abc", "definition":app_json});
    let parsed: CoreEvent = serde_json::from_value(event.clone()).unwrap();
    assert_eq!(
        serde_json::to_value(parsed).unwrap()["store_url"],
        event["store_url"]
    );
    let mut missing_store = event.clone();
    missing_store.as_object_mut().unwrap().remove("store_url");
    assert!(serde_json::from_value::<CoreEvent>(missing_store).is_err());
    let response = json!({"op":"app.respond_install_permission", "window_id":"window", "request_id":"request", "digest":"abc", "allow":true});
    let parsed: CoreRequest = serde_json::from_value(response.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), response);
    let install = json!({"definition_json":"{}", "asset_uploads":[], "manifest_base64":"e30=", "approved_digest":"abc", "origin":{"store_url":"https://example.test/store", "store_app_id":"example", "release":3, "digest":"abc"}, "expected_current_version":null});
    let parsed: DeviceInstallRequest = serde_json::from_value(install.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), install);
    let mut missing_version = install.clone();
    missing_version
        .as_object_mut()
        .unwrap()
        .remove("expected_current_version");
    assert!(serde_json::from_value::<DeviceInstallRequest>(missing_version).is_err());
    let mut invalid_install = install.clone();
    invalid_install["expected_current_version"] = json!(0);
    assert!(serde_json::from_value::<DeviceInstallRequest>(invalid_install).is_err());
    assert!(
        serde_json::from_value::<DeviceRemoveRequest>(json!({"expected_current_version":0}))
            .is_err()
    );
    let remove = json!({"expected_current_version":3});
    assert_eq!(
        serde_json::to_value(
            serde_json::from_value::<DeviceRemoveRequest>(remove.clone()).unwrap()
        )
        .unwrap(),
        remove
    );
    let old =
        json!({"id":"old","name":"옛 앱","current_version":1,"created_at":"t","updated_at":"t"});
    assert_eq!(
        serde_json::to_value(serde_json::from_value::<App>(old.clone()).unwrap()).unwrap(),
        old
    );
    let detail = json!({"format":1,"id":"example","name":"앱","summary":"요약","description":"설명","category":"도구","publisher":"author","release":3,"icon":null,"screenshots":[{"permission":"catalog","path":"apps/example/3/screenshots/1.png","query":{"server":"https://example.test/store"}}],"releases":[{"release":3,"published_at":"t","manifest":"apps/example/3/manifest.json"}],"server":"https://example.test/store","compatible":true,"requires":{"blocks":25,"modules":{"store":1}},"permissions":[{"module":"store","id":"catalog","label":"스토어"}],"badges":[]});
    let parsed: StoreDetailValue = serde_json::from_value(detail.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), detail);
}

#[test]
fn install_replace_and_remove_allow_custom_default_to_false_and_are_omitted() {
    use kaleidoscope_contract::store::{DeviceInstallRequest, DeviceRemoveRequest};
    let install = json!({"definition_json":"{}", "asset_uploads":[], "manifest_base64":"e30=", "approved_digest":"abc", "origin":{"store_url":"https://example.test/store", "store_app_id":"example", "release":3, "digest":"abc"}, "expected_current_version":null});
    let parsed: DeviceInstallRequest = serde_json::from_value(install.clone()).unwrap();
    assert!(!parsed.replace);
    assert_eq!(serde_json::to_value(parsed).unwrap(), install);
    let mut replace = install;
    replace["replace"] = json!(true);
    let parsed: DeviceInstallRequest = serde_json::from_value(replace.clone()).unwrap();
    assert!(parsed.replace);
    assert_eq!(serde_json::to_value(parsed).unwrap(), replace);

    let remove = json!({"expected_current_version":3});
    let parsed: DeviceRemoveRequest = serde_json::from_value(remove.clone()).unwrap();
    assert!(!parsed.allow_custom);
    assert_eq!(serde_json::to_value(parsed).unwrap(), remove);
    let mut allow = remove;
    allow["allow_custom"] = json!(true);
    let parsed: DeviceRemoveRequest = serde_json::from_value(allow.clone()).unwrap();
    assert!(parsed.allow_custom);
    assert_eq!(serde_json::to_value(parsed).unwrap(), allow);
}

#[test]
fn store_connection_contract_rejects_secret_fields_and_relay() {
    use kaleidoscope_contract::store::StoreConnection;
    let oauth = json!({"name":"fixture","kind":"oauth","base_url":"https://example.com","paths":["/api/"],"writable":false,"description":"시험"});
    let parsed: StoreConnection = serde_json::from_value(oauth.clone()).unwrap();
    assert_eq!(parsed.name, "fixture");
    let mut relay = oauth.clone(); relay["kind"] = json!("relay");
    assert!(serde_json::from_value::<StoreConnection>(relay).is_err());
    let mut secret = oauth; secret["headers"] = json!({"Authorization":"secret"});
    assert!(serde_json::from_value::<StoreConnection>(secret).is_err());
}

#[test]
fn store_index_does_not_allow_app_id() {
    let mut value = definition();
    value["sources"]["catalog"]["id"] = json!("example");
    assert!(parse_app_definition_with_supported(&value.to_string(), &supported()).is_err());
}

#[test]
fn allow_server_requires_store_three_and_roundtrips_wire() {
    let mut value = definition();
    value["ui"]["on_click"] = json!([{"store.allow_server":{"permission":"catalog","server":{"state":"selected_app"}}}]);
    value["requires"]["modules"]["store"] = json!(3);
    let parsed = parse_app_definition(&value.to_string()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["on_click"], value["ui"]["on_click"]);
    value["requires"]["modules"]["store"] = json!(2);
    assert!(parse_app_definition(&value.to_string()).is_err());
    value["requires"]["modules"]["store"] = json!(3);
    value["permissions"] = json!([]);
    assert_eq!(parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(), Some("APP_STORE_PERMISSION_UNDECLARED"));
    let event = json!({"event":"store.server_permission","window_id":"w","request_id":"r","app_name":"앱","server":"http://localhost:8080"});
    let response = json!({"op":"store.respond_server_permission","window_id":"w","request_id":"r","server":"http://localhost:8080","allow":true});
    assert_eq!(serde_json::to_value(serde_json::from_value::<kaleidoscope_contract::CoreEvent>(event.clone()).unwrap()).unwrap(), event);
    assert_eq!(serde_json::to_value(serde_json::from_value::<kaleidoscope_contract::CoreRequest>(response.clone()).unwrap()).unwrap(), response);
}

#[test]
fn indexes_requires_store_three_and_has_no_refresh_field() {
    let mut value = definition();
    value["requires"]["modules"]["store"] = json!(3);
    value["sources"]["catalog"] = json!({"kind":"store","store":"indexes","permission":"catalog","servers":{"state":"servers"}});
    value["state"]["servers"] = json!([]);
    let parsed = parse_app_definition(&value.to_string()).unwrap();
    assert_eq!(serde_json::to_value(&parsed).unwrap()["sources"]["catalog"], value["sources"]["catalog"]);
    assert!(data::source_bindings(&parsed.sources["catalog"]).iter().any(|(name, _)| name == "servers"));
    let mut old_shell = Supported::current();
    old_shell.modules.insert("store".into(), 2);
    assert!(parse_app_definition_with_supported(&value.to_string(), &old_shell).is_err());
    value["requires"]["modules"]["store"] = json!(2);
    assert_eq!(parse_app_definition(&value.to_string()).unwrap_err().id.as_deref(), Some("APP_STORE_INDEXES_VERSION_LOW"));
    value["requires"]["modules"]["store"] = json!(3);
    value["sources"]["catalog"]["refresh_secs"] = json!(60);
    assert!(parse_app_definition(&value.to_string()).is_err());
    fn find_indexes(value: &Value) -> Option<&Value> {
        if value["properties"]["store"]["const"] == "indexes" { return Some(value); }
        match value {
            Value::Object(object) => object.values().find_map(find_indexes),
            Value::Array(array) => array.iter().find_map(find_indexes),
            _ => None,
        }
    }
    let schema = app_definition_schema();
    let indexes = find_indexes(&schema).expect("indexes schema");
    assert!(indexes["properties"].get("refresh_secs").is_none());
}
