//! 창별 원천과 식 결과. 입출력은 잠금 밖에서 수행하고 세대가 같은 결과만 반영한다.
// 기존 창별 원천 수명 경로가 이미 500줄을 넘는다. 별도 수명 리팩터링은 이 변경에 섞지 않는다.
mod actions;
mod liveness;
mod storage;
pub(crate) use actions::{act, layout_errors};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, Weak};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
pub(crate) use storage::changed as storage_changed;

pub(crate) fn binding_value(
    inner: &Inner,
    window: &str,
    pointer: &str,
) -> Option<kaleidoscope_contract::data::BindingValue> {
    let windows = inner.data_runtimes.windows.lock().unwrap();
    windows.get(window)?.view().values.get(pointer).cloned()
}

use kaleidoscope_contract::{
    data::{DataView, SourceDecl, SourceFormat, SourceMeta, SourceState, SourceStatus},
    AppDefinition, CoreError, CoreEvent, CoreReply, ErrorCode,
};
use kaleidoscope_data::{CompiledApp, SourcePlan};
use serde_json::Value;

use crate::{app_commands, connections::RequestError, data_sources, error, Inner};

pub(crate) struct DataRuntimes {
    windows: Mutex<BTreeMap<String, Runtime>>,
    request_cache: Mutex<Vec<(RequestCacheKey, CachedRequest)>>,
    flights: Mutex<Vec<(RequestCacheKey, Arc<Mutex<()>>)>>,
    gates: Mutex<BTreeMap<String, Gate>>,
    pub(crate) shell_visible: AtomicBool,
    next_generation: AtomicU64,
    events: mpsc::Sender<(String, u32, DataView)>,
    receiver: Mutex<Option<mpsc::Receiver<(String, u32, DataView)>>>,
}
impl Default for DataRuntimes {
    fn default() -> Self {
        let (events, receiver) = mpsc::channel();
        Self {
            windows: Mutex::new(BTreeMap::new()),
            request_cache: Mutex::new(Vec::new()),
            flights: Mutex::new(Vec::new()),
            gates: Mutex::new(BTreeMap::new()),
            shell_visible: AtomicBool::new(true),
            next_generation: AtomicU64::new(0),
            events,
            receiver: Mutex::new(Some(receiver)),
        }
    }
}

struct Runtime {
    version: u32,
    using_defaults: bool,
    definition: AppDefinition,
    compiled: CompiledApp,
    state: BTreeMap<String, Value>,
    sources: BTreeMap<String, Source>,
    data: BTreeMap<String, Value>,
    dormant: Vec<String>,
    visible: bool,
    storage: BTreeMap<String, storage::Slot>,
    storage_meta: storage::MetaSlot,
    attached: usize,
    last: DataView,
    profiler: crate::profiler::Profiler,
}
#[derive(Clone, PartialEq, Eq)]
struct RequestCacheKey {
    app_id: String,
    permission: String,
    path: String,
    query: BTreeMap<String, String>,
    format: SourceFormat,
}
#[derive(Clone)]
struct CachedRequest {
    value: Value,
    fetched_at: chrono::DateTime<chrono::Utc>,
    fetched_instant: Instant,
    updated_at: Option<String>,
}
struct Source {
    plan: SourcePlan,
    status: SourceStatus,
    generation: u64,
    in_flight: bool,
    last_fetched: Option<Instant>,
    last_success_at: Option<chrono::DateTime<chrono::Utc>>,
    last_success_instant: Option<Instant>,
    retrying_after_failure: bool,
    waiting: Option<chrono::DateTime<chrono::Utc>>,
}
struct Gate {
    until: chrono::DateTime<chrono::Utc>,
    failures: u32,
}
fn backoff_seconds(failures: u32) -> u64 {
    30u64
        .saturating_mul(1u64 << failures.saturating_sub(1).min(5))
        .min(600)
}
struct Job {
    window: String,
    name: String,
    plan: SourcePlan,
    format: SourceFormat,
    generation: u64,
    key: Option<RequestCacheKey>,
    gate: Option<String>,
    ttl: Duration,
    force: bool,
}

