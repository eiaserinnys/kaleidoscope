//! 가짜 ACP 에이전트를 실제 프로세스로 띄워 동시 세션 동작을 확인한다.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

struct Agent {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Value>,
}
impl Agent {
    fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_kaleidoscope-acp-test-agent"))
            .env_remove("TEST_SCENARIO")
            .env_remove("TEST_LOG")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (sender, lines) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                // 줄이 섞이면 여기서 JSON 해석이 깨진다.
                let value: Value = serde_json::from_str(&line).expect("줄 단위 JSON");
                if sender.send(value).is_err() {
                    break;
                }
            }
        });
        let mut agent = Agent {
            child,
            stdin,
            lines,
        };
        agent.send(
            json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1}}),
        );
        agent.until(|value| value["id"] == json!(0));
        agent
    }
    fn send(&mut self, value: Value) {
        writeln!(self.stdin, "{value}").unwrap();
        self.stdin.flush().unwrap();
    }
    fn next(&self) -> Value {
        self.lines
            .recv_timeout(Duration::from_secs(15))
            .expect("에이전트 응답 대기 초과")
    }
    /// 조건에 맞는 메시지가 올 때까지 받고, 그동안 받은 것 전부를 돌려준다.
    fn until(&self, done: impl Fn(&Value) -> bool) -> Vec<Value> {
        let mut seen = Vec::new();
        loop {
            let value = self.next();
            let stop = done(&value);
            seen.push(value);
            if stop {
                return seen;
            }
        }
    }
    fn new_session(&mut self, id: u64) -> String {
        self.send(json!({"jsonrpc":"2.0","id":id,"method":"session/new","params":{"cwd":"/tmp/work","mcpServers":[]}}));
        let seen = self.until(|value| value["id"] == json!(id));
        seen.last().unwrap()["result"]["sessionId"]
            .as_str()
            .unwrap()
            .to_owned()
    }
    fn prompt(&mut self, id: &str, session: &str, text: &str) {
        self.send(json!({"jsonrpc":"2.0","id":id,"method":"session/prompt","params":{"sessionId":session,"prompt":[{"type":"text","text":text}]}}));
    }
}
impl Drop for Agent {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn chunks_of(seen: &[Value], session: &str) -> Vec<String> {
    seen.iter()
        .filter(|value| {
            value["method"] == "session/update" && value["params"]["sessionId"] == session
        })
        .filter_map(|value| {
            value["params"]["update"]["content"]["text"]
                .as_str()
                .map(str::to_owned)
        })
        .collect()
}
fn result_of<'a>(seen: &'a [Value], id: &str) -> &'a Value {
    &seen
        .iter()
        .find(|value| value["id"] == id && value.get("method").is_none())
        .expect("프롬프트 응답")["result"]
}
fn expected(count: usize) -> Vec<String> {
    (0..count).map(|index| format!("[{index:02}]")).collect()
}

