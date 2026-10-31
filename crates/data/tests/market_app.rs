use kaleidoscope_contract::{data::BindingValue, validate::parse_app_definition};
use kaleidoscope_data::CompiledApp;
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[test]
fn market_bindings_evaluate_with_representative_public_api_data() {
    let definition = parse_app_definition(include_str!("../../../apps/market.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let ticker = json!({"symbol":"BTCUSDT","lastPrice":"100","highPrice":"110","lowPrice":"90","priceChangePercent":"2"});
    let candle = json!([172800000, "95", "105", "90", "100", "42"]);
    let mut data: BTreeMap<String, Value> = BTreeMap::from([
        ("asset_tickers".into(), json!([ticker])),
        (
            "asset_candles".into(),
            json!([candle.clone(), candle.clone()]),
        ),
        (
            "fx_asset_quote".into(),
            json!({"base":"USD","amount":100,"date":"2026-10-30","rates":{"KRW":133527,"EUR":89,"JPY":15000,"GBP":75,"CNY":700,"CHF":80,"CAD":140,"AUD":150}}),
        ),
        (
            "fx_series".into(),
            json!({"rates":{"2026-10-01":{"KRW":1300,"EUR":0.8,"JPY":140,"GBP":0.7,"CNY":6,"CHF":0.7,"CAD":1.3,"AUD":1.4},"2026-10-02":{"KRW":1335,"EUR":0.9,"JPY":150,"GBP":0.8,"CNY":7,"CHF":0.8,"CAD":1.4,"AUD":1.5}}}),
        ),
        (
            "macro_cpi".into(),
            json!([{},[{"countryiso3code":"KOR","date":"2025","value":2.2},{"countryiso3code":"USA","date":"2025","value":3.1}]]),
        ),
        (
            "macro_ppp".into(),
            json!([{},[{"countryiso3code":"KOR","date":"2025","value":800}]]),
        ),
    ]);
    for symbol in ["btc", "eth", "sol", "xrp", "bnb", "doge", "ada", "avax"] {
        data.insert(
            format!("trend_{symbol}"),
            json!([candle.clone(), candle.clone()]),
        );
    }
    let empty = BTreeMap::new();
    let values = app.evaluate_with_data_meta(
        &definition.state,
        &data,
        &empty,
        &empty,
        &empty,
        &BTreeMap::new(),
        None,
    );
    for (pointer, value) in &values {
        assert!(
            matches!(value, BindingValue::Ready { .. }),
            "{pointer}: {value:?}"
        );
    }
    let BindingValue::Ready { value: metrics } = &values["/ui/children/1/items"] else {
        unreachable!()
    };
    assert_eq!(metrics[0]["value"], json!("133,527"));
    assert_eq!(metrics[2]["value"], json!("800"));
    let BindingValue::Ready { value: series } = &values["/ui/children/3/child/series"] else {
        unreachable!()
    };
    assert_eq!(series[0]["points"][0]["open"], json!(126850.65));
    assert_eq!(series[0]["points"][0]["close"], json!(133527.0));
    let BindingValue::Ready { value: rows } = &values["/ui/children/4/children/0/child/rows"]
    else {
        unreachable!()
    };
    assert_eq!(rows.as_array().unwrap().len(), 8);
    assert_eq!(rows[0]["currency"], "KRW · 대한민국 원");
    assert_eq!(rows[0]["cpi"], json!(2.2));
}

#[test]
fn market_has_a_three_stage_pipeline() {
    let definition = parse_app_definition(include_str!("../../../apps/market.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    assert!(app
        .source_dependencies("fx_asset_quote")
        .contains(&"asset_tickers".to_owned()));
    assert!(app
        .source_dependencies("macro_cpi")
        .contains(&"fx_asset_quote".to_owned()));
}
