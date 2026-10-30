use super::*;
use axum::{extract::rejection::JsonRejection, extract::Extension};
use kaleidoscope_contract::registry::{DeviceLayout, LayoutChanges};

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

pub(super) async fn post_layout_changes(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    body: Result<Json<LayoutChanges>, JsonRejection>,
) -> Response {
    let Ok(Json(changes)) = body else {
        return http::error_response(
            StatusCode::BAD_REQUEST,
            CoreError::new(ErrorCode::InvalidRequest),
        );
    };
    if changes.windows.iter().any(|window| {
        serde_json::to_vec(&window.state).map_or(true, |bytes| {
            bytes.len() > kaleidoscope_contract::WINDOW_STATE_MAX_BYTES
        })
    }) {
        return http::error_response(
            StatusCode::BAD_REQUEST,
            CoreError::new(ErrorCode::InvalidRequest),
        );
    }
    match state.apply_layout_changes(Some(&device.0), &changes) {
        Ok((reply, changed)) => {
            if !changed.is_empty() {
                state.send_event(DeviceEvent::LayoutChanged { changes: changed });
            }
            Json(reply).into_response()
        }
        Err(error) => http::error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

impl AppState {
    pub(super) fn reported_window_state(
        &self,
        window_id: &str,
    ) -> Result<Option<std::collections::BTreeMap<String, serde_json::Value>>, CoreError> {
        for (_, _, _, layout) in self.layouts()? {
            if let Some(window) = layout
                .windows
                .into_iter()
                .find(|window| window.id == window_id)
            {
                return Ok(Some(window.state));
            }
        }
        Ok(None)
    }

    pub(super) fn save_layout(
        &self,
        device_id: &str,
        layout: &DeviceLayout,
    ) -> Result<(), CoreError> {
        let workspaces = layout.workspaces.iter().map(|w| w.id.clone()).collect();
        let raw = serde_json::to_string(layout)
            .map_err(|_| server_error("배치를 저장할 수 없습니다."))?;
        let now = timestamp();
        let db = self.lock_db()?;
        let previous: Option<String> = db
            .query_row(
                "SELECT layout FROM device_layouts WHERE device_id=?1",
                [device_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        // 다른 기기의 변경을 반영한 쉘도 배치를 다시 보고하므로, 보고 자체는 활동이 아니다. 그 기기만의 것
        // (지금 보는 워크스페이스와 데스크톱, 고른 폴더)이 바뀌었을 때만 마지막 활동으로 친다.
        let active = previous
            .and_then(|raw| serde_json::from_str::<DeviceLayout>(&raw).ok())
            .map_or(true, |previous| {
                previous.active_workspace_id != layout.active_workspace_id
                    || previous.active_desktop_ids != layout.active_desktop_ids
                    || previous.folders != layout.folders
            });
        db.execute(
            "INSERT INTO device_layouts(device_id,layout,reported_at) VALUES(?1,?2,?3) ON CONFLICT(device_id) DO UPDATE SET layout=excluded.layout,reported_at=excluded.reported_at",
            params![device_id, raw, now],
        ).map_err(db_error)?;
        if active {
            db.execute(
                "UPDATE devices SET last_active_at=?2 WHERE id=?1 AND revoked_at IS NULL",
                params![device_id, now],
            )
            .map_err(db_error)?;
        }
        self.0
            .device_workspaces
            .lock()
            .unwrap()
            .insert(device_id.into(), workspaces);
        Ok(())
    }

    pub(super) fn refresh_device_workspaces(&self) -> Result<(), CoreError> {
        let db = self.lock_db()?;
        let workspaces = load_device_workspaces(&db).map_err(db_error)?;
        *self
            .0
            .device_workspaces
            .lock()
            .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))? = workspaces;
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

    #[cfg(test)]
    pub(super) fn event_for_device(
        &self,
        device_id: &str,
        event: DeviceEvent,
    ) -> Option<DeviceEvent> {
        self.event_for_broadcast(
            device_id,
            Broadcast {
                event,
                open_target: None,
            },
        )
    }

    pub(super) fn event_for_broadcast(
        &self,
        device_id: &str,
        broadcast: Broadcast,
    ) -> Option<DeviceEvent> {
        let syncing = self
            .0
            .layout_sync_devices
            .lock()
            .ok()
            .is_some_and(|devices| devices.contains(device_id));
        let event = broadcast.event;
        if matches!(
            event,
            DeviceEvent::LayoutSnapshot { .. } | DeviceEvent::LayoutChanged { .. }
        ) && !syncing
        {
            return None;
        }
        if matches!(event, DeviceEvent::ConnectionsSnapshot { .. }) {
            let supports_connections = self
                .0
                .device_support
                .lock()
                .ok()
                .and_then(|devices| devices.get(device_id).cloned())
                .flatten()
                .is_some_and(|supported| {
                    supported
                        .modules
                        .get("connection")
                        .is_some_and(|version| *version >= 1)
                });
            if !supports_connections {
                return None;
            }
        }
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
        if let Some(target) = broadcast.open_target {
            match event.clone() {
                DeviceEvent::AppPublished {
                    app,
                    open: true,
                    workspace_id,
                } if syncing => {
                    return if device_id == target {
                        Some(DeviceEvent::AppPublished {
                            app,
                            open: true,
                            workspace_id,
                        })
                    } else {
                        Some(DeviceEvent::AppPublished {
                            app,
                            open: false,
                            workspace_id: None,
                        })
                    };
                }
                DeviceEvent::AppOpen {
                    app_id,
                    workspace_id,
                } if syncing => {
                    return (device_id == target).then_some(DeviceEvent::AppOpen {
                        app_id,
                        workspace_id,
                    });
                }
                _ => {}
            }
        } else if syncing {
            match event.clone() {
                DeviceEvent::AppPublished {
                    app, open: true, ..
                } => {
                    return Some(DeviceEvent::AppPublished {
                        app,
                        open: false,
                        workspace_id: None,
                    })
                }
                DeviceEvent::AppOpen { .. } => return None,
                _ => {}
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
}

pub(super) fn load_entities<T: for<'de> Deserialize<'de>>(
    db: &Connection,
    table: &str,
) -> Result<Vec<T>, CoreError> {
    let query = match table {
        "workspaces" => "SELECT data FROM workspaces ORDER BY created_at,id",
        "desktops" => "SELECT data FROM desktops ORDER BY created_at,id",
        "windows" => "SELECT data FROM windows ORDER BY created_at,id",
        _ => return Err(server_error("배치 표를 읽을 수 없습니다.")),
    };
    let mut statement = db.prepare(query).map_err(db_error)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    rows.into_iter()
        .map(|raw| {
            serde_json::from_str(&raw)
                .map_err(|error| server_error(&format!("배치 정본을 읽을 수 없습니다: {error}")))
        })
        .collect()
}
