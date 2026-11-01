//! ACP 알림과 설정을 화면의 범용 대화 형식으로 변환한다.
use super::{record, Emit, PromptInput, WorkerConfig, WorkerSnapshot};
use tokio::sync::mpsc;

use agent_client_protocol::{
    schema::v1::{
        self as acp, ContentBlock, RequestPermissionOutcome, RequestPermissionResponse,
        SelectedPermissionOutcome, SessionUpdate, ToolCallStatus,
    },
    Responder,
};
use kaleidoscope_contract::{
    conversation::{ConversationEvent, ConversationItemKind},
    local_agent::{
        AgentControl, AgentControlKind, AgentControlValue, ControlChoice, ControlChoiceGroup,
        LocalAgentUpdate, PermissionChoice, PermissionPrompt,
    },
};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

pub(super) enum Command {
    Send(
        PromptInput,
        std::sync::mpsc::SyncSender<Result<bool, kaleidoscope_contract::CoreError>>,
    ),
    Cancel,
    Configure(String, AgentControlValue),
    Authenticate(String),
    Retry,
    Shutdown,
    Finished(Result<(), agent_client_protocol::Error>),
}
pub(super) struct PendingPermission {
    pub(super) responder: Responder<RequestPermissionResponse>,
}
pub(super) struct State {
    pub(super) snapshot: WorkerSnapshot,
    pub(super) record: record::Record,
    pub(super) seen: HashSet<String>,
    pub(super) responders: HashMap<String, PendingPermission>,
    pub(super) tools: Vec<(String, String)>,
    pub(super) replay: bool,
    pub(super) guide_sent: bool,
}
pub(super) struct Shared {
    pub(super) state: Mutex<State>,
    pub(super) config: WorkerConfig,
    pub(super) emit: Emit,
    pub(super) tx: mpsc::UnboundedSender<Command>,
}
impl Shared {
    pub(super) fn publish_state(&self) {
        let s = self.state.lock().unwrap();
        let update = LocalAgentUpdate::State {
            phase: s.snapshot.phase,
            controls: s.snapshot.controls.clone(),
            auth_methods: s.snapshot.auth_methods.clone(),
            execution: None,
            failure: s.snapshot.failure.clone(),
        };
        drop(s);
        (self.emit)(update);
    }
    pub(super) fn persist(&self, state: &mut State) -> Result<(), agent_client_protocol::Error> {
        state
            .record
            .save(&self.config.record_dir)
            .map_err(|e| agent_client_protocol::Error::internal_error().data(e.message))
    }
    pub(super) fn append(
        &self,
        state: &mut State,
        kind: ConversationItemKind,
        id: String,
        text: String,
        attachments: Vec<kaleidoscope_contract::conversation::ConversationAttachment>,
    ) -> Result<LocalAgentUpdate, agent_client_protocol::Error> {
        let item = state.record.item(kind, id, text, attachments);
        state.snapshot.history = state.record.items.clone();
        self.persist(state)?;
        Ok(LocalAgentUpdate::Conversation {
            update: kaleidoscope_contract::conversation::ConversationEvent::Item { item },
        })
    }
}

pub(super) fn mcp(owner: &Shared, supported: bool) -> Vec<acp::McpServer> {
    match (&owner.config.mcp, supported) {
        (Some(m), true) => vec![acp::McpServer::Http(
            acp::McpServerHttp::new("kaleidoscope", m.url.clone()).headers(
                m.headers
                    .iter()
                    .map(|(k, v)| acp::HttpHeader::new(k.clone(), v.clone()))
                    .collect(),
            ),
        )],
        _ => vec![],
    }
}

