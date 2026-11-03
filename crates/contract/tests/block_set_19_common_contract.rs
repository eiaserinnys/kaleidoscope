use kaleidoscope_contract::{
    BLOCK_SET_VERSION, app_definition_schema,
    data::{self, Binding}, Block,
    validate::{parse_app_definition, parse_cached_app_definition},
};
use serde_json::{Value, json};

fn definition(ui: Value, blocks: u64) -> Value {
    json!({
        "id": "block-set-19-common",
        "name": "블록 세트 19 공통 계약",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [],
        "state": {"name": "이름", "confirmed": false},
        "ui": ui
    })
}

fn button() -> Value {
    json!({
        "type": "button",
        "label": "선택",
        "on_click": [{"set_state": "confirmed", "value": true}]
    })
}

fn canvas_preview_definition(mut value: Value) -> Value {
    value["requires"]["modules"] = json!({"assets": 1, "client": 1});
    value["assets"] = json!([{"id": "renderer", "version": 1}]);
    value["client"] = json!({
        "runtime": "javascript",
        "entry": {"id": "renderer", "version": 1},
        "inputs": {},
        "outputs": {},
        "actions": [],
        "commands": {},
        "state_keys": [],
        "storage_entries": []
    });
    value
}

#[test]
fn every_new_common_field_requires_block_set_19() {
    let mut input = json!({
        "type": "input",
        "value": {"state": "name"},
        "on_change": {"set_state": "name"},
        "columns": 4
    });
    let mut button_preview = button();
    button_preview["preview"] = json!({"type": "image", "src": null});
    let mut button_prefix = button();
    button_prefix["prefix"] = json!("기법");
    let property_label = json!({
        "type": "properties",
        "fields": [{"label": {"state": "name"}, "value": "이름"}]
    });
    let swatches = json!({
        "type": "properties",
        "fields": [{"label": "색", "value": ["#000000", "#ffffff"], "format": "swatches"}]
    });
    let properties_rows = json!({
        "type": "properties",
        "layout": "rows",
        "fields": [{"label": "이름", "value": "값"}]
    });
    let canvas_loading = json!({
        "type": "canvas",
        "surface": "stage",
        "loading": {"state": "confirmed"}
    });
    let when_min_width = json!({"type": "when", "min_width": 480, "child": button()});
    let when_max_width = json!({"type": "when", "max_width": 720, "child": button()});

    let cases = [
        ("input.columns", input.take(), false),
        ("button.preview", button_preview, false),
        ("button.prefix", button_prefix, false),
        ("PropertyField.label binding", property_label, false),
        ("FieldFormat.swatches", swatches, false),
        ("properties.layout", properties_rows, false),
        ("canvas.loading", canvas_loading, true),
        ("when.min_width", when_min_width, false),
        ("when.max_width", when_max_width, false),
        (
            "canvas button.preview",
            {
                let mut control = button();
                control["preview"] = json!({"type": "canvas", "surface": "preview"});
                control
            },
            true,
        ),
    ];

    for (field, ui, needs_client) in cases {
        let mut old = definition(ui.clone(), 18);
        if needs_client {
            old = canvas_preview_definition(old);
        }
        let error = match parse_app_definition(&old.to_string()) {
            Ok(_) => panic!("{field} must require block set 19"),
            Err(error) => error,
        };
        assert!(
            error.details.iter().any(|detail| detail.contains("19판")),
            "{field}: {error:?}"
        );

        let mut current = definition(ui, 19);
        if needs_client {
            current = canvas_preview_definition(current);
        }
        parse_app_definition(&current.to_string())
            .unwrap_or_else(|error| panic!("{field} must be accepted in block set 19: {error:?}"));
    }

    assert_eq!(BLOCK_SET_VERSION, 19);
}

