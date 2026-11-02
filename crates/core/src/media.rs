//! 미디어 원본과 축소 결과의 메모리 캐시.
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Instant, UNIX_EPOCH};

use crate::{
    app_commands,
    connections::{self, RequestError},
    files, Inner,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{GenericImageView, ImageEncoder};
use kaleidoscope_contract::{
    data::{self, HttpMethod, MediaData, MediaRef},
    errors,
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

enum Source {
    File(PathBuf),
    Connection { name: String, host: String },
    Http { host: String },
}

fn file_root_error(media: &str, error: CoreError) -> CoreError {
    if error.id.is_some() {
        return error;
    }
    match error.code {
        ErrorCode::NotFound => errors::MEDIA_LOAD_FILE_ROOT_NOT_FOUND(media),
        ErrorCode::Io => errors::MEDIA_LOAD_FILE_ROOT_ACCESS_FAILED(media),
        ErrorCode::PathOutsideRoot => errors::MEDIA_LOAD_FILE_ROOT_INVALID(media),
        _ => error,
    }
}

fn file_path_error(media: &str, error: CoreError) -> CoreError {
    if error.id.is_some() {
        return error;
    }
    match error.code {
        ErrorCode::NotFound => errors::MEDIA_LOAD_FILE_PATH_NOT_FOUND(media),
        ErrorCode::PathOutsideRoot => errors::MEDIA_LOAD_FILE_PATH_OUTSIDE_ROOT(media),
        ErrorCode::PermissionDenied => errors::MEDIA_LOAD_FILE_PATH_PROTECTED(media),
        ErrorCode::Io => errors::MEDIA_LOAD_FILE_PATH_RESOLVE_FAILED(media),
        ErrorCode::FileBusy => errors::MEDIA_LOAD_FILE_PATH_BUSY(media),
        _ => error,
    }
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
    let window_id = window;
    let target = match media {
        MediaRef::Resource(media) => media.path.clone(),
        MediaRef::Asset(media) => media.asset.clone(),
    };
    if max_px == Some(0) {
        return Err(errors::MEDIA_LOAD_OPTIONS_INVALID(&target));
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
                    .find(|item| item.id == window_id)
                    .ok_or_else(|| errors::MEDIA_LOAD_WINDOW_NOT_FOUND(window_id))?;
                let definition =
                    app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                        .ok_or_else(|| errors::MEDIA_LOAD_APP_DEFINITION_NOT_FOUND(window_id))?;
                let dependency = definition
                    .assets
                    .iter()
                    .find(|asset| asset.id == media.asset)
                    .ok_or_else(|| errors::MEDIA_LOAD_ASSET_NOT_DECLARED(&media.asset))?;
                if media
                    .version
                    .is_some_and(|version| version != dependency.version)
                {
                    return Err(errors::MEDIA_LOAD_ASSET_VERSION_MISMATCH(&media.asset));
                }
                dependency.version
            };
            if let Some((meta, bytes)) = crate::builtin::bundled_asset(&media.asset, version) {
                return Ok(MediaData {
                    mime: match meta.format {
                        kaleidoscope_contract::assets::AssetFormat::Html => "text/html",
                        kaleidoscope_contract::assets::AssetFormat::Svg => "image/svg+xml",
                        kaleidoscope_contract::assets::AssetFormat::Png => "image/png",
                        kaleidoscope_contract::assets::AssetFormat::Webp => "image/webp",
                        kaleidoscope_contract::assets::AssetFormat::Jpeg => "image/jpeg",
                        kaleidoscope_contract::assets::AssetFormat::Gif => "image/gif",
                        kaleidoscope_contract::assets::AssetFormat::Javascript => "text/javascript",
                        kaleidoscope_contract::assets::AssetFormat::Woff2 => "font/woff2",
                        kaleidoscope_contract::assets::AssetFormat::Ttf => "font/ttf",
                        kaleidoscope_contract::assets::AssetFormat::Otf => "font/otf",
                    }
                    .into(),
                    data_base64: STANDARD.encode(bytes),
                    width: None,
                    height: None,
                });
            }
            if kaleidoscope_contract::builtin::is_bundled_asset(&media.asset, version) {
                return Err(errors::MEDIA_LOAD_BUNDLED_ASSET_MISSING(&media.asset));
            }
            let link =
                inner.link_file.lock().unwrap().clone().ok_or_else(|| {
                    kaleidoscope_contract::errors::MEDIA_LOAD_SERVER_NOT_CONNECTED()
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
                    return Err(kaleidoscope_contract::errors::MEDIA_LOAD_SERVER_NOT_CONNECTED());
                }
                let download = inner
                    .registry
                    .asset_get(&link.server_url, &link.token, &media.asset, version)
                    .map_err(|failure| match failure {
                        crate::registry_client::RegistryError::Failure { stage, detail } => {
                            let error = match stage {
                                crate::registry_client::FailureStage::Send => {
                                    errors::MEDIA_LOAD_ASSET_DOWNLOAD_SEND_FAILED(&media.asset)
                                }
                                crate::registry_client::FailureStage::Status => {
                                    errors::MEDIA_LOAD_ASSET_DOWNLOAD_STATUS_REJECTED(&media.asset)
                                }
                                crate::registry_client::FailureStage::Read => {
                                    errors::MEDIA_LOAD_ASSET_DOWNLOAD_RESPONSE_READ_FAILED(
                                        &media.asset,
                                    )
                                }
                            };
                            error.and_details(vec![detail])
                        }
                        failure => errors::MEDIA_LOAD_ASSET_DOWNLOAD_FAILED(&media.asset)
                            .and_details(vec![format!("{failure:?}")]),
                    })?;
                if format!("{:x}", Sha256::digest(&download.bytes)) != download.sha256 {
                    return Err(errors::MEDIA_LOAD_ASSET_HASH_MISMATCH(&media.asset));
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
                shrink(&original, max, &target)?
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
            .find(|item| item.id == window_id)
            .ok_or_else(|| errors::MEDIA_LOAD_WINDOW_NOT_FOUND(window_id))?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| errors::MEDIA_LOAD_APP_DEFINITION_NOT_FOUND(window_id))?;
        definition
            .permissions
            .iter()
            .find(|permission| permission.id() == media.permission)
            .cloned()
            .ok_or_else(|| errors::MEDIA_LOAD_PERMISSION_NOT_DECLARED(&media.permission))?
    };
    let (key, source) = match module {
        PermissionDecl::Files { .. } => {
            let state = inner.state.lock().unwrap();
            let root = files::granted_root(&state, window, &media.permission, false)
                .map_err(|error| file_root_error(&media.path, error))?;
            let path = files::resolve_path(&inner.data_dir, &root, &media.path, false, false)
                .map_err(|error| file_path_error(&media.path, error))?;
            let metadata = fs::metadata(&path).map_err(|err| {
                let error = if err.kind() == std::io::ErrorKind::NotFound {
                    errors::MEDIA_LOAD_FILE_METADATA_NOT_FOUND(&media.path)
                } else {
                    errors::MEDIA_LOAD_FILE_METADATA_FAILED(&media.path)
                };
                error.and_details(vec![err.to_string()])
            })?;
            let modified = metadata
                .modified()
                .map_err(|err| {
                    let error = if err.kind() == std::io::ErrorKind::NotFound {
                        errors::MEDIA_LOAD_FILE_MODIFIED_TIME_NOT_FOUND(&media.path)
                    } else {
                        errors::MEDIA_LOAD_FILE_MODIFIED_TIME_FAILED(&media.path)
                    };
                    error.and_details(vec![err.to_string()])
                })?
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
                Source::File(path),
            )
        }
        PermissionDecl::Connection { .. } => {
            let (_, info) = connections::authorize(
                inner,
                window_id,
                &media.permission,
                HttpMethod::Get,
                &media.path,
            )?;
            let host = host_from_url(&info.base_url);
            (
                format!(
                    "connection:{}:{}:{}",
                    info.name,
                    media.path,
                    serde_json::to_string(&media.query).unwrap()
                ),
                Source::Connection {
                    name: info.name,
                    host,
                },
            )
        }
        PermissionDecl::Http {
            base_url, paths, ..
        } => {
            if !kaleidoscope_contract::validate::allowed_public_http_path(&paths, &media.path) {
                let display_path = media
                    .path
                    .split_once('?')
                    .map_or(media.path.as_str(), |(path, _)| path);
                return Err(errors::MEDIA_LOAD_HTTP_PATH_FORBIDDEN(display_path));
            }
            (
                format!(
                    "http:{}:{}:{}",
                    base_url,
                    media.path,
                    serde_json::to_string(&media.query).unwrap()
                ),
                Source::Http {
                    host: host_from_url(&base_url),
                },
            )
        }
        PermissionDecl::LocalAgent { .. } | PermissionDecl::Profiler { .. } => {
            return Err(errors::MEDIA_LOAD_SOURCE_UNSUPPORTED(&media.path));
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
        let (bytes, mime) = if let Source::File(path) = &source {
            let file = fs::File::open(path).map_err(|err| {
                let error = if err.kind() == std::io::ErrorKind::NotFound {
                    errors::MEDIA_LOAD_FILE_OPEN_NOT_FOUND(&media.path)
                } else {
                    errors::MEDIA_LOAD_FILE_OPEN_FAILED(&media.path)
                };
                error.and_details(vec![err.to_string()])
            })?;
            let mut bytes = Vec::new();
            file.take(data::MEDIA_MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|err| {
                    let error = if err.kind() == std::io::ErrorKind::NotFound {
                        errors::MEDIA_LOAD_FILE_READ_NOT_FOUND(&media.path)
                    } else {
                        errors::MEDIA_LOAD_FILE_READ_FAILED(&media.path)
                    };
                    error.and_details(vec![err.to_string()])
                })?;
            (bytes, mime_for_path(&media.path).to_string())
        } else {
            let reply = connections::request(
                inner,
                window_id,
                &media.permission,
                HttpMethod::Get,
                &media.path,
                media.query.clone(),
                None,
                ConnectionAccept::Bytes,
            )
            .map_err(|err| match err {
                RequestError::Core(err) => err,
                RequestError::Login(_) => {
                    let connection = match &source {
                        Source::Connection { name, .. } => name.as_str(),
                        Source::Http { .. } => "공개 HTTP",
                        Source::File(_) => "파일",
                    };
                    errors::MEDIA_LOAD_CONNECTION_LOGIN_REQUIRED(&target, connection)
                }
                RequestError::RateLimited { .. } => match &source {
                    Source::Connection { name, host } => {
                        errors::MEDIA_LOAD_CONNECTION_RATE_LIMITED(&target, name)
                            .and_details(vec![format!("HTTP 429; host={host}")])
                    }
                    Source::Http { host } => errors::MEDIA_LOAD_HTTP_RATE_LIMITED(&target)
                        .and_details(vec![format!("HTTP 429; host={host}")]),
                    Source::File(_) => unreachable!(),
                },
            })?;
            if !(200..300).contains(&reply.status) {
                let (error, host) = match &source {
                    Source::Connection { name, host } => (
                        errors::MEDIA_LOAD_CONNECTION_RESPONSE_FAILED(&target, name),
                        host,
                    ),
                    Source::Http { host } => {
                        (errors::MEDIA_LOAD_HTTP_RESPONSE_FAILED(&target), host)
                    }
                    Source::File(_) => unreachable!(),
                };
                return Err(error.and_details(vec![format!("HTTP {}; host={host}", reply.status)]));
            }
            let bytes = STANDARD
                .decode(reply.data_base64.unwrap_or_default())
                .map_err(|detail| {
                    let error = match &source {
                        Source::Connection { name, .. } => {
                            errors::MEDIA_LOAD_CONNECTION_DATA_INVALID(&target, name)
                        }
                        Source::Http { .. } => errors::MEDIA_LOAD_HTTP_DATA_INVALID(&target),
                        Source::File(_) => unreachable!(),
                    };
                    error.and_details(vec![detail.to_string()])
                })?;
            (bytes, reply.mime)
        };
        if bytes.len() as u64 > data::MEDIA_MAX_BYTES {
            return Err(errors::MEDIA_LOAD_DATA_TOO_LARGE(&target));
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
        shrink(&original, max, &target)?
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
fn host_from_url(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| "알 수 없는 서버".into())
}

fn shrink(entry: &Entry, max: u32, media: &str) -> Result<Entry, CoreError> {
    if !raster(&entry.mime) {
        return Ok(entry.clone());
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
