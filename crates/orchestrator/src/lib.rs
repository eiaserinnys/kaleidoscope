use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use chrono::{SecondsFormat, Utc};
use futures::{stream, Stream, StreamExt};
use kaleidoscope_contract::{
    registry::{
        self, DeviceEvent, DeviceUploadRequest, PairPollReply, PairPollRequest, PairStartReply,
        PairStartRequest, RegistryApp,
    },
    validate::parse_app_definition,
    App, AppDefinition, AppVersion, CoreError, ErrorCode, Requires, Supported,
    LEGACY_BLOCK_SET_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use schemars::{Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, Mutex as AsyncMutex};
use uuid::Uuid;

#[cfg(test)]
fn test_definition(raw: &str) -> String {
    let definition: Value = serde_json::from_str(raw).unwrap();
    let id = definition["id"].as_str().unwrap();
    raw.replacen(
        &format!("\"id\": \"{id}\""),
        &format!("\"id\": \"test-{id}\""),
        1,
    )
}

const EVENT_BUFFER: usize = 64;

pub(crate) fn renders_on(supported: Option<&Supported>, requires: &Requires) -> bool {
    match supported {
        Some(supported) => supported.renders(requires),
        None => requires.blocks <= LEGACY_BLOCK_SET_VERSION,
    }
}

pub(crate) fn renders_definition_on(
    supported: Option<&Supported>,
    definition: &AppDefinition,
) -> bool {
    match supported {
        Some(supported) => renders_requirements(
            Some(supported),
            &effective_client_requires(definition),
            &definition.assets,
        ),
        None => {
            definition.assets.is_empty() && definition.requires.blocks <= LEGACY_BLOCK_SET_VERSION
        }
    }
}

pub(crate) fn effective_client_requires(definition: &AppDefinition) -> Requires {
    let mut requires = definition.requires.clone();
    if !kaleidoscope_contract::data::ui_uses_worker_action(definition) {
        requires.modules.remove("worker");
    }
    requires
}

pub(crate) fn app_for_client(mut app: RegistryApp, supported: Option<&Supported>) -> RegistryApp {
    if !supported
        .and_then(|support| support.modules.get("worker"))
        .is_some_and(|version| *version >= 1)
        && !kaleidoscope_contract::data::ui_uses_worker_action(&app.version.definition)
    {
        app.version.definition.worker = None;
        app.version.definition.requires.modules.remove("worker");
    }
    app
}

fn renders_requirements(
    supported: Option<&Supported>,
    requires: &Requires,
    assets: &[kaleidoscope_contract::assets::AssetDep],
) -> bool {
    renders_on(supported, requires)
        && assets
            .iter()
            .filter(|asset| asset.id.starts_with("builtin-"))
            .all(|asset| supported.is_some_and(|supported| supported.assets.contains(asset)))
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

#[derive(Clone, Debug, Default)]
pub(crate) struct McpPrincipal {
    pub(crate) device_id: Option<String>,
    pub(crate) workspace_id: Option<String>,
}

struct Inner {
    db: Mutex<Connection>,
    events: broadcast::Sender<Broadcast>,
    connections: Mutex<HashMap<String, usize>>,
    shares: Mutex<share::ShareStore>,
    device_support: Mutex<HashMap<String, Option<Supported>>>,
    layout_sync_devices: Mutex<HashSet<String>>,
    storage_devices: Mutex<HashSet<String>>,
    app_value_devices: Mutex<HashSet<String>>,
    device_workspaces: Mutex<HashMap<String, HashSet<String>>>,
    pairings: AsyncMutex<HashMap<String, Pairing>>,
    mcp_token: String,
    db_path: Option<PathBuf>,
    workers: worker::WorkerState,
}

#[derive(Clone)]
struct Broadcast {
    event: DeviceEvent,
    open_target: Option<String>,
    strict_open_target: bool,
    account_id: Option<String>,
}

#[derive(Clone)]
struct Pairing {
    device_name: String,
    user_code: String,
    expires_at_unix: i64,
    approved: Option<(String, String)>,
}

#[derive(Debug, Serialize)]
struct AppSummary {
    id: String,
    name: String,
    description: Option<String>,
    current_version: u32,
    updated_at: String,
    builtin: bool,
    definition_available: bool,
}

#[derive(Debug, Serialize)]
struct DeviceSummary {
    id: String,
    name: String,
    created_at: String,
    last_seen_at: Option<String>,
    connected: bool,
    revoked: bool,
}

impl AppState {
    pub fn open(db_path: impl AsRef<Path>, mcp_token: String) -> Result<Self, String> {
        let path = db_path.as_ref().to_path_buf();
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("데이터 폴더를 만들 수 없습니다: {e}"))?;
        }
        let connection =
            Connection::open(&path).map_err(|e| format!("데이터베이스를 열 수 없습니다: {e}"))?;
        Self::from_connection(connection, mcp_token, Some(path))
    }

    #[cfg(test)]
    fn in_memory(mcp_token: &str) -> Self {
        Self::from_connection(
            Connection::open_in_memory().unwrap(),
            mcp_token.to_string(),
            None,
        )
        .unwrap()
    }

    fn from_connection(
        connection: Connection,
        mcp_token: String,
        db_path: Option<PathBuf>,
    ) -> Result<Self, String> {
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("SQLite WAL을 설정할 수 없습니다: {e}"))?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| format!("SQLite foreign_keys를 설정할 수 없습니다: {e}"))?;
        migrate(&connection).map_err(|e| format!("데이터베이스를 준비할 수 없습니다: {e}"))?;
        let device_workspaces = layouts::load_device_workspaces(&connection)
            .map_err(|e| format!("기기 배치를 읽을 수 없습니다: {e}"))?;
        let (events, _) = broadcast::channel(EVENT_BUFFER);
        Ok(Self(Arc::new(Inner {
            db: Mutex::new(connection),
            events,
            connections: Mutex::new(HashMap::new()),
            shares: Mutex::new(share::ShareStore::default()),
            device_support: Mutex::new(HashMap::new()),
            layout_sync_devices: Mutex::new(HashSet::new()),
            storage_devices: Mutex::new(HashSet::new()),
            app_value_devices: Mutex::new(HashSet::new()),
            device_workspaces: Mutex::new(device_workspaces),
            pairings: AsyncMutex::new(HashMap::new()),
            mcp_token,
            db_path,
            workers: worker::WorkerState::default(),
        })))
    }

    pub fn db_path(&self) -> Option<&Path> {
        self.0.db_path.as_deref()
    }

    fn lock_db(&self) -> Result<std::sync::MutexGuard<'_, Connection>, CoreError> {
        self.0
            .db
            .lock()
            .map_err(|_| server_error("데이터베이스 잠금을 얻을 수 없습니다."))
    }

    fn mcp_account_id(&self) -> Result<String, CoreError> {
        self.lock_db()?
            .query_row(
                "SELECT account_id FROM mcp_principal WHERE id=1",
                [],
                |row| row.get(0),
            )
            .map_err(db_error)
    }

    fn mcp_device_ids(&self) -> HashSet<String> {
        let Ok(account_id) = self.mcp_account_id() else {
            return HashSet::new();
        };
        let Ok(db) = self.lock_db() else {
            return HashSet::new();
        };
        let Ok(mut statement) = db.prepare("SELECT id FROM devices WHERE account_id=?1") else {
            return HashSet::new();
        };
        statement
            .query_map([account_id], |row| row.get(0))
            .ok()
            .and_then(|rows| rows.collect::<rusqlite::Result<HashSet<_>>>().ok())
            .unwrap_or_default()
    }

    fn device_account_id(&self, device_id: &str) -> Result<String, CoreError> {
        self.lock_db()?
            .query_row(
                "SELECT account_id FROM devices WHERE id=?1",
                [device_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?
            .ok_or_else(|| server_error("기기를 찾을 수 없습니다."))
    }

    fn device_owns_workspace(
        &self,
        device_id: &str,
        workspace_id: &str,
    ) -> Result<bool, CoreError> {
        let db = self.lock_db()?;
        let owned: bool = db
            .query_row(
                "SELECT EXISTS(
                     SELECT 1 FROM devices d JOIN workspaces w ON w.account_id=d.account_id
                     WHERE d.id=?1 AND w.id=?2
                 ) OR EXISTS(
                     SELECT 1 FROM devices d JOIN legacy_workspace_owners o ON o.account_id=d.account_id
                     WHERE d.id=?1 AND o.workspace_id=?2
                       AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=?2)
                 )",
                params![device_id, workspace_id],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        Ok(owned)
    }

    fn mcp_owns_workspace(&self, workspace_id: &str) -> Result<bool, CoreError> {
        let db = self.lock_db()?;
        db.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces w JOIN mcp_principal p ON p.account_id=w.account_id WHERE p.id=1 AND w.id=?1)",
            [workspace_id],
            |row| row.get(0),
        ).map_err(db_error)
    }

    fn device_can_render_app(&self, device_id: &str, definition: &AppDefinition) -> bool {
        let support = self
            .0
            .device_support
            .lock()
            .ok()
            .and_then(|devices| devices.get(device_id).cloned())
            .flatten();
        renders_definition_on(support.as_ref(), definition)
    }

    fn unsupported_connected_devices(
        &self,
        requires: &Requires,
        assets: &[kaleidoscope_contract::assets::AssetDep],
    ) -> Vec<String> {
        let owned_devices = self.mcp_device_ids();
        let Ok(connections) = self.0.connections.lock() else {
            return Vec::new();
        };
        let Ok(support) = self.0.device_support.lock() else {
            return Vec::new();
        };
        let mut devices: Vec<_> = connections
            .iter()
            .filter(|(_, count)| **count > 0)
            .filter(|(id, _)| owned_devices.contains(*id))
            .filter(|(id, _)| {
                !renders_requirements(support.get(*id).and_then(Option::as_ref), requires, assets)
            })
            .map(|(id, _)| id.clone())
            .collect();
        devices.sort();
        devices
    }

    fn current_apps(&self) -> Result<Vec<RegistryApp>, CoreError> {
        let db = self.lock_db()?;
        let builtin_ids: Vec<&str> = kaleidoscope_contract::builtin::BUILTIN_IDENTITIES
            .iter()
            .map(|app| app.id)
            .collect();
        let placeholders = vec!["?"; builtin_ids.len()].join(",");
        let query = format!("SELECT a.id,a.name,a.current_version,a.created_at,a.updated_at,v.definition,v.created_at FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE a.deleted_at IS NULL AND a.id NOT IN ({placeholders}) ORDER BY a.id");
        let mut stmt = db.prepare(&query).map_err(db_error)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(builtin_ids), |r| {
                let definition: String = r.get(5)?;
                let definition = serde_json::from_str(&definition).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        5,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?;
                Ok(RegistryApp {
                    app: App {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        current_version: r.get(2)?,
                        created_at: r.get(3)?,
                        updated_at: r.get(4)?,
                    },
                    version: AppVersion {
                        app_id: r.get(0)?,
                        version: r.get(2)?,
                        definition,
                        created_at: r.get(6)?,
                    },
                })
            })
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }

    fn app(&self, app_id: &str, version: Option<u32>) -> Result<Option<RegistryApp>, CoreError> {
        if kaleidoscope_contract::builtin::is_builtin(app_id) {
            return Ok(None);
        }
        let db = self.lock_db()?;
        let current: Option<(String, String, u32, String, String)> = db
            .query_row(
                "SELECT id,name,current_version,created_at,updated_at FROM apps WHERE id=?1 AND deleted_at IS NULL",
                [app_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()
            .map_err(db_error)?;
        let Some((id, name, current_version, created_at, updated_at)) = current else {
            return Ok(None);
        };
        let version = version.unwrap_or(current_version);
        let found: Option<(String, String)> = db
            .query_row(
                "SELECT definition,created_at FROM app_versions WHERE app_id=?1 AND version=?2",
                params![id, version],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_error)?;
        let Some((definition, version_created_at)) = found else {
            return Ok(None);
        };
        let definition = serde_json::from_str(&definition)
            .map_err(|e| server_error(&format!("저장된 앱 정의를 읽을 수 없습니다: {e}")))?;
        Ok(Some(RegistryApp {
            app: App {
                id: id.clone(),
                name,
                current_version,
                created_at,
                updated_at,
            },
            version: AppVersion {
                app_id: id,
                version,
                definition,
                created_at: version_created_at,
            },
        }))
    }

    fn deleted_app_ids(&self) -> Result<Vec<String>, CoreError> {
        let db = self.lock_db()?;
        let mut stmt = db
            .prepare("SELECT id FROM apps WHERE deleted_at IS NOT NULL ORDER BY id")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(db_error)?;
        let ids = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        Ok(ids
            .into_iter()
            .filter(|id| !kaleidoscope_contract::builtin::is_builtin(id))
            .collect())
    }

    fn list_apps(&self) -> Result<Vec<AppSummary>, CoreError> {
        self.current_apps().map(|apps| {
            let mut summaries: Vec<_> = apps
                .into_iter()
                .map(|row| AppSummary {
                    builtin: false,
                    definition_available: true,
                    id: row.app.id,
                    name: row.app.name,
                    description: row.version.definition.description,
                    current_version: row.app.current_version,
                    updated_at: row.app.updated_at,
                })
                .collect();
            summaries.extend(
                kaleidoscope_contract::builtin::BUILTIN_IDENTITIES
                    .iter()
                    .map(|identity| AppSummary {
                        id: identity.id.into(),
                        name: identity.name.into(),
                        description: None,
                        current_version: identity.version,
                        updated_at: identity.updated_at.into(),
                        builtin: true,
                        definition_available: false,
                    }),
            );
            summaries.sort_by(|a, b| a.id.cmp(&b.id));
            summaries
        })
    }

    fn authenticate_device(&self, token: &str) -> Result<Option<(String, String)>, CoreError> {
        let digest = sha256_hex(token.as_bytes());
        self.lock_db()?
            .query_row(
                "SELECT id,name FROM devices WHERE token_sha256=?1 AND revoked_at IS NULL",
                [digest],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_error)
    }

    fn touch_device(&self, id: &str) -> Result<(), CoreError> {
        self.lock_db()?
            .execute(
                "UPDATE devices SET last_seen_at=?2 WHERE id=?1 AND revoked_at IS NULL",
                params![id, timestamp()],
            )
            .map_err(db_error)?;
        Ok(())
    }

    fn is_revoked(&self, id: &str) -> bool {
        self.lock_db()
            .ok()
            .and_then(|db| {
                db.query_row("SELECT revoked_at FROM devices WHERE id=?1", [id], |r| {
                    r.get::<_, Option<String>>(0)
                })
                .optional()
                .ok()
                .flatten()
            })
            .flatten()
            .is_some()
    }

    fn device_summaries(&self) -> Result<Vec<DeviceSummary>, CoreError> {
        let db = self.lock_db()?;
        let account_id: String = db
            .query_row(
                "SELECT account_id FROM mcp_principal WHERE id=1",
                [],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        let mut stmt = db.prepare("SELECT id,name,created_at,last_seen_at,revoked_at FROM devices WHERE account_id=?1 ORDER BY created_at,id").map_err(db_error)?;
        let connected = self
            .0
            .connections
            .lock()
            .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?;
        let rows = stmt
            .query_map([account_id], |r| {
                let id: String = r.get(0)?;
                let revoked: Option<String> = r.get(4)?;
                Ok(DeviceSummary {
                    connected: !revoked.is_some() && connected.get(&id).copied().unwrap_or(0) > 0,
                    id,
                    name: r.get(1)?,
                    created_at: r.get(2)?,
                    last_seen_at: r.get(3)?,
                    revoked: revoked.is_some(),
                })
            })
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }

    fn revoke_device(&self, id: &str) -> Result<bool, CoreError> {
        let changed = {
            let db = self.lock_db()?;
            let account_id: String = db
                .query_row(
                    "SELECT account_id FROM mcp_principal WHERE id=1",
                    [],
                    |row| row.get(0),
                )
                .map_err(db_error)?;
            let changed = db
                .execute(
                    "UPDATE devices SET revoked_at=COALESCE(revoked_at,?3) WHERE id=?1 AND account_id=?2",
                    params![id, account_id, timestamp()],
                )
                .map_err(db_error)?;
            // 지운 기기의 배치 보고는 지운다(저장소 판 올림과 같은 규칙). 남겨 두면 작업 조회가 그 기기를
            // 「가장 최근에 그 작업을 본 기기」로 골라 에이전트가 끊긴 시험 쉘의 화면을 읽는다.
            db.execute("DELETE FROM device_layouts WHERE device_id=?1 AND EXISTS(SELECT 1 FROM devices WHERE id=?1 AND account_id=?2)", params![id, account_id])
                .map_err(db_error)?;
            changed
        };
        self.refresh_device_workspaces()?;
        Ok(changed > 0)
    }
}

pub fn router(state: AppState) -> Router {
    http::router(state)
}

mod app_storage;
mod app_storage_context;
mod app_storage_http;
mod app_values;
mod assets;
mod backup;
mod connection_relay;
mod connections;
mod device_stream;
mod http;
mod layout_changes;
mod layouts;
mod mcp;
mod pairing;
mod preview;
mod publish;
mod share;
mod storage;
pub mod worker;
mod workspace_queries;

pub use backup::{backup_loop, backup_once};
use storage::*;

#[cfg(test)]
mod account_tests;
#[cfg(test)]
mod app_storage_tests;
#[cfg(test)]
mod app_values_tests;
#[cfg(test)]
mod asset_tests;
#[cfg(test)]
#[path = "layout_store_tests.rs"]
mod layout_store_tests;
#[cfg(test)]
#[path = "layout_sync_tests.rs"]
mod layout_sync_tests;
#[cfg(test)]
mod server_exclusion_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod worker_tests;

mod embedded;
pub use embedded::{load_or_create_token, EmbeddedConfig, EmbeddedServer};

mod transfer;

#[cfg(test)]
mod transfer_tests;
