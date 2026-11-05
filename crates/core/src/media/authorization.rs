//! 미디어 파일의 창과 폴더 권한을 같은 경로에서 확인한다.
use crate::{app_commands, files, CoreState, Inner};
use kaleidoscope_contract::{data::ResourceMediaRef, errors, CoreError, PermissionDecl};
use std::{fs, path::PathBuf, sync::Arc};

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Identity {
    pub app_id: String,
    pub app_version: u32,
    pub root: String,
    pub granted_at: String,
}

pub(super) struct FileAccess {
    pub identity: Identity,
    pub root: PathBuf,
    pub path: PathBuf,
    pub metadata: fs::Metadata,
}

pub(super) fn permission(
    state: &CoreState,
    window_id: &str,
    id: &str,
) -> Result<PermissionDecl, CoreError> {
    let window = state
        .shared
        .windows
        .iter()
        .find(|item| item.id == window_id)
        .ok_or_else(|| {
            errors::MEDIA_LOAD_WINDOW_NOT_FOUND().and_details(vec![format!("window: {window_id}")])
        })?;
    let definition =
        app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
            .ok_or_else(|| {
                errors::MEDIA_LOAD_APP_DEFINITION_NOT_FOUND()
                    .and_details(vec![format!("window: {window_id}")])
            })?;
    definition
        .permissions
        .iter()
        .find(|item| item.id() == id)
        .cloned()
        .ok_or_else(|| errors::MEDIA_LOAD_PERMISSION_NOT_DECLARED(id))
}

pub(super) fn identity(state: &CoreState, window_id: &str, id: &str) -> Option<Identity> {
    let window = state
        .shared
        .windows
        .iter()
        .find(|item| item.id == window_id)?;
    if !matches!(
        permission(state, window_id, id).ok()?,
        PermissionDecl::Files { .. }
    ) {
        return None;
    }
    let grant = state
        .device
        .grants
        .iter()
        .find(|grant| grant.window_id == window_id && grant.permission == id)?;
    Some(Identity {
        app_id: window.app_id.clone(),
        app_version: window.app_version,
        root: grant.root_path.clone(),
        granted_at: grant.granted_at.clone(),
    })
}

pub(super) fn file(
    inner: &Arc<Inner>,
    window_id: &str,
    media: &ResourceMediaRef,
) -> Result<FileAccess, CoreError> {
    let state = inner.state.lock().unwrap();
    // 기존 data.media와 같은 창·앱·권한 오류를 보존한다.
    permission(&state, window_id, &media.permission)?;
    let root = files::granted_root(&state, window_id, &media.permission, false)
        .map_err(|error| super::file_root_error(&media.path, error))?;
    let identity = identity(&state, window_id, &media.permission)
        .expect("폴더 권한과 grant는 granted_root가 확인했다");
    let path = files::resolve_path(&inner.data_dir, &root, &media.path, false, false)
        .map_err(|error| super::file_path_error(&media.path, error))?;
    let metadata = fs::metadata(&path).map_err(|err| {
        let error = if err.kind() == std::io::ErrorKind::NotFound {
            errors::MEDIA_LOAD_FILE_METADATA_NOT_FOUND(&media.path)
        } else {
            errors::MEDIA_LOAD_FILE_METADATA_FAILED(&media.path)
        };
        error.and_details(vec![err.to_string()])
    })?;
    Ok(FileAccess {
        identity,
        root,
        path,
        metadata,
    })
}

pub(super) fn modified(
    metadata: &fs::Metadata,
    path: &str,
) -> Result<std::time::SystemTime, CoreError> {
    metadata.modified().map_err(|err| {
        let error = if err.kind() == std::io::ErrorKind::NotFound {
            errors::MEDIA_LOAD_FILE_MODIFIED_TIME_NOT_FOUND(path)
        } else {
            errors::MEDIA_LOAD_FILE_MODIFIED_TIME_FAILED(path)
        };
        error.and_details(vec![err.to_string()])
    })
}
