//! 실시간 연결의 종류와 메시지 경계.
use crate::CoreError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const REALTIME_BLOCK_SET_VERSION: u32 = 23;
pub const REALTIME_CLIENT_VERSION: u32 = 5;
pub const REALTIME_CONNECTION_VERSION: u32 = 3;
pub const REALTIME_MESSAGE_MAX_BYTES: usize = 8 * 1024 * 1024;
pub const REALTIME_QUEUE_MAX_MESSAGES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum RealtimeKind {
    Websocket,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum RealtimePayload {
    Text { text: String },
    Binary { bytes: Vec<u8> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum RealtimeMessage {
    Text {
        #[ts(type = "number")]
        sequence: u64,
        text: String,
    },
    Binary {
        #[ts(type = "number")]
        sequence: u64,
        bytes: Vec<u8>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct RealtimeTerminal {
    #[ts(type = "number")]
    pub sequence: u64,
    pub code: u16,
    pub reason: String,
    pub was_clean: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<CoreError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum RealtimeItem {
    Message(RealtimeMessage),
    Terminal(RealtimeTerminal),
}
