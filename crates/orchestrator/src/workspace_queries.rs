use super::*;
use kaleidoscope_contract::errors;
use kaleidoscope_contract::registry::DeviceLayout;
use kaleidoscope_contract::{AppWindow, Desktop, Workspace};

impl AppState {
    pub(super) fn layout_snapshot(&self, device_id: &str) -> Result<DeviceEvent, CoreError> {
        let db = self
            .lock_db()
            .map_err(|_| errors::SERVER_LAYOUT_SNAPSHOT_READ_FAILED())?;
        let account_id: String = db
            .query_row(
                "SELECT account_id FROM devices WHERE id=?1",
                [device_id],
                |row| row.get(0),
            )
            .map_err(layout_snapshot_db_error)?;
        let workspaces =
            AppState::load_account_entities::<Workspace>(&db, "workspaces", &account_id)?;
        let desktops = AppState::load_account_entities::<Desktop>(&db, "desktops", &account_id)?;
        let windows = AppState::load_account_entities::<AppWindow>(&db, "windows", &account_id)?;
        Ok(DeviceEvent::LayoutSnapshot {
            workspaces,
            desktops,
            windows,
        })
    }

    pub(super) fn layouts(
        &self,
        account_id: &str,
    ) -> Result<Vec<(String, String, String, DeviceLayout)>, CoreError> {
        let db = self
            .lock_db()
            .map_err(|_| errors::SERVER_LAYOUT_REPORT_LIST_FAILED())?;
        let mut stmt = db.prepare("SELECT d.id,d.name,l.reported_at,l.layout FROM device_layouts l JOIN devices d ON d.id=l.device_id WHERE d.account_id=?1 AND d.revoked_at IS NULL ORDER BY l.reported_at DESC,d.id").map_err(layout_report_list_db_error)?;
        let rows = stmt
            .query_map([account_id], |row| {
                let raw: String = row.get(3)?;
                let layout = serde_json::from_str(&raw).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?;
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, layout))
            })
            .map_err(layout_report_list_db_error)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(layout_report_list_db_error)
    }

    pub(super) fn get_workspace(&self, id: &str) -> Result<Option<Value>, CoreError> {
        let account_id = self.mcp_account_id()?;
        let (workspaces, mut desktops, windows) = {
            let db = self.lock_db()?;
            (
                Self::load_account_entities::<Workspace>(&db, "workspaces", &account_id)?,
                Self::load_account_entities::<Desktop>(&db, "desktops", &account_id)?,
                Self::load_account_entities::<AppWindow>(&db, "windows", &account_id)?,
            )
        };
        let Some(workspace) = workspaces.into_iter().find(|workspace| workspace.id == id) else {
            return Ok(None);
        };
        let report = self
            .layouts(&account_id)?
            .into_iter()
            .find(|(_, _, _, layout)| layout.workspaces.iter().any(|item| item.id == id));
        let apps = self.current_apps()?;
        desktops.retain(|desktop| desktop.workspace_id == id);
        desktops.sort_by_key(|desktop| {
            (
                desktop.position,
                desktop.created_at.clone(),
                desktop.id.clone(),
            )
        });
        let rendered_desktops:Vec<Value>=desktops.iter().map(|desktop| {
            let active=report.as_ref().and_then(|(_,_,_,layout)|layout.active_desktop_ids.get(id)).is_some_and(|active|active==&desktop.id);
            let mut windows_in:Vec<_>=windows.iter().filter(|window|window.desktop_id==desktop.id).collect();
            windows_in.sort_by_key(|window|std::cmp::Reverse(window.z));
            let rendered_windows:Vec<Value>=windows_in.into_iter().map(|window| {
                let app_name=apps.iter().find(|app|app.app.id==window.app_id).map(|app|app.app.name.as_str()).or_else(|| kaleidoscope_contract::builtin::builtin_identity(&window.app_id).map(|identity|identity.name)).unwrap_or(&window.app_id);
                let report_layout=report.as_ref().map(|(_,_,_,layout)|layout);
                let folders:std::collections::BTreeMap<_,_>=report_layout.into_iter().flat_map(|layout|layout.folders.iter()).filter(|folder|folder.window_id==window.id).map(|folder|(folder.permission.clone(),folder.root_name.clone())).collect();
                let errors:Vec<_>=report_layout.into_iter().flat_map(|layout|layout.data_errors.iter()).filter(|error|error.window_id==window.id).map(|error|json!({"pointer":error.pointer,"message":error.message})).collect();
                let mut value=json!({"window_id":window.id,"app_id":window.app_id,"app_name":app_name,"app_version":window.app_version,"rect":window.rect,"z":window.z,"state":window.state,"folders":folders});
                if !errors.is_empty(){value["data_errors"]=json!(errors);} value
            }).collect();
            json!({"desktop_id":desktop.id,"name":desktop.name,"position":desktop.position,"active":active,"windows":rendered_windows})
        }).collect();
        let (device, reported_at, active, active_desktop_id) =
            if let Some((device_id, name, at, layout)) = report {
                let connected = self
                    .0
                    .connections
                    .lock()
                    .map_err(|_| errors::SERVER_LAYOUT_WORKSPACE_CONNECTION_STATE_READ_FAILED())?
                    .get(&device_id)
                    .copied()
                    .unwrap_or(0)
                    > 0;
                (
                    json!({"id":device_id,"name":name,"connected":connected}),
                    json!(at),
                    layout.active_workspace_id.as_deref() == Some(id),
                    layout
                        .active_desktop_ids
                        .get(id)
                        .cloned()
                        .map(Value::from)
                        .unwrap_or(Value::Null),
                )
            } else {
                (Value::Null, Value::Null, false, Value::Null)
            };
        Ok(Some(
            json!({"workspace_id":id,"name":workspace.name,"device":device,"reported_at":reported_at,"active":active,"active_desktop_id":active_desktop_id,"desktops":rendered_desktops}),
        ))
    }

    pub(super) fn list_workspaces(&self) -> Result<Value, CoreError> {
        let account_id = self.mcp_account_id()?;
        let (workspaces, desktops, windows) = {
            let db = self.lock_db()?;
            (
                Self::load_account_entities::<Workspace>(&db, "workspaces", &account_id)?,
                Self::load_account_entities::<Desktop>(&db, "desktops", &account_id)?,
                Self::load_account_entities::<AppWindow>(&db, "windows", &account_id)?,
            )
        };
        let mut result = Vec::with_capacity(workspaces.len());
        for workspace in workspaces {
            let ids: HashSet<_> = desktops
                .iter()
                .filter(|desktop| desktop.workspace_id == workspace.id)
                .map(|desktop| desktop.id.as_str())
                .collect();
            let window_count = windows
                .iter()
                .filter(|window| ids.contains(window.desktop_id.as_str()))
                .count();
            result.push(json!({"workspace_id":workspace.id,"name":workspace.name,"desktop_count":ids.len(),"window_count":window_count,"updated_at":workspace.updated_at}));
        }
        Ok(json!(result))
    }
}