impl Runtime {
    fn new(
        version: u32,
        definition: AppDefinition,
        state: BTreeMap<String, Value>,
        using_defaults: bool,
        profiler: crate::profiler::Profiler,
    ) -> Self {
        let compiled = CompiledApp::compile(&definition);
        let sources = definition
            .sources
            .keys()
            .map(|name| {
                (
                    name.clone(),
                    Source {
                        plan: SourcePlan::Idle,
                        status: SourceStatus::Idle {},
                        generation: 0,
                        in_flight: false,
                        last_fetched: None,
                        last_success_at: None,
                        last_success_instant: None,
                        retrying_after_failure: false,
                        waiting: None,
                    },
                )
            })
            .collect();
        let (storage, storage_meta) = storage::initial_slots(&definition);
        Self {
            version,
            using_defaults,
            definition,
            compiled,
            state,
            sources,
            data: BTreeMap::new(),
            dormant: Vec::new(),
            visible: true,
            storage,
            storage_meta,
            attached: 0,
            last: DataView::default(),
            profiler,
        }
    }
    fn source_meta(&self) -> BTreeMap<String, SourceMeta> {
        self.sources
            .iter()
            .map(|(name, source)| {
                let (state, mut message) = match &source.status {
                    SourceStatus::Idle {} => (SourceState::Idle, None),
                    SourceStatus::Loading { .. } => (SourceState::Loading, None),
                    SourceStatus::Ready { .. } => (SourceState::Ready, None),
                    SourceStatus::Failed { message, .. } => {
                        (SourceState::Failed, Some(message.clone()))
                    }
                    SourceStatus::LoginRequired { .. } => (SourceState::LoginRequired, None),
                };
                if let Some(until) = source.waiting {
                    message = Some(format!(
                        "요청 한도로 {}에 다시 받습니다",
                        until.with_timezone(&chrono::Local).format("%H:%M")
                    ));
                }
                let expired = source
                    .last_success_instant
                    .zip(self.definition.sources[name].refresh_secs())
                    .is_some_and(|(time, secs)| time.elapsed() >= Duration::from_secs(secs.into()));
                let stale = source.last_success_at.is_some()
                    && (expired
                        || source.retrying_after_failure
                        || matches!(state, SourceState::Failed | SourceState::LoginRequired));
                (
                    name.clone(),
                    SourceMeta {
                        state,
                        updated_at: source
                            .last_success_at
                            .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
                        updated_time: source
                            .last_success_at
                            .map(|at| at.with_timezone(&chrono::Local).format("%H:%M").to_string()),
                        stale,
                        message,
                    },
                )
            })
            .collect()
    }
    fn data_meta_values(&self) -> BTreeMap<String, Value> {
        self.source_meta()
            .into_iter()
            .map(|(name, meta)| {
                (
                    name,
                    serde_json::to_value(meta).expect("원천 메타데이터 JSON"),
                )
            })
            .collect()
    }
    fn add_client_inputs(
        &self,
        values: &mut BTreeMap<String, kaleidoscope_contract::data::BindingValue>,
    ) {
        use kaleidoscope_contract::data::{Binding, BindingValue};
        if let Some(client) = &self.definition.client {
            for (name, binding) in &client.inputs {
                let value = match binding {
                    Binding::State(reference) => Some(
                        self.state
                            .get(&reference.state)
                            .cloned()
                            .unwrap_or(Value::Null),
                    ),
                    Binding::Literal(value) => Some(value.clone()),
                    Binding::Expr(_) | Binding::Client(_) => None,
                };
                if let Some(value) = value {
                    values.insert(
                        format!(
                            "/client/inputs/{}",
                            kaleidoscope_contract::data::escape_pointer(name)
                        ),
                        BindingValue::Ready { value },
                    );
                }
            }
        }
    }
    fn view(&self) -> DataView {
        let started = Instant::now();
        let statuses: BTreeMap<_, _> = self
            .sources
            .iter()
            .map(|(name, source)| (name.clone(), source.status.clone()))
            .collect();
        let (storage, meta) = self.storage_values();
        let mut values = self.compiled.evaluate_profiled(
            &self.state,
            &self.data,
            &storage,
            &meta,
            &self.data_meta_values(),
            &statuses,
            None,
            &mut |binding, ms| {
                self.profiler.binding(
                    &self.definition.id,
                    &self.definition.name,
                    &binding.pointer,
                    &binding.expr,
                    Some(ms),
                )
            },
        );
        self.profiler.span(
            "data.view",
            "바인딩 계산",
            &self.definition.id,
            &self.definition.name,
            started.elapsed().as_secs_f64() * 1000.0,
            self.compiled.binding_dependencies().len(),
            0,
            "",
        );
        for binding in self.compiled.binding_dependencies() {
            if let Some(status) =
                self.storage_problem(&binding.storage, !binding.storage_meta.is_empty())
            {
                values.insert(binding.pointer.clone(), status);
            }
        }
        self.add_client_inputs(&mut values);
        DataView {
            values,
            sources: statuses,
            source_meta: self.source_meta(),
        }
    }
    fn view_selected(&self, selected: &std::collections::BTreeSet<String>) -> DataView {
        let started = Instant::now();
        let statuses: BTreeMap<_, _> = self
            .sources
            .iter()
            .map(|(name, source)| (name.clone(), source.status.clone()))
            .collect();
        let (storage, meta) = self.storage_values();
        let mut values = self.last.values.clone();
        values.extend(self.compiled.evaluate_profiled(
            &self.state,
            &self.data,
            &storage,
            &meta,
            &self.data_meta_values(),
            &statuses,
            Some(selected),
            &mut |binding, ms| {
                self.profiler.binding(
                    &self.definition.id,
                    &self.definition.name,
                    &binding.pointer,
                    &binding.expr,
                    Some(ms),
                )
            },
        ));
        for binding in self
            .compiled
            .binding_dependencies()
            .iter()
            .filter(|binding| !selected.contains(&binding.pointer))
        {
            self.profiler.binding(
                &self.definition.id,
                &self.definition.name,
                &binding.pointer,
                &binding.expr,
                None,
            );
        }
        self.profiler.span(
            "data.view",
            "바인딩 계산",
            &self.definition.id,
            &self.definition.name,
            started.elapsed().as_secs_f64() * 1000.0,
            selected.len(),
            self.compiled
                .binding_dependencies()
                .len()
                .saturating_sub(selected.len()),
            "",
        );
        for binding in self
            .compiled
            .binding_dependencies()
            .iter()
            .filter(|binding| selected.contains(&binding.pointer))
        {
            if let Some(problem) =
                self.storage_problem(&binding.storage, !binding.storage_meta.is_empty())
            {
                values.insert(binding.pointer.clone(), problem);
            }
        }
        self.add_client_inputs(&mut values);
        DataView {
            values,
            sources: statuses,
            source_meta: self.source_meta(),
        }
    }
    fn selected_for(
        &self,
        keys: &BTreeSet<String>,
        sources: &BTreeSet<String>,
    ) -> BTreeSet<String> {
        self.compiled
            .binding_dependencies()
            .iter()
            .filter(|binding| {
                let state_changed = !keys.is_empty()
                    && binding
                        .state
                        .as_ref()
                        .is_none_or(|refs| refs.iter().any(|name| keys.contains(name)));
                let dynamic_data = ["$data", "$data_meta"].iter().any(|variable| {
                    binding.expr.match_indices(variable).any(|(index, _)| {
                        let next = binding.expr.as_bytes().get(index + variable.len()).copied();
                        next.is_none_or(|byte| {
                            byte != b'.' && !byte.is_ascii_alphanumeric() && byte != b'_'
                        })
                    })
                });
                let source_changed = !sources.is_empty()
                    && (binding
                        .data
                        .iter()
                        .chain(&binding.data_meta)
                        .any(|name| sources.contains(name))
                        || dynamic_data);
                state_changed || source_changed || !self.last.values.contains_key(&binding.pointer)
            })
            .map(|binding| binding.pointer.clone())
            .collect()
    }

