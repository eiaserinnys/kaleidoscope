use std::io::Cursor;
use std::sync::Arc;
use std::time::Instant;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{AnimationDecoder, GenericImageView, ImageDecoder, ImageEncoder};
use kaleidoscope_contract::{data::MediaData, errors, CoreError};

use super::Entry;

pub(super) fn dimensions(bytes: &[u8], mime: &str) -> (Option<u32>, Option<u32>) {
    if raster(mime) {
        if let Ok(image) = image::load_from_memory(bytes) {
            let (w, h) = image.dimensions();
            return (Some(w), Some(h));
        }
    }
    (None, None)
}
fn raster(mime: &str) -> bool {
    matches!(
        mime.split(';').next().unwrap_or("").trim(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    )
}
pub(super) fn host_from_url(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| "알 수 없는 서버".into())
}

pub(super) fn shrink(entry: &Entry, max: u32, media: &str) -> Result<Entry, CoreError> {
    if !raster(&entry.mime) {
        return Ok(entry.clone());
    }
    if entry.mime.split(';').next().unwrap_or("").trim() == "image/gif" {
        if let Ok(decoder) = image::codecs::gif::GifDecoder::new(Cursor::new(&*entry.bytes)) {
            let (width, height) = decoder.dimensions();
            let mut frames = decoder.into_frames().take(2);
            if matches!((frames.next(), frames.next()), (Some(Ok(_)), Some(Ok(_)))) {
                let mut original = entry.clone();
                original.width = original.width.or(Some(width));
                original.height = original.height.or(Some(height));
                return Ok(original);
            }
        }
    }
    let image = image::load_from_memory(&entry.bytes).map_err(|err| {
        errors::MEDIA_RESIZE_IMAGE_DECODE_FAILED(media).and_details(vec![err.to_string()])
    })?;
    let (w, h) = image.dimensions();
    let resized = if w.max(h) > max {
        image.resize(max, max, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let (width, height) = resized.dimensions();
    let rgba = resized.to_rgba8();
    let transparent = rgba.pixels().any(|pixel| pixel[3] < 255);
    let mut bytes = Vec::new();
    let mime = if transparent {
        resized
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .map_err(|err| {
                errors::MEDIA_RESIZE_PNG_ENCODE_FAILED(media).and_details(vec![err.to_string()])
            })?;
        "image/png"
    } else {
        let rgb = resized.to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 85)
            .write_image(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
            .map_err(|err| {
                errors::MEDIA_RESIZE_JPEG_ENCODE_FAILED(media).and_details(vec![err.to_string()])
            })?;
        "image/jpeg"
    };
    Ok(Entry {
        bytes: Arc::new(bytes),
        mime: mime.into(),
        width: Some(width),
        height: Some(height),
        used: Instant::now(),
    })
}
pub(super) fn as_data(entry: &Entry) -> MediaData {
    MediaData {
        mime: entry.mime.clone(),
        data_base64: STANDARD.encode(&*entry.bytes),
        width: entry.width,
        height: entry.height,
    }
}
pub(super) fn mime_for_path(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}
