//! 앱 프로토콜을 해석하지 않는 창별 실시간 연결 운반.
// CONN_REALTIME_KIND_UNSUPPORTED는 현재 역직렬화에서 거부하는 종류를 위한 등록 코드다.
pub(crate) mod dispatch;
mod stream;
use crate::{
    app_commands, connections,
    data_runtime::{self, gates},
    Inner,
};
use kaleidoscope_contract::{errors, registry::ConnectionKind, CoreError, FileAccess};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use stream::Running;

const LIMIT_BYTES: usize = 8 * 1024 * 1024;
const LIMIT_COUNT: usize = 256;
const WINDOW_LIMIT: usize = 4;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Message {
    Text(String),
    Binary(Vec<u8>),
    Terminal {
        code: u16,
        reason: String,
        clean: bool,
        error: Option<CoreError>,
    },
}
impl Message {
    fn size(&self) -> usize {
        match self {
            Self::Text(s) => s.len(),
            Self::Binary(b) => b.len(),
            Self::Terminal { .. } => 0,
        }
    }
}
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Packet {
    pub sequence: u64,
    pub message: Message,
}
#[derive(Debug)]
pub(crate) struct Opened {
    pub handle: String,
    pub protocol: Option<String>,
}

struct Session {
    id: String,
    app: String,
    version: u32,
    cooldown: Option<Instant>,
    handles: BTreeMap<String, Arc<Running>>,
}
#[derive(Default)]
pub(crate) struct RealtimeConnections {
    sessions: Mutex<BTreeMap<String, Session>>,
}

fn stop_all(runs: impl IntoIterator<Item = Arc<Running>>) {
    let runs: Vec<_> = runs.into_iter().collect();
    for run in &runs {
        run.cancel();
    }
    for run in runs {
        run.join();
    }
}

fn current(inner: &Inner, window: &str) -> Option<(String, u32)> {
    let state = inner.state.lock().unwrap();
    let item = state.shared.windows.iter().find(|item| item.id == window)?;
    app_commands::definition_for(&state.shared, &item.app_id, item.app_version)?;
    Some((item.app_id.clone(), item.app_version))
}

fn write_permissions(inner: &Inner, window: &str) -> Vec<(String, String)> {
    let state = inner.state.lock().unwrap();
    let Some(item) = state.shared.windows.iter().find(|item| item.id == window) else {
        return Vec::new();
    };
    let Some(definition) =
        app_commands::definition_for(&state.shared, &item.app_id, item.app_version)
    else {
        return Vec::new();
    };
    definition
        .permissions
        .iter()
        .filter_map(|permission| match permission {
            kaleidoscope_contract::PermissionDecl::Connection {
                id,
                connection,
                access: FileAccess::Readwrite,
                ..
            } => Some((id.clone(), connection.clone())),
            _ => None,
        })
        .collect()
}

pub(crate) fn session(inner: &Arc<Inner>, window: &str) -> Result<String, CoreError> {
    let (app, version) = current(inner, window).ok_or_else(errors::CONN_REALTIME_SESSION_STALE)?;
    let id = uuid::Uuid::new_v4().to_string();
    let old = inner.realtime.sessions.lock().unwrap().insert(
        window.into(),
        Session {
            id: id.clone(),
            app,
            version,
            cooldown: None,
            handles: BTreeMap::new(),
        },
    );
    if let Some(old) = old {
        let runs: Vec<_> = old.handles.into_values().collect();
        for run in &runs {
            run.closed(1008);
        }
        stop_all(runs);
    }
    Ok(id)
}

fn same_session(inner: &Inner, window: &str, id: &str) -> bool {
    let Some((app, version)) = current(inner, window) else {
        return false;
    };
    inner
        .realtime
        .sessions
        .lock()
        .unwrap()
        .get(window)
        .is_some_and(|s| s.id == id && s.app == app && s.version == version)
}

