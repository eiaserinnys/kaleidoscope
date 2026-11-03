//! 기기 프로세스의 실행 명세와 스트림 계약.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ProcessSpec {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ProcessAccess {
    pub app_id: String,
    pub permission: String,
    pub spec_hash: String,
    pub granted_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ProcessSnapshot {
    pub handle: String,
    #[ts(type = "number")]
    pub after: u64,
    pub checkpoint: Option<serde_json::Value>,
    pub cwd: String,
    pub services: BTreeMap<String, Option<String>>,
    pub exit: Option<ProcessExit>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ProcessExit {
    pub code: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum ProcessStartResult {
    Started {
        handle: String,
        cwd: String,
        services: BTreeMap<String, Option<String>>,
    },
    Cancelled {
        status: String,
    },
}

/// 이름과 실행 내용을 정렬 JSON으로 직렬화해 SHA256을 계산한다.
pub fn spec_hash(spec: &ProcessSpec) -> String {
    let canonical = BTreeMap::from([
        (
            "args",
            serde_json::to_value(&spec.args).expect("args serialize"),
        ),
        (
            "command",
            serde_json::to_value(&spec.command).expect("command serialize"),
        ),
        (
            "env",
            serde_json::to_value(&spec.env).expect("env serialize"),
        ),
        (
            "name",
            serde_json::to_value(&spec.name).expect("name serialize"),
        ),
    ]);
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&canonical).expect("spec serialize"))
    )
}
