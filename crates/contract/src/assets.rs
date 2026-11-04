//! 앱이 선언하고 계정별로 등록하는 불변 자산의 계약.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum AssetFormat {
    Html,
    Svg,
    Png,
    Webp,
    Jpeg,
    Gif,
    Javascript,
    Woff2,
    Ttf,
    Otf,
}

/// 앱 아이콘이 가리키는 불변 자산.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppIconRef {
    pub asset: String,
    #[schemars(range(min = 1))]
    pub version: u32,
}

impl AppIconRef {
    pub fn validate_format(
        &self,
        app_id: &str,
        format: AssetFormat,
    ) -> Result<(), crate::CoreError> {
        if matches!(
            format,
            AssetFormat::Svg | AssetFormat::Png | AssetFormat::Webp
        ) {
            Ok(())
        } else {
            Err(crate::errors::ASSET_APP_ICON_FORMAT_INVALID(
                app_id,
                &self.asset,
                self.version,
            ))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AssetDep {
    pub id: String,
    pub version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AssetMeta {
    pub id: String,
    pub version: u32,
    pub format: AssetFormat,
    pub sha256: String,
    pub source: String,
    pub license: String,
    pub byte_size: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AssetUpload {
    pub id: String,
    pub version: u32,
    pub format: AssetFormat,
    pub sha256: String,
    pub source: String,
    pub license: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AssetRecord {
    pub meta: AssetMeta,
}
