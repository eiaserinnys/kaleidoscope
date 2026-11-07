//! 데스크톱 배경 그림 올리기. 그림은 서버 자산으로 올린 뒤 참조만 상태에 남긴다.
use std::sync::atomic::Ordering;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::assets::{AssetDep, AssetFormat, AssetUpload};
use kaleidoscope_contract::{data, errors, CoreError, DesktopWallpaper, LinkStatus};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::registry_client::{FailureStage, RegistryError};
use crate::Inner;

const SOURCE: &str = "사용자가 선택한 배경 그림";
const LICENSE: &str = "user-provided";

fn format_name(format: AssetFormat) -> &'static str {
    match format {
        AssetFormat::Png => "png",
        AssetFormat::Jpeg => "jpeg",
        AssetFormat::Webp => "webp",
        AssetFormat::Html => "html",
        AssetFormat::Svg => "svg",
        AssetFormat::Gif => "gif",
        AssetFormat::Javascript => "javascript",
        AssetFormat::Woff2 => "woff2",
        AssetFormat::Ttf => "ttf",
        AssetFormat::Otf => "otf",
    }
}

pub(crate) fn upload(
    inner: &Arc<Inner>,
    desktop_id: &str,
    format: AssetFormat,
    data_base64: String,
) -> Result<DesktopWallpaper, CoreError> {
    if !matches!(
        format,
        AssetFormat::Png | AssetFormat::Jpeg | AssetFormat::Webp
    ) {
        return Err(errors::DESK_WALLPAPER_FORMAT_INVALID(format_name(format)));
    }
    {
        let state = inner.state.lock().unwrap();
        if !state
            .shared
            .desktops
            .iter()
            .any(|desktop| desktop.id == desktop_id)
        {
            return Err(errors::DESK_WALLPAPER_DESKTOP_NOT_FOUND()
                .and_details(vec![format!("desktop_id: {desktop_id}")]));
        }
    }
    let (file, generation) = {
        let state = inner.state.lock().unwrap();
        if !matches!(state.link, LinkStatus::Connected { .. }) {
            return Err(errors::DESK_WALLPAPER_SERVER_REQUIRED());
        }
        let file = inner
            .link_file
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(errors::DESK_WALLPAPER_SERVER_REQUIRED)?;
        (file, inner.generation.load(Ordering::SeqCst))
    };
    let bytes = STANDARD
        .decode(&data_base64)
        .map_err(|_| errors::DESK_WALLPAPER_ENCODING_INVALID())?;
    if bytes.len() as u64 > data::MEDIA_MAX_BYTES {
        return Err(errors::DESK_WALLPAPER_UPLOAD_TOO_LARGE(
            kaleidoscope_contract::size::format_byte_limit(data::MEDIA_MAX_BYTES),
        ));
    }
    let upload = AssetUpload {
        id: format!("wallpaper-{}", Uuid::new_v4()),
        version: 1,
        format,
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        source: SOURCE.into(),
        license: LICENSE.into(),
        data_base64,
    };
    let record = inner
        .registry
        .asset_post(&file.server_url, &file.token, &upload)
        .map_err(|error| match error {
            RegistryError::Validation(error) => error,
            RegistryError::Failure { stage, detail, .. } => {
                let error = match stage {
                    FailureStage::Send => errors::DESK_WALLPAPER_UPLOAD_SEND_FAILED(),
                    FailureStage::Status => errors::DESK_WALLPAPER_UPLOAD_STATUS_REJECTED(),
                    FailureStage::Read => errors::DESK_WALLPAPER_UPLOAD_RESPONSE_READ_FAILED(),
                };
                error.and_details(vec![detail.replace(&file.token, "[가림]")])
            }
            RegistryError::Unauthorized | RegistryError::NotFound => {
                errors::DESK_WALLPAPER_UPLOAD_STATUS_REJECTED()
            }
        })?;
    if record.meta.id != upload.id
        || record.meta.version != upload.version
        || record.meta.format != format
    {
        return Err(errors::DESK_WALLPAPER_UPLOAD_STATUS_REJECTED());
    }
    if !crate::link::is_current(inner, generation) {
        return Err(errors::SERVER_SWITCH_CANCELLED());
    }
    Ok(DesktopWallpaper {
        id: desktop_id.into(),
        desktop_id: desktop_id.into(),
        asset: AssetDep {
            id: record.meta.id,
            version: record.meta.version,
        },
        updated_at: crate::state_commands::timestamp(),
    })
}
