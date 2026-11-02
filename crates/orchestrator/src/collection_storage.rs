//! 선언형/raw 앱 저장소가 함께 쓰는 문서 모음 SQL 경로.
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
        .map_err(db_error)?;
    let rows = statement
        .query_map(
            params![
                bucket_id,
                prefix,
                format!("{prefix}/"),
                upper,
                kind_name(kind)
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
        .map_err(db_error)?;
    let mut items = Vec::new();
    for row in rows {
        let (doc, revision, updated_at, byte_size) = row.map_err(db_error)?;
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

fn collection_key(prefix: &str, doc: &str) -> Result<String, CoreError> {
    if !contract::valid_collection_doc(doc) {
        return Err(CoreError::new(ErrorCode::InvalidRequest));
    }
    let key = format!("{prefix}/{doc}");
    if contract::collection_key_matches(prefix, &key) {
        Ok(key)
    } else {
        Err(CoreError::new(ErrorCode::InvalidRequest))
    }
}

pub(super) fn read(
    db: &Connection,
    bucket_id: &str,
    prefix: &str,
    doc: &str,
    entry: &contract::StorageEntryDecl,
) -> Result<contract::StorageReadReply, CoreError> {
    let key = collection_key(prefix, doc)?;
    match super::app_storage::load_item(db, bucket_id, &key)? {
        Some((kind, content, revision)) if kind == entry.kind => {
            contract::validate_storage_content(entry, &content)
                .map_err(|_| CoreError::new(ErrorCode::InvalidRequest))?;
            Ok(contract::StorageReadReply {
                kind,
                content,
                revision: Some(revision),
                exists: true,
            })
        }
        Some(_) => Err(server_error("저장 항목 kind가 선언과 다릅니다.")),
        None => Err(CoreError::new(ErrorCode::NotFound)),
    }
}

pub(super) fn write(
    state: &AppState,
    account_id: &str,
    app_id: &str,
    entry: &contract::StorageEntryDecl,
    prefix: &str,
    doc: &str,
    workspace_id: Option<&str>,
    content: Value,
    expected_revision: Option<String>,
) -> Result<(contract::StorageWriteReply, String, contract::StorageUpdate), CoreError> {
    let key = collection_key(prefix, doc)?;
    contract::validate_storage_content(entry, &content)
        .map_err(|error| CoreError::with_details(ErrorCode::InvalidRequest, vec![error]))?;
    let mut db = state.lock_db()?;
    let tx = db.transaction().map_err(db_error)?;
    super::app_storage::check_workspace_owner(&tx, account_id, workspace_id)?;
    let bucket = super::app_storage::bucket_id(account_id, app_id);
    let old = super::app_storage::load_item(&tx, &bucket, &key)?;
    let current = old.as_ref().map(|(_, _, revision)| revision.clone());
    if current != expected_revision {
        return Err(conflict(current.as_deref()));
    }
    let revision = contract::storage_revision(entry.kind, &content)
        .map_err(|_| CoreError::new(ErrorCode::InvalidRequest))?;
    tx.execute(
        "INSERT INTO app_storage_buckets(id,account_id,app_id) VALUES(?1,?2,?3) ON CONFLICT(account_id,app_id) DO NOTHING",
        params![bucket, account_id, app_id],
    )
    .map_err(db_error)?;
    tx.execute(
        "INSERT INTO app_storage_items(bucket_id,key,kind,content,revision,updated_at,workspace_id) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(bucket_id,key) DO UPDATE SET kind=excluded.kind,content=excluded.content,revision=excluded.revision,updated_at=excluded.updated_at,workspace_id=excluded.workspace_id",
        params![bucket,key,kind_name(entry.kind),serde_json::to_string(&content).map_err(|error|server_error(&error.to_string()))?,revision,timestamp(),workspace_id],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    let update = contract::StorageUpdate::Changed {
        changed: contract::StorageChanged {
            bucket_id: bucket,
            item: contract::StorageItemMeta {
                entry_id: entry.id.clone(),
                key,
                kind: entry.kind,
                revision: Some(revision.clone()),
                exists: true,
            },
        },
    };
    Ok((
        contract::StorageWriteReply { revision },
        account_id.to_string(),
        update,
    ))
}

pub(super) fn reset(
    state: &AppState,
    account_id: &str,
    app_id: &str,
    entry: &contract::StorageEntryDecl,
    prefix: &str,
    doc: &str,
    workspace_id: Option<&str>,
    expected_revision: Option<String>,
) -> Result<(contract::StorageResetReply, String, contract::StorageUpdate), CoreError> {
    let key = collection_key(prefix, doc)?;
    let mut db = state.lock_db()?;
    let tx = db.transaction().map_err(db_error)?;
    super::app_storage::check_workspace_owner(&tx, account_id, workspace_id)?;
    let bucket = super::app_storage::bucket_id(account_id, app_id);
    let old = super::app_storage::load_item(&tx, &bucket, &key)?;
    let current = old.as_ref().map(|(_, _, revision)| revision.clone());
    if current != expected_revision {
        return Err(conflict(current.as_deref()));
    }
    tx.execute(
        "DELETE FROM app_storage_items WHERE bucket_id=?1 AND key=?2",
        params![bucket, key],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    let update = contract::StorageUpdate::Changed {
        changed: contract::StorageChanged {
            bucket_id: bucket,
            item: contract::StorageItemMeta {
                entry_id: entry.id.clone(),
                key,
                kind: entry.kind,
                revision: None,
                exists: false,
            },
        },
    };
    Ok((
        contract::StorageResetReply { revision: None },
        account_id.to_string(),
        update,
    ))
}

pub(super) fn move_document(
    state: &AppState,
    account_id: &str,
    app_id: &str,
    entry: &contract::StorageEntryDecl,
    prefix: &str,
    request: &contract::CollectionMove,
    workspace_id: Option<&str>,
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
    let from_key = collection_key(prefix, &request.from)?;
    let to_key = collection_key(prefix, &request.to)?;
    let mut db = state.lock_db()?;
    let tx = db.transaction().map_err(db_error)?;
    super::app_storage::check_workspace_owner(&tx, account_id, workspace_id)?;
    let bucket = super::app_storage::bucket_id(account_id, app_id);
    let source = super::app_storage::load_item(&tx, &bucket, &from_key)?;
    let Some((kind, _content, revision)) = source else {
        return Err(CoreError::new(ErrorCode::NotFound));
    };
    if revision != request.expected_revision {
        return Err(conflict(Some(&revision)));
    }
    if kind != entry.kind {
        return Err(server_error("저장 항목 kind가 선언과 다릅니다."));
    }
    if super::app_storage::load_item(&tx, &bucket, &to_key)?.is_some() {
        return Err(conflict(None));
    }
    tx.execute(
        "UPDATE app_storage_items SET key=?3 WHERE bucket_id=?1 AND key=?2",
        params![bucket, from_key, to_key],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    let moved = contract::StorageMoved {
        bucket_id: bucket,
        entry_id: entry.id.clone(),
        from_doc: request.from.clone(),
        to_doc: request.to.clone(),
        revision: revision.clone(),
    };
    Ok((
        contract::CollectionMoveReply { revision },
        account_id.to_string(),
        contract::StorageUpdate::Moved { moved },
        from_key,
        to_key,
    ))
}

fn conflict(current: Option<&str>) -> CoreError {
    CoreError {
        code: ErrorCode::Conflict,
        message: "저장 항목이 다른 곳에서 바뀌었습니다.".into(),
        details: vec![format!("current_revision={}", current.unwrap_or("null"))],
    }
}

fn kind_name(kind: contract::StorageKind) -> &'static str {
    match kind {
        contract::StorageKind::Json => "json",
        contract::StorageKind::Md => "md",
    }
}
