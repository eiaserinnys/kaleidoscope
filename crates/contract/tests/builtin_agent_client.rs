use kaleidoscope_contract::{validate::parse_app_definition, CHAT_INPUT_HEADER_BLOCK_SET_VERSION, RECEIVE_MESSAGE_CLIENT_VERSION};
use serde_json::Value;

#[test]
fn builtin_agent_assumes_http_mcp_for_one_default() {
    let json = include_str!("../../../apps/agent.json");
    let value: Value = serde_json::from_str(json).unwrap();
    let agents = value["storage"]["entries"].as_array().unwrap().iter().find(|entry| entry["id"] == "agents").unwrap();
    let defaults = agents["default"].as_array().unwrap();
    let with_flag: Vec<_> = defaults.iter().enumerate().filter(|(_, agent)| agent.get("assume_http_mcp").is_some()).collect();
    assert_eq!(with_flag.len(), 1);
    assert_eq!(with_flag[0].1["assume_http_mcp"], true);
    let app = parse_app_definition(json).unwrap();
    let storage = app.storage.unwrap();
    let entry = storage.entries.iter().find(|entry| entry.id == "agents").unwrap();
    kaleidoscope_contract::app_storage::validate_storage_content(entry, &agents["default"]).unwrap();
    let mut invalid = agents["default"].clone();
    invalid[with_flag[0].0]["assume_http_mcp"] = "true".into();
    assert!(kaleidoscope_contract::app_storage::validate_storage_content(entry, &invalid).is_err());
}

