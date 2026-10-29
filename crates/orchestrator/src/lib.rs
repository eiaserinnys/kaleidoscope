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
    App, AppDefinition, AppVersion, CoreError, ErrorCode, LEGACY_BLOCK_SET_VERSION, Requires,
    Supported,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use schemars::{Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, Mutex as AsyncMutex};
use uuid::Uuid;

const USER_CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTVWXYZ";
const EVENT_BUFFER: usize = 64;

pub(crate) fn renders_on(supported: Option<&Supported>, requires: &Requires) -> bool {
    match supported {
        Some(supported) => supported.renders(requires),
        None => requires.blocks <= LEGACY_BLOCK_SET_VERSION,
    }
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

struct Inner {
    db: Mutex<Connection>,
    events: broadcast::Sender<DeviceEvent>,
    connections: Mutex<HashMap<String, usize>>,
    device_support: Mutex<HashMap<String, Option<Supported>>>,
    device_workspaces: Mutex<HashMap<String, HashSet<String>>>,
    pairings: AsyncMutex<HashMap<String, Pairing>>,
    mcp_token: String,
    db_path: Option<PathBuf>,
    soulstream: Option<agent::Soulstream>,
    activity: Mutex<HashMap<String, (bool, Option<String>)>>,
    create_lock: AsyncMutex<()>,
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
            device_support: Mutex::new(HashMap::new()),
            device_workspaces: Mutex::new(device_workspaces),
            pairings: AsyncMutex::new(HashMap::new()),
            mcp_token,
            db_path,
            soulstream: None,
            activity: Mutex::new(HashMap::new()),
            create_lock: AsyncMutex::new(()),
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

    pub fn publish_app(
        &self,
        definition_json: &str,
        created_by: &str,
        open: bool,
        workspace_id: Option<String>,
    ) -> Result<(RegistryApp, bool), CoreError> {
        let definition = parse_app_definition(definition_json)?;
        let now = timestamp();
        let result = {
            let mut db = self.lock_db()?;
            let tx = db.transaction().map_err(db_error)?;
            let current: Option<(u32, String, String)> = tx.query_row(
                "SELECT a.current_version, v.definition, a.created_at FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE a.id=?1",
                [&definition.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            ).optional().map_err(db_error)?;
            let (version_num, created_at, unchanged) = if let Some((
                current_version,
                stored,
                created_at,
            )) = current
            {
                let previous: AppDefinition = serde_json::from_str(&stored).map_err(|e| {
                    server_error(&format!("저장된 앱 정의를 읽을 수 없습니다: {e}"))
                })?;
                if previous == definition {
                    (current_version, created_at, true)
                } else {
                    let version = current_version + 1;
                    save_version(&tx, &definition, version, &now, created_by).map_err(db_error)?;
                    tx.execute(
                        "UPDATE apps SET name=?2,current_version=?3,updated_at=?4 WHERE id=?1",
                        params![definition.id, definition.name, version, now],
                    )
                    .map_err(db_error)?;
                    (version, created_at, false)
                }
            } else {
                tx.execute("INSERT INTO apps(id,name,current_version,created_at,updated_at) VALUES(?1,?2,1,?3,?3)", params![definition.id, definition.name, now]).map_err(db_error)?;
                save_version(&tx, &definition, 1, &now, created_by).map_err(db_error)?;
                (1, now.clone(), false)
            };
            tx.commit().map_err(db_error)?;
            drop(db);
            let app = App {
                id: definition.id.clone(),
                name: definition.name.clone(),
                current_version: version_num,
                created_at,
                updated_at: if unchanged {
                    self.app_updated_at(&definition.id)?
                } else {
                    now.clone()
                },
            };
            let version = AppVersion {
                app_id: definition.id.clone(),
                version: version_num,
                definition,
                created_at: if unchanged {
                    self.version_created_at(&app.id, version_num)?
                } else {
                    now
                },
            };
            (RegistryApp { app, version }, unchanged)
        };
        if !result.1 {
            let _ = self.0.events.send(DeviceEvent::AppPublished {
                app: result.0.clone(),
                open,
                workspace_id: workspace_id.clone(),
            });
        } else if open {
            let _ = self.0.events.send(DeviceEvent::AppOpen {
                app_id: result.0.app.id.clone(),
                workspace_id,
            });
        }
        Ok(result)
    }

    fn app_updated_at(&self, id: &str) -> Result<String, CoreError> {
        self.lock_db()?
            .query_row("SELECT updated_at FROM apps WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(db_error)
    }
    fn version_created_at(&self, id: &str, version: u32) -> Result<String, CoreError> {
        self.lock_db()?
            .query_row(
                "SELECT created_at FROM app_versions WHERE app_id=?1 AND version=?2",
                params![id, version],
                |r| r.get(0),
            )
            .map_err(db_error)
    }
    fn device_can_render(&self, device_id: &str, requires: &Requires) -> bool {
        let support = self
            .0
            .device_support
            .lock()
            .ok()
            .and_then(|devices| devices.get(device_id).cloned())
            .flatten();
        renders_on(support.as_ref(), requires)
    }

    fn unsupported_connected_devices(&self, requires: &Requires) -> Vec<String> {
        let Ok(connections) = self.0.connections.lock() else {
            return Vec::new();
        };
        let Ok(support) = self.0.device_support.lock() else {
            return Vec::new();
        };
        let mut devices: Vec<_> = connections
            .iter()
            .filter(|(_, count)| **count > 0)
            .filter(|(id, _)| !renders_on(support.get(*id).and_then(Option::as_ref), requires))
            .map(|(id, _)| id.clone())
            .collect();
        devices.sort();
        devices
    }

    fn connected_count_for_app(&self, workspace_id: Option<&str>, requires: &Requires) -> usize {
        let Ok(connections) = self.0.connections.lock() else {
            return 0;
        };
        let Ok(support) = self.0.device_support.lock() else {
            return 0;
        };
        let Ok(workspaces) = self.0.device_workspaces.lock() else {
            return 0;
        };
        let connected: Vec<_> = connections
            .iter()
            .filter(|(_, count)| **count > 0)
            .filter(|(id, _)| {
                workspace_id.is_none_or(|workspace| {
                    workspaces
                        .get(*id)
                        .is_some_and(|ids| ids.contains(workspace))
                })
            })
            .filter(|(id, _)| renders_on(support.get(*id).and_then(Option::as_ref), requires))
            .collect();
        if workspace_id.is_some() {
            connected.len()
        } else {
            connected.iter().map(|(_, count)| **count).sum()
        }
    }

    fn connected_count(&self) -> usize {
        self.0
            .connections
            .lock()
            .map(|m| m.values().sum())
            .unwrap_or(0)
    }

    fn current_apps(&self) -> Result<Vec<RegistryApp>, CoreError> {
        let db = self.lock_db()?;
        let mut stmt = db.prepare("SELECT a.id,a.name,a.current_version,a.created_at,a.updated_at,v.definition,v.created_at FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version ORDER BY a.id").map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| {
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
        let db = self.lock_db()?;
        let current: Option<(String, String, u32, String, String)> = db
            .query_row(
                "SELECT id,name,current_version,created_at,updated_at FROM apps WHERE id=?1",
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

    fn list_apps(&self) -> Result<Vec<AppSummary>, CoreError> {
        self.current_apps().map(|apps| {
            apps.into_iter()
                .map(|row| AppSummary {
                    id: row.app.id,
                    name: row.app.name,
                    description: row.version.definition.description,
                    current_version: row.app.current_version,
                    updated_at: row.app.updated_at,
                })
                .collect()
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
        let mut stmt = db.prepare("SELECT id,name,created_at,last_seen_at,revoked_at FROM devices ORDER BY created_at,id").map_err(db_error)?;
        let connected = self
            .0
            .connections
            .lock()
            .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?;
        let rows = stmt
            .query_map([], |r| {
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
        let changed = self
            .lock_db()?
            .execute(
                "UPDATE devices SET revoked_at=COALESCE(revoked_at,?2) WHERE id=?1",
                params![id, timestamp()],
            )
            .map_err(db_error)?;
        Ok(changed > 0)
    }
}

pub fn router(state: AppState) -> Router {
    http::router(state)
}

mod agent;
mod backup;
mod device_stream;
mod http;
mod layouts;
mod mcp;
mod pairing;
mod relay;
mod storage;

pub use backup::{backup_loop, backup_once};
use storage::*;

#[cfg(test)]
mod tests;
