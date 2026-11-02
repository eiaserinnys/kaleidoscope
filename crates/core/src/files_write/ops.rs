use std::fs::{self, OpenOptions};
use std::io;
use std::path::Path;

use kaleidoscope_contract::{
    file_name::check_file_name, CoreError, CoreReply, ErrorCode, FileChange, FileOpResult,
};

use crate::{files, Inner};

mod copy;
mod helpers;

use copy::{copy_entry, copy_name, remove_entry};
use helpers::{
    destination_dir, is_file_busy_code, join_relative, map_create_file_error,
    map_create_folder_error, named_error, path_exists, protect_data_ancestor, reject_links,
    resolve_mutation_path, result_to_op, selected_roots,
};
pub(super) use helpers::{file_system_error, readable_path, successful_changes};

pub(super) fn write(
    inner: &Inner,
    root: &Path,
    path: &str,
    text: &str,
    expected_revision: Option<&str>,
) -> Result<CoreReply, CoreError> {
    if let Some(name) = path.rsplit('/').next() {
        if expected_revision.is_none() {
            check_file_name(name).map_err(|message| named_error(message))?;
        }
    }
    reject_links(root, path)?;
    let resolved = files::resolve_path(&inner.data_dir, root, path, false, true)?;
    match expected_revision {
        Some(expected) => {
            let current = match fs::read(&resolved) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    return Err(kaleidoscope_contract::errors::FILE_SAVE_FILE_DELETED(path)
                        .and_details(vec![error.to_string()]));
                }
                Err(error) => {
                    return Err(file_system_error(
                        &error,
                        || kaleidoscope_contract::errors::FILE_SAVE_FILE_DELETED(path),
                        || kaleidoscope_contract::errors::FILE_SAVE_READ_BUSY(path),
                        || kaleidoscope_contract::errors::FILE_SAVE_READ_IO(path),
                    ));
                }
            };
            if files::revision(&current) != expected {
                return Err(kaleidoscope_contract::errors::FILE_SAVE_REVISION_CHANGED(
                    path,
                ));
            }
            fs::write(&resolved, text.as_bytes()).map_err(|error| {
                file_system_error(
                    &error,
                    || kaleidoscope_contract::errors::FILE_SAVE_WRITE_NOT_FOUND(path),
                    || kaleidoscope_contract::errors::FILE_SAVE_WRITE_BUSY(path),
                    || kaleidoscope_contract::errors::FILE_SAVE_WRITE_IO(path),
                )
            })?;
        }
        None => {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&resolved)
                .map_err(|error| map_create_file_error(&error, path))?;
            use std::io::Write;
            file.write_all(text.as_bytes()).map_err(|error| {
                file_system_error(
                    &error,
                    || {
                        kaleidoscope_contract::errors::FILE_CREATE_FILE_CONTENT_WRITE_NOT_FOUND(
                            path,
                        )
                    },
                    || kaleidoscope_contract::errors::FILE_CREATE_FILE_CONTENT_WRITE_BUSY(path),
                    || kaleidoscope_contract::errors::FILE_CREATE_FILE_CONTENT_WRITE_IO(path),
                )
            })?;
        }
    }
    Ok(CoreReply::FilesWrite {
        path: path.to_string(),
        revision: files::revision(text.as_bytes()),
    })
}

pub(super) fn mkdir(
    inner: &Inner,
    root: &Path,
    parent: &str,
    name: &str,
) -> Result<String, CoreError> {
    check_file_name(name).map_err(|message| named_error(message))?;
    let parent_path = files::resolve_path(&inner.data_dir, root, parent, true, false)?;
    if !fs::metadata(&parent_path)
        .map_err(|error| {
            file_system_error(
                &error,
                || {
                    kaleidoscope_contract::errors::FILE_CREATE_FOLDER_PARENT_METADATA_NOT_FOUND(
                        parent,
                    )
                },
                || kaleidoscope_contract::errors::FILE_CREATE_FOLDER_PARENT_METADATA_BUSY(parent),
                || kaleidoscope_contract::errors::FILE_CREATE_FOLDER_PARENT_METADATA_IO(parent),
            )
        })?
        .is_dir()
    {
        return Err(kaleidoscope_contract::errors::FILE_CREATE_PARENT_NOT_FOLDER(parent));
    }
    reject_links(root, parent)?;
    let path = join_relative(parent, name);
    let target = files::resolve_path(&inner.data_dir, root, &path, false, true)?;
    if path_exists(&target)? {
        return Err(kaleidoscope_contract::errors::FILE_CREATE_FOLDER_NAME_TAKEN(name));
    }
    fs::create_dir(&target).map_err(|error| map_create_folder_error(&error, name))?;
    Ok(path)
}