    fn diff(&mut self) -> Option<DataView> {
        let next = self.view();
        self.diff_view(next)
    }
    fn diff_view(&mut self, next: DataView) -> Option<DataView> {
        let delta = DataView {
            sources: next
                .sources
                .iter()
                .filter(|(key, value)| self.last.sources.get(*key) != Some(*value))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            source_meta: next
                .source_meta
                .iter()
                .filter(|(key, value)| self.last.source_meta.get(*key) != Some(*value))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            values: next
                .values
                .iter()
                .filter(|(key, value)| self.last.values.get(*key) != Some(*value))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        };
        self.last = next;
        if delta.sources.is_empty() && delta.values.is_empty() && delta.source_meta.is_empty() {
            None
        } else {
            Some(delta)
        }
    }
}

fn source_format(source: &SourceDecl) -> SourceFormat {
    match source {
        SourceDecl::Request { format, .. } | SourceDecl::File { format, .. } => *format,
        SourceDecl::Folder { .. } => SourceFormat::Json,
    }
}

fn request_cache_key(
    app_id: &str,
    plan: &SourcePlan,
    format: SourceFormat,
) -> Option<RequestCacheKey> {
    let SourcePlan::Request {
        permission,
        path,
        query,
    } = plan
    else {
        return None;
    };
    Some(RequestCacheKey {
        app_id: app_id.into(),
        permission: permission.clone(),
        path: path.clone(),
        query: query.clone(),
        format,
    })
}

fn request_cache_get(manager: &DataRuntimes, key: &RequestCacheKey) -> Option<CachedRequest> {
    manager
        .request_cache
        .lock()
        .unwrap()
        .iter()
        .find(|(cached_key, _)| cached_key == key)
        .map(|(_, cached)| cached.clone())
}

fn request_cache_store(manager: &DataRuntimes, key: RequestCacheKey, cached: CachedRequest) {
    let mut cache = manager.request_cache.lock().unwrap();
    if let Some((_, existing)) = cache.iter_mut().find(|(cached_key, _)| cached_key == &key) {
        *existing = cached;
        return;
    }
    cache.push((key, cached));
    if cache.len() > 256 {
        if let Some(oldest) = cache
            .iter()
            .enumerate()
            .min_by_key(|(_, (_, cached))| cached.fetched_instant)
            .map(|(index, _)| index)
        {
            cache.remove(oldest);
        }
    }
}

fn restored_ready(runtime: &Runtime, name: &str) -> bool {
    runtime.data.contains_key(name)
        && matches!(
            runtime.sources.get(name).map(|source| &source.status),
            Some(SourceStatus::Ready { .. })
        )
}

fn should_prepare_after_plan(
    runtime: &Runtime,
    name: &str,
    changed: bool,
    fetch_missing: bool,
) -> bool {
    (changed || (fetch_missing && !runtime.data.contains_key(name)))
        && liveness::source_live(runtime, name)
        && liveness::deps_ready(runtime, name)
        && !runtime.sources[name].in_flight
        && !restored_ready(runtime, name)
}

fn set_plan(manager: &DataRuntimes, runtime: &mut Runtime, name: &str, plan: SourcePlan) -> bool {
    if runtime.sources[name].plan == plan {
        return false;
    }
    let format = source_format(&runtime.definition.sources[name]);
    let ttl = runtime.definition.sources[name]
        .refresh_secs()
        .map(|seconds| Duration::from_secs(seconds.into()))
        .unwrap_or(Duration::from_secs(300));
    let cache_hit = request_cache_key(&runtime.definition.id, &plan, format)
        .and_then(|key| request_cache_get(manager, &key))
        .filter(|cached| Instant::now().saturating_duration_since(cached.fetched_instant) < ttl);
    let source = runtime.sources.get_mut(name).unwrap();
    source.generation = manager.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
    source.in_flight = false;
    source.last_fetched = None;
    source.retrying_after_failure = false;
    source.waiting = None;
    if let Some(cached) = cache_hit {
        runtime.data.insert(name.to_owned(), cached.value);
        source.last_fetched = Some(cached.fetched_instant);
        source.last_success_at = Some(cached.fetched_at);
        source.last_success_instant = Some(cached.fetched_instant);
        source.status = SourceStatus::Ready {
            updated_at: cached
                .updated_at
                .unwrap_or_else(crate::state_commands::timestamp),
        };
    } else {
        runtime.data.remove(name);
        source.last_success_at = None;
        source.last_success_instant = None;
        source.status = match &plan {
            SourcePlan::Invalid(message) => SourceStatus::Failed {
                message: message.clone(),
                has_value: false,
            },
            _ => SourceStatus::Idle {},
        };
    }
    source.plan = plan;
    true
}

fn gate_key(runtime: &Runtime, name: &str) -> Option<String> {
    let permission = runtime.definition.sources[name].permission();
    runtime
        .definition
        .permissions
        .iter()
        .find_map(|decl| match decl {
            kaleidoscope_contract::PermissionDecl::Http { id, base_url, .. }
                if id == permission =>
            {
                url::Url::parse(base_url)
                    .ok()?
                    .host_str()
                    .map(str::to_owned)
            }
            kaleidoscope_contract::PermissionDecl::Connection { id, connection, .. }
                if id == permission =>
            {
                Some(connection.clone())
            }
            _ => None,
        })
}

