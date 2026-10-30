use super::*;
use kaleidoscope_contract::app_storage as contract;
use kaleidoscope_contract::app_storage::{StorageItemMeta, StorageUpdate};
use kaleidoscope_contract::builtin::BuiltinApp;
use rusqlite::OptionalExtension;

fn bucket_id(account_id: &str, app_id: &str) -> String {
    // A stable opaque id lets read-only operations describe an empty bucket without creating a row.
    sha256_hex(format!("{account_id}\0{app_id}").as_bytes())
}

fn current_definition(
    db: &Connection,
    app_id: &str,
    builtins: &[BuiltinApp],
) -> Result<Option<AppDefinition>, CoreError> {
    if let Some(builtin) = builtins.iter().find(|builtin| builtin.id == app_id) {
        return parse_app_definition(builtin.definition_json).map(Some);
    }
    let raw: Option<String> = db.query_row(
        "SELECT v.definition FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE a.id=?1 AND a.deleted_at IS NULL",
        [app_id], |row| row.get(0),
    ).optional().map_err(db_error)?;
    raw.map(|raw| {
        serde_json::from_str(&raw)
            .map_err(|e| server_error(&format!("앱 정의를 읽을 수 없습니다: {e}")))
    })
    .transpose()
}

fn declared_entry<'a>(
    definition: &'a AppDefinition,
    entry_id: &str,
) -> Result<&'a contract::StorageEntryDecl, CoreError> {
    definition
        .storage
        .as_ref()
        .and_then(|storage| storage.entries.iter().find(|entry| entry.id == entry_id))
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidRequest))
}

pub(super) fn resolve_key(
    entry: &contract::StorageEntryDecl,
    workspace_id: Option<&str>,
) -> Result<String, CoreError> {
    let has_workspace = entry.key.contains("{workspace_id}");
    match (has_workspace, workspace_id) {
        (true, Some(workspace_id)) => {
            let key = entry.key.replace("{workspace_id}", workspace_id);
            if contract::storage_key_matches(&entry.key, &key) {
                Ok(key)
            } else {
                Err(CoreError::new(ErrorCode::InvalidRequest))
            }
        }
        (true, None) => Err(CoreError::new(ErrorCode::InvalidRequest)),
        (false, _) => Ok(entry.key.clone()),
    }
}

fn check_workspace_owner(
    tx: &Transaction<'_>,
    account_id: &str,
    workspace_id: Option<&str>,
) -> Result<(), CoreError> {
    let Some(workspace_id) = workspace_id else {
        return Ok(());
    };
    let owns: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2) OR EXISTS(SELECT 1 FROM legacy_workspace_owners o WHERE o.workspace_id=?1 AND o.account_id=?2 AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=o.workspace_id))",
        params![workspace_id, account_id], |row| row.get(0),
    ).map_err(db_error)?;
    if owns {
        Ok(())
    } else {
        Err(CoreError::new(ErrorCode::NotFound))
    }
}

