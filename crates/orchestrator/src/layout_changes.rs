use super::*;
use kaleidoscope_contract::{
    errors, registry::LayoutChanges, AppWindow, CoreError, Desktop, Workspace,
};

const MAX_ID_LEN: usize = 128;

pub(super) fn validate_changes(changes: &LayoutChanges) -> bool {
    validate_changes_error(changes).is_ok()
}

pub(super) fn validate_changes_error(changes: &LayoutChanges) -> Result<(), CoreError> {
    for desktop in &changes.desktops {
        if let Some(id) = desktop
            .sharing
            .iter()
            .find(|id| id.trim().is_empty() || id.len() > MAX_ID_LEN)
        {
            return Err(errors::SERVER_LAYOUT_CHANGE_SHARING_ID_INVALID()
                .and_details(vec![format!("id: {}", id)]));
        }
        if desktop
            .last_sent_context
            .values()
            .flat_map(|contexts| contexts.values())
            .filter_map(|context| context.text.as_deref())
            .any(|text| text.len() > kaleidoscope_contract::SHARE_TEXT_MAX_BYTES)
        {
            return Err(errors::SERVER_LAYOUT_CHANGE_CONTEXT_TOO_LARGE(
                kaleidoscope_contract::size::format_byte_limit(
                    (kaleidoscope_contract::SHARE_TEXT_MAX_BYTES) as u64,
                ),
            ));
        }
    }
    Ok(())
}

