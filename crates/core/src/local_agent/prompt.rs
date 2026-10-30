//! 전송 크기 검사와 ACP 입력 구성.
use super::{record::Record, PromptInput};
use crate::error;
use agent_client_protocol::schema::v1::{ContentBlock, ImageContent, ResourceLink, TextContent};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    conversation::ConversationAttachment, CoreError, ErrorCode, AGENT_ATTACHMENTS_MAX,
    AGENT_ATTACHMENTS_TOTAL_MAX_BYTES, AGENT_ATTACHMENT_MAX_BYTES, CONVERSATION_MESSAGE_MAX_CHARS,
};
use std::path::Path;

pub(super) fn validate(input: &PromptInput) -> Result<(), CoreError> {
    if input.request_id.is_empty()
        || (input.text.trim().is_empty() && input.uploads.is_empty())
        || input.text.chars().count() > CONVERSATION_MESSAGE_MAX_CHARS
        || input.uploads.len() > AGENT_ATTACHMENTS_MAX
    {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    let mut total = 0u64;
    for upload in &input.uploads {
        if upload.name.trim().is_empty() {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        let bytes = STANDARD
            .decode(&upload.data_base64)
            .map_err(|_| error::make(ErrorCode::InvalidRequest))?;
        total += bytes.len() as u64;
        if bytes.len() as u64 > AGENT_ATTACHMENT_MAX_BYTES
            || total > AGENT_ATTACHMENTS_TOTAL_MAX_BYTES
        {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
    }
    Ok(())
}
pub(super) fn prepare(
    input: &PromptInput,
    record: &mut Record,
    dir: &Path,
    image: bool,
) -> Result<(Vec<ContentBlock>, Vec<ConversationAttachment>), CoreError> {
    let mut blocks = Vec::new();
    let mut attachments = Vec::new();
    if let Some(context) = input.context.as_ref().filter(|s| !s.is_empty()) {
        blocks.push(ContentBlock::Text(TextContent::new(context.clone())));
    }
    if !input.text.is_empty() {
        blocks.push(ContentBlock::Text(TextContent::new(input.text.clone())));
    }
    let mut count = input.uploads.len();
    let mut total: u64 = input
        .uploads
        .iter()
        .map(|u| {
            STANDARD
                .decode(&u.data_base64)
                .map(|b| b.len() as u64)
                .unwrap_or(0)
        })
        .sum();
    for upload in input.uploads.iter().chain(input.visuals.iter()) {
        let visual = attachments.len() >= input.uploads.len();
        let bytes = STANDARD
            .decode(&upload.data_base64)
            .map_err(|_| error::make(ErrorCode::InvalidRequest))?;
        if visual {
            if count >= AGENT_ATTACHMENTS_MAX
                || bytes.len() as u64 > AGENT_ATTACHMENT_MAX_BYTES
                || total + bytes.len() as u64 > AGENT_ATTACHMENTS_TOTAL_MAX_BYTES
            {
                continue;
            }
            count += 1;
            total += bytes.len() as u64;
        }
        let (a, path) = record.store(dir, &input.request_id, upload)?;
        if !visual {
            attachments.push(a);
        }
        if image && upload.mime.starts_with("image/") {
            blocks.push(ContentBlock::Image(ImageContent::new(
                upload.data_base64.clone(),
                upload.mime.clone(),
            )));
        } else {
            let uri = url::Url::from_file_path(path)
                .map_err(|_| error::make(ErrorCode::Io))?
                .to_string();
            blocks.push(ContentBlock::ResourceLink(
                ResourceLink::new(upload.name.clone(), uri).mime_type(upload.mime.clone()),
            ));
        }
    }
    Ok((blocks, attachments))
}