fn prepare(
    manager: &DataRuntimes,
    runtime: &mut Runtime,
    window: &str,
    name: &str,
    force: bool,
) -> Option<Job> {
    let gate = gate_key(runtime, name);
    let until = gate
        .as_ref()
        .and_then(|key| {
            manager
                .gates
                .lock()
                .unwrap()
                .get(key)
                .map(|gate| gate.until)
        })
        .filter(|until| *until > chrono::Utc::now());
    let source = runtime.sources.get_mut(name)?;
    if source.in_flight || matches!(source.plan, SourcePlan::Idle | SourcePlan::Invalid(_)) {
        return None;
    }
    if let Some(until) = until {
        source.waiting = Some(until);
        source.retrying_after_failure = true;
        source.status = SourceStatus::Loading {
            has_value: runtime.data.contains_key(name),
        };
        return None;
    }
    source.waiting = None;
    source.retrying_after_failure |= matches!(
        source.status,
        SourceStatus::Failed { .. } | SourceStatus::LoginRequired { .. }
    );
    source.generation = manager.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
    source.in_flight = true;
    source.last_fetched = Some(Instant::now());
    source.status = SourceStatus::Loading {
        has_value: runtime.data.contains_key(name),
    };
    Some(Job {
        window: window.into(),
        name: name.into(),
        plan: source.plan.clone(),
        format: source_format(&runtime.definition.sources[name]),
        generation: source.generation,
        key: request_cache_key(
            &runtime.definition.id,
            &source.plan,
            source_format(&runtime.definition.sources[name]),
        ),
        gate,
        ttl: Duration::from_secs(
            runtime.definition.sources[name]
                .refresh_secs()
                .map(u64::from)
                .unwrap_or(300),
        ),
        force,
    })
}

fn jobs(inner: &Arc<Inner>, pending: Vec<Job>) -> Vec<JoinHandle<()>> {
    pending
        .into_iter()
        .map(|job| {
            let inner = Arc::clone(inner);
            thread::spawn(move || {
                let started = Instant::now();
                let flight = job.key.as_ref().map(|key| {
                    let mut flights = inner.data_runtimes.flights.lock().unwrap();
                    if let Some((_, flight)) = flights.iter().find(|(existing, _)| existing == key)
                    {
                        return Arc::clone(flight);
                    }
                    let flight = Arc::new(Mutex::new(()));
                    flights.push((key.clone(), Arc::clone(&flight)));
                    flight
                });
                let _flight_guard = flight.as_ref().map(|flight| flight.lock().unwrap());
                let blocked = job
                    .gate
                    .as_ref()
                    .and_then(|key| {
                        inner
                            .data_runtimes
                            .gates
                            .lock()
                            .unwrap()
                            .get(key)
                            .map(|gate| gate.until)
                    })
                    .filter(|until| *until > chrono::Utc::now());
                let source_times = inner
                    .data_runtimes
                    .windows
                    .lock()
                    .unwrap()
                    .get(&job.window)
                    .and_then(|runtime| runtime.sources.get(&job.name))
                    .filter(|source| source.generation == job.generation)
                    .map(|source| {
                        (
                            source.last_fetched,
                            source
                                .retrying_after_failure
                                .then_some(source.last_success_instant),
                        )
                    });
                let cached = job
                    .key
                    .as_ref()
                    .and_then(|key| request_cache_get(&inner.data_runtimes, key))
                    .filter(|cached| {
                        cached.fetched_instant.elapsed() < job.ttl
                            && source_times.is_some_and(|(started, retry_state)| {
                                (!job.force
                                    || started.is_some_and(|at| cached.fetched_instant > at))
                                    && retry_state.is_none_or(|previous| {
                                        previous.is_none_or(|at| cached.fetched_instant > at)
                                    })
                            })
                    });
                let fetched = blocked.is_none() && cached.is_none();
                let result = if blocked.is_some() {
                    Err(RequestError::RateLimited { retry_after: None })
                } else if let Some(cached) = &cached {
                    Ok(cached.value.clone())
                } else {
                    data_sources::fetch(&inner, &job.window, &job.plan, job.format)
                };
                let wait_until = match (&job.gate, &result, blocked) {
                    (_, _, Some(until)) => Some(until),
                    (Some(key), Err(RequestError::RateLimited { retry_after }), None) => {
                        let mut gates = inner.data_runtimes.gates.lock().unwrap();
                        let failures = gates
                            .get(key)
                            .map_or(1, |gate| gate.failures.saturating_add(1));
                        let seconds = retry_after.unwrap_or_else(|| backoff_seconds(failures));
                        let until = chrono::Utc::now()
                            + chrono::Duration::seconds(seconds.min(i64::MAX as u64) as i64);
                        gates.insert(key.clone(), Gate { until, failures });
                        Some(until)
                    }
                    (Some(key), Ok(_), None) if fetched => {
                        inner.data_runtimes.gates.lock().unwrap().remove(key);
                        None
                    }
                    _ => None,
                };
                let mut follow_up = Vec::new();
                {
                    let state = inner.state.lock().unwrap();
                    let mut windows = inner.data_runtimes.windows.lock().unwrap();
                    let Some(runtime) = windows.get_mut(&job.window) else {
                        return;
                    };
                    if fetched {
                        inner.profiler.span(
                            "data.source",
                            &job.name,
                            &runtime.definition.id,
                            &runtime.definition.name,
                            started.elapsed().as_secs_f64() * 1000.0,
                            0,
                            0,
                            "",
                        );
                    }
                    if !state.shared.windows.iter().any(|window| {
                        window.id == job.window
                            && window.app_version == runtime.version
                            && runtime.plan_source_at(&job.name, &window.state) == job.plan
                    }) {
                        return;
                    }
                    let cache_key = job.key.clone();
                    let fallback_cache = cache_key
                        .as_ref()
                        .and_then(|key| request_cache_get(&inner.data_runtimes, key));
                    let Some(source) = runtime.sources.get_mut(&job.name) else {
                        return;
                    };
                    if source.generation != job.generation {
                        return;
                    }
                    source.in_flight = false;
                    match result {
                        Ok(value) => {
                            let fetched_at = cached
                                .as_ref()
                                .map_or_else(chrono::Utc::now, |c| c.fetched_at);
                            let fetched_instant = cached
                                .as_ref()
                                .map_or_else(Instant::now, |c| c.fetched_instant);
                            let updated_at = cached
                                .as_ref()
                                .and_then(|c| c.updated_at.clone())
                                .unwrap_or_else(crate::state_commands::timestamp);
                            runtime.data.insert(job.name.clone(), value.clone());
                            source.last_fetched = Some(fetched_instant);
                            source.last_success_at = Some(fetched_at);
                            source.last_success_instant = Some(fetched_instant);
                            source.retrying_after_failure = false;
                            source.waiting = None;
                            source.status = SourceStatus::Ready {
                                updated_at: updated_at.clone(),
                            };
                            if let Some(key) = cache_key.clone() {
                                request_cache_store(
                                    &inner.data_runtimes,
                                    key,
                                    CachedRequest {
                                        value,
                                        fetched_at,
                                        fetched_instant,
                                        updated_at: Some(updated_at),
                                    },
                                );
                            }
                        }
                        Err(RequestError::Login(permission)) => {
                            source.status = SourceStatus::LoginRequired { permission }
                        }
                        Err(RequestError::RateLimited { .. }) => {
                            source.waiting = wait_until;
                            source.retrying_after_failure = true;
                            source.status = SourceStatus::Loading {
                                has_value: runtime.data.contains_key(&job.name),
                            };
                        }
                        Err(RequestError::Core(err)) => {
                            if !runtime.data.contains_key(&job.name) {
                                if let Some(cached) = fallback_cache.clone() {
                                    runtime.data.insert(job.name.clone(), cached.value);
                                    source.last_success_at = Some(cached.fetched_at);
                                    source.last_success_instant = Some(cached.fetched_instant);
                                }
                            }
                            source.status = SourceStatus::Failed {
                                message: err.message,
                                has_value: runtime.data.contains_key(&job.name),
                            }
                        }
                    }
                    let mut changed_sources = BTreeSet::from([job.name.clone()]);
                    for name in runtime.compiled.source_order().to_vec() {
                        if name == job.name {
                            continue;
                        }
                        let plan = runtime.plan_source(&name);
                        let changed = set_plan(&inner.data_runtimes, runtime, &name, plan);
                        let old_status = runtime.sources[&name].status.clone();
                        runtime.apply_source_storage_status(&name);
                        if changed || runtime.sources[&name].status != old_status {
                            changed_sources.insert(name.clone());
                        }
                        if should_prepare_after_plan(runtime, &name, changed, false) {
                            if let Some(next) =
                                prepare(&inner.data_runtimes, runtime, &job.window, &name, false)
                            {
                                follow_up.push(next);
                            }
                        }
                    }
                    let selected = runtime.selected_for(&BTreeSet::new(), &changed_sources);
                    let next = runtime.view_selected(&selected);
                    if let Some(view) = runtime.diff_view(next).filter(|_| runtime.attached > 0) {
                        let _ = inner.data_runtimes.events.send((
                            job.window.clone(),
                            runtime.version,
                            view,
                        ));
                    }
                }
                drop(_flight_guard);
                if let (Some(key), Some(flight)) = (&job.key, &flight) {
                    let mut flights = inner.data_runtimes.flights.lock().unwrap();
                    if Arc::strong_count(flight) == 2 {
                        flights.retain(|(existing, _)| existing != key);
                    }
                }
                let handles = jobs(&inner, follow_up);
                let due = run_due(&inner, Some(&job.window));
                crate::local_agent::data_changed(&inner, &job.window);
                inner.layout_signal.notify();
                for handle in handles.into_iter().chain(due) {
                    let _ = handle.join();
                }
            })
        })
        .collect()
}

