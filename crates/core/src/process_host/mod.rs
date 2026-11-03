//! 창과 실행 권한에 묶인 기기 프로세스 호스트.
mod stream;
mod relay;
use crate::{app_commands, client_blobs, files, Inner};
use kaleidoscope_contract::{
    errors,
    process::{spec_hash, ProcessAccess, ProcessSnapshot, ProcessStartResult},
    CoreError, CoreEvent, CoreReply, CoreRequest, PermissionDecl, LinkStatus,
};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
};
use stream::{Input, Running, READ_LIMIT};

struct Pending {
    window: String,
    permission: String,
    reply: mpsc::SyncSender<bool>,
}
#[derive(Default)]
pub(crate) struct Processes {
    running: Mutex<HashMap<String, Arc<Running>>>,
    pending: Mutex<HashMap<String, Pending>>,
    windows: Mutex<HashSet<(String, String)>>,
    window_storage_archive: Mutex<Option<PathBuf>>,
    start: Mutex<()>,
    relay: Mutex<Option<relay::Relay>>,
}

impl Processes {
    pub(crate) fn with_windows(
        windows: impl IntoIterator<Item = (String, String)>,
    ) -> Self {
        Self {
            windows: Mutex::new(windows.into_iter().collect()),
            ..Self::default()
        }
    }
}

pub(crate) fn initialize_window_storage_archive(inner: &Inner) {
    *inner.processes.window_storage_archive.lock().unwrap() =
        Some(crate::server_switch::active_archive(inner));
}

fn context(
    inner: &Inner,
    window: &str,
    permission: &str,
    cwd_permission: &str,
    tools: bool,
) -> Result<(String, std::path::PathBuf, String), CoreError> {
    let state = inner.state.lock().unwrap();
    let item = state
        .shared
        .windows
        .iter()
        .find(|item| item.id == window)
        .ok_or_else(|| {
            errors::PROCESS_START_WINDOW_MISSING().and_details(vec![format!("window_id: {window}")])
        })?;
    let definition = app_commands::definition_for(&state.shared, &item.app_id, item.app_version)
        .ok_or_else(|| {
            errors::PROCESS_START_APP_VERSION_MISSING().and_details(vec![
                format!("app_id: {}", item.app_id),
                format!("app_version: {}", item.app_version),
            ])
        })?;
    if tools && (definition.requires.blocks < 18 || definition.requires.modules.get("client").copied().unwrap_or(0) < 4) {
        return Err(errors::PROCESS_START_SERVICE_VERSION_REQUIRED());
    }
    if !definition
        .permissions
        .iter()
        .any(|decl| matches!(decl, PermissionDecl::Process { id, .. } if id == permission))
    {
        return Err(errors::PROCESS_START_PERMISSION_UNDECLARED(permission));
    }
    if !definition
        .client
        .as_ref()
        .and_then(|client| client.process_permissions.as_ref())
        .is_some_and(|ids| ids.iter().any(|id| id == permission))
    {
        return Err(errors::PROCESS_START_CLIENT_PERMISSION_UNDECLARED(
            permission,
        ));
    }
    let workspace = state.shared.desktops.iter().find(|d| d.id == item.desktop_id)
        .ok_or_else(errors::PROCESS_START_DESKTOP_MISSING)?.workspace_id.clone();
    Ok((
        item.app_id.clone(),
        files::granted_root(&state, window, cwd_permission, false)?,
        workspace,
    ))
}

fn find(inner: &Inner, window: &str, handle: &str) -> Option<Arc<Running>> {
    let scope = crate::server_switch::active_archive(inner);
    inner
        .processes
        .running
        .lock()
        .unwrap()
        .get(handle)
        .filter(|p| p.window == window && *p.scope.lock().unwrap() == scope)
        .cloned()
}

fn by_key(inner: &Inner, window: &str, key: &str) -> Option<Arc<Running>> {
    let scope = crate::server_switch::active_archive(inner);
    inner
        .processes
        .running
        .lock()
        .unwrap()
        .values()
        .find(|p| p.window == window && p.key == key && *p.scope.lock().unwrap() == scope)
        .cloned()
}

