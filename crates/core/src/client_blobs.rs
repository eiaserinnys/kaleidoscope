//! 기기와 서버, 앱 범위의 바이너리 보관.
use crate::{app_commands, client_files, error, server_switch, Inner};
use kaleidoscope_contract::{
    client::{ClientFile, CLIENT_PICK_FILE_MAX_BYTES},
    CoreError, ErrorCode,
};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

fn location(inner: &Inner, window: &str, key: &str) -> Result<(PathBuf, PathBuf), CoreError> {
    let state = inner.state.lock().unwrap();
    let window = state
        .shared
        .windows
        .iter()
        .find(|w| w.id == window)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let definition =
        app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let prefixes = definition
        .client
        .as_ref()
        .and_then(|c| c.device_storage.as_ref())
        .map(|s| &s.prefixes)
        .ok_or_else(|| {
            error::with_message(
                ErrorCode::PermissionDenied,
                "이 앱에 기기 보관 권한이 없습니다.",
            )
        })?;
    if key.is_empty()
        || key.contains('\\')
        || !Path::new(key)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
        || key.split('/').any(|part| part == "." || part == "..")
        || !prefixes.iter().any(|prefix| key.starts_with(prefix))
    {
        return Err(error::with_message(
            ErrorCode::PermissionDenied,
            "보관 키가 선언된 접두어 밖이거나 올바르지 않습니다.",
        ));
    }
    let root = server_switch::active_archive(inner)
        .join("client-blobs")
        .join(&window.app_id);
    Ok((root.clone(), root.join(key)))
}

pub(crate) fn put(
    inner: &Inner,
    window: &str,
    key: &str,
    file_id: Option<&str>,
    bytes: Option<&[u8]>,
) -> Result<(), CoreError> {
    let (_, path) = location(inner, window, key)?;
    let mut input: Box<dyn Read + '_> = match (file_id, bytes) {
        (Some(id), None) => {
            let source = client_files::input_path(inner, window, id)?;
            let file = fs::File::open(source).map_err(|e| error::io_error(&e))?;
            Box::new(file)
        }
        (None, Some(bytes)) => Box::new(std::io::Cursor::new(bytes)),
        _ => {
            return Err(error::with_message(
                ErrorCode::InvalidRequest,
                "저장할 파일 또는 바이트 하나를 지정하세요.",
            ))
        }
    };
    let parent = path
        .parent()
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
    fs::create_dir_all(parent).map_err(|e| error::io_error(&e))?;
    let temp = parent.join(format!(".kaleidoscope-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| error::io_error(&e))?;
        let size = std::io::copy(
            &mut input.by_ref().take(CLIENT_PICK_FILE_MAX_BYTES + 1),
            &mut output,
        )
        .map_err(|e| error::io_error(&e))?;
        if size > CLIENT_PICK_FILE_MAX_BYTES {
            return Err(error::with_message(
                ErrorCode::InvalidRequest,
                "보관할 파일이 512MiB를 넘습니다.",
            ));
        }
        output.flush().map_err(|e| error::io_error(&e))?;
        drop(output);
        fs::rename(&temp, &path).map_err(|e| error::io_error(&e))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

pub(crate) fn open(
    inner: &Inner,
    window: &str,
    key: &str,
) -> Result<Option<ClientFile>, CoreError> {
    let (_, path) = location(inner, window, key)?;
    if !path.exists() {
        return Ok(None);
    }
    client_files::register(inner, window, path).map(Some)
}
pub(crate) fn remove(inner: &Inner, window: &str, key: &str) -> Result<(), CoreError> {
    let (_, path) = location(inner, window, key)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(error::io_error(&e)),
    }
}
pub(crate) fn list(inner: &Inner, window: &str, prefix: &str) -> Result<Vec<String>, CoreError> {
    let (root, _) = location(inner, window, prefix)?;
    fn walk(
        root: &Path,
        dir: &Path,
        prefix: &str,
        keys: &mut Vec<String>,
    ) -> Result<(), CoreError> {
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(error::io_error(&e)),
        };
        for entry in entries {
            let entry = entry.map_err(|e| error::io_error(&e))?;
            let kind = entry.file_type().map_err(|e| error::io_error(&e))?;
            if kind.is_dir() {
                walk(root, &entry.path(), prefix, keys)?;
            } else if kind.is_file() {
                let key = entry
                    .path()
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                if key.starts_with(prefix) {
                    keys.push(key);
                }
            }
        }
        Ok(())
    }
    let mut keys = Vec::new();
    walk(&root, &root, prefix, &mut keys)?;
    keys.sort();
    Ok(keys)
}
