use crate::local_agent::{PromptInput, WorkerConfig, WorkerHandle};
use kaleidoscope_contract::{
    conversation::ConversationItemKind,
    local_agent::{AgentSpec, LocalAgentPhase},
};
use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};

// 깨끗한 checkout에서 코어 시험만 실행해도 가짜 에이전트를 준비한다.
#[rustfmt::skip]
pub(super) fn agent_binary() -> std::path::PathBuf {
    static BIN: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    BIN.get_or_init(|| {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let target = std::env::var_os("CARGO_TARGET_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| "target".into());
        let binary = root.join(target).join("debug").join(format!("kaleidoscope-acp-test-agent{}", std::env::consts::EXE_SUFFIX));
        let source = root.join("crates/acp-test-agent/src/main.rs");
        if !binary.exists() || std::fs::metadata(&source).and_then(|m| m.modified()).ok() > std::fs::metadata(&binary).and_then(|m| m.modified()).ok() {
            let output = std::process::Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into())).current_dir(&root).args(["build", "-p", "kaleidoscope-acp-test-agent"]).output().expect("가짜 에이전트 빌드");
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        }
        binary
    }).clone()
}
fn config(dir: &std::path::Path, scenario: &str) -> WorkerConfig {
    let mut env = BTreeMap::new();
    env.insert("TEST_SCENARIO".into(), scenario.into());
    env.insert(
        "TEST_LOG".into(),
        dir.join("calls.jsonl").to_string_lossy().into_owned(),
    );
    WorkerConfig {
        window_id: "window".into(),
        generation: "generation".into(),
        spec: AgentSpec {
            id: "test".into(),
            name: "시험".into(),
            command: agent_binary().to_string_lossy().into_owned(),
            args: vec![],
            env,
            auth_methods: None,
        },
        spec_hash: "spec".into(),
        cwd: dir.into(),
        mcp: None,
        record_dir: dir.join("record"),
    }
}
fn wait(worker: &WorkerHandle, phase: LocalAgentPhase) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if worker.snapshot().phase == phase {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("expected {phase:?}, got {:?}", worker.snapshot().phase);
}
fn prompt(id: &str, text: &str) -> PromptInput {
    PromptInput {
        request_id: id.into(),
        text: text.into(),
        uploads: vec![],
        context: None,
        visuals: vec![],
    }
}
#[test]
fn prompt_stream_and_record() {
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = events.clone();
    let worker = WorkerHandle::start(
        config(dir.path(), ""),
        Arc::new(move |e| sink.lock().unwrap().push(e)),
    );
    wait(&worker, LocalAgentPhase::Ready);
    assert!(worker.retry().is_err());
    worker.send(prompt("one", "hello")).unwrap();
    until(|| worker.snapshot().history.len() >= 2);
    let snapshot = worker.snapshot();
    assert_eq!(snapshot.history.len(), 2);
    assert_eq!(snapshot.history[0].text, "hello");
    assert_eq!(snapshot.history[1].kind, ConversationItemKind::Assistant);
    assert_eq!(snapshot.history[1].text, "안녕");
    worker.shutdown();
    let events = events.lock().unwrap();
    assert!(events.iter().any(|e| matches!(e, kaleidoscope_contract::local_agent::LocalAgentUpdate::Conversation { update: kaleidoscope_contract::conversation::ConversationEvent::Text { text, .. } } if text == "안녕")));
    assert!(events.iter().any(|e| matches!(e, kaleidoscope_contract::local_agent::LocalAgentUpdate::Conversation { update: kaleidoscope_contract::conversation::ConversationEvent::Activity { tool: Some(title), .. } } if title == "도구")));
}
#[test]
#[rustfmt::skip]
fn missing_command_fails() {
    let dir = tempfile::tempdir().unwrap(); let mut cfg = config(dir.path(), "");
    let path = dir.path().join(format!("agent{}", std::env::consts::EXE_SUFFIX));
    cfg.spec.command = path.to_string_lossy().into_owned();
    let worker = WorkerHandle::start(cfg, Arc::new(|_| {})); wait(&worker, LocalAgentPhase::Failed);
    assert!(worker.snapshot().failure.unwrap().message.contains("agent"));
    std::fs::copy(agent_binary(), path).unwrap(); worker.retry().unwrap(); wait(&worker, LocalAgentPhase::Ready);
    assert!(worker.retry().is_err());
}
#[test]
fn authentication_filters_terminal_and_unlisted_methods() {
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = config(dir.path(), "auth");
    cfg.spec.auth_methods = Some(vec!["login".into()]);
    let worker = WorkerHandle::start(cfg, Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::LoginRequired);
    assert_eq!(
        worker
            .snapshot()
            .auth_methods
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>(),
        vec!["login"]
    );
    assert!(worker.authenticate("terminal").is_err());
    worker.authenticate("login").unwrap();
    wait(&worker, LocalAgentPhase::Ready);
}

