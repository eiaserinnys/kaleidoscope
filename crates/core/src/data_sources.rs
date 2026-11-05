//! 파일과 폴더 원천을 고른 폴더 안에서 읽는다.
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use kaleidoscope_contract::{
    data::{self, FolderEntry, SourceFormat},
    errors,
    registry::ConnectionAccept,
    CoreError, FileKind,
};
use kaleidoscope_data::SourcePlan;
use serde_json::Value;

use crate::{
    connections::{self, RequestError},
    files, Inner,
};

#[cfg(test)]
pub(crate) fn fetch(
    inner: &Arc<Inner>,
    window: &str,
    plan: &SourcePlan,
    format: SourceFormat,
) -> Result<Value, RequestError> {
    fetch_named(inner, window, "원천", plan, format)
}

pub(crate) fn fetch_named(
    inner: &Arc<Inner>,
    window: &str,
    source: &str,
    plan: &SourcePlan,
    format: SourceFormat,
) -> Result<Value, RequestError> {
    match plan {
        SourcePlan::StoreIndex { permission, server } | SourcePlan::StoreApp { permission, server, .. } => {
            let state = inner.state.lock().unwrap();
            let allowed = state.shared.windows.iter().find(|w| w.id == window)
                .and_then(|w| crate::app_commands::definition_for(&state.shared, &w.app_id, w.app_version))
                .is_some_and(|definition| definition.permissions.iter().any(|decl|
                    matches!(decl, kaleidoscope_contract::PermissionDecl::Store { id, .. } if id == permission)));
            drop(state);
            if !allowed { return Err(errors::STORECLIENT_SOURCE_PERMISSION_UNDECLARED(permission).into()); }
            let client = crate::store::client(inner, server)?;
            let result = match plan {
                SourcePlan::StoreIndex { .. } => {
                    let url = crate::store::StoreUrl::parse(server)?;
                    let gate = crate::store_latest::gate(inner, url.as_str());
                    let _guard = gate.lock().unwrap();
                    client.index(permission).map(|value| {
                        crate::store_latest::record(inner, &value);
                        serde_json::to_value(value).expect("스토어 색인 JSON")
                    })
                },
                SourcePlan::StoreApp { id, .. } => client.app(id, permission).map(|value| serde_json::to_value(value).expect("스토어 상세 JSON")),
                _ => unreachable!(),
            };
            result.map_err(|failure| if failure.status == Some(429) {
                RequestError::RateLimited { retry_after: failure.rate_limit.and_then(|hint| hint.retry_after_secs) }
            } else { RequestError::Core(failure.error) })
        }
        SourcePlan::File {
            permission,
            path,
            format,
        } => {
            let root = root(inner, window, permission)?;
            let source_path = path;
            let path = files::resolve_path(&inner.data_dir, &root, source_path, false, false)?;
            let file = fs::File::open(path).map_err(|err| {
                let mut error = if err.kind() == std::io::ErrorKind::NotFound {
                    errors::DATA_SOURCE_FILE_NOT_FOUND(source, source_path)
                } else {
                    errors::DATA_SOURCE_FILE_OPEN_FAILED(source, source_path)
                };
                error.details = vec![err.to_string()];
                error
            })?;
            let mut bytes = Vec::new();
            file.take(data::SOURCE_MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|err| {
                    let mut error = if err.kind() == std::io::ErrorKind::NotFound {
                        errors::DATA_SOURCE_FILE_READ_NOT_FOUND(source, source_path)
                    } else {
                        errors::DATA_SOURCE_FILE_READ_FAILED(source, source_path)
                    };
                    error.details = vec![err.to_string()];
                    error
                })?;
            if bytes.len() as u64 > data::SOURCE_MAX_BYTES {
                return Err(errors::DATA_SOURCE_FILE_TOO_LARGE(
                    source,
                    kaleidoscope_contract::size::format_byte_limit(data::SOURCE_MAX_BYTES),
                    source_path,
                )
                .into());
            }
            decode(source, source_path, bytes, *format).map_err(Into::into)
        }
        SourcePlan::Folder {
            permission,
            dir,
            recursive,
            extensions,
        } => {
            let root = root(inner, window, permission)?;
            let directory = files::resolve_path(&inner.data_dir, &root, dir, true, false)?;
            let mut entries = Vec::new();
            let mut visited = HashSet::new();
            walk(
                &inner.data_dir,
                &root,
                &directory,
                source,
                dir,
                *recursive,
                extensions,
                &mut visited,
                &mut entries,
            )?;
            entries.sort_by(|a, b| {
                let kind = |entry: &FolderEntry| if entry.kind == FileKind::Dir { 0 } else { 1 };
                kind(a)
                    .cmp(&kind(b))
                    .then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
                    .then_with(|| a.path.cmp(&b.path))
            });
            entries.truncate(data::FOLDER_SOURCE_MAX_ENTRIES);
            Ok(serde_json::to_value(entries).expect("폴더 항목 JSON"))
        }
        SourcePlan::Request {
            permission,
            path,
            query,
        } => {
            let accept = match format {
                SourceFormat::Json => ConnectionAccept::Json,
                SourceFormat::Text => ConnectionAccept::Text,
            };
            let response = connections::request(
                inner,
                window,
                permission,
                data::HttpMethod::Get,
                path,
                query.clone(),
                None,
                accept,
            )?;
            if let Some(hint) = response.rate_limit.as_ref() {
                return Err(RequestError::RateLimited {
                    retry_after: hint.retry_after_secs,
                });
            }
            if !(200..300).contains(&response.status) {
                let host = request_host(inner, window, permission);
                let target = request_target(inner, window, permission).unwrap_or_else(|| host.clone().unwrap_or_else(|| "서버".into()));
                let reason = connections::response_reason(&response);
                let mut error = match response.status {
                    404 => errors::DATA_SOURCE_RESPONSE_NOT_FOUND(&target),
                    401 | 403 => errors::DATA_SOURCE_RESPONSE_DENIED(&target),
                    500..=599 => errors::DATA_SOURCE_RESPONSE_SERVER_ERROR(&target, &reason),
                    _ => errors::DATA_SOURCE_RESPONSE_STATUS_FAILED(&target, &reason),
                };
                let mut details = vec![format!("HTTP 상태: {}", response.status), format!("원천: {source}"), format!("경로: {path}")];
                if let Some(host) = host {
                    details.push(format!("호스트: {host}"));
                }
                error.details = details;
                return Err(error.into());
            }
            match format {
                SourceFormat::Json => match (response.json, response.text) {
                    (Some(json), _) => Ok(json),
                    (None, Some(_)) => {
                        Err(errors::DATA_SOURCE_RESPONSE_JSON_INVALID(source).into())
                    }
                    (None, None) => Ok(Value::Null),
                },
                SourceFormat::Text => Ok(Value::String(response.text.unwrap_or_default())),
            }
        }
        SourcePlan::Idle => Ok(Value::Null),
        SourcePlan::Invalid(reason) => Err(errors::DATA_SOURCE_PLAN_INVALID(source, reason).into()),
        SourcePlan::StoreInvalid(error) => Err(error.clone().into()),
    }
}

