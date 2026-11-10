//! 서버별 배치와 미전송 상태의 보존 및 명시적 이관.
use crate::{
    app_commands, link,
    storage::{self, LinkFile},
    sync_state, CoreConfig, EmbeddedServerInfo, Inner,
};
use kaleidoscope_contract::{errors, CoreError, CoreReply, LinkStatus, ServerMode};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

fn local_file(info: &EmbeddedServerInfo, name: &str) -> LinkFile {
    LinkFile {
        revoked: false,
        format: 1,
        mode: ServerMode::Embedded,
        server_url: info.server_url.clone(),
        device_id: info.device_id.clone(),
        device_name: name.into(),
        token: info.token.clone(),
    }
}
pub(crate) fn startup_link(config: &CoreConfig) -> Result<Option<LinkFile>, CoreError> {
    let previous = storage::load_link(&config.data_dir)?;
    if previous
        .as_ref()
        .is_some_and(|f| f.mode == ServerMode::Remote)
    {
        return Ok(previous);
    }
    if let Some(info) = &config.embedded_server {
        let file = local_file(info, &config.device_name);
        storage::save_link(&config.data_dir, &file)?;
        return Ok(Some(file));
    }
    Ok(previous)
}
fn archive(inner: &Inner, file: &LinkFile) -> PathBuf {
    let key = if file.mode == ServerMode::Embedded {
        "local".into()
    } else {
        format!(
            "{:x}",
            Sha256::digest(file.server_url.trim_end_matches('/').as_bytes())
        )
    };
    inner.data_dir.join("server-states").join(key)
}
pub(crate) fn active_archive(inner: &Inner) -> PathBuf {
    match inner.link_file.lock().unwrap().as_ref() {
        Some(file) => archive(inner, file),
        None => inner.data_dir.join("server-states").join("local"),
    }
}
pub(crate) fn saved_remote(inner: &Inner, url: &str) -> Result<Option<LinkFile>, CoreError> {
    let key = format!("{:x}", Sha256::digest(url.trim_end_matches('/').as_bytes()));
    storage::load_link(&inner.data_dir.join("server-states").join(key))
        .map(|file| file.filter(|file| !file.revoked))
}
pub(crate) fn activate(
    inner: &Arc<Inner>,
    file: LinkFile,
    generation: u64,
) -> Result<(), CoreError> {
    if !link::is_current(inner, generation) {
        return Err(errors::SERVER_SWITCH_CANCELLED());
    }
    crate::process_host::server_changed(inner);
    crate::realtime_host::shutdown_sessions(inner);
    crate::data_runtime::server_changed(inner);
    crate::client_files::release_all(inner);
    crate::client_services::server_changed(inner);
    let mut state = inner.state.lock().unwrap();
    inner.save_state_locked(&state, false, false, false)?;
    if !link::is_current(inner, generation) {
        return Err(errors::SERVER_SWITCH_CANCELLED());
    }
    let previous = inner.link_file.lock().unwrap().clone();
    if let Some(previous) = previous.as_ref() {
        let dir = archive(inner, previous);
        std::fs::create_dir_all(&dir).map_err(|detail| {
            let mut error = errors::SERVER_SWITCH_ARCHIVE_CREATE_FAILED();
            error.details.push(detail.to_string());
            error
        })?;
        storage::save_state(&dir, &state.shared, &state.device)?;
        sync_state::save(&dir, &state.sync)?;
        storage::save_link(&dir, previous)?;
    }
    let dir = archive(inner, &file);
    let exists = dir.join("state.json").exists();
    let mut shared = storage::load_shared(&dir)?;
    shared.preferences = None;
    shared.app_comments = None;
    let device = if exists {
        storage::load_device(&dir)?
    } else {
        Default::default()
    };
    let archived_link = storage::load_link(&dir)?;
    let mut sync = sync_state::load(&dir, archived_link.as_ref())?;
    sync.device_id = Some(file.device_id.clone());
    // 초기 병합이 이전 서버의 배치를 업로드하지 않게 한다.
    if !exists {
        sync.merged = true;
        sync.device_id = Some(file.device_id.clone());
    }
    if file.mode == ServerMode::Embedded && shared.workspaces.is_empty() {
        let now = crate::state_commands::timestamp();
        let w = crate::state_commands::new_workspace("작업 1".into(), now.clone());
        let d = crate::state_commands::new_desktop(w.id.clone(), "데스크톱 1".into(), 0, now);
        shared.workspaces.push(w);
        shared.desktops.push(d);
        sync.mark_all(&shared);
    }
    state.last_transfer = None;
    state.transfer_error = None;
    state.shared = shared;
    state.device = device;
    state.sync = sync;
    state.share = Default::default();
    app_commands::ensure_builtin(&mut state);
    crate::layout_apply::reconcile(&mut state);
    state.link = LinkStatus::Offline {
        mode: file.mode,
        server_url: file.server_url.clone(),
        device_name: file.device_name.clone(),
        reason: None,
    };
    inner.save_state_locked(&state, true, true, true)?;
    storage::save_link(&inner.data_dir, &file)?;
    inner.link_connecting.store(!file.revoked, Ordering::SeqCst);
    *inner.link_file.lock().unwrap() = Some(file);
    inner.connections.lock().unwrap().clear();
    inner.connections_snapshot_epoch.store(0, Ordering::SeqCst);
    inner.conversation_snapshot_epoch.store(0, Ordering::SeqCst);
    inner.layout_signal.notify();
    let event = inner.state_event_locked(&state);
    drop(state);
    inner.emit_state(&event);
    Ok(())
}
pub(crate) fn use_local(inner: &Arc<Inner>) -> Result<CoreReply, CoreError> {
    let info = inner
        .embedded_server
        .as_ref()
        .ok_or_else(errors::SERVER_SWITCH_LOCAL_UNAVAILABLE)?;
    let file = local_file(info, &inner.device_name);
    let generation = {
        let _state = inner.state.lock().unwrap();
        let generation = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        crate::store_server_consent::shutdown(inner);
        crate::installation_consent::shutdown_shell(inner);
        generation
    };
    let activated = activate(inner, file.clone(), generation);
    // 전환이 상태 이벤트를 내보내지 못하고 끝나도 닫힌 쉘 동의는 화면에 알린다.
    crate::installation_consent::flush_closed(inner);
    activated?;
    link::start_stream(inner.clone(), generation, file);
    Ok(CoreReply::LinkUseLocal {})
}
pub(crate) fn sync(inner: &Arc<Inner>) -> Result<CoreReply, CoreError> {
    use kaleidoscope_contract::transfer::{TransferBundle, TransferResult, TRANSFER_PATH};
    {
        let state = inner.state.lock().unwrap();
        inner.save_state_locked(&state, false, false, false)?;
    }
    let local = inner
        .embedded_server
        .as_ref()
        .ok_or_else(errors::SERVER_SYNC_LOCAL_UNAVAILABLE)?;
    let generation = inner.generation.load(Ordering::SeqCst);
    let remote = inner
        .link_file
        .lock()
        .unwrap()
        .clone()
        .filter(|f| f.mode == ServerMode::Remote)
        .ok_or_else(errors::SERVER_SYNC_REMOTE_NOT_SELECTED)?;
    // 전환 직전의 디바운스 대기분도 내 PC 정본에 반영한 뒤 이관한다.
    let local_dir = inner.data_dir.join("server-states").join("local");
    let local_link = storage::load_link(&local_dir)?;
    let mut pending = sync_state::load(&local_dir, local_link.as_ref())?;
    if !pending.pending.is_empty() {
        let shared = storage::load_shared(&local_dir)?;
        let (changes, _) = crate::layout_sync::batch(&shared, &pending);
        inner
            .registry
            .push_layout_changes(&local.server_url, &local.token, &changes)
            .map_err(|detail| {
                let host = local
                    .server_url
                    .parse::<reqwest::Url>()
                    .ok()
                    .and_then(|url| url.host_str().map(str::to_owned))
                    .unwrap_or_else(|| "알 수 없는 서버".into());
                match detail {
                    crate::registry_client::RegistryError::Validation(error) => error,
                    crate::registry_client::RegistryError::Unauthorized => {
                        let mut error = errors::SERVER_SYNC_LAYOUT_REJECTED(&host);
                        error.details = vec![format!("HTTP 401; host={host}")];
                        error
                    }
                    crate::registry_client::RegistryError::NotFound => {
                        let mut error = errors::SERVER_SYNC_LAYOUT_REJECTED(&host);
                        error.details = vec![format!("HTTP 404; host={host}")];
                        error
                    }
                    crate::registry_client::RegistryError::Failure { stage, detail, .. } => {
                        let mut error = match stage {
                            crate::registry_client::FailureStage::Send => {
                                errors::SERVER_SYNC_LAYOUT_UNREACHABLE(&host)
                            }
                            crate::registry_client::FailureStage::Status => {
                                errors::SERVER_SYNC_LAYOUT_REJECTED(&host)
                            }
                            crate::registry_client::FailureStage::Read => {
                                errors::SERVER_SYNC_LAYOUT_RESPONSE_READ_FAILED(&host)
                            }
                        };
                        error.details = vec![detail];
                        error
                    }
                }
            })?;
        pending.pending.clear();
        sync_state::save(&local_dir, &pending)?;
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|detail| {
            let mut error = errors::SERVER_SYNC_CLIENT_FAILED();
            error.details.push(detail.without_url().to_string());
            error
        })?;
    let response = client
        .get(format!("{}{TRANSFER_PATH}", local.server_url))
        .bearer_auth(&local.token)
        .send()
        .map_err(|detail| {
            let host = local
                .server_url
                .parse::<reqwest::Url>()
                .ok()
                .and_then(|url| url.host_str().map(str::to_owned))
                .unwrap_or_else(|| "알 수 없는 서버".into());
            let mut error = errors::SERVER_SYNC_LOCAL_READ_UNREACHABLE(&host);
            error.details = vec![format!("{}; host={host}", detail.without_url())];
            error
        })?;
    let response_host = response
        .url()
        .host_str()
        .unwrap_or("알 수 없는 서버")
        .to_owned();
    let response_status = response.status();
    let response = response.error_for_status().map_err(|detail| {
        let host = detail
            .url()
            .and_then(|url| url.host_str())
            .unwrap_or("알 수 없는 서버");
        let mut error = errors::SERVER_SYNC_LOCAL_READ_REJECTED(host);
        error.details = vec![format!(
            "HTTP {}; host={host}",
            detail
                .status()
                .map(|status| status.as_u16())
                .unwrap_or_default()
        )];
        error
    })?;
    let bundle: TransferBundle = response
        .json()
        .map_err(|detail| transfer_response_error(detail, &response_host, response_status))?;
    use crate::registry_client::{RegistryError, SendRegistry};
    let response = client
        .post(format!("{}{TRANSFER_PATH}", remote.server_url))
        .bearer_auth(&remote.token)
        .json(&bundle)
        .send_registry()
        .map_err(|failure| {
            let host = remote.server_url.parse::<reqwest::Url>().ok()
                .and_then(|url| url.host_str().map(str::to_owned))
                .unwrap_or_else(|| "알 수 없는 서버".into());
            match failure {
                RegistryError::Validation(error) => error,
                RegistryError::Failure { stage, detail, .. } => {
                    let error = if stage == crate::registry_client::FailureStage::Status {
                        errors::SERVER_SYNC_REJECTED(&host)
                    } else { errors::SERVER_SYNC_UNREACHABLE(&host) };
                    error.and_details(vec![detail])
                }
                _ => unreachable!("전송 계층은 인증과 경로 오류를 HTTP 응답으로 반환한다"),
            }
        })?;
    let response_host = response
        .url()
        .host_str()
        .unwrap_or("알 수 없는 서버")
        .to_owned();
    let response_status = response.status();
    let response = response.error_for_status().map_err(|detail| {
        let host = detail
            .url()
            .and_then(|url| url.host_str())
            .unwrap_or("알 수 없는 서버");
        let mut error = errors::SERVER_SYNC_REJECTED(host);
        error.details = vec![format!(
            "HTTP {}; host={host}",
            detail
                .status()
                .map(|status| status.as_u16())
                .unwrap_or_default()
        )];
        error
    })?;
    let result: TransferResult = response
        .json()
        .map_err(|detail| transfer_response_error(detail, &response_host, response_status))?;
    finish_sync(inner, generation, remote, result)
}

