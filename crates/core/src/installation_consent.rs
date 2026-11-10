//! 설치 요청의 소유자(앱 창 또는 쉘 전체)와 확인한 묶음을 묶어 동의를 기다린다.
use std::{collections::HashMap, sync::{atomic::Ordering, mpsc, Arc, Mutex}};
use kaleidoscope_contract::{errors, store::StoreOrigin, AppDefinition, CoreError, CoreEvent, CoreReply, InstallConsentOwner};
use crate::Inner;

struct Pending {
    owner: InstallConsentOwner,
    digest: String,
    reply: mpsc::SyncSender<bool>,
    /// 쉘 승인 호출이 설치 결과를 기다리는 수신자. 창 동의는 호출자가 이미 동기로 결과를 받으므로 없다.
    outcome: Option<mpsc::Receiver<Result<(), CoreError>>>,
}

#[derive(Default)]
pub(crate) struct Consents {
    pending: Mutex<HashMap<String, Pending>>,
    /// 응답 없이 닫힌 쉘 전체 동의의 request_id. 상태 잠금을 쥔 자리에서 담고, 잠금을 놓은 뒤 이벤트로 보낸다.
    closed: Mutex<Vec<String>>,
}

fn emit(inner: &Arc<Inner>, owner: InstallConsentOwner, request_id: String, release: u32, store_url: &str, digest: &str, definition: &AppDefinition, from_origin: Option<StoreOrigin>, replacing: bool, modified: bool) {
    // 사용자가 아는 판은 스토어 릴리스다. 앱 목록 항목도 `origin.release`를 보여 준다.
    let installed_release = inner.state.lock().unwrap().shared.apps.iter().find(|item| item.id == definition.id)
        .and_then(|item| item.origin.as_ref()).map(|origin| origin.release);
    inner.emit(&CoreEvent::AppInstallPermission {
        owner, request_id, app_name: definition.name.clone(), release, installed_release,
        store_url: store_url.into(), from_origin, replacing, modified,
        digest: digest.into(), definition: definition.clone(),
    });
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn wait(inner: &Arc<Inner>, window: &str, app: &str, version: u32, release: u32, store_url: &str, digest: &str, definition: &AppDefinition, from_origin: Option<StoreOrigin>, replacing: bool, modified: bool) -> Result<bool, CoreError> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let (reply, receiver) = mpsc::sync_channel(1);
    let owner = InstallConsentOwner::Window { window_id: window.into(), app_id: app.into(), app_version: version };
    {
        let state = inner.state.lock().unwrap();
        if !state.shared.windows.iter().any(|w| w.id == window && w.app_id == app && w.app_version == version) {
            return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED());
        }
        let mut pending = inner.installation_consents.pending.lock().unwrap();
        if inner.shutting_down.load(Ordering::SeqCst) { return Ok(false); }
        pending.insert(request_id.clone(), Pending { owner: owner.clone(), digest: digest.into(), reply, outcome: None });
    }
    emit(inner, owner, request_id, release, store_url, digest, definition, from_origin, replacing, modified);
    Ok(receiver.recv().unwrap_or(false))
}

/// MCP가 시작한 쉘 전체 동의를 등록하고 응답과 설치 결과를 기다릴 수신자를 돌려준다.
/// 셧다운 중이면 None이며, 호출자는 동의 창 없이 요청을 끝낸다.
#[allow(clippy::too_many_arguments)]
pub(crate) fn register_shell(inner: &Arc<Inner>, generation: u64, release: u32, store_url: &str, digest: &str, definition: &AppDefinition, from_origin: Option<StoreOrigin>, replacing: bool, modified: bool) -> Result<Option<(String, mpsc::Receiver<bool>, mpsc::Sender<Result<(), CoreError>>)>, CoreError> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let (reply, receiver) = mpsc::sync_channel(1);
    let (outcome, outcome_receiver) = mpsc::channel();
    let owner = InstallConsentOwner::Shell { generation, request_id: request_id.clone() };
    {
        let mut pending = inner.installation_consents.pending.lock().unwrap();
        if inner.shutting_down.load(Ordering::SeqCst) { return Ok(None); }
        pending.insert(request_id.clone(), Pending { owner: owner.clone(), digest: digest.into(), reply, outcome: Some(outcome_receiver) });
    }
    emit(inner, owner, request_id.clone(), release, store_url, digest, definition, from_origin, replacing, modified);
    Ok(Some((request_id, receiver, outcome)))
}

