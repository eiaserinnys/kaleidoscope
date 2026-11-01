//! 앱별 서버 워커 실행, 시크릿과 주기 트리거.
use super::*;
use kaleidoscope_contract::worker::{
    WorkerDecl, WorkerInvokeReply, WorkerInvokeRequest, WorkerStatus, WORKER_SECRET_MAX_BYTES,
    WORKER_TIMEOUT_DEFAULT_SECS,
};
use std::{collections::BTreeMap, time::Instant};

pub(super) struct WorkerOutput {
    pub(super) reply: WorkerInvokeReply,
    pub(super) http_response: Option<Value>,
    pub(super) defer: Option<Value>,
}

type WorkerKey = (String, String);
#[derive(Default)]
pub(super) struct WorkerState {
    locks: Mutex<HashMap<(WorkerKey, bool), Arc<AsyncMutex<()>>>>,
    statuses: Mutex<HashMap<(WorkerKey, bool), WorkerStatus>>,
    runs: Mutex<HashMap<WorkerKey, Vec<WorkerStatus>>>,
    pub(super) next_due: Mutex<HashMap<WorkerKey, Instant>>,
}

impl AppState {
    pub(super) fn worker_definition(
        &self,
        app_id: &str,
    ) -> Result<(AppDefinition, WorkerDecl), CoreError> {
        let definition = {
            let db = self.lock_db()?;
            super::app_storage::current_definition(&db, app_id)?
                .ok_or_else(|| CoreError::new(ErrorCode::NotFound))?
        };
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
        let statuses = self.0.workers.statuses.lock().unwrap();
        let key = (account_id.into(), app_id.into());
        Ok(statuses
            .get(&(key.clone(), false))
            .or_else(|| statuses.get(&(key, true)))
            .cloned()
            .unwrap_or_default())
    }

