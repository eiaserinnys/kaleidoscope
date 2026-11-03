//! 기기와 서버, 앱 범위의 바이너리 보관.
use crate::{app_commands, client_files, server_switch, Inner};
use kaleidoscope_contract::{
    client::{ClientFile, DeviceStorageScope, CLIENT_PICK_FILE_MAX_BYTES},
    errors, CoreError,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

fn window_storage_root(archive: &Path, app_id: &str, window_id: &str) -> PathBuf {
    let app_key = format!("{:x}", Sha256::digest(app_id.as_bytes()));
    let window_key = format!("{:x}", Sha256::digest(window_id.as_bytes()));
    archive
        .join("client-blobs")
        .join(".windows")
        .join(app_key)
        .join(window_key)
}

fn location(inner: &Inner, window: &str, key: &str) -> Result<(PathBuf, PathBuf), CoreError> {
    let state = inner.state.lock().unwrap();
    let window = state
        .shared
        .windows
        .iter()
        .find(|w| w.id == window)
        .ok_or_else(|| {
            errors::DATA_CLIENT_BLOB_WINDOW_NOT_FOUND()
                .and_details(vec![format!("window: {}", window)])
        })?;
    let definition =
        app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
            .ok_or_else(|| errors::DATA_CLIENT_BLOB_APP_NOT_FOUND(&window.app_id))?;
    let storage = definition
        .client
        .as_ref()
        .and_then(|c| c.device_storage.as_ref())
        .ok_or_else(|| errors::DATA_CLIENT_BLOB_STORAGE_NOT_DECLARED(&window.app_id))?;
    let prefixes = &storage.prefixes;
    if key.is_empty()
        || key.contains('\\')
        || !Path::new(key)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
        || key.split('/').any(|part| part == "." || part == "..")
    {
        return Err(errors::DATA_CLIENT_BLOB_KEY_INVALID(key));
    }
    if !prefixes.iter().any(|prefix| key.starts_with(prefix)) {
        return Err(errors::DATA_CLIENT_BLOB_PREFIX_DENIED(key, &window.app_id));
    }
    let archive = server_switch::active_archive(inner);
    let root = match storage.scope {
        DeviceStorageScope::App => archive.join("client-blobs").join(&window.app_id),
        DeviceStorageScope::Window => window_storage_root(&archive, &window.app_id, &window.id),
    };
    Ok((root.clone(), root.join(key)))
}

pub(crate) fn file_uri(inner: &Inner, window_id: &str, key: &str) -> Result<String, CoreError> {
    {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|window| window.id == window_id)
            .ok_or_else(|| {
                errors::DATA_CLIENT_BLOB_WINDOW_NOT_FOUND()
                    .and_details(vec![format!("window: {window_id}")])
            })?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| errors::DATA_CLIENT_BLOB_APP_NOT_FOUND(&window.app_id))?;
        let client = definition.client.as_ref();
        if !client
            .and_then(|client| client.process_permissions.as_ref())
            .is_some_and(|permissions| !permissions.is_empty())
        {
            return Err(errors::PROCESS_FILE_URI_CLIENT_PERMISSION_UNDECLARED(
                &window.app_id,
            ));
        }
        if !client
            .and_then(|client| client.device_storage.as_ref())
            .is_some_and(|storage| storage.scope == DeviceStorageScope::Window)
        {
            return Err(errors::PROCESS_FILE_URI_WINDOW_STORAGE_REQUIRED(
                &window.app_id,
            ));
        }
    }
    let (_, path) = location(inner, window_id, key)?;
    if !path.is_file() {
        return Err(errors::PROCESS_FILE_URI_BLOB_NOT_FOUND(key));
    }
    url::Url::from_file_path(&path)
        .map(|url| url.to_string())
        .map_err(|_| errors::PROCESS_FILE_URI_PATH_INVALID())
}

