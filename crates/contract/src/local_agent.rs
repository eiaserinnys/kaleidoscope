//! 기기에서 ACP 에이전트를 실행하는 화면 계약.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::{conversation, ErrorCode};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentSpec {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub auth_methods: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct LocalAgentAccess {
    pub app_id: String,
    pub permission: String,
    pub spec_hash: String,
    pub granted_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum LocalAgentPhase {
    ChoosingAgent,
    ChoosingFolder,
    AwaitingPermission,
    Starting,
    LoginRequired,
    Ready,
    Responding,
    Failed,
    Ended,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct LocalAgentSnapshot {
    pub generation: String,
    pub phase: LocalAgentPhase,
    pub agents: Vec<AgentChoice>,
    pub selected: Option<String>,
    pub folder_name: Option<String>,
    pub execution: Option<ExecutionConsent>,
    pub auth_methods: Vec<AuthChoice>,
    pub controls: Vec<AgentControl>,
    #[schemars(with = "Vec<serde_json::Value>")]
    pub history: Vec<conversation::ConversationItem>,
    pub stream_id: Option<String>,
    pub text: String,
    pub activity: AgentActivity,
    pub permissions: Vec<PermissionPrompt>,
    pub queued: Vec<QueuedMessage>,
    pub failure: Option<AgentFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentChoice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ExecutionConsent {
    pub spec_hash: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AuthChoice {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentActivity {
    pub busy: bool,
    pub tool: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct PermissionPrompt {
    pub id: String,
    pub title: String,
    pub options: Vec<PermissionChoice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct PermissionChoice {
    pub id: String,
    pub label: String,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentControl {
    pub id: String,
    pub label: String,
    pub category: Option<String>,
    pub value: AgentControlValue,
    pub kind: AgentControlKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum AgentControlValue {
    String(String),
    Boolean(bool),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum AgentControlKind {
    Select { options: Vec<ControlChoiceGroup> },
    Boolean,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ControlChoiceGroup {
    pub name: Option<String>,
    pub options: Vec<ControlChoice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ControlChoice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentFailure {
    pub code: ErrorCode,
    pub message: String,
    pub command: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct QueuedMessage {
    pub id: String,
    pub text: String,
    #[schemars(with = "Vec<serde_json::Value>")]
    pub attachments: Vec<conversation::ConversationAttachment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum LocalAgentUpdate {
    Snapshot {
        snapshot: LocalAgentSnapshot,
    },
    Conversation {
        #[schemars(with = "serde_json::Value")]
        update: conversation::ConversationEvent,
    },
    State {
        phase: LocalAgentPhase,
        controls: Vec<AgentControl>,
        auth_methods: Vec<AuthChoice>,
        execution: Option<ExecutionConsent>,
        failure: Option<AgentFailure>,
    },
    Permissions {
        permissions: Vec<PermissionPrompt>,
    },
    Queue {
        queued: Vec<QueuedMessage>,
    },
}

/// 실행 경계에서 에이전트 명세 배열을 엄격하게 읽고 기본 제약을 검사한다.
pub fn validate_agent_specs(value: &serde_json::Value) -> Result<Vec<AgentSpec>, String> {
    let specs: Vec<AgentSpec> = serde_json::from_value(value.clone())
        .map_err(|error| format!("에이전트 명세 형식이 올바르지 않습니다: {error}"))?;
    let mut ids = std::collections::HashSet::new();
    for spec in &specs {
        if spec.id.trim().is_empty()
            || spec.name.trim().is_empty()
            || spec.command.trim().is_empty()
        {
            return Err("에이전트 id, name, command는 비어 있을 수 없습니다".into());
        }
        if !ids.insert(&spec.id) {
            return Err(format!("에이전트 id가 겹칩니다: {}", spec.id));
        }
        let strings = std::iter::once(&spec.id)
            .chain(std::iter::once(&spec.name))
            .chain(std::iter::once(&spec.command))
            .chain(spec.args.iter())
            .chain(spec.env.keys())
            .chain(spec.env.values())
            .chain(spec.auth_methods.iter().flatten());
        if strings.into_iter().any(|value| value.contains('\0')) {
            return Err("에이전트 명세 문자열에는 NUL을 넣을 수 없습니다".into());
        }
        if spec.env.keys().any(|key| !valid_env_name(key)) {
            return Err(format!("환경 변수 이름이 올바르지 않습니다: {}", spec.id));
        }
    }
    Ok(specs)
}

/// id와 인증 방법을 제외한 실행 내용을 정렬된 JSON으로 SHA256 해시한다.
pub fn agent_spec_hash(spec: &AgentSpec) -> String {
    let mut canonical = BTreeMap::new();
    canonical.insert(
        "args",
        serde_json::to_value(&spec.args).expect("args serialize"),
    );
    canonical.insert(
        "command",
        serde_json::to_value(&spec.command).expect("command serialize"),
    );
    canonical.insert(
        "env",
        serde_json::to_value(&spec.env).expect("env serialize"),
    );
    canonical.insert(
        "name",
        serde_json::to_value(&spec.name).expect("name serialize"),
    );
    let bytes = serde_json::to_vec(&canonical).expect("execution spec serialize");
    format!("{:x}", Sha256::digest(bytes))
}

fn valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}
