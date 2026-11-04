//! 같이 보기 창을 읽고 조작하는 요청과 응답 계약.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::CoreError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ReadWindowArgs {
    pub window_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ActWindowArgs {
    pub window_id: String,
    pub view_id: String,
    pub action: WindowAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum WindowAction {
    Click {
        target: u32,
    },
    Type {
        target: u32,
        #[schemars(description = "UTF-8로 인코딩한 크기가 16KiB 이하여야 한다.")]
        text: String,
        mode: TextMode,
    },
    Select {
        target: u32,
        choice: WindowChoice,
    },
    Scroll {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        target: Option<u32>,
        direction: Direction,
        #[schemars(range(min = 1, max = 10000))]
        amount: u32,
    },
    Key {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        target: Option<u32>,
        key: String,
    },
    Point {
        x: f64,
        y: f64,
        gesture: PointGesture,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(
    tag = "by",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
#[ts(export, export_to = "contract.ts")]
pub enum WindowChoice {
    Value(serde_json::Value),
    Label(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum TextMode {
    Replace,
    Append,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum PointGesture {
    Click,
    DoubleClick,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum WindowControlOperation {
    Read {
        image: bool,
    },
    Act {
        view_id: String,
        action: WindowAction,
        image: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WindowControlRequest {
    pub request_id: String,
    pub window_id: String,
    pub expires_at: String,
    pub operation: WindowControlOperation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WindowGeometry {
    pub css_width: f64,
    pub css_height: f64,
    pub pixel_width: u32,
    pub pixel_height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WindowObservation {
    pub view_id: String,
    pub app_name: String,
    pub window_title: String,
    pub text: String,
    pub settled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub geometry: Option<WindowGeometry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image_base64: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WindowControlSuccess {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub before_text: Option<String>,
    pub after: WindowObservation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum WindowControlResult {
    Ok { value: WindowControlSuccess },
    Error { error: CoreError, applied: bool },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WindowControlResponse {
    pub request_id: String,
    pub window_id: String,
    pub result: WindowControlResult,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum WindowControlMode {
    Full,
    Diff,
    Unchanged,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WindowControlToolOutput {
    pub window_id: String,
    pub device_name: String,
    pub app_name: String,
    pub window_title: String,
    pub view_id: String,
    pub mode: WindowControlMode,
    pub text: String,
    pub settled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub geometry: Option<WindowGeometry>,
}
