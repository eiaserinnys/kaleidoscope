//! conversation-v1: 앱 provider와 대화 서비스 사이의 범용 wire 계약.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 앱과 대화 제공자가 공유하는 공개 프로토콜 이름.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "contract.ts")]
pub enum ConversationProtocol {
    ConversationV1,
}

/// 앱 정의의 base_path 기준 경로다. query와 id는 URL component로 인코딩해 붙인다.
pub const MODELS_PATH: &str = "/models";
pub const PROFILES_PATH: &str = "/profiles";
pub const THREADS_PATH: &str = "/threads";
pub const THREADS_BY_KEY_PATH: &str = "/threads/by-key";
pub const THREAD_EXECUTION_PATH: &str = "/threads/{thread_id}/execution";
pub const THREAD_ADOPTION_PATH: &str = "/threads/by-key/adoption";
pub const THREAD_ITEMS_PATH: &str = "/threads/{thread_id}/items";
pub const THREAD_EVENTS_PATH: &str = "/threads/{thread_id}/events";
pub const THREAD_MESSAGES_PATH: &str = "/threads/{thread_id}/messages";
pub const MESSAGE_RECEIPT_PATH: &str = "/threads/{thread_id}/messages/{request_id}";
pub const THREAD_ATTACHMENT_PATH: &str =
    "/threads/{thread_id}/items/{item_id}/attachments/{attachment_id}";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationModel {
    pub id: String,
    pub label: String,
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group: Option<ConversationGroup>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationGroup {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ModelsReply {
    pub models: Vec<ConversationModel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationProfile {
    pub id: String,
    pub label: String,
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ProfilesReply {
    pub profiles: Vec<ConversationProfile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationStart {
    pub profile: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ExternalKey {
    pub namespace: String,
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ThreadModel {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group: Option<ConversationGroup>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ThreadProfile {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationThread {
    pub id: String,
    pub external: ExternalKey,
    pub title: String,
    pub model: ThreadModel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub profile: Option<ThreadProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub execution_id: Option<String>,
    pub created_at: String,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ThreadRef {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ThreadListReply {
    pub refs: Vec<ThreadRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ThreadByKeyReply {
    pub thread: ConversationThread,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AdoptThreadRequest {
    pub session_id: String,
    pub first_input_is_initial_instruction: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct EnsureThreadRequest {
    pub title: String,
    pub selected_model: String,
    pub model_order: Vec<String>,
    pub profile: String,
    pub collection: String,
    pub initial_instruction: String,
    pub instructions: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ExecutionThreadRequest {
    pub expected_execution_id: String,
    pub title: String,
    pub selected_model: String,
    pub model_order: Vec<String>,
    pub profile: String,
    pub collection: String,
    pub initial_instruction: String,
    pub instructions: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct EnsureThreadReply {
    pub thread: ConversationThread,
    pub created: bool,
    #[serde(default)]
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct PatchThreadRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub archived: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model_order: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ThreadInfoReply {
    pub thread: ConversationThread,
    pub busy: bool,
    pub tool: Option<String>,
    pub current_model: Option<ThreadModel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationAttachment {
    pub id: String,
    pub name: String,
    pub mime: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ConversationItemKind {
    User,
    Assistant,
    Error,
    Notice,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationItem {
    pub id: String,
    pub kind: ConversationItemKind,
    pub text: String,
    pub at: String,
    #[serde(default)]
    pub attachments: Vec<ConversationAttachment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ThreadItemsReply {
    /// 기본값은 200, 요청 상한도 200이다. 더 읽을 때는 `next_before`를 쓴다.
    pub items: Vec<ConversationItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_before: Option<String>,
    pub cursor: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, schemars::JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationUpload {
    pub name: String,
    pub mime: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, schemars::JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct SendMessageRequest {
    pub request_id: String,
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<ConversationUpload>,
    #[serde(default, skip_serializing_if = "option_is_none_or_empty")]
    #[schemars(
        description = "비어 있지 않을 때 사람 기록에는 넣지 않고 에이전트 입력에만 덧붙이는 내용."
    )]
    #[ts(optional)]
    pub context: Option<String>,
}

fn option_is_none_or_empty(value: &Option<String>) -> bool {
    value.as_ref().is_none_or(String::is_empty)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ReceiptStatus {
    Accepted,
    Failed,
    Pending,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct MessageReceipt {
    pub request_id: String,
    pub status: ReceiptStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<ConversationError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ConversationErrorCode {
    InvalidRequest,
    LoginRequired,
    Forbidden,
    NotFound,
    Conflict,
    AttachmentLimit,
    ModelUnavailable,
    Unavailable,
    Pending,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationError {
    pub code: ConversationErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ConversationErrorEnvelope {
    pub error: ConversationError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ThreadSnapshot {
    pub cursor: String,
    pub busy: bool,
    pub tool: Option<String>,
    pub stream_id: Option<String>,
    pub text: Option<String>,
    pub items: Vec<ConversationItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ConversationEvent {
    /// 재접속 시 현재 기록 위치와 busy/tool/진행 중인 누적 text를 맞춘다.
    Snapshot {
        snapshot: ThreadSnapshot,
    },
    Item {
        item: ConversationItem,
    },
    /// 조각을 덧붙이지 않고 `stream_id`의 누적 text로 교체한다.
    Text {
        stream_id: String,
        text: String,
    },
    Activity {
        busy: bool,
        tool: Option<String>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversation_v1_fixtures_round_trip() {
        let request_json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/conversation-v1/request.json")).unwrap();
        let request: EnsureThreadRequest = serde_json::from_value(request_json.clone()).unwrap();
        assert_eq!(serde_json::to_value(request).unwrap(), request_json);

        let send_json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/conversation-v1/send.json")).unwrap();
        let send: SendMessageRequest = serde_json::from_value(send_json.clone()).unwrap();
        assert_eq!(send.context.as_deref(), Some("에이전트에게만 가는 덧붙임"));
        assert_eq!(serde_json::to_value(send).unwrap(), send_json);

        let response_json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/conversation-v1/response.json"))
                .unwrap();
        let response: MessageReceipt = serde_json::from_value(response_json.clone()).unwrap();
        assert_eq!(response.status, ReceiptStatus::Accepted);
        assert_eq!(serde_json::to_value(response).unwrap(), response_json);

        let event_json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/conversation-v1/event.json")).unwrap();
        let event: ConversationEvent = serde_json::from_value(event_json.clone()).unwrap();
        assert!(
            matches!(event, ConversationEvent::Text { ref stream_id, ref text } if stream_id == "stream-1" && text == "hello")
        );
        assert_eq!(serde_json::to_value(event).unwrap(), event_json);

        let models_json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/conversation-v1/models.json")).unwrap();
        let models: ModelsReply = serde_json::from_value(models_json.clone()).unwrap();
        assert_eq!(serde_json::to_value(models).unwrap(), models_json);

        let profiles_json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/conversation-v1/profiles.json"))
                .unwrap();
        let profiles: ProfilesReply = serde_json::from_value(profiles_json.clone()).unwrap();
        assert_eq!(serde_json::to_value(profiles).unwrap(), profiles_json);

        let thread_json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/conversation-v1/thread.json")).unwrap();
        let thread: ThreadByKeyReply = serde_json::from_value(thread_json.clone()).unwrap();
        assert_eq!(serde_json::to_value(thread).unwrap(), thread_json);

        let execution_json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/conversation-v1/execution.json"))
                .unwrap();
        let execution: ExecutionThreadRequest =
            serde_json::from_value(execution_json.clone()).unwrap();
        assert_eq!(serde_json::to_value(execution).unwrap(), execution_json);

        let legacy: ConversationThread = serde_json::from_str(
            r#"{"id":"legacy","external":{"namespace":"ns","key":"key"},"title":"Legacy","model":{"id":"model","label":"Model"},"created_at":"2026-10-30T12:00:00Z","archived":false}"#,
        ).unwrap();
        assert!(legacy.model.group.is_none());
        assert!(legacy.profile.is_none());
        assert!(legacy.execution_id.is_none());
    }

    #[test]
    fn empty_context_is_omitted() {
        let request = SendMessageRequest {
            request_id: "request-1".into(),
            text: "hello".into(),
            attachments: vec![],
            context: Some(String::new()),
        };
        let value = serde_json::to_value(request).unwrap();
        assert!(value.get("context").is_none());

        let legacy: SendMessageRequest =
            serde_json::from_str(r#"{"request_id":"legacy","text":"hello","attachments":[]}"#)
                .unwrap();
        assert!(legacy.context.is_none());
    }

    #[test]
    fn send_message_request_schema_includes_optional_context() {
        let schema = serde_json::to_value(schemars::schema_for!(SendMessageRequest)).unwrap();
        assert!(schema["properties"]["context"].is_object());
        assert!(!schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field == "context"));
    }
}
