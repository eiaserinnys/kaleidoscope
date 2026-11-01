//! 인증된 기기 사이의 명시적 누락 데이터 이관 계약.
use crate::{
    app_storage::StorageKind, assets::AssetUpload, registry::LayoutChanges, AppDefinition,
    JsonValue,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const TRANSFER_PATH: &str = "/api/device/transfer";
pub const TRANSFER_MAX_BYTES: usize = 64 * 1024 * 1024;
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferBundle {
    pub assets: Vec<AssetUpload>,
    pub apps: Vec<AppDefinition>,
    pub layout: LayoutChanges,
    pub values: Vec<TransferValue>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferValue {
    pub app_id: String,
    pub key: String,
    pub kind: StorageKind,
    pub content: JsonValue,
    pub workspace_id: Option<String>,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct TransferResult {
    pub imported: u32,
    pub skipped: Vec<String>,
}