#[test]
fn when_requires_a_value_or_width_condition_with_a_registered_error() {
    let empty_when = json!({"type": "when", "child": button()});
    let error = parse_app_definition(&definition(empty_when, 19).to_string())
        .expect_err("when without any condition must fail validation");

    assert_eq!(
        error.id.as_deref(),
        Some("APP_DEFINITION_WHEN_CONDITION_MISSING"),
        "{error:?}"
    );
    assert!(error.message.contains("min_width"), "{error:?}");
    assert!(error.message.contains("max_width"), "{error:?}");
    assert!(error.details.iter().any(|detail| {
        detail.contains("/ui") && detail.contains("value, min_width, max_width")
    }), "{error:?}");
}

#[test]
fn legacy_null_value_when_round_trips_through_block_and_cached_definition() {
    let ui = json!({"type": "when", "value": null, "child": button()});
    let block: Block = serde_json::from_value(ui.clone()).unwrap();
    assert!(matches!(
        &block,
        Block::When {
            value: Some(Binding::Literal(Value::Null)),
            min_width: None,
            max_width: None,
            ..
        }
    ));
    let serialized_block = serde_json::to_value(block).unwrap();
    assert_eq!(serialized_block.get("value"), Some(&Value::Null));

    let legacy = definition(ui, 14);
    let parsed = parse_app_definition(&legacy.to_string()).unwrap();
    let serialized = serde_json::to_value(parsed).unwrap();
    assert_eq!(serialized.pointer("/ui/value"), Some(&Value::Null));

    let cached = parse_cached_app_definition(&serialized.to_string()).unwrap();
    let cached_serialized = serde_json::to_value(cached).unwrap();
    assert_eq!(cached_serialized.pointer("/ui/value"), Some(&Value::Null));
    assert_eq!(cached_serialized, serialized);
}

#[test]
fn width_conditions_round_trip_and_value_only_wire_stays_unchanged() {
    let width_when = json!({
        "type": "when",
        "min_width": 480,
        "max_width": 960,
        "child": button()
    });
    let parsed = parse_app_definition(&definition(width_when, 19).to_string()).unwrap();
    let serialized = serde_json::to_value(&parsed).unwrap();
    assert_eq!(serialized["ui"]["min_width"], 480);
    assert_eq!(serialized["ui"]["max_width"], 960);
    assert!(serialized["ui"].get("value").is_none());
    assert_eq!(
        serde_json::to_value(parse_cached_app_definition(&serialized.to_string()).unwrap())
            .unwrap(),
        serialized
    );

    let legacy = definition(
        json!({"type": "when", "value": true, "child": button()}),
        18,
    );
    let parsed = parse_app_definition(&legacy.to_string()).unwrap();
    let serialized = serde_json::to_value(&parsed).unwrap();
    assert_eq!(serialized["ui"]["type"], "when");
    assert_eq!(serialized["ui"]["value"], legacy["ui"]["value"]);
    assert!(serialized["ui"].get("min_width").is_none());
    assert!(serialized["ui"].get("max_width").is_none());
    assert_eq!(
        serde_json::to_value(parse_cached_app_definition(&serialized.to_string()).unwrap())
            .unwrap(),
        serialized
    );
}

#[test]
fn width_when_conditions_define_separate_surface_and_anchor_scopes() {
    for kind in ["canvas", "anchor"] {
        let named = || match kind {
            "canvas" => json!({"type": "canvas", "surface": "stage", "aspect_ratio": 1}),
            "anchor" => json!({
                "type": "anchor",
                "id": "stage",
                "child": {"type": "text", "value": "표적"}
            }),
            _ => unreachable!(),
        };
        let ui = json!({
            "type": "stack",
            "direction": "column",
            "children": [
                {"type": "when", "min_width": 640, "child": named()},
                {"type": "when", "max_width": 639, "child": named()}
            ]
        });
        let mut value = definition(ui, 19);
        if kind == "canvas" {
            value = canvas_preview_definition(value);
        }
        parse_app_definition(&value.to_string()).unwrap_or_else(|error| {
            panic!("width when branches should have independent {kind} names: {error:?}")
        });

        let same_branch = json!({
            "type": "when",
            "min_width": 640,
            "child": {
                "type": "stack",
                "direction": "column",
                "children": [named(), named()]
            }
        });
        let mut value = definition(same_branch, 19);
        if kind == "canvas" {
            value = canvas_preview_definition(value);
        }
        let error = parse_app_definition(&value.to_string())
            .expect_err("names duplicated in one width when branch must still fail");
        assert!(error.details.iter().any(|detail| match kind {
            "canvas" => detail.contains("canvas 표면 이름이 비었거나 중복됩니다"),
            "anchor" => detail.contains("anchor id가 비었거나 중복됩니다"),
            _ => unreachable!(),
        }), "{error:?}");
    }
}

