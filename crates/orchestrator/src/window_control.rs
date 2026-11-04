//! 같이 보기 창의 기기 왕복과 읽기 판을 관리한다.

use super::*;
use axum::extract::{Extension, Path};
use kaleidoscope_contract::{
    errors, ActWindowArgs, ReadWindowArgs, WindowAction, WindowControlMode, WindowControlOperation,
    WindowControlRequest, WindowControlResponse, WindowControlResult, WindowControlToolOutput,
};
use kaleidoscope_data::share::{text_change, TextChange};
use std::time::Instant;
use tokio::sync::oneshot;

const REPLY_LIMIT: usize = 15 * 1024 * 1024;
const WAIT: Duration = Duration::from_secs(15);

fn device_offline(name: &str, id: &str) -> CoreError {
    errors::MCP_WINDOW_CONTROL_DEVICE_OFFLINE(name).and_details(vec![format!("device_id: {id}")])
}

#[derive(Debug)]
pub(crate) struct ControlOutput {
    pub output: WindowControlToolOutput,
    pub image_base64: Option<String>,
}

#[derive(Debug)]
pub(crate) struct ControlError {
    pub error: CoreError,
    /// 기기가 실행 여부를 알려준 경우에만 채운다. 서버 시간 초과는 결과 미확인이다.
    pub applied: Option<bool>,
}

impl From<CoreError> for ControlError {
    fn from(error: CoreError) -> Self {
        Self {
            error,
            applied: None,
        }
    }
}

type Reply = Result<WindowControlResult, CoreError>;
struct Pending {
    device_id: String,
    device_name: String,
    window_id: String,
    sender: Option<oneshot::Sender<Reply>>,
    deadline: Instant,
}

#[derive(Default)]
pub(super) struct ControlState {
    pending: HashMap<String, Pending>,
    views: HashMap<(String, String), String>,
}

struct PendingGuard {
    state: AppState,
    request_id: String,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.state
            .0
            .window_control
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pending
            .remove(&self.request_id);
    }
}

impl AppState {
    #[cfg(test)]
    pub(super) fn control_pending_count(&self) -> usize {
        self.0.window_control.lock().unwrap().pending.len()
    }
    fn control_target(
        &self,
        principal: &McpPrincipal,
        window: &str,
        view_id: Option<&str>,
    ) -> Result<(String, share::SharedView), CoreError> {
        let devices = self.mcp_device_ids();
        let candidates = self
            .0
            .shares
            .lock()
            .map_err(|_| errors::SHARE_LIST_STATE_READ_FAILED())?
            .control_candidates(window);
        let mut eligible = Vec::new();
        for (device, view) in candidates {
            if !devices.contains(&device)
                || principal.device_id.as_ref().is_some_and(|id| id != &device)
                || principal
                    .workspace_id
                    .as_ref()
                    .is_some_and(|id| id != &view.workspace_id)
                || !self.mcp_owns_workspace(&view.workspace_id)?
            {
                continue;
            }
            eligible.push((device, view));
        }
        if let Some(view_id) = view_id {
            let control = self
                .0
                .window_control
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            eligible
                .into_iter()
                .find(|(device, _)| {
                    control
                        .views
                        .get(&(device.clone(), window.to_string()))
                        .is_some_and(|id| id == view_id)
                })
                .ok_or_else(|| errors::MCP_WINDOW_CONTROL_VIEW_UNKNOWN(window))
        } else {
            eligible
                .into_iter()
                .max_by(|a, b| {
                    (&a.1.updated_at, &a.1.device_name).cmp(&(&b.1.updated_at, &b.1.device_name))
                })
                .ok_or_else(|| errors::MCP_WINDOW_CONTROL_TARGET_UNAVAILABLE(window))
        }
    }

    pub(crate) async fn read_window(
        &self,
        principal: McpPrincipal,
        args: ReadWindowArgs,
    ) -> Result<ControlOutput, ControlError> {
        let image = args.image.unwrap_or(false);
        let target = self.control_target(&principal, &args.window_id, None)?;
        self.control_request(
            target,
            args.window_id,
            WindowControlOperation::Read { image },
            image,
            false,
        )
        .await
    }

    pub(crate) async fn act_window(
        &self,
        principal: McpPrincipal,
        args: ActWindowArgs,
    ) -> Result<ControlOutput, ControlError> {
        match &args.action {
            WindowAction::Type { text, .. } if text.len() > 16 * 1024 => {
                return Err(errors::MCP_WINDOW_CONTROL_TYPE_TEXT_TOO_LARGE(format!(
                    "{:.3} KiB",
                    text.len() as f64 / 1024.0
                ))
                .into());
            }
            WindowAction::Scroll { amount, .. } if !(1..=10000).contains(amount) => {
                return Err(errors::MCP_WINDOW_CONTROL_SCROLL_AMOUNT_OUT_OF_RANGE(amount).into());
            }
            _ => {}
        }
        let image = args.image.unwrap_or(false);
        let target = self.control_target(&principal, &args.window_id, Some(&args.view_id))?;
        self.control_request(
            target,
            args.window_id,
            WindowControlOperation::Act {
                view_id: args.view_id,
                action: args.action,
                image,
            },
            image,
            true,
        )
        .await
    }

