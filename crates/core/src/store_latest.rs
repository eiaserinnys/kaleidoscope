//! 설치 출처별 스토어 색인의 최신 판을 코어 메모리에 둔다.
use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kaleidoscope_contract::store::{StoreIndexValue, StoreLatest};
use crate::Inner;

const STORE_LATEST_FIRST_CHECK_DELAY_SECS: u64 = 10;
const STORE_LATEST_CHECK_INTERVAL_SECS: u64 = 3600;

pub(crate) struct Runtime {
    started: Instant,
    data: Mutex<Schedule>,
}

#[derive(Default)]
struct Schedule {
    attempted: BTreeMap<String, Instant>,
    inflight: HashSet<String>,
    gates: BTreeMap<String, Arc<Mutex<()>>>,
}

impl Default for Runtime {
    fn default() -> Self { Self { started: Instant::now(), data: Mutex::new(Schedule::default()) } }
}

pub(crate) fn gate(inner: &Inner, url: &str) -> Arc<Mutex<()>> {
    inner.store_latest.data.lock().unwrap().gates.entry(url.to_owned()).or_default().clone()
}

pub(crate) fn record(inner: &Arc<Inner>, index: &StoreIndexValue) {
    let Ok(url) = crate::store::StoreUrl::parse(&index.server) else { return };
    let url = url.as_str().to_owned();
    let entries = index.items.iter().map(|item| (item.id.clone(), StoreLatest { release: item.release, compatible: item.compatible })).collect();
    inner.store_latest.data.lock().unwrap().attempted.insert(url.clone(), Instant::now());
    let mut state = inner.state.lock().unwrap();
    if state.store_latest.get(&url) == Some(&entries) { return; }
    state.store_latest.insert(url, entries);
    drop(state);
    crate::data_runtime::apps_changed(inner);
}

pub(crate) fn tick(inner: &Arc<Inner>) {
    tick_at(inner, Instant::now());
}

pub(crate) fn tick_at(inner: &Arc<Inner>, now: Instant) {
    if now.duration_since(inner.store_latest.started) < Duration::from_secs(STORE_LATEST_FIRST_CHECK_DELAY_SECS) { return; }
    let state = inner.state.lock().unwrap();
    let urls: HashSet<String> = state.shared.apps.iter()
        .filter_map(|app| app.origin.as_ref())
        .filter_map(|origin| crate::store::StoreUrl::parse(&origin.store_url).ok())
        .filter(|url| crate::store::authorize(url, &state.device.store_servers).is_ok())
        .map(|url| url.as_str().to_owned())
        .collect();
    drop(state);
    let mut schedule = inner.store_latest.data.lock().unwrap();
    let due: Vec<_> = urls.into_iter().filter(|url| {
        !schedule.inflight.contains(url) && schedule.attempted.get(url).is_none_or(|at| now.duration_since(*at) >= Duration::from_secs(STORE_LATEST_CHECK_INTERVAL_SECS))
    }).collect();
    for url in &due { schedule.inflight.insert(url.clone()); }
    drop(schedule);
    for url in due {
        let target = Arc::downgrade(inner);
        std::thread::spawn(move || {
            let Some(inner) = target.upgrade() else { return };
            let gate = gate(&inner, &url);
            let _guard = gate.lock().unwrap();
            let should_fetch = inner.store_latest.data.lock().unwrap().attempted.get(&url)
                .is_none_or(|at| now.duration_since(*at) >= Duration::from_secs(STORE_LATEST_CHECK_INTERVAL_SECS));
            if should_fetch {
                let result = crate::store::client(&inner, &url).and_then(|client| client.index("").map_err(|failure| failure.error));
                match result {
                    Ok(index) => record(&inner, &index),
                    Err(error) => {
                        inner.store_latest.data.lock().unwrap().attempted.insert(url.clone(), Instant::now());
                        if let Some(code) = error.id.as_deref() {
                            eprintln!("스토어 최신 판을 확인하지 못했습니다: code={code} {}", error.message);
                        } else {
                            eprintln!("스토어 최신 판을 확인하지 못했습니다: {}", error.message);
                        }
                    }
                }
            }
            inner.store_latest.data.lock().unwrap().inflight.remove(&url);
        });
    }
}
