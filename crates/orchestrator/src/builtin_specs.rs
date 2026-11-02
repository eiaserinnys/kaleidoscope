//! 기기가 제공하는 기본 앱 실행 선언을 검증해 저장한다.
use super::*;
use axum::extract::{Extension, State};
use kaleidoscope_contract::worker::BuiltinRuntimeSpec;

fn definition(spec: &BuiltinRuntimeSpec) -> Result<AppDefinition, CoreError> {
    if !kaleidoscope_contract::builtin::is_builtin(&spec.app_id) {
        return Err(kaleidoscope_contract::errors::APP_BUILTIN_SPEC_APP_ID_INVALID(&spec.app_id));
    }
    if spec.version == 0 {
        return Err(
            kaleidoscope_contract::errors::APP_BUILTIN_SPEC_VERSION_INVALID(
                &spec.app_id,
                spec.version,
            ),
        );
    }
    let storage_version = if spec
        .storage
        .as_ref()
        .is_some_and(|storage| storage.entries.iter().any(|entry| entry.collection))
    {
        3
    } else {
        2
    };
    let value = json!({
        "id": spec.app_id, "name": spec.app_id,
        "requires": {"blocks": 6, "modules": {"storage": storage_version, "worker": 1}},
        "permissions": [], "state": {}, "ui": {"type": "text", "value": ""},
        "storage": spec.storage, "worker": spec.worker
    });
    parse_app_definition(&value.to_string())
}

fn save(db: &Connection, spec: &BuiltinRuntimeSpec) -> Result<(), CoreError> {
    definition(spec)?;
    let storage = spec
        .storage
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| {
            kaleidoscope_contract::errors::APP_BUILTIN_SPEC_STORAGE_SERIALIZE_FAILED(&spec.app_id)
                .and_details(vec![e.to_string()])
        })?;
    let worker = spec
        .worker
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| {
            kaleidoscope_contract::errors::APP_BUILTIN_SPEC_WORKER_SERIALIZE_FAILED(&spec.app_id)
                .and_details(vec![e.to_string()])
        })?;
    db.execute("INSERT INTO builtin_app_specs(app_id,version,storage_json,worker_json,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(app_id) DO UPDATE SET version=excluded.version,storage_json=excluded.storage_json,worker_json=excluded.worker_json,updated_at=excluded.updated_at WHERE excluded.version >= builtin_app_specs.version", params![spec.app_id, spec.version, storage, worker, timestamp()]).map_err(db_error)?;
    Ok(())
}

impl AppState {
    pub fn register_builtin_specs(&self, specs: &[BuiltinRuntimeSpec]) -> Result<(), CoreError> {
        for spec in specs {
            definition(spec)?;
        }
        let db = self.lock_db()?;
        let tx = db.unchecked_transaction().map_err(db_error)?;
        for spec in specs {
            save(&tx, spec)?;
        }
        tx.commit().map_err(db_error)
    }

    pub(super) fn builtin_entry(
        &self,
        app: &str,
        id_or_key: &str,
        workspace: Option<&str>,
    ) -> Result<(kaleidoscope_contract::app_storage::StorageEntryDecl, String), CoreError> {
        let db = self.lock_db()?;
        let definition = load_definition(&db, app)?
            .ok_or_else(|| kaleidoscope_contract::errors::APP_BUILTIN_SPEC_NOT_FOUND(app))?;
        let entry = definition
            .storage
            .as_ref()
            .and_then(|s| {
                s.entries.iter().find(|entry| {
                    entry.id == id_or_key
                        || entry.key == id_or_key
                        || kaleidoscope_contract::app_storage::storage_key_matches(
                            &entry.key, id_or_key,
                        )
                })
            })
            .ok_or_else(|| {
                kaleidoscope_contract::errors::APP_BUILTIN_STORAGE_ENTRY_NOT_DECLARED(
                    app, id_or_key,
                )
            })?;
        let key = super::app_storage::resolve_key(entry, workspace)?;
        if id_or_key != entry.id && id_or_key != entry.key && id_or_key != key {
            return Err(
                kaleidoscope_contract::errors::APP_BUILTIN_STORAGE_KEY_MISMATCH(app, id_or_key),
            );
        }
        Ok((entry.clone(), key))
    }

    pub(super) fn builtin_collection_prefix(
        &self,
        app: &str,
        prefix: &str,
        workspace: Option<&str>,
    ) -> Result<(kaleidoscope_contract::app_storage::StorageEntryDecl, String), CoreError> {
        let db = self.lock_db()?;
        let definition = load_definition(&db, app)?
            .ok_or_else(|| kaleidoscope_contract::errors::APP_BUILTIN_SPEC_NOT_FOUND(app))?;
        let entry = definition
            .storage
            .as_ref()
            .and_then(|storage| {
                storage.entries.iter().find(|entry| {
                    entry.collection
                        && super::app_storage::resolve_key(entry, workspace)
                            .is_ok_and(|resolved| resolved == prefix)
                })
            })
            .ok_or_else(|| {
                kaleidoscope_contract::errors::APP_BUILTIN_COLLECTION_NOT_DECLARED(app, prefix)
            })?;
        Ok((entry.clone(), prefix.to_string()))
    }