pub(super) fn rename(
    inner: &Inner,
    root: &Path,
    path: &str,
    name: &str,
) -> Result<FileChange, CoreError> {
    if path.is_empty() {
        return Err(kaleidoscope_contract::errors::FILE_RENAME_ROOT_DENIED());
    }
    check_file_name(name).map_err(|message| named_error(message))?;
    let source = resolve_mutation_path(inner, root, path)?;
    protect_data_ancestor(inner, &source)?;
    let parent = path.rsplit_once('/').map_or("", |(parent, _)| parent);
    let to = join_relative(parent, name);
    let target = files::resolve_path(&inner.data_dir, root, &to, false, true)?;
    reject_links(root, &to)?;
    if path_exists(&target)? && fs::canonicalize(&target).ok() != Some(source.clone()) {
        return Err(kaleidoscope_contract::errors::FILE_RENAME_NAME_TAKEN(name));
    }
    let destination = target
        .parent()
        .ok_or_else(|| kaleidoscope_contract::errors::FILE_PATH_OUTSIDE_ROOT(&to))?
        .join(name);
    fs::rename(&source, &destination).map_err(|error| {
        file_system_error(
            &error,
            || kaleidoscope_contract::errors::FILE_RENAME_APPLY_NOT_FOUND(path),
            || kaleidoscope_contract::errors::FILE_RENAME_APPLY_BUSY(path),
            || kaleidoscope_contract::errors::FILE_RENAME_APPLY_IO(path),
        )
    })?;
    Ok(FileChange {
        from: Some(path.into()),
        to: Some(to),
    })
}

pub(super) fn move_paths(
    inner: &Inner,
    root: &Path,
    paths: &[String],
    destination: &str,
) -> Vec<FileOpResult> {
    let paths = selected_roots(paths);
    let destination_path = match destination_dir(inner, root, destination) {
        Ok(path) => path,
        Err(error) => {
            return paths
                .iter()
                .map(|path| FileOpResult::Error {
                    path: (*path).to_string(),
                    error: error.clone(),
                })
                .collect()
        }
    };
    paths
        .iter()
        .map(|path| {
            let result = move_one(inner, root, path, destination, &destination_path);
            result_to_op(path, result)
        })
        .collect()
}

fn move_one(
    inner: &Inner,
    root: &Path,
    path: &str,
    destination: &str,
    destination_path: &Path,
) -> Result<FileChange, CoreError> {
    if path.is_empty() {
        return Err(kaleidoscope_contract::errors::FILE_MOVE_ROOT_DENIED());
    }
    let source = resolve_mutation_path(inner, root, path)?;
    protect_data_ancestor(inner, &source)?;
    if fs::metadata(&source)
        .map_err(|error| {
            file_system_error(
                &error,
                || kaleidoscope_contract::errors::FILE_MOVE_SOURCE_METADATA_NOT_FOUND(path),
                || kaleidoscope_contract::errors::FILE_MOVE_SOURCE_METADATA_BUSY(path),
                || kaleidoscope_contract::errors::FILE_MOVE_SOURCE_METADATA_IO(path),
            )
        })?
        .is_dir()
        && destination_path.starts_with(&source)
    {
        return Err(kaleidoscope_contract::errors::FILE_MOVE_INTO_SELF(path));
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| named_error("파일 이름을 읽을 수 없습니다"))?;
    check_file_name(name).map_err(|message| named_error(message))?;
    let to = join_relative(destination, name);
    let target = files::resolve_path(&inner.data_dir, root, &to, false, true)?;
    reject_links(root, &to)?;
    if path_exists(&target)? && fs::canonicalize(&target).ok() != Some(source.clone()) {
        return Err(kaleidoscope_contract::errors::FILE_MOVE_NAME_TAKEN(&to));
    }
    fs::rename(&source, &target).map_err(|error| {
        file_system_error(
            &error,
            || kaleidoscope_contract::errors::FILE_MOVE_APPLY_NOT_FOUND(path),
            || kaleidoscope_contract::errors::FILE_MOVE_APPLY_BUSY(path),
            || kaleidoscope_contract::errors::FILE_MOVE_APPLY_IO(path),
        )
    })?;
    Ok(FileChange {
        from: Some(path.into()),
        to: Some(to),
    })
}

pub(super) fn copy_paths(
    inner: &Inner,
    root: &Path,
    paths: &[String],
    destination: &str,
) -> Vec<FileOpResult> {
    let paths = selected_roots(paths);
    let destination_path = match destination_dir(inner, root, destination) {
        Ok(path) => path,
        Err(error) => {
            return paths
                .iter()
                .map(|path| FileOpResult::Error {
                    path: (*path).to_string(),
                    error: error.clone(),
                })
                .collect()
        }
    };
    paths
        .iter()
        .map(|path| {
            let result = copy_one(inner, root, path, destination, &destination_path);
            result_to_op(path, result)
        })
        .collect()
}

