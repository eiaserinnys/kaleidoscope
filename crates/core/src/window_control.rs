use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::{link, share, Inner};
use kaleidoscope_contract::{
    errors, CoreError, CoreEvent, CoreReply, CoreRequest, WindowControlOperation,
    WindowControlRequest, WindowControlResponse, WindowControlResult,
};

#[derive(Default)]
pub(crate) struct WindowControlRuntime {
    pending: Mutex<HashMap<String, Pending>>,
    pub(crate) saved_isolated: Mutex<HashMap<String, share::IsolatedCapture>>,
}

#[derive(Clone)]
struct Pending {
    window_id: String,
    generation: u64,
    app_name: String,
    window_title: String,
    operation: WindowControlOperation,
    started_at: Instant,
}

struct WindowInfo {
    app_name: String,
    window_title: String,
    is_web_view: bool,
}

fn gate(inner: &Inner, window_id: &str) -> Result<WindowInfo, CoreError> {
    let state = inner.state.lock().unwrap();
    let window = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)
        .ok_or_else(|| errors::SHARE_CONTROL_WINDOW_NOT_FOUND(window_id))?;
    if !share::is_sharing(&state, window_id) {
        return Err(errors::SHARE_CONTROL_NOT_SHARED(window_id));
    }
    let desktop = state
        .shared
        .desktops
        .iter()
        .find(|desktop| desktop.id == window.desktop_id);
    let active = desktop.is_some_and(|desktop| {
        state.device.active_workspace_id.as_deref() == Some(desktop.workspace_id.as_str())
            && state.device.active_desktop_ids.get(&desktop.workspace_id) == Some(&desktop.id)
    });
    if !active {
        return Err(errors::SHARE_CONTROL_DESKTOP_INACTIVE(window_id));
    }
    let app = state.shared.apps.iter().find(|app| app.id == window.app_id);
    let app_name = app.map(|app| app.name.clone()).unwrap_or_default();
    let window_title = app
        .and_then(|app| {
            crate::app_commands::definition_for(&state.shared, &app.id, app.current_version)
        })
        .map(|definition| definition.name)
        .unwrap_or_else(|| app_name.clone());
    Ok(WindowInfo {
        app_name,
        window_title,
        is_web_view: crate::web::window_web(&state, window_id).is_ok(),
    })
}

fn expired(request: &WindowControlRequest) -> Result<(), CoreError> {
    let valid = chrono::DateTime::parse_from_rfc3339(&request.expires_at)
        .is_ok_and(|deadline| deadline > chrono::Utc::now());
    if valid {
        Ok(())
    } else {
        Err(errors::SHARE_CONTROL_REQUEST_EXPIRED(&request.window_id))
    }
}

fn post(inner: &Inner, generation: u64, response: &WindowControlResponse) {
    if !link::is_current(inner, generation) {
        return;
    }
    let file = inner.link_file.lock().unwrap().clone();
    if let Some(file) = file {
        if let Err(error) =
            inner
                .registry
                .post_window_control_response(&file.server_url, &file.token, response)
        {
            eprintln!("창 제어 응답 전송 실패: {error:?}");
        }
    }
}

fn fill(result: &mut WindowControlResult, app_name: &str, window_title: &str) {
    if let WindowControlResult::Ok { value } = result {
        if value.after.app_name.is_empty() {
            value.after.app_name = app_name.to_owned();
        }
        if value.after.window_title.is_empty() {
            value.after.window_title = window_title.to_owned();
        }
    }
}

fn applied(result: &WindowControlResult, operation: &WindowControlOperation) -> bool {
    match result {
        WindowControlResult::Ok { .. } => matches!(operation, WindowControlOperation::Act { .. }),
        WindowControlResult::Error { applied, .. } => *applied,
    }
}

