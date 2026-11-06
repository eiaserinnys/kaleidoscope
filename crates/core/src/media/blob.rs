//! 기기 저장소에 든 파일을 기존 미디어 캐시와 축소 규칙으로 읽는다.
use super::{as_data, authorization, dimensions, mime_for_path, shrink, Entry};
use crate::Inner;
use kaleidoscope_contract::{
    data::{self, BlobMediaRef, MediaData},
    errors, CoreError,
};
use std::{
    fs,
    io::Read,
    sync::Arc,
    time::{Instant, UNIX_EPOCH},
};

pub(super) fn get(
    inner: &Arc<Inner>,
    window: &str,
    media: &BlobMediaRef,
    max_px: Option<u32>,
) -> Result<MediaData, CoreError> {
    let access = authorization::blob(inner, window, media)?;
    let modified = authorization::blob_modified(&access.metadata, &media.blob)?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let root = access.identity.root.to_string_lossy().into_owned();
    let path = access.path.to_string_lossy().into_owned();
    let key = serde_json::json!(["blob", root, path, access.metadata.len(), modified]).to_string();
    let variant = format!("{key}|{:?}", max_px);
    if let Some(entry) = inner.media_cache.get(&variant) {
        return Ok(as_data(&entry));
    }
    let original_key = format!("{key}|original");
    let original = if let Some(entry) = inner.media_cache.get(&original_key) {
        entry
    } else {
        let file = fs::File::open(&access.path).map_err(|err| {
            let error = if err.kind() == std::io::ErrorKind::NotFound {
                errors::MEDIA_BLOB_OPEN_NOT_FOUND(&media.blob)
            } else {
                errors::MEDIA_BLOB_OPEN_FAILED(&media.blob)
            };
            error.and_details(vec![err.to_string()])
        })?;
        let mut bytes = Vec::new();
        file.take(data::MEDIA_MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|err| {
                let error = if err.kind() == std::io::ErrorKind::NotFound {
                    errors::MEDIA_BLOB_READ_NOT_FOUND(&media.blob)
                } else {
                    errors::MEDIA_BLOB_READ_FAILED(&media.blob)
                };
                error.and_details(vec![err.to_string()])
            })?;
        if bytes.len() as u64 > data::MEDIA_MAX_BYTES {
            return Err(errors::MEDIA_LOAD_DATA_TOO_LARGE(
                kaleidoscope_contract::size::format_byte_limit(data::MEDIA_MAX_BYTES),
                &media.blob,
            ));
        }
        let mime = mime_for_path(&media.blob).to_string();
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
        shrink(&original, max, &media.blob)?
    } else {
        original.clone()
    };
    if !Arc::ptr_eq(&original.bytes, &result.bytes) {
        inner.media_cache.put(variant, result.clone());
    }
    Ok(as_data(&result))
}
