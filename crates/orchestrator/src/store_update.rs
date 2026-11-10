//! 에이전트의 앱 갱신 요청을 기기 한 대에 보내고 결과를 받는다.
//!
//! `read_window`의 왕복(oneshot, request_id, 인증된 기기 POST, Drop 정리)을 따르되
//! 화면 조작과 섞지 않고 설치용 60초 작업 제한과 65초 서버 대기를 쓴다.
use super::*;
use axum::extract::{Extension, Path};
use kaleidoscope_contract::{
    errors, StoreUpdateRequest, StoreUpdateResponse, StoreUpdateResult, StoreUpdateStatus,
    UpdateAppFromStoreArgs, UpdateAppFromStoreResult, STORE_UPDATE_REGISTRY_VERSION,
};
use std::time::Instant;
use tokio::sync::oneshot;

const WAIT: Duration = Duration::from_secs(65);
const WORK_LIMIT_SECS: i64 = 60;
const REPLY_LIMIT: usize = 1024 * 1024;

fn device_offline(name: &str, id: &str) -> CoreError {
    errors::MCP_STORE_UPDATE_DEVICE_OFFLINE(name).and_details(vec![format!("device_id: {id}")])
}

fn version_unsupported(name: &str, id: &str) -> CoreError {
    errors::MCP_STORE_UPDATE_DEVICE_VERSION_UNSUPPORTED(name)
        .and_details(vec![format!("device_id: {id}")])
}

type Reply = Result<StoreUpdateResult, CoreError>;

struct Pending {
    device_id: String,
    device_name: String,
    sender: Option<oneshot::Sender<Reply>>,
    deadline: Instant,
}

#[derive(Default)]
pub(super) struct StoreUpdateState {
    pending: HashMap<String, Pending>,
}

struct PendingGuard {
    state: AppState,
    request_id: String,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.state
            .0
            .store_update
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pending
            .remove(&self.request_id);
    }
}

impl AppState {
    #[cfg(test)]
    pub(super) fn store_update_pending_count(&self) -> usize {
        self.0.store_update.lock().unwrap().pending.len()
    }

    /// 요청할 기기 한 대를 고른다. 대기 큐 없이 즉시 오류를 돌려준다.
    fn update_target(
        &self,
        principal: &McpPrincipal,
        explicit: Option<&str>,
        workspace: Option<&str>,
    ) -> Result<DeviceSummary, CoreError> {
        let devices = self.device_summaries()?;
        let device = match explicit {
            Some(id) => {
                let allowed = principal.device_id.as_ref().is_none_or(|own| own == id);
                if !allowed {
                    return Err(errors::MCP_STORE_UPDATE_DEVICE_FORBIDDEN());
                }
                devices
                    .into_iter()
                    .find(|device| device.id == id)
                    .ok_or_else(errors::MCP_STORE_UPDATE_DEVICE_FORBIDDEN)?
            }
            None => match principal.device_id.as_deref() {
                Some(id) => devices
                    .into_iter()
                    .find(|device| device.id == id)
                    .ok_or_else(errors::MCP_STORE_UPDATE_DEVICE_FORBIDDEN)?,
                None => devices
                    .into_iter()
                    .filter(|device| device.connected)
                    .filter(|device| {
                        workspace.is_none_or(|workspace| {
                            self.device_owns_workspace(&device.id, workspace)
                                .unwrap_or(false)
                        })
                    })
                    .max_by(|a, b| (&a.last_seen_at, &a.name).cmp(&(&b.last_seen_at, &b.name)))
                    .ok_or_else(errors::MCP_STORE_UPDATE_DEVICE_REQUIRED)?,
            },
        };
        if let Some(workspace) = workspace {
            if !self.mcp_owns_workspace(workspace)?
                || !self.device_owns_workspace(&device.id, workspace)?
            {
                return Err(errors::MCP_STORE_UPDATE_DEVICE_FORBIDDEN());
            }
        }
        if !device.connected || self.is_revoked(&device.id) {
            return Err(device_offline(&device.name, &device.id));
        }
        Ok(device)
    }

    fn device_supports_store_update(&self, id: &str) -> bool {
        self.0
            .window_control_versions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .is_some_and(|versions| {
                versions
                    .iter()
                    .any(|version| *version >= STORE_UPDATE_REGISTRY_VERSION)
            })
    }

