use std::io::BufRead;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use chrono::{DateTime, Utc};
use kaleidoscope_contract::registry::{
    DeviceEvent, DeviceUploadRequest, PairPollReply, PairPollRequest, PairStartRequest,
};
use kaleidoscope_contract::{CoreError, CoreEvent, CoreReply, ErrorCode, LinkStatus};

use crate::app_commands;
use crate::error;
use crate::registry_client::{parse_event_line, RegistryError};
use crate::storage::{self, LinkFile};
use crate::{snapshot, Inner};

const NOT_CONNECTED_MESSAGE: &str =
    "kaleidoscope 서버에 연결되어 있지 않아 앱을 가져올 수 없습니다.";

pub(crate) fn registry_error_to_core(error: RegistryError, message: &str) -> CoreError {
    match error {
        RegistryError::Validation(error) => error,
        RegistryError::Failure(detail) => CoreError {
            code: ErrorCode::Server,
            message: message.into(),
            details: vec![one_line(&detail)],
        },
        RegistryError::Unauthorized => server_error("기기 연결이 거부되었습니다.", Vec::new()),
        RegistryError::NotFound => server_error("연결 코드를 찾을 수 없습니다.", Vec::new()),
    }
}

fn server_error(message: &str, details: Vec<String>) -> CoreError {
    CoreError {
        code: ErrorCode::Server,
        message: message.into(),
        details,
    }
}

fn one_line(message: &str) -> String {
    message.lines().next().unwrap_or(message).trim().to_string()
}