pub(crate) fn request_target(inner: &Inner, window_id: &str, permission: &str) -> Option<String> {
    let state = inner.state.lock().unwrap();
    let window = state.shared.windows.iter().find(|window| window.id == window_id)?;
    let definition = crate::app_commands::definition_for(&state.shared, &window.app_id, window.app_version)?;
    match definition.permissions.iter().find(|declaration| declaration.id() == permission)? {
        kaleidoscope_contract::PermissionDecl::Connection { connection, .. } => Some(format!("연결 {connection}")),
        kaleidoscope_contract::PermissionDecl::Http { label, .. }
        | kaleidoscope_contract::PermissionDecl::Profiler { label, .. } if !label.trim().is_empty() => Some(label.clone()),
        _ => None,
    }
}

pub(crate) fn request_host(inner: &Inner, window_id: &str, permission: &str) -> Option<String> {
    let (base_url, connection_name) = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|window| window.id == window_id)?;
        let definition =
            crate::app_commands::definition_for(&state.shared, &window.app_id, window.app_version)?;
        match definition
            .permissions
            .iter()
            .find(|declaration| declaration.id() == permission)?
        {
            kaleidoscope_contract::PermissionDecl::Http { base_url, .. } => {
                (Some(base_url.clone()), None)
            }
            kaleidoscope_contract::PermissionDecl::Connection { connection, .. } => {
                (None, Some(connection.clone()))
            }
            _ => return None,
        }
    };
    let base_url = base_url.or_else(|| {
        let name = connection_name?;
        inner
            .connections
            .lock()
            .unwrap()
            .iter()
            .find(|connection| connection.name == name)
            .map(|connection| connection.base_url.clone())
    })?;
    reqwest::Url::parse(&base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
}

