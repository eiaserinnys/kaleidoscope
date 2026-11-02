use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use kaleidoscope_contract::{
    file_name::check_file_name, CoreError, CoreReply, ErrorCode, FileChange, FileOpResult,
    FilesScope,
};

use crate::{error, files, CoreState, Inner};

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
                    return Err(error::make(ErrorCode::Conflict));
                }
                Err(error) => return Err(io_error(&error)),
            };
            if files::revision(&current) != expected {
                return Err(error::make(ErrorCode::Conflict));
            }
            fs::write(&resolved, text.as_bytes()).map_err(|error| io_error(&error))?;
        }
        None => {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&resolved)
                .map_err(|error| map_create_error(&error))?;
            use std::io::Write;
            file.write_all(text.as_bytes())
                .map_err(|error| io_error(&error))?;
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
        .map_err(|error| io_error(&error))?
        .is_dir()
    {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    reject_links(root, parent)?;
    let path = join_relative(parent, name);
    let target = files::resolve_path(&inner.data_dir, root, &path, false, true)?;
    if path_exists(&target)? {
        return Err(error::make(ErrorCode::Conflict));
    }
    fs::create_dir(&target).map_err(|error| map_create_error(&error))?;
    Ok(path)
}

pub(super) fn rename(
    inner: &Inner,
    root: &Path,
    path: &str,
    name: &str,
) -> Result<FileChange, CoreError> {
    if path.is_empty() {
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    check_file_name(name).map_err(|message| named_error(message))?;
    let source = resolve_mutation_path(inner, root, path)?;
    protect_data_ancestor(inner, &source)?;
    let parent = path.rsplit_once('/').map_or("", |(parent, _)| parent);
    let to = join_relative(parent, name);
    let target = files::resolve_path(&inner.data_dir, root, &to, false, true)?;
    reject_links(root, &to)?;
    if path_exists(&target)? && fs::canonicalize(&target).ok() != Some(source.clone()) {
        return Err(error::make(ErrorCode::Conflict));
    }
    fs::rename(&source, &target).map_err(|error| io_error(&error))?;
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
    let destination_path = match destination_dir(inner, root, destination) {
        Ok(path) => path,
        Err(error) => {
            return paths
                .iter()
                .map(|path| FileOpResult::Error {
                    path: path.clone(),
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
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    let source = resolve_mutation_path(inner, root, path)?;
    protect_data_ancestor(inner, &source)?;
    if fs::metadata(&source)
        .map_err(|error| io_error(&error))?
        .is_dir()
        && destination_path.starts_with(&source)
    {
        return Err(error::make(ErrorCode::PathOutsideRoot));
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| error::make(ErrorCode::InvalidName))?;
    check_file_name(name).map_err(|message| named_error(message))?;
    let to = join_relative(destination, name);
    let target = files::resolve_path(&inner.data_dir, root, &to, false, true)?;
    reject_links(root, &to)?;
    if path_exists(&target)? && fs::canonicalize(&target).ok() != Some(source.clone()) {
        return Err(error::make(ErrorCode::Conflict));
    }
    fs::rename(&source, &target).map_err(|error| io_error(&error))?;
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
    let destination_path = match destination_dir(inner, root, destination) {
        Ok(path) => path,
        Err(error) => {
            return paths
                .iter()
                .map(|path| FileOpResult::Error {
                    path: path.clone(),
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
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    let source = resolve_mutation_path(inner, root, path)?;
    let source_is_dir = fs::metadata(&source)
        .map_err(|error| io_error(&error))?
        .is_dir();
    if source_is_dir && destination_path.starts_with(&source) {
        return Err(error::make(ErrorCode::PathOutsideRoot));
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| error::make(ErrorCode::InvalidName))?;
    let target_name = copy_name(&source, name, destination_path)?;
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
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    let source = resolve_mutation_path(inner, root, path)?;
    protect_data_ancestor(inner, &source)?;
    if permanent {
        remove_entry(&source).map_err(|error| io_error(&error))?;
    } else if let Err(error) = trash::delete(&source) {
        let code = match error {
            trash::Error::Os { code, .. }
                if files::operation_io_error(&io::Error::from_raw_os_error(code)).code
                    == ErrorCode::FileBusy =>
            {
                ErrorCode::FileBusy
            }
            _ => ErrorCode::TrashUnavailable,
        };
        return Err(error::make(code));
    }
    Ok(FileChange {
        from: Some(path.into()),
        to: None,
    })
}

fn destination_dir(inner: &Inner, root: &Path, destination: &str) -> Result<PathBuf, CoreError> {
    let path = files::resolve_path(&inner.data_dir, root, destination, true, false)?;
    reject_links(root, destination)?;
    if !fs::metadata(&path)
        .map_err(|error| io_error(&error))?
        .is_dir()
    {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    Ok(path)
}

pub(super) fn readable_path(
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

fn resolve_mutation_path(inner: &Inner, root: &Path, path: &str) -> Result<PathBuf, CoreError> {
    reject_links(root, path)?;
    files::resolve_path(&inner.data_dir, root, path, false, false)
}

fn reject_links(root: &Path, relative: &str) -> Result<(), CoreError> {
    if relative.is_empty() {
        return Ok(());
    }
    let mut current = root.to_path_buf();
    for part in relative.split('/') {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(error::make(ErrorCode::PathOutsideRoot))
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(io_error(&error)),
        }
    }
    Ok(())
}

fn protect_data_ancestor(inner: &Inner, path: &Path) -> Result<(), CoreError> {
    let protected = fs::canonicalize(&inner.data_dir).map_err(|error| io_error(&error))?;
    if protected.starts_with(path) {
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    Ok(())
}

fn path_exists(path: &Path) -> Result<bool, CoreError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error(&error)),
    }
}

fn copy_entry(source: &Path, destination: &Path) -> Result<(), CoreError> {
    let metadata = fs::symlink_metadata(source).map_err(|error| io_error(&error))?;
    if metadata.file_type().is_symlink() {
        return Err(error::make(ErrorCode::PathOutsideRoot));
    }
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|error| io_error(&error))?;
        for entry in fs::read_dir(source).map_err(|error| io_error(&error))? {
            let entry = entry.map_err(|error| io_error(&error))?;
            let target = destination.join(entry.file_name());
            copy_entry(&entry.path(), &target)?;
        }
    } else {
        let mut input = File::open(source).map_err(|error| io_error(&error))?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|error| io_error(&error))?;
        io::copy(&mut input, &mut output).map_err(|error| io_error(&error))?;
    }
    Ok(())
}

fn copy_name(source: &Path, name: &str, destination: &Path) -> Result<String, CoreError> {
    let is_dir = fs::metadata(source)
        .map_err(|error| io_error(&error))?
        .is_dir();
    let (stem, extension) = if is_dir {
        (name, None)
    } else if let Some(index) = name.rfind('.').filter(|index| *index > 0) {
        (&name[..index], Some(&name[index..]))
    } else {
        (name, None)
    };
    let suffix = |index: usize| {
        if index == 1 {
            " - 복사본".to_string()
        } else {
            format!(" - 복사본 ({index})")
        }
    };
    for index in 1.. {
        let candidate = format!("{}{}{}", stem, suffix(index), extension.unwrap_or(""));
        check_file_name(&candidate).map_err(|message| named_error(message))?;
        if !path_exists(&destination.join(&candidate))? {
            return Ok(candidate);
        }
    }
    unreachable!()
}

fn remove_entry(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn join_relative(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.into()
    } else {
        format!("{parent}/{name}")
    }
}

pub(super) fn successful_changes(results: &[FileOpResult]) -> Vec<FileChange> {
    results
        .iter()
        .filter_map(|result| match result {
            FileOpResult::Ok { ok, .. } => Some(ok.clone()),
            FileOpResult::Error { .. } => None,
        })
        .collect()
}

fn result_to_op(path: &str, result: Result<FileChange, CoreError>) -> FileOpResult {
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

fn named_error(message: &str) -> CoreError {
    error::with_message(ErrorCode::InvalidName, message)
}

fn map_create_error(error: &io::Error) -> CoreError {
    if error.kind() == io::ErrorKind::AlreadyExists {
        error::make(ErrorCode::Conflict)
    } else {
        io_error(error)
    }
}

fn io_error(error: &io::Error) -> CoreError {
    files::operation_io_error(error)
}