#[test]
fn each_session_gets_a_new_id_and_is_listed() {
    let mut agent = Agent::start();
    assert_eq!(agent.new_session(1), "session-1");
    assert_eq!(agent.new_session(2), "session-2");
    // 불러온 세션은 주어진 id로 기록을 재생한 뒤 응답한다.
    agent.send(json!({"jsonrpc":"2.0","id":3,"method":"session/load","params":{"sessionId":"session-9","cwd":"/tmp/work","mcpServers":[]}}));
    let seen = agent.until(|value| value["id"] == json!(3));
    assert_eq!(chunks_of(&seen, "session-9"), ["replay"]);
    assert_eq!(seen.last().unwrap()["result"]["sessionId"], "session-9");
    assert_eq!(agent.new_session(4), "session-3");
    agent
        .send(json!({"jsonrpc":"2.0","id":5,"method":"session/list","params":{"cwd":"/tmp/work"}}));
    let seen = agent.until(|value| value["id"] == json!(5));
    let ids: Vec<&str> = seen.last().unwrap()["result"]["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|info| info["sessionId"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["session-3", "session-9", "session-2", "session-1"]);
    agent.send(
        json!({"jsonrpc":"2.0","id":6,"method":"session/list","params":{"cwd":"/elsewhere"}}),
    );
    let seen = agent.until(|value| value["id"] == json!(6));
    assert_eq!(seen.last().unwrap()["result"]["sessions"], json!([]));
}

#[test]
fn initialize_advertises_session_list() {
    let mut agent = Agent::start();
    agent
        .send(json!({"jsonrpc":"2.0","id":9,"method":"initialize","params":{"protocolVersion":1}}));
    let seen = agent.until(|value| value["id"] == json!(9));
    assert_eq!(
        seen.last().unwrap()["result"]["agentCapabilities"]["sessionCapabilities"]["list"],
        json!({})
    );
}

#[test]
fn concurrent_prompts_keep_their_session_ids() {
    let mut agent = Agent::start();
    let first = agent.new_session(1);
    let second = agent.new_session(2);
    let started = Instant::now();
    agent.prompt("p1", &first, "drip");
    agent.prompt("p2", &second, "drip");
    let mut seen = Vec::new();
    while result_count(&seen) < 2 {
        seen.push(agent.next());
    }
    // 두 턴이 차례로가 아니라 함께 흘렀다면 한 턴 길이(약 3초) 근처에서 끝난다.
    assert!(
        started.elapsed() < Duration::from_millis(5000),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(chunks_of(&seen, &first), expected(20));
    assert_eq!(chunks_of(&seen, &second), expected(20));
    assert_eq!(result_of(&seen, "p1")["stopReason"], "end_turn");
    assert_eq!(result_of(&seen, "p2")["stopReason"], "end_turn");
    // 첫 세션이 끝나기 전에 둘째 세션 업데이트가 이미 와 있어야 한다.
    let first_done = seen.iter().position(|value| value["id"] == "p1").unwrap();
    assert!(seen[..first_done]
        .iter()
        .any(|value| value["params"]["sessionId"] == second.as_str()));
}

fn result_count(seen: &[Value]) -> usize {
    seen.iter()
        .filter(|value| value.get("result").is_some() || value.get("error").is_some())
        .count()
}

#[test]
fn cancel_ends_only_that_session() {
    let mut agent = Agent::start();
    let first = agent.new_session(1);
    let second = agent.new_session(2);
    agent.prompt("p1", &first, "drip");
    agent.prompt("p2", &second, "drip");
    let mut seen = agent.until(|value| value["params"]["sessionId"] == first.as_str());
    agent.send(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":first}}));
    while result_count(&seen) < 2 {
        seen.push(agent.next());
    }
    assert_eq!(result_of(&seen, "p1")["stopReason"], "cancelled");
    assert_eq!(result_of(&seen, "p2")["stopReason"], "end_turn");
    assert_eq!(chunks_of(&seen, &second), expected(20));
    let cut = chunks_of(&seen, &first);
    assert!(!cut.is_empty() && cut.len() < 20, "{cut:?}");
    // 취소 응답 뒤에는 그 세션 업데이트가 더 오지 않는다.
    let cancelled = seen.iter().position(|value| value["id"] == "p1").unwrap();
    assert!(!seen[cancelled..]
        .iter()
        .any(|value| value["params"]["sessionId"] == first.as_str()));
    // 끝난 세션은 다음 프롬프트를 바로 받는다.
    agent.prompt("p3", &first, "fresh-turn");
    let seen = agent.until(|value| value["id"] == "p3");
    assert_eq!(chunks_of(&seen, &first), ["NEW"]);
}

#[test]
fn permission_requests_wait_per_session() {
    let mut agent = Agent::start();
    let first = agent.new_session(1);
    let second = agent.new_session(2);
    agent.prompt("p1", &first, "permission");
    let one = agent.until(|value| value["method"] == "session/request_permission");
    agent.prompt("p2", &second, "permission");
    let two = agent.until(|value| value["method"] == "session/request_permission");
    let one = one.last().unwrap();
    let two = two.last().unwrap();
    assert_eq!(one["id"], "permission-1");
    assert_eq!(one["params"]["sessionId"], first.as_str());
    assert_eq!(two["id"], "permission-2");
    assert_eq!(two["params"]["sessionId"], second.as_str());
    // 둘째 세션 요청에 먼저 답하면 둘째 턴만 끝난다.
    agent.send(json!({"jsonrpc":"2.0","id":"permission-2","result":{"outcome":{"outcome":"selected","optionId":"no"}}}));
    let seen = agent.until(|value| value["id"] == "p2");
    assert_eq!(chunks_of(&seen, &second), ["선택: no"]);
    assert!(chunks_of(&seen, &first).is_empty());
    // 첫 세션은 아직 대기 중이라 취소하면 cancelled로 끝난다.
    agent.send(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":first}}));
    let seen = agent.until(|value| value["id"] == "p1");
    assert_eq!(seen.last().unwrap()["result"]["stopReason"], "cancelled");
    // 취소 뒤 늦게 온 답은 무시한다.
    agent.send(json!({"jsonrpc":"2.0","id":"permission-1","result":{"outcome":{"outcome":"selected","optionId":"yes"}}}));
    agent.prompt("p3", &first, "fresh-turn");
    let seen = agent.until(|value| value["id"] == "p3");
    assert_eq!(chunks_of(&seen, &first), ["NEW"]);
}
