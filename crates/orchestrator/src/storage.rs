use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use kaleidoscope_contract::registry::DeviceLayout;
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
    } else if version > 10 {
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
    if version < 3 {
        db.execute_batch(
            "BEGIN IMMEDIATE;
            ALTER TABLE agent_items ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
            PRAGMA user_version=3;
            COMMIT;",
        )?;
    }
    if version < 4 {
        db.execute_batch(
            "BEGIN IMMEDIATE;
            CREATE TABLE connections (name TEXT PRIMARY KEY,kind TEXT NOT NULL,base_url TEXT NOT NULL,writable INTEGER NOT NULL,paths TEXT NOT NULL DEFAULT '[]',headers TEXT NOT NULL DEFAULT '{}',issuer TEXT,scopes TEXT,resource TEXT,description TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
            PRAGMA user_version=4;
            COMMIT;",
        )?;
    }
    if version < 5 {
        let tx = db.unchecked_transaction()?;
        tx.execute_batch(
            "ALTER TABLE devices ADD COLUMN last_active_at TEXT;
             CREATE TABLE workspaces (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
             CREATE TABLE desktops (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
             CREATE TABLE windows (id TEXT PRIMARY KEY, desktop_id TEXT NOT NULL, app_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);",
        )?;
        let reports = {
            let mut statement = tx.prepare(
                "SELECT l.device_id,l.layout,l.reported_at FROM device_layouts l JOIN devices d ON d.id=l.device_id WHERE d.revoked_at IS NULL ORDER BY l.reported_at,d.id",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        for (device_id, raw, reported_at) in reports {
            let layout: DeviceLayout =
                serde_json::from_str(&raw).map_err(|_| rusqlite::Error::InvalidQuery)?;
            for workspace in layout.workspaces {
                let data =
                    serde_json::to_string(&workspace).map_err(|_| rusqlite::Error::InvalidQuery)?;
                tx.execute("INSERT INTO workspaces(id,data,created_at) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data,created_at=excluded.created_at", params![workspace.id,data,workspace.created_at])?;
            }
            for desktop in layout.desktops {
                let data =
                    serde_json::to_string(&desktop).map_err(|_| rusqlite::Error::InvalidQuery)?;
                tx.execute("INSERT INTO desktops(id,workspace_id,data,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,data=excluded.data,created_at=excluded.created_at", params![desktop.id,desktop.workspace_id,data,desktop.created_at])?;
            }
            for window in layout.windows {
                let data =
                    serde_json::to_string(&window).map_err(|_| rusqlite::Error::InvalidQuery)?;
                tx.execute("INSERT INTO windows(id,desktop_id,app_id,data,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET desktop_id=excluded.desktop_id,app_id=excluded.app_id,data=excluded.data,created_at=excluded.created_at", params![window.id,window.desktop_id,window.app_id,data,window.created_at])?;
            }
            tx.execute(
                "UPDATE devices SET last_active_at=?2 WHERE id=?1",
                params![device_id, reported_at],
            )?;
        }
        tx.execute(
            "DELETE FROM desktops WHERE workspace_id NOT IN (SELECT id FROM workspaces)",
            [],
        )?;
        tx.execute(
            "DELETE FROM windows WHERE desktop_id NOT IN (SELECT id FROM desktops)",
            [],
        )?;
        tx.execute("DELETE FROM device_layouts WHERE device_id IN (SELECT id FROM devices WHERE revoked_at IS NOT NULL)", [])?;
        tx.pragma_update(None, "user_version", 5)?;
        tx.commit()?;
    }
    if version < 6 {
        let tx = db.unchecked_transaction()?;
        let account_id = Uuid::new_v4().to_string();
        let now = timestamp();
        tx.execute_batch(
            "CREATE TABLE accounts (id TEXT PRIMARY KEY,display_name TEXT NOT NULL,created_at TEXT NOT NULL);
             CREATE TABLE mcp_principal (id INTEGER PRIMARY KEY CHECK(id=1),account_id TEXT NOT NULL REFERENCES accounts(id));",
        )?;
        tx.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES(?1,'디렉터',?2)",
            params![account_id, now],
        )?;
        tx.execute(
            "INSERT INTO mcp_principal(id,account_id) VALUES(1,?1)",
            [&account_id],
        )?;
        tx.execute_batch(
            "CREATE TABLE devices_new (
                 id TEXT PRIMARY KEY,name TEXT NOT NULL,account_id TEXT NOT NULL REFERENCES accounts(id),
                 token_sha256 TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,last_seen_at TEXT,
                 revoked_at TEXT,last_active_at TEXT
             );
             CREATE TABLE device_layouts_new (
                 device_id TEXT PRIMARY KEY REFERENCES devices_new(id),layout TEXT NOT NULL,reported_at TEXT NOT NULL
             );
             CREATE TABLE workspaces_new (
                 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),data TEXT NOT NULL,created_at TEXT NOT NULL
             );
             CREATE TABLE connections_new (
                 account_id TEXT NOT NULL REFERENCES accounts(id),name TEXT NOT NULL,kind TEXT NOT NULL,
                 base_url TEXT NOT NULL,writable INTEGER NOT NULL,paths TEXT NOT NULL DEFAULT '[]',
                 headers TEXT NOT NULL DEFAULT '{}',issuer TEXT,scopes TEXT,resource TEXT,
                 description TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(account_id,name)
             );
             CREATE TABLE legacy_workspace_owners (
                 workspace_id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id)
             );",
        )?;
        tx.execute(
            "INSERT INTO devices_new(id,name,account_id,token_sha256,created_at,last_seen_at,revoked_at,last_active_at)
             SELECT id,name,?1,token_sha256,created_at,last_seen_at,revoked_at,last_active_at FROM devices",
            [&account_id],
        )?;
        tx.execute(
            "INSERT INTO device_layouts_new(device_id,layout,reported_at)
             SELECT device_id,layout,reported_at FROM device_layouts",
            [],
        )?;
        tx.execute(
            "INSERT INTO workspaces_new(id,account_id,data,created_at)
             SELECT id,?1,data,created_at FROM workspaces",
            [&account_id],
        )?;
        tx.execute(
            "INSERT INTO connections_new(account_id,name,kind,base_url,writable,paths,headers,issuer,scopes,resource,description,updated_at)
             SELECT ?1,name,kind,base_url,writable,paths,headers,issuer,scopes,resource,description,updated_at FROM connections",
            [&account_id],
        )?;
        tx.execute_batch(
            "DROP TABLE device_layouts;
             DROP TABLE devices;
             ALTER TABLE devices_new RENAME TO devices;
             ALTER TABLE device_layouts_new RENAME TO device_layouts;
             DROP TABLE workspaces;
             ALTER TABLE workspaces_new RENAME TO workspaces;
             DROP TABLE connections;
             ALTER TABLE connections_new RENAME TO connections;",
        )?;
        tx.pragma_update(None, "user_version", 6)?;
        tx.commit()?;
    }
    if version < 7 {
        db.execute_batch(
            "BEGIN IMMEDIATE;
            CREATE TABLE app_storage_buckets (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(id),
                app_id TEXT NOT NULL REFERENCES apps(id),
                UNIQUE(account_id,app_id)
            );
            CREATE TABLE app_storage_items (
                bucket_id TEXT NOT NULL REFERENCES app_storage_buckets(id) ON DELETE CASCADE,
                key TEXT NOT NULL,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                revision TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(bucket_id,key)
            );
            PRAGMA user_version=7;
            COMMIT;",
        )?;
    }
    if version < 8 {
        db.execute_batch("BEGIN IMMEDIATE; DROP TABLE agent_items; DROP TABLE agents; PRAGMA user_version=8; COMMIT;")?;
    }
    if version < 9 {
        db.execute_batch("BEGIN IMMEDIATE; ALTER TABLE apps ADD COLUMN deleted_at TEXT; PRAGMA user_version=9; COMMIT;")?;
    }
    if version < 10 {
        db.pragma_update(None, "foreign_keys", false)?;
        let migration = (|| {
            db.execute_batch("BEGIN IMMEDIATE;")?;
            let migration = (|| {
                db.execute_batch(
                    "CREATE TABLE app_storage_buckets_v10 (
                    id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL REFERENCES accounts(id),
                    app_id TEXT NOT NULL,
                    UNIQUE(account_id,app_id)
                );
                INSERT INTO app_storage_buckets_v10(id,account_id,app_id)
                    SELECT id,account_id,app_id FROM app_storage_buckets;
                DROP TABLE app_storage_buckets;
                ALTER TABLE app_storage_buckets_v10 RENAME TO app_storage_buckets;",
                )?;
                let mut check = db.prepare("PRAGMA foreign_key_check")?;
                if check.query([])?.next()?.is_some() {
                    return Err(rusqlite::Error::InvalidQuery);
                }
                drop(check);
                db.pragma_update(None, "user_version", 10)?;
                db.execute_batch("COMMIT;")
            })();
            if migration.is_err() {
                let _ = db.execute_batch("ROLLBACK;");
            }
            migration
        })();
        let foreign_keys = db.pragma_update(None, "foreign_keys", true);
        migration?;
        foreign_keys?;
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
