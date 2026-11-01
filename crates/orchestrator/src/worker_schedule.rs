//! 워커의 주기 실행을 조정한다.
use super::*;
use rand::RngExt;
use std::time::Instant;

pub async fn worker_schedule_tick(state: &AppState) {
    let mut apps = match state.current_apps() {
        Ok(apps) => apps
            .into_iter()
            .map(|app| (app.app.id, app.version.definition))
            .collect::<Vec<_>>(),
        Err(error) => {
            eprintln!("워커 앱 조회 실패: {}", error.message);
            return;
        }
    };
    for identity in kaleidoscope_contract::builtin::BUILTIN_IDENTITIES {
        if let Ok(Some(definition)) = state
            .lock_db()
            .and_then(|db| super::app_storage::current_definition(&db, identity.id))
        {
            if definition.worker.is_some() {
                apps.push((identity.id.to_owned(), definition));
            }
        }
    }
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
    for (app_id, definition) in apps {
        let Some(schedule) = definition.worker.as_ref().and_then(|w| w.schedule.as_ref()) else {
            continue;
        };
        for account in &accounts {
            let key = (account.clone(), app_id.clone());
            let enabled =
                match state.read_app_storage(account, &app_id, &schedule.enabled_entry, None) {
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
                        .run_worker(
                            &key.0,
                            &key.1,
                            json!({"kind":"schedule"}),
                            None,
                            vec![key.1.clone()],
                            None,
                        )
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
