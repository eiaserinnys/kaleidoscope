use std::io::BufRead;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use chrono::{DateTime, Utc};
use kaleidoscope_contract::registry::{
    DeviceEvent, DeviceUploadRequest, PairPollReply, PairPollRequest, PairStartRequest,
};
use kaleidoscope_contract::{errors, CoreError, CoreReply, ErrorCode, LinkStatus};

use crate::app_commands;
use crate::registry_client::{parse_event_line, FailureStage, RegistryError};
use crate::registry_events;
use crate::storage::{self, LinkFile};
use crate::Inner;

pub(crate) fn start(
    inner: &Arc<Inner>,
    requested_url: Option<String>,
) -> Result<CoreReply, CoreError> {
    let server_url = requested_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| inner.server_url.clone());
    let server_url = server_url.trim().trim_end_matches('/').to_string();
    if server_url.is_empty() {
        return Err(errors::CONN_LINK_START_URL_INVALID());
    }
    let url =
        reqwest::Url::parse(&server_url).map_err(|_| errors::CONN_LINK_START_URL_INVALID())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(errors::CONN_LINK_START_URL_INVALID());
    }
    if let Some(file) = crate::server_switch::saved_remote(inner, &server_url)? {
        let generation = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        crate::server_switch::activate(inner, file.clone(), generation)?;
        start_stream(inner.clone(), generation, file);
        return Ok(CoreReply::LinkStart {
            user_code: String::new(),
            expires_at: Utc::now().to_rfc3339(),
        });
    }
    let reply = inner
        .registry
        .pair_start(
            &server_url,
            &PairStartRequest {
                device_name: inner.device_name.clone(),
            },
        )
        .map_err(|error| {
            let host = url.host_str().unwrap_or("알 수 없는 서버");
            match error {
                RegistryError::Validation(mut error) => {
                    error.code = ErrorCode::Server;
                    error
                }
                RegistryError::Unauthorized => {
                    let mut error = errors::CONN_LINK_START_REJECTED(host);
                    error.details = vec![format!("HTTP 401; host={host}")];
                    error
                }
                RegistryError::NotFound => {
                    let mut error = errors::CONN_LINK_START_REJECTED(host);
                    error.details = vec![format!("HTTP 404; host={host}")];
                    error
                }
                RegistryError::Failure { stage, detail } => {
                    let mut error = match stage {
                        crate::registry_client::FailureStage::Send => {
                            errors::CONN_LINK_START_UNREACHABLE(host)
                        }
                        crate::registry_client::FailureStage::Status => {
                            errors::CONN_LINK_START_REJECTED(host)
                        }
                        crate::registry_client::FailureStage::Read => {
                            errors::CONN_LINK_START_RESPONSE_READ_FAILED(host)
                        }
                    };
                    error.details = vec![detail];
                    error
                }
            }
        })?;

    let generation = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let pairing = LinkStatus::Pairing {
        server_url: server_url.clone(),
        user_code: reply.user_code.clone(),
        expires_at: reply.expires_at.clone(),
    };
    let (current, changed) = {
        let mut state = inner.state.lock().unwrap();
        if inner.generation.load(Ordering::SeqCst) == generation {
            inner.link_connecting.store(false, Ordering::SeqCst);
            (true, set_link_locked(&mut state, pairing))
        } else {
            (false, false)
        }
    };
    if changed {
        inner.layout_signal.notify();
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
    if inner.embedded_server.is_some() {
        crate::server_switch::use_local(inner)?;
        return Ok(CoreReply::LinkCancel {});
    }
    let changed = {
        let mut state = inner.state.lock().unwrap();
        if !matches!(&state.link, LinkStatus::Pairing { .. }) {
            false
        } else {
            inner.generation.fetch_add(1, Ordering::SeqCst);
            inner.link_connecting.store(false, Ordering::SeqCst);
            set_link_locked(&mut state, LinkStatus::Unlinked {})
        }
    };
    if changed {
        inner.layout_signal.notify();
        emit_state(inner);
    }
    Ok(CoreReply::LinkCancel {})
}

