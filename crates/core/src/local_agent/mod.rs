//! 창별 ACP 실행기의 C4 연결 경계.
#![allow(dead_code)]
mod process;
mod prompt;
mod record;
mod updates;
mod worker;
mod context;
mod wiring;
pub(crate) use wiring::{data_changed, handle, shutdown, start_events, state_changed, LocalAgents};

use crate::error;
use kaleidoscope_contract::{
    conversation::{ConversationItemKind, ConversationUpload},
    local_agent::{
        AgentControlValue, AgentSpec, LocalAgentPhase, LocalAgentSnapshot, LocalAgentUpdate,
    },
    CoreError, ErrorCode,
};
#[allow(unused_imports)]
pub(crate) use record::{attachment_bytes, delete_record, read_history};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread::JoinHandle,
};
use tokio::sync::mpsc;

#[derive(Clone)]
pub(crate) struct McpHttp {
    pub url: String,
    pub headers: Vec<(String, String)>,
}
#[derive(Clone)]
pub(crate) struct WorkerConfig {
    pub window_id: String,
    pub generation: String,
    pub spec: AgentSpec,
    pub spec_hash: String,
    pub cwd: PathBuf,
    pub mcp: Option<McpHttp>,
    pub record_dir: PathBuf,
}
pub(crate) type Emit = Arc<dyn Fn(LocalAgentUpdate) + Send + Sync>;
pub(crate) type WorkerSnapshot = LocalAgentSnapshot;
#[derive(Clone)]
pub(crate) struct PromptInput {
    pub request_id: String,
    pub text: String,
    pub uploads: Vec<ConversationUpload>,
    pub context: Option<String>,
    pub visuals: Vec<ConversationUpload>,
}

use updates::{Command, Shared, State};
pub(crate) struct WorkerHandle {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}
impl WorkerHandle {
    pub fn start(config: WorkerConfig, emit: Emit) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let mut record = record::Record::load(&config.record_dir);
        let cwd = std::fs::canonicalize(&config.cwd).unwrap_or_else(|_| config.cwd.clone());
        let changed = !record.spec_hash.is_empty()
            && (record.spec_hash != config.spec_hash || record.cwd != cwd);
        if changed {
            record.session_id = None;
            record.controls.clear();
            record.item(
                ConversationItemKind::Notice,
                uuid::Uuid::new_v4().to_string(),
                "설정이나 폴더가 바뀌어 새 세션을 시작합니다.".into(),
                vec![],
            );
        }
        record.spec_hash = config.spec_hash.clone();
        record.cwd = cwd;
        let seen = record
            .items
            .iter()
            .filter(|i| i.kind == ConversationItemKind::User)
            .map(|i| i.id.clone())
            .collect();
        let snapshot = LocalAgentSnapshot {
            generation: config.generation.clone(),
            phase: LocalAgentPhase::Starting,
            agents: vec![],
            selected: None,
            folder_name: None,
            execution: None,
            auth_methods: vec![],
            controls: vec![],
            history: record.items.clone(),
            stream_id: None,
            text: String::new(),
            activity: kaleidoscope_contract::local_agent::AgentActivity {
                busy: false,
                tool: None,
            },
            permissions: vec![],
            queued: vec![],
            failure: None,
        };
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                snapshot,
                record,
                seen,
                responders: HashMap::new(),
                tools: vec![],
                replay: false,
            }),
            config,
            emit,
            tx,
        });
        let owner = shared.clone();
        let thread = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("런타임 생성");
            runtime.block_on(worker::run(owner, rx));
        });
        Self {
            shared,
            thread: Some(thread),
        }
    }
    pub fn snapshot(&self) -> WorkerSnapshot {
        self.shared.state.lock().unwrap().snapshot.clone()
    }
    pub fn send(&self, input: PromptInput) -> Result<bool, CoreError> {
        prompt::validate(&input)?;
        let phase = self.shared.state.lock().unwrap().snapshot.phase;
        if !matches!(phase, LocalAgentPhase::Ready | LocalAgentPhase::Responding) {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        let (reply, result) = std::sync::mpsc::sync_channel(1);
        self.shared
            .tx
            .send(Command::Send(input, reply))
            .map_err(|_| error::make(ErrorCode::LocalAgentFailed))?;
        result
            .recv()
            .map_err(|_| error::make(ErrorCode::LocalAgentFailed))?
    }
    pub fn cancel(&self) {
        let _ = self.shared.tx.send(Command::Cancel);
    }
    pub fn answer_permission(&self, id: &str, option: &str) -> Result<(), CoreError> {
        if updates::answer(&self.shared, id, Some(option))
            .map_err(|e| error::with_message(ErrorCode::Io, &e.to_string()))?
        {
            Ok(())
        } else {
            Err(error::make(ErrorCode::InvalidRequest))
        }
    }
    pub fn configure(&self, id: &str, value: AgentControlValue) -> Result<(), CoreError> {
        let s = self.shared.state.lock().unwrap();
        if s.snapshot.phase != LocalAgentPhase::Ready
            || !s
                .snapshot
                .controls
                .iter()
                .any(|c| c.id == id && updates::accepts(c, &value))
        {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        drop(s);
        self.shared
            .tx
            .send(Command::Configure(id.into(), value))
            .map_err(|_| error::make(ErrorCode::LocalAgentFailed))
    }
    pub fn authenticate(&self, id: &str) -> Result<(), CoreError> {
        let s = self.shared.state.lock().unwrap();
        if s.snapshot.phase != LocalAgentPhase::LoginRequired
            || !s.snapshot.auth_methods.iter().any(|m| m.id == id)
        {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        drop(s);
        self.shared
            .tx
            .send(Command::Authenticate(id.into()))
            .map_err(|_| error::make(ErrorCode::LocalAgentFailed))
    }
    pub fn retry(&self) -> Result<(), CoreError> {
        if self.snapshot().phase != LocalAgentPhase::Failed {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        self.shared
            .tx
            .send(Command::Retry)
            .map_err(|_| error::make(ErrorCode::LocalAgentFailed))
    }
    pub fn shutdown(mut self) {
        self.stop();
    }
    fn stop(&mut self) {
        if let Some(thread) = self.thread.take() {
            let _ = self.shared.tx.send(Command::Shutdown);
            let _ = thread.join();
        }
    }
}
impl Drop for WorkerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}
