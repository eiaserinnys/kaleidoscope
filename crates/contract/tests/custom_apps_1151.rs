use kaleidoscope_contract::{
    data::{self, Action, Actions},
    store::{InstalledAppValue, StoreOrigin},
    validate::parse_app_definition,
};
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id":"custom-apps-test", "name":"커스텀 앱 시험",
        "requires":{"blocks":25,"modules":{"store":4,"shell":2,"storage":1}},
        "permissions":[{"module":"store","id":"catalog","label":"앱 목록과 설치"}],
        "state":{"selected_app":"example"},
        "ui":{"type":"button","label":"가져오기","on_click":[{"shell.import_app":{}}]}
    })
}

fn action(value: Value) -> Action {
    serde_json::from_value(value).expect("동작 하나를 읽는다")
}

#[test]
fn shell_import_action_roundtrips_without_arguments() {
    let parsed = parse_app_definition(&definition().to_string()).unwrap();
    let actions = data::ui_actions(&parsed);
    let (_, group) = actions.iter().find(|(pointer, _)| pointer == "/ui/on_click").unwrap();
    let Actions::Many(list) = group else { panic!("동작 목록이 아니다") };
    assert!(matches!(list[0], Action::ShellImport(_)));
    assert!(data::action_bindings(&list[0]).is_empty());
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["ui"]["on_click"],
        json!([{"shell.import_app":{}}])
    );
    assert!(matches!(action(json!({"shell.import_app":{}})), Action::ShellImport(_)));
}

#[test]
fn shell_import_rejects_unknown_arguments() {
    let error = serde_json::from_value::<Action>(json!({"shell.import_app":{"path":"/tmp/a.json"}}));
    assert!(error.is_err());
}

#[test]
fn shell_import_requires_shell_two() {
    let mut value = definition();
    value["requires"]["modules"]["shell"] = json!(1);
    let error = parse_app_definition(&value.to_string()).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("APP_SHELL_IMPORT_VERSION_LOW"));
    value["requires"]["modules"]["shell"] = json!(2);
    parse_app_definition(&value.to_string()).unwrap();
}

#[test]
fn store_remove_allow_custom_roundtrips_and_is_omitted_when_false() {
    let mut value = definition();
    value["ui"]["on_click"] = json!([
        {"store.remove":{"permission":"catalog","id":{"state":"selected_app"},"allow_custom":true}}
    ]);
    let parsed = parse_app_definition(&value.to_string()).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["ui"]["on_click"],
        value["ui"]["on_click"]
    );

    let mut plain = definition();
    plain["ui"]["on_click"] = json!([
        {"store.remove":{"permission":"catalog","id":{"state":"selected_app"}}}
    ]);
    let parsed = parse_app_definition(&plain.to_string()).unwrap();
    assert!(!serde_json::to_string(&parsed).unwrap().contains("\"allow_custom\""));
    let mut explicit_false = plain.clone();
    explicit_false["ui"]["on_click"][0]["store.remove"]["allow_custom"] = json!(false);
    let parsed = parse_app_definition(&explicit_false.to_string()).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["ui"]["on_click"],
        plain["ui"]["on_click"]
    );
}

#[test]
fn allow_custom_requires_store_four() {
    let mut value = definition();
    value["requires"]["modules"]["store"] = json!(3);
    value["ui"]["on_click"] = json!([
        {"store.remove":{"permission":"catalog","id":{"state":"selected_app"},"allow_custom":true}}
    ]);
    let error = parse_app_definition(&value.to_string()).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("APP_STORE_REMOVE_CUSTOM_VERSION_LOW"));
    value["requires"]["modules"]["store"] = json!(4);
    parse_app_definition(&value.to_string()).unwrap();
}

#[test]
fn installed_app_value_carries_builtin() {
    let value = InstalledAppValue {
        id: "weather".into(),
        builtin: true,
        name: "날씨".into(),
        version: 2,
        origin: Some(StoreOrigin {
            store_url: "https://example.test/store".into(),
            store_app_id: "weather".into(),
            release: 2,
            digest: "sha256:00".into(),
        }),
        latest: None,
        installed_version: None,
        modified: false,
        icon: None,
    };
    let json = serde_json::to_value(&value).unwrap();
    assert_eq!(json["builtin"], json!(true));

    let parsed: InstalledAppValue = serde_json::from_value(json).unwrap();
    assert!(parsed.builtin);

    let custom: InstalledAppValue = serde_json::from_value(json!({
        "id":"my-app","builtin":false,"name":"내 앱","version":1,
        "origin":null,"latest":null,"installed_version":null,"modified":false,"icon":null
    }))
    .unwrap();
    assert!(!custom.builtin);
}

#[test]
fn shell_module_version_is_two() {
    let version = kaleidoscope_contract::MODULE_VERSIONS
        .iter()
        .find(|(name, _)| *name == "shell")
        .map(|(_, version)| *version);
    assert_eq!(version, Some(2));
}