fn until(mut test: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if test() {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("시간 안에 상태가 바뀌지 않았습니다");
}
fn calls(dir: &std::path::Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(dir.join("calls.jsonl"))
        .unwrap_or_default()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect()
}
fn method_count(dir: &std::path::Path, method: &str) -> usize {
    calls(dir).iter().filter(|c| c["method"] == method).count()
}
#[test]
fn permission_choices_and_cancel() {
    for choice in ["yes", "no"] {
        let dir = tempfile::tempdir().unwrap();
        let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
        wait(&worker, LocalAgentPhase::Ready);
        worker.send(prompt("p", "permission")).unwrap();
        until(|| !worker.snapshot().permissions.is_empty());
        let p = worker.snapshot().permissions[0].clone();
        worker.answer_permission(&p.id, choice).unwrap();
        until(|| {
            worker
                .snapshot()
                .history
                .iter()
                .any(|i| i.kind == ConversationItemKind::Notice)
        });
        assert!(worker.answer_permission(&p.id, choice).is_err());
        wait(&worker, LocalAgentPhase::Ready);
        let log = calls(dir.path());
        assert!(log
            .iter()
            .any(|v| v["result"]["outcome"]["optionId"] == choice));
        assert!(worker
            .snapshot()
            .history
            .iter()
            .any(|i| i.kind == ConversationItemKind::Notice
                && i.text
                    .contains(if choice == "yes" { "허용" } else { "거부" })));
    }
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    worker.send(prompt("p", "permission")).unwrap();
    until(|| !worker.snapshot().permissions.is_empty());
    worker.cancel();
    until(|| {
        calls(dir.path())
            .iter()
            .any(|v| v["result"]["outcome"]["outcome"] == "cancelled")
    });
    assert!(worker
        .snapshot()
        .history
        .iter()
        .any(|i| i.text.contains("취소됨")));
}
#[test]
fn queue_is_fifo_and_cancel_only_stops_current_turn() {
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    assert!(!worker.send(prompt("one", "slow")).unwrap());
    until(|| method_count(dir.path(), "session/prompt") == 1);
    assert!(worker.send(prompt("two", "next")).unwrap());
    assert!(worker.send(prompt("three", "last")).unwrap());
    assert!(worker.send(prompt("two", "next")).unwrap());
    worker.cancel();
    until(|| method_count(dir.path(), "session/prompt") == 3);
    wait(&worker, LocalAgentPhase::Ready);
    let texts: Vec<_> = calls(dir.path())
        .into_iter()
        .filter(|v| v["method"] == "session/prompt")
        .map(|v| v["params"]["prompt"].to_string())
        .collect();
    assert!(texts[0].contains("slow") && texts[1].contains("next") && texts[2].contains("last"));
}
#[test]
fn restart_loads_without_replay_and_falls_back() {
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    worker.send(prompt("one", "hello")).unwrap();
    until(|| worker.snapshot().history.len() >= 2);
    worker.shutdown();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    assert_eq!(method_count(dir.path(), "session/load"), 1);
    assert!(!worker.snapshot().history.iter().any(|i| i.text == "replay"));
    worker.shutdown();
    let worker = WorkerHandle::start(config(dir.path(), "no_load"), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    assert!(worker
        .snapshot()
        .history
        .iter()
        .any(|i| i.kind == ConversationItemKind::Notice && i.text.contains("이어받지 못")));
    worker.shutdown();
    let worker = WorkerHandle::start(config(dir.path(), "load_fail"), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    assert_eq!(method_count(dir.path(), "session/load"), 2);
    assert!(
        worker
            .snapshot()
            .history
            .iter()
            .filter(|i| i.kind == ConversationItemKind::Notice && i.text.contains("이어받지 못"))
            .count()
            >= 2
    );
    worker.shutdown();
    let mut cfg = config(dir.path(), "");
    cfg.spec_hash = "new hash".into();
    let worker = WorkerHandle::start(cfg, Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    assert!(worker
        .snapshot()
        .history
        .iter()
        .any(|i| i.text.contains("새 세션")));
}
#[test]
fn legacy_model_and_config_controls_restore() {
    use kaleidoscope_contract::local_agent::{AgentControlKind, AgentControlValue};
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), "legacy"), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    let control = worker
        .snapshot()
        .controls
        .into_iter()
        .find(|c| c.category.as_deref() == Some("model"))
        .unwrap();
    assert!(matches!(control.kind, AgentControlKind::Select { .. }));
    worker
        .configure(&control.id, AgentControlValue::String("model-b".into()))
        .unwrap();
    until(|| method_count(dir.path(), "session/set_model") == 1);
    worker.shutdown();
    let worker = WorkerHandle::start(config(dir.path(), "legacy"), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    assert_eq!(method_count(dir.path(), "session/set_model"), 2);
    assert_eq!(
        worker
            .snapshot()
            .controls
            .iter()
            .find(|c| c.id == control.id)
            .unwrap()
            .value,
        AgentControlValue::String("model-b".into())
    );
    worker.shutdown();
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    assert!(worker
        .snapshot()
        .controls
        .iter()
        .any(|c| c.id == "toggle" && matches!(c.kind, AgentControlKind::Boolean)));
    let controls = worker.snapshot().controls;
    let mode = controls.iter().find(|c| c.id == "mode").unwrap();
    let AgentControlKind::Select { options } = &mode.kind else {
        panic!("선택형 모드가 아닙니다")
    };
    assert_eq!(options[0].name.as_deref(), Some("묶음"));
    assert_eq!(options[0].options.len(), 2);
    worker.shutdown();
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), "model_config"), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    let controls = worker.snapshot().controls;
    assert_eq!(
        controls
            .iter()
            .filter(|c| c.category.as_deref() == Some("model"))
            .count(),
        1
    );
    assert!(controls.iter().any(|c| c.id == "new-model"));
}
#[test]
fn bad_protocol_and_early_exit_fail_without_restart() {
    for scenario in ["invalid", "exit"] {
        let dir = tempfile::tempdir().unwrap();
        let worker = WorkerHandle::start(config(dir.path(), scenario), Arc::new(|_| {}));
        wait(&worker, LocalAgentPhase::Failed);
        let failure = worker.snapshot().failure.unwrap();
        assert!(failure.message.contains(&failure.command.unwrap()));
        if scenario == "invalid" {
            assert!(failure.message.contains("JSON"));
        }
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(worker.snapshot().phase, LocalAgentPhase::Failed);
    }
}
#[test]
fn attachments_and_mcp_advertisement() {
    use crate::local_agent::{attachment_bytes, McpHttp};
    use kaleidoscope_contract::conversation::ConversationUpload;
    for scenario in ["", "no_image", "no_http"] {
        let dir = tempfile::tempdir().unwrap();
        let mut cfg = config(dir.path(), scenario);
        cfg.mcp = Some(McpHttp {
            url: "http://localhost/mcp".into(),
            headers: vec![("Authorization".into(), "secret-test-value".into())],
        });
        let worker = WorkerHandle::start(cfg, Arc::new(|_| {}));
        wait(&worker, LocalAgentPhase::Ready);
        let mut p = prompt("file", "hello");
        p.context = Some("context-only".into());
        p.uploads.push(ConversationUpload {
            name: "image.png".into(),
            mime: "image/png".into(),
            data_base64: "YWJj".into(),
        });
        p.uploads.push(ConversationUpload {
            name: "note.txt".into(),
            mime: "text/plain".into(),
            data_base64: "ZGVm".into(),
        });
        worker.send(p).unwrap();
        until(|| worker.snapshot().history.len() >= 2);
        worker.shutdown();
        let log = calls(dir.path());
        let setup = log.iter().find(|v| v["method"] == "session/new").unwrap();
        assert_eq!(
            setup["params"]["mcpServers"].as_array().unwrap().len(),
            usize::from(scenario != "no_http")
        );
        assert!(
            !std::fs::read_to_string(dir.path().join("record/record.json"))
                .unwrap()
                .contains("secret-test-value")
        );
        let prompt = log
            .iter()
            .find(|v| v["method"] == "session/prompt")
            .unwrap();
        assert!(prompt["params"]["prompt"][0]["text"]
            .as_str()
            .unwrap()
            .contains("upload_app"));
        assert!(prompt["params"]["prompt"][0]["text"]
            .as_str()
            .unwrap()
            .contains("http://localhost/mcp"));
        assert!(!prompt["params"]["prompt"][0]["text"]
            .as_str()
            .unwrap()
            .contains("secret-test-value"));
        assert_eq!(prompt["params"]["prompt"][1]["text"], "context-only");
        assert_eq!(
            prompt["params"]["prompt"][3]["type"],
            if scenario == "no_image" {
                "resource_link"
            } else {
                "image"
            }
        );
        assert_eq!(prompt["params"]["prompt"][4]["type"], "resource_link");
        let history = crate::local_agent::read_history(&dir.path().join("record"));
        assert_eq!(history[0].text, "hello");
        assert_eq!(history[0].attachments.len(), 2);
        let (_, data, path) = attachment_bytes(
            &dir.path().join("record"),
            "file",
            &history[0].attachments[0].id,
        )
        .unwrap();
        assert_eq!(data, b"abc");
        assert_ne!(path.file_name().unwrap(), "image.png");
    }
}
#[cfg(unix)]
#[test]
fn drop_ends_child_and_descendant() {
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = config(dir.path(), "tree");
    cfg.spec.env.insert(
        "TEST_PID_LOG".into(),
        dir.path().join("pids").to_string_lossy().into(),
    );
    let worker = WorkerHandle::start(cfg, Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    until(|| dir.path().join("pids").exists());
    let ids: Vec<u32> = std::fs::read_to_string(dir.path().join("pids"))
        .unwrap()
        .split_whitespace()
        .map(|s| s.parse().unwrap())
        .collect();
    drop(worker);
    until(|| {
        ids.iter()
            .all(|pid| !std::path::Path::new(&format!("/proc/{pid}")).exists())
    });
}
#[test]
fn shutdown_cancels_pending_permission_and_hung_setup() {
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    worker.send(prompt("p", "permission")).unwrap();
    until(|| !worker.snapshot().permissions.is_empty());
    worker.shutdown();
    assert!(calls(dir.path())
        .iter()
        .any(|v| v["result"]["outcome"]["outcome"] == "cancelled"));
    assert!(crate::local_agent::read_history(&dir.path().join("record"))
        .iter()
        .any(|i| i.text.contains("취소됨")));
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), "hang"), Arc::new(|_| {}));
    until(|| method_count(dir.path(), "initialize") == 1);
    let start = Instant::now();
    drop(worker);
    assert!(start.elapsed() < Duration::from_secs(2));
}
#[test]
fn config_values_restore_and_auth_allowlist_is_enforced() {
    use kaleidoscope_contract::local_agent::AgentControlValue;
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    worker
        .configure("toggle", AgentControlValue::Boolean(true))
        .unwrap();
    until(|| {
        worker
            .snapshot()
            .controls
            .iter()
            .any(|c| c.id == "toggle" && c.value == AgentControlValue::Boolean(true))
    });
    worker.shutdown();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    assert_eq!(method_count(dir.path(), "session/set_config_option"), 2);
    assert!(worker
        .snapshot()
        .controls
        .iter()
        .any(|c| c.id == "toggle" && c.value == AgentControlValue::Boolean(true)));
    worker.shutdown();
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = config(dir.path(), "auth");
    cfg.spec.auth_methods = Some(vec![]);
    let worker = WorkerHandle::start(cfg, Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::LoginRequired);
    assert!(worker.snapshot().auth_methods.is_empty());
    assert!(worker.authenticate("login").is_err());
}
#[test]
fn cwd_change_does_not_load_old_session() {
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    worker.shutdown();
    let other = tempfile::tempdir().unwrap();
    let mut cfg = config(dir.path(), "");
    cfg.cwd = other.path().into();
    let worker = WorkerHandle::start(cfg, Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    assert_eq!(method_count(dir.path(), "session/load"), 0);
    assert!(worker
        .snapshot()
        .history
        .iter()
        .any(|i| i.text.contains("새 세션")));
}

mod regressions;
