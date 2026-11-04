use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::json;

#[test]
fn media_accepts_declared_asset_shape_and_rejects_mixed_shapes() {
    use kaleidoscope_contract::data::MediaRef;
    assert!(
        serde_json::from_value::<MediaRef>(json!({"permission":"photos", "path":"a.png"})).is_ok()
    );
    assert!(serde_json::from_value::<MediaRef>(
        json!({"asset":"builtin-weather-clear", "version":1})
    )
    .is_ok());
    assert!(serde_json::from_value::<MediaRef>(
        json!({"asset":"builtin-weather-clear", "permission":"photos", "path":"a.png"})
    )
    .is_err());
}

#[test]
fn asset_dependencies_require_module_and_unique_positive_version() {
    let mut definition = json!({"id":"asset-test", "name":"자산 시험", "requires":{"blocks":4,"modules":{}},
        "permissions":[], "assets":[{"id":"builtin-weather-clear","version":1}], "ui":{"type":"text", "value":"a"}});
    assert!(parse_app_definition(&definition.to_string()).is_err());
    definition["requires"]["modules"]["assets"] = json!(1);
    assert!(parse_app_definition(&definition.to_string()).is_ok());
    definition["assets"] = json!([{"id":"one","version":1},{"id":"one","version":2}]);
    assert!(parse_app_definition(&definition.to_string()).is_err());
    definition["assets"] = json!([{"id":"one","version":0}]);
    assert!(parse_app_definition(&definition.to_string()).is_err());
}

fn icon_definition() -> serde_json::Value {
    json!({"id":"icon-test", "name":"아이콘 시험", "requires":{"blocks":kaleidoscope_contract::APP_ICON_BLOCK_SET_VERSION,"modules":{"assets":1}},
        "assets":[{"id":"mark","version":1}], "permissions":[], "ui":{"type":"text","value":"시험"}})
}

#[test]
fn app_icon_contract_requires_declared_exact_positive_version() {
    let mut definition = icon_definition();
    definition["requires"]["blocks"] = json!(4);
    let old = parse_app_definition(&definition.to_string()).unwrap();
    assert!(serde_json::to_value(old).unwrap().get("icon").is_none());
    definition["requires"]["blocks"] = json!(kaleidoscope_contract::APP_ICON_BLOCK_SET_VERSION);
    definition["icon"] = json!({"asset":"mark","version":1});
    let app = parse_app_definition(&definition.to_string()).unwrap();
    assert_eq!(
        serde_json::to_value(&app).unwrap()["icon"],
        definition["icon"]
    );
    let mut old_shell = kaleidoscope_contract::Supported::current();
    old_shell.blocks = kaleidoscope_contract::APP_ICON_BLOCK_SET_VERSION - 1;
    assert!(!old_shell.renders_app(&app));
    for (icon, code) in [
        (
            json!({"asset":"mark","version":0}),
            "APP_ICON_VERSION_INVALID",
        ),
        (
            json!({"asset":"missing","version":1}),
            "APP_ICON_ASSET_UNDECLARED",
        ),
        (
            json!({"asset":"mark","version":2}),
            "APP_ICON_VERSION_MISMATCH",
        ),
    ] {
        definition["icon"] = icon;
        let error = parse_app_definition(&definition.to_string()).unwrap_err();
        assert_eq!(error.id.as_deref(), Some(code));
    }
    for icon in [
        json!({"asset":"mark"}),
        json!({"asset":"mark","version":1,"crop":{}}),
    ] {
        definition["icon"] = icon;
        assert!(parse_app_definition(&definition.to_string()).is_err());
    }
    definition["icon"] = json!({"asset":"mark","version":1});
    definition["requires"]["blocks"] = json!(kaleidoscope_contract::APP_ICON_BLOCK_SET_VERSION - 1);
    let error = parse_app_definition(&definition.to_string()).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("APP_ICON_BLOCK_SET_REQUIRED"));
}

#[test]
fn app_icon_schema_has_exact_required_fields() {
    let schema = kaleidoscope_contract::app_definition_schema();
    let icon = &schema["$defs"]["AppIconRef"];
    assert_eq!(icon["additionalProperties"], false);
    assert!(icon["required"]
        .as_array()
        .unwrap()
        .contains(&json!("asset")));
    assert!(icon["required"]
        .as_array()
        .unwrap()
        .contains(&json!("version")));
    assert!(schema["properties"]["icon"].is_object());
    assert_eq!(icon["properties"]["version"]["minimum"].as_f64(), Some(1.0));
    let typescript = include_str!("../../../ui/src/contract/contract.ts");
    assert!(typescript.contains("icon?: AppIconRef"));
    assert!(typescript.contains("export type AppIconRef = { asset: string, version: number, }"));
}
