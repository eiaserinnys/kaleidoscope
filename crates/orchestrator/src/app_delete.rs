//! MCP와 기기가 공유하는 앱 삭제 흐름.
use super::*;
use axum::extract::{Extension, Path};
use kaleidoscope_contract::{errors, store::DeviceRemoveRequest};

impl AppState {
    pub(super) fn delete_app(
        &self,
        app_id: &str,
        device_id: Option<&str>,
        expected: Option<u32>,
    ) -> Result<usize, CoreError> {
        if kaleidoscope_contract::builtin::is_builtin(app_id) {
            return Err(errors::MCP_DELETE_APP_BUILTIN(app_id));
        }
        let account = match device_id {
            Some(device) => self.device_account_id(device)?,
            None => self.mcp_account_id()?,
        };
        let db_error = |error: rusqlite::Error| {
            let error_response = if device_id.is_some() {
                errors::REGISTRYINSTALL_DATABASE_FAILED(app_id)
            } else {
                errors::MCP_DELETE_APP_DATABASE_FAILED(app_id)
            };
            error_response.and_details(vec![error.to_string()])
        };
        let windows = {
            let mut db = self.lock_db()?;
            let tx = db.transaction().map_err(db_error)?;
            let current: Option<(u32, Option<String>)> = tx.query_row(
                "SELECT current_version,installation_json FROM apps WHERE id=?1 AND deleted_at IS NULL",
                [app_id], |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional().map_err(db_error)?;
            if let Some(expected) = expected {
                if current.as_ref().map(|(version, _)| *version) != Some(expected) {
                    return Err(errors::REGISTRYINSTALL_EXPECTED_VERSION_CONFLICT(app_id));
                }
                if current
                    .as_ref()
                    .and_then(|(_, origin)| origin.as_ref())
                    .is_none()
                {
                    return Err(errors::REGISTRYINSTALL_NOT_STORE_APP(app_id));
                }
            }
            if current.is_none() {
                return Err(errors::MCP_DELETE_APP_NOT_FOUND(app_id));
            }
            tx.execute(
                "UPDATE apps SET deleted_at=?2 WHERE id=?1 AND deleted_at IS NULL",
                params![app_id, timestamp()],
            )
            .map_err(db_error)?;
            let windows = {
                let mut statement = tx.prepare("SELECT v.id FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE v.app_id=?1 AND w.account_id=?2").map_err(db_error)?;
                let ids = statement
                    .query_map(params![app_id, account], |row| row.get::<_, String>(0))
                    .map_err(db_error)?;
                ids.collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(db_error)?
            };
            tx.commit().map_err(db_error)?;
            windows
        };
        let (_, changed) = self.apply_layout_changes(
            device_id,
            &registry::LayoutChanges {
                deleted_windows: windows,
                ..Default::default()
            },
        )?;
        let count = changed.deleted_windows.len();
        if !changed.is_empty() {
            self.send_event_for_account(DeviceEvent::LayoutChanged { changes: changed }, &account);
        }
        self.send_event(DeviceEvent::AppDeleted {
            app_id: app_id.to_string(),
        });
        Ok(count)
    }
}

pub(super) async fn device_delete(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(app_id): Path<String>,
    Json(request): Json<DeviceRemoveRequest>,
) -> Response {
    match super::registry_install::registry_owner_account(&state, &device.0) {
        Ok(Some(_)) => {}
        Ok(None) => {
            return super::http::error_response(
                StatusCode::FORBIDDEN,
                errors::REGISTRYINSTALL_REMOVE_ACCOUNT_FORBIDDEN(&app_id),
            )
        }
        Err(error) => return super::http::error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
    match state.delete_app(
        &app_id,
        Some(&device.0),
        Some(request.expected_current_version.get()),
    ) {
        Ok(closed_windows) => (
            StatusCode::OK,
            Json(json!({"app_id":app_id,"deleted":true,"closed_windows":closed_windows})),
        )
            .into_response(),
        Err(error) => super::http::error_response(StatusCode::BAD_REQUEST, error),
    }
}
