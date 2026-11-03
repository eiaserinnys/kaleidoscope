//! 창과 실행 권한에 묶인 기기 프로세스 호스트.
mod stream;
use crate::{app_commands, files, Inner};
use kaleidoscope_contract::{
    errors,
    process::{spec_hash, ProcessAccess, ProcessSnapshot, ProcessStartResult},
    CoreError, CoreEvent, CoreReply, CoreRequest, PermissionDecl,
};
use std::{
    collections::{BTreeMap, HashMap},
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
    start: Mutex<()>,
}

fn context(
    inner: &Inner,
    window: &str,
    permission: &str,
    cwd_permission: &str,
) -> Result<(String, std::path::PathBuf), CoreError> {
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
    Ok((
        item.app_id.clone(),
        files::granted_root(&state, window, cwd_permission, false)?,
    ))
}

fn find(inner: &Inner, window: &str, handle: &str) -> Option<Arc<Running>> {
    inner
        .processes
        .running
        .lock()
        .unwrap()
        .get(handle)
        .filter(|p| p.window == window)
        .cloned()
}

fn by_key(inner: &Inner, window: &str, key: &str) -> Option<Arc<Running>> {
    inner
        .processes
        .running
        .lock()
        .unwrap()
        .values()
        .find(|p| p.window == window && p.key == key)
        .cloned()
}

fn snapshot(p: &Running) -> ProcessSnapshot {
    let state = p.state.lock().unwrap();
    ProcessSnapshot {
        handle: p.handle.clone(),
        after: state.after,
        checkpoint: state.checkpoint.clone(),
        cwd: p.cwd.clone(),
        services: BTreeMap::new(),
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
            if !services.is_empty() {
                return Err(errors::PROCESS_START_SERVICES_UNSUPPORTED());
            }
            let (app_id, _) = context(inner, &window_id, &permission, &cwd_permission)?;
            if let Some(p) = by_key(inner, &window_id, &key) {
                if p.state.lock().unwrap().exit.is_none() {
                    return Ok(CoreReply::ProcessStart {
                        result: ProcessStartResult::Started {
                            handle: p.handle.clone(),
                            cwd: p.cwd.clone(),
                            services: BTreeMap::new(),
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
                    context(inner, &window_id, &permission, &cwd_permission)?;
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
                let (current_app, _) = context(inner, &window_id, &permission, &cwd_permission)?;
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
            let (_, cwd) = context(inner, &window_id, &permission, &cwd_permission)?;
            if let Some(p) = by_key(inner, &window_id, &key) {
                if p.state.lock().unwrap().exit.is_none() {
                    return Ok(CoreReply::ProcessStart {
                        result: ProcessStartResult::Started {
                            handle: p.handle.clone(),
                            cwd: p.cwd.clone(),
                            services: BTreeMap::new(),
                        },
                    });
                }
                inner.processes.running.lock().unwrap().remove(&p.handle);
                p.stop();
            }
            let p = Running::launch(inner, window_id, key, permission, spec, cwd)?;
            let result = ProcessStartResult::Started {
                handle: p.handle.clone(),
                cwd: p.cwd.clone(),
                services: BTreeMap::new(),
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
            p.stop();
            Ok(CoreReply::ProcessStop {})
        }
        _ => unreachable!(),
    }
}

pub(crate) fn state_changed(inner: &Arc<Inner>) {
    let _guard = inner.processes.start.lock().unwrap();
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
            let valid = state.shared.windows.iter().find(|w| w.id == p.window).and_then(|w| app_commands::definition_for(&state.shared, &w.app_id, w.app_version)).is_some_and(|d| d.permissions.iter().any(|permission| matches!(permission, PermissionDecl::Process { id, .. } if id == &p.permission)) && d.client.as_ref().and_then(|c| c.process_permissions.as_ref()).is_some_and(|ids| ids.contains(&p.permission)));
            (!valid).then(|| handle.clone())
        }).collect()
    };
    for handle in invalid {
        if let Some(p) = inner.processes.running.lock().unwrap().remove(&handle) {
            p.stop();
        }
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
        p.stop();
    }
}
