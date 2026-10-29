use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
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
    #[serde(default)]
    pub(crate) access_token: Option<String>,
    #[serde(default)]
    pub(crate) refresh_token: Option<String>,
    #[serde(default)]
    pub(crate) expires_at: Option<i64>,
}

pub(crate) struct Logins {
    path: PathBuf,
    entries: Mutex<BTreeMap<String, LoginEntry>>,
}

impl Logins {
    pub(crate) fn open(data_dir: &Path) -> Result<Self, CoreError> {
        let path = data_dir.join("logins.json");
        let entries = crate::storage::load_file(&path, "logins.json")?;
        Ok(Self {
            path,
            entries: Mutex::new(entries),
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
    ) -> Result<(), CoreError> {
        self.store(
            connection,
            LoginEntry {
                issuer: issuer.to_string(),
                client_id: Some(client_id),
                redirect_port: Some(redirect_port),
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
            access_token: None,
            refresh_token: None,
            expires_at: None,
        });
        entry.issuer = issuer.to_string();
        entry.client_id = None;
        entry.redirect_port = None;
        entry.access_token = None;
        entry.refresh_token = None;
        entry.expires_at = None;
        let _ = self.store(connection, entry);
    }

    fn clear_tokens(&self, connection: &str) {
        if let Some(mut entry) = self.entry(connection) {
            entry.access_token = None;
            entry.refresh_token = None;
            entry.expires_at = None;
            let _ = self.store(connection, entry);
        }
    }

    fn refresh(&self, connection: &str, rejected_token: &str) -> Option<String> {
        let entry = self.entry(connection)?;
        if entry
            .access_token
            .as_deref()
            .is_some_and(|token| token != rejected_token)
        {
            return entry.access_token;
        }
        if entry.refresh_token.is_none() {
            self.clear_tokens(connection);
            return None;
        }
        match oauth::refresh_access_token(&entry) {
            Some(tokens) => {
                let updated = LoginEntry {
                    issuer: entry.issuer,
                    client_id: entry.client_id,
                    redirect_port: entry.redirect_port,
                    access_token: Some(tokens.access_token.clone()),
                    refresh_token: tokens.refresh_token.or(entry.refresh_token),
                    expires_at: tokens.expires_at,
                };
                self.store(connection, updated).ok()?;
                Some(tokens.access_token)
            }
            None => {
                self.clear_tokens(connection);
                None
            }
        }
    }
}

impl LoginStore for Logins {
    fn token(&self, connection: &str) -> Option<String> {
        let entry = self.entry(connection)?;
        let token = entry.access_token?;
        let expired = entry.expires_at.is_some_and(|expires| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|now| expires <= now.as_secs() as i64)
                .unwrap_or(false)
        });
        if expired {
            self.refresh(connection, &token)
        } else {
            Some(token)
        }
    }

    fn refresh(&self, connection: &str, rejected_token: &str) -> Option<String> {
        Logins::refresh(self, connection, rejected_token)
    }

    fn invalidate(&self, connection: &str) {
        self.clear_tokens(connection);
    }
}
