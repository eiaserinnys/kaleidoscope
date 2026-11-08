//! 선언형/raw 앱 저장소가 함께 쓰는 문서 모음 SQL 경로.
use super::storage_target::StorageTarget;
use super::*;
use kaleidoscope_contract::app_storage as contract;

pub(super) fn list(
    db: &Connection,
    bucket_id: &str,
    prefix: &str,
    _entry_id: &str,
    kind: contract::StorageKind,
) -> Result<contract::CollectionListReply, CoreError> {
    let upper = format!("{prefix}0");
    let mut statement = db
        .prepare(
            "SELECT substr(key,length(?2)+2),revision,updated_at,\
             CASE kind WHEN 'md' THEN length(CAST(json_extract(content,'$') AS BLOB)) \
             ELSE length(CAST(content AS BLOB)) END \
             FROM app_storage_items WHERE bucket_id=?1 AND key>=?3 AND key<?4 AND kind=?5 ORDER BY key",
        )
        .map_err(|error| db_error_with(error, kaleidoscope_contract::errors::STORAGE_COLLECTION_LIST_DATABASE_FAILED(prefix)))?;
    let rows = statement
        .query_map(
            params![
                bucket_id,
                prefix,
                format!("{prefix}/"),
                upper,
                super::storage_items::kind_name(kind)
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|error| {
            db_error_with(
                error,
                kaleidoscope_contract::errors::STORAGE_COLLECTION_LIST_DATABASE_FAILED(prefix),
            )
        })?;
    let mut items = Vec::new();
    for row in rows {
        let (doc, revision, updated_at, byte_size) = row.map_err(|error| {
            db_error_with(
                error,
                kaleidoscope_contract::errors::STORAGE_COLLECTION_LIST_DATABASE_FAILED(prefix),
            )
        })?;
        let key = format!("{prefix}/{doc}");
        if !contract::collection_key_matches(prefix, &key) {
            continue;
        }
        items.push(contract::CollectionItem {
            doc,
            revision,
            updated_at,
            byte_size: byte_size.max(0) as u64,
        });
    }
    Ok(contract::CollectionListReply {
        bucket_id: bucket_id.to_string(),
        items,
    })
}

pub(super) fn read(
    db: &Connection,
    target: &StorageTarget,
    doc: &str,
    entry: &contract::StorageEntryDecl,
) -> Result<contract::StorageReadReply, CoreError> {
    match super::storage_items::load_item(db, &target.bucket_id, &target.key)? {
        Some(item) if item.kind == entry.kind => {
            contract::validate_storage_content(entry, &item.content)?;
            Ok(contract::StorageReadReply {
                kind: item.kind,
                content: item.content,
                revision: Some(item.revision),
                exists: true,
            })
        }
        Some(_) => Err(kaleidoscope_contract::errors::STORAGE_DOCUMENT_READ_KIND_MISMATCH(doc)),
        None => Err(kaleidoscope_contract::errors::STORAGE_DOCUMENT_READ_NOT_FOUND(doc)),
    }
}

pub(super) fn write(
    state: &AppState,
    target: &StorageTarget,
    entry: &contract::StorageEntryDecl,
    request_workspace: Option<&str>,
    doc: &str,
    content: Value,
    expected_revision: Option<String>,
) -> Result<(contract::StorageWriteReply, String, contract::StorageUpdate), CoreError> {
    contract::validate_storage_content(entry, &content)?;
    let mut db = state.lock_db()?;
    let tx = db.transaction().map_err(|error| {
        db_error_with(
            error,
            kaleidoscope_contract::errors::STORAGE_COLLECTION_WRITE_DATABASE_FAILED(doc),
        )
    })?;
    super::app_storage::check_workspace_owner(&tx, &target.account_id, request_workspace)?;
    let revision = super::storage_items::write_item(
        &tx,
        target,
        &content,
        expected_revision.as_deref(),
    )
    .map_err(|error| write_error(doc, error))?;
    tx.commit().map_err(|error| {
        db_error_with(
            error,
            kaleidoscope_contract::errors::STORAGE_COLLECTION_WRITE_DATABASE_FAILED(doc),
        )
    })?;
    let update = contract::StorageUpdate::Changed {
        changed: contract::StorageChanged {
            bucket_id: target.bucket_id.clone(),
            item: contract::StorageItemMeta {
                entry_id: entry.id.clone(),
                key: target.key.clone(),
                kind: entry.kind,
                revision: Some(revision.clone()),
                exists: true,
            },
        },
    };
    Ok((
        contract::StorageWriteReply { revision },
        target.account_id.clone(),
        update,
    ))
}

pub(super) fn reset(
    state: &AppState,
    target: &StorageTarget,
    entry: &contract::StorageEntryDecl,
    request_workspace: Option<&str>,
    doc: &str,
    expected_revision: Option<String>,
) -> Result<(contract::StorageResetReply, String, contract::StorageUpdate), CoreError> {
    let mut db = state.lock_db()?;
    let tx = db.transaction().map_err(|error| {
        db_error_with(
            error,
            kaleidoscope_contract::errors::STORAGE_COLLECTION_RESET_DATABASE_FAILED(doc),
        )
    })?;
    super::app_storage::check_workspace_owner(&tx, &target.account_id, request_workspace)?;
    super::storage_items::reset_item(&tx, target, expected_revision.as_deref())
        .map_err(|error| reset_error(doc, error))?;
    tx.commit().map_err(|error| {
        db_error_with(
            error,
            kaleidoscope_contract::errors::STORAGE_COLLECTION_RESET_DATABASE_FAILED(doc),
        )
    })?;
    let update = contract::StorageUpdate::Changed {
        changed: contract::StorageChanged {
            bucket_id: target.bucket_id.clone(),
            item: contract::StorageItemMeta {
                entry_id: entry.id.clone(),
                key: target.key.clone(),
                kind: entry.kind,
                revision: None,
                exists: false,
            },
        },
    };
    Ok((
        contract::StorageResetReply { revision: None },
        target.account_id.clone(),
        update,
    ))
}

pub(super) fn move_document(
    state: &AppState,
    from: &StorageTarget,
    to: &StorageTarget,
    entry: &contract::StorageEntryDecl,
    request: &contract::CollectionMove,
    request_workspace: Option<&str>,
) -> Result<
    (
        contract::CollectionMoveReply,
        String,
        contract::StorageUpdate,
        String,
        String,
    ),
    CoreError,
> {
    let mut db = state.lock_db()?;
    let tx = db.transaction().map_err(|error| {
        db_error_with(
            error,
            kaleidoscope_contract::errors::STORAGE_COLLECTION_MOVE_DATABASE_FAILED(&request.from),
        )
    })?;
    super::app_storage::check_workspace_owner(&tx, &from.account_id, request_workspace)?;
    let revision = super::storage_items::move_item(&tx, from, to, &request.expected_revision)
        .map_err(|error| move_error(request, error))?;
    tx.commit().map_err(|error| {
        db_error_with(
            error,
            kaleidoscope_contract::errors::STORAGE_COLLECTION_MOVE_DATABASE_FAILED(&request.from),
        )
    })?;
    let moved = contract::StorageMoved {
        bucket_id: from.bucket_id.clone(),
        entry_id: entry.id.clone(),
        from_doc: request.from.clone(),
        to_doc: request.to.clone(),
        revision: revision.clone(),
    };
    Ok((
        contract::CollectionMoveReply { revision },
        from.account_id.clone(),
        contract::StorageUpdate::Moved { moved },
        from.key.clone(),
        to.key.clone(),
    ))
}

fn write_error(doc: &str, error: super::storage_items::WriteItemError) -> CoreError {
    use super::storage_items::WriteItemError;
    match error {
        WriteItemError::Load(error) => error,
        WriteItemError::Conflict { current_revision } => {
            kaleidoscope_contract::errors::STORAGE_DOCUMENT_WRITE_CONFLICT(doc).and_details(vec![
                format!(
                    "current_revision={}",
                    current_revision.as_deref().unwrap_or("null")
                ),
            ])
        }
        WriteItemError::Revision => {
            kaleidoscope_contract::errors::STORAGE_DOCUMENT_REVISION_FAILED(doc)
        }
        WriteItemError::Serialize(message) => {
            kaleidoscope_contract::errors::STORAGE_DOCUMENT_SERIALIZATION_FAILED(doc)
                .and_details(vec![message])
        }
        WriteItemError::Database(error) => db_error_with(
            error,
            kaleidoscope_contract::errors::STORAGE_COLLECTION_WRITE_DATABASE_FAILED(doc),
        ),
    }
}

fn reset_error(doc: &str, error: super::storage_items::ResetItemError) -> CoreError {
    use super::storage_items::ResetItemError;
    match error {
        ResetItemError::Load(error) => error,
        ResetItemError::Conflict { current_revision } => {
            kaleidoscope_contract::errors::STORAGE_DOCUMENT_RESET_CONFLICT(doc).and_details(vec![
                format!(
                    "current_revision={}",
                    current_revision.as_deref().unwrap_or("null")
                ),
            ])
        }
        ResetItemError::Database(error) => db_error_with(
            error,
            kaleidoscope_contract::errors::STORAGE_COLLECTION_RESET_DATABASE_FAILED(doc),
        ),
    }
}

fn move_error(request: &contract::CollectionMove, error: super::storage_items::MoveItemError) -> CoreError {
    use super::storage_items::MoveItemError;
    match error {
        MoveItemError::Load(error) => error,
        MoveItemError::SourceNotFound => {
            kaleidoscope_contract::errors::STORAGE_DOCUMENT_MOVE_SOURCE_NOT_FOUND(&request.from)
        }
        MoveItemError::Conflict { revision } => {
            kaleidoscope_contract::errors::STORAGE_DOCUMENT_MOVE_CONFLICT(&request.from)
                .and_details(vec![format!("current_revision={revision}")])
        }
        MoveItemError::KindMismatch => {
            kaleidoscope_contract::errors::STORAGE_DOCUMENT_MOVE_KIND_MISMATCH(&request.from)
        }
        MoveItemError::TargetExists => {
            kaleidoscope_contract::errors::STORAGE_DOCUMENT_TARGET_EXISTS(&request.to)
        }
        MoveItemError::Database(error) => db_error_with(
            error,
            kaleidoscope_contract::errors::STORAGE_COLLECTION_MOVE_DATABASE_FAILED(&request.from),
        ),
    }
}
