//! 공개 명령과 바이트 봉투를 내부 연결에 전달한다.
use super::{Message, Packet};
use crate::{app_commands, Inner};
use kaleidoscope_contract::{
    errors,
    realtime::{RealtimeItem, RealtimeMessage, RealtimePayload, RealtimeTerminal},
    CoreError, CoreReply, CoreRequest,
};
use serde::Deserialize;
use std::sync::Arc;

fn client_permission(inner: &Inner, window: &str, permission: &str) -> Result<(), CoreError> {
    let state = inner.state.lock().unwrap();
    let allowed = state
        .shared
        .windows
        .iter()
        .find(|item| item.id == window)
        .and_then(|item| {
            app_commands::definition_for(&state.shared, &item.app_id, item.app_version)
        })
        .and_then(|definition| definition.client)
        .and_then(|client| client.realtime_permissions)
        .is_some_and(|permissions| permissions.iter().any(|id| id == permission));
    if allowed {
        Ok(())
    } else {
        Err(errors::CONN_REALTIME_CLIENT_PERMISSION_MISSING(permission))
    }
}

fn item(packet: Packet) -> RealtimeItem {
    match packet.message {
        Message::Text(text) => RealtimeItem::Message(RealtimeMessage::Text {
            sequence: packet.sequence,
            text,
        }),
        Message::Binary(bytes) => RealtimeItem::Message(RealtimeMessage::Binary {
            sequence: packet.sequence,
            bytes,
        }),
        Message::Terminal {
            code,
            reason,
            clean,
            error,
        } => RealtimeItem::Terminal(RealtimeTerminal {
            sequence: packet.sequence,
            code,
            reason,
            was_clean: clean,
            error,
        }),
    }
}
fn payload(value: RealtimePayload) -> Message {
    match value {
        RealtimePayload::Text { text } => Message::Text(text),
        RealtimePayload::Binary { bytes } => Message::Binary(bytes),
    }
}

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    match request {
        CoreRequest::RealtimeSession { window_id } => Ok(CoreReply::RealtimeSession {
            session: super::session(inner, &window_id)?,
        }),
        CoreRequest::RealtimeOpen {
            window_id,
            session,
            permission,
            kind,
            path,
            protocols,
        } => {
            if !super::same_session(inner, &window_id, &session) {
                return Err(errors::CONN_REALTIME_SESSION_STALE());
            }
            client_permission(inner, &window_id, &permission)?;
            let opened = super::open(
                inner,
                &window_id,
                &session,
                &permission,
                &path,
                kind,
                &protocols,
            )?;
            Ok(CoreReply::RealtimeOpen {
                handle: opened.handle,
                protocol: opened.protocol,
            })
        }
        CoreRequest::RealtimeRead {
            window_id,
            session,
            handle,
            after,
        } => Ok(CoreReply::RealtimeRead {
            item: super::read(inner, &window_id, &session, &handle, after)?.map(item),
        }),
        CoreRequest::RealtimeAck {
            window_id,
            session,
            handle,
            through,
        } => {
            super::ack(inner, &window_id, &session, &handle, through)?;
            Ok(CoreReply::RealtimeAck {})
        }
        CoreRequest::RealtimeSend {
            window_id,
            session,
            handle,
            message,
        } => {
            super::send(inner, &window_id, &session, &handle, payload(message))?;
            Ok(CoreReply::RealtimeSend {})
        }
        CoreRequest::RealtimeClose {
            window_id,
            session,
            handle,
            code,
            reason,
        } => {
            super::close(
                inner,
                &window_id,
                &session,
                &handle,
                code,
                reason.unwrap_or_default(),
            )?;
            Ok(CoreReply::RealtimeClose {})
        }
        CoreRequest::RealtimeRelease { window_id, session } => {
            super::release(inner, &window_id, &session);
            Ok(CoreReply::RealtimeRelease {})
        }
        _ => unreachable!("실시간 연결 명령만 전달한다"),
    }
}

#[derive(Deserialize)]
struct ReadBody {
    session: String,
    after: u64,
}
#[derive(Deserialize)]
struct SendHeader {
    session: String,
    kind: String,
}

pub(crate) fn binary(
    inner: &Arc<Inner>,
    operation: &str,
    window: &str,
    handle: &str,
    body: &[u8],
) -> Result<Vec<u8>, CoreError> {
    if operation == "connection.realtime.read" {
        let request: ReadBody =
            serde_json::from_slice(body).map_err(|_| errors::CONN_REALTIME_PACKET_INVALID())?;
        let packet = super::read(inner, window, &request.session, handle, request.after)?;
        let (metadata, bytes) = match packet {
            None => (
                serde_json::json!({"session":request.session,"kind":"empty"}),
                Vec::new(),
            ),
            Some(Packet {
                sequence,
                message: Message::Text(text),
            }) => (
                serde_json::json!({"session":request.session,"sequence":sequence,"kind":"text"}),
                text.into_bytes(),
            ),
            Some(Packet {
                sequence,
                message: Message::Binary(bytes),
            }) => (
                serde_json::json!({"session":request.session,"sequence":sequence,"kind":"binary"}),
                bytes,
            ),
            Some(Packet {
                sequence,
                message:
                    Message::Terminal {
                        code,
                        reason,
                        clean,
                        error,
                    },
            }) => (
                serde_json::json!({"session":request.session,"sequence":sequence,"kind":"terminal","terminal":{"code":code,"reason":reason,"was_clean":clean,"error":error}}),
                Vec::new(),
            ),
        };
        let metadata =
            serde_json::to_vec(&metadata).map_err(|_| errors::CONN_REALTIME_PACKET_INVALID())?;
        let mut result = Vec::with_capacity(4 + metadata.len() + bytes.len());
        result.extend_from_slice(&(metadata.len() as u32).to_be_bytes());
        result.extend_from_slice(&metadata);
        result.extend(bytes);
        Ok(result)
    } else {
        let length = body
            .get(..4)
            .and_then(|b| <[u8; 4]>::try_from(b).ok())
            .map(u32::from_be_bytes)
            .ok_or_else(errors::CONN_REALTIME_PACKET_INVALID)? as usize;
        let end = 4usize
            .checked_add(length)
            .filter(|end| *end <= body.len())
            .ok_or_else(errors::CONN_REALTIME_PACKET_INVALID)?;
        let header: SendHeader = serde_json::from_slice(&body[4..end])
            .map_err(|_| errors::CONN_REALTIME_PACKET_INVALID())?;
        let message = match header.kind.as_str() {
            "text" => Message::Text(
                std::str::from_utf8(&body[end..])
                    .map_err(|_| errors::CONN_REALTIME_PACKET_INVALID())?
                    .to_owned(),
            ),
            "binary" => Message::Binary(body[end..].to_vec()),
            _ => return Err(errors::CONN_REALTIME_PACKET_INVALID()),
        };
        super::send(inner, window, &header.session, handle, message)?;
        Ok(Vec::new())
    }
}
