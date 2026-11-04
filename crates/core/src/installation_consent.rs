//! 설치 요청의 소유 창과 확인한 묶음을 묶어 동의를 기다린다.
use std::{collections::HashMap, sync::{mpsc, Arc, Mutex}};
use kaleidoscope_contract::{errors, AppDefinition, CoreError, CoreEvent, CoreReply};
use crate::Inner;

struct Pending {
    window: String,
    app: String,
    version: u32,
    digest: String,
    reply: mpsc::SyncSender<bool>,
}

#[derive(Default)]
pub(crate) struct Consents { pending: Mutex<HashMap<String, Pending>> }

pub(crate) fn wait(inner: &Arc<Inner>, window: &str, app: &str, version: u32, release: u32, digest: &str, definition: &AppDefinition) -> Result<bool, CoreError> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let (reply, receiver) = mpsc::sync_channel(1);
    {
        let state = inner.state.lock().unwrap();
        if !state.shared.windows.iter().any(|w| w.id == window && w.app_id == app && w.app_version == version) {
            return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED());
        }
        inner.installation_consents.pending.lock().unwrap().insert(request_id.clone(), Pending {
            window: window.into(), app: app.into(), version, digest: digest.into(), reply,
        });
    }
    inner.emit(&CoreEvent::AppInstallPermission {
        window_id: window.into(), request_id, app_name: definition.name.clone(), release,
        digest: digest.into(), definition: definition.clone(),
    });
    Ok(receiver.recv().unwrap_or(false))
}

pub(crate) fn respond(inner: &Inner, window: &str, request_id: &str, digest: &str, allow: bool) -> Result<CoreReply, CoreError> {
    let mut pending = inner.installation_consents.pending.lock().unwrap();
    let request = pending.get(request_id).ok_or_else(errors::STORECLIENT_INSTALL_REQUEST_EXPIRED)?;
    if request.window != window { return Err(errors::STORECLIENT_INSTALL_WINDOW_MISMATCH()); }
    if request.digest != digest { return Err(errors::STORECLIENT_INSTALL_DIGEST_MISMATCH()); }
    let request = pending.remove(request_id).unwrap();
    request.reply.send(allow).map_err(|_| errors::STORECLIENT_INSTALL_RESPONSE_CLOSED())?;
    Ok(CoreReply::AppRespondInstallPermission {})
}

pub(crate) fn state_changed(inner: &Inner) {
    let state = inner.state.lock().unwrap();
    inner.installation_consents.pending.lock().unwrap().retain(|_, pending| {
        state.shared.windows.iter().any(|w| w.id == pending.window && w.app_id == pending.app && w.app_version == pending.version)
    });
}

pub(crate) fn shutdown(inner: &Inner) { inner.installation_consents.pending.lock().unwrap().clear(); }
