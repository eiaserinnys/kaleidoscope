use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use kaleidoscope_contract::{CoreError, FileChange, FileOpResult, FilesScope};

use crate::{files, CoreState, Inner};

pub(super) fn destination_dir(
    inner: &Inner,
    root: &Path,
    destination: &str,
) -> Result<PathBuf, CoreError> {
    let path = files::resolve_path(&inner.data_dir, root, destination, true, false)?;
    reject_links(root, destination)?;
    if !fs::metadata(&path)
        .map_err(|error| {
            file_system_error(
                &error,
                || {
                    kaleidoscope_contract::errors::FILE_DESTINATION_FOLDER_METADATA_NOT_FOUND(
                        destination,
                    )
                },
                || {
                    kaleidoscope_contract::errors::FILE_DESTINATION_FOLDER_METADATA_BUSY(
                        destination,
                    )
                },
                || kaleidoscope_contract::errors::FILE_DESTINATION_FOLDER_METADATA_IO(destination),
            )
        })?
        .is_dir()
    {
        return Err(kaleidoscope_contract::errors::FILE_DESTINATION_NOT_FOLDER(
            destination,
        ));
    }
    Ok(path)
}

pub(in crate::files_write) fn readable_path(
    inner: &Inner,
    state: &CoreState,
    window: &str,
    permission: &str,
    path: &str,
) -> Result<PathBuf, CoreError> {
    files::permission(state, window, permission, false)?;
    if files::scope(state, window, permission)? == FilesScope::Pc {
        files::pc_access(state, window, permission)?;
        return Ok(files::pc_resolve(inner, path)?.1);
    }
    let root = files::granted_root(state, window, permission, false)?;
    files::resolve_path(&inner.data_dir, &root, path, true, false)
}

pub(super) fn resolve_mutation_path(
    inner: &Inner,
    root: &Path,
    path: &str,
) -> Result<PathBuf, CoreError> {
    reject_links(root, path)?;
    files::resolve_path(&inner.data_dir, root, path, false, false)
}

pub(super) fn reject_links(root: &Path, relative: &str) -> Result<(), CoreError> {
    if relative.is_empty() {
        return Ok(());
    }
    let mut current = root.to_path_buf();
    for part in relative.split('/') {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(kaleidoscope_contract::errors::FILE_PATH_OUTSIDE_ROOT(
                    relative,
                ))
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(if is_file_busy(&error) {
                    kaleidoscope_contract::errors::FILE_LINK_CHECK_BUSY(relative)
                        .and_details(vec![error.to_string()])
                } else {
                    kaleidoscope_contract::errors::FILE_LINK_CHECK_IO(relative)
                        .and_details(vec![error.to_string()])
                });
            }
        }
    }
    Ok(())
}

pub(super) fn protect_data_ancestor(inner: &Inner, path: &Path) -> Result<(), CoreError> {
    let protected = fs::canonicalize(&inner.data_dir).map_err(|error| {
        let path = inner.data_dir.display().to_string();
        file_system_error(
            &error,
            || kaleidoscope_contract::errors::FILE_DATA_PATH_CHECK_NOT_FOUND(&path),
            || kaleidoscope_contract::errors::FILE_DATA_PATH_CHECK_BUSY(&path),
            || kaleidoscope_contract::errors::FILE_DATA_PATH_CHECK_IO(&path),
        )
    })?;
    if protected.starts_with(path) {
        return Err(kaleidoscope_contract::errors::FILE_PATH_PROTECTED(
            &path.display().to_string(),
        ));
    }
    Ok(())
}

pub(super) fn path_exists(path: &Path) -> Result<bool, CoreError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => {
            let path = path.display().to_string();
            Err(if is_file_busy(&error) {
                kaleidoscope_contract::errors::FILE_PATH_EXISTS_CHECK_BUSY(&path)
                    .and_details(vec![error.to_string()])
            } else {
                kaleidoscope_contract::errors::FILE_PATH_EXISTS_CHECK_IO(&path)
                    .and_details(vec![error.to_string()])
            })
        }
    }
}

pub(super) fn join_relative(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.into()
    } else {
        format!("{parent}/{name}")
    }
}

pub(super) fn selected_roots(paths: &[String]) -> Vec<&str> {
    paths
        .iter()
        .enumerate()
        .filter_map(|(index, path)| {
            let selected_ancestor = paths.iter().enumerate().any(|(other_index, ancestor)| {
                index != other_index && is_descendant_path(path, ancestor)
            });
            (!selected_ancestor).then_some(path.as_str())
        })
        .collect()
}

fn is_descendant_path(path: &str, ancestor: &str) -> bool {
    if ancestor.is_empty() {
        return !path.is_empty();
    }
    path.strip_prefix(ancestor)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

pub(in crate::files_write) fn successful_changes(results: &[FileOpResult]) -> Vec<FileChange> {
    results
        .iter()
        .filter_map(|result| match result {
            FileOpResult::Ok { ok, .. } => Some(ok.clone()),
            FileOpResult::Error { .. } => None,
        })
        .collect()
}

pub(super) fn result_to_op(path: &str, result: Result<FileChange, CoreError>) -> FileOpResult {
    match result {
        Ok(ok) => FileOpResult::Ok {
            path: path.into(),
            ok,
        },
        Err(error) => FileOpResult::Error {
            path: path.into(),
            error,
        },
    }
}

pub(super) fn named_error(message: &str) -> CoreError {
    kaleidoscope_contract::errors::FILE_NAME_INVALID(message)
}

pub(super) fn map_create_file_error(error: &io::Error, path: &str) -> CoreError {
    if error.kind() == io::ErrorKind::AlreadyExists {
        kaleidoscope_contract::errors::FILE_CREATE_FILE_NAME_TAKEN(path)
    } else {
        file_system_error(
            error,
            || kaleidoscope_contract::errors::FILE_CREATE_FILE_OPEN_NOT_FOUND(path),
            || kaleidoscope_contract::errors::FILE_CREATE_FILE_OPEN_BUSY(path),
            || kaleidoscope_contract::errors::FILE_CREATE_FILE_OPEN_IO(path),
        )
    }
}

pub(super) fn map_create_folder_error(error: &io::Error, name: &str) -> CoreError {
    if error.kind() == io::ErrorKind::AlreadyExists {
        kaleidoscope_contract::errors::FILE_CREATE_FOLDER_NAME_TAKEN(name)
    } else {
        file_system_error(
            error,
            || kaleidoscope_contract::errors::FILE_CREATE_FOLDER_CREATE_NOT_FOUND(name),
            || kaleidoscope_contract::errors::FILE_CREATE_FOLDER_CREATE_BUSY(name),
            || kaleidoscope_contract::errors::FILE_CREATE_FOLDER_CREATE_IO(name),
        )
    }
}

pub(in crate::files_write) fn file_system_error(
    error: &io::Error,
    not_found: impl FnOnce() -> CoreError,
    busy: impl FnOnce() -> CoreError,
    io: impl FnOnce() -> CoreError,
) -> CoreError {
    let mut mapped = if error.kind() == io::ErrorKind::NotFound {
        not_found()
    } else if is_file_busy(error) {
        busy()
    } else {
        io()
    };
    mapped.details.push(error.to_string());
    mapped
}

pub(super) fn is_file_busy(error: &io::Error) -> bool {
    error.raw_os_error().is_some_and(is_file_busy_code)
}

#[cfg(windows)]
pub(super) fn is_file_busy_code(code: i32) -> bool {
    matches!(code, 32 | 33)
}

#[cfg(not(windows))]
pub(super) fn is_file_busy_code(_code: i32) -> bool {
    false
}
