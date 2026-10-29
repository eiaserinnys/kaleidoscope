use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngExt;
use sha2::{Digest, Sha256};

pub(super) fn migrate(db: &Connection) -> rusqlite::Result<()> {
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version == 0 {
        db.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE apps (id TEXT PRIMARY KEY,name TEXT NOT NULL,current_version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE app_versions (app_id TEXT NOT NULL REFERENCES apps(id),version INTEGER NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,PRIMARY KEY(app_id,version));
            CREATE TABLE devices (id TEXT PRIMARY KEY,name TEXT NOT NULL,token_sha256 TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,last_seen_at TEXT,revoked_at TEXT);
            PRAGMA user_version=1;
            COMMIT;")?;
    } else if version > 2 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    if version < 2 {
        db.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE device_layouts (device_id TEXT PRIMARY KEY REFERENCES devices(id), layout TEXT NOT NULL, reported_at TEXT NOT NULL);
            CREATE TABLE agents (workspace_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE, model_preset TEXT NOT NULL, workspace_name TEXT NOT NULL, created_at TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE agent_items (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
            CREATE INDEX agent_items_workspace_id ON agent_items(workspace_id,id);
            PRAGMA user_version=2;
            COMMIT;")?;
    }
    Ok(())
}

pub(super) fn save_version(
    tx: &Transaction<'_>,
    definition: &AppDefinition,
    version: u32,
    now: &str,
    created_by: &str,
) -> rusqlite::Result<()> {
    let canonical = serde_json::to_string(definition).map_err(|_| rusqlite::Error::InvalidQuery)?;
    tx.execute("INSERT INTO app_versions(app_id,version,definition,created_at,created_by) VALUES(?1,?2,?3,?4,?5)",params![definition.id,version,canonical,now,created_by])?;
    Ok(())
}

pub(super) fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
pub(super) fn db_error(error: rusqlite::Error) -> CoreError {
    server_error(&format!("레지스트리 저장소 오류: {error}"))
}
pub(super) fn server_error(message: &str) -> CoreError {
    CoreError {
        code: ErrorCode::Server,
        message: message.to_string(),
        details: vec![],
    }
}
pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub(super) fn random_token() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    URL_SAFE_NO_PAD.encode(bytes)
}
pub(super) fn random_user_code() -> String {
    let mut rng = rand::rng();
    let code: String = (0..8)
        .map(|_| USER_CODE_ALPHABET[rng.random_range(0..USER_CODE_ALPHABET.len())] as char)
        .collect();
    format!("{}-{}", &code[..4], &code[4..])
}