pub(crate) fn attach(
    inner: &Arc<Inner>,
    window_id: &str,
    dormant: Option<Vec<String>>,
) -> Result<CoreReply, CoreError> {
    let (view, pending, start_storage) = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|window| window.id == window_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let version = window.app_version;
        let using_defaults = crate::app_storage::uses_defaults_for(
            &state,
            inner.link_file.lock().unwrap().is_some(),
        );
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        if windows
            .get(window_id)
            .is_some_and(|runtime| runtime.version != version)
        {
            windows.remove(window_id);
        }
        let runtime = windows.entry(window_id.into()).or_insert_with(|| {
            Runtime::new(
                version,
                definition.clone(),
                window.state.clone(),
                using_defaults,
                inner.profiler.clone(),
            )
        });
        let already_attached = runtime.attached > 0;
        runtime.visible = liveness::visible(
            &state,
            window_id,
            inner.data_runtimes.shell_visible.load(Ordering::SeqCst),
        );
        if let Some(dormant) = dormant {
            runtime.dormant = dormant;
        }
        runtime.state = window.state.clone();
        runtime.attached += 1;
        let names = runtime.compiled.source_order().to_vec();
        let mut pending = Vec::new();
        for name in names {
            let plan = runtime.plan_source(&name);
            let changed = set_plan(&inner.data_runtimes, runtime, &name, plan);
            runtime.apply_source_storage_status(&name);
            if should_prepare_after_plan(runtime, &name, changed, true) {
                if let Some(job) = prepare(&inner.data_runtimes, runtime, window_id, &name, false) {
                    pending.push(job);
                }
            }
        }
        let view = runtime.view();
        if let Some(delta) = runtime.diff_view(view.clone()).filter(|_| already_attached) {
            let _ = inner
                .data_runtimes
                .events
                .send((window_id.into(), version, delta));
        }
        (view, pending, !already_attached)
    };
    if start_storage {
        storage::load(inner, window_id, None);
    }
    jobs(inner, pending);
    inner.layout_signal.notify();
    Ok(CoreReply::DataAttach { view })
}

