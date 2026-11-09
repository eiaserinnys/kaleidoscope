//! 접수 전 메시지를 기기에 보존하고 동일 요청 id로 영수증에 수렴한다.
use crate::{
    conversation_context::{Context, ContextSnapshot},
    conversation_http::Client,
    share, storage, Inner,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    conversation::{
        ConversationError, ConversationErrorCode, ConversationUpload, MessageReceipt,
        ReceiptStatus, SendMessageRequest,
    },
    CoreError, CoreEvent, CoreReply, ErrorCode, AGENT_ATTACHMENTS_MAX,
    AGENT_ATTACHMENTS_TOTAL_MAX_BYTES, AGENT_ATTACHMENT_MAX_BYTES, CONVERSATION_MESSAGE_MAX_CHARS,
};
use kaleidoscope_data::share::SentView;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Weak};
use std::thread;
use std::time::Duration;

#[derive(Serialize, Deserialize)]
struct Pending {
    connection: String,
    base_path: String,
    workspace: String,
    thread: Option<String>,
    context: ContextSnapshot,
    user_text: String,
    user_uploads: Vec<ConversationUpload>,
    post_started: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failed_reason: Option<String>,
    request: SendMessageRequest,
    sent_views: Option<BTreeMap<String, SentView>>,
    sent_visuals: Vec<(String, String)>,
}

pub(crate) fn send(
    inner: &Arc<Inner>,
    ctx: &Context,
    id: String,
    text: String,
    uploads: Vec<ConversationUpload>,
) -> Result<CoreReply, CoreError> {
    if id.is_empty() {
        return Err(kaleidoscope_contract::errors::CONV_SEND_REQUEST_ID_MISSING());
    }
    if text.trim().is_empty() && uploads.is_empty() {
        return Err(kaleidoscope_contract::errors::CONV_SEND_MESSAGE_EMPTY());
    }
    if text.chars().count() > CONVERSATION_MESSAGE_MAX_CHARS {
        return Err(kaleidoscope_contract::errors::CONV_SEND_MESSAGE_TOO_LONG(
            CONVERSATION_MESSAGE_MAX_CHARS,
        ));
    }
    if uploads.len() > AGENT_ATTACHMENTS_MAX {
        return Err(
            kaleidoscope_contract::errors::CONV_SEND_ATTACHMENT_COUNT_EXCEEDED(
                AGENT_ATTACHMENTS_MAX,
            ),
        );
    }
    let mut total = 0;
    for upload in &uploads {
        if upload.name.trim().is_empty() {
            return Err(kaleidoscope_contract::errors::CONV_SEND_ATTACHMENT_NAME_EMPTY());
        }
        let bytes = STANDARD
            .decode(&upload.data_base64)
            .map_err(|_| kaleidoscope_contract::errors::CONV_SEND_ATTACHMENT_ENCODING_INVALID())?;
        total += bytes.len() as u64;
        if bytes.len() as u64 > AGENT_ATTACHMENT_MAX_BYTES {
            return Err(
                kaleidoscope_contract::errors::CONV_SEND_ATTACHMENT_TOO_LARGE(
                    kaleidoscope_contract::size::format_byte_limit(AGENT_ATTACHMENT_MAX_BYTES),
                ),
            );
        }
        if total > AGENT_ATTACHMENTS_TOTAL_MAX_BYTES {
            return Err(
                kaleidoscope_contract::errors::CONV_SEND_ATTACHMENTS_TOO_LARGE(
                    kaleidoscope_contract::size::format_byte_limit(
                        AGENT_ATTACHMENTS_TOTAL_MAX_BYTES,
                    ),
                ),
            );
        }
    }
    let conversation = format!("{}\0{}", ctx.storage.app, ctx.workspace.id);
    let (captured, visuals) = share::capture_for_send(
        inner, &ctx.workspace.id, &conversation, uploads.len(), total,
    );
    let mut attachments = uploads.clone();
    attachments.extend(captured);
    let plan = share::prepare_text(inner, &ctx.workspace.id, &conversation);
    let (body, context, sent_views) = match plan {
        Some((block, views)) => (text.trim().to_string(), Some(block), Some(views)),
        None => (text.trim().to_string(), None, None),
    };
    let context = match (ctx.attached_instructions(inner)?, context) {
        (Some(prefix), Some(block)) => Some(format!("{prefix}\n\n{block}")),
        (Some(prefix), None) => Some(prefix),
        (None, context) => context,
    };
    let mut pending = Pending {
        connection: ctx.client.info.name.clone(),
        base_path: ctx.client.base_path.clone(),
        workspace: ctx.workspace.id.clone(),
        thread: None,
        context: ctx.snapshot(),
        user_text: text,
        user_uploads: uploads,
        post_started: false,
        failed_reason: None,
        request: SendMessageRequest {
            request_id: id,
            text: body,
            attachments,
            context,
        },
        sent_views,
        sent_visuals: visuals,
    };
    let path = path_for(
        &inner.data_dir,
        &pending.workspace,
        &pending.request.request_id,
    )?;
    {
        let mut active = inner.conversation_sends.lock().unwrap();
        let key = path.to_string_lossy().to_string();
        if active.contains(&key) {
            return Err(kaleidoscope_contract::errors::CONV_SEND_ALREADY_ACTIVE());
        }
        if path.exists() {
            let previous = read(&path)?;
            if previous.user_text != pending.user_text
                || previous.user_uploads != pending.user_uploads
            {
                return Err(kaleidoscope_contract::errors::CONV_SEND_REQUEST_ID_CONTENT_MISMATCH());
            }
            if previous.failed_reason.is_some() {
                return Err(kaleidoscope_contract::errors::CONV_SEND_PREVIOUS_REQUEST_FAILED());
            }
            pending = previous;
        } else {
            storage::save_atomic(&path, &pending)?;
        }
        active.insert(key);
    }
    let (tx, rx) = mpsc::sync_channel(1);
    let first_check = pending.post_started;
    spawn(Arc::downgrade(inner), path, pending, Some(tx), first_check);
    rx.recv().unwrap_or_else(|_| {
        Err(kaleidoscope_contract::errors::CONV_SEND_REPLY_LOST(
            &ctx.workspace.name,
        ))
    })?;
    Ok(CoreReply::ConversationSend {})
}