fn transfer_response_error(
    detail: reqwest::Error,
    host: &str,
    status: reqwest::StatusCode,
) -> CoreError {
    let mut error = if detail.is_body() || detail.is_timeout() {
        errors::SERVER_SYNC_RESPONSE_UNREACHABLE(host)
    } else {
        errors::SERVER_SYNC_RESPONSE_INVALID(host)
    };
    error.details = vec![format!(
        "HTTP {status}; host={host}; {}",
        detail.without_url()
    )];
    error
}

fn finish_sync(
    inner: &Arc<Inner>,
    generation: u64,
    remote: LinkFile,
    result: kaleidoscope_contract::transfer::TransferResult,
) -> Result<CoreReply, CoreError> {
    // 이관 도중 사용자가 다른 서버를 골랐으면 완료 결과와 스트림을 현재 상태에 적용하지 않는다.
    let next = generation + 1;
    if inner
        .generation
        .compare_exchange(generation, next, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        let mut state = inner.state.lock().unwrap();
        if link::is_current(inner, next) {
            state.last_transfer = Some(result.clone());
            state.transfer_error = None;
            drop(state);
            link::start_stream(inner.clone(), next, remote);
        }
    }
    Ok(CoreReply::LinkSyncLocalToRemote { result })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(dir: &std::path::Path) -> CoreConfig {
        CoreConfig {
            media_origin: None,
            data_dir: dir.into(),
            seed_definitions: vec![],
            server_url: "https://remote.example".into(),
            device_name: "시험".into(),
            embedded_server: Some(EmbeddedServerInfo {
                server_url: "http://127.0.0.1:12345".into(),
                device_id: "local-device".into(),
                token: "local-token".into(),
            }),
        }
    }
    #[test]
    fn old_remote_link_is_preserved_byte_for_byte() {
        let dir = tempfile::tempdir().unwrap();
        let raw = r#"{"format":1,"server_url":"https://remote.example","device_id":"home","device_name":"집","token":"remote-token"}"#;
        std::fs::write(dir.path().join("link.json"), raw).unwrap();
        let link = startup_link(&config(dir.path())).unwrap().unwrap();
        assert_eq!(link.mode, ServerMode::Remote);
        assert_eq!(link.token, "remote-token");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("link.json")).unwrap(),
            raw
        );
    }
    #[test]
    fn embedded_restart_refreshes_port_and_new_install_connects() {
        let dir = tempfile::tempdir().unwrap();
        let mut cfg = config(dir.path());
        let first = startup_link(&cfg).unwrap().unwrap();
        assert_eq!(first.mode, ServerMode::Embedded);
        cfg.embedded_server.as_mut().unwrap().server_url = "http://127.0.0.1:54321".into();
        let next = startup_link(&cfg).unwrap().unwrap();
        assert_ne!(first.server_url, next.server_url);
        assert_eq!(next.server_url, "http://127.0.0.1:54321");
    }
    struct Host;
    impl crate::Host for Host {
        fn pick_folder(&self) -> Option<PathBuf> {
            None
        }
    }
    #[test]
    fn switching_preserves_each_servers_layout_and_pending_changes() {
        let dir = tempfile::tempdir().unwrap();
        let mut cfg = config(dir.path());
        cfg.embedded_server = None;
        let core = crate::Core::open(cfg, Arc::new(Host)).unwrap();
        let remote = LinkFile {
            revoked: false,
            format: 1,
            mode: ServerMode::Remote,
            server_url: "https://remote.example".into(),
            device_id: "remote".into(),
            device_name: "시험".into(),
            token: "remote".into(),
        };
        let local = LinkFile {
            revoked: false,
            format: 1,
            mode: ServerMode::Embedded,
            server_url: "http://127.0.0.1:1".into(),
            device_id: "local-device".into(),
            device_name: "시험".into(),
            token: "local".into(),
        };
        activate(&core.inner, local.clone(), 0).unwrap();
        let local_id = core.inner.state.lock().unwrap().shared.workspaces[0]
            .id
            .clone();
        {
            let mut state = core.inner.state.lock().unwrap();
            state.shared.workspaces[0].name = "내 PC 작업".into();
            state
                .sync
                .mark(crate::sync_state::EntityKind::Workspace, &local_id);
        }
        activate(&core.inner, remote.clone(), 0).unwrap();
        assert!(core
            .inner
            .state
            .lock()
            .unwrap()
            .shared
            .workspaces
            .is_empty());
        let w = crate::state_commands::new_workspace(
            "원격 작업".into(),
            crate::state_commands::timestamp(),
        );
        core.inner.state.lock().unwrap().shared.workspaces.push(w);
        activate(&core.inner, local, 0).unwrap();
        {
            let state = core.inner.state.lock().unwrap();
            assert_eq!(state.shared.workspaces[0].name, "내 PC 작업");
            assert!(state
                .sync
                .contains(crate::sync_state::EntityKind::Workspace, &local_id));
        }
        activate(&core.inner, remote, 0).unwrap();
        assert_eq!(
            core.inner.state.lock().unwrap().shared.workspaces[0].name,
            "원격 작업"
        );
        core.shutdown();
    }
    #[test]
    fn completed_transfer_does_not_reconnect_a_server_the_user_left() {
        let dir = tempfile::tempdir().unwrap();
        let mut cfg = config(dir.path());
        cfg.embedded_server = None;
        let core = crate::Core::open(cfg, Arc::new(Host)).unwrap();
        let remote = LinkFile {
            revoked: false,
            format: 1,
            mode: ServerMode::Remote,
            server_url: "https://remote.example".into(),
            device_id: "remote".into(),
            device_name: "시험".into(),
            token: "remote".into(),
        };
        let local = LinkFile {
            revoked: false,
            format: 1,
            mode: ServerMode::Embedded,
            server_url: "http://127.0.0.1:1".into(),
            device_id: "local-device".into(),
            device_name: "시험".into(),
            token: "local".into(),
        };
        core.inner.generation.store(1, Ordering::SeqCst);
        activate(&core.inner, local, 1).unwrap();
        let before = core.inner.state.lock().unwrap().shared.clone();
        finish_sync(
            &core.inner,
            0,
            remote,
            kaleidoscope_contract::transfer::TransferResult {
                imported: 3,
                skipped: vec![],
            },
        )
        .unwrap();
        let state = core.inner.state.lock().unwrap();
        assert_eq!(state.shared, before);
        assert!(state.last_transfer.is_none());
        assert!(matches!(
            state.link,
            LinkStatus::Offline {
                mode: ServerMode::Embedded,
                ..
            }
        ));
        assert_eq!(core.inner.generation.load(Ordering::SeqCst), 1);
        drop(state);
        core.shutdown();
    }
}

