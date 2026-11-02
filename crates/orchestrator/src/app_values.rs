//! 기본 앱이 정의와 기본값을 기기에 둔 채 사용하는 원시 값 저장소.
use super::*;
use axum::extract::{Extension, Path, Query, State};
use kaleidoscope_contract::app_storage::{
    self as contract, AppValueList, AppValueMeta, AppValueRead, AppValueWrite, StorageKind,
};

fn validate(app_id: &str, key: &str) -> Result<(), CoreError> {
    if !kaleidoscope_contract::builtin::is_builtin(app_id)
        || !contract::valid_concrete_storage_key(key)
    {
        return Err(CoreError::new(ErrorCode::InvalidRequest));
    }
    Ok(())
}

fn content_size(kind: StorageKind, content: &Value) -> Result<(), CoreError> {
    let valid = match kind {
        StorageKind::Json => serde_json::to_vec(content)
            .is_ok_and(|bytes| bytes.len() <= contract::STORAGE_JSON_MAX_BYTES),
        StorageKind::Md => content
            .as_str()
            .is_some_and(|text| text.len() <= contract::STORAGE_MD_MAX_BYTES),
    };
    if valid {
        Ok(())
    } else {
        Err(CoreError::new(ErrorCode::InvalidRequest))
    }
}

fn conflict(revision: Option<&str>) -> CoreError {
    CoreError {
        code: ErrorCode::Conflict,
        message: "저장 항목이 다른 곳에서 바뀌었습니다.".into(),
        details: vec![format!("current_revision={}", revision.unwrap_or("null"))],
    }
}

impl AppState {
    pub(super) fn list_app_value_collection(
        &self,
        account: &str,
        app_id: &str,
        prefix: &str,
        workspace: Option<&str>,
    ) -> Result<contract::CollectionListReply, CoreError> {
        let (entry, resolved) = self.builtin_collection_prefix(app_id, prefix, workspace)?;
        let db = self.lock_db()?;
        let mut tx = db.unchecked_transaction().map_err(db_error)?;
        super::app_storage::check_workspace_owner(&tx, account, workspace)?;
        let result = super::collection_storage::list(
            &tx,
            &super::app_storage::bucket_id(account, app_id),
            &resolved,
            &entry.id,
            entry.kind,
        )?;
        tx.set_drop_behavior(rusqlite::DropBehavior::Rollback);
        Ok(result)
    }

