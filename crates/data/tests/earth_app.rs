use kaleidoscope_contract::{data::BindingValue, validate::parse_app_definition};
use kaleidoscope_data::{CompiledApp, SourcePlan};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[test]
fn earth_selects_quake_for_map_and_dependent_requests() {
    let definition = parse_app_definition(include_str!("../../../apps/earth.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    state.insert("selected_quake".into(), json!("b"));
    let quakes = json!({"features":[
        {"id":"a","geometry":{"coordinates":[127,37,10]},"properties":{"mag":5.2,"place":"20 km of Seoul","time":1760000000000i64,"tsunami":0,"code":"a"}},
        {"id":"b","geometry":{"coordinates":[139,35,20]},"properties":{"mag":6.2,"place":"10 km of Tokyo","time":1760000000000i64,"tsunami":1,"code":"b","sig":500,"mmi":4.2}}
    ]});
    let mut data = BTreeMap::from([
        ("quakes".into(), quakes),
        (
            "weather".into(),
            json!({"elevation":10,"current":{"temperature_2m":20,"wind_speed_10m":5,"wind_gusts_10m":7,"precipitation":0,"weather_code":0,"relative_humidity_2m":50,"apparent_temperature":19},"hourly":{"time":["2026-10-31T00:00"],"temperature_2m":[20],"wind_speed_10m":[5]}}),
        ),
        (
            "air".into(),
            json!({"current":{"us_aqi":42,"pm2_5":8,"pm10":10,"ozone":20},"hourly":{"time":["2026-10-31T00:00"],"us_aqi":[42],"pm2_5":[8]}}),
        ),
        ("wiki".into(), json!({"query":{"geosearch":[],"search":[]}})),
    ]);
    let empty: BTreeMap<String, Value> = BTreeMap::new();
    for name in ["weather", "air"] {
        let SourcePlan::Request { query, .. } =
            app.plan_source_with_data_and_storage(name, &state, &data, &empty, &empty)
        else {
            panic!("원천 계획 오류: {name}")
        };
        assert_eq!(query["latitude"], "35.0000");
        assert_eq!(query["longitude"], "139.0000");
    }
    let SourcePlan::Request { query, .. } =
        app.plan_source_with_data_and_storage("wiki", &state, &data, &empty, &empty)
    else {
        panic!("위키 원천 계획 오류")
    };
    assert_eq!(query["gscoord"], "35|139");
    assert!(query["srsearch"].starts_with("Tokyo "));
    let values = app.evaluate_with_data_meta(
        &state,
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
    let BindingValue::Ready { value: points } =
        &values["/ui/children/1/children/1/children/0/child/points"]
    else {
        panic!("지점 없음")
    };
    assert_eq!(points[1]["key"], "b");
    let BindingValue::Ready { value: metrics } = &values["/ui/children/1/children/0/items"] else {
        panic!("지표 없음")
    };
    assert_eq!(metrics[0]["value"], "M6.2");
    let BindingValue::Ready {
        value: significance,
    } = &values["/ui/children/1/children/2/tabs/0/child/children/1/child/fields/1/value"]
    else {
        panic!("유의성 없음")
    };
    assert!(
        significance.as_str().unwrap().contains("MMI 4.2"),
        "{significance}"
    );
    data.get_mut("air").unwrap()["current"]["us_aqi"] = Value::Null;
    let values = app.evaluate_with_data_meta(
        &state,
        &data,
        &empty,
        &empty,
        &empty,
        &BTreeMap::new(),
        None,
    );
    let BindingValue::Ready { value: metrics } = &values["/ui/children/1/children/0/items"] else {
        panic!("대기질 지표 없음")
    };
    assert_eq!(metrics[2]["value"].as_f64(), Some(8.0));
    assert_eq!(metrics[2]["unit"], "μg/m³");
}

#[test]
fn map_and_table_keep_all_quakes_and_share_initial_selection() {
    let definition = parse_app_definition(include_str!("../../../apps/earth.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let features: Vec<Value> = (0..65).map(|i| json!({"id":format!("q{i}"),"geometry":{"coordinates":[127,37,10]},"properties":{"mag":5.2,"place":"Seoul","time":1760000000000i64,"tsunami":0}})).collect();
    let data = BTreeMap::from([
        ("quakes".into(), json!({"features":features})),
        ("weather".into(), json!({})),
        ("air".into(), json!({})),
        ("wiki".into(), json!({})),
    ]);
    let values = app.evaluate_with_data_meta(
        &definition.state,
        &data,
        &BTreeMap::new(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        None,
    );
    for pointer in [
        "/ui/children/1/children/1/children/0/child/points",
        "/ui/children/1/children/1/children/1/child/rows",
    ] {
        let BindingValue::Ready { value } = &values[pointer] else {
            panic!("{pointer}: {:?}", values[pointer])
        };
        assert_eq!(value.as_array().unwrap().len(), 65);
        assert_eq!(value[0]["key"], "latest");
        assert_eq!(value[0]["id"], "q0");
    }
}

#[test]
fn filter_empty_stops_dependent_requests_and_clears_quake_views() {
    let definition = parse_app_definition(include_str!("../../../apps/earth.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state.clone();
    state.insert("min_mag".into(), json!("6"));
    let quake = json!({"id":"a","geometry":{"coordinates":[127,37,10]},"properties":{"mag":5.2,"place":"Seoul","time":1760000000000i64,"tsunami":0}});
    let data = BTreeMap::from([
        ("quakes".into(), json!({"features":[quake]})),
        ("weather".into(), json!({})),
        ("air".into(), json!({})),
        ("wiki".into(), json!({})),
    ]);
    let empty = BTreeMap::new();
    for name in ["weather", "air", "wiki"] {
        assert_eq!(
            app.plan_source_with_data_and_storage(name, &state, &data, &empty, &empty),
            SourcePlan::Idle
        );
    }
    let values = app.evaluate_with_data_meta(
        &state,
        &data,
        &empty,
        &empty,
        &empty,
        &BTreeMap::new(),
        None,
    );
    for pointer in [
        "/ui/children/1/children/0/items",
        "/ui/children/1/children/1/children/0/child/points",
        "/ui/children/1/children/1/children/1/child/rows",
    ] {
        assert!(
            matches!(&values[pointer], BindingValue::Ready { value } if value == &json!([]) || value.is_null()),
            "{pointer}: {:?}",
            values[pointer]
        );
    }
}