fn path_for(data_dir: &Path, thread: &str, request: &str) -> Result<PathBuf, CoreError> {
    let dir = data_dir.join("conversation-pending");
    std::fs::create_dir_all(&dir).map_err(|e| {
        kaleidoscope_contract::errors::CONV_SEND_PENDING_DIRECTORY_WRITE()
            .and_details(vec![e.to_string()])
    })?;
    Ok(dir.join(format!(
        "{:x}.json",
        Sha256::digest(format!("{thread}\0{request}").as_bytes())
    )))
}
fn read(path: &Path) -> Result<Pending, CoreError> {
    let bytes = std::fs::read(path).map_err(|e| {
        kaleidoscope_contract::errors::CONV_SEND_PENDING_FILE_READ()
            .and_details(vec![e.to_string()])
    })?;
    serde_json::from_slice(&bytes)
        .map_err(|_| kaleidoscope_contract::errors::CONV_SEND_PENDING_FILE_INVALID())
}

pub(crate) fn recover(inner: &Arc<Inner>) {
    let dir = inner.data_dir.join("conversation-pending");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(pending) = read(&path) else {
            eprintln!("대화 전송 대기 파일을 읽지 못했습니다.");
            continue;
        };
        if !pending.post_started
            || pending.failed_reason.is_some()
            || Client::restore(inner, &pending.connection, &pending.base_path).is_err()
        {
            continue;
        }
        let key = path.to_string_lossy().to_string();
        if !inner.conversation_sends.lock().unwrap().insert(key) {
            continue;
        }
        spawn(Arc::downgrade(inner), path, pending, None, true);
    }
}

