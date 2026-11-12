use kaleidoscope_contract::{
    data::{AppIconMediaRef, MediaRef},
    store::InstalledAppValue,
    validate::parse_app_definition,
    APP_ICON_MEDIA_BLOCK_SET_VERSION, BLOCK_SET_VERSION,
};
use serde_json::{json, Value};

#[test]
fn app_icon_media_reference_round_trips_and_rejects_other_fields() {
    let reference: MediaRef =
        serde_json::from_value(json!({"app_icon": "memo", "app_version": 3})).unwrap();
    assert_eq!(
        reference,
        MediaRef::AppIcon(AppIconMediaRef {
            app_icon: "memo".into(),
            app_version: 3,
        })
    );
    assert_eq!(
        serde_json::to_value(&reference).unwrap(),
        json!({"app_icon": "memo", "app_version": 3})
    );
    for bad in [
        json!({"app_icon": "memo"}),
        json!({"app_icon": "memo", "version": 3}),
        json!({"app_icon": "memo", "app_version": 3, "crop": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}}),
        json!({"app_icon": "memo", "app_version": 3, "asset": "photo"}),
    ] {
        assert!(
            serde_json::from_value::<MediaRef>(bad.clone()).is_err(),
            "거부해야 한다: {bad}"
        );
    }
}

#[test]
fn app_icon_media_schema_and_versions_are_registered() {
    assert_eq!(BLOCK_SET_VERSION, APP_ICON_MEDIA_BLOCK_SET_VERSION);
    let text = serde_json::to_string(&schemars::schema_for!(kaleidoscope_contract::data::MediaRef))
        .expect("schema serializes");
    assert!(text.contains("AppIconMediaRef"), "missing AppIconMediaRef");
    assert!(
        text.contains("\"required\":[\"app_icon\",\"app_version\"]"),
        "app_icon과 app_version은 필수다"
    );
}

#[test]
fn installed_app_icon_serializes_as_an_app_icon_reference() {
    let value = InstalledAppValue {
        id: "memo".into(),
        builtin: false,
        name: "메모".into(),
        version: 3,
        origin: None,
        latest: None,
        installed_version: None,
        modified: false,
        icon: Some(AppIconMediaRef {
            app_icon: "memo".into(),
            app_version: 3,
        }),
    };
    assert_eq!(
        serde_json::to_value(&value).unwrap()["icon"],
        json!({"app_icon": "memo", "app_version": 3})
    );
    let without = InstalledAppValue {
        icon: None,
        ..value
    };
    let without = serde_json::to_value(&without).unwrap();
    assert_eq!(without["icon"], Value::Null);
}

fn definition(blocks: u32, permissions: Value) -> Value {
    json!({
        "id": "app-icon-media-test",
        "name": "앱 아이콘 미디어 시험",
        "requires": {"blocks": blocks, "modules": {"store": 4}},
        "permissions": permissions,
        "state": {},
        "ui": {"type": "image", "src": {"app_icon": "memo", "app_version": 3}}
    })
}

#[test]
fn image_literal_with_app_icon_requires_store_permission_and_new_block_set() {
    let version = APP_ICON_MEDIA_BLOCK_SET_VERSION;
    let error = parse_app_definition(&definition(version, json!([])).to_string())
        .expect_err("store 권한이 없으면 app_icon을 그릴 수 없다");
    let text = format!("{error:?}");
    assert!(text.contains("store 권한을 선언해야"), "{text}");
    assert!(!text.contains("requires.blocks가"), "{text}");
    let error = parse_app_definition(
        &definition(
            version - 1,
            json!([{"module": "store", "id": "catalog", "label": "앱 목록과 설치"}]),
        )
        .to_string(),
    )
    .expect_err("새 판이 필요하다");
    let text = format!("{error:?}");
    assert!(
        text.contains(&format!("requires.blocks가 {version} 이상")),
        "{text}"
    );
    assert!(!text.contains("store 권한을 선언해야"), "{text}");
    parse_app_definition(
        &definition(
            version,
            json!([{"module": "store", "id": "catalog", "label": "앱 목록과 설치"}]),
        )
        .to_string(),
    )
    .expect("store 권한과 새 판이 있으면 지나간다");
}
