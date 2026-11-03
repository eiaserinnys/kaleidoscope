use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use kaleidoscope_contract::{
    CoreError, CoreReply, FileAccess, FileEntry, FileKind, FilesScope, PcRootKind, PermissionDecl,
    FILE_READ_MAX_BYTES,
};
use sha2::{Digest, Sha256};

use crate::{CoreState, Inner};

mod path;
mod pc;
pub(crate) use path::resolve_path;
use pc::pc_roots;
pub(crate) use pc::scope;

pub(crate) fn pc_access(
    state: &CoreState,
    window_id: &str,
    permission_id: &str,
) -> Result<(), CoreError> {
    pc::pc_access(state, window_id, permission_id)
}

pub(crate) fn pc_resolve(inner: &Inner, path: &str) -> Result<(PathBuf, PathBuf), CoreError> {
    pc::pc_resolve(inner, path)
}

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
        .ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_ACCESS_WINDOW_NOT_FOUND()
                .and_details(vec![format!("window_id: {window_id}")])
        })?;
    let version = state
        .shared
        .app_versions
        .iter()
        .find(|version| version.app_id == window.app_id && version.version == window.app_version)
        .ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_ACCESS_APP_VERSION_NOT_FOUND().and_details(vec![
                format!("window_id: {}", window.id),
                format!("app_id: {}", window.app_id),
                format!("app_version: {}", window.app_version),
            ])
        })?;
    let permission = version
        .definition
        .permissions
        .iter()
        .find(|permission| permission.id() == permission_id)
        .ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_ACCESS_PERMISSION_UNDECLARED(permission_id)
        })?;
    let access = match permission {
        PermissionDecl::Files { access, .. } => *access,
        // 연결 권한으로는 파일을 다루지 않는다.
        PermissionDecl::Connection { .. }
        | PermissionDecl::Http { .. }
        | PermissionDecl::Profiler { .. }
        | PermissionDecl::LocalAgent { .. } => {
            return Err(
                kaleidoscope_contract::errors::FILE_ACCESS_PERMISSION_NOT_FILES(permission_id),
            );
        }
    };
    if write && access != FileAccess::Readwrite {
        return Err(kaleidoscope_contract::errors::FILE_WRITE_READ_ONLY_PERMISSION(permission_id));
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
    let display_dir = directory.display();
    let mut entries = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            kaleidoscope_contract::errors::FILE_LIST_DIRECTORY_NOT_FOUND(&display_dir)
                .and_details(vec![error.to_string()])
        } else {
            kaleidoscope_contract::errors::FILE_LIST_DIRECTORY_IO(&display_dir)
                .and_details(vec![error.to_string()])
        }
    })? {
        let entry = entry.map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                kaleidoscope_contract::errors::FILE_LIST_ENTRY_NOT_FOUND(&display_dir)
                    .and_details(vec![error.to_string()])
            } else {
                kaleidoscope_contract::errors::FILE_LIST_ENTRY_IO(&display_dir)
                    .and_details(vec![error.to_string()])
            }
        })?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| kaleidoscope_contract::errors::FILE_LIST_NAME_NOT_TEXT(&display_dir))?;
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
    let file = fs::File::open(&resolved).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            kaleidoscope_contract::errors::FILE_READ_NOT_FOUND(path)
                .and_details(vec![error.to_string()])
        } else {
            kaleidoscope_contract::errors::FILE_READ_IO(path).and_details(vec![error.to_string()])
        }
    })?;
    let mut bytes = Vec::new();
    file.take(FILE_READ_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                kaleidoscope_contract::errors::FILE_READ_NOT_FOUND(path)
                    .and_details(vec![error.to_string()])
            } else {
                kaleidoscope_contract::errors::FILE_READ_IO(path)
                    .and_details(vec![error.to_string()])
            }
        })?;
    if bytes.len() as u64 > FILE_READ_MAX_BYTES {
        return Err(kaleidoscope_contract::errors::FILE_READ_TOO_LARGE(
            path,
            kaleidoscope_contract::size::format_byte_limit(FILE_READ_MAX_BYTES),
        ));
    }
    let text = String::from_utf8(bytes.clone())
        .map_err(|_| kaleidoscope_contract::errors::FILE_READ_NOT_TEXT(path))?;
    Ok(CoreReply::FilesRead {
        path: path.to_string(),
        text,
        revision: revision(&bytes),
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
        return Err(kaleidoscope_contract::errors::FILE_ACCESS_FOLDER_NOT_CHOSEN(permission_id));
    }
    let grant = state
        .device
        .grants
        .iter()
        .find(|grant| grant.window_id == window_id && grant.permission == permission_id)
        .ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_ACCESS_FOLDER_NOT_CHOSEN(permission_id)
        })?;
    let stored_root = PathBuf::from(&grant.root_path);
    let root = fs::canonicalize(&stored_root).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            kaleidoscope_contract::errors::FILE_ACCESS_ROOT_NOT_FOUND(stored_root.display())
                .and_details(vec![error.to_string()])
        } else {
            kaleidoscope_contract::errors::FILE_PATH_IO(&stored_root.display().to_string())
                .and_details(vec![error.to_string()])
        }
    })?;
    if root != stored_root || !root.is_dir() {
        return Err(kaleidoscope_contract::errors::FILE_ACCESS_ROOT_CHANGED(
            stored_root.display(),
        ));
    }
    Ok(root)
}

pub(crate) fn revision(bytes: &[u8]) -> String {
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
        return Err(kaleidoscope_contract::errors::FILE_OPEN_NOT_FILE(path));
    }
    let source = state
        .shared
        .windows
        .iter()
        .find(|w| w.id == window_id)
        .ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_ACCESS_WINDOW_NOT_FOUND()
                .and_details(vec![format!("window_id: {window_id}")])
        })?;
    let desktop_id = source.desktop_id.clone();
    let grant = if pc {
        let parent = resolved.parent().ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(&resolved.display().to_string())
        })?;
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
            .ok_or_else(|| {
                kaleidoscope_contract::errors::FILE_ACCESS_FOLDER_NOT_CHOSEN(permission_id)
            })?
    };
    let app = state
        .shared
        .apps
        .iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_OPEN_APP_NOT_FOUND(app_id)
                .and_details(vec![format!("app_id: {app_id}")])
        })?;
    let definition =
        crate::app_commands::definition_for(&state.shared, app_id, app.current_version)
            .ok_or_else(|| {
                kaleidoscope_contract::errors::FILE_OPEN_APP_VERSION_NOT_FOUND().and_details(vec![
                    format!("app_id: {app_id}"),
                    format!("app_version: {}", app.current_version),
                ])
            })?;
    let opens = definition.opens.ok_or_else(|| {
        kaleidoscope_contract::errors::FILE_OPEN_APP_CANNOT_OPEN(app_id)
            .and_details(vec![format!("file_path: {path}")])
    })?;
    let extension = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !opens.extensions.contains(&extension) {
        return Err(
            kaleidoscope_contract::errors::FILE_OPEN_APP_CANNOT_OPEN(app_id).and_details(vec![
                format!("file_path: {path}"),
                format!("extension: {extension}"),
            ]),
        );
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
    for (key, value) in opens.set_state {
        window.state.insert(key, value);
    }
    window.updated_at = crate::state_commands::timestamp();
    Ok(CoreReply::FilesOpen {
        window: window.clone(),
    })
}