    pub(super) fn delete_workspace_values(
        tx: &Transaction<'_>,
        account: &str,
        workspace: &str,
    ) -> Result<Vec<(String, AppValueMeta)>, CoreError> {
        let mut statement = tx.prepare("SELECT b.app_id,i.key,i.kind FROM app_storage_items i JOIN app_storage_buckets b ON b.id=i.bucket_id WHERE b.account_id=?1 AND i.workspace_id=?2").map_err(db_error)?;
        let rows = statement
            .query_map(params![account, workspace], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(db_error)?;
        let items = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        drop(statement);
        tx.execute("DELETE FROM app_storage_items WHERE workspace_id=?1 AND bucket_id IN (SELECT id FROM app_storage_buckets WHERE account_id=?2)", params![workspace, account]).map_err(db_error)?;
        items
            .into_iter()
            .map(|(app_id, key, kind)| {
                let kind = match kind.as_str() {
                    "json" => StorageKind::Json,
                    "md" => StorageKind::Md,
                    _ => return Err(server_error("저장 항목 kind가 올바르지 않습니다")),
                };
                Ok((
                    app_id,
                    AppValueMeta {
                        key,
                        kind,
                        revision: None,
                    },
                ))
            })
            .collect()
    }

    pub(super) fn list_app_values(
        &self,
        account: &str,
        app_id: &str,
    ) -> Result<AppValueList, CoreError> {
        if !kaleidoscope_contract::builtin::is_builtin(app_id) {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        let id = super::app_storage::bucket_id(account, app_id);
        let db = self.lock_db()?;
        let mut statement = db
            .prepare(
                "SELECT key,kind,revision FROM app_storage_items WHERE bucket_id=?1 ORDER BY key",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map([&id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(db_error)?;
        let items = rows
            .map(|row| {
                let (key, kind, revision) = row.map_err(db_error)?;
                let kind = match kind.as_str() {
                    "json" => StorageKind::Json,
                    "md" => StorageKind::Md,
                    _ => return Err(server_error("저장 항목 kind가 올바르지 않습니다")),
                };
                Ok(AppValueMeta {
                    key,
                    kind,
                    revision: Some(revision),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(AppValueList {
            bucket_id: id,
            items,
        })
    }

    #[cfg(test)]
    pub(super) fn read_app_value(
        &self,
        account: &str,
        app_id: &str,
        key: &str,
    ) -> Result<AppValueRead, CoreError> {
        self.read_app_value_with_workspace(account, app_id, key, None)
    }

    pub(super) fn read_app_value_with_workspace(
        &self,
        account: &str,
        app_id: &str,
        key: &str,
        workspace: Option<&str>,
    ) -> Result<AppValueRead, CoreError> {
        validate(app_id, key)?;
        if let Ok((entry, prefix, doc)) = self.builtin_collection_for_key(app_id, key, workspace) {
            let db = self.lock_db()?;
            let mut tx = db.unchecked_transaction().map_err(db_error)?;
            super::app_storage::check_workspace_owner(&tx, account, workspace)?;
            let bucket_id = super::app_storage::bucket_id(account, app_id);
            let value =
                match super::collection_storage::read(&tx, &bucket_id, &prefix, &doc, &entry) {
                    Ok(value) => value,
                    Err(error) if error.code == ErrorCode::NotFound => {
                        tx.set_drop_behavior(rusqlite::DropBehavior::Rollback);
                        return Ok(AppValueRead {
                            bucket_id,
                            exists: false,
                            kind: None,
                            content: None,
                            revision: None,
                        });
                    }
                    Err(error) => return Err(error),
                };
            tx.set_drop_behavior(rusqlite::DropBehavior::Rollback);
            return Ok(AppValueRead {
                bucket_id,
                exists: value.exists,
                kind: Some(value.kind),
                content: Some(value.content),
                revision: value.revision,
            });
        }
        let db = self.lock_db()?;
        let bucket_id = super::app_storage::bucket_id(account, app_id);
        let item = super::app_storage::load_item(&db, &bucket_id, key)?;
        Ok(match item {
            Some((kind, content, revision)) => AppValueRead {
                bucket_id,
                exists: true,
                kind: Some(kind),
                content: Some(content),
                revision: Some(revision),
            },
            None => AppValueRead {
                bucket_id,
                exists: false,
                kind: None,
                content: None,
                revision: None,
            },
        })
    }

    pub(super) fn write_app_value(
        &self,
        account: &str,
        app_id: &str,
        key: &str,
        kind: StorageKind,
        content: Value,
        expected: Option<String>,
        workspace: Option<&str>,
    ) -> Result<String, CoreError> {
        validate(app_id, key)?;
        content_size(kind, &content)?;
        if let Ok((entry, prefix, doc)) = self.builtin_collection_for_key(app_id, key, workspace) {
            if kind != entry.kind {
                return Err(CoreError::new(ErrorCode::InvalidRequest));
            }
            let (reply, account, update) = super::collection_storage::write(
                self, account, app_id, &entry, &prefix, &doc, workspace, content, expected,
            )?;
            super::app_storage_http::send_storage_update(self, app_id, &account, update);
            return Ok(reply.revision);
        }
        let (entry, resolved) = self.builtin_entry(app_id, key, workspace)?;
        if resolved != key || kind != entry.kind {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        contract::validate_storage_content(&entry, &content)
            .map_err(|detail| CoreError::with_details(ErrorCode::InvalidRequest, vec![detail]))?;
        if workspace.is_some_and(|workspace| !key.split('/').any(|segment| segment == workspace)) {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        let revision = contract::storage_revision(kind, &content)
            .map_err(|_| CoreError::new(ErrorCode::InvalidRequest))?;
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(db_error)?;
        super::app_storage::check_workspace_owner(&tx, account, workspace)?;
        let id = super::app_storage::bucket_id(account, app_id);
        let previous = super::app_storage::load_item(&tx, &id, key)?;
        let current = previous.as_ref().map(|(_, _, revision)| revision.as_str());
        if current != expected.as_deref() {
            return Err(conflict(current));
        }
        tx.execute("INSERT INTO app_storage_buckets(id,account_id,app_id) VALUES(?1,?2,?3) ON CONFLICT(account_id,app_id) DO NOTHING", params![id,account,app_id]).map_err(db_error)?;
        let kind_name = match kind {
            StorageKind::Json => "json",
            StorageKind::Md => "md",
        };
        tx.execute("INSERT INTO app_storage_items(bucket_id,key,kind,content,revision,updated_at,workspace_id) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(bucket_id,key) DO UPDATE SET kind=excluded.kind,content=excluded.content,revision=excluded.revision,updated_at=excluded.updated_at,workspace_id=excluded.workspace_id",
            params![id,key,kind_name,serde_json::to_string(&content).map_err(|error| server_error(&error.to_string()))?,revision,timestamp(),workspace]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        drop(db);
        self.send_event_for_account(
            DeviceEvent::AppValueChanged {
                app_id: app_id.into(),
                bucket_id: id,
                item: AppValueMeta {
                    key: key.into(),
                    kind,
                    revision: Some(revision.clone()),
                },
            },
            account,
        );
        self.publish_storage_update(
            DeviceEvent::StorageChanged {
                app_id: app_id.into(),
                changed: contract::StorageChanged {
                    bucket_id: super::app_storage::bucket_id(account, app_id),
                    item: contract::StorageItemMeta {
                        entry_id: entry.id.clone(),
                        key: key.into(),
                        kind,
                        revision: Some(revision.clone()),
                        exists: true,
                    },
                },
            },
            account,
        );
        if tokio::runtime::Handle::try_current().is_ok() {
            super::worker::spawn_watch(self, account, app_id, &entry.id, workspace);
        }
        Ok(revision)
    }

    #[cfg(test)]
    pub(super) fn reset_app_value(
        &self,
        account: &str,
        app_id: &str,
        key: &str,
        expected: Option<String>,
    ) -> Result<(), CoreError> {
        self.reset_app_value_with_workspace(account, app_id, key, expected, None)
    }

    pub(super) fn reset_app_value_with_workspace(
        &self,
        account: &str,
        app_id: &str,
        key: &str,
        expected: Option<String>,
        workspace: Option<&str>,
    ) -> Result<(), CoreError> {
        validate(app_id, key)?;
        if let Ok((entry, prefix, doc)) = self.builtin_collection_for_key(app_id, key, workspace) {
            let (_, account, update) = super::collection_storage::reset(
                self, account, app_id, &entry, &prefix, &doc, workspace, expected,
            )?;
            super::app_storage_http::send_storage_update(self, app_id, &account, update);
            return Ok(());
        }
        let (entry, resolved) = self.builtin_entry(app_id, key, workspace)?;
        if resolved != key {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(db_error)?;
        super::app_storage::check_workspace_owner(&tx, account, workspace)?;
        let id = super::app_storage::bucket_id(account, app_id);
        let old = super::app_storage::load_item(&tx, &id, key)?;
        let current = old.as_ref().map(|(_, _, revision)| revision.as_str());
        if current != expected.as_deref() {
            return Err(conflict(current));
        }
        tx.execute(
            "DELETE FROM app_storage_items WHERE bucket_id=?1 AND key=?2",
            params![id, key],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        drop(db);
        if let Some((kind, _, _)) = old {
            self.send_event_for_account(
                DeviceEvent::AppValueChanged {
                    app_id: app_id.into(),
                    bucket_id: id,
                    item: AppValueMeta {
                        key: key.into(),
                        kind,
                        revision: None,
                    },
                },
                account,
            );
        }
        self.publish_storage_update(
            DeviceEvent::StorageChanged {
                app_id: app_id.into(),
                changed: contract::StorageChanged {
                    bucket_id: super::app_storage::bucket_id(account, app_id),
                    item: contract::StorageItemMeta {
                        entry_id: entry.id.clone(),
                        key: key.into(),
                        kind: entry.kind,
                        revision: None,
                        exists: false,
                    },
                },
            },
            account,
        );
        if tokio::runtime::Handle::try_current().is_ok() {
            super::worker::spawn_watch(self, account, app_id, &entry.id, workspace);
        }
        Ok(())
    }
}

pub(super) fn move_collection(
    state: &AppState,
    account: &str,
    app_id: &str,
    request: contract::AppValueMoveRequest,
    workspace: Option<&str>,
) -> Result<contract::CollectionMoveReply, CoreError> {
    if request.operation != "move" {
        return Err(CoreError::new(ErrorCode::InvalidRequest));
    }
    validate(app_id, &request.from_key)?;
    validate(app_id, &request.to_key)?;
    let (entry, prefix, from_doc) =
        state.builtin_collection_for_key(app_id, &request.from_key, workspace)?;
    let (target_entry, target_prefix, to_doc) =
        state.builtin_collection_for_key(app_id, &request.to_key, workspace)?;
    if entry.id != target_entry.id || prefix != target_prefix {
        return Err(CoreError::new(ErrorCode::InvalidRequest));
    }
    let request = contract::CollectionMove {
        from: from_doc,
        to: to_doc,
        expected_revision: request.expected_revision,
    };
    let (reply, account, update) = super::collection_storage::move_document(
        state, account, app_id, &entry, &prefix, &request, workspace,
    )?;
    let from_key = format!("{prefix}/{}", request.from);
    let to_key = format!("{prefix}/{}", request.to);
    super::app_storage_http::send_raw_storage_move(
        state, app_id, &account, update, from_key, to_key,
    );
    Ok(reply)
}

fn response_error(error: CoreError) -> Response {
    if error.code == ErrorCode::Conflict {
        let current_revision = error
            .details
            .first()
            .and_then(|detail| detail.strip_prefix("current_revision="))
            .filter(|value| *value != "null")
            .map(str::to_string);
        return (
            StatusCode::CONFLICT,
            Json(contract::StorageConflict { current_revision }),
        )
            .into_response();
    }
    let status = match error.code {
        ErrorCode::Conflict => StatusCode::CONFLICT,
        ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
        ErrorCode::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    super::http::error_response(status, error)
}

pub(super) async fn list(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(app_id): Path<String>,
    Query(query): Query<AppValueListQuery>,
) -> Response {
    match state.device_account_id(&device.0).and_then(|account| {
        if let Some(prefix) = query.prefix.as_deref() {
            state
                .list_app_value_collection(&account, &app_id, prefix, query.workspace_id.as_deref())
                .map(|items| {
                    serde_json::to_value(items).map_err(|_| CoreError::new(ErrorCode::Server))
                })
                .and_then(|value| value)
        } else {
            state.list_app_values(&account, &app_id).and_then(|items| {
                serde_json::to_value(items).map_err(|_| CoreError::new(ErrorCode::Server))
            })
        }
    }) {
        Ok(items) => Json(items).into_response(),
        Err(error) => response_error(error),
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct AppValueListQuery {
    prefix: Option<String>,
    workspace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct AppValueMoveQuery {
    workspace_id: Option<String>,
}

pub(super) async fn move_collection_http(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(app_id): Path<String>,
    Query(query): Query<AppValueMoveQuery>,
    Json(request): Json<contract::AppValueMoveRequest>,
) -> Response {
    match state.device_account_id(&device.0).and_then(|account| {
        move_collection(
            &state,
            &account,
            &app_id,
            request,
            query.workspace_id.as_deref(),
        )
    }) {
        Ok(reply) => Json(reply).into_response(),
        Err(error) => response_error(error),
    }
}
pub(super) async fn read(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, key)): Path<(String, String)>,
    Query(query): Query<AppValueMoveQuery>,
) -> Response {
    match state.device_account_id(&device.0).and_then(|account| {
        state.read_app_value_with_workspace(&account, &app_id, &key, query.workspace_id.as_deref())
    }) {
        Ok(value) => Json(value).into_response(),
        Err(error) => response_error(error),
    }
}
pub(super) async fn write(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, key)): Path<(String, String)>,
    Json(request): Json<AppValueWrite>,
) -> Response {
    match state.device_account_id(&device.0).and_then(|account| {
        state.write_app_value(
            &account,
            &app_id,
            &key,
            request.kind,
            request.content,
            request.expected_revision.0,
            request.workspace_id.as_deref(),
        )
    }) {
        Ok(revision) => Json(contract::StorageWriteReply { revision }).into_response(),
        Err(error) => response_error(error),
    }
}
pub(super) async fn reset(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, key)): Path<(String, String)>,
    Query(query): Query<AppValueMoveQuery>,
    Json(request): Json<contract::StorageResetRequest>,
) -> Response {
    match state.device_account_id(&device.0).and_then(|account| {
        state.reset_app_value_with_workspace(
            &account,
            &app_id,
            &key,
            request.expected_revision.0,
            query.workspace_id.as_deref(),
        )
    }) {
        Ok(()) => Json(contract::StorageResetReply { revision: None }).into_response(),
        Err(error) => response_error(error),
    }
}
