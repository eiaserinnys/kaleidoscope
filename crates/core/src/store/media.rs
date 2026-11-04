//! 화면에 보이는 스토어 아이콘과 스크린샷만 읽는다.
use super::{
    fetch::{StoreClient, StoreFailure, Transport},
    StoreUrl,
};
use kaleidoscope_contract::{
    assets::AssetFormat,
    data::{ResourceMediaRef, MEDIA_MAX_BYTES},
    errors,
    store::STORE_SCREENSHOT_MAX_BYTES,
    CoreError,
};

pub(crate) fn media_key(media: &ResourceMediaRef) -> Result<(StoreUrl, String), CoreError> {
    if media.query.len() != 1 {
        return Err(errors::STORECLIENT_MEDIA_QUERY_INVALID());
    }
    let server = media
        .query
        .get("server")
        .ok_or_else(errors::STORECLIENT_MEDIA_QUERY_INVALID)?;
    let url = StoreUrl::parse(server)?;
    url.path(&media.path)?;
    let parts: Vec<_> = media.path.split('/').collect();
    let valid = parts.len() == 6 && parts[0] == "apps" && parts[3] == "assets"
        || parts.len() == 5 && parts[0] == "apps" && parts[3] == "screenshots";
    if !valid || parts[1].is_empty() || parts[2].parse::<u32>().ok().filter(|v| *v > 0).is_none() {
        return Err(super::path_error(&media.path));
    }
    let key = format!("store:{}:{}", url.as_str(), media.path);
    Ok((url, key))
}

pub(crate) fn read_media<T: Transport>(
    client: &StoreClient<T>,
    path: &str,
) -> Result<(Vec<u8>, String), StoreFailure> {
    let screenshot = path.split('/').nth(3) == Some("screenshots");
    let limit = if screenshot {
        STORE_SCREENSHOT_MAX_BYTES
    } else {
        MEDIA_MAX_BYTES
    };
    let response = client.bytes(path, limit)?;
    let format = match image::guess_format(&response.bytes) {
        Ok(image::ImageFormat::Png) => AssetFormat::Png,
        Ok(image::ImageFormat::WebP) => AssetFormat::Webp,
        _ if !screenshot
            && response.mime.split(';').next().map(str::trim) == Some("image/svg+xml") =>
        {
            AssetFormat::Svg
        }
        _ => return Err(errors::STORECLIENT_MEDIA_FORMAT_INVALID(path).into()),
    };
    kaleidoscope_data::asset_validation::validate_bytes(format, &response.bytes)
        .map_err(|e| errors::STORECLIENT_MEDIA_FORMAT_INVALID(path).and_details(vec![e.message]))?;
    let mime = match format {
        AssetFormat::Png => "image/png",
        AssetFormat::Webp => "image/webp",
        AssetFormat::Svg => "image/svg+xml",
        _ => unreachable!(),
    };
    Ok((response.bytes, mime.into()))
}
