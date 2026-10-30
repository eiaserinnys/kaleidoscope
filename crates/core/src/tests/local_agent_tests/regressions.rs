use super::*;

#[test]
fn failed_stream_does_not_contaminate_next_turn() {
    let dir = tempfile::tempdir().unwrap();
    let worker = WorkerHandle::start(config(dir.path(), ""), Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    worker.send(prompt("first", "fail-turn")).unwrap();
    wait(&worker, LocalAgentPhase::Failed);
    worker.retry().unwrap();
    wait(&worker, LocalAgentPhase::Ready);
    worker.send(prompt("second", "fresh-turn")).unwrap();
    until(|| {
        worker
            .snapshot()
            .history
            .iter()
            .any(|item| item.kind == ConversationItemKind::Assistant)
    });
    let replies: Vec<_> = worker
        .snapshot()
        .history
        .into_iter()
        .filter(|i| i.kind == ConversationItemKind::Assistant)
        .map(|i| i.text)
        .collect();
    assert_eq!(replies, vec!["NEW"]);
}

#[test]
fn failed_record_save_rejects_send_and_allows_same_id_again() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = config(dir.path(), "");
    let record = cfg.record_dir.clone();
    let backup = dir.path().join("record-backup");
    let worker = WorkerHandle::start(cfg, Arc::new(|_| {}));
    wait(&worker, LocalAgentPhase::Ready);
    std::fs::rename(&record, &backup).unwrap();
    std::fs::write(&record, b"not a directory").unwrap();
    let result = worker.send(prompt("same-id", "hello"));
    assert!(result.is_err(), "저장 실패를 접수 성공으로 반환했습니다");
    assert_eq!(worker.snapshot().phase, LocalAgentPhase::Ready);
    assert!(worker.snapshot().history.is_empty());
    std::fs::remove_file(&record).unwrap();
    std::fs::rename(&backup, &record).unwrap();
    assert!(!worker.send(prompt("same-id", "hello")).unwrap());
    until(|| {
        worker
            .snapshot()
            .history
            .iter()
            .any(|i| i.kind == ConversationItemKind::Assistant)
    });
    assert_eq!(
        worker
            .snapshot()
            .history
            .iter()
            .filter(|i| i.kind == ConversationItemKind::User && i.id == "same-id")
            .count(),
        1
    );
}