pub(crate) fn emit_drafts(inner: &Arc<Inner>, ctx: &Context, window: &str) {
    let Ok(entries) = std::fs::read_dir(inner.data_dir.join("conversation-pending")) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(pending) = read(&entry.path()) else {
            continue;
        };
        if (!pending.post_started || pending.failed_reason.is_some())
            && pending.context.app == ctx.storage.app
            && pending.workspace == ctx.workspace.id
        {
            inner.emit(&CoreEvent::ConversationDraft {
                window_id: window.to_string(),
                request_id: pending.request.request_id,
                text: pending.user_text,
                attachments: pending.user_uploads,
                failed: pending.failed_reason.is_some(),
            });
        }
    }
}

fn spawn(
    inner: Weak<Inner>,
    path: PathBuf,
    mut pending: Pending,
    reply: Option<mpsc::SyncSender<Result<(), CoreError>>>,
    first_check: bool,
) {
    thread::spawn(move || {
        let mut reply = reply;
        let mut check = first_check;
        let mut delay = 2;
        loop {
            let Some(owner) = inner.upgrade() else { return };
            if pending.thread.is_none() {
                let prepared = Context::restore(&owner, &pending.context).and_then(|ctx| {
                    ctx.client.require_login()?;
                    let namespace = ctx.namespace(&owner)?;
                    ctx.thread(&owner, &namespace)?
                        .map(|thread| thread.id)
                        .ok_or_else(|| {
                            kaleidoscope_contract::errors::CONV_SEND_THREAD_NOT_FOUND(
                                &pending.context.workspace.name,
                            )
                        })
                });
                match prepared {
                    Ok(thread) => {
                        pending.thread = Some(thread);
                        if let Err(e) = storage::save_atomic(&path, &pending) {
                            finish(&owner, &path, &mut reply, Err(e), false);
                            return;
                        }
                    }
                    Err(e) => {
                        finish(&owner, &path, &mut reply, Err(e), false);
                        return;
                    }
                }
            }
            let client = match Client::restore(&owner, &pending.connection, &pending.base_path) {
                Ok(client) => client.with_workspace_name(&pending.context.workspace.name),
                Err(e) => {
                    finish(&owner, &path, &mut reply, Err(e), false);
                    return;
                }
            };
            if !check && !pending.post_started {
                pending.post_started = true;
                if let Err(e) = storage::save_atomic(&path, &pending) {
                    finish(&owner, &path, &mut reply, Err(e), false);
                    return;
                }
            }
            drop(owner);
            let result = if check {
                receipt(&client, &pending)
            } else {
                post(&client, &pending)
            };
            match result {
                Ok(None) if check => {
                    if let Some(owner) = inner.upgrade() {
                        pending.post_started = false;
                        let saved = storage::save_atomic(&path, &pending);
                        let outcome = saved.and_then(|_| {
                            Err(
                                kaleidoscope_contract::errors::CONV_SEND_RECEIPT_NOT_ACCEPTED(
                                    &pending.context.workspace.name,
                                ),
                            )
                        });
                        finish(&owner, &path, &mut reply, outcome, false);
                    }
                    return;
                }
                Ok(Some(receipt)) if receipt.status == ReceiptStatus::Accepted => {
                    if let Some(owner) = inner.upgrade() {
                        if let Some(views) = pending.sent_views.clone() {
                            let conversation =
                                format!("{}\0{}", pending.context.app, pending.workspace);
                            share::mark_sent_text(&owner, &conversation, views);
                        }
                        let conversation =
                            format!("{}\0{}", pending.context.app, pending.workspace);
                        share::mark_sent_visuals(
                            &owner,
                            &conversation,
                            pending.sent_visuals.clone(),
                        );
                        remove_failed(&owner, &pending);
                        finish(&owner, &path, &mut reply, Ok(()), true);
                    }
                    return;
                }
                Ok(Some(receipt)) if receipt.status == ReceiptStatus::Failed => {
                    if let Some(owner) = inner.upgrade() {
                        let error = receipt.error.map_or_else(
                            || {
                                kaleidoscope_contract::errors::CONV_SEND_PROVIDER_ERROR_MISSING(
                                    &pending.context.workspace.name,
                                )
                            },
                            |error| provider_error(error, &pending.context.workspace.name),
                        );
                        pending.failed_reason = Some(error.message.clone());
                        let result = storage::save_atomic(&path, &pending).and_then(|_| Err(error));
                        finish(&owner, &path, &mut reply, result, false);
                    }
                    return;
                }
                Err(e)
                    if matches!(
                        e.code,
                        ErrorCode::LoginRequired
                            | ErrorCode::PermissionDenied
                            | ErrorCode::Conflict
                            | ErrorCode::InvalidRequest
                    ) =>
                {
                    if let Some(owner) = inner.upgrade() {
                        finish(&owner, &path, &mut reply, Err(e), false);
                    }
                    return;
                }
                _ => {}
            }
            // 미접수나 pending은 같은 본문을 다시 POST한다. 실패한 POST 다음에는 영수증부터 읽는다.
            if check {
                check = false;
            } else {
                check = true;
            }
            thread::sleep(Duration::from_secs(delay));
            delay = (delay * 2).min(30);
        }
    });
}