    async fn control_request(
        &self,
        (device, view): (String, share::SharedView),
        window: String,
        operation: WindowControlOperation,
        image: bool,
        is_act: bool,
    ) -> Result<ControlOutput, ControlError> {
        let account = self.mcp_account_id()?;
        let request_id = Uuid::new_v4().to_string();
        let request = WindowControlRequest {
            request_id: request_id.clone(),
            window_id: window.clone(),
            expires_at: (Utc::now() + chrono::Duration::seconds(10))
                .to_rfc3339_opts(SecondsFormat::Millis, true),
            operation,
        };
        let (sender, receiver) = oneshot::channel();
        {
            // 연결 종료 처리와 같은 순서로 잠가 등록 직후 끊기는 경우에도 대기를 정리한다.
            let connections = self.0.connections.lock().unwrap_or_else(|e| e.into_inner());
            if !connections.contains_key(&device) {
                return Err(device_offline(&view.device_name, &device).into());
            }
            let shares = self
                .0
                .shares
                .lock()
                .map_err(|_| errors::SHARE_LIST_STATE_READ_FAILED())?;
            if !shares.contains(&device, &window) {
                return Err(errors::MCP_WINDOW_CONTROL_TARGET_UNAVAILABLE(&window).into());
            }
            let versions = self
                .0
                .window_control_versions
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if !versions
                .get(&device)
                .is_some_and(|versions| versions.iter().any(|version| *version >= 12))
            {
                return Err(errors::MCP_WINDOW_CONTROL_DEVICE_VERSION_UNSUPPORTED(
                    &view.device_name,
                )
                .into());
            }
            let mut control = self
                .0
                .window_control
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if control
                .pending
                .values()
                .any(|pending| pending.window_id == window)
            {
                return Err(errors::MCP_WINDOW_CONTROL_BUSY(&window).into());
            }
            if let WindowControlOperation::Act { view_id, .. } = &request.operation {
                if control.views.get(&(device.clone(), window.clone())) != Some(view_id) {
                    return Err(errors::MCP_WINDOW_CONTROL_VIEW_UNKNOWN(&window).into());
                }
            }
            control.pending.insert(
                request_id.clone(),
                Pending {
                    device_id: device.clone(),
                    device_name: view.device_name.clone(),
                    window_id: window.clone(),
                    sender: Some(sender),
                    deadline: Instant::now() + WAIT,
                },
            );
            self.send_event_with_strict_open_target_for_account(
                DeviceEvent::WindowControl { request },
                Some(device.clone()),
                &account,
            );
        }
        let _guard = PendingGuard {
            state: self.clone(),
            request_id,
        };
        let result = match tokio::time::timeout(WAIT, receiver).await {
            Ok(Ok(result)) => result?,
            Ok(Err(_)) => return Err(device_offline(&view.device_name, &device).into()),
            Err(_) => return Err(errors::MCP_WINDOW_CONTROL_TIMEOUT(&window).into()),
        };
        let value = match result {
            WindowControlResult::Ok { value } => value,
            WindowControlResult::Error { error, applied } => {
                return Err(ControlError {
                    error,
                    applied: Some(applied),
                })
            }
        };
        let after = value.after;
        let (mode, text) = if is_act {
            let before = value
                .before_text
                .ok_or_else(errors::MCP_WINDOW_CONTROL_REPLY_BODY_INVALID)?;
            match text_change(&before, &after.text) {
                TextChange::Unchanged => (WindowControlMode::Unchanged, String::new()),
                TextChange::Full(text) => (WindowControlMode::Full, text),
                TextChange::Diff(text) => (WindowControlMode::Diff, text),
            }
        } else {
            (WindowControlMode::Full, after.text.clone())
        };
        {
            let shares = self
                .0
                .shares
                .lock()
                .map_err(|_| errors::SHARE_LIST_STATE_READ_FAILED())?;
            if !shares.contains(&device, &window) {
                return Err(errors::MCP_WINDOW_CONTROL_TARGET_UNAVAILABLE(&window).into());
            }
            self.0
                .window_control
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .views
                .insert((device, window.clone()), after.view_id.clone());
        }
        if image && (after.image_base64.is_none() || after.geometry.is_none()) {
            return Err(ControlError {
                error: errors::SHARE_CONTROL_IMAGE_UNAVAILABLE(&window),
                applied: if is_act { Some(true) } else { None },
            });
        }
        Ok(ControlOutput {
            output: WindowControlToolOutput {
                window_id: window,
                device_name: view.device_name,
                app_name: after.app_name,
                window_title: after.window_title,
                view_id: after.view_id,
                mode,
                text,
                settled: after.settled,
                geometry: after.geometry,
            },
            image_base64: if image { after.image_base64 } else { None },
        })
    }