pub(crate) fn unlink(inner: &Arc<Inner>) -> Result<CoreReply, CoreError> {
    if inner.embedded_server.is_some() {
        crate::server_switch::use_local(inner)?;
        return Ok(CoreReply::LinkUnlink {});
    }
    crate::share::clear_server_before_unlink(inner);
    let previous_scope = crate::server_switch::active_archive(inner);
    crate::process_host::server_changed(inner);
    crate::client_services::server_changed(inner);
    let changed = {
        let mut state = inner.state.lock().unwrap();
        inner.generation.fetch_add(1, Ordering::SeqCst);
        storage::remove_link(&inner.data_dir)?;
        inner.flusher.clear_sync();
        crate::sync_state::remove(&inner.data_dir)?;
        *inner.link_file.lock().unwrap() = None;
        state.sync = Default::default();
        inner.link_connecting.store(false, Ordering::SeqCst);
        set_link_locked(&mut state, LinkStatus::Unlinked {})
    };
    crate::process_host::rebind_unlinked(inner, &previous_scope);
    if changed {
        inner.layout_signal.notify();
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
            let (reply, event) = registry_events::apply_registry_change(inner, |state| {
                app_commands::import(state, definition_json)
            })?;
            let reply = reply?;
            if let Some(event) = event {
                inner.emit_state(&event);
            }
            Ok(reply)
        }
        LinkStatus::Connected { .. }
        | LinkStatus::Offline {
            mode: kaleidoscope_contract::ServerMode::Embedded,
            ..
        } => {
            let Some(link_file) = link_file else {
                return Err(kaleidoscope_contract::errors::APP_IMPORT_SERVER_NOT_CONNECTED());
            };
            let host = reqwest::Url::parse(&link_file.server_url)
                .ok()
                .and_then(|url| url.host_str().map(str::to_owned))
                .unwrap_or_else(|| "알 수 없는 서버".into());
            let received = inner.registry.upload(
                &link_file.server_url,
                &link_file.token,
                &DeviceUploadRequest { definition_json },
            );
            let received = match received {
                Ok(received) => received,
                Err(RegistryError::Unauthorized) => {
                    token_rejected(inner, link_file);
                    let mut error = errors::CONN_LINK_IMPORT_UNAUTHORIZED(&host);
                    error.details = vec![format!("HTTP 401; host={host}")];
                    return Err(error);
                }
                Err(RegistryError::Validation(error)) => return Err(error),
                Err(RegistryError::NotFound) => {
                    return Err(errors::CONN_LINK_IMPORT_NOT_FOUND(&host));
                }
                Err(RegistryError::Failure { stage, detail }) => {
                    let mut error = match stage {
                        crate::registry_client::FailureStage::Send => {
                            errors::CONN_LINK_IMPORT_UNREACHABLE(&host)
                        }
                        crate::registry_client::FailureStage::Status => {
                            errors::CONN_LINK_IMPORT_REJECTED(&host)
                        }
                        crate::registry_client::FailureStage::Read => {
                            errors::CONN_LINK_IMPORT_RESPONSE_READ_FAILED(&host)
                        }
                    };
                    error.details = vec![detail];
                    return Err(error);
                }
            };
            let reply = CoreReply::AppImport {
                app: received.app.clone(),
                version: received.version.clone(),
            };
            let (_, event) = registry_events::apply_registry_change(inner, |state| {
                app_commands::import_registry(state, received)
            })?;
            if let Some(event) = event {
                inner.emit_state(&event);
            }
            Ok(reply)
        }
        LinkStatus::Pairing { .. } | LinkStatus::Offline { .. } | LinkStatus::Revoked { .. } => {
            Err(kaleidoscope_contract::errors::APP_IMPORT_SERVER_NOT_CONNECTED())
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
                    revoked: false,
                    mode: kaleidoscope_contract::ServerMode::Remote,
                    format: 1,
                    server_url: server_url.clone(),
                    device_id,
                    device_name: inner.device_name.clone(),
                    token,
                };
                if let Err(e) = crate::server_switch::activate(&inner, file.clone(), generation) {
                    eprintln!("서버 전환 실패: {}", e.message);
                    return;
                }
                if inner.embedded_server.is_some() {
                    match crate::server_switch::sync(&inner) {
                        Ok(_) => (),
                        Err(e) => {
                            inner.state.lock().unwrap().transfer_error = Some(e.message);
                            emit_state(&inner);
                        }
                    }
                }
                if is_current(&inner, generation) {
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
    if inner.embedded_server.is_some() {
        if !is_current(inner, generation) {
            return;
        }
        if let Err(e) = crate::server_switch::use_local(inner) {
            eprintln!("내 PC 서버 복귀 실패: {}", e.message);
        }
        return;
    }
    let changed = {
        let mut state = inner.state.lock().unwrap();
        if inner.generation.load(Ordering::SeqCst) == generation {
            let changed = set_link_locked(&mut state, LinkStatus::Unlinked {});
            if changed {
                inner.link_connecting.store(false, Ordering::SeqCst);
            }
            changed
        } else {
            false
        }
    };
    if changed {
        inner.layout_signal.notify();
        emit_state(inner);
    }
}

pub(crate) fn start_stream(inner: Arc<Inner>, generation: u64, file: LinkFile) {
    inner.link_connecting.store(true, Ordering::SeqCst);
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
                set_offline(
                    &inner,
                    generation,
                    &file,
                    registry_failure(error, &file.token),
                );
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
                    set_offline(&inner, generation, &file, errors::CONN_EVENTS_ENDED());
                    break;
                }
                Ok(_) => {
                    let Some(event) = parse_event_line(&line) else {
                        continue;
                    };
                    if matches!(event, DeviceEvent::AppsSnapshot { .. }) {
                        delay = 1;
                    }
                    if !registry_events::apply_event(&inner, generation, event) {
                        return;
                    }
                }
                Err(error) => {
                    set_offline(
                        &inner,
                        generation,
                        &file,
                        errors::CONN_EVENTS_READ_FAILED()
                            .and_details(vec![error.to_string().replace(&file.token, "[가림]")]),
                    );
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

pub(crate) fn load_link(inner: &Inner) -> LinkFile {
    inner.link_file.lock().unwrap().as_ref().unwrap().clone()
}

pub(crate) fn set_offline(
    inner: &Arc<Inner>,
    generation: u64,
    file: &LinkFile,
    mut reason: CoreError,
) {
    if !file.token.is_empty() {
        reason.message = reason.message.replace(&file.token, "[가림]");
        for detail in &mut reason.details {
            *detail = detail.replace(&file.token, "[가림]");
        }
    }
    if let Some(host) = reqwest::Url::parse(&file.server_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
    {
        if !reason.details.iter().any(|detail| detail.contains("host=")) {
            reason.details.push(format!("host={host}"));
        }
    }
    let changed = {
        let mut state = inner.state.lock().unwrap();
        if inner.generation.load(Ordering::SeqCst) != generation {
            false
        } else {
            inner.link_connecting.store(false, Ordering::SeqCst);
            set_link_locked(
                &mut state,
                LinkStatus::Offline {
                    mode: file.mode,
                    server_url: file.server_url.clone(),
                    device_name: file.device_name.clone(),
                    reason: Some(reason),
                },
            )
        }
    };
    if changed {
        inner.layout_signal.notify();
        emit_state(inner);
    }
}

pub(crate) fn token_rejected(inner: &Arc<Inner>, mut file: LinkFile) {
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
        inner.link_connecting.store(false, Ordering::SeqCst);
        inner.layout_signal.notify();
        if file.mode == kaleidoscope_contract::ServerMode::Remote {
            // 연결 거부 뒤에도 현재 배치의 서버 소유권과 미전송 변경을 보존한다.
            file.revoked = true;
            if let Err(e) = storage::save_link(&inner.data_dir, &file) {
                eprintln!("연결 거부 상태 저장 실패: {}", e.message);
            }
            *inner.link_file.lock().unwrap() = Some(file.clone());
        } else {
            if let Err(e) = storage::remove_link(&inner.data_dir) {
                eprintln!("연결 파일 정리 실패: {}", e.message);
            }
            inner.flusher.clear_sync();
            if let Err(e) = crate::sync_state::remove(&inner.data_dir) {
                eprintln!("미전송 목록 정리 실패: {}", e.message);
            }
            state.sync = Default::default();
            *inner.link_file.lock().unwrap() = None;
        }
        set_link_locked(
            &mut state,
            LinkStatus::Revoked {
                server_url: file.server_url,
            },
        )
    };
    if changed {
        crate::process_host::server_changed(inner);
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

pub(crate) fn is_current(inner: &Inner, generation: u64) -> bool {
    inner.generation.load(Ordering::SeqCst) == generation
}

pub(crate) fn set_link_locked(state: &mut crate::CoreState, status: LinkStatus) -> bool {
    if state.link == status {
        return false;
    }
    state.link = status;
    true
}

fn emit_state(inner: &Arc<Inner>) {
    let event = {
        let state = inner.state.lock().unwrap();
        inner.state_event_locked(&state)
    };
    inner.emit_state(&event);
}

fn registry_failure(error: RegistryError, token: &str) -> CoreError {
    match error {
        RegistryError::Failure { stage, detail } => {
            let error = match stage {
                FailureStage::Send => errors::CONN_EVENTS_SEND_FAILED(),
                FailureStage::Status => errors::CONN_EVENTS_STATUS_FAILED(),
                FailureStage::Read => errors::CONN_EVENTS_READ_FAILED(),
            };
            error.and_details(vec![detail.replace(token, "[가림]")])
        }
        RegistryError::Unauthorized => errors::CONN_EVENTS_STATUS_FAILED(),
        RegistryError::NotFound => errors::CONN_EVENTS_NOT_FOUND(),
        RegistryError::Validation(error) => error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_failures_keep_stage_and_hide_token() {
        for (stage, id) in [
            (FailureStage::Send, "CONN_EVENTS_SEND_FAILED"),
            (FailureStage::Status, "CONN_EVENTS_STATUS_FAILED"),
            (FailureStage::Read, "CONN_EVENTS_READ_FAILED"),
        ] {
            let error = registry_failure(
                RegistryError::failure(stage, "host=example; secret-token"),
                "secret-token",
            );
            assert_eq!(error.id.as_deref(), Some(id));
            assert!(!error.message.contains("example"));
            assert!(error.details[0].contains("host=example"));
            assert!(!error.details[0].contains("secret-token"));
        }
    }
}
