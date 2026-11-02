//! 창마다 실행하는 클라이언트 로직과 픽셀·시간축 데이터 계약.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::{
    assets::AssetDep,
    data::{Actions, Binding},
};

pub const CLIENT_OUTPUT_MAX_BYTES: usize = 1024 * 1024;
pub const CLIENT_PICK_FILE_MAX_BYTES: u64 = 512 * 1024 * 1024;
pub const CLIENT_PING_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ClientDecl {
    pub runtime: ClientRuntime,
    pub entry: AssetDep,
    #[serde(default)]
    pub inputs: BTreeMap<String, Binding>,
    #[serde(default)]
    pub outputs: BTreeMap<String, ClientOutput>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub commands: BTreeMap<String, Actions>,
    #[serde(default)]
    pub state_keys: Vec<String>,
    #[serde(default)]
    pub storage_entries: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub http_permissions: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub device_storage: Option<DeviceStorage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub capabilities: Option<Vec<ClientCapability>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ClientRuntime {
    Javascript,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ClientOutput {
    pub default: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ClientFile {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum CanvasFit {
    #[default]
    Contain,
    Cover,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct Clock {
    pub position: f64,
    pub sampled_at: f64,
    pub rate: f64,
    pub running: bool,
    pub duration: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum PointerPhase {
    Down,
    Move,
    Up,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct PointerEventData {
    pub phase: PointerPhase,
    pub pointer_id: i64,
    pub x: f64,
    pub y: f64,
    pub buttons: u32,
    pub shift: bool,
    pub alt: bool,
    pub ctrl: bool,
    pub meta: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct TimelineTrack {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub locked: bool,
    pub items: Vec<TimelineItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub waveform: Option<Waveform>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct Waveform {
    pub peaks: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub end: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct TimelineItem {
    pub id: String,
    pub start: f64,
    pub end: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tone: Option<Tone>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub series: Option<u32>,
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub movable: bool,
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub resizable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum Tone {
    Neutral,
    Accent,
    Success,
    Warning,
    Danger,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct TimelineMarker {
    pub id: String,
    pub time: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub movable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum EditPhase {
    Preview,
    Commit,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum EditKind {
    Move,
    ResizeStart,
    ResizeEnd,
    MoveMarker,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct TimelineEdit {
    pub phase: EditPhase,
    pub kind: EditKind,
    pub id: String,
    pub track: Option<String>,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct DeviceStorage {
    pub prefixes: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ClientCapability {
    Share,
    KeepAwake,
}

/// 격리 클라이언트와 호스트 사이의 요청.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "type")]
#[ts(export, export_to = "contract.ts")]
pub enum ClientBridgeRequest {
    #[serde(rename = "ks-client-http-read")]
    HttpRead {
        #[serde(rename = "requestId")]
        request_id: String,
        permission: String,
        path: String,
        query: BTreeMap<String, Value>,
    },
    #[serde(rename = "ks-client-blob-put")]
    BlobPut {
        #[serde(rename = "requestId")]
        request_id: String,
        key: String,
        #[serde(default, rename = "fileId", skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "ArrayBuffer")]
        bytes: Option<Vec<u8>>,
    },
    #[serde(rename = "ks-client-blob-open")]
    BlobOpen {
        #[serde(rename = "requestId")]
        request_id: String,
        key: String,
    },
    #[serde(rename = "ks-client-blob-remove")]
    BlobRemove {
        #[serde(rename = "requestId")]
        request_id: String,
        key: String,
    },
    #[serde(rename = "ks-client-blob-list")]
    BlobList {
        #[serde(rename = "requestId")]
        request_id: String,
        prefix: String,
    },
    #[serde(rename = "ks-client-save-prompt")]
    SavePrompt {
        #[serde(rename = "requestId")]
        request_id: String,
        suggested_name: String,
        mime: String,
    },
    #[serde(rename = "ks-client-can-share")]
    CanShare {
        #[serde(rename = "requestId")]
        request_id: String,
        file_id: String,
    },
    #[serde(rename = "ks-client-share")]
    Share {
        #[serde(rename = "requestId")]
        request_id: String,
        file_id: String,
        title: String,
    },
    #[serde(rename = "ks-client-keep-awake")]
    KeepAwake {
        #[serde(rename = "requestId")]
        request_id: String,
        enabled: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "type")]
#[ts(export, export_to = "contract.ts")]
pub enum ClientBridgeReply {
    #[serde(rename = "ks-client-reply")]
    Reply {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(
            optional,
            type = "JsonValue | ArrayBuffer | { bytes: ArrayBuffer; mime: string }"
        )]
        result: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        error: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ClientLifecycle {
    pub visible: bool,
    pub focused: bool,
    pub viewport: ClientViewport,
    pub phase: LifecyclePhase,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ClientViewport {
    pub width: f64,
    pub height: f64,
    pub coarse_pointer: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum LifecyclePhase {
    Ready,
    Change,
    Closing,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct EventModifiers {
    pub shift: bool,
    pub alt: bool,
    pub ctrl: bool,
    pub meta: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct TimelineViewport {
    pub start: f64,
    pub end: f64,
}
