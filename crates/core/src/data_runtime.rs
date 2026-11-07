//! 창별 원천과 식 결과. 입출력은 잠금 밖에서 수행하고 세대가 같은 결과만 반영한다.
// 기존 창별 원천 수명 경로가 이미 500줄을 넘는다. 별도 수명 리팩터링은 이 변경에 섞지 않는다.
mod actions;
pub(crate) mod gates;
mod liveness;
mod paging;
mod storage;
pub(crate) use actions::{act, layout_errors};
pub(crate) use paging::more;
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
    errors, AppDefinition, CoreError, CoreEvent, CoreReply,
};
use kaleidoscope_data::{CompiledApp, SourcePlan};
use serde_json::Value;

use crate::{app_commands, connections::RequestError, data_sources, Inner};

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
    connected: bool,
    storage_reconnect_pending: bool,
    storage_startup_pending: bool,
    startup: crate::startup_readiness::Snapshot,
    definition: AppDefinition,
    apps: Option<Vec<kaleidoscope_contract::store::InstalledAppValue>>,
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
    startup_wait: Option<crate::startup_readiness::WaitFor>,
    last_fetched: Option<Instant>,
    last_success_at: Option<chrono::DateTime<chrono::Utc>>,
    last_success_instant: Option<Instant>,
    retrying_after_failure: bool,
    waiting: Option<chrono::DateTime<chrono::Utc>>,
    paging: paging::Paging,
}
use gates::Gate;
#[cfg(test)]
use gates::backoff_seconds;

pub(crate) fn window_visible(inner: &Inner, window: &str) -> bool {
    liveness::visible(
        &inner.state.lock().unwrap(),
        window,
        inner.data_runtimes.shell_visible.load(Ordering::SeqCst),
    )
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
    page: Option<kaleidoscope_contract::data::PageDecl>,
    pages: usize,
}

