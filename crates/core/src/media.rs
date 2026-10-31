//! 미디어 원본과 축소 결과의 메모리 캐시.
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read};
use std::sync::{Arc, Mutex};
use std::time::{Instant, UNIX_EPOCH};

use crate::{
    app_commands,
    connections::{self, RequestError},
    error, files, Inner,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{GenericImageView, ImageEncoder};
use kaleidoscope_contract::{
    data::{self, HttpMethod, MediaData, MediaRef},
    registry::ConnectionAccept,
    CoreError, ErrorCode, PermissionDecl,
};

const CACHE_MAX: usize = 128 * 1024 * 1024;
#[derive(Default)]
pub(crate) struct MediaCache {
    items: Mutex<BTreeMap<String, Entry>>,
}
#[derive(Clone)]
struct Entry {
    bytes: Arc<Vec<u8>>,
    mime: String,
    width: Option<u32>,
    height: Option<u32>,
    used: Instant,
}

impl MediaCache {
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.items.lock().unwrap().len()
    }
    fn get(&self, key: &str) -> Option<Entry> {
        let mut items = self.items.lock().unwrap();
        let entry = items.get_mut(key)?;
        entry.used = Instant::now();
        Some(entry.clone())
    }
    fn put(&self, key: String, entry: Entry) {
        let mut items = self.items.lock().unwrap();
        items.insert(key, entry);
        while items.values().map(|entry| entry.bytes.len()).sum::<usize>() > CACHE_MAX {
            let Some(key) = items
                .iter()
                .min_by_key(|(_, entry)| entry.used)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            items.remove(&key);
        }
    }
}

