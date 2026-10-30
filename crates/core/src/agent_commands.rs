use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use kaleidoscope_contract::registry::{
    AgentCreateRequest, AgentSendRequest, DeviceAgentReply, AGENT_MESSAGE_MAX_CHARS,
};
use kaleidoscope_contract::{
    CoreError, CoreReply, CoreRequest, ErrorCode, LinkStatus, AGENT_ATTACHMENTS_MAX,
};

use crate::error;
use crate::link::{self, NOT_CONNECTED_MESSAGE};
use crate::registry_client::RegistryError;
use crate::Inner;

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    if uses_provider_window(&request) {
        return Err(error::make(ErrorCode::Unavailable));
    }
    let workspace_id = legacy_workspace_id(&request)?;
    let (workspace_id, link_file, workspace_name) = {
        let state = inner.state.lock().unwrap();
        let link_file = inner.link_file.lock().unwrap().clone();
        if !matches!(state.link, LinkStatus::Connected { .. }) || link_file.is_none() {
            return Err(link::server_error(NOT_CONNECTED_MESSAGE, Vec::new()));
        }
        let workspace = state
            .shared
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        (workspace_id, link_file.unwrap(), workspace.name.clone())
    };

    match request {
        CoreRequest::AgentGet { .. } => inner
            .registry
            .agent_get(&link_file.server_url, &link_file.token, &workspace_id)
            .map(|reply: DeviceAgentReply| CoreReply::AgentGet {
                agent: reply.agent,
                items: reply.items,
                models: reply.models,
            })
            .map_err(|registry_error| agent_error_to_core(inner, &link_file, registry_error)),
        CoreRequest::AgentCreate {
            model_preset: Some(model_preset),
            selected_model: None,
            ..
        } => inner
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
            .map(|agent| CoreReply::AgentCreate { agent })
            .map_err(|registry_error| agent_error_to_core(inner, &link_file, registry_error)),
        CoreRequest::AgentSend {
            text, attachments, ..
        } => {
            let text = text.trim();
            if (text.is_empty() && attachments.is_empty())
                || text.chars().count() > AGENT_MESSAGE_MAX_CHARS
                || attachments.len() > AGENT_ATTACHMENTS_MAX
            {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            let (attachments, sent_visuals) =
                crate::share::capture_for_agent_send(inner, &workspace_id, &attachments);
            match inner.registry.agent_send(
                &link_file.server_url,
                &link_file.token,
                &workspace_id,
                &AgentSendRequest {
                    text: text.to_string(),
                    attachments,
                },
            ) {
                Ok(()) => {
                    crate::share::mark_sent_visuals(inner, sent_visuals);
                    Ok(CoreReply::AgentSend {})
                }
                Err(registry_error) => Err(agent_error_to_core(inner, &link_file, registry_error)),
            }
        }
        CoreRequest::AgentAttachment {
            item_id: Some(item_id),
            index: Some(index),
            thread_id: None,
            attachment_id: None,
            ..
        } => {
            if !is_item_id(&item_id) {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            inner
                .registry
                .agent_attachment(
                    &link_file.server_url,
                    &link_file.token,
                    &workspace_id,
                    &item_id,
                    index,
                )
                .map(|attachment| CoreReply::AgentAttachment {
                    name: attachment.name,
                    mime: attachment.mime,
                    data_base64: attachment.data_base64,
                })
                .map_err(|registry_error| {
                    attachment_error_to_core(inner, &link_file, registry_error)
                })
        }
        CoreRequest::AgentAttachmentOpen {
            item_id: Some(item_id),
            index: Some(index),
            thread_id: None,
            attachment_id: None,
            ..
        } => {
            if !is_item_id(&item_id) {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            let attachment = inner
                .registry
                .agent_attachment(
                    &link_file.server_url,
                    &link_file.token,
                    &workspace_id,
                    &item_id,
                    index,
                )
                .map_err(|registry_error| {
                    attachment_error_to_core(inner, &link_file, registry_error)
                })?;
            let bytes = STANDARD.decode(&attachment.data_base64).map_err(|error| {
                error::io_error(&io::Error::new(io::ErrorKind::InvalidData, error))
            })?;
            let name = safe_attachment_name(&attachment.name);
            let path = save_attachment(&inner.data_dir, &item_id, index, &name, &bytes)?;
            if should_reveal(&name) {
                inner
                    .attachment_opener
                    .reveal(&path)
                    .map_err(|error| error::io_error(&error))?;
            } else {
                inner
                    .attachment_opener
                    .open(&path)
                    .map_err(|error| error::io_error(&error))?;
            }
            Ok(CoreReply::AgentAttachmentOpen {})
        }
        _ => return Err(error::make(ErrorCode::InvalidRequest)),
    }
}

fn uses_provider_window(request: &CoreRequest) -> bool {
    match request {
        CoreRequest::AgentGet { window_id, .. }
        | CoreRequest::AgentCreate { window_id, .. }
        | CoreRequest::AgentSend { window_id, .. }
        | CoreRequest::AgentAttachment { window_id, .. }
        | CoreRequest::AgentAttachmentOpen { window_id, .. } => window_id.is_some(),
        _ => false,
    }
}

fn legacy_workspace_id(request: &CoreRequest) -> Result<String, CoreError> {
    let (workspace_id, window_id) = match request {
        CoreRequest::AgentGet {
            workspace_id,
            window_id,
        }
        | CoreRequest::AgentCreate {
            workspace_id,
            window_id,
            ..
        }
        | CoreRequest::AgentSend {
            workspace_id,
            window_id,
            ..
        }
        | CoreRequest::AgentAttachment {
            workspace_id,
            window_id,
            ..
        }
        | CoreRequest::AgentAttachmentOpen {
            workspace_id,
            window_id,
            ..
        } => (workspace_id, window_id),
        _ => return Err(error::make(ErrorCode::InvalidRequest)),
    };
    if window_id.is_some() {
        return Err(error::make(ErrorCode::Unavailable));
    }
    workspace_id
        .clone()
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))
}