    pub(super) fn window_control_share_deleted(&self, device: &str, window: &str) {
        let mut control = self
            .0
            .window_control
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        control
            .views
            .remove(&(device.to_string(), window.to_string()));
        let ids: Vec<_> = control
            .pending
            .iter()
            .filter(|(_, p)| p.device_id == device && p.window_id == window)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(mut pending) = control.pending.remove(&id) {
                if let Some(sender) = pending.sender.take() {
                    let _ = sender.send(Err(errors::MCP_WINDOW_CONTROL_TARGET_UNAVAILABLE(window)));
                }
            }
        }
    }

    pub(super) fn window_control_device_disconnected(&self, device: &str) {
        let mut control = self
            .0
            .window_control
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        control.views.retain(|(id, _), _| id != device);
        let ids: Vec<_> = control
            .pending
            .iter()
            .filter(|(_, p)| p.device_id == device)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(mut pending) = control.pending.remove(&id) {
                if let Some(sender) = pending.sender.take() {
                    let _ = sender.send(Err(device_offline(&pending.device_name, device)));
                }
            }
        }
    }
}

fn pending_status(state: &AppState, id: &str, device: &str) -> Result<(), (StatusCode, CoreError)> {
    let mut control = state
        .0
        .window_control
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(pending) = control.pending.get_mut(id) else {
        return Err((StatusCode::GONE, errors::MCP_WINDOW_CONTROL_REPLY_EXPIRED()));
    };
    if pending.device_id != device {
        return Err((
            StatusCode::FORBIDDEN,
            errors::MCP_WINDOW_CONTROL_REPLY_OWNER_MISMATCH(),
        ));
    }
    if pending.sender.is_none() || Instant::now() >= pending.deadline {
        if let Some(sender) = pending.sender.take() {
            let _ = sender.send(Err(errors::MCP_WINDOW_CONTROL_TIMEOUT(&pending.window_id)));
        }
        return Err((StatusCode::GONE, errors::MCP_WINDOW_CONTROL_REPLY_EXPIRED()));
    }
    Ok(())
}

fn finish_reply(
    state: &AppState,
    id: &str,
    device: &str,
    window: Option<&str>,
    result: Reply,
) -> Result<(), (StatusCode, CoreError)> {
    pending_status(state, id, device)?;
    let mut control = state
        .0
        .window_control
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(pending) = control.pending.get_mut(id) else {
        return Err((StatusCode::GONE, errors::MCP_WINDOW_CONTROL_REPLY_EXPIRED()));
    };
    if pending.device_id != device || window.is_some_and(|window| pending.window_id != window) {
        return Err((
            StatusCode::FORBIDDEN,
            errors::MCP_WINDOW_CONTROL_REPLY_OWNER_MISMATCH(),
        ));
    }
    if Instant::now() >= pending.deadline {
        return Err((StatusCode::GONE, errors::MCP_WINDOW_CONTROL_REPLY_EXPIRED()));
    }
    let Some(sender) = pending.sender.take() else {
        return Err((StatusCode::GONE, errors::MCP_WINDOW_CONTROL_REPLY_EXPIRED()));
    };
    let _ = sender.send(result);
    Ok(())
}

pub(super) async fn device_reply(
    State(state): State<AppState>,
    Extension((device, _)): Extension<(String, String)>,
    Path(id): Path<String>,
    request: Request,
) -> Response {
    if let Err((status, error)) = pending_status(&state, &id, &device) {
        return http::error_response(status, error);
    }
    let bytes = match axum::body::to_bytes(request.into_body(), REPLY_LIMIT).await {
        Ok(bytes) => bytes,
        Err(_) => {
            let result = finish_reply(
                &state,
                &id,
                &device,
                None,
                Err(errors::MCP_WINDOW_CONTROL_REPLY_TOO_LARGE("15 MiB")),
            );
            return match result {
                Ok(()) => http::error_response(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    errors::MCP_WINDOW_CONTROL_REPLY_TOO_LARGE("15 MiB"),
                ),
                Err((s, e)) => http::error_response(s, e),
            };
        }
    };
    let response: WindowControlResponse = match serde_json::from_slice(&bytes) {
        Ok(response) => response,
        Err(_) => {
            let result = finish_reply(
                &state,
                &id,
                &device,
                None,
                Err(errors::MCP_WINDOW_CONTROL_REPLY_BODY_INVALID()),
            );
            return match result {
                Ok(()) => http::error_response(
                    StatusCode::BAD_REQUEST,
                    errors::MCP_WINDOW_CONTROL_REPLY_BODY_INVALID(),
                ),
                Err((s, e)) => http::error_response(s, e),
            };
        }
    };
    if response.request_id != id {
        return http::error_response(
            StatusCode::FORBIDDEN,
            errors::MCP_WINDOW_CONTROL_REPLY_OWNER_MISMATCH(),
        );
    }
    match finish_reply(
        &state,
        &id,
        &device,
        Some(&response.window_id),
        Ok(response.result),
    ) {
        Ok(()) => Json(json!({})).into_response(),
        Err((status, error)) => http::error_response(status, error),
    }
}