pub(crate) fn dormant(
    inner: &Arc<Inner>,
    window_id: &str,
    dormant: Vec<String>,
) -> Result<CoreReply, CoreError> {
    {
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        windows
            .get_mut(window_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?
            .dormant = dormant;
    }
    run_due(inner, Some(window_id));
    Ok(CoreReply::DataDormant {})
}

pub(crate) fn detach(inner: &Arc<Inner>, window_id: &str) -> Result<CoreReply, CoreError> {
    let mut windows = inner.data_runtimes.windows.lock().unwrap();
    if let Some(runtime) = windows.get_mut(window_id) {
        runtime.attached = runtime.attached.saturating_sub(1);
    }
    drop(windows);
    inner.layout_signal.notify();
    Ok(CoreReply::DataDetach {})
}

pub(crate) fn refresh(
    inner: &Arc<Inner>,
    window_id: &str,
    names: &[String],
    wait: bool,
    force: bool,
) -> Result<(), CoreError> {
    let pending = {
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        let runtime = windows
            .get_mut(window_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let mut selected: std::collections::BTreeSet<String> = if names.is_empty() {
            runtime.compiled.source_order().iter().cloned().collect()
        } else {
            names.iter().cloned().collect()
        };
        for name in runtime.compiled.source_order().iter().rev() {
            if selected.contains(name) {
                for dep in runtime.compiled.source_dependencies(name) {
                    if !runtime.data.contains_key(dep)
                        || matches!(
                            runtime.sources.get(dep).map(|s| &s.status),
                            Some(SourceStatus::Failed { .. } | SourceStatus::LoginRequired { .. })
                        )
                    {
                        selected.insert(dep.clone());
                    }
                }
            }
        }
        let names: Vec<_> = runtime
            .compiled
            .source_order()
            .iter()
            .filter(|name| selected.contains(*name))
            .cloned()
            .collect();
        let pending = names
            .iter()
            .filter_map(|name| {
                if liveness::deps_ready(runtime, name) {
                    prepare(&inner.data_runtimes, runtime, window_id, name, force)
                } else {
                    None
                }
            })
            .collect();
        for name in runtime.compiled.source_order().to_vec() {
            runtime.apply_source_storage_status(&name);
        }
        if let Some(view) = runtime.diff().filter(|_| runtime.attached > 0) {
            let _ = inner
                .data_runtimes
                .events
                .send((window_id.into(), runtime.version, view));
        }
        pending
    };
    inner.layout_signal.notify();
    let handles = jobs(inner, pending);
    if wait {
        for handle in handles {
            let _ = handle.join();
        }
    }
    Ok(())
}

/// 다른 서버의 같은 창 id에 이전 원천과 저장값을 재사용하지 않는다.
pub(crate) fn server_changed(inner: &Inner) {
    inner.data_runtimes.windows.lock().unwrap().clear();
    inner.data_runtimes.request_cache.lock().unwrap().clear();
    inner.data_runtimes.gates.lock().unwrap().clear();
}

pub(crate) fn state_changed(inner: &Arc<Inner>) {
    let (pending, reloads) = {
        let state = inner.state.lock().unwrap();
        let using_defaults = crate::app_storage::uses_defaults_for(
            &state,
            inner.link_file.lock().unwrap().is_some(),
        );
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        windows.retain(|id, runtime| {
            state
                .shared
                .windows
                .iter()
                .any(|window| window.id == *id && window.app_version == runtime.version)
        });
        let mut pending = Vec::new();
        let mut reloads = Vec::new();
        for (id, runtime) in windows.iter_mut() {
            runtime.visible = liveness::visible(
                &state,
                id,
                inner.data_runtimes.shell_visible.load(Ordering::SeqCst),
            );
            if runtime.using_defaults != using_defaults {
                runtime.using_defaults = using_defaults;
                if runtime.attached > 0 {
                    reloads.push(id.clone());
                }
            }
            let window = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == *id)
                .unwrap();
            if runtime.state == window.state {
                continue;
            }
            let started = Instant::now();
            let keys: BTreeSet<_> = runtime
                .state
                .keys()
                .chain(window.state.keys())
                .filter(|key| runtime.state.get(*key) != window.state.get(*key))
                .cloned()
                .collect();
            runtime.state = window.state.clone();
            let names = runtime.compiled.source_order().to_vec();
            let mut changed_sources = BTreeSet::new();
            for name in names {
                let source = &runtime.definition.sources[&name];
                let depends = kaleidoscope_contract::data::source_bindings(source)
                    .iter()
                    .any(|(_, binding)| match binding {
                        kaleidoscope_contract::data::Binding::State(reference) => {
                            keys.contains(&reference.state)
                        }
                        kaleidoscope_contract::data::Binding::Expr(expr) => {
                            kaleidoscope_contract::data::state_refs(&expr.expr)
                                .is_none_or(|refs| refs.iter().any(|key| keys.contains(key)))
                        }
                        _ => false,
                    })
                    || runtime
                        .compiled
                        .source_dependencies(&name)
                        .iter()
                        .any(|dep| changed_sources.contains(dep))
                    || !matches!(runtime.sources[&name].status, SourceStatus::Ready { .. });
                if !depends {
                    continue;
                }
                let plan = runtime.plan_source(&name);
                let changed = set_plan(&inner.data_runtimes, runtime, &name, plan);
                let old_status = runtime.sources[&name].status.clone();
                runtime.apply_source_storage_status(&name);
                if changed || runtime.sources[&name].status != old_status {
                    changed_sources.insert(name.clone());
                }
                if should_prepare_after_plan(runtime, &name, changed, false) {
                    if let Some(job) = prepare(&inner.data_runtimes, runtime, id, &name, false) {
                        pending.push(job);
                    }
                }
            }
            let selected = runtime.selected_for(&keys, &changed_sources);
            let next = runtime.view_selected(&selected);
            inner.profiler.span(
                "data.state_change",
                "상태 변경",
                &runtime.definition.id,
                &runtime.definition.name,
                started.elapsed().as_secs_f64() * 1000.0,
                selected.len(),
                runtime
                    .compiled
                    .binding_dependencies()
                    .len()
                    .saturating_sub(selected.len()),
                "",
            );
            if let Some(view) = runtime.diff_view(next).filter(|_| runtime.attached > 0) {
                let _ = inner
                    .data_runtimes
                    .events
                    .send((id.clone(), runtime.version, view));
            }
        }
        (pending, reloads)
    };
    jobs(inner, pending);
    for id in reloads {
        storage::load(inner, &id, None);
    }
    run_due(inner, None);
    inner.layout_signal.notify();
}

pub(crate) fn grant_changed(inner: &Arc<Inner>, window: &str, permission: &str) {
    let names = {
        let windows = inner.data_runtimes.windows.lock().unwrap();
        windows
            .get(window)
            .map(|runtime| {
                runtime
                    .definition
                    .sources
                    .iter()
                    .filter(|(_, source)| source.permission() == permission)
                    .map(|(name, _)| name.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    if !names.is_empty() {
        let _ = refresh(inner, window, &names, false, true);
    }
}

pub(crate) fn connections_changed(inner: &Arc<Inner>, changed: &[String]) {
    let retries: Vec<_> = {
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        for runtime in windows.values_mut() {
            let permissions: std::collections::BTreeSet<_> = runtime
                .definition
                .permissions
                .iter()
                .filter_map(|permission| match permission {
                    kaleidoscope_contract::PermissionDecl::Connection {
                        id, connection, ..
                    } if changed.contains(connection) => Some(id.clone()),
                    _ => None,
                })
                .collect();
            inner
                .data_runtimes
                .request_cache
                .lock()
                .unwrap()
                .retain(|(key, _)| {
                    key.app_id != runtime.definition.id || !permissions.contains(&key.permission)
                });
        }
        windows.iter().filter_map(|(id, runtime)| {
            let names: Vec<_> = runtime.sources.iter().filter_map(|(name, source)| {
                let declaration = &runtime.definition.sources[name];
                let changed_connection = runtime.definition.permissions.iter().any(|permission| matches!(
                    permission,
                    kaleidoscope_contract::PermissionDecl::Connection { id, connection, .. }
                        if id == declaration.permission() && changed.contains(connection)
                ));
                (matches!(declaration, SourceDecl::Request { .. }) && changed_connection && matches!(source.status, SourceStatus::Failed { .. })).then_some(name.clone())
            }).collect();
            (!names.is_empty()).then_some((id.clone(), names))
        }).collect()
    };
    for (window, names) in retries {
        let _ = refresh(inner, &window, &names, false, true);
    }
}

pub(crate) fn connection_changed(inner: &Inner, permission: &str) {
    inner
        .data_runtimes
        .request_cache
        .lock()
        .unwrap()
        .retain(|(key, _)| key.permission != permission);
}

pub(crate) fn refresh_login_required(inner: &Arc<Inner>, connection: &str) {
    let retries: Vec<_> = {
        let windows = inner.data_runtimes.windows.lock().unwrap();
        windows
            .iter()
            .filter_map(|(window, runtime)| {
                let names: Vec<_> = runtime
                    .sources
                    .iter()
                    .filter_map(|(name, source)| {
                        let SourceStatus::LoginRequired { permission } = &source.status else {
                            return None;
                        };
                        let uses_connection = runtime.definition.permissions.iter().any(|decl| {
                            matches!(decl, kaleidoscope_contract::PermissionDecl::Connection {
                                id, connection: declared, ..
                            } if id == permission && declared == connection)
                        });
                        uses_connection.then(|| name.clone())
                    })
                    .collect();
                (!names.is_empty()).then(|| (window.clone(), names))
            })
            .collect()
    };
    for (window, names) in retries {
        let _ = refresh(inner, &window, &names, false, true);
    }
}

pub(crate) fn set_shell_visible(inner: &Arc<Inner>, visible: bool) {
    if inner
        .data_runtimes
        .shell_visible
        .swap(visible, Ordering::SeqCst)
        != visible
    {
        let state = inner.state.lock().unwrap();
        for (id, runtime) in inner.data_runtimes.windows.lock().unwrap().iter_mut() {
            runtime.visible = liveness::visible(&state, id, visible);
        }
        drop(state);
        run_due(inner, None);
    }
}

fn run_due(inner: &Arc<Inner>, only_window: Option<&str>) -> Vec<JoinHandle<()>> {
    let pending = {
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        let mut pending = Vec::new();
        for (window, runtime) in windows
            .iter_mut()
            .filter(|(id, _)| only_window.is_none_or(|wanted| wanted == id.as_str()))
        {
            let names = runtime.compiled.source_order().to_vec();
            let live = liveness::live_sources(runtime);
            for name in names {
                let source = &runtime.sources[&name];
                let due = runtime.attached > 0
                    && runtime.visible
                    && live.contains(&name)
                    && liveness::deps_ready(runtime, &name)
                    && !source.in_flight
                    && !matches!(source.plan, SourcePlan::Idle | SourcePlan::Invalid(_))
                    && source
                        .waiting
                        .is_none_or(|until| until <= chrono::Utc::now())
                    && match (
                        source.last_fetched,
                        runtime.definition.sources[&name].refresh_secs(),
                    ) {
                        (None, _) => true,
                        (_, _) if source.waiting.is_some() => true,
                        (Some(at), Some(secs)) => at.elapsed() >= Duration::from_secs(secs.into()),
                        (Some(_), None) => false,
                    };
                if due {
                    if let Some(job) = prepare(&inner.data_runtimes, runtime, window, &name, false)
                    {
                        pending.push(job);
                    }
                }
            }
            let meta = runtime.source_meta();
            let changed: BTreeSet<_> = meta
                .iter()
                .filter(|(name, value)| runtime.last.source_meta.get(*name) != Some(*value))
                .map(|(name, _)| name.clone())
                .collect();
            if !changed.is_empty() {
                let selected = runtime.selected_for(&BTreeSet::new(), &changed);
                let next = runtime.view_selected(&selected);
                if let Some(delta) = runtime.diff_view(next).filter(|_| runtime.attached > 0) {
                    let _ =
                        inner
                            .data_runtimes
                            .events
                            .send((window.clone(), runtime.version, delta));
                }
            }
        }
        pending
    };
    jobs(inner, pending)
}

pub(crate) fn start_timer(inner: Weak<Inner>) {
    if let Some(receiver) = inner
        .upgrade()
        .and_then(|inner| inner.data_runtimes.receiver.lock().unwrap().take())
    {
        let target = inner.clone();
        thread::spawn(move || {
            while let Ok((window_id, version, view)) = receiver.recv() {
                let Some(inner) = target.upgrade() else {
                    return;
                };
                let state = inner.state.lock().unwrap();
                let windows = inner.data_runtimes.windows.lock().unwrap();
                let attached = windows.get(&window_id).is_some_and(|runtime| {
                    runtime.attached > 0
                        && runtime.version == version
                        && state.shared.windows.iter().any(|window| {
                            window.id == window_id && window.app_version == runtime.version
                        })
                });
                drop(windows);
                drop(state);
                if attached {
                    inner.emit(&CoreEvent::DataUpdate { window_id, view });
                }
            }
        });
    }
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let Some(inner) = inner.upgrade() else {
            return;
        };
        run_due(&inner, None);
    });
}

#[cfg(test)]
mod freshness_tests {
    use super::*;
    use kaleidoscope_contract::validate::parse_app_definition;
    use serde_json::json;

    #[test]
    fn 한도_기본_대기는_두_배씩_늘고_600초에서_멈춘다() {
        assert_eq!(
            (1..=7).map(backoff_seconds).collect::<Vec<_>>(),
            vec![30, 60, 120, 240, 480, 600, 600]
        );
    }

    fn request_plan() -> SourcePlan {
        SourcePlan::Request {
            permission: "hn".into(),
            path: "/api/v1/search".into(),
            query: BTreeMap::from([("tags".into(), "front_page".into())]),
        }
    }

    fn request_runtime() -> Runtime {
        let definition = parse_app_definition(include_str!("../../../apps/reader.json")).unwrap();
        Runtime::new(
            2,
            definition.clone(),
            definition.state.clone(),
            true,
            Default::default(),
        )
    }

    fn seed_request_cache(
        manager: &DataRuntimes,
        runtime: &Runtime,
        plan: &SourcePlan,
        value: Value,
    ) {
        let key = request_cache_key(&runtime.definition.id, plan, SourceFormat::Json).unwrap();
        let fetched_at = chrono::Utc::now();
        let fetched_instant = Instant::now();
        request_cache_store(
            manager,
            key,
            CachedRequest {
                value,
                fetched_at,
                fetched_instant,
                updated_at: Some(crate::state_commands::timestamp()),
            },
        );
    }

    #[test]
    fn failure_preserves_success_but_new_plan_clears_it() {
        let definition = parse_app_definition(&json!({
            "id":"freshness", "name":"신선도 시험", "requires":{"blocks":4,"modules":{"files":1}},
            "permissions":[{"module":"files","id":"file","label":"파일","access":"read"}],
            "state":{}, "sources":{"item":{"kind":"file","permission":"file","path":"a.json"}},
            "ui":{"type":"text","value":{"expr":"$data_meta.item.stale"}}
        }).to_string()).unwrap();
        let mut runtime = Runtime::new(1, definition, BTreeMap::new(), true, Default::default());
        let manager = DataRuntimes::default();
        let first = SourcePlan::File {
            permission: "file".into(),
            path: "a.json".into(),
            format: SourceFormat::Json,
        };
        set_plan(&manager, &mut runtime, "item", first);
        runtime.data.insert("item".into(), json!({"value":1}));
        let source = runtime.sources.get_mut("item").unwrap();
        source.last_success_at = Some(chrono::Utc::now());
        source.last_success_instant = Some(Instant::now());
        source.status = SourceStatus::Failed {
            message: "오류".into(),
            has_value: true,
        };
        let meta = &runtime.source_meta()["item"];
        assert!(meta.stale && meta.updated_at.is_some());
        assert_eq!(runtime.data["item"]["value"], 1);
        prepare(&manager, &mut runtime, "window", "item", false);
        assert!(runtime.source_meta()["item"].stale);
        let next = SourcePlan::File {
            permission: "file".into(),
            path: "b.json".into(),
            format: SourceFormat::Json,
        };
        assert!(set_plan(&manager, &mut runtime, "item", next));
        assert!(!runtime.data.contains_key("item"));
        assert!(runtime.source_meta()["item"].updated_at.is_none());
    }

    #[test]
    fn request_idle_request_restores_fresh_data_without_preparing_a_job() {
        let manager = DataRuntimes::default();
        let mut runtime = request_runtime();
        let request = request_plan();
        assert!(set_plan(&manager, &mut runtime, "stories", request.clone()));
        seed_request_cache(
            &manager,
            &runtime,
            &request,
            json!({"hits":[{"objectID":"cached","title":"캐시"}]}),
        );
        assert!(set_plan(
            &manager,
            &mut runtime,
            "stories",
            SourcePlan::Idle
        ));
        assert!(!runtime.data.contains_key("stories"));
        runtime.last = runtime.view();

        assert!(set_plan(&manager, &mut runtime, "stories", request));
        assert_eq!(runtime.data["stories"]["hits"][0]["objectID"], "cached");
        assert!(matches!(
            runtime.sources["stories"].status,
            SourceStatus::Ready { .. }
        ));
        assert!(!should_prepare_after_plan(&runtime, "stories", true, true));
        let selected = runtime.selected_for(&BTreeSet::new(), &BTreeSet::from(["stories".into()]));
        let incremental = runtime.view_selected(&selected);
        assert_eq!(incremental.values, runtime.view().values);
    }

    #[test]
    fn explicit_refresh_prepares_request_even_when_cache_has_a_value() {
        let manager = DataRuntimes::default();
        let mut runtime = request_runtime();
        let request = request_plan();
        assert!(set_plan(&manager, &mut runtime, "stories", request.clone()));
        seed_request_cache(&manager, &runtime, &request, json!({"cached":true}));
        runtime
            .data
            .insert("stories".into(), json!({"cached":true}));
        runtime.sources.get_mut("stories").unwrap().status = SourceStatus::Ready {
            updated_at: crate::state_commands::timestamp(),
        };

        let job = prepare(&manager, &mut runtime, "window", "stories", true).unwrap();
        assert_eq!(job.plan, request);
        assert!(matches!(
            runtime.sources["stories"].status,
            SourceStatus::Loading { has_value: true }
        ));
    }
}
