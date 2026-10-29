use std::sync::Arc;

use kaleidoscope_contract::registry::{
    AgentCreateRequest, AgentSendRequest, DeviceAgentReply, AGENT_MESSAGE_MAX_CHARS,
};
use kaleidoscope_contract::{CoreError, CoreReply, CoreRequest, ErrorCode, LinkStatus};

use crate::error;
use crate::link::{self, NOT_CONNECTED_MESSAGE};
use crate::registry_client::RegistryError;
use crate::Inner;

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    let (workspace_id, link_file, workspace_name) = {
        let state = inner.state.lock().unwrap();
        let link_file = inner.link_file.lock().unwrap().clone();
        if !matches!(state.link, LinkStatus::Connected { .. }) || link_file.is_none() {
            return Err(link::server_error(NOT_CONNECTED_MESSAGE, Vec::new()));
        }
        let workspace_id = match &request {
            CoreRequest::AgentGet { workspace_id }
            | CoreRequest::AgentCreate { workspace_id, .. }
            | CoreRequest::AgentSend { workspace_id, .. } => workspace_id,
            _ => return Err(error::make(ErrorCode::InvalidRequest)),
        };
        let workspace = state
            .shared
            .workspaces
            .iter()
            .find(|workspace| workspace.id == *workspace_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        (
            workspace.id.clone(),
            link_file.unwrap(),
            workspace.name.clone(),
        )
    };

    let result = match request {
        CoreRequest::AgentGet { .. } => inner
            .registry
            .agent_get(&link_file.server_url, &link_file.token, &workspace_id)
            .map(|reply: DeviceAgentReply| CoreReply::AgentGet {
                agent: reply.agent,
                items: reply.items,
                models: reply.models,
            }),
        CoreRequest::AgentCreate { model_preset, .. } => inner
            .registry
            .agent_create(
                &link_file.server_url,
                &link_file.token,
                &workspace_id,
                &AgentCreateRequest {
                    workspace_name,
                    model_preset,
                },
            )
            .map(|agent| CoreReply::AgentCreate { agent }),
        CoreRequest::AgentSend { text, .. } => {
            let text = text.trim();
            if text.is_empty() || text.chars().count() > AGENT_MESSAGE_MAX_CHARS {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            inner
                .registry
                .agent_send(
                    &link_file.server_url,
                    &link_file.token,
                    &workspace_id,
                    &AgentSendRequest {
                        text: text.to_string(),
                    },
                )
                .map(|()| CoreReply::AgentSend {})
        }
        _ => return Err(error::make(ErrorCode::InvalidRequest)),
    };

    match result {
        Ok(reply) => Ok(reply),
        Err(RegistryError::Unauthorized) => {
            link::token_rejected(inner, link_file);
            Err(link::server_error(
                "기기 연결이 거부되었습니다.",
                Vec::new(),
            ))
        }
        Err(RegistryError::Validation(error)) => Err(error),
        Err(error) => Err(link::registry_error_to_core(
            error,
            "kaleidoscope 서버에 닿지 않습니다",
        )),
    }
}