pub(super) const MODEL: &str = "__legacy_model";
pub(super) const MODE: &str = "__legacy_mode";
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LegacyModels {
    current_model_id: String,
    available_models: Vec<LegacyModel>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyModel {
    model_id: String,
    name: String,
    #[allow(dead_code)]
    description: Option<String>,
}
fn group(name: Option<String>, options: Vec<ControlChoice>) -> ControlChoiceGroup {
    ControlChoiceGroup { name, options }
}
fn choice(id: String, name: String) -> ControlChoice {
    ControlChoice { id, name }
}
pub(super) fn controls(
    options: &[acp::SessionConfigOption],
    modes: Option<&acp::SessionModeState>,
    models: Option<&LegacyModels>,
) -> Vec<AgentControl> {
    let mut controls = Vec::new();
    for option in options {
        let category = option
            .category
            .as_ref()
            .and_then(|c| serde_json::to_value(c).ok())
            .and_then(|v| v.as_str().map(str::to_string));
        let (value, kind) = match &option.kind {
            acp::SessionConfigKind::Boolean(b) => (
                AgentControlValue::Boolean(b.current_value),
                AgentControlKind::Boolean,
            ),
            acp::SessionConfigKind::Select(select) => {
                let choices = match &select.options {
                    acp::SessionConfigSelectOptions::Ungrouped(opts) => vec![group(
                        None,
                        opts.iter()
                            .map(|o| choice(o.value.to_string(), o.name.clone()))
                            .collect(),
                    )],
                    acp::SessionConfigSelectOptions::Grouped(groups) => groups
                        .iter()
                        .map(|g| {
                            group(
                                Some(g.name.clone()),
                                g.options
                                    .iter()
                                    .map(|o| choice(o.value.to_string(), o.name.clone()))
                                    .collect(),
                            )
                        })
                        .collect(),
                    _ => vec![],
                };
                (
                    AgentControlValue::String(select.current_value.to_string()),
                    AgentControlKind::Select { options: choices },
                )
            }
            _ => continue,
        };
        controls.push(AgentControl {
            id: option.id.to_string(),
            label: option.name.clone(),
            category,
            value,
            kind,
        });
    }
    if !controls
        .iter()
        .any(|c| c.category.as_deref() == Some("model"))
    {
        if let Some(models) = models {
            controls.push(AgentControl {
                id: MODEL.into(),
                label: "모델".into(),
                category: Some("model".into()),
                value: AgentControlValue::String(models.current_model_id.clone()),
                kind: AgentControlKind::Select {
                    options: vec![group(
                        None,
                        models
                            .available_models
                            .iter()
                            .map(|m| choice(m.model_id.clone(), m.name.clone()))
                            .collect(),
                    )],
                },
            });
        }
    }
    if !controls
        .iter()
        .any(|c| c.category.as_deref() == Some("mode"))
    {
        if let Some(modes) = modes {
            controls.push(AgentControl {
                id: MODE.into(),
                label: "모드".into(),
                category: Some("mode".into()),
                value: AgentControlValue::String(modes.current_mode_id.to_string()),
                kind: AgentControlKind::Select {
                    options: vec![group(
                        None,
                        modes
                            .available_modes
                            .iter()
                            .map(|m| choice(m.id.to_string(), m.name.clone()))
                            .collect(),
                    )],
                },
            });
        }
    }
    controls
}
pub(super) fn accepts(control: &AgentControl, value: &AgentControlValue) -> bool {
    match (&control.kind, value) {
        (AgentControlKind::Boolean, AgentControlValue::Boolean(_)) => true,
        (AgentControlKind::Select { options }, AgentControlValue::String(value)) => options
            .iter()
            .flat_map(|g| &g.options)
            .any(|o| &o.id == value),
        _ => false,
    }
}
pub(super) fn replace_options(state: &mut State, options: &[acp::SessionConfigOption]) {
    let old: Vec<_> = state
        .snapshot
        .controls
        .iter()
        .filter(|c| c.id == MODEL || c.id == MODE)
        .cloned()
        .collect();
    let mut new = controls(options, None, None);
    for c in old {
        if !new.iter().any(|n| n.category == c.category) {
            new.push(c);
        }
    }
    state.snapshot.controls = new;
}
fn emit_activity(state: &mut super::State) -> LocalAgentUpdate {
    state.snapshot.activity.tool = state.tools.last().map(|(_, title)| title.clone());
    LocalAgentUpdate::Conversation {
        update: ConversationEvent::Activity {
            busy: state.snapshot.activity.busy,
            tool: state.snapshot.activity.tool.clone(),
        },
    }
}
pub(super) fn finish_text(
    owner: &Shared,
    state: &mut super::State,
) -> Result<Option<LocalAgentUpdate>, agent_client_protocol::Error> {
    if state.snapshot.text.is_empty() {
        return Ok(None);
    }
    let text = std::mem::take(&mut state.snapshot.text);
    let id = state
        .snapshot
        .stream_id
        .take()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    Ok(Some(owner.append(
        state,
        ConversationItemKind::Assistant,
        id,
        text,
        vec![],
    )?))
}
pub(super) fn notification(
    owner: &Arc<Shared>,
    notification: acp::SessionNotification,
) -> Result<(), agent_client_protocol::Error> {
    let mut state = owner.state.lock().unwrap();
    let replay = state.replay;
    let mut outgoing = Vec::new();
    match notification.update {
        SessionUpdate::AgentMessageChunk(chunk) if !replay => match chunk.content {
            ContentBlock::Text(text) => {
                state.snapshot.text.push_str(&text.text);
                let id = state
                    .snapshot
                    .stream_id
                    .get_or_insert_with(|| uuid::Uuid::new_v4().to_string())
                    .clone();
                outgoing.push(LocalAgentUpdate::Conversation {
                    update: ConversationEvent::Text {
                        stream_id: id,
                        text: state.snapshot.text.clone(),
                    },
                });
            }
            _ => outgoing.push(owner.append(
                &mut state,
                ConversationItemKind::Notice,
                uuid::Uuid::new_v4().to_string(),
                "이 답변의 미디어 형식은 지원하지 않습니다.".into(),
                vec![],
            )?),
        },
        SessionUpdate::ToolCall(call) if !replay => {
            if let Some(item) = finish_text(owner, &mut state)? {
                outgoing.push(item);
            }
            if !matches!(
                call.status,
                ToolCallStatus::Completed | ToolCallStatus::Failed
            ) {
                state
                    .tools
                    .push((call.tool_call_id.to_string(), call.title));
            }
            outgoing.push(emit_activity(&mut state));
        }
        SessionUpdate::ToolCallUpdate(call) if !replay => {
            let id = call.tool_call_id.to_string();
            if matches!(
                call.fields.status,
                Some(ToolCallStatus::Completed | ToolCallStatus::Failed)
            ) {
                state.tools.retain(|(k, _)| k != &id);
            } else if let Some(title) = call.fields.title {
                if let Some((_, old)) = state.tools.iter_mut().find(|(k, _)| k == &id) {
                    *old = title;
                }
            }
            outgoing.push(emit_activity(&mut state));
        }
        SessionUpdate::CurrentModeUpdate(mode) => {
            if let Some(c) = state.snapshot.controls.iter_mut().find(|c| c.id == MODE) {
                c.value = AgentControlValue::String(mode.current_mode_id.to_string());
            }
        }
        SessionUpdate::ConfigOptionUpdate(update) => {
            replace_options(&mut state, &update.config_options)
        }
        _ => {}
    }
    drop(state);
    for event in outgoing {
        (owner.emit)(event);
    }
    owner.publish_state();
    Ok(())
}
pub(super) fn permission(
    owner: &Arc<Shared>,
    request: acp::RequestPermissionRequest,
    responder: Responder<RequestPermissionResponse>,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let title = request
        .tool_call
        .fields
        .title
        .unwrap_or_else(|| "도구".into());
    let options = request
        .options
        .into_iter()
        .map(|o| PermissionChoice {
            id: o.option_id.to_string(),
            label: o.name,
            kind: serde_json::to_value(o.kind)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default(),
        })
        .collect();
    let mut state = owner.state.lock().unwrap();
    state.snapshot.permissions.push(PermissionPrompt {
        id: id.clone(),
        title,
        options,
    });
    state.responders.insert(id, PendingPermission { responder });
    let permissions = state.snapshot.permissions.clone();
    drop(state);
    (owner.emit)(LocalAgentUpdate::Permissions { permissions });
}
pub(super) fn answer(
    owner: &Arc<Shared>,
    id: &str,
    option: Option<&str>,
) -> Result<bool, agent_client_protocol::Error> {
    let mut state = owner.state.lock().unwrap();
    let Some(index) =
        state.snapshot.permissions.iter().position(|p| {
            p.id == id && option.is_none_or(|id| p.options.iter().any(|o| o.id == id))
        })
    else {
        return Ok(false);
    };
    let Some(pending) = state.responders.remove(id) else {
        return Ok(false);
    };
    let prompt = state.snapshot.permissions.remove(index);
    let label = option
        .and_then(|id| prompt.options.iter().find(|o| o.id == id))
        .map(|o| o.label.clone())
        .unwrap_or_else(|| "취소됨".into());
    let outcome = option
        .map(|id| {
            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                acp::PermissionOptionId::new(id.to_string()),
            ))
        })
        .unwrap_or(RequestPermissionOutcome::Cancelled);
    let result = pending
        .responder
        .respond(RequestPermissionResponse::new(outcome));
    let event = owner.append(
        &mut state,
        ConversationItemKind::Notice,
        uuid::Uuid::new_v4().to_string(),
        format!("{} · {}", prompt.title, label),
        vec![],
    )?;
    let permissions = state.snapshot.permissions.clone();
    drop(state);
    if let Err(e) = result {
        eprintln!("승인 응답 실패: {e}");
    }
    (owner.emit)(event);
    (owner.emit)(LocalAgentUpdate::Permissions { permissions });
    Ok(true)
}
pub(super) fn cancel_permissions(owner: &Arc<Shared>) {
    let ids: Vec<_> = owner
        .state
        .lock()
        .unwrap()
        .snapshot
        .permissions
        .iter()
        .map(|p| p.id.clone())
        .collect();
    for id in ids {
        if let Err(e) = answer(owner, &id, None) {
            eprintln!("승인 기록 실패: {e}");
        }
    }
}