pub(crate) fn provider_error(error: ConversationError, workspace: &str) -> CoreError {
    let reason = if error.message.trim().is_empty() {
        "제공자가 추가 설명을 보내지 않았습니다".to_string()
    } else {
        error.message
    };
    use ConversationErrorCode::*;
    match error.code {
        InvalidRequest => {
            kaleidoscope_contract::errors::CONV_SEND_PROVIDER_INVALID_REQUEST(workspace, reason)
        }
        LoginRequired => {
            kaleidoscope_contract::errors::CONV_SEND_PROVIDER_LOGIN_REQUIRED(workspace, reason)
        }
        Forbidden => kaleidoscope_contract::errors::CONV_SEND_PROVIDER_FORBIDDEN(workspace, reason),
        NotFound => kaleidoscope_contract::errors::CONV_SEND_PROVIDER_NOT_FOUND(workspace, reason),
        Conflict => kaleidoscope_contract::errors::CONV_SEND_PROVIDER_CONFLICT(workspace, reason),
        AttachmentLimit => {
            kaleidoscope_contract::errors::CONV_SEND_PROVIDER_ATTACHMENT_LIMIT(workspace, reason)
        }
        ModelUnavailable => {
            kaleidoscope_contract::errors::CONV_SEND_PROVIDER_MODEL_UNAVAILABLE(workspace, reason)
        }
        Unavailable => {
            kaleidoscope_contract::errors::CONV_SEND_PROVIDER_UNAVAILABLE(workspace, reason)
        }
        Pending => kaleidoscope_contract::errors::CONV_SEND_PROVIDER_PENDING(workspace, reason),
    }
}

fn remove_failed(owner: &Inner, accepted: &Pending) {
    let Ok(entries) = std::fs::read_dir(owner.data_dir.join("conversation-pending")) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(previous) = read(&path) else { continue };
        if previous.failed_reason.is_some()
            && previous.context.app == accepted.context.app
            && previous.workspace == accepted.workspace
            && previous.connection == accepted.connection
            && previous.thread == accepted.thread
        {
            if let Err(error) = std::fs::remove_file(path) {
                eprintln!("실패한 대화 초안을 지우지 못했습니다: {error}");
            }
        }
    }
}

