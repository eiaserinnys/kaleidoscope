//! 저장 행의 소유 작업 공간을 선언에서 다시 계산하는 마이그레이션 20.
use super::*;
use kaleidoscope_contract::app_storage as contract;

pub(super) fn migrate(db: &Connection) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    let rows = {
        let mut statement = tx.prepare(
            "SELECT i.bucket_id,i.key,b.app_id FROM app_storage_items i \
             JOIN app_storage_buckets b ON b.id=i.bucket_id ORDER BY i.bucket_id,i.key",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (bucket_id, key, app_id) in rows {
        let Some(ownership) = declared_ownership(&tx, &app_id, &key)? else {
            continue;
        };
        tx.execute(
            "UPDATE app_storage_items SET workspace_id = ?3 WHERE bucket_id = ?1 AND key = ?2",
            params![bucket_id, key, ownership],
        )?;
    }
    tx.pragma_update(
        None,
        "user_version",
        super::storage::STORAGE_SCOPE_SCHEMA_VERSION,
    )?;
    tx.commit()
}

/// 행의 소유 작업 공간을 정한다.
/// `None`은 선언을 읽을 수 없어 기존 소유 값을 유지한다는 뜻이고,
/// `Some(None)`은 선언상 계정 공용, `Some(Some(id))`는 그 작업 공간 소유다.
fn declared_ownership(
    db: &Connection,
    app_id: &str,
    key: &str,
) -> rusqlite::Result<Option<Option<String>>> {
    if kaleidoscope_contract::builtin::is_builtin(app_id) {
        let storage: Option<Option<String>> = db
            .query_row(
                "SELECT storage_json FROM builtin_app_specs WHERE app_id=?1",
                [app_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(storage) = storage else {
            return Ok(None);
        };
        let storage: Option<contract::StorageDecl> = storage
            .map(|raw| serde_json::from_str(&raw).map_err(|_| rusqlite::Error::InvalidQuery))
            .transpose()?;
        return Ok(Some(storage_ownership(storage.as_ref(), key)));
    }
    let raw: Option<String> = db
        .query_row(
            "SELECT v.definition FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE a.id=?1",
            [app_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(raw) = raw else {
        return Ok(Some(None));
    };
    let Ok(definition) = serde_json::from_str::<AppDefinition>(&raw) else {
        return Ok(Some(None));
    };
    Ok(Some(storage_ownership(definition.storage.as_ref(), key)))
}

/// 실제 키와 맞는 첫 선언을 찾아 그 선언의 `{workspace_id}` 자리에 들어온 값을 돌려준다.
/// 자리 표시가 없는 선언이나 선언과 맞지 않는 키는 계정 공용으로 본다.
fn storage_ownership(storage: Option<&contract::StorageDecl>, key: &str) -> Option<String> {
    let storage = storage?;
    storage
        .entries
        .iter()
        .find_map(|entry| {
            let matched = if entry.collection {
                contract::collection_key_matches_template(&entry.key, key)
            } else {
                contract::storage_key_matches(&entry.key, key)
            };
            if !matched {
                return None;
            }
            Some(workspace_ownership(entry, key))
        })
        .flatten()
}

/// 자리 표시 위치의 실제 값을 꺼내 기존 리졸버로 다시 검증한다.
fn workspace_ownership(entry: &contract::StorageEntryDecl, key: &str) -> Option<String> {
    let workspace = super::storage_target::declared_workspace(entry, key)?;
    let resolved = super::app_storage::resolve_key(entry, Some(&workspace)).ok()?;
    let matched = if entry.collection {
        contract::collection_key_matches(&resolved, key)
    } else {
        resolved == key
    };
    matched.then_some(workspace)
}
