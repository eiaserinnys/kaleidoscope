use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use kaleidoscope_contract::{
    CoreError, CoreReply, ErrorCode, FileAccess, FileEntry, FileKind, FilesScope, PcRootKind,
    PermissionDecl, FILE_READ_MAX_BYTES,
};
use sha2::{Digest, Sha256};

use crate::error;
use crate::{CoreState, Inner};

mod pc;
pub(crate) use pc::scope;
use pc::{pc_access, pc_resolve, pc_roots};

pub(crate) fn permission(
    state: &CoreState,
    window_id: &str,
    permission_id: &str,
    write: bool,
) -> Result<FileAccess, CoreError> {
    let window = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let version = state
        .shared
        .app_versions
        .iter()
        .find(|version| version.app_id == window.app_id && version.version == window.app_version)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let permission = version
        .definition
        .permissions
        .iter()
        .find(|permission| permission.id() == permission_id)
        .ok_or_else(|| error::make(ErrorCode::PermissionDenied))?;
    let access = match permission {
        PermissionDecl::Files { access, .. } => *access,
        // 연결 권한으로는 파일을 다루지 않는다.
        PermissionDecl::Connection { .. }
        | PermissionDecl::Http { .. }
        | PermissionDecl::Profiler { .. }
        | PermissionDecl::LocalAgent { .. } => {
            return Err(error::make(ErrorCode::PermissionDenied));
        }
    };
    if write && access != FileAccess::Readwrite {
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    Ok(access)
}

pub(crate) fn list(
    inner: &Inner,
    state: &CoreState,
    window_id: &str,
    permission_id: &str,
    dir: &str,
) -> Result<CoreReply, CoreError> {
    let pc = scope(state, window_id, permission_id)? == FilesScope::Pc;
    let (root, directory, relative_dir) = if pc {
        pc_access(state, window_id, permission_id)?;
        if dir.is_empty() {
            let roots = pc_roots(inner);
            let mut entries = Vec::new();
            for kind in [PcRootKind::Known, PcRootKind::Volume] {
                for root in roots.iter().filter(|root| root.kind == kind) {
                    if let Ok(path) = fs::canonicalize(&root.path) {
                        if resolve_path(&inner.data_dir, &path, "", true, false).is_err() {
                            continue;
                        }
                        entries.push(FileEntry {
                            name: root.name.clone(),
                            path: root.id.clone(),
                            kind: FileKind::Dir,
                            size: 0,
                            modified: String::new(),
                            root_kind: Some(root.kind),
                        });
                    }
                }
            }
            return Ok(CoreReply::FilesList { entries });
        }
        let (root, directory) = pc_resolve(inner, dir)?;
        let relative = dir.split_once('/').map_or("", |(_, rest)| rest);
        (root, directory, relative)
    } else {
        let root = granted_root(state, window_id, permission_id, false)?;
        let directory = resolve_path(&inner.data_dir, &root, dir, true, false)?;
        (root, directory, dir)
    };
    let mut entries = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error::io_error(&error))? {
        let entry = entry.map_err(|error| error::io_error(&error))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| error::make(ErrorCode::Io))?;
        if name.starts_with('.') {
            continue;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.file_attributes() & 0x6 != 0 {
                continue;
            }
        }
        let path = if dir.is_empty() {
            name.clone()
        } else {
            format!("{dir}/{name}")
        };
        // 밖을 가리키는 링크나 정션(Windows 문서 폴더의 My Music 등), 읽을 수 없는 항목은
        // 목록 전체를 실패시키지 않고 건너뛴다.
        let relative_path = if relative_dir.is_empty() {
            name.clone()
        } else {
            format!("{relative_dir}/{name}")
        };
        let Ok(resolved) = resolve_path(&inner.data_dir, &root, &relative_path, false, true) else {
            continue;
        };
        let Ok(metadata) = fs::metadata(&resolved) else {
            continue;
        };
        let kind = if metadata.is_dir() {
            FileKind::Dir
        } else {
            FileKind::File
        };
        let size = if metadata.is_dir() { 0 } else { metadata.len() };
        let modified = metadata
            .modified()
            .map(|time| {
                chrono::DateTime::<chrono::Utc>::from(time)
                    .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
            })
            .unwrap_or_default();
        entries.push(FileEntry {
            name,
            path,
            kind,
            size,
            modified,
            root_kind: None,
        });
    }
    entries.sort_by(|left, right| {
        let kind_order = kind_order(left.kind).cmp(&kind_order(right.kind));
        kind_order
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(CoreReply::FilesList { entries })
}

pub(crate) fn read(
    inner: &Inner,
    state: &CoreState,
    window_id: &str,
    permission_id: &str,
    path: &str,
) -> Result<CoreReply, CoreError> {
    let root = granted_root(state, window_id, permission_id, false)?;
    let resolved = resolve_path(&inner.data_dir, &root, path, false, false)?;
    let file = fs::File::open(resolved).map_err(|error| error::io_error(&error))?;
    let mut bytes = Vec::new();
    file.take(FILE_READ_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error::io_error(&error))?;
    if bytes.len() as u64 > FILE_READ_MAX_BYTES {
        return Err(error::with_message(
            ErrorCode::Io,
            "파일이 너무 큽니다(5MB 초과).",
        ));
    }
    let text = String::from_utf8(bytes.clone())
        .map_err(|_| error::with_message(ErrorCode::Io, "UTF-8 텍스트 파일이 아닙니다."))?;
    Ok(CoreReply::FilesRead {
        path: path.to_string(),
        text,
        revision: revision(&bytes),
    })
}

pub(crate) fn write(
    inner: &Inner,
    state: &CoreState,
    window_id: &str,
    permission_id: &str,
    path: &str,
    text: &str,
    expected_revision: Option<&str>,
) -> Result<CoreReply, CoreError> {
    let root = granted_root(state, window_id, permission_id, true)?;
    let resolved = resolve_path(&inner.data_dir, &root, path, false, true)?;

    match expected_revision {
        Some(expected) => {
            let current = match fs::read(&resolved) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Err(error::make(ErrorCode::Conflict));
                }
                Err(error) => return Err(error::io_error(&error)),
            };
            if revision(&current) != expected {
                return Err(error::make(ErrorCode::Conflict));
            }
        }
        None => match fs::symlink_metadata(&resolved) {
            Ok(_) => return Err(error::make(ErrorCode::Conflict)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error::io_error(&error)),
        },
    }

    fs::write(&resolved, text.as_bytes()).map_err(|error| error::io_error(&error))?;
    Ok(CoreReply::FilesWrite {
        path: path.to_string(),
        revision: revision(text.as_bytes()),
    })
}