    pub fn list_worker_runs(
        &self,
        account_id: &str,
        app_id: &str,
    ) -> Result<Vec<WorkerStatus>, CoreError> {
        self.worker_definition(app_id)?;
        Ok(self
            .0
            .workers
            .runs
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
        self.invoke_worker_chain(account_id, app_id, req, vec![app_id.to_owned()], None)
            .await
    }

    pub(super) async fn invoke_worker_chain(
        &self,
        account_id: &str,
        app_id: &str,
        req: WorkerInvokeRequest,
        chain: Vec<String>,
        deadline: Option<tokio::time::Instant>,
    ) -> Result<WorkerInvokeReply, CoreError> {
        let (_, worker) = self.worker_definition(app_id)?;
        if !worker.actions.contains(&req.action) {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        let trigger = json!({"kind":"action","action":req.action,"args":req.args,"workspace_id":req.workspace_id});
        self.run_worker(
            account_id,
            app_id,
            trigger,
            req.workspace_id.as_deref(),
            chain,
            deadline,
        )
        .await
        .map(|output| output.reply)
    }

    pub async fn trigger_watched_entry(
        &self,
        account_id: &str,
        app_id: &str,
        entry_id: &str,
        workspace_id: Option<&str>,
    ) -> Result<Option<WorkerInvokeReply>, CoreError> {
        let definition = {
            let db = self.lock_db()?;
            super::app_storage::current_definition(&db, app_id)?
        };
        let Some(definition) = definition else {
            return Ok(None);
        };
        if !definition
            .worker
            .as_ref()
            .is_some_and(|w| w.watch_entries.iter().any(|id| id == entry_id))
        {
            return Ok(None);
        }
        let trigger = json!({"kind":"watch","entry_id":entry_id,"workspace_id":workspace_id});
        self.run_worker(
            account_id,
            app_id,
            trigger,
            workspace_id,
            vec![app_id.to_owned()],
            None,
        )
        .await
        .map(|output| Some(output.reply))
    }

    pub(super) fn run_worker<'a>(
        &'a self,
        account_id: &'a str,
        app_id: &'a str,
        trigger: Value,
        workspace_id: Option<&'a str>,
        chain: Vec<String>,
        parent_deadline: Option<tokio::time::Instant>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<WorkerOutput, CoreError>> + Send + 'a>,
    > {
        Box::pin(async move {
            let key = (account_id.to_owned(), app_id.to_owned());
            let webhook = trigger["kind"] == "webhook";
            let run_key = (key.clone(), webhook);
            let lock = self
                .0
                .workers
                .locks
                .lock()
                .unwrap()
                .entry(run_key.clone())
                .or_default()
                .clone();
            let _guard = if let Some(deadline) = parent_deadline {
                tokio::time::timeout_at(deadline, lock.lock())
                    .await
                    .map_err(|_| server_error("워커 호출 대기 시간이 초과되었습니다"))?
            } else {
                lock.lock().await
            };
            let (_, worker) = self.worker_definition(app_id)?;
            let own_deadline = tokio::time::Instant::now()
                + Duration::from_secs(
                    worker.timeout_secs.unwrap_or(WORKER_TIMEOUT_DEFAULT_SECS) as u64
                );
            let deadline = parent_deadline.map_or(own_deadline, |parent| parent.min(own_deadline));
            if trigger["kind"] == "schedule" {
                let (_, worker) = self.worker_definition(app_id)?;
                let Some(schedule) = worker.schedule else {
                    return Ok(WorkerOutput {
                        reply: WorkerInvokeReply {
                            result: Value::Null,
                            updated_entries: Vec::new(),
                        },
                        http_response: None,
                        defer: None,
                    });
                };
                if self
                    .read_app_storage(account_id, app_id, &schedule.enabled_entry, None)?
                    .content
                    != Value::Bool(true)
                {
                    return Ok(WorkerOutput {
                        reply: WorkerInvokeReply {
                            result: Value::Null,
                            updated_entries: Vec::new(),
                        },
                        http_response: None,
                        defer: None,
                    });
                }
            }
            let started = Instant::now();
            {
                let mut statuses = self.0.workers.statuses.lock().unwrap();
                let status = statuses.entry(run_key.clone()).or_default();
                status.running = true;
                status.last_run_at = Some(timestamp());
                status.last_trigger = trigger["kind"].as_str().map(str::to_owned);
            }
            let mut secrets = BTreeMap::new();
            let result = self
                .execute_worker(
                    account_id,
                    app_id,
                    trigger,
                    workspace_id,
                    &mut secrets,
                    chain,
                    deadline,
                )
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
            let status = statuses.entry(run_key).or_default();
            status.running = false;
            status.last_duration_ms = Some(started.elapsed().as_millis() as u64);
            status.last_ok = Some(result.is_ok());
            status.last_error = result.as_ref().err().map(|e| e.message.clone());
            let finished = status.clone();
            drop(statuses);
            let mut runs = self.0.workers.runs.lock().unwrap();
            let history = runs
                .entry((account_id.to_owned(), app_id.to_owned()))
                .or_default();
            history.insert(0, finished);
            history.truncate(50);
            result
        })
    }

    async fn execute_worker(
        &self,
        account_id: &str,
        app_id: &str,
        trigger: Value,
        workspace_id: Option<&str>,
        secrets: &mut BTreeMap<String, String>,
        chain: Vec<String>,
        deadline: tokio::time::Instant,
    ) -> Result<WorkerOutput, CoreError> {
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
        let code_dir = tempfile::tempdir().map_err(|e| server_error(&e.to_string()))?;
        std::fs::write(
            code_dir.path().join("kaleidoscope_worker.py"),
            include_str!("kaleidoscope_worker.py"),
        )
        .map_err(|e| server_error(&e.to_string()))?;
        let (bridge_url, bridge_token, _bridge) = super::worker_bridge::start(
            self.clone(),
            account_id,
            worker.calls.clone(),
            chain,
            workspace_id,
            deadline,
        )
        .await?;
        let output = super::worker_process::execute(
            &worker.code,
            &state_dir,
            code_dir.path(),
            &input,
            bridge_url,
            bridge_token,
            deadline,
        )
        .await?;
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
        Ok(WorkerOutput {
            reply: WorkerInvokeReply {
                result: object.get("result").cloned().unwrap_or(Value::Null),
                updated_entries,
            },
            http_response: object.get("http_response").cloned(),
            defer: object.get("defer").cloned(),
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

pub use super::worker_schedule::{worker_schedule_loop, worker_schedule_tick};