fn post(client: &Client, pending: &Pending) -> Result<Option<MessageReceipt>, CoreError> {
    let path = client.path(&["threads", pending.thread.as_deref().unwrap(), "messages"])?;
    client.json(
        reqwest::Method::POST,
        &path,
        &BTreeMap::new(),
        Some(&pending.request),
    )
}
fn receipt(client: &Client, pending: &Pending) -> Result<Option<MessageReceipt>, CoreError> {
    let path = client.path(&[
        "threads",
        pending.thread.as_deref().unwrap(),
        "messages",
        &pending.request.request_id,
    ])?;
    client.json(
        reqwest::Method::GET,
        &path,
        &BTreeMap::new(),
        None::<&Value>,
    )
}
fn finish(
    owner: &Arc<Inner>,
    path: &Path,
    reply: &mut Option<mpsc::SyncSender<Result<(), CoreError>>>,
    result: Result<(), CoreError>,
    remove: bool,
) {
    if remove {
        if let Err(e) = std::fs::remove_file(path) {
            eprintln!("대화 전송 대기 파일을 지우지 못했습니다: {e}");
        }
    }
    owner
        .conversation_sends
        .lock()
        .unwrap()
        .remove(&path.to_string_lossy().to_string());
    if let Some(reply) = reply.take() {
        let _ = reply.send(result);
    }
}

#[cfg(test)]
mod tests {
    use super::provider_error;
    use kaleidoscope_contract::{
        conversation::{ConversationError, ConversationErrorCode},
        ErrorCode,
    };

    #[test]
    fn receipt_provider_errors_keep_distinct_codes_and_match_main_server_classification() {
        let cases = [
            (
                ConversationErrorCode::InvalidRequest,
                "CONV_SEND_PROVIDER_INVALID_REQUEST",
                ErrorCode::Server,
            ),
            (
                ConversationErrorCode::LoginRequired,
                "CONV_SEND_PROVIDER_LOGIN_REQUIRED",
                ErrorCode::Server,
            ),
            (
                ConversationErrorCode::Forbidden,
                "CONV_SEND_PROVIDER_FORBIDDEN",
                ErrorCode::Server,
            ),
            (
                ConversationErrorCode::NotFound,
                "CONV_SEND_PROVIDER_NOT_FOUND",
                ErrorCode::Server,
            ),
            (
                ConversationErrorCode::Conflict,
                "CONV_SEND_PROVIDER_CONFLICT",
                ErrorCode::Server,
            ),
            (
                ConversationErrorCode::AttachmentLimit,
                "CONV_SEND_PROVIDER_ATTACHMENT_LIMIT",
                ErrorCode::Server,
            ),
            (
                ConversationErrorCode::ModelUnavailable,
                "CONV_SEND_PROVIDER_MODEL_UNAVAILABLE",
                ErrorCode::Server,
            ),
            (
                ConversationErrorCode::Unavailable,
                "CONV_SEND_PROVIDER_UNAVAILABLE",
                ErrorCode::Server,
            ),
            (
                ConversationErrorCode::Pending,
                "CONV_SEND_PROVIDER_PENDING",
                ErrorCode::Server,
            ),
        ];

        for (provider_code, expected_id, expected_class) in cases {
            let error = provider_error(
                ConversationError {
                    code: provider_code,
                    message: "선택한 모델을 사용할 수 없습니다".into(),
                },
                "작업",
            );
            assert_eq!(error.id.as_deref(), Some(expected_id));
            assert_eq!(error.code, expected_class);
            assert!(error.message.contains("작업"));
            assert!(error.message.contains("선택한 모델을 사용할 수 없습니다"));
        }
    }

    #[test]
    fn provider_pending_and_request_timeout_have_separate_registered_errors() {
        let provider = provider_error(
            ConversationError {
                code: ConversationErrorCode::Pending,
                message: "아직 처리 중입니다".into(),
            },
            "작업",
        );
        let timeout = kaleidoscope_contract::errors::CONV_SEND_PENDING_TIMEOUT("작업");
        assert_ne!(provider.id, timeout.id);
        assert_eq!(provider.code, ErrorCode::Server);
        assert_eq!(timeout.code, ErrorCode::Server);
    }
}
