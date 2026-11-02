//! 원격 항목을 덮어쓰지 않는 계정 데이터 이관.
use super::*;
use axum::extract::Extension;
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::app_storage::{self as contract, StorageKind};
use kaleidoscope_contract::transfer::{TransferBundle, TransferResult, TransferValue};

impl AppState {
    pub(super) fn export_data(&self, account: &str) -> Result<TransferBundle, CoreError> {
        let mut bundle = TransferBundle::default();
        for meta in self.list_assets()? {
            if let Some((_, bytes)) = self.get_asset(account, &meta.id, meta.version)? {
                bundle
                    .assets
                    .push(kaleidoscope_contract::assets::AssetUpload {
                        id: meta.id,
                        version: meta.version,
                        format: meta.format,
                        sha256: meta.sha256,
                        source: meta.source,
                        license: meta.license,
                        data_base64: STANDARD.encode(bytes),
                    });
            }
        }
        bundle.apps = self
            .current_apps()?
            .into_iter()
            .map(|a| a.version.definition)
            .collect();
        let db = self.lock_db()?;
        fn rows<T: serde::de::DeserializeOwned>(
            db: &Connection,
            table: &str,
            sql: &str,
            account: &str,
        ) -> Result<Vec<T>, CoreError> {
            let mut stmt = db.prepare(sql).map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::SERVER_TRANSFER_EXPORT_DATABASE_FAILED(table),
                )
            })?;
            let rows = stmt
                .query_map([account], |r| r.get::<_, String>(0))
                .map_err(|error| {
                    db_error_with(
                        error,
                        kaleidoscope_contract::errors::SERVER_TRANSFER_EXPORT_DATABASE_FAILED(
                            table,
                        ),
                    )
                })?;
            rows.map(|r| {
                serde_json::from_str(&r.map_err(|error| {
                    db_error_with(
                        error,
                        kaleidoscope_contract::errors::SERVER_TRANSFER_EXPORT_DATABASE_FAILED(
                            table,
                        ),
                    )
                })?)
                .map_err(|error| {
                    kaleidoscope_contract::errors::SERVER_TRANSFER_EXPORT_LAYOUT_JSON_INVALID(table)
                        .and_details(vec![error.to_string()])
                })
            })
            .collect()
        }
        bundle.layout.workspaces = rows(
            &db,
            "작업",
            "SELECT data FROM workspaces WHERE account_id=?1",
            account,
        )?;
        bundle.layout.desktops = rows(&db, "데스크톱", "SELECT d.data FROM desktops d JOIN workspaces w ON d.workspace_id=w.id WHERE w.account_id=?1", account)?;
        bundle.layout.windows = rows(&db, "창", "SELECT n.data FROM windows n JOIN desktops d ON n.desktop_id=d.id JOIN workspaces w ON d.workspace_id=w.id WHERE w.account_id=?1", account)?;
        let mut stmt = db.prepare("SELECT b.app_id,i.key,i.kind,i.content,i.workspace_id FROM app_storage_items i JOIN app_storage_buckets b ON i.bucket_id=b.id WHERE b.account_id=?1").map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_TRANSFER_EXPORT_DATABASE_FAILED("저장값")))?;
        let rows = stmt
            .query_map([account], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::SERVER_TRANSFER_EXPORT_DATABASE_FAILED("저장값"),
                )
            })?;
        for row in rows {
            let (app_id, key, kind, content, workspace_id) = row.map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::SERVER_TRANSFER_EXPORT_DATABASE_FAILED("저장값"),
                )
            })?;
            if !kaleidoscope_contract::builtin::is_builtin(&app_id)
                && !bundle.apps.iter().any(|app| app.id == app_id)
            {
                continue;
            }
            let kind = serde_json::from_value(json!(kind)).map_err(|error| {
                kaleidoscope_contract::errors::SERVER_TRANSFER_EXPORT_VALUE_KIND_INVALID(
                    &app_id, &key,
                )
                .and_details(vec![error.to_string()])
            })?;
            let content = serde_json::from_str(&content).map_err(|error| {
                kaleidoscope_contract::errors::SERVER_TRANSFER_EXPORT_VALUE_JSON_INVALID(
                    &app_id, &key,
                )
                .and_details(vec![error.to_string()])
            })?;
            bundle.values.push(TransferValue {
                app_id,
                key,
                kind,
                content,
                workspace_id,
            });
        }
        Ok(bundle)
    }
    pub(super) fn import_data(
        &self,
        account: &str,
        bundle: TransferBundle,
    ) -> Result<TransferResult, CoreError> {
        if !layout_changes::validate_changes(&bundle.layout) {
            return Err(kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_LAYOUT_INVALID());
        }
        if !bundle.layout.deleted_workspaces.is_empty()
            || !bundle.layout.deleted_desktops.is_empty()
            || !bundle.layout.deleted_windows.is_empty()
        {
            return Err(kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DELETIONS_PRESENT());
        }
        let mut result = TransferResult::default();
        let mut blocked_apps = HashSet::new();
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(|error| {
            db_error_with(
                error,
                kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED(),
            )
        })?;
        // 자산, 앱, 배치, 저장값 순서이며 충돌 외 오류는 트랜잭션 전체를 되돌린다.
        for asset in bundle.assets {
            let label = format!("asset:{}/{}", asset.id, asset.version);
            let existed = assets::get_in(&tx, account, &asset.id, asset.version, || {
                kaleidoscope_contract::errors::ASSET_TRANSFER_LOOKUP_FAILED(
                    &asset.id,
                    asset.version,
                )
            })?
            .is_some();
            let prepared = assets::prepare(&asset)?;
            match assets::insert(&tx, account, &prepared) {
                Ok(_) => result.imported += u32::from(!existed),
                Err(e) if e.code == ErrorCode::Conflict => result.skipped.push(label),
                Err(e) => return Err(e),
            }
        }
        for definition in bundle.apps {
            let definition = parse_app_definition(
                &serde_json::to_string(&definition).map_err(|error| {
                    kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DEFINITION_SERIALIZE_FAILED(
                        &definition.id,
                    )
                    .and_details(vec![error.to_string()])
                })?,
            )?;
            if kaleidoscope_contract::builtin::is_builtin(&definition.id) {
                return Err(
                    kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_BUILTIN_APP(
                        &definition.id,
                    ),
                );
            }
            let deleted: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM apps WHERE id=?1 AND deleted_at IS NOT NULL)",
                    [&definition.id],
                    |r| r.get(0),
                )
                .map_err(|error| {
                    db_error_with(
                        error,
                        kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED(),
                    )
                })?;
            if deleted {
                result.skipped.push(format!("app:{}", definition.id));
                blocked_apps.insert(definition.id);
                continue;
            }
            let exists: Option<String> = tx.query_row("SELECT v.definition FROM apps a JOIN app_versions v ON a.id=v.app_id AND a.current_version=v.version WHERE a.id=?1", [&definition.id], |r| r.get(0)).optional().map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED()))?;
            if let Some(raw) = exists {
                if serde_json::from_str::<AppDefinition>(&raw).ok().as_ref() != Some(&definition) {
                    result.skipped.push(format!("app:{}", definition.id));
                    blocked_apps.insert(definition.id);
                }
                continue;
            }
            if definition.assets.iter().any(|a| {
                result
                    .skipped
                    .contains(&format!("asset:{}/{}", a.id, a.version))
            }) {
                result.skipped.push(format!("app:{}", definition.id));
                blocked_apps.insert(definition.id);
                continue;
            }
            assets::verify_dependencies(&tx, account, &definition.assets)?;
            assets::verify_client_entry(&tx, account, &definition)?;
            let now = timestamp();
            tx.execute("INSERT INTO apps(id,name,current_version,created_at,updated_at) VALUES(?1,?2,1,?3,?3)",params![definition.id,definition.name,now]).map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED()))?;
            save_version(&tx, &definition, 1, &now, "transfer").map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED(),
                )
            })?;
            result.imported += 1;
        }
        for workspace in bundle.layout.workspaces {
            insert_layout(
                &tx,
                "workspaces",
                &workspace.id,
                &serde_json::to_string(&workspace).unwrap(),
                account,
                None,
                None,
                &workspace.created_at,
                &mut result,
            )?;
        }
        for desktop in bundle.layout.desktops {
            let owns: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2)",
                    params![desktop.workspace_id, account],
                    |r| r.get(0),
                )
                .map_err(|error| {
                    db_error_with(
                        error,
                        kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED(),
                    )
                })?;
            if !owns {
                result.skipped.push(format!("desktop:{}", desktop.id));
                continue;
            }
            insert_layout(
                &tx,
                "desktops",
                &desktop.id,
                &serde_json::to_string(&desktop).unwrap(),
                account,
                Some(&desktop.workspace_id),
                None,
                &desktop.created_at,
                &mut result,
            )?;
        }
        for mut window in bundle.layout.windows {
            let owns: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM desktops d JOIN workspaces w ON d.workspace_id=w.id WHERE d.id=?1 AND w.account_id=?2)",params![window.desktop_id,account],|r|r.get(0)).map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED()))?;
            if !owns || blocked_apps.contains(&window.app_id) {
                result.skipped.push(format!("window:{}", window.id));
                continue;
            }
            if !kaleidoscope_contract::builtin::is_builtin(&window.app_id) {
                let version: Option<u32> = tx
                    .query_row(
                        "SELECT current_version FROM apps WHERE id=?1 AND deleted_at IS NULL",
                        [&window.app_id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|error| {
                        db_error_with(
                            error,
                            kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED(),
                        )
                    })?;
                let Some(version) = version else {
                    result.skipped.push(format!("window:{}", window.id));
                    continue;
                };
                window.app_version = version;
            }
            insert_layout(
                &tx,
                "windows",
                &window.id,
                &serde_json::to_string(&window).unwrap(),
                account,
                Some(&window.desktop_id),
                Some(&window.app_id),
                &window.created_at,
                &mut result,
            )?;
        }
        for item in bundle.values {
            let label = format!("value:{}/{}", item.app_id, item.key);
            if blocked_apps.contains(&item.app_id)
                || !contract::valid_concrete_storage_key(&item.key)
            {
                result.skipped.push(label);
                continue;
            }
            match app_storage::check_workspace_owner(&tx, account, item.workspace_id.as_deref()) {
                Ok(()) => (),
                Err(e) if e.code == ErrorCode::NotFound => {
                    result.skipped.push(label);
                    continue;
                }
                Err(e) => return Err(e),
            }
            if kaleidoscope_contract::builtin::is_builtin(&item.app_id) {
                let definition = super::builtin_specs::load_definition(&tx, &item.app_id)?;
                let collection = definition.as_ref().and_then(|definition| {
                    definition.storage.as_ref().and_then(|storage| {
                        storage.entries.iter().find(|entry| {
                            entry.collection
                                && contract::storage_entry_key_matches(entry, &item.key)
                        })
                    })
                });
                if let Some(entry) = collection {
                    if entry.kind != item.kind {
                        return Err(
                            kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_COLLECTION_KIND_MISMATCH(
                                &item.app_id,
                                &item.key,
                            ),
                        );
                    }
                    contract::validate_storage_content(entry, &item.content)?;
                } else {
                    let limit_ok = match item.kind {
                        StorageKind::Json => {
                            serde_json::to_vec(&item.content).unwrap().len()
                                <= contract::STORAGE_JSON_MAX_BYTES
                        }
                        StorageKind::Md => item
                            .content
                            .as_str()
                            .is_some_and(|s| s.len() <= contract::STORAGE_MD_MAX_BYTES),
                    };
                    if !limit_ok {
                        if item.kind == StorageKind::Md && item.content.as_str().is_none() {
                            return Err(
                                kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_MD_NOT_STRING(
                                    &item.app_id,
                                    &item.key,
                                ),
                            );
                        }
                        return Err(
                            kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_VALUE_TOO_LARGE(
                                &item.app_id,
                                &item.key,
                            ),
                        );
                    }
                }
            } else {
                let raw: Option<String> = tx.query_row("SELECT v.definition FROM apps a JOIN app_versions v ON a.id=v.app_id AND a.current_version=v.version WHERE a.id=?1 AND a.deleted_at IS NULL",[&item.app_id],|r|r.get(0)).optional().map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED()))?;
                let raw = raw.ok_or_else(|| {
                    kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_APP_NOT_FOUND(
                        &item.app_id,
                    )
                })?;
                let definition: AppDefinition = serde_json::from_str(&raw).map_err(|error| {
                    kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_STORED_APP_DEFINITION_JSON_INVALID(
                        &item.app_id,
                    )
                    .and_details(vec![error.to_string()])
                })?;
                let entry = definition
                    .storage
                    .as_ref()
                    .and_then(|s| {
                        s.entries
                            .iter()
                            .find(|e| contract::storage_entry_key_matches(e, &item.key))
                    })
                    .ok_or_else(|| {
                        kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_STORAGE_ENTRY_NOT_FOUND(
                            &item.app_id,
                            &item.key,
                        )
                    })?;
                if entry.kind != item.kind {
                    return Err(
                        kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_STORAGE_KIND_MISMATCH(
                            &item.app_id,
                            &item.key,
                        ),
                    );
                }
                contract::validate_storage_content(entry, &item.content)?;
            }
            let bucket = app_storage::bucket_id(account, &item.app_id);
            if let Some((kind, content, _)) = app_storage::load_item(&tx, &bucket, &item.key)? {
                if kind != item.kind || content != item.content {
                    result.skipped.push(label);
                }
                continue;
            }
            let revision =
                contract::storage_revision(item.kind, &item.content).map_err(|reason| {
                    if item.kind == StorageKind::Md {
                        kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_MD_NOT_STRING(
                            &item.app_id,
                            &item.key,
                        )
                        .and_details(vec![reason])
                    } else {
                        kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_REVISION_FAILED(
                            &item.app_id,
                            &item.key,
                        )
                        .and_details(vec![reason])
                    }
                })?;
            tx.execute("INSERT INTO app_storage_buckets(id,account_id,app_id) VALUES(?1,?2,?3) ON CONFLICT DO NOTHING",params![bucket,account,item.app_id]).map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED()))?;
            tx.execute("INSERT INTO app_storage_items(bucket_id,key,kind,content,revision,updated_at,workspace_id) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![bucket,item.key,serde_json::to_value(item.kind).unwrap().as_str().unwrap(),serde_json::to_string(&item.content).unwrap(),revision,timestamp(),item.workspace_id]).map_err(|error| db_error_with(error, kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED()))?;
            result.imported += 1;
        }
        tx.commit().map_err(|error| {
            db_error_with(
                error,
                kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED(),
            )
        })?;
        drop(db);
        for app in self.current_apps()? {
            self.send_event_for_account(
                DeviceEvent::AppPublished {
                    app,
                    open: false,
                    workspace_id: None,
                },
                account,
            );
        }
        let device = self
            .lock_db()?
            .query_row(
                "SELECT id FROM devices WHERE account_id=?1 LIMIT 1",
                [account],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED(),
                )
            })?;
        if let Some(device) = device {
            self.send_event_for_account(self.layout_snapshot(&device)?, account);
        }
        for event in self.storage_snapshot_events(account)? {
            self.send_event_for_account(event, account);
        }
        for identity in kaleidoscope_contract::builtin::BUILTIN_IDENTITIES {
            let values = self.list_app_values(account, identity.id)?;
            self.send_event_for_account(
                DeviceEvent::AppValuesSnapshot {
                    app_id: identity.id.into(),
                    bucket_id: values.bucket_id,
                    items: values.items,
                },
                account,
            );
        }
        Ok(result)
    }
}
#[allow(clippy::too_many_arguments)]
fn insert_layout(
    tx: &Transaction<'_>,
    table: &str,
    id: &str,
    data: &str,
    account: &str,
    parent: Option<&str>,
    app: Option<&str>,
    created: &str,
    result: &mut TransferResult,
) -> Result<(), CoreError> {
    let prior: Option<String> = tx
        .query_row(
            &format!("SELECT data FROM {table} WHERE id=?1"),
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|error| {
            db_error_with(
                error,
                kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED(),
            )
        })?;
    if let Some(prior) = prior {
        if prior != data {
            result.skipped.push(format!("{table}:{id}"));
        }
        return Ok(());
    }
    match table {
        "workspaces" => tx.execute(
            "INSERT INTO workspaces(id,account_id,data,created_at) VALUES(?1,?2,?3,?4)",
            params![id, account, data, created],
        ),
        "desktops" => tx.execute(
            "INSERT INTO desktops(id,workspace_id,data,created_at) VALUES(?1,?2,?3,?4)",
            params![id, parent, data, created],
        ),
        _ => tx.execute(
            "INSERT INTO windows(id,desktop_id,app_id,data,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![id, parent, app, data, created],
        ),
    }
    .map_err(|error| {
        db_error_with(
            error,
            kaleidoscope_contract::errors::SERVER_TRANSFER_IMPORT_DATABASE_FAILED(),
        )
    })?;
    result.imported += 1;
    Ok(())
}
pub(super) async fn export(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
) -> Response {
    match state
        .device_account_id(&device.0)
        .and_then(|a| state.export_data(&a))
    {
        Ok(bundle) => Json(bundle).into_response(),
        Err(e) => super::http::error_response(StatusCode::BAD_REQUEST, e),
    }
}
pub(super) async fn import(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Json(bundle): Json<TransferBundle>,
) -> Response {
    let result = state
        .device_account_id(&device.0)
        .and_then(|a| state.import_data(&a, bundle));
    match result {
        Ok(result) => Json(result).into_response(),
        Err(e) => super::http::error_response(StatusCode::BAD_REQUEST, e),
    }
}
