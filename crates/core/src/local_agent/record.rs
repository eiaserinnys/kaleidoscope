//! 창마다 이 기기에 남기는 대화 기록과 첨부.
use crate::{error, storage};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    conversation::{
        ConversationAttachment, ConversationItem, ConversationItemKind, ConversationUpload,
    },
    local_agent::AgentControlValue,
    CoreError, ErrorCode,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Default, Serialize, Deserialize)]
pub(super) struct Record {
    pub spec_hash: String,
    pub cwd: PathBuf,
    pub session_id: Option<String>,
    pub controls: BTreeMap<String, AgentControlValue>,
    pub items: Vec<ConversationItem>,
    pub attachments: BTreeMap<String, StoredAttachment>,
}
#[derive(Serialize, Deserialize)]
pub(super) struct StoredAttachment {
    item_id: String,
    mime: String,
    filename: String,
}
impl Record {
    pub fn load(dir: &Path) -> Self {
        std::fs::read(dir.join("record.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }
    pub fn save(&self, dir: &Path) -> Result<(), CoreError> {
        std::fs::create_dir_all(dir).map_err(|e| error::io_error(&e))?;
        storage::save_atomic(&dir.join("record.json"), self)
    }
    pub fn item(
        &mut self,
        kind: ConversationItemKind,
        id: String,
        text: String,
        attachments: Vec<ConversationAttachment>,
    ) -> ConversationItem {
        let item = ConversationItem {
            id,
            kind,
            text,
            at: chrono::Utc::now().to_rfc3339(),
            attachments,
        };
        self.items.push(item.clone());
        item
    }
    pub fn store(
        &mut self,
        dir: &Path,
        item_id: &str,
        upload: &ConversationUpload,
    ) -> Result<(ConversationAttachment, PathBuf), CoreError> {
        let bytes = STANDARD
            .decode(&upload.data_base64)
            .map_err(|_| error::make(ErrorCode::InvalidRequest))?;
        let id = Uuid::new_v4().to_string();
        let folder = dir.join("attachments");
        std::fs::create_dir_all(&folder).map_err(|e| error::io_error(&e))?;
        let path = folder.join(&id);
        std::fs::write(&path, bytes).map_err(|e| error::io_error(&e))?;
        self.attachments.insert(
            id.clone(),
            StoredAttachment {
                item_id: item_id.into(),
                mime: upload.mime.clone(),
                filename: id.clone(),
            },
        );
        Ok((
            ConversationAttachment {
                id,
                name: upload.name.clone(),
                mime: upload.mime.clone(),
            },
            path,
        ))
    }
}
pub(crate) fn read_history(dir: &Path) -> Vec<ConversationItem> {
    Record::load(dir).items
}
pub(crate) fn delete_record(dir: &Path) {
    if let Err(e) = std::fs::remove_dir_all(dir) {
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!("에이전트 기록을 지우지 못했습니다: {e}");
        }
    }
}
pub(crate) fn attachment_bytes(
    dir: &Path,
    item_id: &str,
    attachment_id: &str,
) -> Result<(String, Vec<u8>, PathBuf), CoreError> {
    let record = Record::load(dir);
    let a = record
        .attachments
        .get(attachment_id)
        .filter(|a| a.item_id == item_id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let path = dir.join("attachments").join(&a.filename);
    let bytes = std::fs::read(&path).map_err(|e| error::io_error(&e))?;
    Ok((a.mime.clone(), bytes, path))
}
