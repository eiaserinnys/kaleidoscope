use super::publish_transaction::{publish_database_error, publish_transaction, published_app};
use super::*;
use kaleidoscope_contract::AppWindow;

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
        self.publish_with_guard(
            definition_json,
            created_by,
            open,
            workspace_id,
            preferred_device,
            asset_uploads,
            None,
        )
    }

    pub(super) fn publish_install(
        &self,
        definition_json: &str,
        created_by: &str,
        asset_uploads: &[kaleidoscope_contract::assets::AssetUpload],
        guard: super::registry_install::InstallGuard,
    ) -> Result<(RegistryApp, bool, Option<OpenTarget>), CoreError> {
        self.publish_with_guard(
            definition_json,
            created_by,
            false,
            None,
            None,
            asset_uploads,
            Some(guard),
        )
    }

    fn publish_with_guard(
        &self,
        definition_json: &str,
        created_by: &str,
        open: bool,
        workspace_id: Option<String>,
        preferred_device: Option<&str>,
        asset_uploads: &[kaleidoscope_contract::assets::AssetUpload],
        guard: Option<super::registry_install::InstallGuard>,
    ) -> Result<(RegistryApp, bool, Option<OpenTarget>), CoreError> {
        let definition = parse_app_definition(definition_json)?;
        if kaleidoscope_contract::builtin::is_builtin(&definition.id) && guard.is_some() {
            return Err(
                kaleidoscope_contract::errors::REGISTRYINSTALL_ORIGIN_CONFLICT(&definition.id),
            );
        }
        if kaleidoscope_contract::builtin::is_builtin(&definition.id) {
            return Err(
                kaleidoscope_contract::errors::APP_PUBLISH_BUILTIN_APP_FORBIDDEN(&definition.id),
            );
        }
        let now = timestamp();
        let workspace_accessible = match workspace_id.as_deref() {
            Some(id) => self.mcp_owns_workspace(id)?,
            None => true,
        };
        let event_workspace_id = workspace_accessible.then(|| workspace_id.clone()).flatten();
        let account_id = match &guard {
            Some(guard) => guard.account.clone(),
            None => self.mcp_account_id()?,
        };
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
            let tx = db
                .transaction()
                .map_err(|error| publish_database_error(error, &definition.id, guard.is_some()))?;
            let (unchanged, migrated_windows, revived, origin_changed) = publish_transaction(
                &tx,
                &definition,
                asset_uploads,
                &account_id,
                &now,
                created_by,
                guard.as_ref(),
            )?;
            let connections_changed = match guard.as_ref() {
                Some(guard) => super::registry_install::insert_connections(&tx, guard, &definition.id)?,
                None => false,
            };
            let app = published_app(&tx, &definition, guard.is_some())?;
            tx.commit()
                .map_err(|error| publish_database_error(error, &definition.id, guard.is_some()))?;
            (app, unchanged, migrated_windows, revived, origin_changed, connections_changed)
        };
        if result.5 { self.broadcast_connections()?; }
        if !result.1 || result.3 || result.4 {
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
                        ).map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_APP_PUBLISH_DATABASE_FAILED(&result.0.app.id)))?;
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
        let tx = db.transaction().map_err(|error| {
            db_error_with(
                error,
                kaleidoscope_contract::errors::SERVER_APP_OPEN_TARGET_DATABASE_FAILED(),
            )
        })?;
        if let Some(workspace_id) = workspace_id {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2)",
                    params![workspace_id, account_id],
                    |r| r.get(0),
                )
                .map_err(|error| {
                    db_error_with(
                        error,
                        kaleidoscope_contract::errors::SERVER_APP_OPEN_TARGET_DATABASE_FAILED(),
                    )
                })?;
            if !exists {
                tx.commit().map_err(|error| {
                    db_error_with(
                        error,
                        kaleidoscope_contract::errors::SERVER_APP_OPEN_TARGET_DATABASE_FAILED(),
                    )
                })?;
                return Ok(None);
            }
        }
        let candidates = {
            let connected = self.0.connections.lock().map_err(|_| {
                kaleidoscope_contract::errors::SERVER_APP_PUBLISH_CONNECTION_STATE_LOCK_FAILED()
            })?;
            let syncing = self.0.layout_sync_devices.lock().map_err(|_| {
                kaleidoscope_contract::errors::SERVER_APP_PUBLISH_LAYOUT_SYNC_STATE_LOCK_FAILED()
            })?;
            let support = self.0.device_support.lock().map_err(|_| {
                kaleidoscope_contract::errors::SERVER_APP_PUBLISH_DEVICE_SUPPORT_STATE_LOCK_FAILED()
            })?;
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
                if let (Some(workspace_id), None) = (workspace_id, preferred_device) {
                    let active: Option<String> = tx
                        .query_row(
                            "SELECT json_extract(layout, '$.active_workspace_id') FROM device_layouts WHERE device_id=?1",
                            [id],
                            |row| row.get(0),
                        )
                        .optional()
                        .map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_APP_OPEN_TARGET_DATABASE_FAILED()))?
                        .flatten();
                    if active.as_deref() != Some(workspace_id) {
                        continue;
                    }
                }
                let row: Option<(String, Option<String>)> = tx.query_row("SELECT name,last_active_at FROM devices WHERE id=?1 AND account_id=?2 AND revoked_at IS NULL", params![id, account_id], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_APP_OPEN_TARGET_DATABASE_FAILED()))?;
                if let Some((name, active)) = row {
                    values.push((id.clone(), name, active.unwrap_or_default()));
                }
            }
            values
        };
        tx.commit().map_err(|error| {
            db_error_with(
                error,
                kaleidoscope_contract::errors::SERVER_APP_OPEN_TARGET_DATABASE_FAILED(),
            )
        })?;
        let mut candidates = candidates;
        candidates.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
        Ok(candidates
            .into_iter()
            .next()
            .map(|(id, name, _)| OpenTarget { id, name }))
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