#[test]
fn builtin_agent_declares_client_process_and_settings() {
    let json = include_str!("../../../apps/agent.json");
    let value: Value = serde_json::from_str(json).unwrap();
    assert_eq!(value["requires"]["blocks"], CHAT_INPUT_HEADER_BLOCK_SET_VERSION);
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
fn builtin_agent_locks_both_session_lists_while_busy() {
    fn find_session_lists<'a>(node: &'a Value, lists: &mut Vec<&'a Value>) {
        match node {
            Value::Object(fields) => {
                if node["type"] == "list" && node["items"]["client"] == "history_items" {
                    lists.push(node);
                }
                for child in fields.values() {
                    find_session_lists(child, lists);
                }
            }
            Value::Array(items) => {
                for item in items {
                    find_session_lists(item, lists);
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
        let mut lists = Vec::new();
        find_session_lists(&branch["child"], &mut lists);
        // 지울 수 있는 제공자와 없는 제공자를 위한 두 갈래이며, 어느 쪽이든 바쁜 동안 잠긴다.
        assert_eq!(lists.len(), 2, "{width} 갈래에는 삭제 가능, 불가 세션 목록이 하나씩 있어야 한다");
        for list in &lists {
            assert_eq!(list["disabled"]["client"], "session_buttons_busy");
        }
        let deletable: Vec<_> = lists.iter().filter(|list| list["item_menu"][0]["on_select"]["client"] == "delete_session").collect();
        assert_eq!(deletable.len(), 1, "{width} 갈래에서 삭제 메뉴는 한 목록에만 있어야 한다");
    }
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

#[test]
fn builtin_agent_declares_status_bar_storage() {
    let json = include_str!("../../../apps/agent.json");
    let value: Value = serde_json::from_str(json).unwrap();
    let declared = value["storage"]["entries"].as_array().unwrap().iter().find(|entry| entry["id"] == "status_bar").unwrap();
    assert_eq!(declared["key"], "settings/status_bar");
    assert_eq!(declared["default"], false);
    assert!(value["client"]["storage_entries"].as_array().unwrap().iter().any(|id| id == "status_bar"));
    let app = parse_app_definition(json).unwrap();
    let entry = app.storage.unwrap().entries.into_iter().find(|entry| entry.id == "status_bar").unwrap();
    kaleidoscope_contract::app_storage::validate_storage_content(&entry, &declared["default"]).unwrap();
    kaleidoscope_contract::app_storage::validate_storage_content(&entry, &Value::Bool(true)).unwrap();
    assert!(kaleidoscope_contract::app_storage::validate_storage_content(&entry, &Value::String("true".into())).is_err());
}

fn collect<'a>(node: &'a Value, matches: &dyn Fn(&Value) -> bool, found: &mut Vec<&'a Value>) {
    match node {
        Value::Object(fields) => {
            if matches(node) {
                found.push(node);
            }
            for child in fields.values() {
                collect(child, matches, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect(item, matches, found);
            }
        }
        _ => {}
    }
}

#[test]
fn builtin_agent_pins_status_bar_above_both_chat_inputs() {
    let value: Value = serde_json::from_str(include_str!("../../../apps/agent.json")).unwrap();
    let mut chats = Vec::new();
    collect(&value["ui"], &|node| node["type"] == "chat", &mut chats);
    assert_eq!(chats.len(), 2);
    let mut chip_lists = Vec::new();
    for chat in chats {
        // footer는 기록 흐름 안의 권한 요청 반복만 남는다.
        let footer = &chat["footer"];
        assert_eq!(footer["type"], "repeat");
        assert_eq!(footer["items"]["client"], "permissions");
        let mut gates = Vec::new();
        collect(footer, &|node| node["type"] == "when" && node["value"]["client"] == "show_status_bar", &mut gates);
        assert!(gates.is_empty());
        // 상태 줄은 입력창 위 고정 자리에 둔다.
        let header = &chat["input_header"];
        assert_eq!(header["type"], "when");
        assert_eq!(header["value"]["client"], "show_status_bar");
        // 넓은 창은 한 줄, 좁은 창은 모델·컨텍스트와 한도를 두 줄에 둔다.
        let strip = &header["child"];
        assert!(strip.get("wrap").is_none());
        let children = strip["children"].as_array().unwrap();
        let left = &children[0];
        assert_eq!(left["type"], "stack");
        assert_eq!(left["direction"], "row");
        // repeat의 기본 배치는 세로라 칩을 한 줄로 두려면 row를 밝힌다.
        assert_eq!(left["children"][0]["layout"], "row");
        let chips = left["children"][0]["items"]["client"].as_str().unwrap().to_string();
        let (context, limits) = if chips == "status_chips" {
            assert_eq!(strip["direction"], "row");
            assert_eq!(strip["fill"], 0);
            assert_eq!(children.len(), 3);
            assert_eq!(left["children"].as_array().unwrap().len(), 2);
            assert_eq!(left["children"][1]["value"]["client"], "status_has_subagents");
            (&children[1], &children[2])
        } else {
            assert_eq!(chips, "status_chips_narrow");
            assert_eq!(strip["direction"], "column");
            assert_eq!(children.len(), 2);
            assert_eq!(left["fill"], 0);
            assert_eq!(left["children"].as_array().unwrap().len(), 2);
            (&left["children"][1], &children[1])
        };
        chip_lists.push(chips);
        // context 막대(사용률, 0.7과 0.9)와 session, weekly 막대 반복(0.8과 0.95).
        assert_eq!(context["value"]["client"], "status_has_context");
        let mut bars = Vec::new();
        collect(context, &|node| node["type"] == "progress", &mut bars);
        assert_eq!(bars.len(), 1);
        assert_eq!(bars[0]["label"], "context");
        assert_eq!((bars[0]["warning_at"].as_f64(), bars[0]["danger_at"].as_f64()), (Some(0.7), Some(0.9)));
        assert_eq!(limits["type"], "repeat");
        assert_eq!(limits["items"]["client"], "status_limit_bars");
        assert_eq!(limits["layout"], "row");
        let mut bars = Vec::new();
        collect(limits, &|node| node["type"] == "progress", &mut bars);
        assert_eq!(bars.len(), 1);
        assert_eq!(bars[0]["label"]["item"], "label");
        assert_eq!((bars[0]["warning_at"].as_f64(), bars[0]["danger_at"].as_f64()), (Some(0.8), Some(0.95)));
    }
    chip_lists.sort();
    assert_eq!(chip_lists, ["status_chips", "status_chips_narrow"]);
    let screen = value["ui"]["children"].as_array().unwrap().iter().find(|state| state["value"]["client"] == "show_chat").unwrap();
    let mut narrow = Vec::new();
    collect(&screen["child"], &|node| node["type"] == "when" && node["max_width"].is_number(), &mut narrow);
    let mut inside = Vec::new();
    collect(narrow[0], &|node| node["type"] == "repeat" && node["items"]["client"] == "status_chips_narrow", &mut inside);
    assert_eq!(inside.len(), 1);
}

#[test]
fn builtin_agent_settings_has_status_toggle() {
    let value: Value = serde_json::from_str(include_str!("../../../apps/agent.json")).unwrap();
    let mut toggles = Vec::new();
    collect(&value["settings"]["ui"], &|node| node["type"] == "toggle" && node["on_change"]["client"] == "toggle_status_bar", &mut toggles);
    assert_eq!(toggles.len(), 1);
    assert_eq!(toggles[0]["value"]["client"], "status_bar_on");
    assert_eq!(toggles[0]["label"], "창에 상태 항상 보기");
    assert!(value["client"]["actions"].as_array().unwrap().iter().any(|id| id == "toggle_status_bar"));
    let mut limits = Vec::new();
    collect(&value["settings"]["ui"], &|node| node["type"] == "repeat" && node["items"]["client"] == "status_limits", &mut limits);
    assert_eq!(limits.len(), 1);
}

#[test]
fn builtin_agent_declares_every_status_output() {
    let value: Value = serde_json::from_str(include_str!("../../../apps/agent.json")).unwrap();
    let outputs = value["client"]["outputs"].as_object().unwrap();
    for name in [
        "status_bar_on", "show_status_bar", "status_chips", "status_chips_narrow", "status_no_context", "status_subagents", "status_subagents_text", "status_context", "status_context_text", "status_context_bar",
        "status_limit_bars", "status_limits", "status_no_limits", "status_account",
        "status_has_context", "status_has_subagents", "status_has_account",
    ] {
        assert!(outputs.contains_key(name), "{name} 출력이 선언되지 않았다");
    }
}