pub(crate) fn start(inner: &Arc<Inner>) -> Result<CoreReply, CoreError> {
    let generation = {
        let state = inner.state.lock().unwrap();
        if matches!(
            &state.link,
            LinkStatus::Connected { .. } | LinkStatus::Offline { .. }
        ) {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        inner.generation.fetch_add(1, Ordering::SeqCst) + 1
    };

    let server_url = inner.server_url.clone();
    let reply = inner
        .registry
        .pair_start(
            &server_url,
            &PairStartRequest {
                device_name: inner.device_name.clone(),
            },
        )
        .map_err(|error| {
            let detail = match error {
                RegistryError::Failure(detail) => vec![one_line(&detail)],
                RegistryError::Unauthorized => vec!["HTTP 401".into()],
                RegistryError::NotFound => vec!["HTTP 404".into()],
                RegistryError::Validation(error) => vec![error.message],
            };
            server_error("kaleidoscope 서버에 닿지 않습니다", detail)
        })?;

    let pairing = LinkStatus::Pairing {
        server_url: server_url.clone(),
        user_code: reply.user_code.clone(),
        expires_at: reply.expires_at.clone(),
    };
    let (current, changed) = {
        let mut state = inner.state.lock().unwrap();
        if inner.generation.load(Ordering::SeqCst) == generation {
            (true, set_link_locked(&mut state, pairing))
        } else {
            (false, false)
        }
    };
    if changed {
        emit_state(inner);
    }
    if current {
        let inner = Arc::clone(inner);
        let poll_reply = reply.clone();
        thread::Builder::new()
            .name("kaleidoscope-pairing".into())
            .spawn(move || poll_pairing(inner, generation, server_url, poll_reply))
            .expect("pairing thread can be started");
    }

    Ok(CoreReply::LinkStart {
        user_code: reply.user_code,
        expires_at: reply.expires_at,
    })
}

pub(crate) fn cancel(inner: &Arc<Inner>) -> Result<CoreReply, CoreError> {
    let changed = {
        let mut state = inner.state.lock().unwrap();
        if !matches!(&state.link, LinkStatus::Pairing { .. }) {
            false
        } else {
            inner.generation.fetch_add(1, Ordering::SeqCst);
            set_link_locked(&mut state, LinkStatus::Unlinked {})
        }
    };
    if changed {
        emit_state(inner);
    }
    Ok(CoreReply::LinkCancel {})
}

pub(crate) fn unlink(inner: &Arc<Inner>) -> Result<CoreReply, CoreError> {
    inner.generation.fetch_add(1, Ordering::SeqCst);
    storage::remove_link(&inner.data_dir)?;
    *inner.link_file.lock().unwrap() = None;
    let changed = {
        let mut state = inner.state.lock().unwrap();
        set_link_locked(&mut state, LinkStatus::Unlinked {})
    };
    if changed {
        emit_state(inner);
    }
    Ok(CoreReply::LinkUnlink {})
}

pub(crate) fn import_app(
    inner: &Arc<Inner>,
    definition_json: String,
) -> Result<CoreReply, CoreError> {
    let (status, link_file) = {
        let state = inner.state.lock().unwrap();
        (state.link.clone(), inner.link_file.lock().unwrap().clone())
    };
    match status {
        LinkStatus::Unlinked {} => {
            let (reply, event) =
                apply_registry_change(inner, |state| app_commands::import(state, definition_json))?;
            let reply = reply?;
            if let Some(event) = event {
                inner.emit(&event);
            }
            Ok(reply)
        }
        LinkStatus::Connected { .. } => {
            let Some(link_file) = link_file else {
                return Err(server_error(NOT_CONNECTED_MESSAGE, Vec::new()));
            };
            let received = inner.registry.upload(
                &link_file.server_url,
                &link_file.token,
                &DeviceUploadRequest { definition_json },
            );
            let received = match received {
                Ok(received) => received,
                Err(RegistryError::Unauthorized) => {
                    token_rejected(inner, link_file);
                    return Err(server_error("기기 연결이 거부되었습니다.", Vec::new()));
                }
                Err(RegistryError::Validation(error)) => return Err(error),
                Err(error) => {
                    return Err(registry_error_to_core(
                        error,
                        "kaleidoscope 서버에 닿지 않습니다",
                    ))
                }
            };
            let reply = CoreReply::AppImport {
                app: received.app.clone(),
                version: received.version.clone(),
            };
            let (_, event) = apply_registry_change(inner, |state| {
                app_commands::import_registry(state, received)
            })?;
            if let Some(event) = event {
                inner.emit(&event);
            }
            Ok(reply)
        }
        LinkStatus::Pairing { .. } | LinkStatus::Offline { .. } | LinkStatus::Revoked { .. } => {
            Err(server_error(NOT_CONNECTED_MESSAGE, Vec::new()))
        }
    }
}

fn poll_pairing(
    inner: Arc<Inner>,
    generation: u64,
    server_url: String,
    reply: kaleidoscope_contract::registry::PairStartReply,
) {
    let poll = PairPollRequest {
        device_code: reply.device_code,
    };
    loop {
        if !is_current(&inner, generation) {
            return;
        }
        match inner.registry.pair_poll(&server_url, &poll) {
            Ok(PairPollReply::Approved { device_id, token }) => {
                let file = LinkFile {
                    format: 1,
                    server_url: server_url.clone(),
                    device_id,
                    device_name: inner.device_name.clone(),
                    token,
                };
                let status = LinkStatus::Offline {
                    server_url: server_url.clone(),
                    device_name: file.device_name.clone(),
                    reason: "연결하는 중".into(),
                };
                let (saved, changed) = {
                    let mut state = inner.state.lock().unwrap();
                    if inner.generation.load(Ordering::SeqCst) != generation {
                        (false, false)
                    } else if storage::save_link(&inner.data_dir, &file).is_err() {
                        (false, set_link_locked(&mut state, LinkStatus::Unlinked {}))
                    } else {
                        *inner.link_file.lock().unwrap() = Some(file.clone());
                        (true, set_link_locked(&mut state, status))
                    }
                };
                if changed {
                    emit_state(&inner);
                }
                if saved && is_current(&inner, generation) {
                    run_stream(inner, generation, file);
                }
                return;
            }
            Ok(PairPollReply::Pending {}) => {
                if expired(&reply.expires_at) {
                    set_unlinked_if_current(&inner, generation);
                    return;
                }
            }
            Err(RegistryError::NotFound) => {
                set_unlinked_if_current(&inner, generation);
                return;
            }
            Err(_) if expired(&reply.expires_at) => {
                set_unlinked_if_current(&inner, generation);
                return;
            }
            Err(_) => {}
        }
        thread::sleep(Duration::from_secs(u64::from(reply.interval_secs)));
    }
}

fn expired(expires_at: &str) -> bool {
    DateTime::parse_from_rfc3339(expires_at)
        .map(|expires| Utc::now() >= expires.with_timezone(&Utc))
        .unwrap_or(true)
}

fn set_unlinked_if_current(inner: &Arc<Inner>, generation: u64) {
    let changed = {
        let mut state = inner.state.lock().unwrap();
        if inner.generation.load(Ordering::SeqCst) == generation {
            set_link_locked(&mut state, LinkStatus::Unlinked {})
        } else {
            false
        }
    };
    if changed {
        emit_state(inner);
    }
}

pub(crate) fn start_stream(inner: Arc<Inner>, generation: u64, file: LinkFile) {
    thread::Builder::new()
        .name("kaleidoscope-registry-events".into())
        .spawn(move || run_stream(inner, generation, file))
        .expect("registry event thread can be started");
}

fn run_stream(inner: Arc<Inner>, generation: u64, file: LinkFile) {
    let mut delay = 1u64;
    loop {
        if !is_current(&inner, generation) {
            return;
        }
        let stream = inner.registry.open_events(&file.server_url, &file.token);
        let mut reader = match stream {
            Ok(reader) => reader,
            Err(RegistryError::Unauthorized) => {
                token_rejected(&inner, file);
                return;
            }
            Err(error) => {
                set_offline(&inner, generation, &file, registry_failure_line(error));
                if !wait_before_retry(&inner, generation, delay) {
                    return;
                }
                delay = (delay * 2).min(30);
                continue;
            }
        };

        let mut line = String::new();
        loop {
            if !is_current(&inner, generation) {
                return;
            }
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    set_offline(&inner, generation, &file, "연결이 끊겼습니다".into());
                    break;
                }
                Ok(_) => {
                    let Some(event) = parse_event_line(&line) else {
                        continue;
                    };
                    if matches!(event, DeviceEvent::AppsSnapshot { .. }) {
                        delay = 1;
                    }
                    if !apply_event(&inner, generation, event) {
                        return;
                    }
                }
                Err(error) => {
                    set_offline(&inner, generation, &file, one_line(&error.to_string()));
                    break;
                }
            }
        }
        if !is_current(&inner, generation) {
            return;
        }
        if !wait_before_retry(&inner, generation, delay) {
            return;
        }
        delay = (delay * 2).min(30);
    }
}