#[cfg(test)]
mod preferences_switch_tests {
    use super::*;
    use kaleidoscope_contract::{preferences::AccountPreferences, registry::DeviceEvent};
    struct Host;
    impl crate::Host for Host {
        fn pick_folder(&self) -> Option<PathBuf> {
            None
        }
    }
    #[test]
    fn switching_waits_for_target_server_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let core = crate::Core::open(
            CoreConfig {
                media_origin: None,
                data_dir: dir.path().into(),
                seed_definitions: vec![],
                server_url: "https://example.test".into(),
                device_name: "PC".into(),
                embedded_server: None,
            },
            Arc::new(Host),
        )
        .unwrap();
        let link = LinkFile {
            revoked: false,
            format: 1,
            mode: ServerMode::Remote,
            server_url: "https://example.test".into(),
            device_id: "device".into(),
            device_name: "PC".into(),
            token: "token".into(),
        };
        let old = AccountPreferences {
            revision: 10,
            default_message_app_id: Some("old".into()),
            asked_message_app_ids: vec![],
        };
        core.inner.state.lock().unwrap().shared.preferences = Some(old.clone());
        activate(&core.inner, link.clone(), 0).unwrap();
        core.inner.state.lock().unwrap().shared.preferences = Some(old);
        activate(&core.inner, link, 0).unwrap();
        assert!(core
            .inner
            .state
            .lock()
            .unwrap()
            .shared
            .preferences
            .is_none());
        let fresh = AccountPreferences {
            revision: 1,
            default_message_app_id: Some("agent".into()),
            asked_message_app_ids: vec![],
        };
        crate::registry_events::apply_event(
            &core.inner,
            0,
            DeviceEvent::PreferencesSnapshot {
                preferences: fresh.clone(),
            },
        );
        assert_eq!(
            core.inner.state.lock().unwrap().shared.preferences,
            Some(fresh)
        );
        core.shutdown();
    }
}
