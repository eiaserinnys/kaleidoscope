use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition, BLOCK_SET_VERSION};
use serde_json::{json, Value};

/// 차트의 쌓은 막대, 수 형식, 고른 칸, 계열 색과 표 열의 정렬 값이 처음 들어온 블록 세트 판.
const V62: u32 = 62;

fn definition(ui: Value, blocks: u32) -> Value {
    json!({
        "id": "chart-series-format-test", "name": "차트 계열 색과 수 형식 시험",
        "requires": {"blocks": blocks, "modules": {}},
        "permissions": [], "state": {"picked": "월", "columns": null}, "ui": ui
    })
}

#[test]
fn chart_series_format_round_trips_and_exposes_bindings() {
    assert!(BLOCK_SET_VERSION >= V62);
    let ui = json!({
        "type": "chart", "kind": "bar", "stacked": true,
        "number_format": {"notation": "compact", "style": "percent", "maximum_fraction_digits": 1},
        "selected": {"state": "picked"},
        "series": [{"key": "a", "name": "모델 A", "color": "#3d7cc9", "points": [{"x": "월", "y": 1.5}]}],
        "on_select": {"set_state": "picked"}
    });
    let parsed = parse_app_definition(&definition(ui.clone(), V62).to_string()).unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(encoded["ui"]["stacked"], json!(true));
    assert_eq!(encoded["ui"]["number_format"]["notation"], json!("compact"));
    assert_eq!(encoded["ui"]["number_format"]["style"], json!("percent"));
    assert_eq!(encoded["ui"]["number_format"]["maximum_fraction_digits"], json!(1));
    assert_eq!(encoded["ui"]["selected"]["state"], json!("picked"));
    assert_eq!(encoded["ui"]["series"][0]["color"], json!("#3d7cc9"));
    let bindings: Vec<String> = data::all_ui_bindings(&parsed)
        .into_iter()
        .map(|(pointer, _)| pointer)
        .collect();
    assert!(bindings.iter().any(|pointer| pointer == "/ui/selected"));
    let schema = app_definition_schema().to_string();
    for field in ["stacked", "number_format", "selected", "sort_field"] {
        assert!(schema.contains(&format!("\"{field}\"")), "{field}");
    }
}

#[test]
fn chart_series_format_requires_block_set_62() {
    let cases = [
        json!({"type": "chart", "kind": "bar", "series": [], "stacked": true}),
        json!({"type": "chart", "series": [], "number_format": {"notation": "compact"}}),
        json!({"type": "chart", "series": [], "selected": {"state": "picked"}}),
        json!({"type": "table", "rows": [], "columns": [{"field": "v", "label": "값", "sort_field": "raw"}]}),
    ];
    for ui in cases {
        let error = parse_app_definition(&definition(ui.clone(), V62 - 1).to_string()).unwrap_err();
        assert!(
            error
                .details
                .iter()
                .any(|detail| detail.contains("블록 세트 62판")),
            "{:?}",
            error.details
        );
        parse_app_definition(&definition(ui, V62).to_string()).unwrap();
    }
}

#[test]
fn chart_selected_accepts_read_bindings() {
    let expr = json!({"type": "chart", "series": [], "selected": {"expr": "$states.picked"}});
    parse_app_definition(&definition(expr, V62).to_string()).unwrap();
    let literal = json!({"type": "chart", "series": [], "selected": "월"});
    parse_app_definition(&definition(literal, V62).to_string()).unwrap();
}

#[test]
fn series_color_requires_block_set_62_but_plain_chart_stays_nine() {
    let colored = json!({"type": "chart", "series": [{"key": "a", "name": "모델 A", "color": "#3d7cc9", "points": []}]});
    let error = parse_app_definition(&definition(colored.clone(), V62 - 1).to_string()).unwrap_err();
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("블록 세트 62판")),
        "{:?}",
        error.details
    );
    parse_app_definition(&definition(colored, V62).to_string()).unwrap();
    let plain = json!({"type": "chart", "series": [{"key": "a", "name": "모델 A", "points": []}]});
    parse_app_definition(&definition(plain, 9).to_string()).unwrap();
}

#[test]
fn basic_chart_still_starts_at_block_set_nine() {
    let ui = json!({"type": "chart", "series": []});
    parse_app_definition(&definition(ui, 9).to_string()).unwrap();
}

#[test]
fn stacked_requires_bar_kind() {
    let ui = json!({"type": "chart", "kind": "line", "series": [], "stacked": true});
    let error = parse_app_definition(&definition(ui, V62).to_string()).unwrap_err();
    assert!(error
        .details
        .iter()
        .any(|detail| detail.contains("chart의 stacked는 kind가 bar일 때만 씁니다")));
    let ui = json!({"type": "chart", "kind": "bar", "series": [], "stacked": true});
    parse_app_definition(&definition(ui, V62).to_string()).unwrap();
}

#[test]
fn number_format_requires_valid_currency_code() {
    for currency in [Value::Null, json!("usd"), json!("US"), json!("US1")] {
        let mut number_format = json!({"style": "currency"});
        if !currency.is_null() {
            number_format["currency"] = currency;
        }
        let ui = json!({"type": "chart", "series": [], "number_format": number_format});
        let error = parse_app_definition(&definition(ui, V62).to_string()).unwrap_err();
        assert!(error
            .details
            .iter()
            .any(|detail| detail.contains("통화 코드 세 글자")));
    }
    let ui = json!({"type": "chart", "series": [], "number_format": {"style": "currency", "currency": "USD"}});
    parse_app_definition(&definition(ui, V62).to_string()).unwrap();
}

#[test]
fn number_format_rejects_fraction_digits_over_six() {
    let ui = json!({"type": "chart", "series": [], "number_format": {"maximum_fraction_digits": 7}});
    let error = parse_app_definition(&definition(ui, V62).to_string()).unwrap_err();
    assert!(error
        .details
        .iter()
        .any(|detail| detail.contains("maximum_fraction_digits는 0부터 6까지")));
    let ui = json!({"type": "chart", "series": [], "number_format": {"maximum_fraction_digits": 6}});
    parse_app_definition(&definition(ui, V62).to_string()).unwrap();
}

#[test]
fn table_sort_field_round_trips_and_rejects_empty_string() {
    let ui = json!({"type": "table", "rows": [], "columns": [
        {"field": "v", "label": "값", "sort_field": "raw"}
    ]});
    let parsed = parse_app_definition(&definition(ui, V62).to_string()).unwrap();
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(encoded["ui"]["columns"][0]["sort_field"], json!("raw"));

    let ui = json!({"type": "table", "rows": [], "columns": [
        {"field": "v", "label": "값", "sort_field": ""}
    ]});
    let error = parse_app_definition(&definition(ui, V62).to_string()).unwrap_err();
    assert!(error
        .details
        .iter()
        .any(|detail| detail.contains("sort_field가 비어 있습니다")));
}

#[test]
fn dynamic_columns_sort_field_rejects_empty_string() {
    let mut def = definition(
        json!({"type": "table", "rows": [], "columns": {"state": "columns"}}),
        V62,
    );
    def["state"]["columns"] = json!([{"field": "v", "label": "값", "sort_field": ""}]);
    let error = parse_app_definition(&def.to_string()).unwrap_err();
    assert!(error
        .details
        .iter()
        .any(|detail| detail.contains("sort_field가 비어 있습니다")));
}