fn layout_snapshot_db_error(error: rusqlite::Error) -> CoreError {
    errors::SERVER_LAYOUT_SNAPSHOT_READ_FAILED().and_details(vec![error.to_string()])
}

fn layout_report_list_db_error(error: rusqlite::Error) -> CoreError {
    let detail = error.to_string();
    let is_json_error = matches!(
        &error,
        rusqlite::Error::FromSqlConversionFailure(_, _, source)
            if source.as_ref().downcast_ref::<serde_json::Error>().is_some()
    );
    if is_json_error {
        errors::SERVER_LAYOUT_REPORT_LIST_JSON_PARSE_FAILED().and_details(vec![detail])
    } else {
        errors::SERVER_LAYOUT_REPORT_LIST_FAILED().and_details(vec![detail])
    }
}

#[cfg(test)]
mod error_detail_tests {
    use super::*;

    #[test]
    fn layout_snapshot_database_error_is_preserved_in_details() {
        let error = rusqlite::Error::InvalidQuery;
        let original = error.to_string();
        assert_eq!(layout_snapshot_db_error(error).details, vec![original]);
    }

    #[test]
    fn layout_report_list_json_failure_has_a_distinct_code_and_original_detail() {
        let json_error = serde_json::from_str::<DeviceLayout>("{").unwrap_err();
        let sqlite_error = rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(json_error),
        );
        let original = sqlite_error.to_string();

        let error = layout_report_list_db_error(sqlite_error);

        assert_eq!(
            error.id.as_deref(),
            Some("SERVER_LAYOUT_REPORT_LIST_JSON_PARSE_FAILED")
        );
        assert_eq!(error.details, vec![original]);
    }
}