pub(crate) fn granted_root(
    state: &CoreState,
    window_id: &str,
    permission_id: &str,
    write: bool,
) -> Result<PathBuf, CoreError> {
    permission(state, window_id, permission_id, write)?;
    if scope(state, window_id, permission_id)? == FilesScope::Pc {
        return Err(error::make(ErrorCode::NotGranted));
    }
    let grant = state
        .device
        .grants
        .iter()
        .find(|grant| grant.window_id == window_id && grant.permission == permission_id)
        .ok_or_else(|| error::make(ErrorCode::NotGranted))?;
    let stored_root = PathBuf::from(&grant.root_path);
    let root = fs::canonicalize(&stored_root).map_err(|error| error::io_error(&error))?;
    if root != stored_root || !root.is_dir() {
        return Err(error::make(ErrorCode::PathOutsideRoot));
    }
    Ok(root)
}

pub(crate) fn resolve_path(
    data_dir: &Path,
    root: &Path,
    relative: &str,
    allow_root: bool,
    allow_missing: bool,
) -> Result<PathBuf, CoreError> {
    if !valid_relative_path(relative, allow_root) {
        return Err(error::make(ErrorCode::PathOutsideRoot));
    }
    let candidate = if relative.is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
    let (resolved, exists) = match fs::canonicalize(&candidate) {
        Ok(canonical) => {
            if canonical.starts_with(root) {
                Ok((canonical, true))
            } else {
                Err(error::make(ErrorCode::PathOutsideRoot))
            }
        }
        Err(io_error) if io_error.kind() == std::io::ErrorKind::NotFound => {
            ensure_missing_path_inside(root, &candidate)?;
            Ok((candidate, false))
        }
        Err(io_error) => Err(error::io_error(&io_error)),
    }?;
    let actual = if exists {
        resolved.clone()
    } else {
        let parent = resolved
            .parent()
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        fs::canonicalize(parent)
            .map_err(|error| error::io_error(&error))?
            .join(
                resolved
                    .file_name()
                    .ok_or_else(|| error::make(ErrorCode::NotFound))?,
            )
    };
    let protected = fs::canonicalize(data_dir).map_err(|error| error::io_error(&error))?;
    if actual.starts_with(protected) {
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    if !exists && !allow_missing {
        return Err(error::make(ErrorCode::NotFound));
    }
    Ok(resolved)
}

fn ensure_missing_path_inside(root: &Path, candidate: &Path) -> Result<(), CoreError> {
    match fs::canonicalize(candidate) {
        Ok(canonical) => {
            if canonical.starts_with(root) {
                Ok(())
            } else {
                Err(error::make(ErrorCode::PathOutsideRoot))
            }
        }
        Err(io_error) if io_error.kind() == std::io::ErrorKind::NotFound => {
            if let Ok(metadata) = fs::symlink_metadata(candidate) {
                if metadata.file_type().is_symlink() {
                    let target =
                        fs::read_link(candidate).map_err(|error| error::io_error(&error))?;
                    let target = if target.is_absolute() {
                        target
                    } else {
                        candidate
                            .parent()
                            .ok_or_else(|| error::make(ErrorCode::NotFound))?
                            .join(target)
                    };
                    return ensure_missing_path_inside(root, &target);
                }
            }
            let parent = candidate
                .parent()
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let canonical_parent =
                fs::canonicalize(parent).map_err(|error| error::io_error(&error))?;
            if canonical_parent.starts_with(root) {
                Ok(())
            } else {
                Err(error::make(ErrorCode::PathOutsideRoot))
            }
        }
        Err(io_error) => Err(error::io_error(&io_error)),
    }
}

use kaleidoscope_contract::validate::valid_relative_path;

fn revision(bytes: &[u8]) -> String {
    let hash = Sha256::digest(bytes);
    format!("{hash:x}")[..16].to_string()
}

fn kind_order(kind: FileKind) -> u8 {
    match kind {
        FileKind::Dir => 0,
        FileKind::File => 1,
    }
}

pub(crate) fn open(
    inner: &Inner,
    state: &mut CoreState,
    window_id: &str,
    permission_id: &str,
    path: &str,
    app_id: &str,
    rect: Option<kaleidoscope_contract::Rect>,
) -> Result<CoreReply, CoreError> {
    let pc = scope(state, window_id, permission_id)? == FilesScope::Pc;
    let resolved = if pc {
        pc_access(state, window_id, permission_id)?;
        pc_resolve(inner, path)?.1
    } else {
        let root = granted_root(state, window_id, permission_id, false)?;
        resolve_path(&inner.data_dir, &root, path, false, false)?
    };
    if !resolved.is_file() {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    let source = state
        .shared
        .windows
        .iter()
        .find(|w| w.id == window_id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let desktop_id = source.desktop_id.clone();
    let grant = if pc {
        let parent = resolved
            .parent()
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        kaleidoscope_contract::Grant {
            window_id: window_id.into(),
            permission: permission_id.into(),
            root_path: parent.to_string_lossy().into_owned(),
            root_name: parent
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| parent.display().to_string()),
            granted_at: crate::state_commands::timestamp(),
        }
    } else {
        state
            .device
            .grants
            .iter()
            .find(|g| g.window_id == window_id && g.permission == permission_id)
            .cloned()
            .ok_or_else(|| error::make(ErrorCode::NotGranted))?
    };
    let app = state
        .shared
        .apps
        .iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let definition =
        crate::app_commands::definition_for(&state.shared, app_id, app.current_version)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let opens = definition
        .opens
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
    let extension = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !opens.extensions.contains(&extension) {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    let reuse = state
        .shared
        .windows
        .iter()
        .filter(|w| w.desktop_id == desktop_id && w.app_id == app_id)
        .filter(|w| {
            state.device.grants.iter().any(|g| {
                g.window_id == w.id
                    && g.permission == opens.permission
                    && g.root_path == grant.root_path
            })
        })
        .max_by_key(|w| w.z)
        .map(|w| w.id.clone());
    let target_id = if let Some(id) = reuse {
        crate::state_commands::handle(
            state,
            kaleidoscope_contract::CoreRequest::WindowRaise {
                window_id: id.clone(),
            },
        )?;
        id
    } else {
        let reply = crate::state_commands::handle(
            state,
            kaleidoscope_contract::CoreRequest::WindowOpen {
                desktop_id,
                app_id: app_id.into(),
                rect,
            },
        )?;
        let CoreReply::WindowOpen { window } = reply else {
            unreachable!()
        };
        state.device.grants.push(kaleidoscope_contract::Grant {
            window_id: window.id.clone(),
            permission: opens.permission,
            root_path: grant.root_path,
            root_name: grant.root_name,
            granted_at: crate::state_commands::timestamp(),
        });
        window.id
    };
    let window = state
        .shared
        .windows
        .iter_mut()
        .find(|w| w.id == target_id)
        .unwrap();
    window.state.insert(
        opens.state,
        serde_json::Value::String(if pc {
            resolved.file_name().unwrap().to_string_lossy().into_owned()
        } else {
            path.into()
        }),
    );
    window.updated_at = crate::state_commands::timestamp();
    Ok(CoreReply::FilesOpen {
        window: window.clone(),
    })
}
