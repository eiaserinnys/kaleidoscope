//! 데스크톱과 독립 실행에 공통인 시작 자원.
use crate::{backup_loop, router, storage, worker, AppState};
use rusqlite::params;
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub struct EmbeddedConfig {
    pub db_path: PathBuf,
    pub token_path: PathBuf,
    pub device_name: String,
}

pub struct EmbeddedServer {
    pub server_url: String,
    pub device_id: String,
    pub token: String,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

impl Drop for EmbeddedServer {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

pub fn load_or_create_token(path: &Path) -> Result<String, String> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(mut file) => {
            let token = storage::random_token();
            file.write_all(token.as_bytes())
                .map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            Ok(token)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let mut token = String::new();
            std::fs::File::open(path)
                .and_then(|mut f| f.read_to_string(&mut token))
                .map_err(|e| e.to_string())?;
            if token.trim().is_empty() {
                return Err("토큰 파일이 비어 있습니다".into());
            }
            Ok(token.trim().into())
        }
        Err(e) => Err(e.to_string()),
    }
}

impl AppState {
    pub fn ensure_local_device(&self, name: &str) -> Result<(String, String), String> {
        let id = "local-device".to_string();
        let token = self.0.mcp_token.clone();
        let account = self.mcp_account_id().map_err(|e| e.message)?;
        self.lock_db().map_err(|e| e.message)?.execute(
            "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,token_sha256=excluded.token_sha256,revoked_at=NULL",
            params![id,name,account,storage::sha256_hex(token.as_bytes()),storage::timestamp()],
        ).map_err(|e| e.to_string())?;
        Ok((id, token))
    }
}

impl EmbeddedServer {
    pub async fn start(config: EmbeddedConfig) -> Result<Self, String> {
        let token = load_or_create_token(&config.token_path)?;
        let state = AppState::open(config.db_path, token)?;
        let (device_id, token) = state.ensure_local_device(&config.device_name)?;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| e.to_string())?;
        let server_url = format!(
            "http://{}",
            listener.local_addr().map_err(|e| e.to_string())?
        );
        let tasks = vec![
            tokio::spawn(backup_loop(state.clone())),
            tokio::spawn(worker::worker_schedule_loop(state.clone())),
            tokio::spawn(async move {
                if let Err(e) = axum::serve(listener, router(state)).await {
                    eprintln!("내장 서버 오류: {e}");
                }
            }),
        ];
        Ok(Self {
            server_url,
            device_id,
            token,
            tasks,
        })
    }
}