fn is_item_id(item_id: &str) -> bool {
    !item_id.is_empty() && item_id.bytes().all(|byte| byte.is_ascii_digit())
}

fn agent_error_to_core(
    inner: &Arc<Inner>,
    link_file: &crate::storage::LinkFile,
    registry_error: RegistryError,
) -> CoreError {
    match registry_error {
        RegistryError::Unauthorized => {
            link::token_rejected(inner, link_file.clone());
            link::server_error("기기 연결이 거부되었습니다.", Vec::new())
        }
        RegistryError::Validation(error) => error,
        error => link::registry_error_to_core(error, "kaleidoscope 서버에 닿지 않습니다"),
    }
}

fn attachment_error_to_core(
    inner: &Arc<Inner>,
    link_file: &crate::storage::LinkFile,
    registry_error: RegistryError,
) -> CoreError {
    match registry_error {
        RegistryError::Unauthorized => {
            link::token_rejected(inner, link_file.clone());
            link::server_error("기기 연결이 거부되었습니다.", Vec::new())
        }
        RegistryError::NotFound => error::make(ErrorCode::NotFound),
        RegistryError::Validation(error) => error,
        error => link::registry_error_to_core(error, "kaleidoscope 서버에 닿지 않습니다"),
    }
}

fn save_attachment(
    data_dir: &Path,
    item_id: &str,
    index: u32,
    name: &str,
    bytes: &[u8],
) -> Result<PathBuf, CoreError> {
    let directory = data_dir
        .join("attachments")
        .join(format!("{item_id}-{index}"));
    fs::create_dir_all(&directory).map_err(|error| error::io_error(&error))?;
    let path = directory.join(name);
    fs::write(&path, bytes).map_err(|error| error::io_error(&error))?;
    Ok(path)
}

fn safe_attachment_name(name: &str) -> String {
    let name: String = name
        .chars()
        .map(|character| {
            if "<>:\"/\\|?*".contains(character) || character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect();
    let name = name.trim_end_matches(|character| character == '.' || character == ' ');
    if name.is_empty() {
        "첨부".into()
    } else {
        name.into()
    }
}

fn should_reveal(name: &str) -> bool {
    const REVEAL_EXTENSIONS: &[&str] = &[
        "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jse", "wsf", "hta", "cpl",
        "lnk", "reg",
    ];
    let Some((_, extension)) = name.rsplit_once('.') else {
        return false;
    };
    !extension.is_empty()
        && REVEAL_EXTENSIONS
            .iter()
            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
}