pub(crate) fn get(
    inner: &Arc<Inner>,
    window: &str,
    media: &MediaRef,
    max_px: Option<u32>,
) -> Result<MediaData, CoreError> {
    if max_px == Some(0) {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    let media = match media {
        MediaRef::Resource(media) => media,
        MediaRef::Asset(media) => {
            let version = {
                let state = inner.state.lock().unwrap();
                let window = state
                    .shared
                    .windows
                    .iter()
                    .find(|item| item.id == window)
                    .ok_or_else(|| error::make(ErrorCode::NotFound))?;
                let definition =
                    app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
                let dependency = definition
                    .assets
                    .iter()
                    .find(|asset| asset.id == media.asset)
                    .ok_or_else(|| error::make(ErrorCode::PermissionDenied))?;
                if media
                    .version
                    .is_some_and(|version| version != dependency.version)
                {
                    return Err(error::make(ErrorCode::PermissionDenied));
                }
                dependency.version
            };
            if let Some((meta, bytes)) = crate::builtin::bundled_asset(&media.asset, version) {
                return Ok(MediaData {
                    mime: match meta.format {
                        kaleidoscope_contract::assets::AssetFormat::Svg => "image/svg+xml",
                        kaleidoscope_contract::assets::AssetFormat::Png => "image/png",
                        kaleidoscope_contract::assets::AssetFormat::Webp => "image/webp",
                        kaleidoscope_contract::assets::AssetFormat::Jpeg => "image/jpeg",
                        kaleidoscope_contract::assets::AssetFormat::Gif => "image/gif",
                    }
                    .into(),
                    data_base64: STANDARD.encode(bytes),
                    width: None,
                    height: None,
                });
            }
            if kaleidoscope_contract::builtin::is_bundled_asset(&media.asset, version) {
                return Err(error::make(ErrorCode::NotFound));
            }
            let link = inner.link_file.lock().unwrap().clone().ok_or_else(|| {
                error::with_message(ErrorCode::Server, "서버에 연결되어 있지 않습니다")
            })?;
            use sha2::{Digest, Sha256};
            let namespace = format!(
                "{:x}",
                Sha256::digest(format!("{}\0{}", link.server_url, link.token).as_bytes())
            );
            let key = format!("asset:{namespace}:{}:{version}", media.asset);
            let original_key = format!("{key}|original");
            let original = if let Some(entry) = inner.media_cache.get(&original_key) {
                entry
            } else {
                if !matches!(
                    inner.state.lock().unwrap().link,
                    kaleidoscope_contract::LinkStatus::Connected { .. }
                ) {
                    return Err(error::with_message(
                        ErrorCode::Server,
                        "서버에 연결되어 있지 않습니다",
                    ));
                }
                let download = inner
                    .registry
                    .asset_get(&link.server_url, &link.token, &media.asset, version)
                    .map_err(|error| {
                        error::with_message(
                            ErrorCode::Server,
                            &format!("자산 받기 실패: {error:?}"),
                        )
                    })?;
                if format!("{:x}", Sha256::digest(&download.bytes)) != download.sha256 {
                    return Err(error::with_message(
                        ErrorCode::Server,
                        "자산 해시가 올바르지 않습니다",
                    ));
                }
                let (width, height) = dimensions(&download.bytes, &download.mime);
                let entry = Entry {
                    bytes: Arc::new(download.bytes),
                    mime: download.mime,
                    width,
                    height,
                    used: Instant::now(),
                };
                inner.media_cache.put(original_key, entry.clone());
                entry
            };
            let result = if let Some(max) = max_px {
                shrink(&original, max)?
            } else {
                original
            };
            return Ok(as_data(&result));
        }
    };
    let module = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|item| item.id == window)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        definition
            .permissions
            .iter()
            .find(|permission| permission.id() == media.permission)
            .cloned()
            .ok_or_else(|| error::make(ErrorCode::PermissionDenied))?
    };
    let (key, file) = match module {
        PermissionDecl::Files { .. } => {
            let state = inner.state.lock().unwrap();
            let root = files::granted_root(&state, window, &media.permission, false)?;
            let path = files::resolve_path(&inner.data_dir, &root, &media.path, false, false)?;
            let modified = fs::metadata(&path)
                .map_err(|err| error::io_error(&err))?
                .modified()
                .map_err(|err| error::io_error(&err))?
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            (
                format!(
                    "file:{}:{}:{}:{modified}",
                    root.display(),
                    media.path,
                    serde_json::to_string(&media.query).unwrap()
                ),
                Some(path),
            )
        }
        PermissionDecl::Connection { .. } => {
            let (_, info) = connections::authorize(
                inner,
                window,
                &media.permission,
                HttpMethod::Get,
                &media.path,
            )?;
            (
                format!(
                    "connection:{}:{}:{}",
                    info.name,
                    media.path,
                    serde_json::to_string(&media.query).unwrap()
                ),
                None,
            )
        }
        PermissionDecl::Http {
            base_url, paths, ..
        } => {
            if !kaleidoscope_contract::validate::allowed_public_http_path(&paths, &media.path) {
                return Err(error::make(ErrorCode::PermissionDenied));
            }
            (
                format!(
                    "http:{}:{}:{}",
                    base_url,
                    media.path,
                    serde_json::to_string(&media.query).unwrap()
                ),
                None,
            )
        }
        PermissionDecl::LocalAgent { .. } => {
            return Err(error::make(ErrorCode::PermissionDenied));
        }
    };
    let variant = format!("{key}|{:?}", max_px);
    if let Some(entry) = inner.media_cache.get(&variant) {
        return Ok(as_data(&entry));
    }
    let original_key = format!("{key}|original");
    let original = if let Some(entry) = inner.media_cache.get(&original_key) {
        entry
    } else {
        let (bytes, mime) = if let Some(path) = file {
            let file = fs::File::open(&path).map_err(|err| error::io_error(&err))?;
            let mut bytes = Vec::new();
            file.take(data::MEDIA_MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|err| error::io_error(&err))?;
            (bytes, mime_for_path(&media.path).to_string())
        } else {
            let reply = connections::request(
                inner,
                window,
                &media.permission,
                HttpMethod::Get,
                &media.path,
                media.query.clone(),
                None,
                ConnectionAccept::Bytes,
            )
            .map_err(|err| match err {
                RequestError::Core(err) => err,
                RequestError::Login(_) => error::make(ErrorCode::NotGranted),
            })?;
            if !(200..300).contains(&reply.status) {
                return Err(connections::response_error(&reply));
            }
            let bytes = STANDARD
                .decode(reply.data_base64.unwrap_or_default())
                .map_err(|_| error::make(ErrorCode::Server))?;
            (bytes, reply.mime)
        };
        if bytes.len() as u64 > data::MEDIA_MAX_BYTES {
            return Err(error::with_message(ErrorCode::Io, "미디어가 너무 큽니다"));
        }
        let (width, height) = dimensions(&bytes, &mime);
        let entry = Entry {
            bytes: Arc::new(bytes),
            mime,
            width,
            height,
            used: Instant::now(),
        };
        inner.media_cache.put(original_key, entry.clone());
        entry
    };
    let result = if let Some(max) = max_px {
        shrink(&original, max)?
    } else {
        original.clone()
    };
    if !Arc::ptr_eq(&original.bytes, &result.bytes) {
        inner.media_cache.put(variant, result.clone());
    }
    Ok(as_data(&result))
}

fn dimensions(bytes: &[u8], mime: &str) -> (Option<u32>, Option<u32>) {
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
fn shrink(entry: &Entry, max: u32) -> Result<Entry, CoreError> {
    if !raster(&entry.mime) {
        return Ok(entry.clone());
    }
    let image = image::load_from_memory(&entry.bytes)
        .map_err(|err| error::with_message(ErrorCode::Io, &err.to_string()))?;
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
            .map_err(|err| error::with_message(ErrorCode::Io, &err.to_string()))?;
        "image/png"
    } else {
        let rgb = resized.to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 85)
            .write_image(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
            .map_err(|err| error::with_message(ErrorCode::Io, &err.to_string()))?;
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
fn as_data(entry: &Entry) -> MediaData {
    MediaData {
        mime: entry.mime.clone(),
        data_base64: STANDARD.encode(&*entry.bytes),
        width: entry.width,
        height: entry.height,
    }
}
fn mime_for_path(path: &str) -> &'static str {
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
