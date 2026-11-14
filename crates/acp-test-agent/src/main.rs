//! 네트워크 없이 고정된 ACP 응답을 내는 시험 프로세스.
//! 연결 하나에 세션 여러 개를 두고, 오래 걸리는 턴은 스레드에서 흘려 다른 세션 요청을 계속 받는다.
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// 한 줄을 통째로 쓴다. `io::stdout().lock()`이 프로세스 전체에서 공유되는 뮤텍스라
/// 여러 스레드가 동시에 써도 줄 단위로 섞이지 않는다.
fn emit(value: Value) {
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{value}").unwrap();
    stdout.flush().unwrap();
}
fn update(session: &str, value: Value) {
    emit(
        json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":session,"update":value}}),
    );
}
fn chunk(session: &str, text: &str) {
    update(
        session,
        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":text}}),
    );
}

/// 응답을 아직 보내지 않은 프롬프트. `token`으로 끝낼 권한이 누구에게 있는지 가린다.
struct Turn {
    id: Value,
    token: u64,
}
#[derive(Default)]
struct Session {
    cwd: String,
    title: Option<String>,
    turn: Option<Turn>,
    // 권한 요청 id -> 기다리는 프롬프트 id
    permissions: HashMap<String, Value>,
}
#[derive(Default)]
struct State {
    sessions: BTreeMap<String, Session>,
    // session/list 순서를 위해 만든(불러온) 차례를 따로 둔다.
    order: Vec<String>,
    next_session: usize,
    next_permission: usize,
    next_token: u64,
}
impl State {
    fn session(&mut self, id: &str) -> &mut Session {
        if !self.sessions.contains_key(id) {
            self.order.push(id.to_owned());
        }
        self.sessions.entry(id.to_owned()).or_default()
    }
    fn new_session_id(&mut self) -> String {
        loop {
            self.next_session += 1;
            let id = format!("session-{}", self.next_session);
            if !self.sessions.contains_key(&id) {
                return id;
            }
        }
    }
    fn start_turn(&mut self, session: &str, id: Value) -> u64 {
        self.next_token += 1;
        let token = self.next_token;
        self.session(session).turn = Some(Turn { id, token });
        token
    }
    /// 해당 턴이 아직 살아 있으면 꺼내 돌려준다. 이미 취소된 턴이면 None.
    fn take_turn(&mut self, session: &str, token: u64) -> Option<Value> {
        let entry = self.sessions.get_mut(session)?;
        if entry.turn.as_ref().map(|turn| turn.token) != Some(token) {
            return None;
        }
        entry.turn.take().map(|turn| turn.id)
    }
    fn alive(&self, session: &str, token: u64) -> bool {
        self.sessions
            .get(session)
            .and_then(|entry| entry.turn.as_ref())
            .map(|turn| turn.token)
            == Some(token)
    }
}

