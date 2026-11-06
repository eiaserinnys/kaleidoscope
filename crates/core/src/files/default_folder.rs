use std::fs;
use std::io;
use std::sync::{Arc, MutexGuard};

use kaleidoscope_contract::{
    errors, CoreError, DefaultFolderAccess, DefaultFolderResult, FileAccess, FilesScope, Grant,
    KnownFolder, PcRootKind, PermissionDecl, PC_KNOWN_FOLDERS,
};

use crate::{data_runtime, state_commands, CoreState, Inner};

fn declaration(
    state: &CoreState,
    window_id: &str,
    permission: &str,
) -> Result<(String, KnownFolder, FileAccess), CoreError> {
    let window = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)
        .ok_or_else(|| {
            errors::FILE_ACCESS_WINDOW_NOT_FOUND()
                .and_details(vec![format!("window_id: {window_id}")])
        })?;
    let version = state
        .shared
        .app_versions
        .iter()
        .find(|version| version.app_id == window.app_id && version.version == window.app_version)
        .ok_or_else(|| {
            errors::FILE_ACCESS_APP_VERSION_NOT_FOUND().and_details(vec![
                format!("app_id: {}", window.app_id),
                format!("app_version: {}", window.app_version),
            ])
        })?;
    match version
        .definition
        .permissions
        .iter()
        .find(|item| item.id() == permission)
    {
        Some(PermissionDecl::Files {
            scope: FilesScope::Folder,
            default_folder: Some(folder),
            access,
            ..
        }) => Ok((window.app_id.clone(), *folder, *access)),
        _ => Err(errors::DESK_DEFAULT_FOLDER_PERMISSION_INVALID(permission)),
    }
}

fn existing(state: &CoreState, window_id: &str, permission: &str) -> Option<DefaultFolderResult> {
    state
        .device
        .grants
        .iter()
        .find(|grant| grant.window_id == window_id && grant.permission == permission)
        .cloned()
        .map(|grant| DefaultFolderResult::Ready { grant })
}

fn root(inner: &Inner, folder: KnownFolder) -> Result<Option<crate::PcRoot>, CoreError> {
    let Some(root) = inner
        .host
        .pc_roots()
        .into_iter()
        .find(|root| root.kind == PcRootKind::Known && root.id == folder.as_str())
    else {
        return Ok(None);
    };
    match fs::metadata(&root.path) {
        Ok(metadata) if metadata.is_dir() => Ok(Some(root)),
        Ok(_) => Err(errors::DESK_DEFAULT_FOLDER_NOT_DIRECTORY(folder_name(folder))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(errors::DESK_DEFAULT_FOLDER_RESOLVE_FAILED(folder_name(folder))
            .and_details(vec![error.to_string()])),
    }
}

fn folder_name(folder: KnownFolder) -> &'static str {
    PC_KNOWN_FOLDERS
        .iter()
        .find(|(id, _)| *id == folder.as_str())
        .expect("알려진 폴더 이름이 있어야 합니다")
        .1
}

fn resolved(
    inner: &Inner,
    root: &crate::PcRoot,
    folder: KnownFolder,
) -> Result<Option<std::path::PathBuf>, CoreError> {
    let path = match fs::canonicalize(&root.path) {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(errors::DESK_DEFAULT_FOLDER_RESOLVE_FAILED(folder_name(folder))
                .and_details(vec![error.to_string()]))
        }
    };
    Ok(Some(super::resolve_path(
        &inner.data_dir,
        &path,
        "",
        true,
        false,
    )?))
}

pub(crate) fn prepare(
    inner: &Arc<Inner>,
    window_id: &str,
    permission: &str,
) -> Result<DefaultFolderResult, CoreError> {
    let state = inner.state.lock().unwrap();
    if let Some(result) = existing(&state, window_id, permission) {
        super::permission(&state, window_id, permission, false)?;
        return Ok(result);
    }
    let (app_id, folder, access) = declaration(&state, window_id, permission)?;
    let Some(root) = root(inner, folder)? else {
        return Ok(DefaultFolderResult::Unavailable);
    };
    if !state.device.default_folder_access.iter().any(|item| {
        item.app_id == app_id
            && item.permission == permission
            && item.folder == folder
            && item.access == access
    }) {
        return Ok(DefaultFolderResult::ConsentRequired { folder, access });
    }
    let Some(path) = resolved(inner, &root, folder)? else {
        return Ok(DefaultFolderResult::Unavailable);
    };
    let grant = Grant {
        window_id: window_id.into(),
        permission: permission.into(),
        root_path: path.to_string_lossy().into_owned(),
        root_name: root.name,
        granted_at: state_commands::timestamp(),
    };
    Ok(DefaultFolderResult::Ready {
        grant: save_grant(inner, state, grant, None)?,
    })
}

pub(crate) fn allow(
    inner: &Arc<Inner>,
    window_id: &str,
    permission: &str,
) -> Result<DefaultFolderResult, CoreError> {
    let state = inner.state.lock().unwrap();
    if let Some(result) = existing(&state, window_id, permission) {
        super::permission(&state, window_id, permission, false)?;
        return Ok(result);
    }
    let (app_id, folder, access) = declaration(&state, window_id, permission)?;
    let Some(root) = root(inner, folder)? else {
        return Ok(DefaultFolderResult::Unavailable);
    };
    let Some(path) = resolved(inner, &root, folder)? else {
        return Ok(DefaultFolderResult::Unavailable);
    };
    let now = state_commands::timestamp();
    let grant = Grant {
        window_id: window_id.into(),
        permission: permission.into(),
        root_path: path.to_string_lossy().into_owned(),
        root_name: root.name,
        granted_at: now.clone(),
    };
    let consent = DefaultFolderAccess {
        app_id,
        permission: permission.into(),
        folder,
        access,
        granted_at: now,
    };
    Ok(DefaultFolderResult::Ready {
        grant: save_grant(inner, state, grant, Some(consent))?,
    })
}

pub(crate) fn save_grant(
    inner: &Arc<Inner>,
    mut state: MutexGuard<'_, CoreState>,
    grant: Grant,
    consent: Option<DefaultFolderAccess>,
) -> Result<Grant, CoreError> {
    let before = state.clone();
    state.device.grants.retain(|existing| {
        existing.window_id != grant.window_id || existing.permission != grant.permission
    });
    state.device.grants.push(grant.clone());
    if let Some(consent) = consent {
        if !state.device.default_folder_access.iter().any(|item| {
            item.app_id == consent.app_id
                && item.permission == consent.permission
                && item.folder == consent.folder
                && item.access == consent.access
        }) {
            state.device.default_folder_access.push(consent);
        }
    }
    if let Err(error) = inner.save_state_locked(&state, false, true, false) {
        *state = before;
        return Err(error);
    }
    let event = inner.state_event_locked(&state);
    drop(state);
    inner.emit_state(&event);
    data_runtime::grant_changed(inner, &grant.window_id, &grant.permission);
    Ok(grant)
}