/// permission은 호출부가 client.realtime_permissions 검사를 통과시킨 ID다.
pub(crate) fn open(
    inner: &Arc<Inner>,
    window: &str,
    id: &str,
    permission: &str,
    path: &str,
    kind: kaleidoscope_contract::realtime::RealtimeKind,
    protocols: &[String],
) -> Result<Opened, CoreError> {
    let kaleidoscope_contract::realtime::RealtimeKind::Websocket = kind;
    if !same_session(inner, window, id) {
        return Err(errors::CONN_REALTIME_SESSION_STALE());
    }
    let (_, info) =
        connections::authorize_access(inner, window, permission, FileAccess::Readwrite, path)?;
    if info.kind != ConnectionKind::Oauth {
        return Err(errors::CONN_REALTIME_RELAY_UNSUPPORTED(&info.name));
    }
    if !data_runtime::window_visible(inner, window) {
        return Err(errors::CONN_REALTIME_WINDOW_HIDDEN(&info.name));
    }
    if let Some(until) = gates::blocked(&inner.data_runtimes, &info.name) {
        let seconds = (until - chrono::Utc::now()).num_seconds().max(0) as u64 + 1;
        let mut error = errors::CONN_REALTIME_OPEN_RATE_LIMITED(&info.name, seconds);
        error.details.push(format!("retry_after_secs={seconds}"));
        return Err(error);
    }
    let (run, commands, stops) = Running::new(inner, window, id, permission, info.clone());
    {
        let mut sessions = inner.realtime.sessions.lock().unwrap();
        let s = sessions
            .get_mut(window)
            .filter(|s| s.id == id)
            .ok_or_else(errors::CONN_REALTIME_SESSION_STALE)?;
        if s.handles.len() >= WINDOW_LIMIT {
            return Err(errors::CONN_REALTIME_OPEN_LIMIT());
        }
        if s.cooldown.is_some_and(|until| until > Instant::now()) {
            return Err(errors::CONN_REALTIME_OPEN_COOLDOWN(&info.name));
        }
        s.handles.insert(run.handle.clone(), run.clone());
    }
    let receiver = run.launch(inner, path.into(), protocols.to_vec(), commands, stops);
    let result = receiver.recv().unwrap_or_else(|_| {
        Err(errors::CONN_REALTIME_OPEN_UNREACHABLE(
            &info.name,
            "연결 작업이 종료됨",
        ))
    });
    let still_current = same_session(inner, window, id)
        && data_runtime::window_visible(inner, window)
        && connections::find_connection(inner, &info.name).as_ref() == Some(&info)
        && inner
            .realtime
            .sessions
            .lock()
            .unwrap()
            .get(window)
            .is_some_and(|s| {
                s.id == id
                    && s.handles
                        .get(&run.handle)
                        .is_some_and(|r| Arc::ptr_eq(r, &run))
            });
    if !still_current {
        run.stop();
        return Err(errors::CONN_REALTIME_SESSION_STALE());
    }
    match result {
        Ok(protocol) => {
            if let Some(s) = inner
                .realtime
                .sessions
                .lock()
                .unwrap()
                .get_mut(window)
                .filter(|s| s.id == id)
            {
                s.cooldown = None;
            }
            Ok(Opened {
                handle: run.handle.clone(),
                protocol,
            })
        }
        Err(error) => {
            if let Some(s) = inner
                .realtime
                .sessions
                .lock()
                .unwrap()
                .get_mut(window)
                .filter(|s| s.id == id)
            {
                s.handles.remove(&run.handle);
                s.cooldown = Some(Instant::now() + Duration::from_secs(1));
            }
            run.stop();
            Err(error)
        }
    }
}

fn find(inner: &Inner, window: &str, id: &str, handle: &str) -> Result<Arc<Running>, CoreError> {
    let sessions = inner.realtime.sessions.lock().unwrap();
    let s = sessions
        .get(window)
        .filter(|s| s.id == id)
        .ok_or_else(errors::CONN_REALTIME_SESSION_STALE)?;
    s.handles
        .get(handle)
        .cloned()
        .ok_or_else(errors::CONN_REALTIME_HANDLE_MISSING)
}

pub(crate) fn read(
    inner: &Arc<Inner>,
    window: &str,
    id: &str,
    handle: &str,
    after: u64,
) -> Result<Option<Packet>, CoreError> {
    let run = find(inner, window, id, handle)?;
    let mut state = run.state.lock().unwrap();
    let packet = state
        .queue
        .iter()
        .find(|packet| packet.sequence > after)
        .cloned();
    if let Some(packet) = &packet {
        state.delivered = state.delivered.max(packet.sequence);
    }
    Ok(packet)
}

