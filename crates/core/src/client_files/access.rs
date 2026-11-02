use kaleidoscope_contract::CoreError;

use crate::{app_commands, Inner};

pub(super) fn require_client(inner: &Inner, id: &str) -> Result<(), CoreError> {
    let state = inner.state.lock().unwrap();
    let window = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == id)
        .ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_CLIENT_WINDOW_NOT_FOUND()
                .and_details(vec![format!("window_id: {id}")])
        })?;
    let definition =
        app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
            .ok_or_else(|| {
                kaleidoscope_contract::errors::FILE_CLIENT_APP_VERSION_NOT_FOUND().and_details(
                    vec![
                        format!("window_id: {id}"),
                        format!("app_id: {}", window.app_id),
                        format!("app_version: {}", window.app_version),
                    ],
                )
            })?;
    if definition.client.is_none() {
        return Err(
            kaleidoscope_contract::errors::FILE_CLIENT_NOT_DECLARED().and_details(vec![
                format!("window_id: {id}"),
                format!("app_id: {}", window.app_id),
            ]),
        );
    }
    Ok(())
}
