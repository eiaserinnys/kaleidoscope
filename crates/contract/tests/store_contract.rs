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
        "requires":{"blocks":25,"modules":{"store":1}},
        "permissions":[{"module":"store","id":"catalog","label":"앱 목록과 설치"}],
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
fn store_example_roundtrips_and_is_valid_with_store_support() {
    let value = definition();
    let parsed = parse_app_definition_with_supported(&value.to_string(), &supported()).unwrap();
    assert_eq!(serde_json::to_value(&parsed).unwrap()["sources"], value["sources"]);
    assert_eq!(serde_json::to_value(&parsed).unwrap()["ui"], value["ui"]);
    let source = &parsed.sources["detail"];
    assert!(matches!(source, SourceDecl::Store(_)));
    assert!(data::source_bindings(source).iter().any(|(name, _)| name == "server"));
    assert!(data::source_bindings(source).iter().any(|(name, _)| name == "id"));
    assert!(data::all_exprs(&parsed).iter().any(|(at, _)| at == "/sources/detail/server"));
    assert!(app_definition_schema().to_string().contains("store.install"));
}

#[test]
fn current_shell_rejects_store_as_unsupported() {
    let error = parse_app_definition(&definition().to_string()).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("APP_DEFINITION_REQUIRES_NEWER_SHELL"));
}

#[test]
fn undeclared_permission_module_and_missing_app_id_are_rejected() {
    let mut no_permission = definition();
    no_permission["permissions"] = json!([]);
    let err = parse_app_definition_with_supported(&no_permission.to_string(), &supported()).unwrap_err();
    assert!(format!("{err:?}").contains("catalog"));
    let mut no_module = definition();
    no_module["requires"]["modules"] = json!({});
    let err = parse_app_definition_with_supported(&no_module.to_string(), &supported()).unwrap_err();
    assert!(format!("{err:?}").contains("store"));
    let mut no_id = definition();
    no_id["sources"]["detail"].as_object_mut().unwrap().remove("id");
    assert!(parse_app_definition_with_supported(&no_id.to_string(), &supported()).is_err());
}

#[test]
fn literal_release_must_be_positive_integer() {
    for release in [json!(0), json!(-1), json!(1.5), json!(null)] {
        let mut value = definition();
        value["ui"]["on_click"][0]["store.install"]["release"] = release;
        assert!(parse_app_definition_with_supported(&value.to_string(), &supported()).is_err());
    }
}
