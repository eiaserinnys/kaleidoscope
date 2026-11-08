//! 저장 항목 행의 실제 SQL. 리비전 비교, 직렬화, 버킷 생성, 쓰기·초기화·이동·작업 공간 삭제를
//! 한 곳에서 수행하고, 실패는 자리별 오류로 바꿀 수 있는 내부 결과로 돌려준다.
use super::storage_target::StorageTarget;
use super::*;
use kaleidoscope_contract::app_storage as contract;

/// 저장 행 하나. `kind`는 저장된 값의 종류이고 `revision`은 그 값의 해시다.
pub(super) struct StoredItem {
    pub(super) kind: contract::StorageKind,
    pub(super) content: Value,
    pub(super) revision: String,
}

pub(super) fn kind_name(kind: contract::StorageKind) -> &'static str {
    match kind {
        contract::StorageKind::Json => "json",
        contract::StorageKind::Md => "md",
    }
}

/// 버킷과 키로 저장 행을 읽는다. 선언이 없는 raw 읽기도 같은 함수를 쓴다.
pub(super) fn load_item(
    db: &Connection,
    bucket_id: &str,
    key: &str,
) -> Result<Option<StoredItem>, CoreError> {
    let row: Option<(String, String, String)> = db
        .query_row(
            "SELECT kind,content,revision FROM app_storage_items WHERE bucket_id=?1 AND key=?2",
            params![bucket_id, key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| {
            db_error_with(
                error,
                kaleidoscope_contract::errors::STORAGE_ITEM_LOAD_DATABASE_FAILED(key),
            )
        })?;
    row.map(|(kind, content, revision)| {
        let kind = serde_json::from_str(&format!("\"{kind}\""))
            .map_err(|_| kaleidoscope_contract::errors::STORAGE_STORED_KIND_INVALID(key))?;
        let content = serde_json::from_str(&content)
            .map_err(|_| kaleidoscope_contract::errors::STORAGE_STORED_CONTENT_INVALID(key))?;
        Ok(StoredItem {
            kind,
            content,
            revision,
        })
    })
    .transpose()
}

pub(super) enum WriteItemError {
    Load(CoreError),
    Conflict {
        current_revision: Option<String>,
    },
    Revision,
    Serialize(String),
    Database(rusqlite::Error),
}

impl From<CoreError> for WriteItemError {
    fn from(error: CoreError) -> Self {
        WriteItemError::Load(error)
    }
}

/// 기대 리비전과 비교한 뒤 버킷을 보장하고 행을 UPSERT한다. `workspace_id`는 target의 소유 값으로
/// 새 행과 기존 행 모두에 기록한다.
pub(super) fn write_item(
    tx: &Transaction<'_>,
    target: &StorageTarget,
    content: &Value,
    expected_revision: Option<&str>,
) -> Result<String, WriteItemError> {
    let current = load_item(tx, &target.bucket_id, &target.key)?;
    if current.as_ref().map(|item| item.revision.as_str()) != expected_revision {
        return Err(WriteItemError::Conflict {
            current_revision: current.map(|item| item.revision),
        });
    }
    let revision = contract::storage_revision(target.kind, content)
        .map_err(|_| WriteItemError::Revision)?;
    let serialized = serde_json::to_string(content)
        .map_err(|error| WriteItemError::Serialize(error.to_string()))?;
    tx.execute(
        "INSERT INTO app_storage_buckets(id,account_id,app_id) VALUES(?1,?2,?3) ON CONFLICT(account_id,app_id) DO NOTHING",
        params![target.bucket_id, target.account_id, target.app_id],
    )
    .map_err(WriteItemError::Database)?;
    tx.execute(
        "INSERT INTO app_storage_items(bucket_id,key,kind,content,revision,updated_at,workspace_id) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(bucket_id,key) DO UPDATE SET kind=excluded.kind,content=excluded.content,revision=excluded.revision,updated_at=excluded.updated_at,workspace_id=excluded.workspace_id",
        params![
            target.bucket_id,
            target.key,
            kind_name(target.kind),
            serialized,
            revision,
            timestamp(),
            target.scope.workspace_id()
        ],
    )
    .map_err(WriteItemError::Database)?;
    Ok(revision)
}

pub(super) enum ResetItemError {
    Load(CoreError),
    Conflict {
        current_revision: Option<String>,
    },
    Database(rusqlite::Error),
}

impl From<CoreError> for ResetItemError {
    fn from(error: CoreError) -> Self {
        ResetItemError::Load(error)
    }
}

/// 기대 리비전과 비교한 뒤 행을 지우고, 지운 행이 있으면 그 값을 돌려준다.
pub(super) fn reset_item(
    tx: &Transaction<'_>,
    target: &StorageTarget,
    expected_revision: Option<&str>,
) -> Result<Option<StoredItem>, ResetItemError> {
    let current = load_item(tx, &target.bucket_id, &target.key)?;
    if current.as_ref().map(|item| item.revision.as_str()) != expected_revision {
        return Err(ResetItemError::Conflict {
            current_revision: current.map(|item| item.revision),
        });
    }
    tx.execute(
        "DELETE FROM app_storage_items WHERE bucket_id=?1 AND key=?2",
        params![target.bucket_id, target.key],
    )
    .map_err(ResetItemError::Database)?;
    Ok(current)
}

pub(super) enum MoveItemError {
    Load(CoreError),
    SourceNotFound,
    Conflict {
        revision: String,
    },
    KindMismatch,
    TargetExists,
    Database(rusqlite::Error),
}

impl From<CoreError> for MoveItemError {
    fn from(error: CoreError) -> Self {
        MoveItemError::Load(error)
    }
}

/// 원본 행의 본문과 리비전을 그대로 둔 채 키와 소유 값만 옮긴다.
pub(super) fn move_item(
    tx: &Transaction<'_>,
    from: &StorageTarget,
    to: &StorageTarget,
    expected_revision: &str,
) -> Result<String, MoveItemError> {
    let Some(source) = load_item(tx, &from.bucket_id, &from.key)? else {
        return Err(MoveItemError::SourceNotFound);
    };
    if source.revision != expected_revision {
        return Err(MoveItemError::Conflict {
            revision: source.revision,
        });
    }
    if source.kind != to.kind {
        return Err(MoveItemError::KindMismatch);
    }
    if load_item(tx, &to.bucket_id, &to.key)?.is_some() {
        return Err(MoveItemError::TargetExists);
    }
    tx.execute(
        "UPDATE app_storage_items SET key=?3, workspace_id=?4 WHERE bucket_id=?1 AND key=?2",
        params![
            from.bucket_id,
            from.key,
            to.key,
            to.scope.workspace_id()
        ],
    )
    .map_err(MoveItemError::Database)?;
    Ok(source.revision)
}

/// 작업 공간 소유로 기록된 저장 행 하나.
pub(super) struct DeletedItem {
    pub(super) app_id: String,
    pub(super) bucket_id: String,
    pub(super) key: String,
    pub(super) kind: contract::StorageKind,
    /// 선언에서 해석한 항목 ID. 선언이 없거나 유효하지 않으면 `None`.
    pub(super) entry_id: Option<String>,
}

pub(super) enum DeleteItemsError {
    Database(rusqlite::Error),
    KindUnknown(String, String),
}

/// 계정 안에서 `workspace_id`를 소유자로 기록한 저장 행을 한 번에 모아 지운다.
/// 어떤 행이 그 작업 공간 소유인지는 선언 키가 아니라 `workspace_id` 열이 정본이다.
pub(super) fn delete_workspace_items(
    tx: &Transaction<'_>,
    account_id: &str,
    workspace_id: &str,
) -> Result<Vec<DeletedItem>, DeleteItemsError> {
    let mut statement = tx
        .prepare(
            "SELECT b.app_id,b.id,i.key,i.kind,a.id,v.definition \
             FROM app_storage_items i \
             JOIN app_storage_buckets b ON b.id=i.bucket_id \
             LEFT JOIN apps a ON a.id=b.app_id \
             LEFT JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version \
             WHERE b.account_id=?1 AND i.workspace_id=?2 \
             ORDER BY b.app_id,i.key",
        )
        .map_err(DeleteItemsError::Database)?;
    let rows = statement
        .query_map(params![account_id, workspace_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(DeleteItemsError::Database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(DeleteItemsError::Database)?;
    drop(statement);
    tx.execute(
        "DELETE FROM app_storage_items WHERE workspace_id=?1 AND bucket_id IN (SELECT id FROM app_storage_buckets WHERE account_id=?2)",
        params![workspace_id, account_id],
    )
    .map_err(DeleteItemsError::Database)?;
    rows.into_iter()
        .map(|(app_id, bucket_id, key, kind, app_row, raw_definition)| {
            let kind = match kind.as_str() {
                "json" => contract::StorageKind::Json,
                "md" => contract::StorageKind::Md,
                _ => return Err(DeleteItemsError::KindUnknown(key, kind)),
            };
            let definition = app_row
                .and(raw_definition)
                .and_then(|raw| serde_json::from_str::<AppDefinition>(&raw).ok());
            let entry_id = definition
                .as_ref()
                .and_then(|definition| declared_workspace_entry_id(definition, workspace_id, &key));
            Ok(DeletedItem {
                app_id,
                bucket_id,
                key,
                kind,
                entry_id,
            })
        })
        .collect()
}

/// 실제 키가 `{workspace_id}` 자리를 가진 선언과 맞으면 그 항목 ID를 돌려준다.
fn declared_workspace_entry_id(
    definition: &AppDefinition,
    workspace_id: &str,
    key: &str,
) -> Option<String> {
    definition
        .storage
        .as_ref()
        .and_then(|storage| {
            storage.entries.iter().find(|entry| {
                if !entry.key.contains("{workspace_id}") {
                    return false;
                }
                let resolved = entry.key.replace("{workspace_id}", workspace_id);
                if entry.collection {
                    key.strip_prefix(&format!("{resolved}/"))
                        .is_some_and(contract::valid_collection_doc)
                } else {
                    resolved == key && contract::storage_key_matches(&entry.key, key)
                }
            })
        })
        .map(|entry| entry.id.clone())
}