pub(crate) fn handle_device_event(
    inner: &Arc<Inner>,
    generation: u64,
    request: WindowControlRequest,
) {
    if !link::is_current(inner, generation) {
        return;
    }
    state_changed(inner);
    let info = expired(&request).and_then(|()| gate(inner, &request.window_id));
    let info = match info {
        Ok(info) => info,
        Err(error) => {
            let inner = Arc::clone(inner);
            std::thread::spawn(move || {
                post(
                    &inner,
                    generation,
                    &WindowControlResponse {
                        request_id: request.request_id,
                        window_id: request.window_id,
                        result: WindowControlResult::Error {
                            error,
                            applied: false,
                        },
                    },
                )
            });
            return;
        }
    };
    if info.is_web_view {
        let inner = Arc::clone(inner);
        std::thread::spawn(move || {
            if !link::is_current(&inner, generation) {
                return;
            }
            let mut result = gate(&inner, &request.window_id)
                .and_then(|_| {
                    inner
                        .host
                        .web()
                        .ok_or_else(|| errors::WEB_CONTROL_PLATFORM_UNSUPPORTED(&request.window_id))
                })
                .and_then(|web| web.control(&request.window_id, &request.operation))
                .unwrap_or_else(|error| WindowControlResult::Error {
                    error,
                    applied: false,
                });
            if !link::is_current(&inner, generation) {
                return;
            }
            if let Err(error) = gate(&inner, &request.window_id) {
                let applied = applied(&result, &request.operation);
                result = WindowControlResult::Error { error, applied };
            }
            fill(&mut result, &info.app_name, &info.window_title);
            post(
                &inner,
                generation,
                &WindowControlResponse {
                    request_id: request.request_id,
                    window_id: request.window_id,
                    result,
                },
            );
        });
        return;
    }
    let mut pending = inner.window_control.pending.lock().unwrap();
    if pending.contains_key(&request.request_id) {
        return;
    }
    pending.insert(
        request.request_id.clone(),
        Pending {
            window_id: request.window_id.clone(),
            generation,
            app_name: info.app_name,
            window_title: info.window_title,
            operation: request.operation.clone(),
            started_at: Instant::now(),
        },
    );
    drop(pending);
    inner.emit(&CoreEvent::WindowControl { request });
}

fn unexpected(request_id: &str) -> CoreError {
    errors::SHARE_CONTROL_RESPONSE_UNEXPECTED()
        .and_details(vec![format!("request_id: {request_id}")])
}

fn get_pending(inner: &Inner, request_id: &str, window_id: &str) -> Result<Pending, CoreError> {
    let pending = inner.window_control.pending.lock().unwrap();
    pending
        .get(request_id)
        .filter(|pending| {
            pending.window_id == window_id && link::is_current(inner, pending.generation)
        })
        .cloned()
        .ok_or_else(|| unexpected(request_id))
}

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    match request {
        CoreRequest::WindowControlCapture {
            request_id,
            window_id,
            bounds,
        } => {
            get_pending(inner, &request_id, &window_id)?;
            gate(inner, &window_id)?;
            let (image_base64, geometry) = share::capture_for_control(inner, &window_id, bounds)?;
            Ok(CoreReply::WindowControlCapture {
                image_base64,
                geometry,
            })
        }
        CoreRequest::WebControl {
            request_id,
            window_id,
            operation,
        } => {
            get_pending(inner, &request_id, &window_id)?;
            gate(inner, &window_id)?;
            let web = inner
                .host
                .web()
                .ok_or_else(|| errors::WEB_CONTROL_PLATFORM_UNSUPPORTED(&window_id))?;
            Ok(CoreReply::WebControl {
                result: web.control(&window_id, &operation)?,
            })
        }
        CoreRequest::WindowControlRespond { mut response } => {
            let pending = {
                let mut entries = inner.window_control.pending.lock().unwrap();
                if !entries
                    .get(&response.request_id)
                    .is_some_and(|entry| entry.window_id == response.window_id)
                {
                    return Err(unexpected(&response.request_id));
                }
                entries.remove(&response.request_id).unwrap()
            };
            if !link::is_current(inner, pending.generation) {
                return Ok(CoreReply::WindowControlRespond {});
            }
            if let Err(error) = gate(inner, &response.window_id) {
                let applied = applied(&response.result, &pending.operation);
                response.result = WindowControlResult::Error { error, applied };
            }
            fill(
                &mut response.result,
                &pending.app_name,
                &pending.window_title,
            );
            post(inner, pending.generation, &response);
            Ok(CoreReply::WindowControlRespond {})
        }
        _ => unreachable!(),
    }
}

pub(crate) fn state_changed(inner: &Inner) {
    let generation = inner.generation.load(Ordering::SeqCst);
    inner
        .window_control
        .pending
        .lock()
        .unwrap()
        .retain(|_, pending| {
            pending.generation == generation
                && pending.started_at.elapsed() < Duration::from_secs(15)
        });
}
