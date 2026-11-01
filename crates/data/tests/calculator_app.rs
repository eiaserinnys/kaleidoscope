use kaleidoscope_contract::{validate::parse_app_definition, JsonValue};
use kaleidoscope_data::{CompiledApp, Env, Step};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn app_file(name: &str) -> String {
    std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps")
            .join(name),
    )
    .unwrap()
}

fn press(app: &CompiledApp, state: &mut BTreeMap<String, JsonValue>, key: &str) {
    let empty = BTreeMap::new();
    let event = json!(key);
    let item = Value::Null;
    let env = Env {
        state,
        data: &empty,
        data_meta: &empty,
        storage: &empty,
        storage_meta: &empty,
        event: &event,
        item: &item,
    };
    match app.action_step("/ui/children/1/on_press", 0, &env).unwrap() {
        Step::SetState { key, value } => {
            state.insert(key, value);
        }
        _ => panic!("상태 쓰기 동작이 필요합니다"),
    }
}

#[test]
fn calculator_operations_percent_and_division_error_recovery() {
    let definition = parse_app_definition(&app_file("calculator.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state;
    for key in ["5", "0", "%"] {
        press(&app, &mut state, key);
    }
    assert_eq!(state["calc"]["display"], "0.5");
    for key in ["C", "8", "/", "0", "="] {
        press(&app, &mut state, key);
    }
    assert_eq!(state["calc"]["error"], "0으로 나눌 수 없습니다");
    press(&app, &mut state, "2");
    assert_eq!(state["calc"]["display"], "2");
    assert_eq!(state["calc"]["error"], Value::Null);
}

#[test]
fn calculator_formula_uses_displayed_operator_symbols() {
    use kaleidoscope_contract::data::BindingValue;
    let definition = parse_app_definition(&app_file("calculator.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let mut state = definition.state;
    state.get_mut("calc").unwrap()["formula"] = json!("8 / 2 * 3 - 1 =");
    let values = app.evaluate(&state, &BTreeMap::new(), &BTreeMap::new());
    let BindingValue::Ready { value } = &values["/ui/children/0/items"] else {
        panic!("표시식 계산 실패");
    };
    assert_eq!(value[0]["label"], "8 ÷ 2 × 3 − 1 =");
}

#[test]
fn weather_city_selection_and_live_search_actions() {
    let definition = parse_app_definition(&app_file("weather.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let empty = BTreeMap::new();
    let sources = BTreeMap::from([(
        "places".into(),
        json!({"results": [
            {"id": 1, "name": "서울특별시"}, {"id": 2, "name": "부산광역시"}, {"id": 3, "name": "성남시"}
        ]}),
    )]);
    for (id, expected) in [("1", "서울"), ("2", "부산"), ("3", "")] {
        let event = json!(id);
        let mut state = definition.state.clone();
        let mut current_sources = sources.clone();
        for index in 0..4 {
            let env = Env {
                state: &state,
                data: &current_sources,
                data_meta: &empty,
                storage: &empty,
                storage_meta: &empty,
                event: &event,
                item: &Value::Null,
            };
            let Step::SetState { key, value } = app
                .action_step("/ui/children/1/children/0/on_select", index, &env)
                .unwrap()
            else {
                panic!("도시 선택 동작이 필요합니다");
            };
            if key == "search" && value == "" {
                current_sources.remove("places");
            }
            state.insert(key, value);
        }
        assert_eq!(state["city"], expected);
    }
    let event = json!("  Seoul  ");
    let env = Env {
        state: &definition.state,
        data: &sources,
        data_meta: &empty,
        storage: &empty,
        storage_meta: &empty,
        event: &event,
        item: &Value::Null,
    };
    for pointer in [
        "/ui/children/0/start/1/on_change",
        "/ui/children/0/start/1/on_submit",
    ] {
        let Step::SetState { key, value } = app.action_step(pointer, 1, &env).unwrap() else {
            panic!("검색 동작이 필요합니다");
        };
        assert_eq!(key, "search");
        assert_eq!(value, "Seoul");
    }
}

#[test]
fn weather_definition_parses_with_its_declared_permissions_and_assets() {
    let app = parse_app_definition(&app_file("weather.json")).unwrap();
    assert_eq!(app.assets.len(), 8);
    assert_eq!(app.sources.len(), 2);
}

#[test]
fn weather_forecast_produces_declared_images_and_future_hourly_points() {
    use kaleidoscope_contract::data::{BindingValue, SourceStatus};
    let definition = parse_app_definition(&app_file("weather.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let sources = BTreeMap::from([(
        "forecast".into(),
        json!({
            "current":{"time":"2026-10-31T12:00","temperature_2m":19,"apparent_temperature":18,"relative_humidity_2m":50,"wind_speed_10m":4,"precipitation":0,"weather_code":80},
            "hourly":{"time":["2026-10-31T11:00","2026-10-31T12:00","2026-10-31T13:00"],"temperature_2m":[17,19,20],"precipitation_probability":[10,20,30]},
            "daily":{"time":["2026-10-31","2026-11-01"],"weather_code":[0,3],"temperature_2m_min":[10,11],"temperature_2m_max":[20,21],"precipitation_probability_max":[30,50]}
        }),
    )]);
    let status = BTreeMap::from([(
        "forecast".into(),
        SourceStatus::Ready {
            updated_at: "2026-10-31T12:00:00Z".into(),
        },
    )]);
    let values = app.evaluate(&definition.state, &sources, &status);
    let pointer = "/ui/children/1/children/1/children/0/items";
    let BindingValue::Ready { value } = &values[pointer] else {
        panic!("현재 날씨 계산 실패: {:?}", values[pointer]);
    };
    assert_eq!(value[0]["image"]["asset"], "builtin-weather-showers");
    let pointer = "/ui/children/1/children/1/children/1/series";
    let BindingValue::Ready { value } = &values[pointer] else {
        panic!("시간별 계산 실패: {:?}", values[pointer]);
    };
    assert_eq!(value[0]["points"][0]["x"], "12:00");
    let pointer = "/ui/children/1/children/1/children/2/items";
    let BindingValue::Ready { value } = &values[pointer] else {
        panic!("일별 계산 실패: {:?}", values[pointer]);
    };
    assert_eq!(value[0]["title"], "오늘");
    assert_eq!(value[1]["title"], "일 11-01");
}

#[test]
fn weather_daily_forecast_shows_each_korean_weekday() {
    use kaleidoscope_contract::data::{BindingValue, SourceStatus};
    let definition = parse_app_definition(&app_file("weather.json")).unwrap();
    let app = CompiledApp::compile(&definition);
    let sources = BTreeMap::from([(
        "forecast".into(),
        json!({
            "daily": {
                "time":["2026-11-01","2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06","2026-11-07","2026-11-08"],
                "weather_code":[0,0,0,0,0,0,0,0],
                "temperature_2m_min":[10,10,10,10,10,10,10,10],
                "temperature_2m_max":[20,20,20,20,20,20,20,20],
                "precipitation_probability_max":[0,0,0,0,0,0,0,0]
            }
        }),
    )]);
    let status = BTreeMap::from([(
        "forecast".into(),
        SourceStatus::Ready {
            updated_at: "2026-11-01T00:00:00Z".into(),
        },
    )]);
    let values = app.evaluate(&definition.state, &sources, &status);
    let pointer = "/ui/children/1/children/1/children/2/items";
    let BindingValue::Ready { value } = &values[pointer] else {
        panic!("일별 계산 실패: {:?}", values[pointer]);
    };
    for (index, day) in ["월", "화", "수", "목", "금", "토", "일"]
        .iter()
        .enumerate()
    {
        assert!(value[index + 1]["title"].as_str().unwrap().starts_with(day));
    }
}
