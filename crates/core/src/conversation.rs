//! 대화 명령을 창의 제공자와 저장소에 연결한다.
use crate::{conversation_context::Context, error, Inner};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    conversation::ThreadItemsReply, CoreError, CoreReply, CoreRequest, ErrorCode,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Arc};

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    let window = match &request {
        CoreRequest::ConversationGet { window_id }
        | CoreRequest::ConversationHistory { window_id, .. }
        | CoreRequest::ConversationCreate { window_id, .. }
        | CoreRequest::ConversationSend { window_id, .. }
        | CoreRequest::ConversationAttachment { window_id, .. }
        | CoreRequest::ConversationAttachmentOpen { window_id, .. } => window_id,
        _ => return Err(error::make(ErrorCode::InvalidRequest)),
    }
    .clone();
    let is_open = matches!(&request, CoreRequest::ConversationAttachmentOpen { .. });
    let ctx = Context::open(inner, &window)?;
    let request = match request {
        CoreRequest::ConversationSend {
            request_id,
            text,
            attachments,
            ..
        } => {
            return crate::conversation_send::send(inner, &ctx, request_id, text, attachments);
        }
        request => request,
    };
    ctx.client.require_login()?;
    let namespace = ctx.namespace(inner)?;
    match request {
        CoreRequest::ConversationGet { .. } => {
            let models = ctx.models()?.models;
            let thread = ctx.thread(inner, &namespace)?;
            let items = if let Some(thread) = &thread {
                history(&ctx, &thread.id, None)?
            } else {
                ThreadItemsReply {
                    items: vec![],
                    next_before: None,
                    cursor: String::new(),
                }
            };
            if let Some(thread) = &thread {
                let key = format!(
                    "{}\u{0}{}\u{0}{}",
                    ctx.client.info.name, namespace, ctx.workspace.id
                );
                crate::conversation_stream::watch(
                    inner,
                    key,
                    &window,
                    ctx.client.clone(),
                    &thread.id,
                    &items.cursor,
                    &items.items,
                );
            }
            crate::conversation_send::emit_drafts(inner, &ctx, &window);
            Ok(CoreReply::ConversationGet {
                thread,
                items: items.items,
                cursor: items.cursor,
                next_before: items.next_before,
                models,
            })
        }
        CoreRequest::ConversationHistory { before, .. } => {
            let thread = ctx
                .thread(inner, &namespace)?
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let items = history(&ctx, &thread.id, Some(&before))?;
            Ok(CoreReply::ConversationHistory {
                items: items.items,
                next_before: items.next_before,
            })
        }
        CoreRequest::ConversationCreate { model, .. } => Ok(CoreReply::ConversationCreate {
            thread: ctx.create(inner, &namespace, &model)?,
        }),
        CoreRequest::ConversationAttachment {
            item_id,
            attachment_id,
            ..
        }
        | CoreRequest::ConversationAttachmentOpen {
            item_id,
            attachment_id,
            ..
        } => {
            let thread = ctx
                .thread(inner, &namespace)?
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let path = ctx.client.path(&[
                "threads",
                &thread.id,
                "items",
                &item_id,
                "attachments",
                &attachment_id,
            ])?;
            let (name, mime, bytes) = ctx.client.bytes(&path)?;
            if is_open {
                let name = crate::agent_commands::safe_attachment_name(&name);
                let key = format!(
                    "{:x}",
                    Sha256::digest(format!("{item_id}\0{attachment_id}").as_bytes())
                );
                let dir = inner.data_dir.join("attachments").join(key);
                std::fs::create_dir_all(&dir).map_err(|e| error::io_error(&e))?;
                let path = dir.join(&name);
                std::fs::write(&path, bytes).map_err(|e| error::io_error(&e))?;
                if crate::agent_commands::should_reveal(&name) {
                    inner.attachment_opener.reveal(&path)
                } else {
                    inner.attachment_opener.open(&path)
                }
                .map_err(|e| error::io_error(&e))?;
                return Ok(CoreReply::ConversationAttachmentOpen {});
            }
            Ok(CoreReply::ConversationAttachment {
                name,
                mime,
                data_base64: STANDARD.encode(bytes),
            })
        }
        _ => Err(error::make(ErrorCode::Unavailable)),
    }
}

fn history(ctx: &Context, id: &str, before: Option<&str>) -> Result<ThreadItemsReply, CoreError> {
    let mut query = BTreeMap::from([("limit".into(), "200".into())]);
    if let Some(before) = before {
        query.insert("before".into(), before.into());
    }
    ctx.client
        .json(
            reqwest::Method::GET,
            &ctx.client.path(&["threads", id, "items"])?,
            &query,
            None::<&Value>,
        )?
        .ok_or_else(|| error::make(ErrorCode::NotFound))
}
