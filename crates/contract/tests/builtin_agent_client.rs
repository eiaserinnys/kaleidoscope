use kaleidoscope_contract::{validate::parse_app_definition, CHAT_LOADING_BLOCK_SET_VERSION, RECEIVE_MESSAGE_CLIENT_VERSION};
use serde_json::Value;

#[test]
fn builtin_agent_declares_client_process_and_settings() {
    let json = include_str!("../../../apps/agent.json");
    let value: Value = serde_json::from_str(json).unwrap();
    assert_eq!(value["requires"]["blocks"], CHAT_LOADING_BLOCK_SET_VERSION);
    assert_eq!(value["requires"]["modules"]["process"], 1);
    assert_eq!(value["requires"]["modules"]["client"], RECEIVE_MESSAGE_CLIENT_VERSION);
    assert_eq!(value["client"]["device_storage"]["scope"], "window");
    assert_eq!(value["client"]["channels"][0], "conversation");
    assert!(value["settings"]["ui"].is_object());
    assert!(value["window_title"]["title"].is_object());
    let app = parse_app_definition(json).expect("기본 에이전트 정의가 현재 계약을 통과해야 한다");
    assert!(app.client.is_some());
}

#[test]
fn builtin_agent_keeps_chat_mounted_while_switching_sessions() {
    let value: Value = serde_json::from_str(include_str!("../../../apps/agent.json")).unwrap();
    let states = value["ui"]["children"].as_array().unwrap();
    let chat_screen = states.iter().find(|state| state["value"]["client"] == "show_chat").unwrap();
    assert_eq!(chat_screen["child"]["fill"], 1);
    assert_eq!(chat_screen["child"]["children"][1]["fill"], 0);
    let children = chat_screen["child"]["children"][1]["children"].as_array().unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0]["type"], "chat");
    assert_eq!(children[0]["loading"]["client"], "session_switching");
    assert_eq!(children[0]["client"]["channel"], "conversation");
}

#[test]
fn builtin_agent_shows_indeterminate_progress_while_starting() {
    let value: Value = serde_json::from_str(include_str!("../../../apps/agent.json")).unwrap();
    let states = value["ui"]["children"][0]["child"]["children"].as_array().unwrap();
    let starting = states.iter().find(|state| state["value"]["client"] == "show_starting").unwrap();
    let group = &starting["child"];
    assert_eq!(group["type"], "stack");
    assert_eq!(group["gap"], "small");
    assert_eq!(group["children"][0]["type"], "progress");
    assert!(group["children"][0]["value"].is_null());
    assert_eq!(group["children"][1]["value"]["client"], "show_install_label");
}
