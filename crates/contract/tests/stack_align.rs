use kaleidoscope_contract::{
    app_definition_schema,
    validate::{parse_app_definition, parse_cached_app_definition},
    APP_AUTHORING_GUIDE,
};
use serde_json::{json, Value};

fn definition(ui: Value, blocks: u64) -> Value {
    json!({
        "id": "stack-alignment",
        "name": "화면 정렬",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [],
        "state": {},
        "ui": ui
    })
}

fn stack(align: Option<&str>) -> Value {
    let mut stack = json!({
        "type": "stack",
        "direction": "row",
        "children": [
            {"type": "text", "value": "이름"},
            {"type": "text", "value": "여러 줄 값"}
        ]
    });
    if let Some(align) = align {
        stack["align"] = json!(align);
    }
    stack
}

#[test]
fn stack_align_requires_block_set_19_and_round_trips_through_cached_definition() {
    for align in ["start", "center", "end", "baseline"] {
        let older = definition(stack(Some(align)), 18);
        let error = parse_app_definition(&older.to_string())
            .expect_err("stack.align must require block set 19");
        assert!(
            error.details.iter().any(|detail| detail.contains("19판")),
            "{align}: {error:?}"
        );

        let current = definition(stack(Some(align)), 19);
        let parsed = parse_app_definition(&current.to_string())
            .unwrap_or_else(|error| panic!("stack.align {align} should be accepted: {error:?}"));
        let serialized = serde_json::to_value(parsed).unwrap();
        assert_eq!(serialized.pointer("/ui/align"), Some(&json!(align)));
        let cached = parse_cached_app_definition(&serialized.to_string()).unwrap();
        assert_eq!(serde_json::to_value(cached).unwrap(), serialized);
    }
}

#[test]
fn omitted_stack_align_keeps_the_legacy_wire_and_center_placement_contract() {
    let legacy = definition(stack(None), 18);
    let parsed = parse_app_definition(&legacy.to_string()).unwrap();
    let serialized = serde_json::to_value(parsed).unwrap();
    assert!(serialized.pointer("/ui/align").is_none());
    let cached = parse_cached_app_definition(&serialized.to_string()).unwrap();
    assert_eq!(serde_json::to_value(cached).unwrap(), serialized);

    let mut centered = stack(Some("baseline"));
    centered["place"] = json!("center");
    let centered = parse_app_definition(&definition(centered, 19).to_string()).unwrap();
    assert_eq!(serde_json::to_value(centered).unwrap()["ui"]["align"], "baseline");
    let schema = app_definition_schema().to_string();
    assert!(schema.contains("align"));
    assert!(APP_AUTHORING_GUIDE.contains("stack.align"));
}