#[test]
fn columns_must_be_positive_and_button_preview_is_read_only_canvas_or_image() {
    let mut zero_columns = json!({
        "type": "input",
        "value": {"state": "name"},
        "on_change": {"set_state": "name"},
        "columns": 0
    });
    let zero_error = parse_app_definition(&definition(zero_columns.take(), 19).to_string())
        .expect_err("zero visible columns are invalid");
    assert!(
        zero_error
            .details
            .iter()
            .any(|detail| detail.contains("columns"))
    );

    for preview in [
        json!({"type": "text", "value": "not a preview"}),
        json!({"type": "canvas", "surface": "preview", "on_pointer": {"client": "draw"}}),
    ] {
        let mut control = button();
        control["preview"] = preview;
        let mut value = definition(control, 19);
        if value["ui"]["preview"]["type"] == "canvas" {
            value = canvas_preview_definition(value);
            value["client"]["actions"] = json!(["draw"]);
        }
        let error = parse_app_definition(&value.to_string())
            .expect_err("button preview must be a read-only canvas or image");
        assert!(
            error
                .details
                .iter()
                .any(|detail| detail.contains("preview")),
            "{error:?}"
        );
    }
}

#[test]
fn preview_and_new_bindings_are_collected_inside_repeat_scope() {
    let ui = json!({
        "type": "stack",
        "direction": "column",
        "children": [
            {
                "type": "repeat",
                "items": [{"id": "one", "name": "이름", "prefix": "기법", "surface": null, "loading": false}],
                "key": "id",
                "layout": "column",
                "template": {
                    "type": "button",
                    "label": {"item": "name"},
                    "prefix": {"item": "prefix"},
                    "preview": {
                        "type": "canvas",
                        "surface": {"item": "surface"},
                        "loading": {"item": "loading"}
                    },
                    "on_click": [{"set_state": "confirmed", "value": true}]
                }
            },
            {
                "type": "properties",
                "layout": "rows",
                "fields": [{"label": {"state": "name"}, "value": "이름"}]
            }
        ]
    });
    let parsed = parse_app_definition(&canvas_preview_definition(definition(ui, 19)).to_string())
        .unwrap();

    let mut walked = Vec::new();
    data::walk_blocks(&parsed.ui, "/ui", &mut |pointer, _| {
        walked.push(pointer.to_owned())
    });
    assert!(
        walked
            .iter()
            .any(|pointer| pointer == "/ui/children/0/template/preview")
    );

    let bindings = data::all_ui_bindings(&parsed);
    let binding_at = |pointer: &str| {
        bindings
            .iter()
            .find(|(at, _)| at == pointer)
            .map(|(_, value)| *value)
    };
    assert!(matches!(
        binding_at("/ui/children/0/template/preview/surface"),
        Some(Binding::Item(_))
    ));
    assert!(matches!(
        binding_at("/ui/children/0/template/preview/loading"),
        Some(Binding::Item(_))
    ));
    assert!(matches!(
        binding_at("/ui/children/0/template/prefix"),
        Some(Binding::Item(_))
    ));
    assert!(matches!(
        binding_at("/ui/children/1/fields/0/label"),
        Some(Binding::State(_))
    ));

    let mut outside_repeat = button();
    outside_repeat["preview"] = json!({"type": "image", "src": {"item": "surface"}});
    let error = parse_app_definition(&definition(outside_repeat, 19).to_string())
        .expect_err("preview child item binding must keep repeat scope validation");
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("item은 해당 repeat.template")),
        "{error:?}"
    );
}