fn snapshot(p: &Running) -> ProcessSnapshot {
    let state = p.state.lock().unwrap();
    ProcessSnapshot {
        handle: p.handle.clone(),
        after: state.after,
        checkpoint: state.checkpoint.clone(),
        cwd: p.cwd.clone(),
        services: p.services.lock().unwrap().clone(),
        exit: state.exit.clone(),
    }
}

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    match request {
        CoreRequest::ProcessStart {
            window_id,
            key,
            permission,
            spec,
            cwd_permission,
            services,
        } => {
            if let Some(service) = services.iter().find(|service| service.as_str() != "tools") {
                return Err(errors::PROCESS_START_SERVICE_UNKNOWN(service));
            }
            let tools = services.iter().any(|service| service == "tools");
            let (app_id, _, _) = context(inner, &window_id, &permission, &cwd_permission, tools)?;
            if let Some(p) = by_key(inner, &window_id, &key) {
                if p.state.lock().unwrap().exit.is_none() {
                    return Ok(CoreReply::ProcessStart {
                        result: ProcessStartResult::Started {
                            handle: p.handle.clone(),
                            cwd: p.cwd.clone(),
                            services: p.services.lock().unwrap().clone(),
                        },
                    });
                }
            }
            let hash = spec_hash(&spec);
            let allowed = inner
                .state
                .lock()
                .unwrap()
                .device
                .process_access
                .iter()
                .any(|a| a.app_id == app_id && a.permission == permission && a.spec_hash == hash);
            if !allowed {
                let request_id = uuid::Uuid::new_v4().to_string();
                let (tx, rx) = mpsc::sync_channel(1);
                {
                    let _guard = inner.processes.start.lock().unwrap();
                    context(inner, &window_id, &permission, &cwd_permission, tools)?;
                    inner.processes.pending.lock().unwrap().insert(
                        request_id.clone(),
                        Pending {
                            window: window_id.clone(),
                            permission: permission.clone(),
                            reply: tx,
                        },
                    );
                }
                inner.emit(&CoreEvent::ProcessPermission {
                    window_id: window_id.clone(),
                    request_id,
                    spec: spec.clone(),
                });
                if !rx
                    .recv()
                    .map_err(|_| errors::PROCESS_START_PERMISSION_CANCELLED())?
                {
                    return Ok(CoreReply::ProcessStart {
                        result: ProcessStartResult::Cancelled {
                            status: "cancelled".into(),
                        },
                    });
                }
                let _guard = inner.processes.start.lock().unwrap();
                let (current_app, _, _) = context(inner, &window_id, &permission, &cwd_permission, tools)?;
                if current_app != app_id {
                    return Err(errors::PROCESS_START_APP_CHANGED());
                }
                let mut state = inner.state.lock().unwrap();
                state.device.process_access.push(ProcessAccess {
                    app_id,
                    permission: permission.clone(),
                    spec_hash: hash,
                    granted_at: crate::state_commands::timestamp(),
                });
                if let Err(error) = inner.save_state_locked(&state, false, true, false) {
                    state.device.process_access.pop();
                    return Err(error);
                }
            }
            let _guard = inner.processes.start.lock().unwrap();
            let (_, cwd, workspace) = context(inner, &window_id, &permission, &cwd_permission, tools)?;
            if let Some(p) = by_key(inner, &window_id, &key) {
                if p.state.lock().unwrap().exit.is_none() {
                    return Ok(CoreReply::ProcessStart {
                        result: ProcessStartResult::Started {
                            handle: p.handle.clone(),
                            cwd: p.cwd.clone(),
                            services: p.services.lock().unwrap().clone(),
                        },
                    });
                }
                inner.processes.running.lock().unwrap().remove(&p.handle);
                revoke(inner, &p.handle);
                p.stop();
            }
            let scope = crate::server_switch::active_archive(inner);
            let p = Running::launch(inner, window_id, key, permission, spec, cwd, scope)?;
            if tools {
                let connected = matches!(inner.state.lock().unwrap().link, LinkStatus::Connected { .. });
                let link = if connected { inner.link_file.lock().unwrap().clone().filter(|link| !link.revoked) } else { None };
                let address = if let Some(link) = link {
                    let mut relay = inner.processes.relay.lock().unwrap();
                    if relay.is_none() {
                        match relay::Relay::new() {
                            Ok(created) => *relay = Some(created),
                            Err(error) => { p.stop(); return Err(error); }
                        }
                    }
                    Some(relay.as_ref().unwrap().bind(&p.handle, &link.server_url, &link.token, &workspace))
                } else { None };
                p.services.lock().unwrap().insert("tools".into(), address);
            }
            let result = ProcessStartResult::Started {
                handle: p.handle.clone(),
                cwd: p.cwd.clone(),
                services: p.services.lock().unwrap().clone(),
            };
            inner
                .processes
                .running
                .lock()
                .unwrap()
                .insert(p.handle.clone(), p);
            Ok(CoreReply::ProcessStart { result })
        }
        CoreRequest::ProcessRespondPermission {
            window_id,
            request_id,
            allow,
        } => {
            let mut pending = inner.processes.pending.lock().unwrap();
            if !pending
                .get(&request_id)
                .is_some_and(|p| p.window == window_id)
            {
                return Err(errors::PROCESS_RESPOND_REQUEST_MISSING());
            }
            let request = pending.remove(&request_id).unwrap();
            request
                .reply
                .send(allow)
                .map_err(|_| errors::PROCESS_RESPOND_REQUEST_CLOSED())?;
            Ok(CoreReply::ProcessRespondPermission {})
        }
        CoreRequest::ProcessAttach { window_id, key } => Ok(CoreReply::ProcessAttach {
            process: by_key(inner, &window_id, &key).map(|p| snapshot(&p)),
        }),
        CoreRequest::ProcessRead {
            window_id,
            handle,
            after,
            max_bytes,
        } => {
            let p =
                find(inner, &window_id, &handle).ok_or_else(errors::PROCESS_READ_HANDLE_MISSING)?;
            let state = p.state.lock().unwrap();
            let end = state.after + state.buffer.len() as u64;
            if after < state.after || after > end {
                return Err(errors::PROCESS_READ_CURSOR_INVALID());
            }
            let bytes: Vec<u8> = state
                .buffer
                .iter()
                .skip((after - state.after) as usize)
                .take(max_bytes.min(READ_LIMIT))
                .copied()
                .collect();
            let next = after + bytes.len() as u64;
            Ok(CoreReply::ProcessRead {
                bytes,
                next,
                stderr_tail: state.stderr.iter().copied().collect(),
                exit: state.exit.clone(),
            })
        }
        CoreRequest::ProcessAck {
            window_id,
            handle,
            after,
            checkpoint,
        } => {
            let p =
                find(inner, &window_id, &handle).ok_or_else(errors::PROCESS_ACK_HANDLE_MISSING)?;
            let mut state = p.state.lock().unwrap();
            if after < state.after || after > state.after + state.buffer.len() as u64 {
                return Err(errors::PROCESS_ACK_CURSOR_INVALID());
            }
            let count = (after - state.after) as usize;
            state.buffer.drain(..count);
            state.after = after;
            if checkpoint.is_some() {
                state.checkpoint = checkpoint;
            }
            let has_more = !state.buffer.is_empty();
            drop(state);
            p.space.notify_one();
            if has_more {
                inner.emit(&CoreEvent::ProcessReady { window_id, handle });
            }
            Ok(CoreReply::ProcessAck {})
        }
        CoreRequest::ProcessWrite {
            window_id,
            handle,
            bytes,
            checkpoint,
        } => {
            let p = find(inner, &window_id, &handle)
                .ok_or_else(errors::PROCESS_WRITE_HANDLE_MISSING)?;
            let mut state = p.state.lock().unwrap();
            state
                .input
                .as_ref()
                .ok_or_else(errors::PROCESS_WRITE_INPUT_CLOSED)?
                .send(Input::Write(bytes))
                .map_err(|_| errors::PROCESS_WRITE_INPUT_CLOSED())?;
            if checkpoint.is_some() {
                state.checkpoint = checkpoint;
            }
            Ok(CoreReply::ProcessWrite {})
        }
        CoreRequest::ProcessCloseInput { window_id, handle } => {
            let p = find(inner, &window_id, &handle)
                .ok_or_else(errors::PROCESS_CLOSE_INPUT_HANDLE_MISSING)?;
            if let Some(input) = p.state.lock().unwrap().input.take() {
                let _ = input.send(Input::Close);
            }
            Ok(CoreReply::ProcessCloseInput {})
        }
        CoreRequest::ProcessStop { window_id, handle } => {
            let p =
                find(inner, &window_id, &handle).ok_or_else(errors::PROCESS_STOP_HANDLE_MISSING)?;
            inner.processes.running.lock().unwrap().remove(&handle);
            revoke(inner, &handle);
            p.stop();
            Ok(CoreReply::ProcessStop {})
        }
        CoreRequest::ProcessFileUri { window_id, blob_key } => Ok(CoreReply::ProcessFileUri {
            uri: client_blobs::file_uri(inner, &window_id, &blob_key)?,
        }),
        _ => unreachable!(),
    }
}

