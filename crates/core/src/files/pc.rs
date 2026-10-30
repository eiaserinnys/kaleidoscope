use std::fs;
use std::path::PathBuf;

use kaleidoscope_contract::validate::valid_relative_path;
use kaleidoscope_contract::{CoreError, ErrorCode, FilesScope, PermissionDecl};

use super::{permission, resolve_path};
use crate::{error, CoreState, Inner};

pub(super) fn pc_access(
    state: &CoreState,
    window_id: &str,
    permission_id: &str,
) -> Result<(), CoreError> {
    permission(state, window_id, permission_id, false)?;
    let window = state
        .shared
        .windows
        .iter()
        .find(|w| w.id == window_id)
        .unwrap();
    if state
        .device
        .pc_access
        .iter()
        .any(|a| a.app_id == window.app_id && a.permission == permission_id)
    {
        Ok(())
    } else {
        Err(error::make(ErrorCode::NotGranted))
    }
}

pub(super) fn pc_roots(inner: &Inner) -> Vec<crate::PcRoot> {
    let roots = inner.host.pc_roots();
    *inner.pc_roots.lock().unwrap() = roots.clone();
    roots
}

pub(super) fn pc_resolve(inner: &Inner, path: &str) -> Result<(PathBuf, PathBuf), CoreError> {
    if path.is_empty() {
        return Err(error::make(ErrorCode::NotFound));
    }
    if !valid_relative_path(path, false) {
        return Err(error::make(ErrorCode::PathOutsideRoot));
    }
    let (id, relative) = path.split_once('/').unwrap_or((path, ""));
    let mut root = inner
        .pc_roots
        .lock()
        .unwrap()
        .iter()
        .find(|r| r.id == id)
        .cloned();
    if root.is_none() {
        root = pc_roots(inner).into_iter().find(|r| r.id == id);
    }
    let root = root.ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let root = fs::canonicalize(root.path).map_err(|e| error::io_error(&e))?;
    let resolved = resolve_path(&inner.data_dir, &root, relative, true, false)?;
    Ok((root, resolved))
}

pub(crate) fn scope(
    state: &CoreState,
    window_id: &str,
    permission_id: &str,
) -> Result<FilesScope, CoreError> {
    let window = state
        .shared
        .windows
        .iter()
        .find(|w| w.id == window_id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let version = state
        .shared
        .app_versions
        .iter()
        .find(|v| v.app_id == window.app_id && v.version == window.app_version)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    match version
        .definition
        .permissions
        .iter()
        .find(|p| p.id() == permission_id)
    {
        Some(PermissionDecl::Files { scope, .. }) => Ok(*scope),
        _ => Err(error::make(ErrorCode::PermissionDenied)),
    }
}