pub(crate) fn ack(
    inner: &Arc<Inner>,
    window: &str,
    id: &str,
    handle: &str,
    through: u64,
) -> Result<(), CoreError> {
    let run = find(inner, window, id, handle)?;
    let mut state = run.state.lock().unwrap();
    if through > state.delivered {
        return Err(errors::CONN_REALTIME_ACK_INVALID(&run.info.name));
    }
    let mut ended = false;
    while state.queue.front().is_some_and(|p| p.sequence <= through) {
        let packet = state.queue.pop_front().unwrap();
        state.bytes -= packet.message.size();
        ended |= matches!(packet.message, Message::Terminal { .. });
    }
    let mut ready = false;
    if state.queue.len() < LIMIT_COUNT {
        if let Some(packet) = state.pending_terminal.take() {
            state.queue.push_back(packet);
            ready = true;
        }
    }
    drop(state);
    run.space.notify_one();
    if ready {
        run.ready();
    }
    if ended {
        if let Some(s) = inner
            .realtime
            .sessions
            .lock()
            .unwrap()
            .get_mut(window)
            .filter(|s| s.id == id)
        {
            s.handles.remove(handle);
        }
        run.stop();
    }
    Ok(())
}

pub(crate) fn send(
    inner: &Arc<Inner>,
    window: &str,
    id: &str,
    handle: &str,
    message: Message,
) -> Result<(), CoreError> {
    find(inner, window, id, handle)?.send(message)
}
pub(crate) fn close(
    inner: &Arc<Inner>,
    window: &str,
    id: &str,
    handle: &str,
    code: Option<u16>,
    reason: String,
) -> Result<(), CoreError> {
    find(inner, window, id, handle)?.close(code, reason)
}
pub(crate) fn release(inner: &Arc<Inner>, window: &str, id: &str) {
    let mut sessions = inner.realtime.sessions.lock().unwrap();
    let removed = if sessions.get(window).is_some_and(|s| s.id == id) {
        sessions.remove(window)
    } else {
        None
    };
    drop(sessions);
    if let Some(s) = removed {
        stop_all(s.handles.into_values());
    }
}

pub(crate) fn state_changed(inner: &Arc<Inner>) {
    let ids: Vec<_> = inner
        .realtime
        .sessions
        .lock()
        .unwrap()
        .iter()
        .map(|(window, s)| (window.clone(), s.id.clone(), s.app.clone(), s.version))
        .collect();
    let connections = inner.connections.lock().unwrap().clone();
    let mut stopped = Vec::new();
    for (window, id, app, version) in ids {
        let current = current(inner, &window);
        let visible = data_runtime::window_visible(inner, &window);
        let permissions = write_permissions(inner, &window);
        let mut sessions = inner.realtime.sessions.lock().unwrap();
        if !sessions.get(&window).is_some_and(|s| s.id == id) {
            continue;
        }
        if current.as_ref() != Some(&(app, version)) {
            stopped.extend(
                sessions
                    .remove(&window)
                    .unwrap()
                    .handles
                    .into_values()
                    .map(|run| (run, 1008)),
            );
        } else {
            let s = sessions.get_mut(&window).unwrap();
            if !visible {
                stopped.extend(
                    std::mem::take(&mut s.handles)
                        .into_values()
                        .map(|run| (run, 1001)),
                );
                s.cooldown = None;
            } else {
                let changed: Vec<_> = s
                    .handles
                    .iter()
                    .filter(|(_, run)| {
                        !connections.contains(&run.info)
                            || !permissions
                                .iter()
                                .any(|(id, name)| id == &run.permission && name == &run.info.name)
                    })
                    .map(|(key, _)| key.clone())
                    .collect();
                for key in changed {
                    stopped.push((s.handles.remove(&key).unwrap(), 1008));
                }
            }
        }
    }
    for (run, code) in &stopped {
        run.closed(*code);
    }
    stop_all(stopped.into_iter().map(|(run, _)| run));
}

pub(crate) fn shutdown_sessions(inner: &Arc<Inner>) {
    let sessions = std::mem::take(&mut *inner.realtime.sessions.lock().unwrap());
    let runs: Vec<_> = sessions
        .into_values()
        .flat_map(|s| s.handles.into_values())
        .collect();
    for run in &runs {
        run.closed(1008);
    }
    stop_all(runs);
}
