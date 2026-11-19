//! 앱 정의의 `streams`와 `request` 원천의 `watch`. 지금 열어 둘 스트림을 정하고, 알림이 오면
//! 규칙이 맞는 원천을 다시 받을 때로 표시한다. 알림 내용은 값으로 쓰지 않는다.
use super::*;
use crate::source_streams::StreamKey;
use kaleidoscope_contract::data::{
    escape_pointer, WatchDecl, WatchRule, WATCH_COALESCE_DEFAULT_SECS, WATCH_COALESCE_MIN_SECS,
};

pub(super) fn coalesce(watch: &WatchDecl) -> Duration {
    Duration::from_secs(u64::from(
        watch
            .coalesce_secs
            .unwrap_or(WATCH_COALESCE_DEFAULT_SECS)
            .max(WATCH_COALESCE_MIN_SECS),
    ))
}

fn watched_stream<'a>(runtime: &'a Runtime, name: &str) -> Option<(&'a WatchDecl, StreamKey)> {
    let SourceDecl::Request {
        watch: Some(watch), ..
    } = &runtime.definition.sources[name]
    else {
        return None;
    };
    let stream = runtime.definition.streams.get(&watch.stream)?;
    let connection = runtime
        .definition
        .permissions
        .iter()
        .find_map(|permission| match permission {
            kaleidoscope_contract::PermissionDecl::Connection { id, connection, .. }
                if id == &stream.permission =>
            {
                Some(connection.clone())
            }
            _ => None,
        })?;
    Some((
        watch,
        StreamKey {
            connection,
            path: stream.path.clone(),
            query: stream.query.clone(),
        },
    ))
}

fn watching(runtime: &Runtime, key: &StreamKey) -> Vec<(String, Duration)> {
    runtime
        .definition
        .sources
        .keys()
        .filter_map(|name| {
            let (watch, watched) = watched_stream(runtime, name)?;
            (watched == *key).then(|| (name.clone(), coalesce(watch)))
        })
        .collect()
}

/// 지금 열어 둘 스트림. run_due가 받을 수 있다고 보는 원천(붙은 창, 보임, live, deps, plan 유효)이
/// 하나라도 가리키는 스트림만 고른다.
pub(crate) fn stream_keys(inner: &Inner) -> Vec<StreamKey> {
    let windows = inner.data_runtimes.windows.lock().unwrap();
    let mut keys = BTreeSet::new();
    for runtime in windows.values() {
        if runtime.attached == 0 || !runtime.visible {
            continue;
        }
        let live = liveness::live_sources(runtime);
        for name in runtime.definition.sources.keys() {
            let Some((_, key)) = watched_stream(runtime, name) else {
                continue;
            };
            let Some(source) = runtime.sources.get(name) else {
                continue;
            };
            if !live.contains(name)
                || !liveness::deps_ready(runtime, name)
                || !matches!(source.plan, SourcePlan::Request { .. })
            {
                continue;
            }
            keys.insert(key);
        }
    }
    keys.into_iter().collect()
}

/// 알림 하나를 규칙과 맞춘다. `where`가 없으면 이름만 보고, 있으면 알림 `data:`를 JSON으로 읽어
/// 최상위 칸을 이 인스턴스의 바인딩 값과 비교한다. 값이 null인 칸은 무엇이든 맞는다.
fn rule_matches(
    runtime: &Runtime,
    source: &str,
    index: usize,
    rule: &WatchRule,
    payload: Option<&Value>,
) -> bool {
    let Some(where_) = &rule.where_ else {
        return true;
    };
    let Some(Value::Object(object)) = payload else {
        return false;
    };
    let (storage, storage_meta) = runtime.storage_values();
    let null = Value::Null;
    let env = kaleidoscope_data::Env {
        state: &runtime.state,
        data: &runtime.data,
        data_meta: &BTreeMap::new(),
        storage: &storage,
        storage_meta: &storage_meta,
        apps: runtime.apps.as_deref(),
        event: &null,
        item: &null,
        modifiers: None,
    };
    where_.iter().all(|(field, binding)| {
        let pointer = format!(
            "/sources/{}/watch/on/{index}/where/{}",
            escape_pointer(source),
            escape_pointer(field)
        );
        let Ok(expected) = runtime.compiled.evaluate_binding(binding, &pointer, &env) else {
            return false;
        };
        if expected.is_null() {
            return true;
        }
        object.get(field).is_some_and(|actual| actual == &expected)
    })
}

fn watch_matches(
    runtime: &Runtime,
    source: &str,
    watch: &WatchDecl,
    event: &str,
    payload: Option<&Value>,
) -> bool {
    watch.on.iter().enumerate().any(|(index, rule)| {
        rule.event == event && rule_matches(runtime, source, index, rule, payload)
    })
}

fn mark_due(runtime: &mut Runtime, name: &str, coalesce: Duration) {
    let Some(source) = runtime.sources.get_mut(name) else {
        return;
    };
    if source.watch_due.is_some() {
        return;
    }
    source.watch_due = Some(Instant::now() + coalesce);
}

/// 스트림 알림 하나를 받았다. 규칙이 맞는 원천 인스턴스를 다시 받을 때로 표시한다.
pub(crate) fn notified(inner: &Arc<Inner>, key: &StreamKey, event: &str, data: &[u8]) {
    let payload = serde_json::from_slice::<Value>(data).ok();
    let mut windows = inner.data_runtimes.windows.lock().unwrap();
    for runtime in windows.values_mut() {
        let matched: Vec<_> = watching(runtime, key)
            .into_iter()
            .filter(|(name, _)| {
                watched_stream(runtime, name).is_some_and(|(watch, _)| {
                    watch_matches(runtime, name, watch, event, payload.as_ref())
                })
            })
            .collect();
        for (name, coalesce) in matched {
            mark_due(runtime, &name, coalesce);
        }
    }
}

/// 스트림이 (다시) 이어졌다. 마지막 받기가 coalesce보다 오래된 원천을 바로 받을 때로 표시한다.
pub(crate) fn connected(inner: &Arc<Inner>, key: &StreamKey) {
    let mut windows = inner.data_runtimes.windows.lock().unwrap();
    for runtime in windows.values_mut() {
        for (name, coalesce) in watching(runtime, key) {
            let Some(source) = runtime.sources.get_mut(&name) else {
                continue;
            };
            if source.in_flight || source.watch_due.is_some() {
                continue;
            }
            if source
                .last_fetched
                .is_some_and(|at| at.elapsed() < coalesce)
            {
                continue;
            }
            source.watch_due = Some(Instant::now());
        }
    }
}