fn copy_one(
    inner: &Inner,
    root: &Path,
    path: &str,
    destination: &str,
    destination_path: &Path,
) -> Result<FileChange, CoreError> {
    if path.is_empty() {
        return Err(kaleidoscope_contract::errors::FILE_COPY_ROOT_DENIED());
    }
    let source = resolve_mutation_path(inner, root, path)?;
    protect_data_ancestor(inner, &source)?;
    let source_is_dir = fs::metadata(&source)
        .map_err(|error| {
            file_system_error(
                &error,
                || kaleidoscope_contract::errors::FILE_COPY_SOURCE_METADATA_NOT_FOUND(path),
                || kaleidoscope_contract::errors::FILE_COPY_SOURCE_METADATA_BUSY(path),
                || kaleidoscope_contract::errors::FILE_COPY_SOURCE_METADATA_IO(path),
            )
        })?
        .is_dir();
    if source_is_dir && destination_path.starts_with(&source) {
        return Err(kaleidoscope_contract::errors::FILE_COPY_INTO_SELF(path));
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| named_error("파일 이름을 읽을 수 없습니다"))?;
    let target_name = if path_exists(&destination_path.join(name))? {
        copy_name(&source, name, destination_path)?
    } else {
        name.to_owned()
    };
    let to = join_relative(destination, &target_name);
    let target = files::resolve_path(&inner.data_dir, root, &to, false, true)?;
    copy_entry(&source, &target)?;
    Ok(FileChange {
        from: Some(path.into()),
        to: Some(to),
    })
}

pub(super) fn remove_paths(
    inner: &Inner,
    root: &Path,
    paths: &[String],
    permanent: bool,
) -> Vec<FileOpResult> {
    let paths = selected_roots(paths);
    paths
        .iter()
        .map(|path| {
            let result = remove_one(inner, root, path, permanent);
            result_to_op(path, result)
        })
        .collect()
}

fn remove_one(
    inner: &Inner,
    root: &Path,
    path: &str,
    permanent: bool,
) -> Result<FileChange, CoreError> {
    if path.is_empty() {
        return Err(kaleidoscope_contract::errors::FILE_REMOVE_ROOT_DENIED());
    }
    let source = resolve_mutation_path(inner, root, path)?;
    protect_data_ancestor(inner, &source)?;
    if permanent {
        remove_entry(&source).map_err(|error| {
            file_system_error(
                &error,
                || kaleidoscope_contract::errors::FILE_REMOVE_PERMANENT_NOT_FOUND(path),
                || kaleidoscope_contract::errors::FILE_REMOVE_PERMANENT_BUSY(path),
                || kaleidoscope_contract::errors::FILE_REMOVE_PERMANENT_IO(path),
            )
        })?;
    } else if let Err(error) = trash::delete(&source) {
        let reason = error.to_string();
        let code = match error {
            trash::Error::Os { code, .. } if is_file_busy_code(code) => ErrorCode::FileBusy,
            _ => ErrorCode::TrashUnavailable,
        };
        return Err(if code == ErrorCode::FileBusy {
            kaleidoscope_contract::errors::FILE_REMOVE_TRASH_BUSY(path).and_details(vec![reason])
        } else {
            kaleidoscope_contract::errors::FILE_REMOVE_TRASH_UNAVAILABLE(path)
                .and_details(vec![reason])
        });
    }
    Ok(FileChange {
        from: Some(path.into()),
        to: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_system_error_uses_callers_not_found_and_io_codes() {
        let missing = io::Error::from(io::ErrorKind::NotFound);
        let mapped = file_system_error(
            &missing,
            || kaleidoscope_contract::errors::FILE_SAVE_WRITE_NOT_FOUND("note.md"),
            || kaleidoscope_contract::errors::FILE_SAVE_WRITE_BUSY("note.md"),
            || kaleidoscope_contract::errors::FILE_SAVE_WRITE_IO("note.md"),
        );
        assert_eq!(mapped.id.as_deref(), Some("FILE_SAVE_WRITE_NOT_FOUND"));
        assert_eq!(mapped.code, ErrorCode::NotFound);
        assert_eq!(mapped.details, vec![missing.to_string()]);

        let denied = io::Error::new(io::ErrorKind::PermissionDenied, "permission denied");
        let mapped = file_system_error(
            &denied,
            || kaleidoscope_contract::errors::FILE_SAVE_WRITE_NOT_FOUND("note.md"),
            || kaleidoscope_contract::errors::FILE_SAVE_WRITE_BUSY("note.md"),
            || kaleidoscope_contract::errors::FILE_SAVE_WRITE_IO("note.md"),
        );
        assert_eq!(mapped.id.as_deref(), Some("FILE_SAVE_WRITE_IO"));
        assert_eq!(mapped.code, ErrorCode::Io);
        assert_eq!(mapped.details, vec![denied.to_string()]);
    }

    #[test]
    fn selected_roots_omits_descendants_without_changing_order() {
        let paths = vec![
            "folder/child.txt".to_string(),
            "other.txt".to_string(),
            "folder".to_string(),
        ];
        assert_eq!(selected_roots(&paths), vec!["other.txt", "folder"]);
    }
}
