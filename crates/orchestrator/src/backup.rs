use super::*;

pub fn backup_once(state: &AppState) -> Result<PathBuf, String> {
    let Some(db_path) = state.db_path() else {
        return Err("메모리 데이터베이스는 백업하지 않습니다".into());
    };
    let parent = db_path.parent().unwrap_or_else(|| Path::new("."));
    let dir = parent.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| format!("백업 폴더를 만들 수 없습니다: {e}"))?;
    let destination = dir.join(format!(
        "registry-{}.db",
        Utc::now().format("%Y%m%dT%H%M%SZ")
    ));
    let escaped = destination.to_string_lossy().replace('\'', "''");
    state
        .lock_db()
        .map_err(|e| e.message)?
        .execute_batch(&format!("VACUUM INTO '{escaped}'"))
        .map_err(|e| format!("VACUUM INTO 실패: {e}"))?;
    let mut backups = std::fs::read_dir(&dir)
        .map_err(|e| format!("백업 폴더를 읽을 수 없습니다: {e}"))?
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "db"))
        .collect::<Vec<_>>();
    backups.sort_by_key(|e| e.file_name());
    while backups.len() > 7 {
        let old = backups.remove(0);
        std::fs::remove_file(old.path())
            .map_err(|e| format!("오래된 백업을 지울 수 없습니다: {e}"))?;
    }
    Ok(destination)
}

pub async fn backup_loop(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(24 * 60 * 60));
    interval.tick().await;
    loop {
        interval.tick().await;
        if let Err(e) = backup_once(&state) {
            eprintln!("백업에 실패했습니다: {e}");
        }
    }
}