impl Runtime {
    fn new(
        version: u32,
        definition: AppDefinition,
        state: BTreeMap<String, Value>,
        using_defaults: bool,
        connected: bool,
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
                        startup_wait: None,
                        last_fetched: None,
                        last_success_at: None,
                        last_success_instant: None,
                        retrying_after_failure: false,
                        waiting: None,
                        paging: paging::Paging::default(),
                    },
                )
            })
            .collect();
        let (storage, storage_meta) = storage::initial_slots(&definition);
        Self {
            version,
            using_defaults,
            connected,
            storage_reconnect_pending: false,
            storage_startup_pending: false,
            startup: Default::default(),
            definition,
            apps: None,
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
                    Binding::Expr(_)
                    | Binding::Client(_)
                    | Binding::Item(_)
                    | Binding::ParentItem(_)
                    | Binding::Message(_) => None,
                };
                if let Some(value) = value {
                    values.insert(
                        format!(
                            "/client/inputs/{}",
                            kaleidoscope_contract::data::escape_pointer(name)
                        ),
                        BindingValue::Ready { value, more: None },
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
            self.apps.as_deref(),
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
        self.label_expression_failures(&mut values);
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
        self.add_paging(&mut values, None);
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
            self.apps.as_deref(),
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
        self.label_expression_failures(&mut values);
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
        self.add_paging(&mut values, Some(selected));
        self.add_client_inputs(&mut values);
        DataView {
            values,
            sources: statuses,
            source_meta: self.source_meta(),
        }
    }
    fn add_paging(
        &self,
        values: &mut BTreeMap<String, kaleidoscope_contract::data::BindingValue>,
        selected: Option<&BTreeSet<String>>,
    ) {
        for binding in self.compiled.binding_dependencies() {
            if selected.is_some_and(|selected| !selected.contains(&binding.pointer)) { continue; }
            let mut paged = binding.data.iter().filter(|name| matches!(self.definition.sources.get(*name), Some(SourceDecl::Request { page: Some(_), .. })));
            let Some(name) = paged.next() else { continue; };
            if paged.next().is_some() { continue; }
            if let Some(kaleidoscope_contract::data::BindingValue::Ready { more, .. }) = values.get_mut(&binding.pointer) {
                *more = self.sources[name].paging.more(name);
            }
        }
    }
    fn label_expression_failures(
        &self,
        values: &mut BTreeMap<String, kaleidoscope_contract::data::BindingValue>,
    ) {
        for binding in self.compiled.binding_dependencies() {
            let Some(kaleidoscope_contract::data::BindingValue::Failed {
                message,
                id,
                retry,
                details,
                ..
            }) = values.get_mut(&binding.pointer)
            else {
                continue;
            };
            if id.is_some() || !retry.is_empty() {
                continue;
            }
            let reason = std::mem::take(message);
            let error = errors::DATA_BINDING_EXPR_FAILED().and_details(vec![
                format!("pointer: {}", binding.pointer),
                format!("reason: {reason}"),
            ]);
            *message = error.message;
            *id = error.id;
            *details = Some(error.details);
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
        SourceDecl::Folder { .. } | SourceDecl::Store(_) => SourceFormat::Json,
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
    live: &BTreeSet<String>,
    name: &str,
    changed: bool,
    fetch_missing: bool,
) -> bool {
    (changed || (fetch_missing && !runtime.data.contains_key(name)))
        && liveness::source_live(runtime, live, name)
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
    source.startup_wait = None;
    source.last_fetched = None;
    source.retrying_after_failure = false;
    source.waiting = None;
    source.paging = paging::Paging::default();
    if let Some(cached) = cache_hit {
        if let SourceDecl::Request { page: Some(page), .. } = &runtime.definition.sources[name] {
            source.paging = paging::first(name, page, &cached.value);
        }
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
            SourcePlan::Invalid(reason) => {
                let error = errors::DATA_SOURCE_PLAN_INVALID(name, reason);
                SourceStatus::Failed {
                    message: error.message,
                    has_value: false,
                    id: error.id,
                }
            }
            SourcePlan::StoreInvalid(error) => SourceStatus::Failed { message: error.message.clone(), has_value: false, id: error.id.clone() },
            _ => SourceStatus::Idle {},
        };
    }
    source.plan = plan;
    true
}

fn gate_key(runtime: &Runtime, name: &str) -> Option<String> {
    let permission = runtime.definition.sources[name].permission();
    if let SourcePlan::StoreIndex { server, .. } | SourcePlan::StoreApp { server, .. } = &runtime.sources[name].plan {
        return store_gate_key(server);
    }
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

pub(crate) fn store_gate_key(server: &str) -> Option<String> {
    crate::store::StoreUrl::parse(server).ok().map(|url| format!("store:{}", url.as_str()))
}

fn prepare(
    manager: &DataRuntimes,
    runtime: &mut Runtime,
    window: &str,
    name: &str,
    force: bool,
) -> Option<Job> {
    let gate = gate_key(runtime, name);
    let until = gate.as_ref().and_then(|key| gates::blocked(manager, key));
    let startup = match &runtime.definition.sources[name] {
        SourceDecl::Request { .. } => {
            runtime
                .definition
                .permissions
                .iter()
                .find_map(|decl| match decl {
                    kaleidoscope_contract::PermissionDecl::Connection {
                        id, connection, ..
                    } if id == runtime.definition.sources[name].permission() => {
                        Some(runtime.startup.for_connection(connection))
                    }
                    _ => None,
                })
        }
        _ => None,
    };
    let source = runtime.sources.get_mut(name)?;
    if source.in_flight || matches!(source.plan, SourcePlan::Idle | SourcePlan::Invalid(_) | SourcePlan::StoreInvalid(_)) {
        return None;
    }
    if let Some(crate::startup_readiness::Readiness::Pending(reason)) = startup {
        source.startup_wait = Some(reason);
        source.status = SourceStatus::Loading {
            has_value: runtime.data.contains_key(name),
        };
        return None;
    }
    source.startup_wait = None;
    let pages = source.paging.pages.max(1);
    source.paging.generation += 1;
    source.paging.state = paging::PagingState::Idle;
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
        page: match &runtime.definition.sources[name] { SourceDecl::Request { page, .. } => page.clone(), _ => None },
        pages,
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
                let blocked = job.gate.as_ref().and_then(|key| gates::blocked(&inner.data_runtimes, key));
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
                    data_sources::fetch_named(&inner, &job.window, &job.name, &job.plan, job.format)
                };
                let wait_until = match (&job.gate, &result, blocked) {
                    (_, _, Some(until)) => Some(until),
                    (Some(key), Err(RequestError::RateLimited { retry_after }), None) => {
                        Some(gates::record_limit(&inner.data_runtimes, key, *retry_after))
                    }
                    (Some(key), Ok(_), None) if fetched => {
                        gates::release_expired(&inner.data_runtimes, key);
                        None
                    }
                    _ => None,
                };
                let rebuilt = match (&job.page, &result) {
                    (Some(page), Ok(value)) => Some(paging::rebuild(&inner, &job, page, value)),
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
                            if let Some((combined, paging)) = rebuilt {
                                runtime.data.insert(job.name.clone(), combined);
                                source.paging = paging;
                            } else {
                                runtime.data.insert(job.name.clone(), value.clone());
                            }
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
                                    if let Some(page) = &job.page {
                                        source.paging = paging::first(&job.name, page, &cached.value);
                                    }
                                    runtime.data.insert(job.name.clone(), cached.value);
                                    source.last_success_at = Some(cached.fetched_at);
                                    source.last_success_instant = Some(cached.fetched_instant);
                                }
                            }
                            source.status = SourceStatus::Failed {
                                message: err.message,
                                has_value: runtime.data.contains_key(&job.name),
                                id: err.id,
                            }
                        }
                    }
                    let mut changed_sources = BTreeSet::from([job.name.clone()]);
                    let live = liveness::live_sources(runtime);
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
                        if should_prepare_after_plan(runtime, &live, &name, changed, false) {
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
            .ok_or_else(|| {
                errors::DATA_RUNTIME_ATTACH_WINDOW_NOT_FOUND()
                    .and_details(vec![format!("window: {}", window_id)])
            })?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| {
                    errors::DATA_RUNTIME_ATTACH_APP_NOT_FOUND()
                        .and_details(vec![format!("window: {}", window_id)])
                })?;
        let version = window.app_version;
        let using_defaults = crate::app_storage::uses_defaults_for(
            &state,
            inner.link_file.lock().unwrap().is_some(),
        );
        let startup = crate::startup_readiness::snapshot_locked(inner, &state);
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        if windows
            .get(window_id)
            .is_some_and(|runtime| runtime.version != version)
        {
            windows.remove(window_id);
        }
        let runtime = windows.entry(window_id.into()).or_insert_with(|| {
            let mut runtime = Runtime::new(
                version,
                definition.clone(),
                window.state.clone(),
                using_defaults,
                matches!(
                    state.link,
                    kaleidoscope_contract::LinkStatus::Connected { .. }
                ),
                inner.profiler.clone(),
            );
            runtime.startup = startup;
            runtime.apps = apps_for(&state, &definition);
            runtime
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
        let live = liveness::live_sources(runtime);
        let mut pending = Vec::new();
        for name in names {
            let plan = runtime.plan_source(&name);
            let changed = set_plan(&inner.data_runtimes, runtime, &name, plan);
            runtime.apply_source_storage_status(&name);
            if should_prepare_after_plan(runtime, &live, &name, changed, true) {
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
        (
            view,
            pending,
            !already_attached || runtime.has_failed_storage(),
        )
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
            .ok_or_else(|| {
                errors::DATA_RUNTIME_DORMANT_WINDOW_NOT_FOUND()
                    .and_details(vec![format!("window: {}", window_id)])
            })?
            .dormant = dormant;
    }
    run_due(inner, Some(window_id));
    Ok(CoreReply::DataDormant {})
}

/// 창의 지금 상태와 완성된 계산값을 복사해 돌려준다(`data.read`). 다시 계산하거나 원천을 받거나 저장하거나 이벤트를 내지
/// 않는다. 입력 `data.act`는 응답 전에 `runtime.state`와 `runtime.last`를 갱신하므로, 그 응답 뒤에 읽으면 새 값이다.
pub(crate) fn read(inner: &Arc<Inner>, window_id: &str) -> Result<CoreReply, CoreError> {
    let windows = inner.data_runtimes.windows.lock().unwrap();
    let runtime = windows.get(window_id).ok_or_else(|| {
        errors::DATA_READ_RUNTIME_NOT_FOUND().and_details(vec![format!("window: {}", window_id)])
    })?;
    Ok(CoreReply::DataRead { state: runtime.state.clone(), view: runtime.last.clone() })
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
        let runtime = windows.get_mut(window_id).ok_or_else(|| {
            errors::DATA_RUNTIME_REFRESH_WINDOW_NOT_FOUND()
                .and_details(vec![format!("window: {}", window_id)])
        })?;
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
    gates::clear(&inner.data_runtimes);
}

pub(crate) fn apps_for(state: &crate::CoreState, definition: &AppDefinition) -> Option<Vec<kaleidoscope_contract::store::InstalledAppValue>> {
    if !definition.permissions.iter().any(|p| matches!(p, kaleidoscope_contract::PermissionDecl::Store { .. })) {
        return None;
    }
    Some(state.shared.apps.iter().map(|app| kaleidoscope_contract::store::InstalledAppValue {
        id: app.id.clone(),
        name: app.name.clone(),
        version: app.current_version,
        origin: app.origin.clone(),
        latest: app.origin.as_ref().and_then(|origin| {
            let url = crate::store::StoreUrl::parse(&origin.store_url).ok()?;
            state.store_latest.get(url.as_str())?.get(&origin.store_app_id).cloned()
        }),
        installed_version: app.installed_version,
        modified: app.origin.is_some() && app.installed_version != Some(app.current_version),
        icon: app_commands::definition_for(&state.shared, &app.id, app.current_version).and_then(|def| def.icon),
    }).collect())
}

/// 앱 목록 변화만 전달하며 목록을 쓰지 않는 식은 다시 계산하지 않는다.
pub(crate) fn apps_changed(inner: &Arc<Inner>) {
    crate::app_badges::refresh(inner);
    let state = inner.state.lock().unwrap();
    let mut windows = inner.data_runtimes.windows.lock().unwrap();
    for (id, runtime) in windows.iter_mut() {
        if runtime.apps.is_none() { continue; }
        let apps = apps_for(&state, &runtime.definition);
        if runtime.apps == apps { continue; }
        runtime.apps = apps;
        let selected: BTreeSet<_> = runtime.compiled.binding_dependencies().iter()
            .filter(|binding| binding.apps)
            .map(|binding| binding.pointer.clone()).collect();
        if selected.is_empty() { continue; }
        let next = runtime.view_selected(&selected);
        if let Some(view) = runtime.diff_view(next).filter(|_| runtime.attached > 0) {
            let _ = inner.data_runtimes.events.send((id.clone(), runtime.version, view));
        }
    }
}

pub(crate) fn state_changed(inner: &Arc<Inner>) {
    let (pending, reloads) = {
        let state = inner.state.lock().unwrap();
        let using_defaults = crate::app_storage::uses_defaults_for(
            &state,
            inner.link_file.lock().unwrap().is_some(),
        );
        let connected = matches!(
            state.link,
            kaleidoscope_contract::LinkStatus::Connected { .. }
        );
        let startup = crate::startup_readiness::snapshot_locked(inner, &state);
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
            let readiness_changed = runtime.startup.server != startup.server
                || runtime.startup.connections != startup.connections
                || runtime.startup.known != startup.known;
            runtime.startup = startup.clone();
            runtime.visible = liveness::visible(
                &state,
                id,
                inner.data_runtimes.shell_visible.load(Ordering::SeqCst),
            );
            let just_connected = !runtime.connected && connected;
            runtime.connected = connected;
            let defaults_changed = runtime.using_defaults != using_defaults;
            runtime.using_defaults = using_defaults;
            runtime.storage_reconnect_pending |= just_connected;
            let reconnect_reload =
                connected && runtime.visible && runtime.storage_reconnect_pending;
            let startup_reload = runtime.storage_startup_pending
                && runtime.visible
                && !matches!(
                    startup.server,
                    crate::startup_readiness::Readiness::Pending(_)
                );
            if runtime.attached > 0 && (defaults_changed || reconnect_reload || startup_reload) {
                reloads.push(id.clone());
                runtime.storage_startup_pending = false;
                if reconnect_reload {
                    runtime.storage_reconnect_pending = false;
                }
            }
            let window = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == *id)
                .unwrap();
            if runtime.state == window.state && !just_connected && !readiness_changed {
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
            let live = liveness::live_sources(runtime);
            let mut changed_sources = BTreeSet::new();
            for name in names {
                let connection_source = matches!(
                    &runtime.definition.sources[&name],
                    SourceDecl::Request { .. }
                ) && runtime.definition.permissions.iter().any(|decl| {
                    matches!(decl, kaleidoscope_contract::PermissionDecl::Connection { id, connection, .. }
                        if id == runtime.definition.sources[&name].permission()
                            && !runtime.startup.known.iter().any(|info| info.name == *connection
                                && info.kind == kaleidoscope_contract::registry::ConnectionKind::Oauth))
                });
                let startup_retry =
                    readiness_changed && runtime.sources[&name].startup_wait.is_some();
                if just_connected
                    && connection_source
                    && !matches!(runtime.sources[&name].status, SourceStatus::Ready { .. })
                {
                    let source = runtime.sources.get_mut(&name).unwrap();
                    if source.in_flight {
                        source.generation = inner
                            .data_runtimes
                            .next_generation
                            .fetch_add(1, Ordering::SeqCst)
                            + 1;
                        source.in_flight = false;
                    }
                    source.last_fetched = None;
                }
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
                let retry = startup_retry
                    || (just_connected
                        && connection_source
                        && !matches!(runtime.sources[&name].status, SourceStatus::Ready { .. }));
                if should_prepare_after_plan(runtime, &live, &name, changed || retry, false) {
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

pub(crate) fn store_servers_changed(inner: &Arc<Inner>) {
    let retries: Vec<_> = {
        let windows = inner.data_runtimes.windows.lock().unwrap();
        windows.iter().filter_map(|(window, runtime)| {
            let names: Vec<_> = runtime.definition.sources.iter()
                .filter(|(_, source)| matches!(source, SourceDecl::Store(_)))
                .map(|(name, _)| name.clone()).collect();
            (!names.is_empty()).then_some((window.clone(), names))
        }).collect()
    };
    for (window, names) in retries { let _ = refresh(inner, &window, &names, false, true); }
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
        state_changed(inner);
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
                    && !matches!(source.plan, SourcePlan::Idle | SourcePlan::Invalid(_) | SourcePlan::StoreInvalid(_))
                    && source
                        .waiting
                        .is_none_or(|until| until <= chrono::Utc::now())
                    && match (
                        source.last_fetched,
                        runtime.definition.sources[&name].refresh_secs(),
                    ) {
                        (None, _) => true,
                        (_, _) if source.waiting.is_some() => true,
                        (Some(at), Some(secs)) => source.paging.pages < 2 && at.elapsed() >= Duration::from_secs(secs.into()),
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
        crate::store_latest::tick(&inner);
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
        let definition = parse_app_definition(include_str!("../../../tests/fixtures/store-apps/reader.json")).unwrap();
        Runtime::new(
            2,
            definition.clone(),
            definition.state.clone(),
            true,
            false,
            Default::default(),
        )
    }

    #[test]
    fn failed_source_id_reaches_its_binding_value() {
        let mut runtime = request_runtime();
        runtime.sources.get_mut("stories").unwrap().status = SourceStatus::Failed {
            message: "원천 요청 실패".into(),
            has_value: false,
            id: Some("CONN_REQUEST_PUBLIC_HTTP_FAILED".into()),
        };
        let pointer = runtime
            .compiled
            .binding_dependencies()
            .iter()
            .find(|binding| binding.data.iter().any(|name| name == "stories"))
            .expect("stories 원천을 쓰는 바인딩")
            .pointer
            .clone();

        let value = runtime.view().values.remove(&pointer).unwrap();
        let kaleidoscope_contract::data::BindingValue::Failed { id, .. } = value else {
            panic!("원천 실패가 바인딩 실패로 보여야 한다");
        };
        assert_eq!(id.as_deref(), Some("CONN_REQUEST_PUBLIC_HTTP_FAILED"));
    }

    #[test]
    fn invalid_source_plan_has_a_registered_error_id() {
        let definition = parse_app_definition(&json!({
            "id":"invalid-plan", "name":"원천 계획 시험", "requires":{"blocks":4,"modules":{"files":1}},
            "permissions":[{"module":"files","id":"file","label":"파일","access":"read"}],
            "state":{}, "sources":{"item":{"kind":"file","permission":"file","path":"a.json"}},
            "ui":{"type":"text","value":{"expr":"$data.item"}}
        }).to_string()).unwrap();
        let mut runtime = Runtime::new(
            1,
            definition,
            BTreeMap::new(),
            true,
            false,
            Default::default(),
        );
        set_plan(
            &DataRuntimes::default(),
            &mut runtime,
            "item",
            SourcePlan::Invalid("없는 원천입니다".into()),
        );
        let SourceStatus::Failed {
            message,
            id: Some(id),
            ..
        } = &runtime.sources["item"].status
        else {
            panic!("잘못된 원천 계획은 코드와 함께 실패해야 한다");
        };
        assert_eq!(id, "DATA_SOURCE_PLAN_INVALID");
        assert!(message.contains("item"));
    }

    #[test]
    fn expression_failure_shows_everyday_message_and_keeps_cause_in_details() {
        let runtime = request_runtime();
        let binding = runtime.compiled.binding_dependencies().first().unwrap();
        let mut values = BTreeMap::from([(
            binding.pointer.clone(),
            kaleidoscope_contract::data::BindingValue::Failed {
                message: "expected value".into(),
                id: None,
                retry: Vec::new(),
                details: None,
            },
        )]);

        runtime.label_expression_failures(&mut values);

        let kaleidoscope_contract::data::BindingValue::Failed {
            id,
            message,
            details,
            ..
        } = &values[&binding.pointer]
        else {
            panic!("식 계산 실패가 유지되어야 한다");
        };
        assert_eq!(id.as_deref(), Some("DATA_BINDING_EXPR_FAILED"));
        assert_eq!(
            message,
            "화면에 표시할 값을 계산하지 못했습니다. 입력값을 확인하거나 에이전트에게 앱 정의의 식을 고쳐 달라고 요청하세요"
        );
        assert!(!message.contains(&binding.pointer));
        assert!(!message.contains("expected value"));
        let details = details
            .as_ref()
            .expect("식 계산 실패의 포인터와 원인은 details에 남는다");
        assert!(details.contains(&format!("pointer: {}", binding.pointer)));
        assert!(details.contains(&"reason: expected value".to_string()));
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
        let mut runtime = Runtime::new(
            1,
            definition,
            BTreeMap::new(),
            true,
            false,
            Default::default(),
        );
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
            id: None,
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
        assert!(!should_prepare_after_plan(
            &runtime,
            &liveness::live_sources(&runtime),
            "stories",
            true,
            true
        ));
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
