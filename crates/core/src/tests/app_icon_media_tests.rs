use super::*;
use kaleidoscope_contract::data::{BindingValue, MediaRef};

fn definition(id: &str, with_store: bool, ui: Value) -> String {
    let modules = if with_store {
        json!({"store": 4})
    } else {
        json!({})
    };
    let permissions = if with_store {
        json!([{"module": "store", "id": "catalog", "label": "앱 목록과 설치"}])
    } else {
        json!([])
    };
    json!({
        "id": id,
        "name": "다른 앱 아이콘 시험",
        "requires": {"blocks": kaleidoscope_contract::APP_ICON_MEDIA_BLOCK_SET_VERSION, "modules": modules},
        "permissions": permissions,
        "state": {},
        "ui": ui
    })
    .to_string()
}

fn media(core: &Core, window: &str, value: Value) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::DataMedia {
        window_id: window.to_string(),
        media: serde_json::from_value::<MediaRef>(value).unwrap(),
        max_px: None,
    })
}

fn installed_version(core: &Core, app_id: &str) -> u32 {
    snapshot(core)
        .shared
        .apps
        .iter()
        .find(|app| app.id == app_id)
        .unwrap()
        .current_version
}

#[test]
fn app_icon_media_returns_the_other_apps_bundled_icon() {
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![definition(
            "icon-caller",
            true,
            json!({"type": "text", "value": "시험"}),
        )],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "icon-caller");
    let version = installed_version(&core, "calculator");
    let reply = serde_json::to_value(
        media(
            &core,
            &window,
            json!({"app_icon": "calculator", "app_version": version}),
        )
        .unwrap(),
    )
    .unwrap();
    let launcher = serde_json::to_value(
        core.handle(CoreRequest::AppIcon {
            app_id: "calculator".into(),
            app_version: version,
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(reply["media"]["mime"], "image/svg+xml");
    assert_eq!(reply["media"], launcher["media"]);
}

#[test]
fn app_icon_media_requires_store_permission_in_the_drawing_window() {
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![definition(
            "plain-caller",
            false,
            json!({"type": "text", "value": "시험"}),
        )],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "plain-caller");
    let version = installed_version(&core, "calculator");
    let error = media(
        &core,
        &window,
        json!({"app_icon": "calculator", "app_version": version}),
    )
    .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("MEDIA_LOAD_APP_ICON_STORE_PERMISSION_MISSING")
    );
}

#[test]
fn app_icon_media_reports_an_app_that_declares_no_icon() {
    let temp = TempDir::new().unwrap();
    let no_icon = json!({
        "id": "no-icon-app", "name": "아이콘 없는 앱",
        "requires": {"blocks": 4, "modules": {}}, "permissions": [], "state": {},
        "ui": {"type": "text", "value": "시험"}
    })
    .to_string();
    let core = open_core(
        temp.path(),
        vec![
            no_icon,
            definition(
                "icon-caller",
                true,
                json!({"type": "text", "value": "시험"}),
            ),
        ],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "icon-caller");
    let version = installed_version(&core, "no-icon-app");
    let error = media(
        &core,
        &window,
        json!({"app_icon": "no-icon-app", "app_version": version}),
    )
    .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("MEDIA_LOAD_APP_ICON_NOT_DECLARED"));
}

#[test]
fn apps_values_give_app_icon_references_only_to_apps_with_icons() {
    let temp = TempDir::new().unwrap();
    let icon_app = json!({
        "id": "icon-app", "name": "아이콘 앱",
        "requires": {"blocks": kaleidoscope_contract::APP_ICON_BLOCK_SET_VERSION, "modules": {"assets": 1}},
        "permissions": [], "state": {},
        "assets": [{"id": "builtin-icon-calculator", "version": 2}],
        "icon": {"asset": "builtin-icon-calculator", "version": 2},
        "ui": {"type": "text", "value": "시험"}
    })
    .to_string();
    let no_icon = json!({
        "id": "no-icon-app", "name": "아이콘 없는 앱",
        "requires": {"blocks": 4, "modules": {}}, "permissions": [], "state": {},
        "ui": {"type": "text", "value": "시험"}
    })
    .to_string();
    let core = open_core(
        temp.path(),
        vec![
            icon_app,
            no_icon,
            definition(
                "apps-caller",
                true,
                json!({"type": "list", "items": {"expr": "$apps"}}),
            ),
        ],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "apps-caller");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    let value = crate::data_runtime::binding_value(&core.inner, &window, "/ui/items")
        .expect("$apps 바인딩");
    let BindingValue::Ready { value, .. } = value else {
        panic!("$apps가 실패했다: {value:?}")
    };
    let apps = value.as_array().unwrap();
    let with_icon = apps.iter().find(|app| app["id"] == "icon-app").unwrap();
    assert_eq!(with_icon["icon"]["app_icon"], json!("icon-app"));
    assert_eq!(
        with_icon["icon"]["app_version"].as_f64(),
        Some(f64::from(installed_version(&core, "icon-app")))
    );
    let without_icon = apps.iter().find(|app| app["id"] == "no-icon-app").unwrap();
    assert_eq!(without_icon["icon"], Value::Null);
}