pub(crate) fn remove_window_storage(archive: &Path, app_id: &str, window_id: &str) {
    let path = window_storage_root(archive, app_id, window_id);
    if let Err(error) = fs::remove_dir_all(path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!("삭제된 창 저장소를 지우지 못했습니다: {error}");
        }
    }
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
            let file = fs::File::open(source).map_err(|e| {
                let mut error = if e.kind() == std::io::ErrorKind::NotFound {
                    errors::DATA_CLIENT_BLOB_INPUT_NOT_FOUND(key)
                } else {
                    errors::DATA_CLIENT_BLOB_INPUT_OPEN_FAILED(key)
                };
                error.details = vec![e.to_string()];
                error
            })?;
            Box::new(file)
        }
        (None, Some(bytes)) => Box::new(std::io::Cursor::new(bytes)),
        _ => return Err(errors::DATA_CLIENT_BLOB_INPUT_INVALID()),
    };
    let parent = path
        .parent()
        .ok_or_else(|| errors::DATA_CLIENT_BLOB_PARENT_INVALID(key))?;
    fs::create_dir_all(parent).map_err(|e| {
        let mut error = if e.kind() == std::io::ErrorKind::NotFound {
            errors::DATA_CLIENT_BLOB_DIR_NOT_FOUND(key)
        } else {
            errors::DATA_CLIENT_BLOB_DIR_CREATE_FAILED(key)
        };
        error.details = vec![e.to_string()];
        error
    })?;
    let temp = parent.join(format!(".kaleidoscope-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| {
                let mut error = if e.kind() == std::io::ErrorKind::NotFound {
                    errors::DATA_CLIENT_BLOB_TEMP_NOT_FOUND(key)
                } else {
                    errors::DATA_CLIENT_BLOB_TEMP_CREATE_FAILED(key)
                };
                error.details = vec![e.to_string()];
                error
            })?;
        let size = std::io::copy(
            &mut input.by_ref().take(CLIENT_PICK_FILE_MAX_BYTES + 1),
            &mut output,
        )
        .map_err(|e| {
            let mut error = if e.kind() == std::io::ErrorKind::NotFound {
                errors::DATA_CLIENT_BLOB_COPY_NOT_FOUND(key)
            } else {
                errors::DATA_CLIENT_BLOB_COPY_FAILED(key)
            };
            error.details = vec![e.to_string()];
            error
        })?;
        if size > CLIENT_PICK_FILE_MAX_BYTES {
            return Err(errors::DATA_CLIENT_BLOB_TOO_LARGE(
                key,
                kaleidoscope_contract::size::format_byte_limit(CLIENT_PICK_FILE_MAX_BYTES),
            ));
        }
        output.flush().map_err(|e| {
            let mut error = if e.kind() == std::io::ErrorKind::NotFound {
                errors::DATA_CLIENT_BLOB_FLUSH_NOT_FOUND(key)
            } else {
                errors::DATA_CLIENT_BLOB_FLUSH_FAILED(key)
            };
            error.details = vec![e.to_string()];
            error
        })?;
        drop(output);
        fs::rename(&temp, &path).map_err(|e| {
            let mut error = if e.kind() == std::io::ErrorKind::NotFound {
                errors::DATA_CLIENT_BLOB_RENAME_NOT_FOUND(key)
            } else {
                errors::DATA_CLIENT_BLOB_RENAME_FAILED(key)
            };
            error.details = vec![e.to_string()];
            error
        })?;
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
        Err(e) => {
            let mut error = errors::DATA_CLIENT_BLOB_REMOVE_FAILED(key);
            error.details = vec![e.to_string()];
            Err(error)
        }
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
            Err(e) => {
                let mut error = errors::DATA_CLIENT_BLOB_LIST_READ_FAILED(prefix);
                error.details = vec![e.to_string()];
                return Err(error);
            }
        };
        for entry in entries {
            let entry = entry.map_err(|e| {
                let mut error = if e.kind() == std::io::ErrorKind::NotFound {
                    errors::DATA_CLIENT_BLOB_LIST_ENTRY_NOT_FOUND(prefix)
                } else {
                    errors::DATA_CLIENT_BLOB_LIST_ENTRY_READ_FAILED(prefix)
                };
                error.details = vec![e.to_string()];
                error
            })?;
            let kind = entry.file_type().map_err(|e| {
                let mut error = if e.kind() == std::io::ErrorKind::NotFound {
                    errors::DATA_CLIENT_BLOB_LIST_KIND_NOT_FOUND(prefix)
                } else {
                    errors::DATA_CLIENT_BLOB_LIST_KIND_READ_FAILED(prefix)
                };
                error.details = vec![e.to_string()];
                error
            })?;
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