fn apply_event(inner: &Arc<Inner>, generation: u64, event: DeviceEvent) -> bool {
    if !is_current(inner, generation) {
        return false;
    }
    match event {
        DeviceEvent::AppsSnapshot { apps } => {
            let link = inner.link_file.lock().unwrap().clone();
            let result = apply_registry_change(inner, |state| {
                if inner.generation.load(Ordering::SeqCst) != generation {
                    return None;
                }
                for app in apps {
                    app_commands::import_registry(state, app);
                }
                let status = LinkStatus::Connected {
                    server_url: link
                        .as_ref()
                        .map(|link| link.server_url.clone())
                        .unwrap_or_default(),
                    device_name: link
                        .as_ref()
                        .map(|link| link.device_name.clone())
                        .unwrap_or_default(),
                };
                set_link_locked(state, status);
                Some(())
            });
            let (applied, event) = match result {
                Ok(result) => result,
                Err(error) => {
                    set_offline(inner, generation, &load_link(inner), error.message);
                    return true;
                }
            };
            if applied.is_none() {
                return false;
            }
            if let Some(event) = event {
                inner.emit(&event);
            }
        }
        DeviceEvent::AppPublished { app, open, .. } => {
            let result = apply_registry_change(inner, |state| {
                if inner.generation.load(Ordering::SeqCst) != generation {
                    return None;
                }
                app_commands::import_registry(state, app.clone());
                Some(())
            });
            let (applied, event) = match result {
                Ok(result) => result,
                Err(error) => {
                    set_offline(inner, generation, &load_link(inner), error.message);
                    return true;
                }
            };
            if applied.is_none() {
                return false;
            }
            if let Some(event) = event {
                inner.emit(&event);
            }
            if open {
                inner.emit(&CoreEvent::AppOpenRequested {
                    app_id: app.app.id,
                    workspace_id: None,
                });
            }
        }
        DeviceEvent::AppOpen { app_id, .. } => {
            let exists = inner
                .state
                .lock()
                .unwrap()
                .shared
                .apps
                .iter()
                .any(|app| app.id == app_id);
            if exists {
                inner.emit(&CoreEvent::AppOpenRequested {
                    app_id,
                    workspace_id: None,
                });
            }
        }
        // 워크스페이스 PAS 중계와 workspace_id로 겨눈 띄우기는 다음 PR(코어의 PAS 연결)에서 구현한다.
        DeviceEvent::AgentUpdate { .. } => {}
    }
    is_current(inner, generation)
}