fn root(
    inner: &Arc<Inner>,
    window: &str,
    permission: &str,
) -> Result<std::path::PathBuf, CoreError> {
    let state = inner.state.lock().unwrap();
    files::granted_root(&state, window, permission, false)
}

fn decode(
    source: &str,
    path: &str,
    bytes: Vec<u8>,
    format: SourceFormat,
) -> Result<Value, CoreError> {
    match format {
        SourceFormat::Json => serde_json::from_slice(&bytes).map_err(|err| {
            let mut error = errors::DATA_SOURCE_FILE_JSON_INVALID(source, path);
            error.details = vec![err.to_string()];
            error
        }),
        SourceFormat::Text => String::from_utf8(bytes).map(Value::String).map_err(|err| {
            let mut error = errors::DATA_SOURCE_FILE_TEXT_INVALID(source, path);
            error.details = vec![err.to_string()];
            error
        }),
    }
}

fn walk(
    data_dir: &Path,
    root: &Path,
    directory: &Path,
    source: &str,
    relative: &str,
    recursive: bool,
    extensions: &[String],
    visited: &mut HashSet<std::path::PathBuf>,
    entries: &mut Vec<FolderEntry>,
) -> Result<(), CoreError> {
    if !visited.insert(directory.to_path_buf()) {
        return Ok(());
    }
    let display_path = directory.display();
    for entry in fs::read_dir(directory).map_err(|err| {
        let mut error = if err.kind() == std::io::ErrorKind::NotFound {
            errors::DATA_SOURCE_FOLDER_NOT_FOUND(source, &display_path)
        } else {
            errors::DATA_SOURCE_FOLDER_READ_FAILED(source, &display_path)
        };
        error.details = vec![err.to_string()];
        error
    })? {
        let entry = entry.map_err(|err| {
            let mut error = if err.kind() == std::io::ErrorKind::NotFound {
                errors::DATA_SOURCE_FOLDER_ENTRY_NOT_FOUND(source, &display_path)
            } else {
                errors::DATA_SOURCE_FOLDER_ENTRY_READ_FAILED(source, &display_path)
            };
            error.details = vec![err.to_string()];
            error
        })?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        let Ok(resolved) = files::resolve_path(data_dir, root, &path, false, false) else {
            continue;
        };
        let Ok(metadata) = fs::metadata(&resolved) else {
            continue;
        };
        let is_dir = metadata.is_dir();
        let ext = Path::new(&name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if (is_dir && (!recursive || extensions.is_empty()))
            || (!is_dir && (extensions.is_empty() || extensions.contains(&ext)))
        {
            let modified = metadata
                .modified()
                .map(DateTime::<Utc>::from)
                .map(|time| time.to_rfc3339())
                .unwrap_or_default();
            entries.push(FolderEntry {
                name,
                path: path.clone(),
                kind: if is_dir {
                    FileKind::Dir
                } else {
                    FileKind::File
                },
                ext,
                size: if is_dir { 0 } else { metadata.len() },
                modified,
            });
        }
        if is_dir && recursive {
            walk(
                data_dir, root, &resolved, source, &path, true, extensions, visited, entries,
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod error_id_tests {
    use super::decode;
    use kaleidoscope_contract::{data::SourceFormat, ErrorCode};

    #[test]
    fn malformed_json_file_has_source_code_and_context() {
        let error = decode("items", "items.json", b"{".to_vec(), SourceFormat::Json)
            .expect_err("잘못된 JSON은 읽지 못해야 한다");

        assert_eq!(error.id.as_deref(), Some("DATA_SOURCE_FILE_JSON_INVALID"));
        assert_eq!(error.code, ErrorCode::Io);
        assert!(error.message.contains("items"));
        assert!(error.message.contains("items.json"));
        assert_eq!(error.details.len(), 1);
    }
}
