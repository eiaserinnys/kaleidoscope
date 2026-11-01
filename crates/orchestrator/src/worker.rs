//! 앱별 서버 워커 실행, 시크릿과 주기 트리거.
use super::*;
use axum::extract::{Extension, Path, State};
use kaleidoscope_contract::worker::{
    WorkerDecl, WorkerInvokeReply, WorkerInvokeRequest, WorkerStatus, WORKER_SECRET_MAX_BYTES,
    WORKER_TIMEOUT_DEFAULT_SECS,
};
use rand::RngExt;
use std::{collections::BTreeMap, process::Stdio, time::Instant};
use tokio::io::AsyncWriteExt;

type WorkerKey = (String, String);
#[derive(Default)]
pub(super) struct WorkerState {
    locks: Mutex<HashMap<WorkerKey, Arc<AsyncMutex<()>>>>,
    statuses: Mutex<HashMap<WorkerKey, WorkerStatus>>,
    next_due: Mutex<HashMap<WorkerKey, Instant>>,
}

impl AppState {
    fn worker_definition(&self, app_id: &str) -> Result<(AppDefinition, WorkerDecl), CoreError> {
        let definition = self
            .app(app_id, None)?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound))?
            .version
            .definition;
        let worker = definition
            .worker
            .clone()
            .ok_or_else(|| CoreError::new(ErrorCode::InvalidRequest))?;
        Ok((definition, worker))
    }

    pub fn set_app_secret(
        &self,
        account_id: &str,
        app_id: &str,
        secret_id: &str,
        value: &str,
    ) -> Result<Value, CoreError> {
        let (_, worker) = self.worker_definition(app_id)?;
        if !worker.secrets.iter().any(|s| s.id == secret_id)
            || value.is_empty()
            || value.len() > WORKER_SECRET_MAX_BYTES
            || value.contains("${env:")
        {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        let now = timestamp();
        self.lock_db()?.execute("INSERT INTO app_secrets(account_id,app_id,secret_id,value,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(account_id,app_id,secret_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![account_id, app_id, secret_id, value, now]).map_err(db_error)?;
        Ok(json!({"app_id":app_id,"secret_id":secret_id,"configured":true,"updated_at":now}))
    }

    pub fn list_app_secrets(&self, account_id: &str, app_id: &str) -> Result<Value, CoreError> {
        let (_, worker) = self.worker_definition(app_id)?;
        let db = self.lock_db()?;
        let mut result = Vec::new();
        for secret in worker.secrets {
            let updated_at: Option<String> = db.query_row("SELECT updated_at FROM app_secrets WHERE account_id=?1 AND app_id=?2 AND secret_id=?3", params![account_id, app_id, secret.id], |row| row.get(0)).optional().map_err(db_error)?;
            result.push(json!({"id":secret.id,"description":secret.description,"configured":updated_at.is_some(),"updated_at":updated_at}));
        }
        Ok(json!({"app_id":app_id,"secrets":result}))
    }

    pub fn delete_app_secret(
        &self,
        account_id: &str,
        app_id: &str,
        secret_id: &str,
    ) -> Result<bool, CoreError> {
        Ok(self
            .lock_db()?
            .execute(
                "DELETE FROM app_secrets WHERE account_id=?1 AND app_id=?2 AND secret_id=?3",
                params![account_id, app_id, secret_id],
            )
            .map_err(db_error)?
            > 0)
    }

    pub fn app_worker_status(
        &self,
        account_id: &str,
        app_id: &str,
    ) -> Result<WorkerStatus, CoreError> {
        self.worker_definition(app_id)?;
        Ok(self
            .0
            .workers
            .statuses
            .lock()
            .unwrap()
            .get(&(account_id.into(), app_id.into()))
            .cloned()
            .unwrap_or_default())
    }

    pub async fn invoke_worker(
        &self,
        account_id: &str,
        app_id: &str,
        req: WorkerInvokeRequest,
    ) -> Result<WorkerInvokeReply, CoreError> {
        let (_, worker) = self.worker_definition(app_id)?;
        if !worker.actions.contains(&req.action) {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        let trigger = json!({"kind":"action","action":req.action,"args":req.args,"workspace_id":req.workspace_id});
        self.run_worker(account_id, app_id, trigger, req.workspace_id.as_deref())
            .await
    }

    pub async fn trigger_watched_entry(
        &self,
        account_id: &str,
        app_id: &str,
        entry_id: &str,
        workspace_id: Option<&str>,
    ) -> Result<Option<WorkerInvokeReply>, CoreError> {
        let Some(app) = self.app(app_id, None)? else {
            return Ok(None);
        };
        if !app
            .version
            .definition
            .worker
            .as_ref()
            .is_some_and(|w| w.watch_entries.iter().any(|id| id == entry_id))
        {
            return Ok(None);
        }
        let trigger = json!({"kind":"watch","entry_id":entry_id,"workspace_id":workspace_id});
        self.run_worker(account_id, app_id, trigger, workspace_id)
            .await
            .map(Some)
    }

    async fn run_worker(
        &self,
        account_id: &str,
        app_id: &str,
        trigger: Value,
        workspace_id: Option<&str>,
    ) -> Result<WorkerInvokeReply, CoreError> {
        let key = (account_id.to_owned(), app_id.to_owned());
        let lock = self
            .0
            .workers
            .locks
            .lock()
            .unwrap()
            .entry(key.clone())
            .or_default()
            .clone();
        let _guard = lock.lock().await;
        if trigger["kind"] == "schedule" {
            let (_, worker) = self.worker_definition(app_id)?;
            let Some(schedule) = worker.schedule else {
                return Ok(WorkerInvokeReply {
                    result: Value::Null,
                    updated_entries: Vec::new(),
                });
            };
            if self
                .read_app_storage(account_id, app_id, &schedule.enabled_entry, None)?
                .content
                != Value::Bool(true)
            {
                return Ok(WorkerInvokeReply {
                    result: Value::Null,
                    updated_entries: Vec::new(),
                });
            }
        }
        let started = Instant::now();
        {
            let mut statuses = self.0.workers.statuses.lock().unwrap();
            let status = statuses.entry(key.clone()).or_default();
            status.running = true;
            status.last_run_at = Some(timestamp());
            status.last_trigger = trigger["kind"].as_str().map(str::to_owned);
        }
        let mut secrets = BTreeMap::new();
        let result = self
            .execute_worker(account_id, app_id, trigger, workspace_id, &mut secrets)
            .await;
        let result = result.map_err(|mut error| {
            let mut values: Vec<_> = secrets.values().filter(|s| !s.is_empty()).collect();
            values.sort_unstable_by_key(|value| std::cmp::Reverse(value.len()));
            for secret in values {
                error.message = error.message.replace(secret, "[REDACTED]");
                for detail in &mut error.details {
                    *detail = detail.replace(secret, "[REDACTED]");
                }
            }
            error
        });
        let mut statuses = self.0.workers.statuses.lock().unwrap();
        let status = statuses.entry(key).or_default();
        status.running = false;
        status.last_duration_ms = Some(started.elapsed().as_millis() as u64);
        status.last_ok = Some(result.is_ok());
        status.last_error = result.as_ref().err().map(|e| e.message.clone());
        result
    }

    async fn execute_worker(
        &self,
        account_id: &str,
        app_id: &str,
        trigger: Value,
        workspace_id: Option<&str>,
        secrets: &mut BTreeMap<String, String>,
    ) -> Result<WorkerInvokeReply, CoreError> {
        let (definition, worker) = self.worker_definition(app_id)?;
        if workspace_id.is_some() {
            let db = self.lock_db()?;
            let tx = db.unchecked_transaction().map_err(db_error)?;
            super::app_storage::check_workspace_owner(&tx, account_id, workspace_id)?;
        }
        let mut storage = BTreeMap::new();
        let mut revisions = BTreeMap::new();
        for entry in definition.storage.iter().flat_map(|s| &s.entries) {
            if workspace_id.is_none() && entry.key.contains("{workspace_id}") {
                continue;
            }
            let value = self.read_app_storage(account_id, app_id, &entry.id, workspace_id)?;
            storage.insert(entry.id.clone(), value.content);
            revisions.insert(entry.id.clone(), value.revision);
        }
        {
            let db = self.lock_db()?;
            for secret in &worker.secrets {
                let value: Option<String> = db.query_row("SELECT value FROM app_secrets WHERE account_id=?1 AND app_id=?2 AND secret_id=?3", params![account_id, app_id, secret.id], |row| row.get(0)).optional().map_err(db_error)?;
                if let Some(value) = value {
                    secrets.insert(secret.id.clone(), value);
                }
            }
        }
        let root = self
            .db_path()
            .and_then(std::path::Path::parent)
            .map(|p| p.join("worker-state"))
            .unwrap_or_else(|| std::env::temp_dir().join("kaleidoscope-worker-state"));
        let state_dir = root
            .join(super::app_storage::bucket_id(account_id, app_id))
            .join(app_id);
        std::fs::create_dir_all(&state_dir)
            .map_err(|e| server_error(&format!("워커 폴더를 만들 수 없습니다: {e}")))?;
        let input = serde_json::to_vec(&json!({"app_id":app_id,"trigger":trigger,"storage":storage,"storage_revisions":revisions,"secrets":secrets,"state_dir":state_dir,"now":timestamp()})).map_err(|e| server_error(&e.to_string()))?;
        let interpreter = if cfg!(windows) { "python" } else { "python3" };
        let mut command = tokio::process::Command::new(interpreter);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        command
            .arg("-c")
            .arg(&worker.code)
            .current_dir(&state_dir)
            .env_clear();
        for name in ["PATH", "HOME", "USER"] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        command
            .env("LANG", "C.UTF-8")
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|e| server_error(&format!("워커를 시작할 수 없습니다: {e}")))?;
        let timeout =
            Duration::from_secs(worker.timeout_secs.unwrap_or(WORKER_TIMEOUT_DEFAULT_SECS) as u64);
        let output = tokio::time::timeout(timeout, async {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| std::io::Error::other("stdin 없음"))?;
            stdin.write_all(&input).await?;
            drop(stdin);
            child.wait_with_output().await
        })
        .await
        .map_err(|_| server_error("워커 실행 시간이 초과되었습니다"))?
        .map_err(|e| server_error(&format!("워커 실행 실패: {e}")))?;
        if !output.status.success() {
            return Err(server_error(&format!(
                "워커 실행 실패: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let output: Value = serde_json::from_str(&stdout)
            .or_else(|_| {
                serde_json::from_str(
                    stdout
                        .lines()
                        .rev()
                        .find(|line| !line.trim().is_empty())
                        .unwrap_or(""),
                )
            })
            .map_err(|e| server_error(&format!("워커 출력을 읽을 수 없습니다: {e}")))?;
        let object = output
            .as_object()
            .ok_or_else(|| server_error("워커 출력은 JSON 객체여야 합니다"))?;
        let mut updated_entries = Vec::new();
        if let Some(writes) = object.get("set_storage") {
            let writes = writes
                .as_object()
                .ok_or_else(|| server_error("set_storage는 객체여야 합니다"))?;
            for (entry, value) in writes {
                let (reply, account, update) = self.write_app_storage(
                    account_id,
                    app_id,
                    entry,
                    workspace_id,
                    value.clone(),
                    revisions.get(entry).cloned().unwrap_or(None),
                )?;
                revisions.insert(entry.clone(), Some(reply.revision));
                super::app_storage_http::send_storage_update(self, app_id, &account, update);
                updated_entries.push(entry.clone());
            }
        }
        Ok(WorkerInvokeReply {
            result: object.get("result").cloned().unwrap_or(Value::Null),
            updated_entries,
        })
    }
}

pub(super) fn spawn_watch(
    state: &AppState,
    account: &str,
    app: &str,
    entry: &str,
    workspace: Option<&str>,
) {
    let (state, account, app, entry, workspace) = (
        state.clone(),
        account.to_owned(),
        app.to_owned(),
        entry.to_owned(),
        workspace.map(str::to_owned),
    );
    tokio::spawn(async move {
        if let Err(error) = state
            .trigger_watched_entry(&account, &app, &entry, workspace.as_deref())
            .await
        {
            eprintln!("워커 감시 실행 실패: {}", error.message);
        }
    });
}

pub async fn worker_schedule_tick(state: &AppState) {
    let apps = match state.current_apps() {
        Ok(apps) => apps,
        Err(error) => {
            eprintln!("워커 앱 조회 실패: {}", error.message);
            return;
        }
    };
    let accounts = (|| -> Result<HashSet<String>, CoreError> {
        let db = state.lock_db()?;
        let mut statement = db.prepare("SELECT account_id FROM mcp_principal UNION SELECT account_id FROM app_storage_buckets").map_err(db_error)?;
        let accounts = statement
            .query_map([], |row| row.get(0))
            .map_err(db_error)?
            .collect::<rusqlite::Result<HashSet<_>>>()
            .map_err(db_error)?;
        Ok(accounts)
    })();
    let accounts = match accounts {
        Ok(accounts) => accounts,
        Err(error) => {
            eprintln!("워커 계정 조회 실패: {}", error.message);
            return;
        }
    };
    for app in apps {
        let Some(schedule) = app
            .version
            .definition
            .worker
            .as_ref()
            .and_then(|w| w.schedule.as_ref())
        else {
            continue;
        };
        for account in &accounts {
            let key = (account.clone(), app.app.id.clone());
            let enabled =
                match state.read_app_storage(account, &app.app.id, &schedule.enabled_entry, None) {
                    Ok(value) => value.content == Value::Bool(true),
                    Err(error) => {
                        eprintln!("워커 주기 설정 조회 실패: {}", error.message);
                        continue;
                    }
                };
            let due = {
                let mut next = state.0.workers.next_due.lock().unwrap();
                if !enabled {
                    next.remove(&key);
                    false
                } else if next.get(&key).is_none_or(|due| *due <= Instant::now()) {
                    let jitter = rand::rng().random_range(0..=schedule.jitter_secs.unwrap_or(0));
                    next.insert(
                        key.clone(),
                        Instant::now()
                            + Duration::from_secs((schedule.interval_secs + jitter) as u64),
                    );
                    true
                } else {
                    false
                }
            };
            if due {
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(error) = state
                        .run_worker(&key.0, &key.1, json!({"kind":"schedule"}), None)
                        .await
                    {
                        eprintln!("워커 주기 실행 실패: {}", error.message);
                    }
                });
            }
        }
    }
}

pub async fn worker_schedule_loop(state: AppState) {
    loop {
        worker_schedule_tick(&state).await;
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

pub(super) async fn device_invoke(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(app): Path<String>,
    Json(request): Json<WorkerInvokeRequest>,
) -> Response {
    let result = match state.device_account_id(&device.0) {
        Ok(account) => state.invoke_worker(&account, &app, request).await,
        Err(error) => Err(error),
    };
    match result {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err(error) => {
            let status = match error.code {
                ErrorCode::NotFound => StatusCode::NOT_FOUND,
                ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            super::http::error_response(status, error)
        }
    }
}