fn load_link(inner: &Inner) -> LinkFile {
    inner.link_file.lock().unwrap().as_ref().unwrap().clone()
}

fn apply_registry_change<T>(
    inner: &Inner,
    update: impl FnOnce(&mut crate::CoreState) -> T,
) -> Result<(T, Option<CoreEvent>), CoreError> {
    let mut state = inner.state.lock().unwrap();
    let before = state.clone();
    let result = update(&mut state);
    let shared_changed = before.shared != state.shared;
    let device_changed = before.device != state.device;
    let link_changed = before.link != state.link;

    if shared_changed || device_changed {
        if let Err(error) = storage::save_changed_state(
            &inner.data_dir,
            &state.shared,
            &state.device,
            shared_changed,
            device_changed,
        ) {
            *state = before;
            return Err(error);
        }
    }

    let event =
        (shared_changed || device_changed || link_changed).then(|| CoreEvent::StateChanged {
            snapshot: snapshot(&state),
        });
    Ok((result, event))
}

fn set_offline(inner: &Arc<Inner>, generation: u64, file: &LinkFile, reason: String) {
    let changed = {
        let mut state = inner.state.lock().unwrap();
        if inner.generation.load(Ordering::SeqCst) != generation {
            false
        } else {
            set_link_locked(
                &mut state,
                LinkStatus::Offline {
                    server_url: file.server_url.clone(),
                    device_name: file.device_name.clone(),
                    reason: one_line(&reason),
                },
            )
        }
    };
    if changed {
        emit_state(inner);
    }
}

fn token_rejected(inner: &Arc<Inner>, file: LinkFile) {
    let changed = {
        let mut state = inner.state.lock().unwrap();
        if inner
            .link_file
            .lock()
            .unwrap()
            .as_ref()
            .map_or(true, |current| current.token != file.token)
        {
            return;
        }
        inner.generation.fetch_add(1, Ordering::SeqCst);
        if let Err(error) = storage::remove_link(&inner.data_dir) {
            eprintln!("연결 파일을 지울 수 없습니다: {}", error.message);
        }
        *inner.link_file.lock().unwrap() = None;
        set_link_locked(
            &mut state,
            LinkStatus::Revoked {
                server_url: file.server_url,
            },
        )
    };
    if changed {
        emit_state(inner);
    }
}

fn wait_before_retry(inner: &Inner, generation: u64, seconds: u64) -> bool {
    for _ in 0..seconds {
        if !is_current(inner, generation) {
            return false;
        }
        thread::sleep(Duration::from_secs(1));
    }
    is_current(inner, generation)
}

fn is_current(inner: &Inner, generation: u64) -> bool {
    inner.generation.load(Ordering::SeqCst) == generation
}

fn set_link_locked(state: &mut crate::CoreState, status: LinkStatus) -> bool {
    if state.link == status {
        return false;
    }
    state.link = status;
    true
}

fn emit_state(inner: &Inner) {
    let event = {
        let state = inner.state.lock().unwrap();
        CoreEvent::StateChanged {
            snapshot: snapshot(&state),
        }
    };
    inner.emit(&event);
}

fn registry_failure_line(error: RegistryError) -> String {
    match error {
        RegistryError::Failure(message) => one_line(&message),
        RegistryError::Unauthorized => "기기 연결이 거부되었습니다".into(),
        RegistryError::NotFound => "연결 정보를 찾을 수 없습니다".into(),
        RegistryError::Validation(error) => one_line(&error.message),
    }
}
