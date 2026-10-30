use super::*;
use kaleidoscope_contract::{migrate_window_state, AppWindow};

#[derive(Clone, Debug)]
pub(crate) struct OpenTarget {
    pub id: String,
    pub name: String,
}

impl AppState {
    pub fn publish_app(
        &self,
        definition_json: &str,
        created_by: &str,
        open: bool,
        workspace_id: Option<String>,
    ) -> Result<(RegistryApp, bool), CoreError> {
        self.publish_app_with_target(definition_json, created_by, open, workspace_id)
            .map(|(app, unchanged, _)| (app, unchanged))
    }

    pub(crate) fn publish_app_with_target(
        &self,
        definition_json: &str,
        created_by: &str,
        open: bool,
        workspace_id: Option<String>,
    ) -> Result<(RegistryApp, bool, Option<OpenTarget>), CoreError> {
        let definition = parse_app_definition(definition_json)?;
        let now = timestamp();
        let workspace_accessible = match workspace_id.as_deref() {
            Some(id) => self.mcp_owns_workspace(id)?,
            None => true,
        };
        let event_workspace_id = workspace_accessible.then(|| workspace_id.clone()).flatten();
        let open_requested = open && workspace_accessible;
        let account_id = self.mcp_account_id()?;
        let open_target = if open_requested {
            self.choose_open_target(workspace_id.as_deref())?
        } else {
            None
        };
        let result = {
            let mut db = self.lock_db()?;
            let tx = db.transaction().map_err(db_error)?;
            let current: Option<(u32, String, String)> = tx.query_row(
                "SELECT a.current_version, v.definition, a.created_at FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE a.id=?1",
                [&definition.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            ).optional().map_err(db_error)?;
            let mut migrated_windows = Vec::new();
            let (version_num, created_at, unchanged) = if let Some((
                current_version,
                stored,
                created_at,
            )) = current
            {
                let previous: AppDefinition = serde_json::from_str(&stored).map_err(|e| {
                    server_error(&format!("저장된 앱 정의를 읽을 수 없습니다: {e}"))
                })?;
                if previous == definition {
                    (current_version, created_at, true)
                } else {
                    super::app_storage::validate_storage_publish(
                        &tx,
                        &definition.id,
                        &previous,
                        &definition,
                    )?;
                    let version = current_version + 1;
                    save_version(&tx, &definition, version, &now, created_by).map_err(db_error)?;
                    tx.execute(
                        "UPDATE apps SET name=?2,current_version=?3,updated_at=?4 WHERE id=?1",
                        params![definition.id, definition.name, version, now],
                    )
                    .map_err(db_error)?;
                    migrated_windows = move_app_windows(&tx, &definition, version, &now)?;
                    (version, created_at, false)
                }
            } else {
                tx.execute("INSERT INTO apps(id,name,current_version,created_at,updated_at) VALUES(?1,?2,1,?3,?3)", params![definition.id, definition.name, now]).map_err(db_error)?;
                save_version(&tx, &definition, 1, &now, created_by).map_err(db_error)?;
                (1, now.clone(), false)
            };
            tx.commit().map_err(db_error)?;
            drop(db);
            let app = App {
                id: definition.id.clone(),
                name: definition.name.clone(),
                current_version: version_num,
                created_at,
                updated_at: if unchanged {
                    self.app_updated_at(&definition.id)?
                } else {
                    now.clone()
                },
            };
            let version = AppVersion {
                app_id: definition.id.clone(),
                version: version_num,
                definition,
                created_at: if unchanged {
                    self.version_created_at(&app.id, version_num)?
                } else {
                    now
                },
            };
            (RegistryApp { app, version }, unchanged, migrated_windows)
        };
        if !result.1 {
            let defer_open = open_requested && !result.2.is_empty();
            let event = DeviceEvent::AppPublished {
                app: result.0.clone(),
                open: open_requested && !defer_open,
                workspace_id: if defer_open {
                    None
                } else {
                    event_workspace_id.clone()
                },
            };
            let target = if defer_open {
                None
            } else {
                open_target.as_ref().map(|target| target.id.clone())
            };
            if open_requested {
                self.send_event_with_target_for_account(event, target, &account_id);
            } else {
                self.send_event_with_target(event, target);
            }
            if !result.2.is_empty() {
                let mut accounts = HashMap::<String, Vec<AppWindow>>::new();
                {
                    let db = self.lock_db()?;
                    for window in &result.2 {
                        let account_id: String = db.query_row(
                            "SELECT w.account_id FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE v.id=?1",
                            [&window.id],
                            |row| row.get(0),
                        ).map_err(db_error)?;
                        accounts.entry(account_id).or_default().push(window.clone());
                    }
                }
                for (account_id, windows) in accounts {
                    self.send_event_for_account(
                        DeviceEvent::LayoutChanged {
                            changes: registry::LayoutChanges {
                                windows,
                                ..Default::default()
                            },
                        },
                        &account_id,
                    );
                }
            }
            if defer_open {
                self.send_event_with_target_for_account(
                    DeviceEvent::AppOpen {
                        app_id: result.0.app.id.clone(),
                        workspace_id: event_workspace_id,
                    },
                    open_target.as_ref().map(|target| target.id.clone()),
                    &account_id,
                );
            }
        } else if open_requested {
            self.send_event_with_target_for_account(
                DeviceEvent::AppOpen {
                    app_id: result.0.app.id.clone(),
                    workspace_id: event_workspace_id,
                },
                open_target.as_ref().map(|target| target.id.clone()),
                &account_id,
            );
        }
        Ok((result.0, result.1, open_target))
    }

    pub(crate) fn send_event(&self, event: DeviceEvent) {
        self.send_event_with_target(event, None);
    }

    pub(crate) fn send_event_with_target(&self, event: DeviceEvent, open_target: Option<String>) {
        let _ = self.0.events.send(Broadcast {
            event,
            open_target,
            account_id: None,
        });
    }

    pub(crate) fn send_event_with_target_for_account(
        &self,
        event: DeviceEvent,
        open_target: Option<String>,
        account_id: &str,
    ) {
        let _ = self.0.events.send(Broadcast {
            event,
            open_target,
            account_id: Some(account_id.to_string()),
        });
    }

    pub(crate) fn send_event_for_account(&self, event: DeviceEvent, account_id: &str) {
        let _ = self.0.events.send(Broadcast {
            event,
            open_target: None,
            account_id: Some(account_id.to_string()),
        });
    }

    pub(crate) fn choose_open_target(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<Option<OpenTarget>, CoreError> {
        let account_id = self.mcp_account_id()?;
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(db_error)?;
        if let Some(workspace_id) = workspace_id {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2)",
                    params![workspace_id, account_id],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if !exists {
                tx.commit().map_err(db_error)?;
                return Ok(None);
            }
        }
        let candidates = {
            let connected = self
                .0
                .connections
                .lock()
                .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?;
            let syncing = self
                .0
                .layout_sync_devices
                .lock()
                .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?;
            let mut values = Vec::new();
            for id in syncing
                .iter()
                .filter(|id| connected.get(*id).copied().unwrap_or(0) > 0)
            {
                let row: Option<(String, Option<String>)> = tx.query_row("SELECT name,last_active_at FROM devices WHERE id=?1 AND account_id=?2 AND revoked_at IS NULL", params![id, account_id], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
                if let Some((name, active)) = row {
                    values.push((id.clone(), name, active.unwrap_or_default()));
                }
            }
            values
        };
        tx.commit().map_err(db_error)?;
        let mut candidates = candidates;
        candidates.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
        Ok(candidates
            .into_iter()
            .next()
            .map(|(id, name, _)| OpenTarget { id, name }))
    }

    fn app_updated_at(&self, id: &str) -> Result<String, CoreError> {
        self.lock_db()?
            .query_row("SELECT updated_at FROM apps WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(db_error)
    }
    fn version_created_at(&self, id: &str, version: u32) -> Result<String, CoreError> {
        self.lock_db()?
            .query_row(
                "SELECT created_at FROM app_versions WHERE app_id=?1 AND version=?2",
                params![id, version],
                |r| r.get(0),
            )
            .map_err(db_error)
    }

    pub(crate) fn open_sent_to(
        &self,
        target: Option<&OpenTarget>,
        workspace_id: Option<&str>,
        requires: &Requires,
    ) -> usize {
        let Ok(account_id) = self.mcp_account_id() else {
            return 0;
        };
        let owned_devices: HashSet<String> = self
            .lock_db()
            .ok()
            .and_then(|db| {
                db.prepare("SELECT id FROM devices WHERE account_id=?1")
                    .ok()
                    .and_then(|mut statement| {
                        statement
                            .query_map([&account_id], |row| row.get(0))
                            .ok()
                            .and_then(|rows| rows.collect::<rusqlite::Result<HashSet<_>>>().ok())
                    })
            })
            .unwrap_or_default();
        let Ok(connections) = self.0.connections.lock() else {
            return 0;
        };
        let Ok(support) = self.0.device_support.lock() else {
            return 0;
        };
        let Ok(syncing) = self.0.layout_sync_devices.lock() else {
            return 0;
        };
        let Ok(workspaces) = self.0.device_workspaces.lock() else {
            return 0;
        };
        connections
            .iter()
            .filter(|(_, count)| **count > 0)
            .filter(|(id, _)| {
                if !owned_devices.contains(*id) {
                    return false;
                }
                if !renders_on(support.get(*id).and_then(Option::as_ref), requires) {
                    return false;
                }
                if syncing.contains(*id) {
                    return target.is_some_and(|target| target.id.as_str() == id.as_str());
                }
                workspace_id.is_none_or(|workspace| {
                    workspaces
                        .get(*id)
                        .is_some_and(|ids| ids.contains(workspace))
                })
            })
            .map(|(id, count)| {
                if syncing.contains(id) || workspace_id.is_some() {
                    1
                } else {
                    *count
                }
            })
            .sum()
    }
}

fn move_app_windows(
    tx: &Transaction<'_>,
    definition: &AppDefinition,
    version: u32,
    now: &str,
) -> Result<Vec<AppWindow>, CoreError> {
    let rows = {
        let mut statement = tx
            .prepare("SELECT id,data FROM windows WHERE app_id=?1 ORDER BY created_at,id")
            .map_err(db_error)?;
        let rows = statement
            .query_map([&definition.id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        rows
    };
    let mut moved = Vec::with_capacity(rows.len());
    for (id, raw) in rows {
        let mut window: AppWindow = serde_json::from_str(&raw)
            .map_err(|error| server_error(&format!("저장된 창을 읽을 수 없습니다: {error}")))?;
        window.state = migrate_window_state(definition, &window.state);
        window.app_version = version;
        window.updated_at = now.to_string();
        let data = serde_json::to_string(&window)
            .map_err(|_| server_error("창 상태를 저장할 수 없습니다."))?;
        tx.execute("UPDATE windows SET data=?2 WHERE id=?1", params![id, data])
            .map_err(db_error)?;
        moved.push(window);
    }
    Ok(moved)
}
