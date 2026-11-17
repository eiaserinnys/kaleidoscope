use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition, BLOCK_SET_VERSION};
use serde_json::{json, Value};

/// progress의 칸막이(`segments`)와 세로 커서(`marker`)가 처음 들어온 블록 세트 판.
const V64: u32 = 64;

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "progress-segments-marker-test", "name": "진행 막대 칸막이와 커서 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {"elapsed": 50}, "ui": ui
    })
}

#[test]
fn progress_segments_marker_round_trips_and_exposes_marker_binding() {
    assert!(BLOCK_SET_VERSION >= V64);
    let ui = json!({
        "type": "progress", "value": 72, "max": 100, "label": "7일 72% 남음",
        "segments": 7, "marker": {"state": "elapsed"}
    });
    let parsed = parse_app_definition(&definition(ui, V64).to_string()).unwrap();
    assert_eq!(parsed.ui.introduced_in(), V64);
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(encoded["ui"]["segments"], json!(7));
    assert_eq!(encoded["ui"]["marker"]["state"], json!("elapsed"));
    let bindings: Vec<String> = data::all_ui_bindings(&parsed)
        .into_iter()
        .map(|(pointer, _)| pointer)
        .collect();
    assert!(bindings.iter().any(|pointer| pointer == "/ui/marker"));
    let schema = app_definition_schema().to_string();
    for field in ["segments", "marker"] {
        assert!(schema.contains(&format!("\"{field}\"")), "{field}");
    }
}

#[test]
fn progress_segments_marker_requires_block_set_64() {
    for ui in [
        json!({"type": "progress", "value": 1, "max": 2, "segments": 7}),
        json!({"type": "progress", "value": 1, "max": 2, "marker": 1}),
    ] {
        let error = parse_app_definition(&definition(ui.clone(), V64 - 1).to_string()).unwrap_err();
        assert!(
            error
                .details
                .iter()
                .any(|detail| detail.contains("블록 세트 64판")),
            "{:?}",
            error.details
        );
        parse_app_definition(&definition(ui, V64).to_string()).unwrap();
    }
    // 두 필드가 없는 progress는 예전처럼 14판이다.
    let plain = json!({"type": "progress", "value": 1, "max": 2});
    let parsed = parse_app_definition(&definition(plain, 14).to_string()).unwrap();
    assert_eq!(parsed.ui.introduced_in(), 14);
}

#[test]
fn progress_segments_below_two_is_rejected() {
    for segments in [0, 1] {
        let ui = json!({"type": "progress", "value": 1, "max": 2, "segments": segments});
        let error = parse_app_definition(&definition(ui, V64).to_string()).unwrap_err();
        assert!(
            error
                .details
                .iter()
                .any(|detail| detail.contains("progress segments는 2 이상")),
            "{:?}",
            error.details
        );
    }
    let ui = json!({"type": "progress", "value": 1, "max": 2, "segments": 2});
    parse_app_definition(&definition(ui, V64).to_string()).unwrap();
}

#[test]
fn progress_segments_must_be_an_integer() {
    let ui = json!({"type": "progress", "value": 1, "max": 2, "segments": 2.5});
    assert!(parse_app_definition(&definition(ui, V64).to_string()).is_err());
}