#[test]
fn new_fields_round_trip_and_old_defaults_keep_their_wire_shape() {
    let mut control = button();
    control["prefix"] = json!({"state": "name"});
    control["preview"] = json!({"type": "image", "src": null});
    let ui = json!({
        "type": "stack",
        "direction": "column",
        "children": [
            {
                "type": "input",
                "value": {"state": "name"},
                "on_change": {"set_state": "name"},
                "columns": 5
            },
            control,
            {
                "type": "properties",
                "layout": "rows",
                "fields": [
                    {"label": {"state": "name"}, "value": "이름"},
                    {"label": "색", "value": ["#000000", "#ffffff"], "format": "swatches"}
                ]
            }
        ]
    });
    let parsed = parse_app_definition(&definition(ui, 19).to_string()).unwrap();
    let serialized = serde_json::to_value(&parsed).unwrap();
    assert_eq!(serialized["requires"]["blocks"], 19);
    assert_eq!(serialized["ui"]["children"][0]["columns"], 5);
    assert_eq!(
        serialized["ui"]["children"][1]["prefix"],
        json!({"state": "name"})
    );
    assert_eq!(serialized["ui"]["children"][1]["preview"]["type"], "image");
    assert_eq!(serialized["ui"]["children"][2]["layout"], "rows");
    assert_eq!(
        serialized["ui"]["children"][2]["fields"][1]["format"],
        "swatches"
    );
    let cached = parse_cached_app_definition(&serialized.to_string()).unwrap();
    assert_eq!(serde_json::to_value(cached).unwrap(), serialized);

    let canvas = json!({
        "type": "canvas",
        "surface": "stage",
        "loading": {"state": "confirmed"}
    });
    let parsed = parse_app_definition(
        &canvas_preview_definition(definition(canvas, 19)).to_string(),
    )
    .unwrap();
    let serialized = serde_json::to_value(parsed).unwrap();
    assert_eq!(serialized["ui"]["loading"], json!({"state": "confirmed"}));

    let canvas_without_loading = json!({"type": "canvas", "surface": "stage"});
    let parsed = parse_app_definition(
        &canvas_preview_definition(definition(canvas_without_loading, 18)).to_string(),
    )
    .unwrap();
    let serialized = serde_json::to_value(parsed).unwrap();
    assert!(serialized["ui"].get("loading").is_none());

    let legacy = definition(
        json!({
            "type": "stack",
            "direction": "column",
            "children": [
                {"type": "input", "value": {"state": "name"}, "on_change": {"set_state": "name"}},
                button(),
                {"type": "properties", "fields": [{"label": "이름", "value": "값"}]}
            ]
        }),
        18,
    );
    let legacy = serde_json::to_value(parse_app_definition(&legacy.to_string()).unwrap()).unwrap();
    let input = &legacy["ui"]["children"][0];
    let old_button = &legacy["ui"]["children"][1];
    let properties = &legacy["ui"]["children"][2];
    assert!(input.get("columns").is_none());
    assert!(old_button.get("preview").is_none());
    assert!(old_button.get("prefix").is_none());
    assert!(properties.get("layout").is_none());
    assert_eq!(properties["fields"][0]["label"], "이름");
    assert!(parse_cached_app_definition(&legacy.to_string()).is_ok());
}

#[test]
fn generated_schema_exposes_block_set_19_contract() {
    assert_eq!(BLOCK_SET_VERSION, 19);
    let schema = app_definition_schema().to_string();
    for field in [
        "columns",
        "preview",
        "prefix",
        "swatches",
        "rows",
        "loading",
        "min_width",
        "max_width",
    ] {
        assert!(schema.contains(field), "schema missing {field}");
    }
    assert!(schema.contains("label"));
}
