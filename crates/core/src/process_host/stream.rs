//! 자식 입출력과 미확인 출력 버퍼.
use crate::Inner;
use kaleidoscope_contract::{
    errors,
    process::{ProcessExit, ProcessSpec},
    CoreError, CoreEvent,
};
use std::{
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex, Weak},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, Notify},
};

const OUTPUT_LIMIT: usize = 8 * 1024 * 1024;
const STDERR_LIMIT: usize = 64 * 1024;
pub(super) const READ_LIMIT: usize = 64 * 1024;

pub(super) enum Input {
    Write(Vec<u8>),
    Close,
}
pub(super) struct State {
    pub buffer: VecDeque<u8>,
    pub after: u64,
    pub checkpoint: Option<serde_json::Value>,
    pub stderr: VecDeque<u8>,
    pub exit: Option<ProcessExit>,
    pub input: Option<mpsc::UnboundedSender<Input>>,
}
pub(super) struct Running {
    pub window: String,
    pub key: String,
    pub permission: String,
    pub handle: String,
    pub cwd: String,
    pub scope: Mutex<PathBuf>,
    pub services: Mutex<BTreeMap<String, Option<String>>>,
    pub state: Arc<Mutex<State>>,
    pub space: Arc<Notify>,
    pub stop_tx: mpsc::UnboundedSender<()>,
    pub thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Running {
    pub fn launch(
        inner: &Arc<Inner>,
        window: String,
        key: String,
        permission: String,
        spec: ProcessSpec,
        cwd: PathBuf,
        scope: PathBuf,
    ) -> Result<Arc<Self>, CoreError> {
        let handle = uuid::Uuid::new_v4().to_string();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let (stop_tx, mut stop_rx) = mpsc::unbounded_channel();
        let state = Arc::new(Mutex::new(State {
            buffer: VecDeque::new(),
            after: 0,
            checkpoint: None,
            stderr: VecDeque::new(),
            exit: None,
            input: Some(tx),
        }));
        let space = Arc::new(Notify::new());
        let task_state = state.clone();
        let task_space = space.clone();
        let weak = Arc::downgrade(inner);
        let event_window = window.clone();
        let event_handle = handle.clone();
        let task_cwd = cwd.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let thread = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("프로세스 런타임");
            rt.block_on(async move {
                let mut child = match crate::os_process::spawn(&spec.command, &spec.args, &spec.env, &task_cwd) {
                    Ok(child) => child,
                    Err(failure) => {
                        let error = match failure {
                            crate::os_process::SpawnFailure::Resolve(_) => errors::PROCESS_START_COMMAND_NOT_FOUND(&spec.command),
                            crate::os_process::SpawnFailure::Spawn(error) if error.kind() == std::io::ErrorKind::NotFound => errors::PROCESS_START_SPAWN_NOT_FOUND(&spec.command, error),
                            crate::os_process::SpawnFailure::Spawn(error) if error.kind() == std::io::ErrorKind::PermissionDenied => errors::PROCESS_START_SPAWN_PERMISSION_DENIED(&spec.command, error),
                            crate::os_process::SpawnFailure::Spawn(error) => errors::PROCESS_START_SPAWN_FAILED(&spec.command, error),
                        };
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                };
                let mut stdin = child.stdin().take().expect("piped stdin");
                let mut stdout = child.stdout().take().expect("piped stdout");
                let mut stderr = child.stderr().take().expect("piped stderr");
                let output_state = task_state.clone();
                let output_space = task_space.clone();
                let output_weak = weak.clone();
                let output_window = event_window.clone();
                let output_handle = event_handle.clone();
                let output = tokio::spawn(async move {
                    loop {
                        let notified = output_space.notified();
                        let room = OUTPUT_LIMIT - output_state.lock().unwrap().buffer.len();
                        if room == 0 { notified.await; continue; }
                        let mut bytes = vec![0; room.min(READ_LIMIT)];
                        let Ok(count) = stdout.read(&mut bytes).await else { break };
                        if count == 0 { break; }
                        output_state.lock().unwrap().buffer.extend(&bytes[..count]);
                        emit(&output_weak, &output_window, &output_handle);
                    }
                });
                let error_state = task_state.clone();
                let errors = tokio::spawn(async move {
                    let mut bytes = [0; 4096];
                    while let Ok(count) = stderr.read(&mut bytes).await {
                        if count == 0 { break; }
                        let mut state = error_state.lock().unwrap();
                        state.stderr.extend(&bytes[..count]);
                        let excess = state.stderr.len().saturating_sub(STDERR_LIMIT);
                        state.stderr.drain(..excess);
                    }
                });
                let input_state = task_state.clone();
                let input = tokio::spawn(async move {
                    while let Some(message) = rx.recv().await {
                        match message {
                            Input::Write(bytes) => { if stdin.write_all(&bytes).await.is_err() { break; } }
                            Input::Close => { let _ = stdin.shutdown().await; break; }
                        }
                    }
                    input_state.lock().unwrap().input = None;
                });
                let _ = ready_tx.send(Ok(()));
                let (result, stopped) = tokio::select! {
                    status = child.wait() => (status, false),
                    _ = stop_rx.recv() => { let _ = child.start_kill(); (child.wait().await, true) }
                };
                task_state.lock().unwrap().input = None;
                input.abort();
                if stopped { output.abort(); errors.abort(); } else {
                    let mut output = output;
                    let mut errors = errors;
                    tokio::select! { _ = &mut output => {}, _ = stop_rx.recv() => { let _ = child.start_kill(); output.abort(); } }
                    tokio::select! { _ = &mut errors => {}, _ = stop_rx.recv() => { let _ = child.start_kill(); errors.abort(); } }
                }
                task_state.lock().unwrap().exit = Some(ProcessExit { code: result.ok().and_then(|status| status.code()) });
                emit(&weak, &event_window, &event_handle);
            });
        });
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Arc::new(Self {
                window,
                key,
                permission,
                handle,
                cwd: cwd.to_string_lossy().into_owned(),
                scope: Mutex::new(scope),
                services: Mutex::new(BTreeMap::new()),
                state,
                space,
                stop_tx,
                thread: Mutex::new(Some(thread)),
            })),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(_) => {
                let _ = thread.join();
                Err(errors::PROCESS_START_WORKER_STOPPED())
            }
        }
    }
    pub fn stop(&self) {
        self.state.lock().unwrap().input.take();
        let _ = self.stop_tx.send(());
        self.space.notify_waiters();
        if let Some(thread) = self.thread.lock().unwrap().take() {
            let _ = thread.join();
        }
    }
}

fn emit(inner: &Weak<Inner>, window_id: &str, handle: &str) {
    if let Some(inner) = inner.upgrade() {
        inner.emit(&CoreEvent::ProcessReady {
            window_id: window_id.into(),
            handle: handle.into(),
        });
    }
}
