//! ACP 연결과 세션 하나를 소유하는 워커.
use super::{process::Process, prompt, updates, Command, Shared};
use crate::error;
use agent_client_protocol::{
    schema::{
        v1::{self as acp},
        ProtocolVersion,
    },
    Agent, Client, ConnectionTo, UntypedMessage,
};
use kaleidoscope_contract::{
    conversation::{ConversationEvent, ConversationItemKind},
    local_agent::{AgentControlValue, AgentFailure, AuthChoice, LocalAgentPhase, LocalAgentUpdate},
    ErrorCode,
};
use serde_json::Value;
use std::{collections::VecDeque, sync::Arc};
use tokio::sync::mpsc;

type AcpResult<T> = Result<T, agent_client_protocol::Error>;
fn fail(owner: &Shared, reason: &str) {
    let mut s = owner.state.lock().unwrap();
    s.snapshot.phase = LocalAgentPhase::Failed;
    s.snapshot.failure = Some(AgentFailure {
        code: ErrorCode::LocalAgentFailed,
        command: Some(owner.config.spec.command.clone()),
        message: format!("{}: {reason}", owner.config.spec.command),
    });
    s.snapshot.activity.busy = false;
    s.snapshot.activity.tool = None;
    s.snapshot.text.clear();
    s.snapshot.stream_id = None;
    s.tools.clear();
    s.snapshot.queued.clear();
    drop(s);
    owner.publish_state();
}
fn phase(owner: &Shared, phase: LocalAgentPhase) {
    let mut s = owner.state.lock().unwrap();
    s.snapshot.phase = phase;
    if phase == LocalAgentPhase::Starting {
        s.snapshot.failure = None;
    }
    drop(s);
    owner.publish_state();
}
async fn setup(
    conn: &ConnectionTo<Agent>,
    owner: &Arc<Shared>,
    caps: &acp::AgentCapabilities,
) -> AcpResult<Option<acp::SessionId>> {
    let prior = owner.state.lock().unwrap().record.session_id.clone();
    let servers = updates::mcp(owner, caps.mcp_capabilities.http);
    let mut loaded = false;
    let mut response: Option<Value> = None;
    if let Some(id) = prior.as_ref().filter(|_| caps.load_session) {
        owner.state.lock().unwrap().replay = true;
        let request =
            acp::LoadSessionRequest::new(acp::SessionId::new(id.clone()), owner.config.cwd.clone())
                .mcp_servers(servers.clone());
        let result = conn
            .send_request(UntypedMessage::new("session/load", request)?)
            .block_task()
            .await;
        owner.state.lock().unwrap().replay = false;
        match result {
            Ok(value) => {
                loaded = true;
                response = Some(value);
            }
            Err(e) if e.code == agent_client_protocol::ErrorCode::AuthRequired => return Ok(None),
            Err(_) => {}
        }
    }
    if !loaded {
        let request = acp::NewSessionRequest::new(owner.config.cwd.clone()).mcp_servers(servers);
        match conn
            .send_request(UntypedMessage::new("session/new", request)?)
            .block_task()
            .await
        {
            Ok(value) => response = Some(value),
            Err(e) if e.code == agent_client_protocol::ErrorCode::AuthRequired => return Ok(None),
            Err(e) => return Err(e),
        }
        if prior.is_some() {
            let mut s = owner.state.lock().unwrap();
            let update = owner.append(
                &mut s,
                ConversationItemKind::Notice,
                uuid::Uuid::new_v4().to_string(),
                "앞 대화를 이어받지 못했습니다. 새 세션을 시작합니다.".into(),
                vec![],
            )?;
            drop(s);
            (owner.emit)(update);
        }
    }
    let response = response.expect("setup response");
    let models: Option<updates::LegacyModels> = response
        .get("models")
        .and_then(|v| serde_json::from_value(v.clone()).ok());
    let (session, options, modes) = if loaded {
        let parsed: acp::LoadSessionResponse = serde_json::from_value(response)
            .map_err(|e| agent_client_protocol::Error::internal_error().data(e.to_string()))?;
        (
            acp::SessionId::new(prior.expect("loaded id")),
            parsed.config_options.unwrap_or_default(),
            parsed.modes,
        )
    } else {
        let parsed: acp::NewSessionResponse = serde_json::from_value(response)
            .map_err(|e| agent_client_protocol::Error::internal_error().data(e.to_string()))?;
        (
            parsed.session_id,
            parsed.config_options.unwrap_or_default(),
            parsed.modes,
        )
    };
    let controls = updates::controls(&options, modes.as_ref(), models.as_ref());
    let saved = {
        let mut s = owner.state.lock().unwrap();
        s.record.session_id = Some(session.to_string());
        s.snapshot.controls = controls;
        owner.persist(&mut s)?;
        s.record.controls.clone()
    };
    for (id, value) in saved {
        let eligible = owner
            .state
            .lock()
            .unwrap()
            .snapshot
            .controls
            .iter()
            .any(|c| c.id == id && updates::accepts(c, &value));
        if eligible {
            let _ = configure(conn, owner, &session, &id, value).await;
        }
    }
    phase(owner, LocalAgentPhase::Ready);
    Ok(Some(session))
}
async fn configure(
    conn: &ConnectionTo<Agent>,
    owner: &Arc<Shared>,
    session: &acp::SessionId,
    id: &str,
    value: AgentControlValue,
) -> AcpResult<()> {
    let mut options = None;
    if id == updates::MODEL {
        let AgentControlValue::String(model) = &value else {
            return Err(agent_client_protocol::Error::invalid_params());
        };
        conn.send_request(UntypedMessage::new(
            "session/set_model",
            serde_json::json!({"sessionId":session,"modelId":model}),
        )?)
        .block_task()
        .await?;
    } else if id == updates::MODE {
        let AgentControlValue::String(mode) = &value else {
            return Err(agent_client_protocol::Error::invalid_params());
        };
        conn.send_request(acp::SetSessionModeRequest::new(
            session.clone(),
            acp::SessionModeId::new(mode.clone()),
        ))
        .block_task()
        .await?;
    } else {
        let v = match &value {
            AgentControlValue::String(v) => acp::SessionConfigOptionValue::from(v.as_str()),
            AgentControlValue::Boolean(v) => acp::SessionConfigOptionValue::from(*v),
        };
        options = Some(
            conn.send_request(acp::SetSessionConfigOptionRequest::new(
                session.clone(),
                acp::SessionConfigId::new(id.to_string()),
                v,
            ))
            .block_task()
            .await?
            .config_options,
        );
    }
    let mut s = owner.state.lock().unwrap();
    if let Some(options) = options {
        updates::replace_options(&mut s, &options);
    }
    let Some(control) = s.snapshot.controls.iter_mut().find(|c| c.id == id) else {
        return Err(agent_client_protocol::Error::invalid_params());
    };
    if id == updates::MODEL || id == updates::MODE {
        control.value = value;
    }
    let confirmed = control.value.clone();
    s.record.controls.insert(id.into(), confirmed);
    owner.persist(&mut s)?;
    drop(s);
    owner.publish_state();
    Ok(())
}
async fn interrupt<T>(
    rx: &mut mpsc::UnboundedReceiver<Command>,
    pending: &mut VecDeque<Command>,
    future: impl std::future::Future<Output = AcpResult<T>>,
) -> Option<AcpResult<T>> {
    tokio::pin!(future);
    loop {
        tokio::select! {
            result = &mut future => return Some(result),
            command = rx.recv() => match command { Some(Command::Shutdown) | None => return None, Some(command) => pending.push_back(command) },
        }
    }
}
async fn session_loop(
    conn: ConnectionTo<Agent>,
    owner: Arc<Shared>,
    rx: &mut mpsc::UnboundedReceiver<Command>,
) -> AcpResult<()> {
    let mut pending = VecDeque::new();
    let Some(init) = interrupt(
        rx,
        &mut pending,
        conn.send_request(acp::InitializeRequest::new(ProtocolVersion::V1))
            .block_task(),
    )
    .await
    else {
        return Ok(());
    };
    let init = init?;
    {
        let mut s = owner.state.lock().unwrap();
        s.snapshot.auth_methods = init
            .auth_methods
            .iter()
            .filter_map(|a| match a {
                acp::AuthMethod::Agent(a)
                    if owner
                        .config
                        .spec
                        .auth_methods
                        .as_ref()
                        .is_none_or(|allowed| allowed.iter().any(|id| id == &a.id.to_string())) =>
                {
                    Some(AuthChoice {
                        id: a.id.to_string(),
                        name: a.name.clone(),
                        description: a.description.clone().unwrap_or_default(),
                    })
                }
                _ => None,
            })
            .collect();
    }
    let caps = init.agent_capabilities;
    let Some(result) = interrupt(rx, &mut pending, setup(&conn, &owner, &caps)).await else {
        return Ok(());
    };
    let mut session = result?;
    if session.is_none() {
        phase(&owner, LocalAgentPhase::LoginRequired);
    }
    let mut queue = VecDeque::new();
    let mut active = false;
    loop {
        let command = if let Some(command) = pending.pop_front() {
            command
        } else if let Some(command) = rx.recv().await {
            command
        } else {
            break;
        };
        match command {
            Command::Shutdown => {
                updates::cancel_permissions(&owner);
                if let Some(id) = &session {
                    let _ = conn.send_notification(acp::CancelNotification::new(id.clone()));
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                return Ok(());
            }
            Command::Authenticate(id) if session.is_none() => {
                let Some(result) = interrupt(
                    rx,
                    &mut pending,
                    conn.send_request(acp::AuthenticateRequest::new(acp::AuthMethodId::new(id)))
                        .block_task(),
                )
                .await
                else {
                    return Ok(());
                };
                match result {
                    Ok(_) => {
                        phase(&owner, LocalAgentPhase::Starting);
                        let Some(result) =
                            interrupt(rx, &mut pending, setup(&conn, &owner, &caps)).await
                        else {
                            return Ok(());
                        };
                        session = result?;
                        if session.is_none() {
                            phase(&owner, LocalAgentPhase::LoginRequired);
                        }
                    }
                    Err(e) => {
                        let mut s = owner.state.lock().unwrap();
                        s.snapshot.failure = Some(AgentFailure {
                            code: ErrorCode::LoginRequired,
                            message: e.message,
                            command: Some(owner.config.spec.command.clone()),
                        });
                        drop(s);
                        owner.publish_state();
                    }
                }
            }
            Command::Configure(id, value) if !active => {
                if let Some(session) = &session {
                    let Some(result) = interrupt(
                        rx,
                        &mut pending,
                        configure(&conn, &owner, session, &id, value),
                    )
                    .await
                    else {
                        return Ok(());
                    };
                    if let Err(e) = result {
                        eprintln!("설정 실패: {e}");
                    }
                }
            }
            Command::Send(input, reply) => {
                let mut s = owner.state.lock().unwrap();
                if !matches!(
                    s.snapshot.phase,
                    LocalAgentPhase::Ready | LocalAgentPhase::Responding
                ) {
                    let _ = reply.send(Err(error::make(ErrorCode::InvalidRequest)));
                } else if s.seen.contains(&input.request_id) {
                    let queued = s.snapshot.queued.iter().any(|q| q.id == input.request_id);
                    let _ = reply.send(Ok(queued));
                } else if active {
                    s.seen.insert(input.request_id.clone());
                    s.snapshot
                        .queued
                        .push(kaleidoscope_contract::local_agent::QueuedMessage {
                            id: input.request_id.clone(),
                            text: input.text.clone(),
                            attachments: input
                                .uploads
                                .iter()
                                .enumerate()
                                .map(|(i, a)| {
                                    kaleidoscope_contract::conversation::ConversationAttachment {
                                        id: i.to_string(),
                                        name: a.name.clone(),
                                        mime: a.mime.clone(),
                                    }
                                })
                                .collect(),
                        });
                    let queued = s.snapshot.queued.clone();
                    queue.push_back(input);
                    drop(s);
                    (owner.emit)(LocalAgentUpdate::Queue { queued });
                    let _ = reply.send(Ok(true));
                } else {
                    drop(s);
                    let result = match session.clone() {
                        Some(id) => {
                            prompt::begin(&conn, &owner, id, input, caps.prompt_capabilities.image)
                                .map(|()| {
                                    active = true;
                                    false
                                })
                        }
                        None => Err(error::make(ErrorCode::InvalidRequest)),
                    };
                    let _ = reply.send(result);
                }
            }
            Command::Cancel => {
                updates::cancel_permissions(&owner);
                if active {
                    if let Some(id) = &session {
                        conn.send_notification(acp::CancelNotification::new(id.clone()))?;
                    }
                }
            }
            Command::Finished(result) => {
                result?;
                active = false;
                updates::cancel_permissions(&owner);
                let mut s = owner.state.lock().unwrap();
                let event = updates::finish_text(&owner, &mut s)?;
                s.snapshot.activity.busy = false;
                s.snapshot.activity.tool = None;
                s.tools.clear();
                owner.persist(&mut s)?;
                drop(s);
                if let Some(event) = event {
                    (owner.emit)(event);
                }
                (owner.emit)(LocalAgentUpdate::Conversation {
                    update: ConversationEvent::Activity {
                        busy: false,
                        tool: None,
                    },
                });
                if let Some(input) = queue.pop_front() {
                    if let Some(id) = session.clone() {
                        prompt::begin(&conn, &owner, id, input, caps.prompt_capabilities.image)
                            .map_err(|e| {
                                agent_client_protocol::Error::internal_error().data(e.message)
                            })?;
                        active = true;
                    }
                } else {
                    phase(&owner, LocalAgentPhase::Ready);
                }
            }
            _ => {}
        }
    }
    Ok(())
}
pub(super) async fn run(owner: Arc<Shared>, mut rx: mpsc::UnboundedReceiver<Command>) {
    loop {
        phase(&owner, LocalAgentPhase::Starting);
        match Process::spawn(&owner.config) {
            Ok((mut process, transport)) => {
                let n = owner.clone();
                let p = owner.clone();
                let main = owner.clone();
                let builder = Client
                    .builder()
                    .on_receive_notification(
                        async move |event: acp::SessionNotification, _cx| {
                            updates::notification(&n, event)
                        },
                        agent_client_protocol::on_receive_notification!(),
                    )
                    .on_receive_request(
                        async move |request: acp::RequestPermissionRequest, responder, _cx| {
                            updates::permission(&p, request, responder);
                            Ok(())
                        },
                        agent_client_protocol::on_receive_request!(),
                    )
                    .on_close(async move |_cx| {
                        Err(agent_client_protocol::Error::internal_error()
                            .data("에이전트 연결 종료"))
                    });
                let result = builder
                    .connect_with(transport, async |conn| {
                        session_loop(conn, main.clone(), &mut rx).await
                    })
                    .await;
                updates::cancel_permissions(&owner);
                process.stop().await;
                if let Err(e) = result {
                    let tail = process
                        .stderr
                        .lock()
                        .unwrap()
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" · ");
                    fail(&owner, &format!("{e} {tail}"));
                } else {
                    phase(&owner, LocalAgentPhase::Ended);
                    return;
                }
            }
            Err(e) => fail(&owner, &e.to_string()),
        }
        // 실패 시 자동 재전송이나 재시작 없이 명시적 retry를 기다린다.
        loop {
            match rx.recv().await {
                Some(Command::Retry) => break,
                Some(Command::Send(_, reply)) => {
                    let _ = reply.send(Err(error::make(ErrorCode::LocalAgentFailed)));
                }
                Some(Command::Shutdown) | None => {
                    phase(&owner, LocalAgentPhase::Ended);
                    return;
                }
                _ => {}
            }
        }
    }
}
