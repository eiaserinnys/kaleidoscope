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
    fn find_chats<'a>(node: &'a Value, switching_gate: bool, chats: &mut Vec<(&'a Value, bool)>) {
        match node {
            Value::Object(fields) => {
                let switching_gate = switching_gate
                    || (fields.get("type").and_then(Value::as_str) == Some("when")
                        && matches!(node["value"]["client"].as_str(), Some("session_ready" | "session_switching")));
                if fields.get("type").and_then(Value::as_str) == Some("chat") {
                    chats.push((node, switching_gate));
                }
                for child in fields.values() {
                    find_chats(child, switching_gate, chats);
                }
            }
            Value::Array(items) => {
                for item in items {
                    find_chats(item, switching_gate, chats);
                }
            }
            _ => {}
        }
    }

    let value: Value = serde_json::from_str(include_str!("../../../apps/agent.json")).unwrap();
    let states = value["ui"]["children"].as_array().unwrap();
    let chat_screen = states.iter().find(|state| state["value"]["client"] == "show_chat").unwrap();
    let branches = chat_screen["child"]["children"].as_array().unwrap();
    for width in ["min_width", "max_width"] {
        let branch = branches.iter().find(|branch| branch["type"] == "when" && branch[width].is_number()).unwrap();
        let mut chats = Vec::new();
        find_chats(&branch["child"], false, &mut chats);
        assert_eq!(chats.len(), 1, "{width} 갈래에는 chat이 하나 있어야 한다");
        let (chat, switching_gate) = chats[0];
        assert!(!switching_gate, "{width} 갈래의 chat은 세션 전환 중에도 유지되어야 한다");
        assert_eq!(chat["loading"]["client"], "session_switching");
        assert_eq!(chat["client"]["channel"], "conversation");
    }
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
