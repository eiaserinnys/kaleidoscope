//! 서버별 배치와 미전송 상태의 보존 및 명시적 이관.
use crate::{
    app_commands, error, link, snapshot,
    storage::{self, LinkFile},
    sync_state, CoreConfig, EmbeddedServerInfo, Inner,
};
use kaleidoscope_contract::{CoreError, CoreEvent, CoreReply, ErrorCode, LinkStatus, ServerMode};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

fn local_file(info: &EmbeddedServerInfo, name: &str) -> LinkFile {
    LinkFile {
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
pub(crate) fn saved_remote(inner: &Inner, url: &str) -> Result<Option<LinkFile>, CoreError> {
    let key = format!("{:x}", Sha256::digest(url.trim_end_matches('/').as_bytes()));
    storage::load_link(&inner.data_dir.join("server-states").join(key))
}
pub(crate) fn forget_revoked(inner: &Inner, file: &LinkFile) -> Result<(), CoreError> {
    storage::remove_link(&archive(inner, file))
}
pub(crate) fn activate(
    inner: &Arc<Inner>,
    file: LinkFile,
    generation: u64,
) -> Result<(), CoreError> {
    if !link::is_current(inner, generation) {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    crate::local_agent::server_changed(inner);
    crate::data_runtime::server_changed(inner);
    let mut state = inner.state.lock().unwrap();
    if !link::is_current(inner, generation) {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    let previous = inner.link_file.lock().unwrap().clone();
    if let Some(previous) = previous.as_ref() {
        let dir = archive(inner, previous);
        std::fs::create_dir_all(&dir).map_err(|e| error::io_error(&e))?;
        storage::save_state(&dir, &state.shared, &state.device)?;
        sync_state::save(&dir, &state.sync)?;
        storage::save_link(&dir, previous)?;
    }
    let dir = archive(inner, &file);
    let exists = dir.join("state.json").exists();
    let mut shared = storage::load_shared(&dir)?;
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
        reason: "연결하는 중".into(),
    };
    storage::save_state(&inner.data_dir, &state.shared, &state.device)?;
    sync_state::save(&inner.data_dir, &state.sync)?;
    storage::save_link(&inner.data_dir, &file)?;
    *inner.link_file.lock().unwrap() = Some(file);
    inner.connections.lock().unwrap().clear();
    inner.conversation_snapshot_epoch.store(0, Ordering::SeqCst);
    let event = CoreEvent::StateChanged {
        snapshot: snapshot(&state),
    };
    drop(state);
    inner.emit(&event);
    Ok(())
}
pub(crate) fn use_local(inner: &Arc<Inner>) -> Result<CoreReply, CoreError> {
    let info = inner
        .embedded_server
        .as_ref()
        .ok_or_else(|| error::make(ErrorCode::Unavailable))?;
    let file = local_file(info, &inner.device_name);
    let generation = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
    activate(inner, file.clone(), generation)?;
    link::start_stream(inner.clone(), generation, file);
    Ok(CoreReply::LinkUseLocal {})
}
pub(crate) fn sync(inner: &Arc<Inner>) -> Result<CoreReply, CoreError> {
    use kaleidoscope_contract::transfer::{TransferBundle, TransferResult, TRANSFER_PATH};
    let local = inner
        .embedded_server
        .as_ref()
        .ok_or_else(|| error::make(ErrorCode::Unavailable))?;
    let remote = inner
        .link_file
        .lock()
        .unwrap()
        .clone()
        .filter(|f| f.mode == ServerMode::Remote)
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
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
            .map_err(|e| link::registry_error_to_core(e, "내 PC 배치를 저장할 수 없습니다"))?;
        pending.pending.clear();
        sync_state::save(&local_dir, &pending)?;
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(http_error)?;
    let bundle: TransferBundle = client
        .get(format!("{}{TRANSFER_PATH}", local.server_url))
        .bearer_auth(&local.token)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(http_error)?;
    let result: TransferResult = client
        .post(format!("{}{TRANSFER_PATH}", remote.server_url))
        .bearer_auth(&remote.token)
        .json(&bundle)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(http_error)?;
    {
        let mut state = inner.state.lock().unwrap();
        state.last_transfer = Some(result.clone());
        state.transfer_error = None;
    }
    // 새 snapshot을 받아 이관한 앱, 배치, 저장값을 실제 창에 반영한다.
    let generation = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
    link::start_stream(inner.clone(), generation, remote);
    Ok(CoreReply::LinkSyncLocalToRemote { result })
}
fn http_error(e: reqwest::Error) -> CoreError {
    link::server_error(
        "내 PC 데이터 이관에 실패했습니다",
        vec![e.without_url().to_string()],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(dir: &std::path::Path) -> CoreConfig {
        CoreConfig {
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
            format: 1,
            mode: ServerMode::Remote,
            server_url: "https://remote.example".into(),
            device_id: "remote".into(),
            device_name: "시험".into(),
            token: "remote".into(),
        };
        let local = LinkFile {
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
}
