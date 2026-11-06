use kaleidoscope_contract::{client::ClientFile, errors, CoreError, CLIENT_FILE_OPEN_VERSION};

use crate::{app_commands, files, Inner};

pub(crate) fn open(
    inner: &Inner,
    window_id: &str,
    permission: &str,
    path: &str,
) -> Result<ClientFile, CoreError> {
    let resolved = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|window| window.id == window_id)
            .ok_or_else(|| {
                errors::FILE_CLIENT_WINDOW_NOT_FOUND()
                    .and_details(vec![format!("window_id: {window_id}")])
            })?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| {
                    errors::FILE_CLIENT_APP_VERSION_NOT_FOUND().and_details(vec![
                        format!("window_id: {window_id}"),
                        format!("app_id: {}", window.app_id),
                    ])
                })?;
        if definition.client.is_none() {
            return Err(errors::FILE_CLIENT_NOT_DECLARED().and_details(vec![
                format!("window_id: {window_id}"),
                format!("app_id: {}", window.app_id),
            ]));
        }
        if definition
            .requires
            .modules
            .get("client")
            .copied()
            .unwrap_or(0)
            < CLIENT_FILE_OPEN_VERSION
        {
            return Err(errors::FILE_CLIENT_OPEN_VERSION_LOW(
                CLIENT_FILE_OPEN_VERSION,
            ));
        }
        let root = files::granted_root(&state, window_id, permission, false)?;
        files::resolve_path(&inner.data_dir, &root, path, false, false)?
    };
    super::register(inner, window_id, resolved)
}
