use super::*;
use axum::{extract::Extension, extract::rejection::JsonRejection};
use kaleidoscope_contract::registry::DeviceLayout;

pub(super) fn load_device_workspaces(
    db: &Connection,
) -> rusqlite::Result<HashMap<String, HashSet<String>>> {
    let mut stmt = db.prepare("SELECT device_id,layout FROM device_layouts")?;
    let rows = stmt.query_map([], |row| {
        let raw: String = row.get(1)?;
        let layout: DeviceLayout = serde_json::from_str(&raw).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(e))
        })?;
        Ok((
            row.get(0)?,
            layout.workspaces.into_iter().map(|w| w.id).collect(),
        ))
    })?;
    rows.collect()
}

pub(super) async fn put_layout(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    body: Result<Json<DeviceLayout>, JsonRejection>,
) -> Response {
    let Ok(Json(layout)) = body else {
        return http::error_response(
            StatusCode::BAD_REQUEST,
            CoreError::new(ErrorCode::InvalidRequest),
        );
    };
    match state.save_layout(&device.0, &layout) {
        Ok(()) => Json(json!({})).into_response(),
        Err(error) => http::error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

impl AppState {
    pub(super) fn save_layout(
        &self,
        device_id: &str,
        layout: &DeviceLayout,
    ) -> Result<(), CoreError> {
        let workspaces = layout.workspaces.iter().map(|w| w.id.clone()).collect();
        let layout = serde_json::to_string(layout)
            .map_err(|_| server_error("배치를 저장할 수 없습니다."))?;
        let db = self.lock_db()?;
        db.execute(
            "INSERT INTO device_layouts(device_id,layout,reported_at) VALUES(?1,?2,?3) ON CONFLICT(device_id) DO UPDATE SET layout=excluded.layout,reported_at=excluded.reported_at",
            params![device_id, layout, timestamp()],
        ).map_err(db_error)?;
        self.0
            .device_workspaces
            .lock()
            .unwrap()
            .insert(device_id.into(), workspaces);
        Ok(())
    }

    pub(super) fn connected_count_for(&self, workspace_id: Option<&str>) -> usize {
        let Some(workspace_id) = workspace_id else {
            return self.connected_count();
        };
        let connected = self.0.connections.lock().unwrap();
        let workspaces = self.0.device_workspaces.lock().unwrap();
        connected
            .keys()
            .filter(|device| {
                workspaces
                    .get(*device)
                    .is_some_and(|ids| ids.contains(workspace_id))
            })
            .count()
    }

    pub(super) fn event_for_device(
        &self,
        device_id: &str,
        event: DeviceEvent,
    ) -> Option<DeviceEvent> {
        if let DeviceEvent::AppPublished { app, .. } = &event {
            if !self.device_can_render(device_id, &app.version.definition.requires) {
                return None;
            }
        }
        if let DeviceEvent::AppOpen { app_id, .. } = &event {
            if let Ok(Some(app)) = self.app(app_id, None) {
                if !self.device_can_render(device_id, &app.version.definition.requires) {
                    return None;
                }
            }
        }
        let workspaces = self.0.device_workspaces.lock().unwrap();
        let has = |id: &str| {
            workspaces
                .get(device_id)
                .is_some_and(|ids| ids.contains(id))
        };
        match event {
            DeviceEvent::AppPublished {
                app,
                open: true,
                workspace_id: Some(id),
            } if !has(&id) => Some(DeviceEvent::AppPublished {
                app,
                open: false,
                workspace_id: None,
            }),
            DeviceEvent::AppOpen {
                workspace_id: Some(ref id),
                ..
            } if !has(id) => None,
            DeviceEvent::AgentUpdate {
                ref workspace_id, ..
            } if !has(workspace_id) => None,
            other => Some(other),
        }
    }

    fn layouts(&self) -> Result<Vec<(String, String, String, DeviceLayout)>, CoreError> {
        let db = self.lock_db()?;
        let mut stmt = db.prepare("SELECT d.id,d.name,l.reported_at,l.layout FROM device_layouts l JOIN devices d ON d.id=l.device_id ORDER BY l.reported_at DESC,d.id").map_err(db_error)?;
        let rows = stmt
            .query_map([], |row| {
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
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }

    pub(super) fn get_workspace(&self, id: &str) -> Result<Option<Value>, CoreError> {
        for (device_id, device_name, reported_at, layout) in self.layouts()? {
            let Some(workspace) = layout.workspaces.iter().find(|w| w.id == id) else {
                continue;
            };
            let active_desktop = layout.active_desktop_ids.get(id);
            let mut desktops: Vec<_> = layout
                .desktops
                .iter()
                .filter(|d| d.workspace_id == id)
                .collect();
            desktops.sort_by_key(|d| d.position);
            let apps = self.current_apps()?;
            let desktops: Vec<Value> = desktops.into_iter().map(|desktop| {
                let mut windows: Vec<_> = layout.windows.iter().filter(|w| w.desktop_id == desktop.id).collect();
                windows.sort_by_key(|w| std::cmp::Reverse(w.z));
                let windows: Vec<Value> = windows.into_iter().map(|window| {
                    let name = apps.iter().find(|a| a.app.id == window.app_id).map(|a| a.app.name.as_str()).unwrap_or(&window.app_id);
                    let folders: std::collections::BTreeMap<_, _> = layout.folders.iter().filter(|f| f.window_id == window.id).map(|f| (f.permission.clone(), f.root_name.clone())).collect();
                    json!({"window_id":window.id,"app_id":window.app_id,"app_name":name,"app_version":window.app_version,"rect":window.rect,"z":window.z,"state":window.state,"folders":folders})
                }).collect();
                json!({"desktop_id":desktop.id,"name":desktop.name,"position":desktop.position,"active":active_desktop == Some(&desktop.id),"windows":windows})
            }).collect();
            let connected = self
                .0
                .connections
                .lock()
                .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?
                .get(&device_id)
                .copied()
                .unwrap_or(0)
                > 0;
            let agent = self
                .agent_row(id)?
                .map(|a| json!({"session_id":a.session_id,"model_preset":a.model_preset}));
            return Ok(Some(
                json!({"workspace_id":id,"name":workspace.name,"device":{"id":device_id,"name":device_name,"connected":connected},"reported_at":reported_at,"active":layout.active_workspace_id.as_deref()==Some(id),"active_desktop_id":active_desktop,"desktops":desktops,"agent":agent}),
            ));
        }
        Ok(None)
    }

    pub(super) fn list_workspaces(&self) -> Result<Value, CoreError> {
        let mut result = Vec::new();
        for (_, device_name, reported_at, layout) in self.layouts()? {
            for workspace in &layout.workspaces {
                let desktops: Vec<_> = layout
                    .desktops
                    .iter()
                    .filter(|d| d.workspace_id == workspace.id)
                    .collect();
                let window_count = layout
                    .windows
                    .iter()
                    .filter(|w| desktops.iter().any(|d| d.id == w.desktop_id))
                    .count();
                result.push(json!({"workspace_id":workspace.id,"name":workspace.name,"device_name":device_name,"desktop_count":desktops.len(),"window_count":window_count,"has_agent":self.agent_row(&workspace.id)?.is_some(),"reported_at":reported_at}));
            }
        }
        Ok(json!(result))
    }
}