pub(crate) fn state_changed(inner: &Arc<Inner>) {
    let _guard = inner.processes.start.lock().unwrap();
    let scope = crate::server_switch::active_archive(inner);
    let deleted_windows = {
        let state = inner.state.lock().unwrap();
        let current = state
            .shared
            .windows
            .iter()
            .map(|window| (window.app_id.clone(), window.id.clone()))
            .collect::<HashSet<_>>();
        let mut previous = inner.processes.windows.lock().unwrap();
        let mut previous_archive = inner.processes.window_storage_archive.lock().unwrap();
        let deleted = if previous_archive.as_ref() == Some(&scope) {
            previous.difference(&current).cloned().collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        *previous = current;
        *previous_archive = Some(scope.clone());
        deleted
    };
    {
        let state = inner.state.lock().unwrap();
        inner.processes.pending.lock().unwrap().retain(|_, pending| {
            state.shared.windows.iter().find(|w| w.id == pending.window)
                .and_then(|w| app_commands::definition_for(&state.shared, &w.app_id, w.app_version))
                .is_some_and(|d| d.permissions.iter().any(|permission| matches!(permission, PermissionDecl::Process { id, .. } if id == &pending.permission)))
        });
    }
    let invalid: Vec<String> = {
        let state = inner.state.lock().unwrap();
        inner.processes.running.lock().unwrap().iter().filter_map(|(handle, p)| {
            if *p.scope.lock().unwrap() != scope { return None; }
            let valid = state.shared.windows.iter().find(|w| w.id == p.window).and_then(|w| app_commands::definition_for(&state.shared, &w.app_id, w.app_version)).is_some_and(|d| d.permissions.iter().any(|permission| matches!(permission, PermissionDecl::Process { id, .. } if id == &p.permission)) && d.client.as_ref().and_then(|c| c.process_permissions.as_ref()).is_some_and(|ids| ids.contains(&p.permission)));
            (!valid).then(|| handle.clone())
        }).collect()
    };
    for handle in invalid {
        if let Some(p) = inner.processes.running.lock().unwrap().remove(&handle) {
            revoke(inner, &handle);
            p.stop();
        }
    }
    for (app_id, window_id) in deleted_windows {
        client_blobs::remove_window_storage(&scope, &app_id, &window_id);
    }
}

pub(crate) fn shutdown(inner: &Arc<Inner>) {
    let _guard = inner.processes.start.lock().unwrap();
    inner.processes.pending.lock().unwrap().clear();
    let processes: Vec<_> = inner
        .processes
        .running
        .lock()
        .unwrap()
        .drain()
        .map(|(_, p)| p)
        .collect();
    for p in processes {
        revoke(inner, &p.handle);
        p.stop();
    }
    inner.processes.relay.lock().unwrap().take();
}

fn revoke(inner: &Inner, handle: &str) {
    if let Some(relay) = inner.processes.relay.lock().unwrap().as_ref() { relay.revoke(handle); }
}

pub(crate) fn rebind_unlinked(inner: &Inner, old_scope: &std::path::Path) {
    let new_scope = crate::server_switch::active_archive(inner);
    for process in inner.processes.running.lock().unwrap().values() {
        let mut scope = process.scope.lock().unwrap();
        if scope.as_path() == old_scope { *scope = new_scope.clone(); }
    }
}

pub(crate) fn server_changed(inner: &Arc<Inner>) {
    let _guard = inner.processes.start.lock().unwrap();
    if let Some(relay) = inner.processes.relay.lock().unwrap().as_ref() { relay.revoke_all(); }
    let processes: Vec<_> = inner.processes.running.lock().unwrap().values().cloned().collect();
    for process in processes {
        let mut services = process.services.lock().unwrap();
        if let Some(tools) = services.get_mut("tools") {
            *tools = None;
            drop(services);
            inner.emit(&CoreEvent::ProcessServicesChanged { window_id: process.window.clone(), handle: process.handle.clone() });
        }
    }
}
