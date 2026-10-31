//! 개인 앱 서버 워커 선언과 호출 계약.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

pub const WORKER_CODE_MAX_BYTES: usize = 256 * 1024;
pub const WORKER_SCHEDULE_MIN_SECS: u32 = 10;
pub const WORKER_SCHEDULE_MAX_SECS: u32 = 86_400;
pub const WORKER_TIMEOUT_DEFAULT_SECS: u32 = 30;
pub const WORKER_TIMEOUT_MAX_SECS: u32 = 60;
pub const WORKER_SECRET_MAX_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum WorkerRuntime {
    Python3,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WorkerDecl {
    pub runtime: WorkerRuntime,
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub timeout_secs: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub schedule: Option<WorkerScheduleDecl>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<String>>")]
    pub watch_entries: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<String>>")]
    pub actions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<WorkerSecretDecl>>")]
    pub secrets: Vec<WorkerSecretDecl>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WorkerScheduleDecl {
    pub interval_secs: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub jitter_secs: Option<u32>,
    pub enabled_entry: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WorkerSecretDecl {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerInvokeRequest {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerInvokeReply {
    #[serde(default)]
    pub result: Value,
    #[serde(default)]
    pub updated_entries: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WorkerStatus {
    pub running: bool,
    pub last_run_at: Option<String>,
    pub last_trigger: Option<String>,
    pub last_duration_ms: Option<u64>,
    pub last_ok: Option<bool>,
    pub last_error: Option<String>,
}
