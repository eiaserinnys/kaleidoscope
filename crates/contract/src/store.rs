//! 스토어 설치 계약. 네트워크 접근과 설치 처리는 별도 구현이 맡는다.
use crate::{
    assets::{AppIconRef, AssetUpload},
    data::ResourceMediaRef,
    registry::RegistryApp,
    PermissionDecl, Requires,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;
use ts_rs::TS;

pub const STORE_APP_JSON_MAX_BYTES: u64 = 1024 * 1024;
pub const STORE_ASSETS_MAX_BYTES: u64 = 10 * 1024 * 1024;
pub const STORE_SCREENSHOT_MAX_BYTES: u64 = 2 * 1024 * 1024;
pub const STORE_SCREENSHOT_MAX_COUNT: usize = 5;
pub const STORE_MANIFEST_MAX_BYTES: u64 = 1024 * 1024;
pub const STORE_INDEX_MAX_BYTES: u64 = crate::data::SOURCE_MAX_BYTES;
pub const STORE_DETAIL_MAX_BYTES: u64 = crate::data::SOURCE_MAX_BYTES;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StoreOrigin {
    pub store_url: String,
    pub store_app_id: String,
    pub release: u32,
    pub digest: String,
}

/// 식 변수 $apps의 각 항목. 출처 없는 앱의 관련 값은 null이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct InstalledAppValue {
    pub id: String,
    pub name: String,
    pub version: u32,
    pub origin: Option<StoreOrigin>,
    pub installed_version: Option<u32>,
    pub modified: bool,
    pub icon: Option<AppIconRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct StoreIndexValue {
    pub format: u32,
    pub generated_at: String,
    pub server: String,
    pub items: Vec<StoreIndexItem>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct StoreIndexItem {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub category: String,
    pub publisher: String,
    pub release: u32,
    pub icon: Option<ResourceMediaRef>,
    pub badges: Vec<String>,
    pub requires: Requires,
    pub updated_at: String,
    pub compatible: bool,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct StoreDetailValue {
    pub format: u32,
    pub id: String,
    pub name: String,
    pub summary: String,
    pub description: String,
    pub category: String,
    pub publisher: String,
    pub release: u32,
    pub icon: Option<ResourceMediaRef>,
    pub screenshots: Vec<ResourceMediaRef>,
    pub releases: Vec<StoreRelease>,
    pub server: String,
    pub compatible: bool,
    pub requires: Requires,
    pub permissions: Vec<PermissionDecl>,
    pub badges: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct StoreRelease {
    pub release: u32,
    pub published_at: String,
    pub manifest: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceInstallRequest {
    pub definition_json: String,
    pub asset_uploads: Vec<AssetUpload>,
    pub manifest_base64: String,
    pub approved_digest: String,
    pub origin: StoreOrigin,
    #[serde(deserialize_with = "required_expected_version")]
    pub expected_current_version: Option<NonZeroU32>,
}
fn required_expected_version<'de, D>(deserializer: D) -> Result<Option<NonZeroU32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<NonZeroU32>::deserialize(deserializer)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceInstallReply {
    pub app: RegistryApp,
    pub unchanged: bool,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceRemoveRequest {
    pub expected_current_version: NonZeroU32,
}