    pub(super) fn builtin_collection_for_key(
        &self,
        app: &str,
        key: &str,
        workspace: Option<&str>,
    ) -> Result<
        (
            kaleidoscope_contract::app_storage::StorageEntryDecl,
            String,
            String,
        ),
        CoreError,
    > {
        let db = self.lock_db()?;
        let definition = load_definition(&db, app)?
            .ok_or_else(|| kaleidoscope_contract::errors::APP_BUILTIN_SPEC_NOT_FOUND(app))?;
        let entry = definition
            .storage
            .as_ref()
            .and_then(|storage| {
                storage.entries.iter().find(|entry| {
                    if !entry.collection {
                        return false;
                    }
                    super::app_storage::resolve_key(entry, workspace).is_ok_and(|prefix| {
                        kaleidoscope_contract::app_storage::collection_key_matches(&prefix, key)
                    })
                })
            })
            .ok_or_else(|| {
                kaleidoscope_contract::errors::APP_BUILTIN_COLLECTION_NOT_DECLARED(app, key)
            })?;
        let prefix = super::app_storage::resolve_key(entry, workspace)?;
        let doc = key
            .strip_prefix(&prefix)
            .and_then(|tail| tail.strip_prefix('/'))
            .ok_or_else(|| {
                kaleidoscope_contract::errors::APP_BUILTIN_COLLECTION_KEY_INVALID(app, key)
            })?
            .to_string();
        Ok((entry.clone(), prefix, doc))
    }
}

pub(super) fn load_definition(
    db: &Connection,
    app_id: &str,
) -> Result<Option<AppDefinition>, CoreError> {
    let row: Option<(u32, Option<String>, Option<String>)> = db
        .query_row(
            "SELECT version,storage_json,worker_json FROM builtin_app_specs WHERE app_id=?1",
            [app_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db_error)?;
    if let Some((version, storage, worker)) = row {
        let storage: Option<kaleidoscope_contract::app_storage::StorageDecl> = storage
            .map(|raw| {
                serde_json::from_str(&raw).map_err(|e| {
                    kaleidoscope_contract::errors::APP_BUILTIN_SPEC_STORAGE_JSON_INVALID(app_id)
                        .and_details(vec![e.to_string()])
                })
            })
            .transpose()?;
        let worker: Option<kaleidoscope_contract::worker::WorkerDecl> = worker
            .map(|raw| {
                serde_json::from_str(&raw).map_err(|e| {
                    kaleidoscope_contract::errors::APP_BUILTIN_SPEC_WORKER_JSON_INVALID(app_id)
                        .and_details(vec![e.to_string()])
                })
            })
            .transpose()?;
        let spec: BuiltinRuntimeSpec = serde_json::from_value(
            json!({"app_id":app_id,"version":version,"storage":storage,"worker":worker}),
        )
        .map_err(|e| {
            kaleidoscope_contract::errors::APP_BUILTIN_SPEC_RECORD_INVALID(app_id)
                .and_details(vec![e.to_string()])
        })?;
        return definition(&spec).map(Some);
    }
    if std::env::var_os("KALEIDOSCOPE_EXCLUSION_CHILD").is_some() {
        return Ok(None);
    }
    let identity = match kaleidoscope_contract::builtin::builtin_identity(app_id) {
        Some(identity) => identity,
        None => return Ok(None),
    };
    let dirs = if let Some(dir) = std::env::var_os("KALEIDOSCOPE_BUILTIN_APPS_DIR") {
        vec![PathBuf::from(dir)]
    } else {
        vec![
            std::env::current_dir().unwrap_or_default().join("apps"),
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps"),
        ]
    };
    for dir in dirs {
        let path = dir.join(format!("{app_id}.json"));
        if !path.is_file() {
            continue;
        }
        let raw = std::fs::read_to_string(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                kaleidoscope_contract::errors::APP_BUILTIN_SPEC_FILE_READ_NOT_FOUND(app_id)
            } else {
                kaleidoscope_contract::errors::APP_BUILTIN_SPEC_FILE_READ_FAILED(app_id)
                    .and_details(vec![e.to_string()])
            }
        })?;
        let app = parse_app_definition(&raw)?;
        if app.id != app_id {
            return Err(
                kaleidoscope_contract::errors::APP_BUILTIN_SPEC_FILE_ID_MISMATCH(app_id, &app.id),
            );
        }
        let spec = BuiltinRuntimeSpec {
            app_id: app_id.into(),
            version: identity.version,
            storage: app.storage,
            worker: app.worker,
        };
        save(db, &spec)?;
        return definition(&spec).map(Some);
    }
    Ok(None)
}

pub(super) async fn device_register(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Json(specs): Json<Vec<BuiltinRuntimeSpec>>,
) -> Response {
    match state
        .device_account_id(&device.0)
        .and_then(|account| Ok(account == state.mcp_account_id()?))
    {
        Ok(true) => {}
        Ok(false) => {
            return super::http::error_response(
                StatusCode::FORBIDDEN,
                kaleidoscope_contract::errors::SERVER_HTTP_BUILTIN_SPECS_ACCOUNT_FORBIDDEN(),
            )
        }
        Err(error) => return super::http::error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
    match state.register_builtin_specs(&specs) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => super::http::error_response(StatusCode::BAD_REQUEST, error),
    }
}
