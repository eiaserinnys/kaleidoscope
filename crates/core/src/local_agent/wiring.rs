//! 창 수명과 실행기의 소유권을 연결한다.
mod commands;
use super::{context, PromptInput, WorkerHandle};
use crate::{data_runtime, error, share, storage, Inner};
use base64::{engine::general_purpose::STANDARD, Engine};
pub(crate) use commands::handle;
use kaleidoscope_contract::{
    local_agent::{LocalAgentAccess, LocalAgentPhase, LocalAgentSnapshot, LocalAgentUpdate},
    CoreError, CoreEvent, CoreReply, CoreRequest, ErrorCode,
};
use std::{
    collections::{HashMap, HashSet},
    sync::{mpsc, Arc, Mutex, Weak},
};
use uuid::Uuid;

type Worker = Arc<Mutex<WorkerHandle>>;
struct Controller {
    generation: String,
    version: u32,
    worker: Option<Worker>,
    fingerprint: Option<context::Fingerprint>,
    attached: bool,
    pending_mcp: bool,
    snapshot: Option<LocalAgentSnapshot>,
}
impl Controller {
    fn new() -> Self {
        Self {
            generation: Uuid::new_v4().to_string(),
            version: 0,
            worker: None,
            fingerprint: None,
            attached: true,
            pending_mcp: false,
            snapshot: None,
        }
    }
}
type Event = (String, String, LocalAgentUpdate);
pub(crate) struct LocalAgents {
    windows: Mutex<HashMap<String, Controller>>,
    known_windows: Mutex<HashSet<String>>,
    gate: Mutex<()>,
    events: mpsc::Sender<Event>,
    receiver: Mutex<Option<mpsc::Receiver<Event>>>,
}
impl Default for LocalAgents {
    fn default() -> Self {
        let (events, receiver) = mpsc::channel();
        Self {
            windows: Mutex::new(HashMap::new()),
            known_windows: Mutex::new(HashSet::new()),
            gate: Mutex::new(()),
            events,
            receiver: Mutex::new(Some(receiver)),
        }
    }
}

pub(crate) fn start_events(inner: &Arc<Inner>) {
    *inner.local_agents.known_windows.lock().unwrap() = inner
        .state
        .lock()
        .unwrap()
        .shared
        .windows
        .iter()
        .map(|w| w.id.clone())
        .collect();
    let receiver = inner.local_agents.receiver.lock().unwrap().take().unwrap();
    let owner: Weak<Inner> = Arc::downgrade(inner);
    std::thread::spawn(move || {
        while let Ok((window, generation, update)) = receiver.recv() {
            let Some(inner) = owner.upgrade() else { break };
            let (current, attached, pending) = {
                let windows = inner.local_agents.windows.lock().unwrap();
                let Some(controller) = windows.get(&window) else {
                    continue;
                };
                (
                    controller.generation == generation,
                    controller.attached,
                    controller.pending_mcp,
                )
            };
            if !current {
                continue;
            }
            if attached {
                inner.emit(&CoreEvent::LocalAgentUpdate {
                    window_id: window.clone(),
                    generation,
                    update: update.clone(),
                });
            }
            if pending
                && matches!(
                    update,
                    LocalAgentUpdate::State {
                        phase: LocalAgentPhase::Ready,
                        ..
                    }
                )
            {
                reconcile(&inner, &window);
            }
        }
    });
}

fn merged(
    ctx: &context::Context,
    worker: Option<&Worker>,
    previous: Option<&LocalAgentSnapshot>,
) -> LocalAgentSnapshot {
    let mut result = match worker {
        Some(worker) => worker.lock().unwrap().snapshot(),
        None => ctx.snapshot.clone(),
    };
    result.agents = if worker.is_some() && ctx.binding_pending && ctx.snapshot.agents.is_empty() {
        previous
            .map(|snapshot| snapshot.agents.clone())
            .unwrap_or_default()
    } else {
        ctx.snapshot.agents.clone()
    };
    result.selected = ctx.snapshot.selected.clone();
    result.folder_name = ctx.snapshot.folder_name.clone();
    if worker.is_some() {
        result.execution = None;
    }
    result
}