pub(crate) fn respond(inner: &Inner, owner: &InstallConsentOwner, request_id: &str, digest: &str, allow: bool) -> Result<CoreReply, CoreError> {
    let mut pending = inner.installation_consents.pending.lock().unwrap();
    let request = pending.get(request_id).ok_or_else(errors::STORECLIENT_INSTALL_REQUEST_EXPIRED)?;
    // 응답한 창이 다르면 창 안내를, 창과 쉘 사이처럼 소유자 종류가 다르면 소유자 안내를 돌려준다.
    if &request.owner != owner {
        return Err(match (&request.owner, owner) {
            (InstallConsentOwner::Window { .. }, InstallConsentOwner::Window { .. }) => errors::STORECLIENT_INSTALL_WINDOW_MISMATCH(),
            _ => errors::STORECLIENT_INSTALL_OWNER_MISMATCH(),
        });
    }
    if request.digest != digest { return Err(errors::STORECLIENT_INSTALL_DIGEST_MISMATCH()); }
    let request = pending.remove(request_id).unwrap();
    // 설치가 상태 변경 이벤트를 보내며 이 잠금을 다시 잡으므로 기다리기 전에 놓는다.
    drop(pending);
    let outcome = request.outcome.filter(|_| allow);
    request.reply.send(allow).map_err(|_| errors::STORECLIENT_INSTALL_RESPONSE_CLOSED())?;
    // 쉘 승인은 설치가 끝날 때까지 기다려 결과를 돌려준다. 실패는 이미 끝난 MCP 요청이 아니라 이 응답으로 알린다.
    if let Some(outcome) = outcome {
        match outcome.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(_) => return Err(errors::STORECLIENT_INSTALL_RESPONSE_CLOSED()),
        }
    }
    Ok(CoreReply::AppRespondInstallPermission {})
}

pub(crate) fn state_changed(inner: &Arc<Inner>) {
    let mut closed = Vec::new();
    {
        let state = inner.state.lock().unwrap();
        let generation = inner.generation.load(Ordering::SeqCst);
        inner.installation_consents.pending.lock().unwrap().retain(|request_id, pending| match &pending.owner {
            InstallConsentOwner::Window { window_id, app_id, app_version } => state.shared.windows.iter()
                .any(|w| w.id == *window_id && w.app_id == *app_id && w.app_version == *app_version),
            InstallConsentOwner::Shell { generation: owner_generation, .. } => {
                if *owner_generation == generation { true } else { closed.push(request_id.clone()); false }
            }
        });
    }
    if !closed.is_empty() {
        inner.installation_consents.closed.lock().unwrap().extend(closed);
    }
    flush_closed(inner);
}

/// 링크가 바뀌면 쉘 전체 동의를 취소한다. 응답을 기다리는 쪽은 채널이 닫혀 취소로 읽는다.
/// 닫힌 요청은 모아 두었다가 상태 잠금을 놓은 뒤 [`flush_closed`]가 화면에 알린다.
pub(crate) fn shutdown_shell(inner: &Inner) {
    let mut pending = inner.installation_consents.pending.lock().unwrap();
    let mut closed = inner.installation_consents.closed.lock().unwrap();
    pending.retain(|request_id, request| {
        if matches!(request.owner, InstallConsentOwner::Shell { .. }) {
            closed.push(request_id.clone());
            false
        } else {
            true
        }
    });
}

/// 응답 없이 닫힌 쉘 전체 동의를 화면에 알린다. 상태 잠금 밖에서 부른다.
/// 사용자 응답으로 지운 동의는 화면이 이미 알므로 담기지 않는다. 셧다운은 알릴 화면이 없어 보내지 않는다.
pub(crate) fn flush_closed(inner: &Arc<Inner>) {
    let closed = std::mem::take(&mut *inner.installation_consents.closed.lock().unwrap());
    if inner.shutting_down.load(Ordering::SeqCst) { return; }
    for request_id in closed {
        inner.emit(&CoreEvent::AppInstallPermissionClosed { request_id });
    }
}

pub(crate) fn shutdown(inner: &Inner) {
    inner.installation_consents.pending.lock().unwrap().clear();
    inner.installation_consents.closed.lock().unwrap().clear();
}
