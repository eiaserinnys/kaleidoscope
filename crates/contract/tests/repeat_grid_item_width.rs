use kaleidoscope_contract::validate::{parse_app_definition, parse_cached_app_definition};
use serde_json::{json, Value};

fn definition(blocks: u32, grid: Value) -> Value {
    json!({
        "id": "repeat-grid-width",
        "name": "격자 폭",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [],
        "state": {},
        "ui": {
            "type": "repeat",
            "items": [],
            "key": "id",
            "layout": "grid",
            "grid": grid,
            "template": {"type": "text", "value": "표본"}
        }
    })
}

#[test]
fn item_width_is_optional_and_omitted_by_default() {
    let app = definition(19, json!({"columns": "auto"}));
    let parsed = parse_app_definition(&app.to_string()).expect("medium remains the default");
    let serialized = serde_json::to_value(parsed).expect("definition serializes");
    assert_eq!(serialized["ui"]["grid"], json!({"columns": "auto"}));
    assert!(parse_cached_app_definition(&serialized.to_string()).is_ok());
}

#[test]
fn every_item_width_variant_roundtrips_through_cached_definitions() {
    for width in ["small", "medium", "large"] {
        let app = definition(20, json!({"columns": "auto", "item_width": width}));
        let parsed = parse_app_definition(&app.to_string()).expect("item width parses");
        let serialized = serde_json::to_value(parsed).expect("definition serializes");
        assert_eq!(serialized["ui"]["grid"]["item_width"], width);
        let cached =
            parse_cached_app_definition(&serialized.to_string()).expect("cached definition parses");
        assert_eq!(serde_json::to_value(cached).unwrap(), serialized);
    }
}

#[test]
fn item_width_requires_block_set_20() {
    let error = parse_app_definition(
        &definition(19, json!({"columns": "auto", "item_width": "small"})).to_string(),
    )
    .expect_err("item_width is block set 20");
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("repeat.grid.item_width")),
        "{error:?}"
    );
    assert!(
        error.details.iter().any(|detail| detail.contains("20")),
        "{error:?}"
    );
}

#[test]
fn item_width_requires_block_set_20_inside_settings_ui() {
    let mut app = definition(19, json!({"columns": "auto"}));
    app["ui"] = json!({"type": "text", "value": "Body"});
    app["settings"] = json!({
        "ui": {
            "type": "repeat",
            "items": [],
            "key": "id",
            "layout": "grid",
            "grid": {"columns": "auto", "item_width": "small"},
            "template": {"type": "text", "value": "표본"}
        }
    });

    let error = parse_app_definition(&app.to_string())
        .expect_err("item_width in settings UI is block set 20");
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("repeat.grid.item_width") && detail.contains("20")),
        "{error:?}"
    );

    let cached_error = parse_cached_app_definition(&app.to_string())
        .expect_err("cached settings item_width is also block set 20");
    assert!(
        cached_error
            .details
            .iter()
            .any(|detail| detail.contains("repeat.grid.item_width") && detail.contains("20")),
        "{cached_error:?}"
    );
}

#[test]
fn fixed_columns_reject_item_width_with_a_specific_error() {
    let error = parse_app_definition(
        &definition(20, json!({"columns": 2, "item_width": "small"})).to_string(),
    )
    .expect_err("item_width only applies to automatic columns");
    assert_eq!(
        error.id.as_deref(),
        Some("APP_REPEAT_GRID_ITEM_WIDTH_FIXED_COLUMNS")
    );
    assert!(error.message.contains("grid.columns"), "{}", error.message);
    assert!(
        error.message.contains("grid.item_width"),
        "{}",
        error.message
    );
}
