//! 원천과 실시간 연결이 공유하는 연결 이름별 관문.
use super::DataRuntimes;
use chrono::{DateTime, Utc};

pub(super) struct Gate {
    until: DateTime<Utc>,
    failures: u32,
}

pub(super) fn backoff_seconds(failures: u32) -> u64 {
    30u64
        .saturating_mul(1u64 << failures.saturating_sub(1).min(5))
        .min(600)
}

pub(crate) fn blocked(manager: &DataRuntimes, key: &str) -> Option<DateTime<Utc>> {
    manager
        .gates
        .lock()
        .unwrap()
        .get(key)
        .map(|gate| gate.until)
        .filter(|until| *until > Utc::now())
}

pub(crate) fn record_limit(
    manager: &DataRuntimes,
    key: &str,
    retry_after: Option<u64>,
) -> DateTime<Utc> {
    let mut gates = manager.gates.lock().unwrap();
    let failures = gates
        .get(key)
        .map_or(1, |gate| gate.failures.saturating_add(1));
    let seconds = retry_after.unwrap_or_else(|| backoff_seconds(failures));
    let until = Utc::now() + chrono::Duration::seconds(seconds.min(i64::MAX as u64) as i64);
    gates.insert(key.into(), Gate { until, failures });
    until
}

pub(crate) fn release_expired(manager: &DataRuntimes, key: &str) {
    let mut gates = manager.gates.lock().unwrap();
    if gates.get(key).is_some_and(|gate| gate.until <= Utc::now()) {
        gates.remove(key);
    }
}

pub(super) fn clear(manager: &DataRuntimes) {
    manager.gates.lock().unwrap().clear();
}
