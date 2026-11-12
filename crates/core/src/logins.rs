use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::connections::LoginStore;
use crate::oauth;
use kaleidoscope_contract::CoreError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LoginEntry {
    pub(crate) issuer: String,
    #[serde(default)]
    pub(crate) client_id: Option<String>,
    #[serde(default)]
    pub(crate) redirect_port: Option<u16>,
    /// 저장된 client가 동적 등록될 때 쓴 범위이자 토큰을 받을 때 요청한 범위.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) scopes: Option<String>,
    #[serde(default)]
    pub(crate) access_token: Option<String>,
    #[serde(default)]
    pub(crate) refresh_token: Option<String>,
    #[serde(default)]
    pub(crate) expires_at: Option<i64>,
}

/// `recorded`가 `declared`의 낱말을 모두 담는가. `declared`가 비었으면 참이다.
pub(crate) fn scopes_cover(recorded: Option<&str>, declared: Option<&str>) -> bool {
    let declared: Vec<&str> = declared.unwrap_or("").split_whitespace().collect();
    if declared.is_empty() {
        return true;
    }
    let Some(recorded) = recorded else {
        return false;
    };
    let recorded: std::collections::BTreeSet<&str> = recorded.split_whitespace().collect();
    declared.iter().all(|scope| recorded.contains(scope))
}

pub(crate) struct Logins {
    path: PathBuf,
    entries: Mutex<BTreeMap<String, LoginEntry>>,
    refresh_locks: Mutex<BTreeMap<String, Arc<Mutex<()>>>>,
}

impl Logins {
    pub(crate) fn open(data_dir: &Path) -> Result<Self, CoreError> {
        let path = data_dir.join("logins.json");
        let entries = crate::storage::load_file(&path, "logins.json")?;
        Ok(Self {
            path,
            entries: Mutex::new(entries),
            refresh_locks: Mutex::new(BTreeMap::new()),
        })
    }

    pub(crate) fn entry(&self, connection: &str) -> Option<LoginEntry> {
        self.entries.lock().unwrap().get(connection).cloned()
    }

    pub(crate) fn store(&self, connection: &str, entry: LoginEntry) -> Result<(), CoreError> {
        let mut entries = self.entries.lock().unwrap();
        entries.insert(connection.to_string(), entry);
        crate::storage::save_atomic(&self.path, &*entries)
    }

    pub(crate) fn update_client(
        &self,
        connection: &str,
        issuer: &str,
        client_id: String,
        redirect_port: u16,
        scopes: Option<String>,
    ) -> Result<(), CoreError> {
        self.store(
            connection,
            LoginEntry {
                issuer: issuer.to_string(),
                client_id: Some(client_id),
                redirect_port: Some(redirect_port),
                scopes,
                access_token: None,
                refresh_token: None,
                expires_at: None,
            },
        )
    }

    pub(crate) fn clear_client(&self, connection: &str, issuer: &str) {
        let mut entry = self.entry(connection).unwrap_or_else(|| LoginEntry {
            issuer: issuer.to_string(),
            client_id: None,
            redirect_port: None,
            scopes: None,
            access_token: None,
            refresh_token: None,
            expires_at: None,
        });
        entry.issuer = issuer.to_string();
        entry.client_id = None;
        entry.redirect_port = None;
        entry.scopes = None;
        entry.access_token = None;
        entry.refresh_token = None;
        entry.expires_at = None;
        let _ = self.store(connection, entry);
    }

    fn refresh_lock(&self, connection: &str) -> Arc<Mutex<()>> {
        let mut locks = self.refresh_locks.lock().unwrap();
        locks
            .entry(connection.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn clear_tokens_if(&self, connection: &str, matches: impl FnOnce(&LoginEntry) -> bool) {
        let mut entries = self.entries.lock().unwrap();
        let Some(entry) = entries.get_mut(connection) else {
            return;
        };
        if !matches(entry) {
            return;
        }
        entry.access_token = None;
        entry.refresh_token = None;
        entry.expires_at = None;
        let _ = crate::storage::save_atomic(&self.path, &*entries);
    }

    fn refresh(&self, connection: &str, rejected_token: &str) -> Option<String> {
        let refresh_lock = self.refresh_lock(connection);
        let _refresh_guard = refresh_lock.lock().unwrap();
        let entry = self.entry(connection)?;
        if entry
            .access_token
            .as_deref()
            .is_some_and(|token| token != rejected_token)
            && !token_is_expired(entry.expires_at)
        {
            return entry.access_token;
        }
        let Some(refresh_token) = entry.refresh_token.clone() else {
            self.clear_tokens_if(connection, |current| {
                current.access_token.as_deref() == Some(rejected_token)
            });
            return None;
        };
        match oauth::refresh_access_token(&entry) {
            Some(tokens) => {
                let mut entries = self.entries.lock().unwrap();
                let current = entries.get_mut(connection)?;
                if current != &entry {
                    let expired = token_is_expired(current.expires_at);
                    return current.access_token.clone().filter(|_| !expired);
                }
                let access_token = tokens.access_token;
                current.access_token = Some(access_token.clone());
                current.refresh_token = tokens.refresh_token.or(Some(refresh_token));
                current.expires_at = tokens.expires_at;
                crate::storage::save_atomic(&self.path, &*entries).ok()?;
                Some(access_token)
            }
            None => {
                let mut entries = self.entries.lock().unwrap();
                let current = entries.get_mut(connection)?;
                if current.refresh_token.as_deref() == Some(refresh_token.as_str()) {
                    current.access_token = None;
                    current.refresh_token = None;
                    current.expires_at = None;
                    let _ = crate::storage::save_atomic(&self.path, &*entries);
                    None
                } else {
                    let expired = token_is_expired(current.expires_at);
                    current
                        .access_token
                        .clone()
                        .filter(|token| token != rejected_token && !expired)
                }
            }
        }
    }
}

impl LoginStore for Logins {
    fn token(&self, connection: &str, scopes: Option<&str>) -> Option<String> {
        let entry = self.entry(connection)?;
        if !scopes_cover(entry.scopes.as_deref(), scopes) {
            return None;
        }
        let token = entry.access_token?;
        if token_is_expired(entry.expires_at) {
            self.refresh(connection, &token)
        } else {
            Some(token)
        }
    }

    fn refresh(&self, connection: &str, rejected_token: &str) -> Option<String> {
        Logins::refresh(self, connection, rejected_token)
    }

    fn invalidate(&self, connection: &str, access_token: &str) {
        let refresh_lock = self.refresh_lock(connection);
        let _refresh_guard = refresh_lock.lock().unwrap();
        self.clear_tokens_if(connection, |entry| {
            entry.access_token.as_deref() == Some(access_token)
        });
    }
}

fn token_is_expired(expires_at: Option<i64>) -> bool {
    expires_at.is_some_and(|expires| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|now| expires <= now.as_secs() as i64)
            .unwrap_or(false)
    })
}
