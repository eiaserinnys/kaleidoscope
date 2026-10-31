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
    let pointer = "/ui/children/1/children/1/children/1/child/series";
    let BindingValue::Ready { value } = &values[pointer] else {
        panic!("시간별 계산 실패: {:?}", values[pointer]);
    };
    assert_eq!(value[0]["points"][0]["x"], "12:00");
    let pointer = "/ui/children/1/children/1/children/3/items";
    let BindingValue::Ready { value } = &values[pointer] else {
        panic!("일별 계산 실패: {:?}", values[pointer]);
    };
    assert_eq!(value[0]["title"], "오늘");
    assert_eq!(value[1]["title"], "일 11-01");
}
