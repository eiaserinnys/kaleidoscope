//! 네트워크 없이 고정된 ACP 응답을 내는 시험 프로세스.
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

fn emit(value: Value) {
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{value}").unwrap();
    stdout.flush().unwrap();
}
fn update(value: Value) {
    emit(
        json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"session-1","update":value}}),
    );
}
fn main() {
    let scenario = std::env::var("TEST_SCENARIO").unwrap_or_default();
    if scenario.contains("exit") {
        return;
    }
    if scenario.contains("invalid") {
        println!("{{broken");
        io::stdout().flush().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(600));
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("child") {
        std::thread::sleep(std::time::Duration::from_secs(600));
        return;
    }
    if scenario.contains("tree") {
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("child")
            .spawn()
            .unwrap();
        if let Ok(path) = std::env::var("TEST_PID_LOG") {
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .unwrap();
            writeln!(file, "{} {}", std::process::id(), child.id()).unwrap();
        }
    }
    let mut authenticated = false;
    let mut pending = Value::Null;
    for line in io::stdin().lock().lines() {
        let value: Value = match line.ok().and_then(|s| serde_json::from_str(&s).ok()) {
            Some(v) => v,
            None => break,
        };
        let method = value["method"].as_str().unwrap_or("");
        if let Ok(path) = std::env::var("TEST_LOG") {
            let mut summary = value.clone();
            if let Some(servers) = summary
                .pointer_mut("/params/mcpServers")
                .and_then(Value::as_array_mut)
            {
                for server in servers {
                    if let Some(headers) = server["headers"].as_array_mut() {
                        for header in headers {
                            header["value"] = json!("[redacted]");
                        }
                    }
                }
            }
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .unwrap();
            writeln!(file, "{summary}").unwrap();
        }
        if method.is_empty() && value["id"] == json!("permission-1") {
            update(
                json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":format!("선택: {}",value["result"]["outcome"]["optionId"].as_str().unwrap_or("cancelled"))}}),
            );
            emit(json!({"jsonrpc":"2.0","id":pending,"result":{"stopReason":"end_turn"}}));
            pending = Value::Null;
            continue;
        }
        let id = value["id"].clone();
        match method {
            "initialize" if scenario.contains("hang") => {}
            "initialize" => emit(
                json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":!scenario.contains("no_load"),"promptCapabilities":{"image":!scenario.contains("no_image")},"mcpCapabilities":{"http":!scenario.contains("no_http")}},"authMethods":[{"id":"login","name":"로그인"},{"id":"terminal","name":"터미널","type":"terminal","args":[]}]}}),
            ),
            "authenticate" => {
                authenticated = true;
                emit(json!({"jsonrpc":"2.0","id":id,"result":{}}));
            }
            "session/new" | "session/load" => {
                if scenario.contains("auth") && !authenticated {
                    emit(
                        json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":"Authentication required"}}),
                    );
                    continue;
                }
                if method == "session/load" && scenario.contains("load_fail") {
                    emit(
                        json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"load failed"}}),
                    );
                    continue;
                }
                if method == "session/load" {
                    update(
                        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"replay"}}),
                    );
                }
                let mut result = json!({"sessionId":"session-1","models":{"currentModelId":"model-a","availableModels":[{"modelId":"model-a","name":"A"},{"modelId":"model-b","name":"B"}]}});
                if !scenario.contains("legacy") {
                    result["configOptions"] = json!([{ "id":"mode","name":"모드","category":"mode","type":"select","currentValue":"a","options":[{"group":"group-a","name":"묶음","options":[{"value":"a","name":"A"},{"value":"b","name":"B"}]}] },{"id":"toggle","name":"토글","type":"boolean","currentValue":false}]);
                }
                if scenario.contains("model_config") {
                    result["configOptions"] = json!([{"id":"new-model","name":"모델","category":"model","type":"select","currentValue":"x","options":[{"value":"x","name":"X"}]}]);
                }
                emit(json!({"jsonrpc":"2.0","id":id,"result":result}));
            }
            "session/set_config_option" => {
                let toggle = value["params"]["value"].as_bool().unwrap_or(false);
                emit(
                    json!({"jsonrpc":"2.0","id":id,"result":{"configOptions":[{"id":"toggle","name":"토글","type":"boolean","currentValue":toggle},{"id":"mode","name":"모드","category":"mode","type":"select","currentValue":"a","options":[{"value":"a","name":"A"},{"value":"b","name":"B"}]}]}}),
                )
            }
            "session/set_model" | "session/set_mode" => {
                emit(json!({"jsonrpc":"2.0","id":id,"result":{}}))
            }
            "session/prompt" => {
                // 앱 제작 안내 대신 마지막 사용자 텍스트에서 시나리오를 고른다.
                let text = value["params"]["prompt"].as_array().and_then(|blocks| blocks.iter().rev().find_map(|b| b.get("text").and_then(Value::as_str))).unwrap_or("");
                if text.contains("fail-turn") {
                    update(
                        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"OLD"}}),
                    );
                    emit(
                        json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"turn failed"}}),
                    );
                } else if text.contains("fresh-turn") {
                    update(
                        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"NEW"}}),
                    );
                    emit(json!({"jsonrpc":"2.0","id":id,"result":{"stopReason":"end_turn"}}));
                } else if text.contains("permission") {
                    pending = id;
                    emit(
                        json!({"jsonrpc":"2.0","id":"permission-1","method":"session/request_permission","params":{"sessionId":"session-1","toolCall":{"toolCallId":"tool-1","title":"파일 수정"},"options":[{"optionId":"yes","name":"허용","kind":"allow_once"},{"optionId":"no","name":"거부","kind":"reject_once"}]}}),
                    );
                } else if text.contains("slow") {
                    pending = id;
                } else {
                    update(
                        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"안"}}),
                    );
                    update(
                        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"녕"}}),
                    );
                    update(
                        json!({"sessionUpdate":"tool_call","toolCallId":"tool-1","title":"도구","status":"in_progress"}),
                    );
                    update(
                        json!({"sessionUpdate":"tool_call_update","toolCallId":"tool-1","status":"completed"}),
                    );
                    emit(json!({"jsonrpc":"2.0","id":id,"result":{"stopReason":"end_turn"}}));
                }
            }
            "session/cancel" => {
                if !pending.is_null() {
                    emit(json!({"jsonrpc":"2.0","id":pending,"result":{"stopReason":"cancelled"}}));
                    pending = Value::Null;
                }
            }
            _ => {}
        }
    }
}
