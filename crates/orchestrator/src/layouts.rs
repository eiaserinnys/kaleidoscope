use super::*;
use axum::{extract::rejection::JsonRejection, extract::Extension};
use kaleidoscope_contract::errors;
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
            errors::SERVER_LAYOUT_REPORT_BODY_INVALID(),
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
    headers: axum::http::HeaderMap,
    body: Result<Json<LayoutChanges>, JsonRejection>,
) -> Response {
    let Ok(Json(changes)) = body else {
        return http::error_response(
            StatusCode::BAD_REQUEST,
            errors::SERVER_LAYOUT_CHANGE_BODY_INVALID(),
        );
    };
    if let Err(error) = super::layout_changes::validate_changes_error(&changes) {
        return http::error_response(StatusCode::BAD_REQUEST, error);
    }
    for window in &changes.windows {
        let bytes = match serde_json::to_vec(&window.state) {
            Ok(bytes) => bytes,
            Err(_) => {
                return http::error_response(
                    StatusCode::BAD_REQUEST,
                    errors::SERVER_LAYOUT_CHANGE_STATE_SERIALIZATION_FAILED(),
                )
            }
        };
        if bytes.len() > kaleidoscope_contract::WINDOW_STATE_MAX_BYTES {
            return http::error_response(
                StatusCode::BAD_REQUEST,
                errors::SERVER_LAYOUT_CHANGE_STATE_TOO_LARGE(
                    kaleidoscope_contract::size::format_byte_limit(
                        (kaleidoscope_contract::WINDOW_STATE_MAX_BYTES) as u64,
                    ),
                ),
            );
        }
    }
    match state.apply_layout_changes(Some(&device.0), &changes) {
        Ok((mut reply, changed)) => {
            if !changed.is_empty() {
                if let Ok(account_id) = state.device_account_id(&device.0) {
                    state.send_event_for_account(
                        DeviceEvent::LayoutChanged { changes: changed },
                        &account_id,
                    );
                }
            }
            let version = headers
                .get(registry::REGISTRY_HEADER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            project_layout(
                version,
                &mut reply.desktop_wallpapers,
                &mut reply.deleted_desktop_wallpapers,
                &mut reply.desktop_shortcuts,
                &mut reply.deleted_desktop_shortcuts,
            );
            Json(reply).into_response()
        }
        Err(error) => http::error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

impl AppState {
    pub(super) fn load_account_entities<T: for<'de> Deserialize<'de>>(
        db: &Connection,
        table: &str,
        account_id: &str,
    ) -> Result<Vec<T>, CoreError> {
        let query = match table {
            "workspaces" => "SELECT data FROM workspaces WHERE account_id=?1 ORDER BY created_at,id",
            "desktops" => "SELECT d.data FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE w.account_id=?1 ORDER BY d.created_at,d.id",
            "windows" => "SELECT v.data FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE w.account_id=?1 ORDER BY v.created_at,v.id",
            "desktop_shortcuts" => "SELECT s.data FROM desktop_shortcuts s JOIN desktops d ON d.id=s.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE w.account_id=?1 ORDER BY s.created_at,s.id",
            "desktop_wallpapers" => "SELECT p.data FROM desktop_wallpapers p JOIN desktops d ON d.id=p.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE w.account_id=?1 ORDER BY p.updated_at,p.id",
            _ => return Err(errors::SERVER_LAYOUT_ENTITIES_TABLE_UNSUPPORTED()),
        };
        read_entities(db, query, Some(account_id))
    }

    pub(super) fn reported_window_state(
        &self,
        window_id: &str,
    ) -> Result<Option<std::collections::BTreeMap<String, serde_json::Value>>, CoreError> {
        let account_id = self.mcp_account_id()?;
        for (_, _, _, layout) in self.layouts(&account_id)? {
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
        let legacy_shell = !self
            .0
            .layout_sync_devices
            .lock()
            .map_err(|_| errors::SERVER_LAYOUT_REPORT_DEVICE_TRACKING_READ_FAILED())?
            .contains(device_id);
        let mut db = self
            .lock_db()
            .map_err(|_| errors::SERVER_LAYOUT_REPORT_SAVE_FAILED())?;
        let tx = db.transaction().map_err(layout_report_save_db_error)?;
        let account_id: String = tx
            .query_row(
                "SELECT account_id FROM devices WHERE id=?1 AND revoked_at IS NULL",
                [device_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(layout_report_save_db_error)?
            .ok_or_else(|| errors::SERVER_LAYOUT_REPORT_DEVICE_NOT_FOUND())?;
        let mut safe_layout = layout.clone();
        let owns = |table: &str, id: &str| -> Result<bool, CoreError> {
            let sql = match table {
                "workspace" => "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2)",
                "desktop" => "SELECT EXISTS(SELECT 1 FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=?1 AND w.account_id=?2)",
                "window" => "SELECT EXISTS(SELECT 1 FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE v.id=?1 AND w.account_id=?2)",
                _ => return Err(errors::SERVER_LAYOUT_REPORT_TABLE_UNSUPPORTED()),
            };
            tx.query_row(sql, params![id, account_id], |row| row.get(0))
                .map_err(layout_report_save_db_error)
        };
        let mut workspace_ids = HashSet::new();
        for item in &layout.workspaces {
            let canonical_owner: Option<String> = tx
                .query_row(
                    "SELECT account_id FROM workspaces WHERE id=?1",
                    [&item.id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(layout_report_save_db_error)?;
            let legacy_owner: Option<String> = tx
                .query_row(
                    "SELECT account_id FROM legacy_workspace_owners WHERE workspace_id=?1",
                    [&item.id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(layout_report_save_db_error)?;
            let owned = match (canonical_owner, legacy_owner) {
                (Some(owner), _) => owner == account_id,
                (None, Some(owner)) => owner == account_id,
                (None, None) if legacy_shell => {
                    tx.execute(
                        "INSERT INTO legacy_workspace_owners(workspace_id,account_id) VALUES(?1,?2)",
                        params![item.id, account_id],
                    )
                    .map_err(layout_report_save_db_error)?;
                    true
                }
                (None, None) => false,
            };
            if owned {
                workspace_ids.insert(item.id.clone());
            }
        }
        safe_layout
            .workspaces
            .retain(|item| workspace_ids.contains(&item.id));
        let mut desktop_ids = HashSet::new();
        for item in &layout.desktops {
            if workspace_ids.contains(&item.workspace_id) && owns("desktop", &item.id)? {
                desktop_ids.insert(item.id.clone());
            }
        }
        safe_layout
            .desktops
            .retain(|item| desktop_ids.contains(&item.id));
        let mut window_ids = HashSet::new();
        for item in &layout.windows {
            if desktop_ids.contains(&item.desktop_id) && owns("window", &item.id)? {
                window_ids.insert(item.id.clone());
            }
        }
        safe_layout
            .windows
            .retain(|item| window_ids.contains(&item.id));
        if safe_layout
            .active_workspace_id
            .as_ref()
            .is_some_and(|id| !workspace_ids.contains(id))
        {
            safe_layout.active_workspace_id = None;
        }
        safe_layout
            .active_desktop_ids
            .retain(|workspace_id, desktop_id| {
                workspace_ids.contains(workspace_id) && desktop_ids.contains(desktop_id)
            });
        safe_layout
            .folders
            .retain(|item| window_ids.contains(&item.window_id));
        safe_layout
            .data_errors
            .retain(|item| window_ids.contains(&item.window_id));
        let workspaces = safe_layout
            .workspaces
            .iter()
            .map(|w| w.id.clone())
            .collect();
        let raw = serde_json::to_string(&safe_layout)
            .map_err(|_| errors::SERVER_LAYOUT_REPORT_SERIALIZATION_FAILED())?;
        let now = timestamp();
        let previous: Option<String> = tx
            .query_row(
                "SELECT layout FROM device_layouts WHERE device_id=?1",
                [device_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(layout_report_save_db_error)?;
        // 다른 기기의 변경을 반영한 쉘도 배치를 다시 보고하므로, 보고 자체는 활동이 아니다. 그 기기만의 것
        // (지금 보는 워크스페이스와 데스크톱, 고른 폴더)이 바뀌었을 때만 마지막 활동으로 친다.
        let active = previous
            .and_then(|raw| serde_json::from_str::<DeviceLayout>(&raw).ok())
            .map_or(true, |previous| {
                previous.active_workspace_id != safe_layout.active_workspace_id
                    || previous.active_desktop_ids != safe_layout.active_desktop_ids
                    || previous.folders != safe_layout.folders
            });
        tx.execute(
            "INSERT INTO device_layouts(device_id,layout,reported_at) VALUES(?1,?2,?3) ON CONFLICT(device_id) DO UPDATE SET layout=excluded.layout,reported_at=excluded.reported_at",
            params![device_id, raw, now],
        ).map_err(layout_report_save_db_error)?;
        if active {
            tx.execute(
                "UPDATE devices SET last_active_at=?2 WHERE id=?1 AND revoked_at IS NULL",
                params![device_id, now],
            )
            .map_err(layout_report_save_db_error)?;
        }
        tx.commit().map_err(layout_report_save_db_error)?;
        drop(db);
        self.0
            .device_workspaces
            .lock()
            .unwrap()
            .insert(device_id.into(), workspaces);
        Ok(())
    }

    pub(super) fn refresh_device_workspaces(&self) -> Result<(), CoreError> {
        let db = self
            .lock_db()
            .map_err(|_| errors::SERVER_LAYOUT_INDEX_REFRESH_FAILED())?;
        let workspaces = load_device_workspaces(&db)
            .map_err(|_| errors::SERVER_LAYOUT_INDEX_REFRESH_FAILED())?;
        *self
            .0
            .device_workspaces
            .lock()
            .map_err(|_| errors::SERVER_LAYOUT_INDEX_REFRESH_FAILED())? = workspaces;
        Ok(())
    }

    pub(super) fn connected_count_for(&self, workspace_id: Option<&str>) -> usize {
        let owned_devices = self.mcp_device_ids();
        let connected = self.0.connections.lock().unwrap();
        let workspaces = self.0.device_workspaces.lock().unwrap();
        connected
            .keys()
            .filter(|device| {
                owned_devices.contains(*device)
                    && workspace_id.is_none_or(|workspace_id| {
                        workspaces
                            .get(*device)
                            .is_some_and(|ids| ids.contains(workspace_id))
                    })
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
                strict_open_target: false,
                account_id: None,
            },
        )
    }

    pub(super) fn event_for_broadcast(
        &self,
        device_id: &str,
        broadcast: Broadcast,
    ) -> Option<DeviceEvent> {
        let mut event = broadcast.event;
        if matches!(event, DeviceEvent::WindowControl { .. }) {
            let supported = self
                .0
                .window_control_versions
                .lock()
                .ok()
                .and_then(|versions| {
                    versions
                        .get(device_id)
                        .map(|versions| versions.iter().any(|v| *v >= 12))
                })
                .unwrap_or(false);
            if !broadcast.strict_open_target
                || broadcast.open_target.as_deref() != Some(device_id)
                || !supported
            {
                return None;
            }
        }
        if let Some(account_id) = broadcast.account_id.as_deref() {
            if self.device_account_id(device_id).ok().as_deref() != Some(account_id) {
                event = match event {
                    DeviceEvent::AppPublished { app, .. } => DeviceEvent::AppPublished {
                        app,
                        open: false,
                        workspace_id: None,
                    },
                    DeviceEvent::AppOpen { .. } => return None,
                    _ => return None,
                };
            }
        }
        let syncing = self
            .0
            .layout_sync_devices
            .lock()
            .ok()
            .is_some_and(|devices| devices.contains(device_id));
        if matches!(
            event,
            DeviceEvent::LayoutSnapshot { .. } | DeviceEvent::LayoutChanged { .. }
        ) && !syncing
        {
            return None;
        }
        event = match event {
            DeviceEvent::AppValueChanged {
                app_id,
                bucket_id,
                item,
            } => {
                let supports_app_values = self
                    .0
                    .app_value_devices
                    .lock()
                    .ok()
                    .is_some_and(|devices| devices.contains(device_id));
                if supports_app_values {
                    DeviceEvent::AppValueChanged {
                        app_id,
                        bucket_id,
                        item,
                    }
                } else {
                    let supports_storage = self
                        .0
                        .storage_devices
                        .lock()
                        .ok()
                        .is_some_and(|devices| devices.contains(device_id));
                    if !supports_storage {
                        return None;
                    }
                    let db = self.lock_db().ok()?;
                    let definition = super::builtin_specs::load_definition(&db, &app_id).ok()??;
                    let entry = definition.storage?.entries.into_iter().find(|entry| {
                        kaleidoscope_contract::app_storage::storage_key_matches(
                            &entry.key, &item.key,
                        ) || kaleidoscope_contract::app_storage::storage_entry_key_matches(
                            entry, &item.key,
                        )
                    })?;
                    if entry.collection
                        && !self
                            .0
                            .collection_devices
                            .lock()
                            .ok()
                            .is_some_and(|devices| devices.contains(device_id))
                    {
                        return None;
                    }
                    DeviceEvent::StorageChanged {
                        app_id,
                        changed: kaleidoscope_contract::app_storage::StorageChanged {
                            bucket_id,
                            item: kaleidoscope_contract::app_storage::StorageItemMeta {
                                entry_id: entry.id,
                                key: item.key,
                                kind: item.kind,
                                revision: item.revision.clone(),
                                exists: item.revision.is_some(),
                            },
                        },
                    }
                }
            }
            other => other,
        };
        if !self.should_deliver_storage_event(device_id, &event) {
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
        let mut event = match event {
            DeviceEvent::ConnectionsSnapshot { .. } => DeviceEvent::ConnectionsSnapshot {
                connections: self.connection_snapshot_for_device(device_id).ok()?,
            },
            other => other,
        };
        if let DeviceEvent::AppPublished { app, .. } = &event {
            if !self.device_can_render_app(device_id, &app.version.definition) {
                return None;
            }
        }
        if let DeviceEvent::AppPublished { app, .. } = &mut event {
            let support = self
                .0
                .device_support
                .lock()
                .ok()
                .and_then(|devices| devices.get(device_id).cloned())
                .flatten();
            *app = app_for_client(app.clone(), support.as_ref());
        }
        if let DeviceEvent::AppOpen { app_id, .. } = &event {
            if let Some(identity) = kaleidoscope_contract::builtin::builtin_identity(app_id) {
                let support = self
                    .0
                    .device_support
                    .lock()
                    .ok()
                    .and_then(|devices| devices.get(device_id).cloned())
                    .flatten();
                let requires = Requires {
                    blocks: identity.blocks,
                    modules: identity
                        .modules
                        .iter()
                        .map(|(name, version)| ((*name).to_string(), *version))
                        .collect(),
                };
                let assets = identity
                    .assets
                    .iter()
                    .map(|(id, version)| kaleidoscope_contract::assets::AssetDep {
                        id: (*id).into(),
                        version: *version,
                    })
                    .collect::<Vec<_>>();
                let compatible = renders_requirements(support.as_ref(), &requires, &assets);
                if !compatible {
                    return None;
                }
            }
            if let Ok(Some(app)) = self.app(app_id, None) {
                if !self.device_can_render_app(device_id, &app.version.definition) {
                    return None;
                }
            }
        }
        if let DeviceEvent::AppOpen {
            workspace_id: Some(workspace_id),
            ..
        } = &event
        {
            if !self.device_owns_workspace(device_id, workspace_id).ok()? {
                return None;
            }
        }
        if let Some(target) = broadcast.open_target {
            match event.clone() {
                DeviceEvent::AppPublished {
                    app,
                    open: true,
                    workspace_id,
                } if broadcast.strict_open_target => {
                    return Some(if device_id == target {
                        DeviceEvent::AppPublished {
                            app,
                            open: true,
                            workspace_id,
                        }
                    } else {
                        DeviceEvent::AppPublished {
                            app,
                            open: false,
                            workspace_id: None,
                        }
                    });
                }
                DeviceEvent::AppOpen {
                    app_id,
                    workspace_id,
                } if broadcast.strict_open_target => {
                    return (device_id == target).then_some(DeviceEvent::AppOpen {
                        app_id,
                        workspace_id,
                    });
                }
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
            other => Some(other),
        }
    }
}

/// 연결의 레지스트리 판에 맞춰 배치에 실린 새 엔티티를 투영한다. 판별 분기는 이 함수 하나에만 둔다.
/// 판 15 연결은 바로가기만 받고, 판 14 이하는 둘 다 받지 않는다.
pub(super) fn project_layout(
    version: u32,
    wallpapers: &mut Vec<kaleidoscope_contract::DesktopWallpaper>,
    deleted_wallpapers: &mut Vec<String>,
    shortcuts: &mut Vec<kaleidoscope_contract::DesktopShortcut>,
    deleted_shortcuts: &mut Vec<String>,
) {
    if version < registry::WALLPAPER_REGISTRY_VERSION {
        wallpapers.clear();
        deleted_wallpapers.clear();
    }
    if version < registry::DESKTOP_SHORTCUTS_REGISTRY_VERSION {
        shortcuts.clear();
        deleted_shortcuts.clear();
    }
}

fn read_entities<T: for<'de> Deserialize<'de>>(
    db: &Connection,
    query: &str,
    account_id: Option<&str>,
) -> Result<Vec<T>, CoreError> {
    let mut statement = db.prepare(query).map_err(layout_entities_read_db_error)?;
    let rows = match account_id {
        Some(account_id) => statement
            .query_map([account_id], |row| row.get::<_, String>(0))
            .map_err(layout_entities_read_db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(layout_entities_read_db_error)?,
        None => statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(layout_entities_read_db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(layout_entities_read_db_error)?,
    };
    rows.into_iter()
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|error| {
                errors::SERVER_LAYOUT_ENTITIES_JSON_PARSE_FAILED()
                    .and_details(vec![error.to_string()])
            })
        })
        .collect()
}

fn layout_report_save_db_error(error: rusqlite::Error) -> CoreError {
    errors::SERVER_LAYOUT_REPORT_SAVE_FAILED().and_details(vec![error.to_string()])
}

fn layout_entities_read_db_error(error: rusqlite::Error) -> CoreError {
    errors::SERVER_LAYOUT_ENTITIES_READ_FAILED().and_details(vec![error.to_string()])
}

#[cfg(test)]
mod error_detail_tests {
    use super::*;

    #[test]
    fn entity_sql_and_json_failures_have_distinct_codes_and_keep_details() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE workspaces(data TEXT NOT NULL); INSERT INTO workspaces VALUES ('not json');",
        )
        .unwrap();

        let json_error = read_entities::<kaleidoscope_contract::Workspace>(
            &db,
            "SELECT data FROM workspaces",
            None,
        )
        .unwrap_err();
        assert_eq!(
            json_error.id.as_deref(),
            Some("SERVER_LAYOUT_ENTITIES_JSON_PARSE_FAILED")
        );
        assert!(!json_error.details.is_empty());

        let sql_error = read_entities::<kaleidoscope_contract::Workspace>(
            &db,
            "SELECT data FROM missing_table",
            None,
        )
        .unwrap_err();
        assert_eq!(
            sql_error.id.as_deref(),
            Some("SERVER_LAYOUT_ENTITIES_READ_FAILED")
        );
        assert!(!sql_error.details.is_empty());
    }

    #[test]
    fn report_save_and_entity_sql_helpers_keep_the_database_error() {
        let report_error = rusqlite::Error::InvalidQuery;
        let report_detail = report_error.to_string();
        assert_eq!(
            layout_report_save_db_error(report_error).details,
            vec![report_detail]
        );

        let entity_error = rusqlite::Error::InvalidQuery;
        let entity_detail = entity_error.to_string();
        assert_eq!(
            layout_entities_read_db_error(entity_error).details,
            vec![entity_detail]
        );
    }
}
