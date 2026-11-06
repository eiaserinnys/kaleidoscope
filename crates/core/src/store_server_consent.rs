//! 스토어 주소 허용을 요청 창과 연결 세대에 묶어 기다린다.
use std::{collections::HashMap, sync::{atomic::Ordering, mpsc, Arc, Mutex}};
use kaleidoscope_contract::{errors, CoreError, CoreEvent, CoreReply, PermissionDecl};
use serde_json::Value;
use crate::{app_commands, Inner};

struct Pending {
    window: String,
    app: String,
    version: u32,
    generation: u64,
    server: String,
    reply: mpsc::SyncSender<bool>,
}

#[derive(Default)]
pub(crate) struct Consents { pending: Mutex<HashMap<String, Pending>> }

pub(crate) fn allow(inner: &Arc<Inner>, window: &str, permission: &str, server: Value) -> Result<bool, CoreError> {
    let server = server.as_str().ok_or_else(errors::STORECLIENT_SERVER_ALLOW_ADDRESS_INVALID)?;
    let server = crate::store::StoreUrl::parse(server)?.as_str().to_owned();
    let request_id = uuid::Uuid::new_v4().to_string();
    let (reply, receiver) = mpsc::sync_channel(1);
    let (app, version, generation, app_name) = {
        let state = inner.state.lock().unwrap();
        let win = state.shared.windows.iter().find(|w| w.id == window).ok_or_else(errors::STORECLIENT_SERVER_ALLOW_WINDOW_MISSING)?;
        let definition = app_commands::definition_for(&state.shared, &win.app_id, win.app_version).ok_or_else(errors::STORECLIENT_SERVER_ALLOW_WINDOW_MISSING)?;
        if !definition.permissions.iter().any(|p| matches!(p, PermissionDecl::Store { id, .. } if id == permission)) {
            return Err(errors::STORECLIENT_SERVER_ALLOW_PERMISSION_UNDECLARED(permission));
        }
        if state.device.store_servers.contains(&server) { return Ok(true); }
        if inner.shutting_down.load(Ordering::SeqCst) { return Ok(false); }
        let generation = inner.generation.load(Ordering::SeqCst);
        inner.store_server_consents.pending.lock().unwrap().insert(request_id.clone(), Pending {
            window: window.into(), app: win.app_id.clone(), version: win.app_version, generation,
            server: server.clone(), reply,
        });
        (win.app_id.clone(), win.app_version, generation, definition.name.clone())
    };
    inner.emit(&CoreEvent::StoreServerPermission { window_id: window.into(), request_id, app_name, server: server.clone() });
    if !receiver.recv().unwrap_or(false) { return Ok(false); }
    let event = {
        let mut state = inner.state.lock().unwrap();
        if inner.shutting_down.load(Ordering::SeqCst)
            || inner.generation.load(Ordering::SeqCst) != generation
            || !state.shared.windows.iter().any(|w| w.id == window && w.app_id == app && w.app_version == version) {
            return Err(errors::STORECLIENT_SERVER_ALLOW_CONTEXT_CHANGED());
        }
        if !state.device.store_servers.contains(&server) {
            state.device.store_servers.push(server.clone());
            if let Err(error) = inner.save_state_locked(&state, false, true, false) {
                state.device.store_servers.pop();
                return Err(errors::STORECLIENT_SERVER_ALLOW_SAVE_FAILED().and_details(vec![error.message]));
            }
        }
        inner.state_event_locked(&state)
    };
    inner.emit_state(&event);
    crate::data_runtime::store_servers_changed(inner);
    Ok(true)
}

pub(crate) fn respond(inner: &Inner, window: &str, request_id: &str, server: &str, allow: bool) -> Result<CoreReply, CoreError> {
    let state = inner.state.lock().unwrap();
    let mut pending = inner.store_server_consents.pending.lock().unwrap();
    let request = pending.get(request_id).ok_or_else(errors::STORECLIENT_SERVER_ALLOW_REQUEST_EXPIRED)?;
    if request.window != window { return Err(errors::STORECLIENT_SERVER_ALLOW_WINDOW_MISMATCH()); }
    if request.server != server { return Err(errors::STORECLIENT_SERVER_ALLOW_TARGET_MISMATCH()); }
    if inner.generation.load(Ordering::SeqCst) != request.generation || inner.shutting_down.load(Ordering::SeqCst)
        || !state.shared.windows.iter().any(|w| w.id == request.window && w.app_id == request.app && w.app_version == request.version) {
        pending.remove(request_id);
        return Err(errors::STORECLIENT_SERVER_ALLOW_CONTEXT_CHANGED());
    }
    let request = pending.remove(request_id).unwrap();
    request.reply.send(allow).map_err(|_| errors::STORECLIENT_SERVER_ALLOW_REQUEST_EXPIRED())?;
    Ok(CoreReply::StoreRespondServerPermission {})
}

pub(crate) fn state_changed(inner: &Inner) {
    let state = inner.state.lock().unwrap();
    let generation = inner.generation.load(Ordering::SeqCst);
    inner.store_server_consents.pending.lock().unwrap().retain(|_, p|
        p.generation == generation && state.shared.windows.iter().any(|w| w.id == p.window && w.app_id == p.app && w.app_version == p.version));
}

pub(crate) fn shutdown(inner: &Inner) { inner.store_server_consents.pending.lock().unwrap().clear(); }