fn load_item(
    db: &Connection,
    bucket_id: &str,
    key: &str,
) -> Result<Option<(contract::StorageKind, Value, String)>, CoreError> {
    let row: Option<(String, String, String)> = db
        .query_row(
            "SELECT kind,content,revision FROM app_storage_items WHERE bucket_id=?1 AND key=?2",
            params![bucket_id, key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db_error)?;
    row.map(|(kind, content, revision)| {
        let kind = serde_json::from_str(&format!("\"{kind}\""))
            .map_err(|e| server_error(&format!("저장 항목 kind를 읽을 수 없습니다: {e}")))?;
        let content = serde_json::from_str(&content)
            .map_err(|e| server_error(&format!("저장 항목을 읽을 수 없습니다: {e}")))?;
        Ok((kind, content, revision))
    })
    .transpose()
}

fn item_meta(
    entry: &contract::StorageEntryDecl,
    key: &str,
    current: Option<&(contract::StorageKind, Value, String)>,
) -> StorageItemMeta {
    StorageItemMeta {
        entry_id: entry.id.clone(),
        key: key.to_string(),
        kind: entry.kind,
        revision: current.map(|(_, _, revision)| revision.clone()),
        exists: current.is_some(),
    }
}

pub(super) fn validate_storage_publish(
    tx: &Transaction<'_>,
    app_id: &str,
    previous: &AppDefinition,
    next: &AppDefinition,
) -> Result<(), CoreError> {
    let previous_storage = previous
        .storage
        .clone()
        .unwrap_or(contract::StorageDecl { entries: vec![] });
    let next_storage = next
        .storage
        .clone()
        .unwrap_or(contract::StorageDecl { entries: vec![] });
    let mut statement = tx.prepare("SELECT i.key,i.kind,i.content FROM app_storage_items i JOIN app_storage_buckets b ON b.id=i.bucket_id WHERE b.app_id=?1") .map_err(db_error)?;
    let rows = statement
        .query_map([app_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(db_error)?;
    let mut stored = Vec::new();
    for (key, kind, raw) in rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?
    {
        let content = serde_json::from_str(&raw)
            .map_err(|error| server_error(&format!("저장값을 읽을 수 없습니다: {error}")))?;
        let entry_id = previous_storage
            .entries
            .iter()
            .find(|entry| contract::storage_key_matches(&entry.key, &key))
            .map(|entry| entry.id.clone())
            .unwrap_or_else(|| "unknown".into());
        stored.push(contract::StoredStorageEntry {
            entry_id,
            key,
            kind: if kind == "md" {
                contract::StorageKind::Md
            } else {
                contract::StorageKind::Json
            },
            content,
        });
    }
    drop(statement);
    let errors = contract::validate_storage_upgrade(&previous_storage, &next_storage, &stored);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(CoreError {
            code: ErrorCode::InvalidAppDefinition,
            message: "저장 항목 선언이 기존 저장값과 호환되지 않습니다.".into(),
            details: errors,
        })
    }
}

impl AppState {
    pub(super) fn list_app_storage(
        &self,
        account_id: &str,
        app_id: &str,
        workspace_id: Option<&str>,
    ) -> Result<contract::StorageListReply, CoreError> {
        self.list_app_storage_with_builtins(
            account_id,
            app_id,
            workspace_id,
            kaleidoscope_contract::builtin::BUILTIN_APPS,
        )
    }

    pub(super) fn list_app_storage_with_builtins(
        &self,
        account_id: &str,
        app_id: &str,
        workspace_id: Option<&str>,
        builtins: &[BuiltinApp],
    ) -> Result<contract::StorageListReply, CoreError> {
        let db = self.lock_db()?;
        let definition = current_definition(&db, app_id, builtins)?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound))?;
        let entries = definition
            .storage
            .as_ref()
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound))?;
        let mut tx = db.unchecked_transaction().map_err(db_error)?;
        check_workspace_owner(&tx, account_id, workspace_id)?;
        let id = bucket_id(account_id, app_id);
        let mut items = Vec::new();
        for entry in &entries.entries {
            if entry.key.contains("{workspace_id}") && workspace_id.is_none() {
                continue;
            }
            let key = resolve_key(entry, workspace_id)?;
            if !contract::storage_key_matches(&entry.key, &key) {
                continue;
            }
            let current = load_item(&tx, &id, &key)?;
            items.push(item_meta(entry, &key, current.as_ref()));
        }
        // Drop an otherwise-unneeded transaction without committing or writing a bucket.
        tx.set_drop_behavior(rusqlite::DropBehavior::Rollback);
        Ok(contract::StorageListReply {
            bucket_id: id,
            items,
        })
    }

    pub(super) fn read_app_storage(
        &self,
        account_id: &str,
        app_id: &str,
        entry_id: &str,
        workspace_id: Option<&str>,
    ) -> Result<contract::StorageReadReply, CoreError> {
        self.read_app_storage_with_builtins(
            account_id,
            app_id,
            entry_id,
            workspace_id,
            kaleidoscope_contract::builtin::BUILTIN_APPS,
        )
    }

    pub(super) fn read_app_storage_with_builtins(
        &self,
        account_id: &str,
        app_id: &str,
        entry_id: &str,
        workspace_id: Option<&str>,
        builtins: &[BuiltinApp],
    ) -> Result<contract::StorageReadReply, CoreError> {
        let db = self.lock_db()?;
        let definition = current_definition(&db, app_id, builtins)?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound))?;
        let entry = declared_entry(&definition, entry_id)?;
        let key = resolve_key(entry, workspace_id)?;
        let mut tx = db.unchecked_transaction().map_err(db_error)?;
        check_workspace_owner(&tx, account_id, workspace_id)?;
        let item = load_item(&tx, &bucket_id(account_id, app_id), &key)?;
        tx.set_drop_behavior(rusqlite::DropBehavior::Rollback);
        match item {
            Some((kind, content, revision)) if kind == entry.kind => {
                Ok(contract::StorageReadReply {
                    kind,
                    content,
                    revision: Some(revision),
                    exists: true,
                })
            }
            Some(_) => Err(server_error("저장 항목 kind가 선언과 다릅니다.")),
            None => Ok(contract::StorageReadReply {
                kind: entry.kind,
                content: entry.default.clone(),
                revision: None,
                exists: false,
            }),
        }
    }

    pub(super) fn write_app_storage(
        &self,
        account_id: &str,
        app_id: &str,
        entry_id: &str,
        workspace_id: Option<&str>,
        content: Value,
        expected_revision: Option<String>,
    ) -> Result<(contract::StorageWriteReply, String, StorageUpdate), CoreError> {
        self.write_app_storage_with_builtins(
            account_id,
            app_id,
            entry_id,
            workspace_id,
            content,
            expected_revision,
            kaleidoscope_contract::builtin::BUILTIN_APPS,
        )
    }

    pub(super) fn write_app_storage_with_builtins(
        &self,
        account_id: &str,
        app_id: &str,
        entry_id: &str,
        workspace_id: Option<&str>,
        content: Value,
        expected_revision: Option<String>,
        builtins: &[BuiltinApp],
    ) -> Result<(contract::StorageWriteReply, String, StorageUpdate), CoreError> {
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(db_error)?;
        let definition = current_definition(&tx, app_id, builtins)?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound))?;
        let entry = declared_entry(&definition, entry_id)?.clone();
        let key = resolve_key(&entry, workspace_id)?;
        check_workspace_owner(&tx, account_id, workspace_id)?;
        contract::validate_storage_content(&entry, &content)
            .map_err(|_| CoreError::new(ErrorCode::InvalidRequest))?;
        let id = bucket_id(account_id, app_id);
        let old = load_item(&tx, &id, &key)?;
        let current_revision = old.as_ref().map(|(_, _, revision)| revision.clone());
        if current_revision != expected_revision {
            return Err(CoreError {
                code: ErrorCode::Conflict,
                message: "저장 항목이 다른 곳에서 바뀌었습니다.".into(),
                details: vec![format!(
                    "current_revision={}",
                    current_revision.as_deref().unwrap_or("null")
                )],
            });
        }
        let revision = contract::storage_revision(entry.kind, &content)
            .map_err(|_| CoreError::new(ErrorCode::InvalidRequest))?;
        let now = timestamp();
        tx.execute("INSERT INTO app_storage_buckets(id,account_id,app_id) VALUES(?1,?2,?3) ON CONFLICT(account_id,app_id) DO NOTHING", params![id,account_id,app_id]).map_err(db_error)?;
        tx.execute("INSERT INTO app_storage_items(bucket_id,key,kind,content,revision,updated_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(bucket_id,key) DO UPDATE SET kind=excluded.kind,content=excluded.content,revision=excluded.revision,updated_at=excluded.updated_at", params![id,key,serde_json::to_value(entry.kind).unwrap().as_str().unwrap(),serde_json::to_string(&content).map_err(|e|server_error(&e.to_string()))?,revision,now]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        let meta = StorageItemMeta {
            entry_id: entry.id,
            key,
            kind: entry.kind,
            revision: Some(revision.clone()),
            exists: true,
        };
        let update = StorageUpdate::Changed {
            changed: contract::StorageChanged {
                bucket_id: id,
                item: meta,
            },
        };
        Ok((
            contract::StorageWriteReply { revision },
            account_id.to_string(),
            update,
        ))
    }

    pub(super) fn reset_app_storage(
        &self,
        account_id: &str,
        app_id: &str,
        entry_id: &str,
        workspace_id: Option<&str>,
        expected_revision: Option<String>,
    ) -> Result<(contract::StorageResetReply, String, StorageUpdate), CoreError> {
        self.reset_app_storage_with_builtins(
            account_id,
            app_id,
            entry_id,
            workspace_id,
            expected_revision,
            kaleidoscope_contract::builtin::BUILTIN_APPS,
        )
    }

    pub(super) fn reset_app_storage_with_builtins(
        &self,
        account_id: &str,
        app_id: &str,
        entry_id: &str,
        workspace_id: Option<&str>,
        expected_revision: Option<String>,
        builtins: &[BuiltinApp],
    ) -> Result<(contract::StorageResetReply, String, StorageUpdate), CoreError> {
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(db_error)?;
        let definition = current_definition(&tx, app_id, builtins)?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound))?;
        let entry = declared_entry(&definition, entry_id)?.clone();
        let key = resolve_key(&entry, workspace_id)?;
        check_workspace_owner(&tx, account_id, workspace_id)?;
        let id = bucket_id(account_id, app_id);
        let old = load_item(&tx, &id, &key)?;
        let current_revision = old.as_ref().map(|(_, _, revision)| revision.clone());
        if current_revision != expected_revision {
            return Err(CoreError {
                code: ErrorCode::Conflict,
                message: "저장 항목이 다른 곳에서 바뀌었습니다.".into(),
                details: vec![format!(
                    "current_revision={}",
                    current_revision.as_deref().unwrap_or("null")
                )],
            });
        }
        tx.execute(
            "DELETE FROM app_storage_items WHERE bucket_id=?1 AND key=?2",
            params![id, key],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        let meta = StorageItemMeta {
            entry_id: entry.id,
            key,
            kind: entry.kind,
            revision: None,
            exists: false,
        };
        let update = StorageUpdate::Changed {
            changed: contract::StorageChanged {
                bucket_id: id,
                item: meta,
            },
        };
        Ok((
            contract::StorageResetReply { revision: None },
            account_id.to_string(),
            update,
        ))
    }

    pub(super) fn storage_snapshot_events(
        &self,
        account_id: &str,
    ) -> Result<Vec<DeviceEvent>, CoreError> {
        let apps = self.current_apps()?;
        let mut events = Vec::new();
        for app in apps {
            let Some(storage) = app.version.definition.storage.as_ref() else {
                continue;
            };
            let db = self.lock_db()?;
            let id = bucket_id(account_id, &app.app.id);
            let mut statement = db.prepare("SELECT key,kind,revision FROM app_storage_items WHERE bucket_id=?1 ORDER BY key").map_err(db_error)?;
            let rows = statement
                .query_map([&id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(db_error)?;
            let mut items = Vec::new();
            for (key, kind, revision) in rows
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(db_error)?
            {
                if let Some(entry) = storage
                    .entries
                    .iter()
                    .find(|entry| contract::storage_key_matches(&entry.key, &key))
                {
                    let kind = if kind == "md" {
                        contract::StorageKind::Md
                    } else {
                        contract::StorageKind::Json
                    };
                    items.push(StorageItemMeta {
                        entry_id: entry.id.clone(),
                        key,
                        kind,
                        revision: Some(revision),
                        exists: true,
                    });
                }
            }
            drop(statement);
            drop(db);
            events.push(DeviceEvent::StorageSnapshot {
                app_id: app.app.id,
                snapshot: contract::StorageSnapshot {
                    bucket_id: id,
                    items,
                },
            });
        }
        Ok(events)
    }

    pub(super) fn publish_storage_update(&self, update: DeviceEvent, account_id: &str) {
        self.send_event_for_account(update, account_id);
    }

    pub(super) fn delete_workspace_storage(
        tx: &Transaction<'_>,
        account_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<(String, contract::StorageChanged)>, CoreError> {
        let mut statement = tx.prepare("SELECT b.app_id,b.id,i.key,v.definition FROM app_storage_items i JOIN app_storage_buckets b ON b.id=i.bucket_id JOIN apps a ON a.id=b.app_id JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE b.account_id=?1") .map_err(db_error)?;
        let rows = statement
            .query_map([account_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(db_error)?;
        let found = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        drop(statement);
        let mut deleted = Vec::new();
        for (app_id, id, key, raw_definition) in found {
            let definition: AppDefinition = serde_json::from_str(&raw_definition)
                .map_err(|error| server_error(&format!("앱 정의를 읽을 수 없습니다: {error}")))?;
            let Some(entry) = definition.storage.as_ref().and_then(|storage| {
                storage.entries.iter().find(|entry| {
                    entry.key.contains("{workspace_id}")
                        && contract::storage_key_matches(&entry.key, &key)
                        && entry.key.replace("{workspace_id}", workspace_id) == key
                })
            }) else {
                continue;
            };
            tx.execute(
                "DELETE FROM app_storage_items WHERE bucket_id=?1 AND key=?2 AND EXISTS(SELECT 1 FROM app_storage_buckets b WHERE b.id=?1 AND b.account_id=?3)",
                params![id, key, account_id],
            )
            .map_err(db_error)?;
            deleted.push((
                app_id,
                contract::StorageChanged {
                    bucket_id: id,
                    item: StorageItemMeta {
                        entry_id: entry.id.clone(),
                        key,
                        kind: entry.kind,
                        revision: None,
                        exists: false,
                    },
                },
            ));
        }
        Ok(deleted)
    }
}

impl AppState {
    pub(super) fn should_deliver_storage_event(
        &self,
        device_id: &str,
        event: &DeviceEvent,
    ) -> bool {
        !matches!(
            event,
            DeviceEvent::StorageSnapshot { .. } | DeviceEvent::StorageChanged { .. }
        ) || self
            .0
            .storage_devices
            .lock()
            .ok()
            .is_some_and(|devices| devices.contains(device_id))
    }
}