    pub(crate) async fn update_app_from_store(
        &self,
        principal: McpPrincipal,
        args: UpdateAppFromStoreArgs,
    ) -> Result<UpdateAppFromStoreResult, CoreError> {
        let account = self.mcp_account_id()?;
        let workspace = args
            .workspace_id
            .clone()
            .or_else(|| principal.workspace_id.clone());
        let device = self.update_target(&principal, args.device_id.as_deref(), workspace.as_deref())?;
        let request_id = Uuid::new_v4().to_string();
        let request = StoreUpdateRequest {
            request_id: request_id.clone(),
            app_id: args.app_id.clone(),
            store_url: args.store_url.clone(),
            replace: args.replace.unwrap_or(false),
            expires_at: (Utc::now() + chrono::Duration::seconds(WORK_LIMIT_SECS))
                .to_rfc3339_opts(SecondsFormat::Millis, true),
        };
        let (sender, receiver) = oneshot::channel();
        {
            // 연결 종료 처리와 같은 순서로 잠가 등록 직후 끊기는 경우에도 대기를 정리한다.
            let connections = self.0.connections.lock().unwrap_or_else(|e| e.into_inner());
            if !connections.contains_key(&device.id) {
                return Err(device_offline(&device.name, &device.id));
            }
            if !self.device_supports_store_update(&device.id) {
                return Err(version_unsupported(&device.name, &device.id));
            }
            let mut update = self
                .0
                .store_update
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            update.pending.insert(
                request_id.clone(),
                Pending {
                    device_id: device.id.clone(),
                    device_name: device.name.clone(),
                    sender: Some(sender),
                    deadline: Instant::now() + WAIT,
                },
            );
            self.send_event_with_strict_open_target_for_account(
                DeviceEvent::StoreUpdateRequested { request },
                Some(device.id.clone()),
                &account,
            );
        }
        let _guard = PendingGuard {
            state: self.clone(),
            request_id: request_id.clone(),
        };
        let result = match tokio::time::timeout(WAIT, receiver).await {
            Ok(Ok(result)) => result?,
            Ok(Err(_)) => return Err(device_offline(&device.name, &device.id)),
            Err(_) => return Err(errors::MCP_STORE_UPDATE_TIMEOUT(&device.name)),
        };
        let mut output = UpdateAppFromStoreResult {
            request_id,
            device_id: device.id,
            app_id: args.app_id,
            status: StoreUpdateStatus::Installed,
            origin: None,
            version: None,
            consent_request_id: None,
        };
        match result {
            StoreUpdateResult::Installed { origin, version } => {
                output.origin = Some(origin);
                output.version = Some(version);
            }
            StoreUpdateResult::Unchanged { origin, version } => {
                output.status = StoreUpdateStatus::Unchanged;
                output.origin = Some(origin);
                output.version = Some(version);
            }
            StoreUpdateResult::ConsentRequired { consent_request_id } => {
                output.status = StoreUpdateStatus::ConsentRequired;
                output.consent_request_id = Some(consent_request_id);
            }
            StoreUpdateResult::Error { error } => return Err(error),
        }
        Ok(output)
    }

    pub(super) fn store_update_device_disconnected(&self, device: &str) {
        let mut update = self
            .0
            .store_update
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let ids: Vec<_> = update
            .pending
            .iter()
            .filter(|(_, pending)| pending.device_id == device)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(mut pending) = update.pending.remove(&id) {
                if let Some(sender) = pending.sender.take() {
                    let _ = sender.send(Err(device_offline(&pending.device_name, device)));
                }
            }
        }
    }
}

fn pending_status(state: &AppState, id: &str, device: &str) -> Result<(), (StatusCode, CoreError)> {
    let mut update = state
        .0
        .store_update
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(pending) = update.pending.get_mut(id) else {
        return Err((StatusCode::GONE, errors::MCP_STORE_UPDATE_REQUEST_UNKNOWN()));
    };
    if pending.device_id != device {
        return Err((
            StatusCode::FORBIDDEN,
            errors::MCP_STORE_UPDATE_REPLY_DEVICE_MISMATCH(),
        ));
    }
    if pending.sender.is_none() || Instant::now() >= pending.deadline {
        if let Some(sender) = pending.sender.take() {
            let _ = sender.send(Err(errors::MCP_STORE_UPDATE_TIMEOUT(&pending.device_name)));
        }
        return Err((StatusCode::GONE, errors::MCP_STORE_UPDATE_REQUEST_UNKNOWN()));
    }
    Ok(())
}

fn finish_reply(
    state: &AppState,
    id: &str,
    device: &str,
    result: Reply,
) -> Result<(), (StatusCode, CoreError)> {
    pending_status(state, id, device)?;
    let mut update = state
        .0
        .store_update
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(pending) = update.pending.get_mut(id) else {
        return Err((StatusCode::GONE, errors::MCP_STORE_UPDATE_REQUEST_UNKNOWN()));
    };
    if pending.device_id != device {
        return Err((
            StatusCode::FORBIDDEN,
            errors::MCP_STORE_UPDATE_REPLY_DEVICE_MISMATCH(),
        ));
    }
    if Instant::now() >= pending.deadline {
        return Err((StatusCode::GONE, errors::MCP_STORE_UPDATE_REQUEST_UNKNOWN()));
    }
    let Some(sender) = pending.sender.take() else {
        return Err((StatusCode::GONE, errors::MCP_STORE_UPDATE_REQUEST_UNKNOWN()));
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
            // 본문 한도를 넘은 응답도 대기를 닫아 MCP 요청이 시간 초과까지 남지 않게 한다.
            let result = finish_reply(
                &state,
                &id,
                &device,
                Err(errors::MCP_STORE_UPDATE_REPLY_INVALID()),
            );
            return match result {
                Ok(()) => http::error_response(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    errors::MCP_STORE_UPDATE_REPLY_INVALID(),
                ),
                Err((status, error)) => http::error_response(status, error),
            };
        }
    };
    let response: StoreUpdateResponse = match serde_json::from_slice(&bytes) {
        Ok(response) => response,
        Err(_) => {
            let result = finish_reply(
                &state,
                &id,
                &device,
                Err(errors::MCP_STORE_UPDATE_REPLY_INVALID()),
            );
            return match result {
                Ok(()) => http::error_response(
                    StatusCode::BAD_REQUEST,
                    errors::MCP_STORE_UPDATE_REPLY_INVALID(),
                ),
                Err((status, error)) => http::error_response(status, error),
            };
        }
    };
    if response.request_id != id {
        return http::error_response(
            StatusCode::FORBIDDEN,
            errors::MCP_STORE_UPDATE_REQUEST_UNKNOWN(),
        );
    }
    match finish_reply(&state, &id, &device, Ok(response.result)) {
        Ok(()) => Json(json!({})).into_response(),
        Err((status, error)) => http::error_response(status, error),
    }
}
