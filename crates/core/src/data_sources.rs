//! 파일과 폴더 원천을 고른 폴더 안에서 읽는다.
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use kaleidoscope_contract::{
    data::{self, FolderEntry, SourceFormat},
    registry::ConnectionAccept,
    CoreError, ErrorCode, FileKind,
};
use kaleidoscope_data::SourcePlan;
use serde_json::Value;

use crate::{
    connections::{self, RequestError},
    error, files, Inner,
};

pub(crate) fn fetch(
    inner: &Arc<Inner>,
    window: &str,
    plan: &SourcePlan,
    format: SourceFormat,
) -> Result<Value, RequestError> {
    match plan {
        SourcePlan::File {
            permission,
            path,
            format,
        } => {
            let root = root(inner, window, permission)?;
            let path = files::resolve_path(&inner.data_dir, &root, path, false, false)?;
            let file = fs::File::open(path).map_err(|err| error::io_error(&err))?;
            let mut bytes = Vec::new();
            file.take(data::SOURCE_MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|err| error::io_error(&err))?;
            if bytes.len() as u64 > data::SOURCE_MAX_BYTES {
                return Err(error::with_message(ErrorCode::Io, "원천이 너무 큽니다").into());
            }
            decode(bytes, *format).map_err(Into::into)
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
            if !(200..300).contains(&response.status) {
                return Err(connections::response_error(&response).into());
            }
            match format {
                SourceFormat::Json => match (response.json, response.text) {
                    (Some(json), _) => Ok(json),
                    (None, Some(_)) => {
                        Err(error::with_message(ErrorCode::Io, "JSON을 읽을 수 없습니다").into())
                    }
                    (None, None) => Ok(Value::Null),
                },
                SourceFormat::Text => Ok(Value::String(response.text.unwrap_or_default())),
            }
        }
        SourcePlan::Idle => Ok(Value::Null),
        SourcePlan::Invalid(message) => {
            Err(error::with_message(ErrorCode::InvalidRequest, message).into())
        }
    }
}

fn root(
    inner: &Arc<Inner>,
    window: &str,
    permission: &str,
) -> Result<std::path::PathBuf, CoreError> {
    let state = inner.state.lock().unwrap();
    files::granted_root(&state, window, permission, false).map_err(|err| {
        if err.code == ErrorCode::NotGranted {
            error::with_message(ErrorCode::NotGranted, "이 기기에서 폴더를 골라야 합니다")
        } else {
            err
        }
    })
}

fn decode(bytes: Vec<u8>, format: SourceFormat) -> Result<Value, CoreError> {
    match format {
        SourceFormat::Json => serde_json::from_slice(&bytes).map_err(|err| {
            error::with_message(ErrorCode::Io, &format!("JSON을 읽을 수 없습니다: {err}"))
        }),
        SourceFormat::Text => String::from_utf8(bytes)
            .map(Value::String)
            .map_err(|_| error::with_message(ErrorCode::Io, "UTF-8 텍스트가 아닙니다")),
    }
}

fn walk(
    data_dir: &Path,
    root: &Path,
    directory: &Path,
    relative: &str,
    recursive: bool,
    extensions: &[String],
    visited: &mut HashSet<std::path::PathBuf>,
    entries: &mut Vec<FolderEntry>,
) -> Result<(), CoreError> {
    if !visited.insert(directory.to_path_buf()) {
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(|err| error::io_error(&err))? {
        let entry = entry.map_err(|err| error::io_error(&err))?;
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
                data_dir, root, &resolved, &path, true, extensions, visited, entries,
            )?;
        }
    }
    Ok(())
}
