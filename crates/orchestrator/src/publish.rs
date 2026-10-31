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
        self.publish_app_for_device(definition_json, created_by, open, workspace_id, None)
    }

    pub(crate) fn publish_app_for_device(
        &self,
        definition_json: &str,
        created_by: &str,
        open: bool,
        workspace_id: Option<String>,
        preferred_device: Option<&str>,
    ) -> Result<(RegistryApp, bool, Option<OpenTarget>), CoreError> {
        self.publish_app_with_assets_for_device(
            definition_json,
            created_by,
            open,
            workspace_id,
            preferred_device,
            &[],
        )
    }

    pub(crate) fn publish_app_with_assets_for_device(
        &self,
        definition_json: &str,
        created_by: &str,
        open: bool,
        workspace_id: Option<String>,
        preferred_device: Option<&str>,
        asset_uploads: &[kaleidoscope_contract::assets::AssetUpload],
    ) -> Result<(RegistryApp, bool, Option<OpenTarget>), CoreError> {
        let definition = parse_app_definition(definition_json)?;
        if kaleidoscope_contract::builtin::is_builtin(&definition.id) {
            return Err(CoreError::with_details(
                ErrorCode::InvalidAppDefinition,
                vec!["기본 앱은 kaleidoscope 리포의 apps/에서 고치고 쉘 새 판으로 냅니다".into()],
            ));
        }
        let now = timestamp();
        let prepared = asset_uploads
            .iter()
            .map(super::assets::prepare)
            .collect::<Result<Vec<_>, _>>()?;
        let workspace_accessible = match workspace_id.as_deref() {
            Some(id) => self.mcp_owns_workspace(id)?,
            None => true,
        };
        let event_workspace_id = workspace_accessible.then(|| workspace_id.clone()).flatten();
        let account_id = self.mcp_account_id()?;
        let open_target = if open && workspace_accessible {
            self.choose_open_target(
                workspace_id.as_deref(),
                preferred_device,
                &effective_client_requires(&definition),
                &definition.assets,
            )?
        } else {
            None
        };
        let open_requested =
            open && workspace_accessible && (preferred_device.is_none() || open_target.is_some());
        let result = {
            let mut db = self.lock_db()?;
            let tx = db.transaction().map_err(db_error)?;
            for asset in &prepared {
                super::assets::insert(&tx, &account_id, asset)?;
            }
            super::assets::verify_dependencies(&tx, &account_id, &definition.assets)?;
            let current: Option<(u32, String, String, Option<String>)> = tx.query_row(
                "SELECT a.current_version, v.definition, a.created_at, a.deleted_at FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE a.id=?1",
                [&definition.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            ).optional().map_err(db_error)?;
            let revived = current
                .as_ref()
                .is_some_and(|(_, _, _, deleted)| deleted.is_some());
            let mut migrated_windows = Vec::new();
            let (version_num, created_at, unchanged) = if let Some((
                current_version,
                stored,
                created_at,
                _,
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
            if revived {
                tx.execute(
                    "UPDATE apps SET deleted_at=NULL WHERE id=?1",
                    [&definition.id],
                )
                .map_err(db_error)?;
            }
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
            (
                RegistryApp { app, version },
                unchanged,
                migrated_windows,
                revived,
            )
        };
        if !result.1 || result.3 {
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
                if preferred_device.is_some() && !defer_open {
                    self.send_event_with_strict_open_target_for_account(event, target, &account_id);
                } else {
                    self.send_event_with_target_for_account(event, target, &account_id);
                }
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
                let event = DeviceEvent::AppOpen {
                    app_id: result.0.app.id.clone(),
                    workspace_id: event_workspace_id,
                };
                let target = open_target.as_ref().map(|target| target.id.clone());
                if preferred_device.is_some() {
                    self.send_event_with_strict_open_target_for_account(event, target, &account_id);
                } else {
                    self.send_event_with_target_for_account(event, target, &account_id);
                }
            }
        } else if open_requested {
            let event = DeviceEvent::AppOpen {
                app_id: result.0.app.id.clone(),
                workspace_id: event_workspace_id,
            };
            let target = open_target.as_ref().map(|target| target.id.clone());
            if preferred_device.is_some() {
                self.send_event_with_strict_open_target_for_account(event, target, &account_id);
            } else {
                self.send_event_with_target_for_account(event, target, &account_id);
            }
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
            strict_open_target: false,
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
            strict_open_target: false,
            account_id: Some(account_id.to_string()),
        });
    }

    pub(crate) fn send_event_with_strict_open_target_for_account(
        &self,
        event: DeviceEvent,
        open_target: Option<String>,
        account_id: &str,
    ) {
        let _ = self.0.events.send(Broadcast {
            event,
            open_target,
            strict_open_target: true,
            account_id: Some(account_id.to_string()),
        });
    }

    pub(crate) fn send_event_for_account(&self, event: DeviceEvent, account_id: &str) {
        let _ = self.0.events.send(Broadcast {
            event,
            open_target: None,
            strict_open_target: false,
            account_id: Some(account_id.to_string()),
        });
    }

    pub(crate) fn choose_open_target(
        &self,
        workspace_id: Option<&str>,
        preferred_device: Option<&str>,
        requires: &kaleidoscope_contract::Requires,
        assets: &[kaleidoscope_contract::assets::AssetDep],
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
            let support = self
                .0
                .device_support
                .lock()
                .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?;
            let mut values = Vec::new();
            for id in syncing
                .iter()
                .filter(|id| connected.get(*id).copied().unwrap_or(0) > 0)
            {
                if preferred_device.is_some_and(|preferred| preferred != id.as_str()) {
                    continue;
                }
                if !renders_requirements(support.get(id).and_then(Option::as_ref), requires, assets)
                {
                    continue;
                }
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
        assets: &[kaleidoscope_contract::assets::AssetDep],
    ) -> usize {
        self.count_open_targets(target, workspace_id, requires, assets, false)
    }

    pub(crate) fn open_sent_to_strict_target(
        &self,
        target: Option<&OpenTarget>,
        workspace_id: Option<&str>,
        requires: &Requires,
        assets: &[kaleidoscope_contract::assets::AssetDep],
    ) -> usize {
        self.count_open_targets(target, workspace_id, requires, assets, true)
    }

    fn count_open_targets(
        &self,
        target: Option<&OpenTarget>,
        workspace_id: Option<&str>,
        requires: &Requires,
        assets: &[kaleidoscope_contract::assets::AssetDep],
        strict_target: bool,
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
                if !renders_requirements(
                    support.get(*id).and_then(Option::as_ref),
                    requires,
                    assets,
                ) {
                    return false;
                }
                if strict_target {
                    return syncing.contains(*id)
                        && target.is_some_and(|target| target.id.as_str() == id.as_str());
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