impl AppState {
    pub(super) fn apply_layout_changes(
        &self,
        device_id: Option<&str>,
        changes: &LayoutChanges,
    ) -> Result<(LayoutChanges, LayoutChanges), CoreError> {
        let mut db = self
            .lock_db()
            .map_err(|_| errors::SERVER_LAYOUT_CHANGE_APPLY_FAILED())?;
        let tx = db.transaction().map_err(layout_change_db_error)?;
        let account_id: String = match device_id {
            Some(device_id) => tx
                .query_row(
                    "SELECT account_id FROM devices WHERE id=?1 AND revoked_at IS NULL",
                    [device_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(layout_change_db_error)?
                .ok_or_else(|| errors::SERVER_LAYOUT_CHANGE_DEVICE_NOT_FOUND())?,
            None => tx
                .query_row(
                    "SELECT account_id FROM mcp_principal WHERE id=1",
                    [],
                    |row| row.get(0),
                )
                .map_err(layout_change_db_error)?,
        };
        let mut changed = LayoutChanges::default();
        let mut deleted_storage = Vec::new();
        let mut deleted_values = Vec::new();
        let deleted_workspace_ids: HashSet<_> =
            changes.deleted_workspaces.iter().cloned().collect();
        let deleted_desktop_ids: HashSet<_> = changes.deleted_desktops.iter().cloned().collect();
        let deleted_window_ids: HashSet<_> = changes.deleted_windows.iter().cloned().collect();
        let mut workspace_ids: HashSet<String> = changes
            .workspaces
            .iter()
            .map(|item| item.id.clone())
            .collect();
        workspace_ids.extend(changes.deleted_workspaces.iter().cloned());
        let mut desktop_ids: HashSet<String> = changes
            .desktops
            .iter()
            .map(|item| item.id.clone())
            .collect();
        desktop_ids.extend(changes.deleted_desktops.iter().cloned());
        let mut window_ids: HashSet<String> =
            changes.windows.iter().map(|item| item.id.clone()).collect();
        window_ids.extend(changes.deleted_windows.iter().cloned());

        for workspace in &changes.workspaces {
            if deleted_workspace_ids.contains(&workspace.id) {
                continue;
            }
            let owned_by_another_account: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM legacy_workspace_owners WHERE workspace_id=?1 AND account_id<>?2)",
                    params![workspace.id, account_id],
                    |row| row.get(0),
                )
                .map_err(layout_change_db_error)?;
            if owned_by_another_account {
                continue;
            }
            let data = serde_json::to_string(workspace)
                .map_err(|_| errors::SERVER_LAYOUT_WORKSPACE_SERIALIZATION_FAILED())?;
            let old: Option<String> = tx
                .query_row(
                    "SELECT data FROM workspaces WHERE id=?1 AND account_id=?2",
                    params![workspace.id, account_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(layout_change_db_error)?;
            if old.as_deref() != Some(data.as_str()) {
                let inserted = tx.execute("INSERT INTO workspaces(id,account_id,data,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET data=excluded.data,created_at=excluded.created_at WHERE workspaces.account_id=excluded.account_id", params![workspace.id,account_id,data,workspace.created_at]).map_err(layout_change_db_error)?;
                if inserted > 0 {
                    changed.workspaces.push(workspace.clone());
                }
            }
        }
        for desktop in &changes.desktops {
            if deleted_desktop_ids.contains(&desktop.id) {
                continue;
            }
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2)",
                    params![desktop.workspace_id, account_id],
                    |row| row.get(0),
                )
                .map_err(layout_change_db_error)?;
            if !exists {
                continue;
            }
            let data = serde_json::to_string(desktop)
                .map_err(|_| errors::SERVER_LAYOUT_DESKTOP_SERIALIZATION_FAILED())?;
            let old: Option<String> = tx
                .query_row(
                    "SELECT d.data FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=?1 AND w.account_id=?2",
                    params![desktop.id, account_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(layout_change_db_error)?;
            if old.as_deref() != Some(data.as_str()) {
                let inserted = tx.execute("INSERT INTO desktops(id,workspace_id,data,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,data=excluded.data,created_at=excluded.created_at WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=desktops.workspace_id AND account_id=?5)", params![desktop.id,desktop.workspace_id,data,desktop.created_at,account_id]).map_err(layout_change_db_error)?;
                if inserted > 0 {
                    changed.desktops.push(desktop.clone());
                }
            }
        }
        for window in &changes.windows {
            if deleted_window_ids.contains(&window.id) {
                continue;
            }
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=?1 AND w.account_id=?2)",
                    params![window.desktop_id, account_id],
                    |row| row.get(0),
                )
                .map_err(layout_change_db_error)?;
            if !exists {
                continue;
            }
            let data = serde_json::to_string(window)
                .map_err(|_| errors::SERVER_LAYOUT_WINDOW_SERIALIZATION_FAILED())?;
            let old: Option<String> = tx
                .query_row(
                    "SELECT v.data FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE v.id=?1 AND w.account_id=?2",
                    params![window.id, account_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(layout_change_db_error)?;
            if old.as_deref() != Some(data.as_str()) {
                let inserted = tx.execute("INSERT INTO windows(id,desktop_id,app_id,data,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET desktop_id=excluded.desktop_id,app_id=excluded.app_id,data=excluded.data,created_at=excluded.created_at WHERE EXISTS(SELECT 1 FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=windows.desktop_id AND w.account_id=?6)", params![window.id,window.desktop_id,window.app_id,data,window.created_at,account_id]).map_err(layout_change_db_error)?;
                if inserted > 0 {
                    changed.windows.push(window.clone());
                }
            }
        }

        for id in &changes.deleted_windows {
            if tx
                .execute("DELETE FROM windows WHERE id=?1 AND EXISTS(SELECT 1 FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=windows.desktop_id AND w.account_id=?2)", params![id, account_id])
                .map_err(layout_change_db_error)?
                > 0
            {
                changed.deleted_windows.push(id.clone());
            }
        }
        for id in &changes.deleted_desktops {
            let existed = desktop_exists(&tx, id, &account_id)?;
            let children = child_ids(&tx, "windows", "desktop_id", id, &account_id)?;
            for child in children {
                window_ids.insert(child.clone());
                if tx
                    .execute("DELETE FROM windows WHERE id=?1 AND EXISTS(SELECT 1 FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=windows.desktop_id AND w.account_id=?2)", params![child, account_id])
                    .map_err(layout_change_db_error)?
                    > 0
                {
                    changed.deleted_windows.push(child);
                }
            }
            tx.execute("DELETE FROM desktops WHERE id=?1 AND EXISTS(SELECT 1 FROM workspaces WHERE id=desktops.workspace_id AND account_id=?2)", params![id, account_id])
                .map_err(layout_change_db_error)?;
            if existed {
                changed.deleted_desktops.push(id.clone());
            }
        }
        for id in &changes.deleted_workspaces {
            let count: i64 = tx
                .query_row(
                    "SELECT count(*) FROM workspaces WHERE account_id=?1",
                    [&account_id],
                    |row| row.get(0),
                )
                .map_err(layout_change_db_error)?;
            if count <= 1 && workspace_exists(&tx, id, &account_id)? {
                for desktop in child_ids(&tx, "desktops", "workspace_id", id, &account_id)? {
                    desktop_ids.insert(desktop.clone());
                    for window in child_ids(&tx, "windows", "desktop_id", &desktop, &account_id)? {
                        window_ids.insert(window);
                    }
                }
                continue;
            }
            if !workspace_exists(&tx, id, &account_id)? {
                continue;
            }
            deleted_storage.extend(Self::delete_workspace_storage(&tx, &account_id, id)?);
            deleted_values.extend(Self::delete_workspace_values(&tx, &account_id, id)?);
            let children = child_ids(&tx, "desktops", "workspace_id", id, &account_id)?;
            for child in &children {
                for window in child_ids(&tx, "windows", "desktop_id", child, &account_id)? {
                    window_ids.insert(window.clone());
                    if tx
                        .execute("DELETE FROM windows WHERE id=?1 AND EXISTS(SELECT 1 FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=windows.desktop_id AND w.account_id=?2)", params![window, account_id])
                        .map_err(layout_change_db_error)?
                        > 0
                    {
                        changed.deleted_windows.push(window);
                    }
                }
            }
            for child in children {
                desktop_ids.insert(child.clone());
                if tx
                    .execute("DELETE FROM desktops WHERE id=?1 AND EXISTS(SELECT 1 FROM workspaces WHERE id=desktops.workspace_id AND account_id=?2)", params![child, account_id])
                    .map_err(layout_change_db_error)?
                    > 0
                {
                    changed.deleted_desktops.push(child);
                }
            }
            tx.execute(
                "DELETE FROM workspaces WHERE id=?1 AND account_id=?2",
                params![id, account_id],
            )
            .map_err(layout_change_db_error)?;
            tx.execute(
                "DELETE FROM legacy_workspace_owners WHERE workspace_id=?1 AND account_id=?2",
                params![id, account_id],
            )
            .map_err(layout_change_db_error)?;
            changed.deleted_workspaces.push(id.clone());
        }
        if let Some(device_id) = device_id {
            tx.execute(
                "UPDATE devices SET last_active_at=?2 WHERE id=?1 AND revoked_at IS NULL",
                params![device_id, timestamp()],
            )
            .map_err(layout_change_db_error)?;
        }

        let mut reply = LayoutChanges::default();
        for id in workspace_ids {
            if let Some(value) = entity_by_id::<Workspace>(&tx, "workspaces", &id, &account_id)? {
                reply.workspaces.push(value);
            } else {
                reply.deleted_workspaces.push(id);
            }
        }
        for id in desktop_ids {
            if let Some(value) = entity_by_id::<Desktop>(&tx, "desktops", &id, &account_id)? {
                reply.desktops.push(value);
            } else {
                reply.deleted_desktops.push(id);
            }
        }
        for id in window_ids {
            if let Some(value) = entity_by_id::<AppWindow>(&tx, "windows", &id, &account_id)? {
                reply.windows.push(value);
            } else {
                reply.deleted_windows.push(id);
            }
        }
        sort_changes(&mut reply);
        sort_changes(&mut changed);
        tx.commit().map_err(layout_change_db_error)?;
        drop(db);
        for (app_id, changed) in deleted_storage {
            self.send_event_for_account(
                DeviceEvent::StorageChanged { app_id, changed },
                &account_id,
            );
        }
        for (app_id, item) in deleted_values {
            let bucket_id = super::app_storage::bucket_id(&account_id, &app_id);
            self.send_event_for_account(
                DeviceEvent::AppValueChanged {
                    app_id,
                    bucket_id,
                    item,
                },
                &account_id,
            );
        }
        self.refresh_device_workspaces()?;
        Ok((reply, changed))
    }
}

fn entity_by_id<T: for<'de> Deserialize<'de>>(
    tx: &Transaction<'_>,
    table: &str,
    id: &str,
    account_id: &str,
) -> Result<Option<T>, CoreError> {
    let query = match table {
        "workspaces" => "SELECT data FROM workspaces WHERE id=?1 AND account_id=?2",
        "desktops" => "SELECT d.data FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=?1 AND w.account_id=?2",
        "windows" => "SELECT v.data FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE v.id=?1 AND w.account_id=?2",
        _ => return Err(errors::SERVER_LAYOUT_CANONICAL_ENTITY_TABLE_UNSUPPORTED()),
    };
    let raw: Option<String> = tx
        .query_row(query, params![id, account_id], |row| row.get(0))
        .optional()
        .map_err(|_| errors::SERVER_LAYOUT_CANONICAL_ENTITY_READ_FAILED())?;
    raw.map(|value| {
        serde_json::from_str(&value).map_err(|_| errors::SERVER_LAYOUT_CANONICAL_ENTITY_INVALID())
    })
    .transpose()
}

fn child_ids(
    tx: &Transaction<'_>,
    table: &str,
    parent: &str,
    id: &str,
    account_id: &str,
) -> Result<Vec<String>, CoreError> {
    let query = match (table, parent) {
        ("windows", "desktop_id") => "SELECT v.id FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE v.desktop_id=?1 AND w.account_id=?2 ORDER BY v.id",
        ("desktops", "workspace_id") => "SELECT d.id FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.workspace_id=?1 AND w.account_id=?2 ORDER BY d.id",
        _ => return Err(errors::SERVER_LAYOUT_CHILD_RELATION_UNSUPPORTED()),
    };
    let mut statement = tx
        .prepare(query)
        .map_err(|_| errors::SERVER_LAYOUT_CHILD_RELATION_READ_FAILED())?;
    let rows = statement
        .query_map(params![id, account_id], |row| row.get(0))
        .map_err(|_| errors::SERVER_LAYOUT_CHILD_RELATION_READ_FAILED())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| errors::SERVER_LAYOUT_CHILD_RELATION_READ_FAILED())?;
    Ok(rows)
}

fn workspace_exists(tx: &Transaction<'_>, id: &str, account_id: &str) -> Result<bool, CoreError> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2)",
        params![id, account_id],
        |row| row.get(0),
    )
    .map_err(|_| errors::SERVER_LAYOUT_WORKSPACE_LOOKUP_FAILED())
}
fn desktop_exists(tx: &Transaction<'_>, id: &str, account_id: &str) -> Result<bool, CoreError> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM desktops d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=?1 AND w.account_id=?2)",
        params![id, account_id],
        |row| row.get(0),
    )
    .map_err(|_| errors::SERVER_LAYOUT_DESKTOP_LOOKUP_FAILED())
}
fn sort_changes(changes: &mut LayoutChanges) {
    changes.workspaces.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    changes.desktops.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    changes.windows.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    changes.deleted_workspaces.sort();
    changes.deleted_desktops.sort();
    changes.deleted_windows.sort();
}

fn layout_change_db_error(error: rusqlite::Error) -> CoreError {
    errors::SERVER_LAYOUT_CHANGE_APPLY_FAILED().and_details(vec![error.to_string()])
}

#[cfg(test)]
mod error_detail_tests {
    use super::*;

    #[test]
    fn layout_change_database_error_is_preserved_in_details() {
        let error = rusqlite::Error::InvalidQuery;
        let original = error.to_string();
        assert_eq!(layout_change_db_error(error).details, vec![original]);
    }
}