/// 턴을 스레드에서 흘린다. 청크 사이마다 취소됐는지 보고, 끝까지 가면 end_turn으로 답한다.
fn spawn_chunks(
    state: &Arc<Mutex<State>>,
    session: String,
    token: u64,
    count: usize,
    interval: Duration,
) {
    let state = Arc::clone(state);
    std::thread::spawn(move || {
        for index in 0..count {
            {
                // 취소와 청크 쓰기가 엇갈리지 않게 상태를 잡은 채로 확인하고 쓴다.
                let state = state.lock().unwrap();
                if !state.alive(&session, token) {
                    return;
                }
                chunk(&session, &format!("[{index:02}]"));
            }
            std::thread::sleep(interval);
        }
        let mut state = state.lock().unwrap();
        if let Some(id) = state.take_turn(&session, token) {
            emit(json!({"jsonrpc":"2.0","id":id,"result":{"stopReason":"end_turn"}}));
        }
    });
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
    let mut login_attempts = 0;
    let state = Arc::new(Mutex::new(State::default()));
    let mut image_count = 0usize;
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
            let mut line = summary.to_string();
            line.push('\n');
            file.write_all(line.as_bytes()).unwrap();
        }
        if method.is_empty() {
            // 권한 요청에 대한 클라이언트 응답. 어느 세션의 요청인지 찾아 그 턴만 끝낸다.
            let answer = value["id"].as_str().unwrap_or("").to_owned();
            let mut state = state.lock().unwrap();
            let found = state.sessions.iter_mut().find_map(|(session, entry)| {
                entry
                    .permissions
                    .remove(&answer)
                    .map(|prompt| (session.clone(), prompt, entry))
            });
            if let Some((session, prompt, entry)) = found {
                if entry.turn.as_ref().map(|turn| &turn.id) == Some(&prompt) {
                    entry.turn = None;
                }
                chunk(
                    &session,
                    &format!(
                        "선택: {}",
                        value["result"]["outcome"]["optionId"]
                            .as_str()
                            .unwrap_or("cancelled")
                    ),
                );
                emit(json!({"jsonrpc":"2.0","id":prompt,"result":{"stopReason":"end_turn"}}));
            }
            continue;
        }
        let id = value["id"].clone();
        match method {
            "initialize" if scenario.contains("hang") => {}
            "initialize" => {
                if scenario.contains("delay_start") {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                }
                // session/list는 기본으로 알리고, no_list 시나리오에서만 뺀다.
                let session_capabilities = if scenario.contains("no_list") {
                    json!({})
                } else {
                    json!({"list":{}})
                };
                emit(
                    json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":!scenario.contains("no_load"),"promptCapabilities":{"image":!scenario.contains("no_image")},"mcpCapabilities":{"http":!scenario.contains("no_http")},"sessionCapabilities":session_capabilities},"authMethods":[{"id":"login","name":"로그인"},{"id":"terminal","name":"터미널","type":"terminal","args":[]}]}}),
                );
            }
            "authenticate" => {
                login_attempts += 1;
                if scenario.contains("auth_fail_once") && login_attempts == 1 {
                    emit(
                        json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"login failed"}}),
                    );
                    continue;
                }
                authenticated = true;
                emit(json!({"jsonrpc":"2.0","id":id,"result":{}}));
            }
            "session/new" | "session/load" => {
                if method == "session/new" && scenario.contains("error_data") {
                    emit(
                        json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"Internal error","data":"agent-supplied detail"}}),
                    );
                    continue;
                }
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
                let session = {
                    let mut state = state.lock().unwrap();
                    let session = if method == "session/load" {
                        value["params"]["sessionId"]
                            .as_str()
                            .unwrap_or("session-1")
                            .to_owned()
                    } else {
                        state.new_session_id()
                    };
                    let cwd = value["params"]["cwd"].as_str().unwrap_or("").to_owned();
                    let entry = state.session(&session);
                    if !cwd.is_empty() {
                        entry.cwd = cwd;
                    }
                    session
                };
                if method == "session/load" {
                    // 지난 기록 재생은 고정된 한 조각으로 흉내 낸다.
                    chunk(&session, "replay");
                }
                let mut result = json!({"sessionId":session,"models":{"currentModelId":"model-a","availableModels":[{"modelId":"model-a","name":"A"},{"modelId":"model-b","name":"B"}]}});
                if !scenario.contains("legacy") {
                    result["configOptions"] = json!([{ "id":"mode","name":"모드","category":"mode","type":"select","currentValue":"a","options":[{"group":"group-a","name":"묶음","options":[{"value":"a","name":"A"},{"value":"b","name":"B"}]}] },{"id":"toggle","name":"토글","type":"boolean","currentValue":false}]);
                }
                if scenario.contains("model_config") {
                    result["configOptions"] = json!([{"id":"new-model","name":"모델","category":"model","type":"select","currentValue":"x","options":[{"value":"x","name":"X"}]}]);
                }
                if scenario.contains("many_controls") {
                    let options: Vec<Value> = (0..12)
                        .map(|index| {
                            if index % 2 == 0 {
                                json!({"id":format!("option-{index}"),"name":format!("설정 항목 {index}"),"type":"select","currentValue":"a","options":[{"value":"a","name":"아주 긴 선택 값이 이어집니다"}]})
                            } else {
                                json!({"id":format!("option-{index}"),"name":format!("응답 중 추가 설정을 허용합니다 {index}"),"type":"boolean","currentValue":true})
                            }
                        })
                        .collect();
                    result["configOptions"] = Value::Array(options);
                }
                emit(json!({"jsonrpc":"2.0","id":id,"result":result}));
            }
            "session/list" => {
                let cwd = value["params"]["cwd"].as_str();
                let state = state.lock().unwrap();
                // 최근에 만든 세션부터 돌려준다.
                let sessions: Vec<Value> = state
                    .order
                    .iter()
                    .rev()
                    .filter_map(|session| {
                        let entry = &state.sessions[session];
                        if cwd.is_some_and(|cwd| !entry.cwd.is_empty() && entry.cwd != cwd) {
                            return None;
                        }
                        let mut info = json!({"sessionId":session,"cwd":entry.cwd});
                        if let Some(title) = &entry.title {
                            info["title"] = json!(title);
                        }
                        Some(info)
                    })
                    .collect();
                emit(json!({"jsonrpc":"2.0","id":id,"result":{"sessions":sessions}}));
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
                let blocks = value["params"]["prompt"].as_array();
                let text = blocks
                    .and_then(|blocks| {
                        blocks
                            .iter()
                            .find_map(|b| b.get("text").and_then(Value::as_str))
                    })
                    .unwrap_or("");
                let session = value["params"]["sessionId"]
                    .as_str()
                    .unwrap_or("session-1")
                    .to_owned();
                {
                    let mut state = state.lock().unwrap();
                    let entry = state.session(&session);
                    if entry.title.is_none() && !text.is_empty() {
                        entry.title = Some(text.chars().take(40).collect());
                    }
                }
                if scenario.contains("share") {
                    if let Ok(directory) = std::env::var("KALEIDOSCOPE_E2E_IMAGE_DIR") {
                        let directory = std::path::PathBuf::from(directory);
                        std::fs::create_dir_all(&directory).unwrap();
                        let mut saved = Vec::new();
                        let mut text_blocks = Vec::new();
                        for block in blocks.into_iter().flatten() {
                            if let Some(text) = block.get("text").and_then(Value::as_str) {
                                text_blocks.push(text.to_owned());
                            }
                            if block.get("type").and_then(Value::as_str) != Some("image") {
                                continue;
                            }
                            let data = block
                                .get("data")
                                .and_then(Value::as_str)
                                .ok_or("ACP image block has no base64 data")
                                .unwrap();
                            let name = format!("{:04}.b64", image_count + 1);
                            std::fs::write(directory.join(&name), data).unwrap();
                            image_count += 1;
                            saved.push(name);
                        }
                        let mut prompts = std::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(directory.join("prompts.jsonl"))
                            .unwrap();
                        writeln!(
                            prompts,
                            "{}",
                            json!({"text_blocks": text_blocks, "images": saved})
                        )
                        .unwrap();
                    }
                }
                if text.contains("end-mid-turn") {
                    chunk(&session, "종료 전 응답");
                    return;
                } else if text.contains("fail-turn") {
                    chunk(&session, "OLD");
                    emit(
                        json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"turn failed"}}),
                    );
                } else if text.contains("fresh-turn") {
                    chunk(&session, "NEW");
                    emit(json!({"jsonrpc":"2.0","id":id,"result":{"stopReason":"end_turn"}}));
                } else if text.contains("stream") {
                    // 8초 동안 80조각. 스레드에서 흘려 그동안 다른 세션 요청도 받는다.
                    let token = state.lock().unwrap().start_turn(&session, id);
                    spawn_chunks(&state, session, token, 80, Duration::from_millis(100));
                } else if text.contains("drip") {
                    // 두 세션 동시 실행 시험용: 약 3초 동안 20조각을 흘리고 end_turn.
                    let token = state.lock().unwrap().start_turn(&session, id);
                    spawn_chunks(&state, session, token, 20, Duration::from_millis(150));
                } else if text.contains("permission") {
                    let mut state = state.lock().unwrap();
                    state.next_permission += 1;
                    let permission = format!("permission-{}", state.next_permission);
                    state.start_turn(&session, id.clone());
                    state
                        .session(&session)
                        .permissions
                        .insert(permission.clone(), id);
                    emit(
                        json!({"jsonrpc":"2.0","id":permission,"method":"session/request_permission","params":{"sessionId":session,"toolCall":{"toolCallId":"tool-1","title":"파일 수정"},"options":[{"optionId":"yes","name":"허용","kind":"allow_once"},{"optionId":"no","name":"거부","kind":"reject_once"}]}}),
                    );
                } else if text.contains("slow") {
                    // 취소될 때까지 응답하지 않는다.
                    state.lock().unwrap().start_turn(&session, id);
                } else {
                    chunk(&session, "안");
                    chunk(&session, "녕");
                    update(
                        &session,
                        json!({"sessionUpdate":"tool_call","toolCallId":"tool-1","title":"도구","status":"in_progress"}),
                    );
                    update(
                        &session,
                        json!({"sessionUpdate":"tool_call_update","toolCallId":"tool-1","status":"completed"}),
                    );
                    emit(json!({"jsonrpc":"2.0","id":id,"result":{"stopReason":"end_turn"}}));
                }
            }
            "session/cancel" => {
                // 그 세션의 진행 중 턴만 cancelled로 끝내고 권한 대기도 버린다.
                let session = value["params"]["sessionId"].as_str().unwrap_or("session-1");
                let mut state = state.lock().unwrap();
                if let Some(entry) = state.sessions.get_mut(session) {
                    entry.permissions.clear();
                    if let Some(turn) = entry.turn.take() {
                        emit(
                            json!({"jsonrpc":"2.0","id":turn.id,"result":{"stopReason":"cancelled"}}),
                        );
                    }
                }
            }
            _ => {}
        }
    }
}
