use super::*;
use kaleidoscope_contract::{migrate_window_state, AppWindow};

fn move_app_windows(
    tx: &Transaction<'_>,
    definition: &AppDefinition,
    version: u32,
    now: &str,
) -> Result<Vec<AppWindow>, CoreError> {
    let rows = {
        let mut statement = tx
            .prepare("SELECT id,data FROM windows WHERE app_id=?1 ORDER BY created_at,id")
            .map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::SERVER_APP_PUBLISH_DATABASE_FAILED(
                        &definition.id,
                    ),
                )
            })?;
        let rows = statement
            .query_map([&definition.id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::SERVER_APP_PUBLISH_DATABASE_FAILED(
                        &definition.id,
                    ),
                )
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::SERVER_APP_PUBLISH_DATABASE_FAILED(
                        &definition.id,
                    ),
                )
            })?;
        rows
    };
    let mut moved = Vec::with_capacity(rows.len());
    for (id, raw) in rows {
        let mut window: AppWindow = serde_json::from_str(&raw).map_err(|error| {
            kaleidoscope_contract::errors::SERVER_APP_PUBLISH_WINDOW_STATE_INVALID(&id)
                .and_details(vec![error.to_string()])
        })?;
        window.state = migrate_window_state(definition, &window.state);
        window.app_version = version;
        window.updated_at = now.to_string();
        let data = serde_json::to_string(&window).map_err(|error| {
            kaleidoscope_contract::errors::SERVER_APP_PUBLISH_WINDOW_STATE_SERIALIZE_FAILED(
                &window.id,
            )
            .and_details(vec![error.to_string()])
        })?;
        tx.execute("UPDATE windows SET data=?2 WHERE id=?1", params![id, data])
            .map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::SERVER_APP_PUBLISH_DATABASE_FAILED(
                        &definition.id,
                    ),
                )
            })?;
        moved.push(window);
    }
    Ok(moved)
}

/// 일반 게시와 기기 설치가 같은 트랜잭션에서 자산과 판을 처리한다.
pub(super) fn publish_transaction(
    tx: &Transaction<'_>,
    definition: &AppDefinition,
    uploads: &[kaleidoscope_contract::assets::AssetUpload],
    account_id: &str,
    now: &str,
    created_by: &str,
    guard: Option<&super::registry_install::InstallGuard>,
) -> Result<(bool, Vec<AppWindow>, bool, bool), CoreError> {
    use super::registry_install::{check_guard, read_installation, Installation};
    let db_error = |error| publish_database_error(error, &definition.id, guard.is_some());
    let current: Option<(u32, String, Option<String>, Option<String>)> = tx.query_row(
        "SELECT a.current_version,v.definition,a.deleted_at,a.installation_json FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE a.id=?1",
        [&definition.id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).optional().map_err(db_error)?;
    let revived = current
        .as_ref()
        .is_some_and(|(_, _, deleted, _)| deleted.is_some());
    let installation = read_installation(
        current.as_ref().and_then(|(_, _, _, raw)| raw.clone()),
        &definition.id,
    )?;
    if let Some(guard) = guard {
        let active = current
            .as_ref()
            .filter(|(_, _, deleted, _)| deleted.is_none())
            .map(|(version, _, _, _)| (*version, installation.as_ref()));
        if check_guard(guard, active, &definition.id)? {
            return Ok((true, Vec::new(), false, false));
        }
    }
    for upload in uploads {
        let asset = super::assets::prepare(upload)?;
        super::assets::insert(tx, account_id, &asset)?;
    }
    super::assets::verify_dependencies(tx, account_id, &definition.assets)?;
    super::assets::verify_client_entry(tx, account_id, definition)?;
    super::assets::verify_icon(tx, account_id, definition)?;
    let mut migrated_windows = Vec::new();
    let (version, unchanged) = if let Some((version, stored, _, _)) = current {
        let previous: AppDefinition = serde_json::from_str(&stored).map_err(|error| {
            kaleidoscope_contract::errors::SERVER_APP_PUBLISH_STORED_DEFINITION_JSON_INVALID(
                &definition.id,
            )
            .and_details(vec![error.to_string()])
        })?;
        if previous == *definition {
            (version, true)
        } else {
            super::app_storage::validate_storage_publish(
                tx,
                &definition.id,
                &previous,
                definition,
            )?;
            let version = version + 1;
            save_version(tx, definition, version, now, created_by).map_err(db_error)?;
            tx.execute(
                "UPDATE apps SET name=?2,current_version=?3,updated_at=?4 WHERE id=?1",
                params![definition.id, definition.name, version, now],
            )
            .map_err(db_error)?;
            migrated_windows = move_app_windows(tx, definition, version, now)?;
            (version, false)
        }
    } else {
        tx.execute(
            "INSERT INTO apps(id,name,current_version,created_at,updated_at) VALUES(?1,?2,1,?3,?3)",
            params![definition.id, definition.name, now],
        )
        .map_err(db_error)?;
        save_version(tx, definition, 1, now, created_by).map_err(db_error)?;
        (1, false)
    };
    if revived {
        tx.execute(
            "UPDATE apps SET deleted_at=NULL WHERE id=?1",
            [&definition.id],
        )
        .map_err(db_error)?;
    }
    let origin_changed = if let Some(guard) = guard {
        let installation = Installation {
            origin: guard.origin.clone(),
            installed_version: Some(version),
        };
        let raw = serde_json::to_string(&installation).map_err(|error| {
            kaleidoscope_contract::errors::REGISTRYINSTALL_DATABASE_FAILED(&definition.id)
                .and_details(vec![error.to_string()])
        })?;
        tx.execute(
            "UPDATE apps SET installation_json=?2 WHERE id=?1",
            params![definition.id, raw],
        )
        .map_err(|error| {
            db_error_with(
                error,
                kaleidoscope_contract::errors::REGISTRYINSTALL_DATABASE_FAILED(&definition.id),
            )
        })?;
        true
    } else {
        false
    };
    Ok((unchanged, migrated_windows, revived, origin_changed))
}

pub(super) fn published_app(
    tx: &Transaction<'_>,
    definition: &AppDefinition,
    installing: bool,
) -> Result<RegistryApp, CoreError> {
    let (name, version, created_at, updated_at, version_created_at, raw): (String, u32, String, String, String, Option<String>) = tx.query_row(
        "SELECT a.name,a.current_version,a.created_at,a.updated_at,v.created_at,a.installation_json FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE a.id=?1",
        [&definition.id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)),
    ).map_err(|error| publish_database_error(error, &definition.id, installing))?;
    let installation = super::registry_install::read_installation(raw, &definition.id)?;
    Ok(RegistryApp {
        app: App {
            id: definition.id.clone(),
            name,
            current_version: version,
            created_at,
            updated_at,
            origin: installation.as_ref().map(|item| item.origin.clone()),
            installed_version: installation.and_then(|item| item.installed_version),
        },
        version: AppVersion {
            app_id: definition.id.clone(),
            version,
            definition: definition.clone(),
            created_at: version_created_at,
        },
    })
}

pub(super) fn publish_database_error(
    error: rusqlite::Error,
    id: &str,
    installing: bool,
) -> CoreError {
    let response = if installing {
        kaleidoscope_contract::errors::REGISTRYINSTALL_DATABASE_FAILED(id)
    } else {
        kaleidoscope_contract::errors::SERVER_APP_PUBLISH_DATABASE_FAILED(id)
    };
    db_error_with(error, response)
}