fn reconcile(inner: &Arc<Inner>, window: &str) {
    let guard = inner.local_agents.gate.lock().unwrap();
    let (generation, version) = {
        let windows = inner.local_agents.windows.lock().unwrap();
        let Some(c) = windows.get(window) else { return };
        (c.generation.clone(), c.version)
    };
    let current_version = {
        let state = inner.state.lock().unwrap();
        state
            .shared
            .windows
            .iter()
            .find(|w| w.id == window)
            .map(|w| w.app_version)
    };
    if current_version.is_none() {
        let controller = inner.local_agents.windows.lock().unwrap().remove(window);
        drop(controller);
        super::delete_record(&context::record_dir(inner, window));
        return;
    }
    if current_version != Some(version) {
        if data_runtime::attach(inner, window).is_err() {
            return;
        }
        if let Some(c) = inner.local_agents.windows.lock().unwrap().get_mut(window) {
            c.version = current_version.unwrap();
        }
    }
    let resolved = context::resolve(inner, window, &generation);
    let ctx = match resolved {
        Ok(Some(ctx)) => ctx,
        Ok(None) => {
            let worker = {
                let mut windows = inner.local_agents.windows.lock().unwrap();
                let Some(c) = windows.get_mut(window) else {
                    return;
                };
                c.fingerprint = None;
                c.snapshot = None;
                c.worker.take()
            };
            drop(worker);
            return;
        }
        Err(_) => return,
    };
    // 명세를 못 읽어도 선택·폴더·블록·권한이 달라졌으면 이전 실행을 끝낸다.
    let binding_pending = ctx.binding_pending;
    let mut windows = inner.local_agents.windows.lock().unwrap();
    let Some(c) = windows.get_mut(window) else {
        return;
    };
    if binding_pending && c.worker.is_some() {
        let same_selection = c
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.selected.as_deref())
            == ctx.snapshot.selected.as_deref();
        let same_scope = c.fingerprint.as_ref().is_some_and(|old| {
            Some(&old.cwd) == ctx.cwd.as_ref() && old.block_scope == ctx.block_scope
        });
        if same_selection && same_scope {
            return;
        }
    }
    let change = match (&c.fingerprint, &ctx.fingerprint) {
        (Some(old), Some(new))
            if old.spec_hash == new.spec_hash
                && old.cwd == new.cwd
                && old.block_scope == new.block_scope =>
        {
            if old.mcp != new.mcp {
                let ready = c
                    .worker
                    .as_ref()
                    .is_some_and(|w| w.lock().unwrap().snapshot().phase == LocalAgentPhase::Ready);
                if !ready {
                    c.pending_mcp = true;
                    false
                } else {
                    true
                }
            } else {
                c.pending_mcp = false;
                false
            }
        }
        (None, None) => false,
        _ => true,
    };
    let old = if change {
        c.fingerprint = None;
        c.pending_mcp = false;
        let old = c.worker.take();
        if old.is_some() {
            c.generation = Uuid::new_v4().to_string();
        }
        old
    } else {
        None
    };
    drop(windows);
    drop(old);
    let mut windows = inner.local_agents.windows.lock().unwrap();
    let Some(c) = windows.get_mut(window) else {
        return;
    };
    if c.worker.is_none() {
        if let (Some(mut config), Some(fingerprint)) = (ctx.config.clone(), ctx.fingerprint.clone())
        {
            c.generation = Uuid::new_v4().to_string();
            config.generation = c.generation.clone();
            let tx = inner.local_agents.events.clone();
            let id = window.to_string();
            let generation = c.generation.clone();
            let worker = WorkerHandle::start(
                config,
                Arc::new(move |update| {
                    let _ = tx.send((id.clone(), generation.clone(), update));
                }),
            );
            c.worker = Some(Arc::new(Mutex::new(worker)));
            c.fingerprint = Some(fingerprint);
        }
    }
    let mut snapshot = merged(&ctx, c.worker.as_ref(), c.snapshot.as_ref());
    snapshot.generation = c.generation.clone();
    let changed = c.snapshot.as_ref() != Some(&snapshot);
    c.snapshot = Some(snapshot.clone());
    let attached = c.attached;
    drop(windows);
    drop(guard);
    if changed && attached {
        inner.emit(&CoreEvent::LocalAgentUpdate {
            window_id: window.into(),
            generation: snapshot.generation.clone(),
            update: LocalAgentUpdate::Snapshot { snapshot },
        });
    }
}

pub(crate) fn server_changed(inner: &Arc<Inner>) {
    shutdown(inner);
    inner.local_agents.known_windows.lock().unwrap().clear();
}
pub(crate) fn state_changed(inner: &Arc<Inner>) {
    let live: HashSet<_> = inner
        .state
        .lock()
        .unwrap()
        .shared
        .windows
        .iter()
        .map(|w| w.id.clone())
        .collect();
    let removed: Vec<_> = {
        let mut known = inner.local_agents.known_windows.lock().unwrap();
        let removed = known.difference(&live).cloned().collect();
        *known = live;
        removed
    };
    let ids: Vec<_> = inner
        .local_agents
        .windows
        .lock()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    for id in ids {
        reconcile(inner, &id);
    }
    for id in removed {
        super::delete_record(&context::record_dir(inner, &id));
    }
}
pub(crate) fn data_changed(inner: &Arc<Inner>, window: &str) {
    reconcile(inner, window);
}
pub(crate) fn shutdown(inner: &Inner) {
    let _guard = inner.local_agents.gate.lock().unwrap();
    let controllers = std::mem::take(&mut *inner.local_agents.windows.lock().unwrap());
    drop(controllers);
}

fn worker(inner: &Inner, window: &str, generation: &str) -> Result<Worker, CoreError> {
    let windows = inner.local_agents.windows.lock().unwrap();
    let c = windows
        .get(window)
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
    if c.generation != generation {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    c.worker
        .clone()
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))
}
