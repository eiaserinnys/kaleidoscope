//! 에이전트가 기기의 앱을 스토어 판으로 바꾸거나 설치해 달라고 요청하는 왕복 계약.
//!
//! 서버는 `store.update_requested` 이벤트를 보내고, 기기는 같은 `request_id`로
//! `POST /api/device/store-updates/{request_id}`에 결과를 돌려준다.

use crate::{store::StoreOrigin, CoreError};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// (17판) 스토어 판 갱신 결과 경로. 뒤에 `/{request_id}`를 붙인다.
pub const DEVICE_STORE_UPDATES_PATH: &str = "/api/device/store-updates";
/// `store.update_requested` 이벤트와 결과 왕복을 처음 지원하는 레지스트리 판.
pub const STORE_UPDATE_REGISTRY_VERSION: u32 = 17;

fn is_false(value: &bool) -> bool {
    !*value
}

/// 서버가 기기에 보내는 요청. `store.update_requested` 이벤트 본문이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StoreUpdateRequest {
    pub request_id: String,
    pub app_id: String,
    /// 생략하면 기기에 설치된 앱의 현재 출처를 쓴다. 설치되지 않은 앱은 이 값이 있어야 한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub store_url: Option<String>,
    /// 출처나 수정본을 스토어 판으로 명시 전환할 때 true다.
    #[serde(default, skip_serializing_if = "is_false")]
    #[ts(optional, as = "Option<bool>")]
    pub replace: bool,
    /// 이 시각(ISO 8601, UTC)까지 유효하다.
    pub expires_at: String,
}

/// 기기가 서버로 보내는 결과.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StoreUpdateResponse {
    pub request_id: String,
    pub result: StoreUpdateResult,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum StoreUpdateResult {
    /// 서버 트랜잭션과 기기 적용까지 끝났다.
    Installed { origin: StoreOrigin, version: u32 },
    /// 정의와 출처가 모두 같아 바꿀 것이 없었다.
    Unchanged { origin: StoreOrigin, version: u32 },
    /// 쉘 전체 동의를 등록했고 사용자의 응답을 기다린다. MCP 요청은 여기서 끝난다.
    ConsentRequired { consent_request_id: String },
    Error { error: CoreError },
}

/// MCP `update_app_from_store` 입력.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct UpdateAppFromStoreArgs {
    /// 스토어 판으로 바꾸거나 설치할 앱 id.
    pub app_id: String,
    /// 생략하면 기기에 설치된 앱의 현재 출처를 쓴다. 설치되지 않은 앱은 반드시 지정한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub store_url: Option<String>,
    /// 출처나 수정본을 스토어 판으로 명시 전환한다. 권한 검토 범위가 같으면 동의 없이 적용한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub replace: Option<bool>,
    /// 요청할 기기 id. 생략하면 이 MCP 연결의 기기, 그다음 활성 기기 한 대를 쓴다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub device_id: Option<String>,
    /// 작업 id. 생략하면 이 MCP 연결의 작업을 쓴다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub workspace_id: Option<String>,
}

/// MCP `update_app_from_store` 결과.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct UpdateAppFromStoreResult {
    pub request_id: String,
    pub device_id: String,
    pub app_id: String,
    pub status: StoreUpdateStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin: Option<StoreOrigin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub consent_request_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum StoreUpdateStatus {
    Installed,
    Unchanged,
    ConsentRequired,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_update_request_roundtrips_with_flattened_event_tag() {
        let event = crate::registry::DeviceEvent::StoreUpdateRequested {
            request: StoreUpdateRequest {
                request_id: "r1".into(),
                app_id: "clock".into(),
                store_url: Some("https://apps.example.org/store".into()),
                replace: true,
                expires_at: "2026-11-10T03:33:35.000Z".into(),
            },
        };
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["event"], "store.update_requested");
        assert_eq!(value["request_id"], "r1");
        assert_eq!(value["app_id"], "clock");
        assert_eq!(value["replace"], true);
        let back: crate::registry::DeviceEvent = serde_json::from_value(value).unwrap();
        assert_eq!(back, event);
    }

    #[test]
    fn store_update_request_omits_absent_optionals_and_false_replace() {
        let request = StoreUpdateRequest {
            request_id: "r2".into(),
            app_id: "clock".into(),
            store_url: None,
            replace: false,
            expires_at: "2026-11-10T03:33:35.000Z".into(),
        };
        let value = serde_json::to_value(&request).unwrap();
        assert!(value.get("store_url").is_none());
        assert!(value.get("replace").is_none());
        let back: StoreUpdateRequest = serde_json::from_value(value).unwrap();
        assert_eq!(back, request);
    }

    #[test]
    fn store_update_response_roundtrips_every_status() {
        let origin = StoreOrigin {
            store_url: "https://apps.example.org/store".into(),
            store_app_id: "clock".into(),
            release: 3,
            digest: "abc".into(),
        };
        for (result, status) in [
            (
                StoreUpdateResult::Installed {
                    origin: origin.clone(),
                    version: 4,
                },
                "installed",
            ),
            (
                StoreUpdateResult::Unchanged {
                    origin: origin.clone(),
                    version: 4,
                },
                "unchanged",
            ),
            (
                StoreUpdateResult::ConsentRequired {
                    consent_request_id: "c1".into(),
                },
                "consent_required",
            ),
            (
                StoreUpdateResult::Error {
                    error: crate::errors::STORECLIENT_UPDATE_REQUEST_EXPIRED(),
                },
                "error",
            ),
        ] {
            let response = StoreUpdateResponse {
                request_id: "r3".into(),
                result,
            };
            let value = serde_json::to_value(&response).unwrap();
            assert_eq!(value["result"]["status"], status);
            let back: StoreUpdateResponse = serde_json::from_value(value).unwrap();
            assert_eq!(back, response);
        }
    }

    #[test]
    fn store_update_registry_version_is_the_current_registry_version() {
        assert_eq!(
            crate::registry::REGISTRY_VERSION,
            crate::store_update::STORE_UPDATE_REGISTRY_VERSION
        );
        assert!(crate::store_update::STORE_UPDATE_REGISTRY_VERSION > crate::registry::WALLPAPER_REGISTRY_VERSION);
    }
}
