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
