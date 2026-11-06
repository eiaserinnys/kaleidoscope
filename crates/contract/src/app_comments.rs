//! 계정 × 앱 커멘트의 서버와 쉘 사이 자료 계약.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{store::StoreOrigin, JsonValue};

/// 자리 필드와 블록 지문 계산 형식의 현재 판.
pub const APP_COMMENT_ANCHOR_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum AppCommentAnchorKind {
    Block,
    Row,
    Control,
    Text,
    Point,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentPoint {
    pub x: f64,
    pub y: f64,
}

/// 캡처 입력은 창 본문(.ks-window-content) 왼쪽 위 기준 CSS 픽셀 좌표이고,
/// 출력과 저장된 그림의 대상 상자는 그림 픽셀 좌표다.
/// 점은 너비와 높이가 0인 상자로 나타낸다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentQuote {
    pub exact: String,
    pub prefix: String,
    pub suffix: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentElement {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub role: Option<String>,
    pub tag: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
}

/// 반복 키와 행 키는 JSON 값의 타입을 유지한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentAnchor {
    /// 만든 자리에 사용한 필드와 지문 계산 형식의 판.
    pub schema_version: u32,
    pub kind: AppCommentAnchorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pointer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub normalized_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub own_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub parent_child_types: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub repeat_chain: Option<Vec<JsonValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub row_identity: Option<JsonValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub quote: Option<AppCommentQuote>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub element: Option<AppCommentElement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub element_rel: Option<AppCommentPoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frame_rel: Option<AppCommentPoint>,
    // 고른 순간 프레임 표면의 CSS 픽셀 크기(point 자리만).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frame_css_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frame_css_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub body_css_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub body_css_height: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum AppCommentOrigin {
    Builtin,
    Personal,
    Store { origin: StoreOrigin },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum AppCommentCaptureSurface {
    WindowBody,
    WebView,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentImageMeta {
    pub width: u32,
    pub height: u32,
    #[ts(type = "number")]
    pub byte_size: u64,
    pub capture_surface: AppCommentCaptureSurface,
    /// 그림 왼쪽 위를 기준으로 한 그림 픽셀 좌표.
    pub target_rect: AppCommentRect,
}

/// PNG 바이트는 기존 자산 업로드와 창 캡처처럼 base64로 전송한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentImage {
    pub meta: AppCommentImageMeta,
    pub image_base64: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentSummary {
    pub id: String,
    pub app_id: String,
    #[ts(type = "number")]
    pub number: u64,
    pub created_app_version: u32,
    pub created_definition_digest: String,
    pub created_shell_version: String,
    pub origin: AppCommentOrigin,
    pub source_window_id: String,
    pub anchor: AppCommentAnchor,
    pub text: String,
    #[ts(type = "number")]
    pub reply_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_reply: Option<AppCommentReply>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<AppCommentImageMeta>,
    pub resolved: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub resolved_app_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sent_at: Option<String>,
    #[serde(default)]
    pub unread_reply: bool,
    pub created_at: String,
    pub updated_at: String,
    #[ts(type = "number")]
    pub revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum AppCommentAuthor {
    User,
    Agent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentReply {
    pub id: String,
    pub author: AppCommentAuthor,
    pub text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentThread {
    #[serde(flatten)]
    pub summary: AppCommentSummary,
    pub replies: Vec<AppCommentReply>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentAppMeta {
    pub app_id: String,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub open_count: u64,
    #[ts(type = "number")]
    pub unsent_count: u64,
    #[ts(type = "number")]
    pub unread_reply_count: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentCreateRequest {
    pub id: String,
    pub anchor: AppCommentAnchor,
    pub text: String,
    pub origin: AppCommentOrigin,
    pub created_app_version: u32,
    pub created_definition_digest: String,
    pub created_shell_version: String,
    pub source_window_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<AppCommentImage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentReplyRequest {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentResolveRequest {
    pub resolved: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fixed_app_version: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentMarkSentRequest {
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppCommentListReply {
    pub items: Vec<AppCommentSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_cursor: Option<String>,
    #[ts(type = "number")]
    pub app_revision: u64,
}
