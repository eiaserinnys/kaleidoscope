use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::Value;

#[test]
fn builtin_agent_declares_client_process_and_settings() {
    let json = include_str!("../../../apps/agent.json");
    let value: Value = serde_json::from_str(json).unwrap();
    assert_eq!(value["requires"]["blocks"], 19);
    assert_eq!(value["requires"]["modules"]["process"], 1);
    assert_eq!(value["requires"]["modules"]["client"], 4);
    assert_eq!(value["client"]["device_storage"]["scope"], "window");
    assert_eq!(value["client"]["channels"][0], "conversation");
    assert!(value["settings"]["ui"].is_object());
    assert!(value["window_title"]["title"].is_object());
    let app = parse_app_definition(json).expect("기본 에이전트 정의가 현재 계약을 통과해야 한다");
    assert!(app.client.is_some());
}
