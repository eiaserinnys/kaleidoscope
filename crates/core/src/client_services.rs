//! 격리 클라이언트의 지침과 전송 전 같이 보기 준비.
use crate::{app_commands, share, Inner};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    client::{ClientCapability, ContextAttachments, ContextImage},
    errors, CoreError, CoreReply, CoreRequest,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Mutex,
};

type RequestKey = (String, String);
struct Prepared {
    request_id: String,
    ticket: String,
    pending: Option<Pending>,
}
struct Pending {
    attachments: ContextAttachments,
    text: Option<String>,
    images: Vec<ContextImage>,
    conversation: String,
    sent_text: Option<BTreeMap<String, kaleidoscope_data::share::SentView>>,
    sent_visuals: Vec<(String, String)>,
}
#[derive(Default)]
pub(crate) struct ClientServices {
    prepared: Mutex<HashMap<RequestKey, Prepared>>,
}

fn authorize(
    inner: &Inner,
    window: &str,
    capability: ClientCapability,
) -> Result<String, CoreError> {
    let state = inner.state.lock().unwrap();
    let item = state
        .shared
        .windows
        .iter()
        .find(|item| item.id == window)
        .ok_or_else(|| match capability {
            ClientCapability::Instructions => errors::APP_INSTRUCTIONS_WINDOW_NOT_FOUND(),
            _ => errors::SHARE_CONTEXT_WINDOW_NOT_FOUND(),
        })?;
    let definition = app_commands::definition_for(&state.shared, &item.app_id, item.app_version)
        .ok_or_else(errors::SHARE_CLIENT_APP_NOT_FOUND)?;
    if !definition
        .client
        .as_ref()
        .and_then(|client| client.capabilities.as_ref())
        .is_some_and(|capabilities| capabilities.contains(&capability))
    {
        return Err(match capability {
            ClientCapability::Instructions => errors::APP_INSTRUCTIONS_CAPABILITY_UNDECLARED(),
            _ => errors::SHARE_CONTEXT_CAPABILITY_UNDECLARED(),
        });
    }
    let desktop = state
        .shared
        .desktops
        .iter()
        .find(|desktop| desktop.id == item.desktop_id)
        .ok_or_else(errors::SHARE_CLIENT_DESKTOP_NOT_FOUND)?;
    Ok(desktop.workspace_id.clone())
}

pub(crate) fn handle(inner: &Inner, request: CoreRequest) -> Result<CoreReply, CoreError> {
    match request {
        CoreRequest::HostInstructions { window_id, kind } => {
            authorize(inner, &window_id, ClientCapability::Instructions)?;
            if kind != "app_authoring" {
                return Err(errors::APP_INSTRUCTIONS_KIND_UNKNOWN(kind));
            }
            let text = kaleidoscope_contract::APP_AUTHORING_GUIDE.to_owned();
            let hash = format!("{:x}", Sha256::digest(text.as_bytes()));
            Ok(CoreReply::HostInstructions { text, hash })
        }
        CoreRequest::ContextPrepare {
            window_id,
            request_id,
            channel,
            attachments,
        } => {
            let workspace = authorize(inner, &window_id, ClientCapability::ContextCapture)?;
            if request_id.is_empty() || channel.is_empty() {
                return Err(errors::SHARE_CONTEXT_ID_EMPTY());
            }
            let key = (window_id.clone(), channel.clone());
            let mut prepared = inner.client_services.prepared.lock().unwrap();
            if let Some(previous) = prepared.get(&key).filter(|entry| entry.request_id == request_id) {
                if let Some(pending) = &previous.pending {
                    if pending.attachments != attachments {
                        return Err(errors::SHARE_CONTEXT_REQUEST_CHANGED());
                    }
                    return Ok(CoreReply::ContextPrepare {
                        text: pending.text.clone(),
                        images: pending.images.clone(),
                        ticket: previous.ticket.clone(),
                    });
                }
                return Ok(CoreReply::ContextPrepare {
                    text: None,
                    images: Vec::new(),
                    ticket: previous.ticket.clone(),
                });
            }
            prepared.remove(&key);
            let conversation = format!("client:{window_id}:{channel}");
            let (visuals, sent_visuals) = share::capture_for_send(
                inner,
                &workspace,
                &conversation,
                attachments.count,
                attachments.bytes,
            );
            let images = visuals
                .into_iter()
                .map(|visual| ContextImage {
                    name: visual.name,
                    mime: visual.mime,
                    bytes: STANDARD
                        .decode(visual.data_base64)
                        .expect("캡처는 코어가 base64로 생성한다"),
                })
                .collect::<Vec<_>>();
            let (text, sent_text) = match share::prepare_text(inner, &workspace, &conversation) {
                Some((text, sent)) => (Some(text), Some(sent)),
                None => (None, None),
            };
            let ticket = uuid::Uuid::new_v4().to_string();
            prepared.insert(
                key,
                Prepared {
                    request_id,
                    ticket: ticket.clone(),
                    pending: Some(Pending {
                        attachments,
                        text: text.clone(),
                        images: images.clone(),
                        conversation,
                        sent_text,
                        sent_visuals,
                    }),
                },
            );
            Ok(CoreReply::ContextPrepare {
                text,
                images,
                ticket,
            })
        }
        CoreRequest::ContextCommit { window_id, ticket } => {
            authorize(inner, &window_id, ClientCapability::ContextCapture)?;
            let mut prepared = inner.client_services.prepared.lock().unwrap();
            let entry = prepared
                .iter_mut()
                .find(|(key, value)| key.0 == window_id && value.ticket == ticket)
                .map(|(_, value)| value)
                .ok_or_else(errors::SHARE_CONTEXT_TICKET_NOT_FOUND)?;
            if let Some(pending) = entry.pending.take() {
                if let Some(sent) = pending.sent_text {
                    share::mark_sent_text(inner, &pending.conversation, sent);
                }
                share::mark_sent_visuals(inner, &pending.conversation, pending.sent_visuals);
            }
            Ok(CoreReply::ContextCommit {})
        }
        _ => unreachable!(),
    }
}

pub(crate) fn state_changed(inner: &Inner) {
    let windows: Vec<String> = inner
        .state
        .lock()
        .unwrap()
        .shared
        .windows
        .iter()
        .map(|w| w.id.clone())
        .collect();
    inner
        .client_services
        .prepared
        .lock()
        .unwrap()
        .retain(|key, _| windows.contains(&key.0));
}
pub(crate) fn server_changed(inner: &Inner) {
    inner.client_services.prepared.lock().unwrap().clear();
}
