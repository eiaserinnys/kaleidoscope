//! 창별 원천과 식 결과. 입출력은 잠금 밖에서 수행하고 세대가 같은 결과만 반영한다.
// 기존 창별 원천 수명 경로가 이미 500줄을 넘는다. 별도 수명 리팩터링은 이 변경에 섞지 않는다.
mod actions;
mod storage;
pub(crate) use actions::{act, layout_errors};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
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
    next_generation: AtomicU64,
    events: mpsc::Sender<(String, u32, DataView)>,
    receiver: Mutex<Option<mpsc::Receiver<(String, u32, DataView)>>>,
}
impl Default for DataRuntimes {
    fn default() -> Self {
        let (events, receiver) = mpsc::channel();
        Self {
            windows: Mutex::new(BTreeMap::new()),
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
    request_cache: Vec<(RequestCacheKey, CachedRequest)>,
    storage: BTreeMap<String, storage::Slot>,
    storage_meta: storage::MetaSlot,
    attached: usize,
    last: DataView,
    profiler: crate::profiler::Profiler,
}
#[derive(Clone, PartialEq, Eq)]
struct RequestCacheKey {
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
}
struct Job {
    window: String,
    name: String,
    plan: SourcePlan,
    format: SourceFormat,
    generation: u64,
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
            request_cache: Vec::new(),
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
                let (state, message) = match &source.status {
                    SourceStatus::Idle {} => (SourceState::Idle, None),
                    SourceStatus::Loading { .. } => (SourceState::Loading, None),
                    SourceStatus::Ready { .. } => (SourceState::Ready, None),
                    SourceStatus::Failed { message, .. } => {
                        (SourceState::Failed, Some(message.clone()))
                    }
                    SourceStatus::LoginRequired { .. } => (SourceState::LoginRequired, None),
                };
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

fn request_cache_key(plan: &SourcePlan, format: SourceFormat) -> Option<RequestCacheKey> {
    let SourcePlan::Request {
        permission,
        path,
        query,
    } = plan
    else {
        return None;
    };
    Some(RequestCacheKey {
        permission: permission.clone(),
        path: path.clone(),
        query: query.clone(),
        format,
    })
}

fn request_cache_get(runtime: &Runtime, key: &RequestCacheKey) -> Option<CachedRequest> {
    runtime
        .request_cache
        .iter()
        .find(|(cached_key, _)| cached_key == key)
        .map(|(_, cached)| cached.clone())
}

fn request_cache_store(runtime: &mut Runtime, key: RequestCacheKey, cached: CachedRequest) {
    if let Some((_, existing)) = runtime
        .request_cache
        .iter_mut()
        .find(|(cached_key, _)| cached_key == &key)
    {
        *existing = cached;
        return;
    }
    runtime.request_cache.push((key, cached));
    if runtime.request_cache.len() > 128 {
        if let Some(oldest) = runtime
            .request_cache
            .iter()
            .enumerate()
            .min_by_key(|(_, (_, cached))| cached.fetched_instant)
            .map(|(index, _)| index)
        {
            runtime.request_cache.remove(oldest);
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
    let cache_hit = request_cache_key(&plan, format)
        .and_then(|key| request_cache_get(runtime, &key))
        .filter(|cached| Instant::now().saturating_duration_since(cached.fetched_instant) < ttl);
    let source = runtime.sources.get_mut(name).unwrap();
    source.generation = manager.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
    source.in_flight = false;
    source.last_fetched = None;
    source.retrying_after_failure = false;
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

fn prepare(manager: &DataRuntimes, runtime: &mut Runtime, window: &str, name: &str) -> Option<Job> {
    let source = runtime.sources.get_mut(name)?;
    if matches!(source.plan, SourcePlan::Idle | SourcePlan::Invalid(_)) {
        return None;
    }
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
    })
}

fn jobs(inner: &Arc<Inner>, pending: Vec<Job>) -> Vec<JoinHandle<()>> {
    pending
        .into_iter()
        .map(|job| {
            let inner = Arc::clone(inner);
            thread::spawn(move || {
                let started = Instant::now();
                let result = data_sources::fetch(&inner, &job.window, &job.plan, job.format);
                let mut follow_up = Vec::new();
                {
                    let state = inner.state.lock().unwrap();
                    let mut windows = inner.data_runtimes.windows.lock().unwrap();
                    let Some(runtime) = windows.get_mut(&job.window) else {
                        return;
                    };
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
                    if !state.shared.windows.iter().any(|window| {
                        window.id == job.window
                            && window.app_version == runtime.version
                            && runtime.plan_source_at(&job.name, &window.state) == job.plan
                    }) {
                        return;
                    }
                    let cache_key = request_cache_key(&job.plan, job.format);
                    let fallback_cache = cache_key
                        .as_ref()
                        .and_then(|key| request_cache_get(runtime, key));
                    let Some(source) = runtime.sources.get_mut(&job.name) else {
                        return;
                    };
                    if source.generation != job.generation {
                        return;
                    }
                    source.in_flight = false;
                    match result {
                        Ok(value) => {
                            let fetched_at = chrono::Utc::now();
                            let fetched_instant = Instant::now();
                            let updated_at = crate::state_commands::timestamp();
                            runtime.data.insert(job.name.clone(), value.clone());
                            source.last_success_at = Some(fetched_at);
                            source.last_success_instant = Some(fetched_instant);
                            source.retrying_after_failure = false;
                            source.status = SourceStatus::Ready {
                                updated_at: updated_at.clone(),
                            };
                            if let Some(key) = cache_key.clone() {
                                request_cache_store(
                                    runtime,
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
                                prepare(&inner.data_runtimes, runtime, &job.window, &name)
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
                let handles = jobs(&inner, follow_up);
                crate::local_agent::data_changed(&inner, &job.window);
                inner.layout_signal.notify();
                for handle in handles {
                    let _ = handle.join();
                }
            })
        })
        .collect()
}

pub(crate) fn attach(inner: &Arc<Inner>, window_id: &str) -> Result<CoreReply, CoreError> {
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
        runtime.state = window.state.clone();
        runtime.attached += 1;
        let names = runtime.compiled.source_order().to_vec();
        let mut pending = Vec::new();
        for name in names {
            let plan = runtime.plan_source(&name);
            let changed = set_plan(&inner.data_runtimes, runtime, &name, plan);
            runtime.apply_source_storage_status(&name);
            if should_prepare_after_plan(runtime, &name, changed, true) {
                if let Some(job) = prepare(&inner.data_runtimes, runtime, window_id, &name) {
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
            .filter_map(|name| prepare(&inner.data_runtimes, runtime, window_id, name))
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
                    if let Some(job) = prepare(&inner.data_runtimes, runtime, id, &name) {
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
        let _ = refresh(inner, window, &names, false);
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
            runtime
                .request_cache
                .retain(|(key, _)| !permissions.contains(&key.permission));
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
        let _ = refresh(inner, &window, &names, false);
    }
}

pub(crate) fn connection_changed(inner: &Inner, permission: &str) {
    for runtime in inner.data_runtimes.windows.lock().unwrap().values_mut() {
        runtime
            .request_cache
            .retain(|(key, _)| key.permission != permission);
    }
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
        let _ = refresh(inner, &window, &names, false);
    }
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
        let due: Vec<_> = {
            let mut windows = inner.data_runtimes.windows.lock().unwrap();
            windows
                .iter_mut()
                .filter(|(_, runtime)| runtime.attached > 0)
                .filter_map(|(window, runtime)| {
                    if runtime.source_meta() != runtime.last.source_meta {
                        if let Some(delta) = runtime.diff() {
                            let _ = inner.data_runtimes.events.send((
                                window.clone(),
                                runtime.version,
                                delta,
                            ));
                        }
                    }
                    let names: Vec<_> = runtime
                        .sources
                        .iter()
                        .filter_map(|(name, source)| {
                            let secs = runtime.definition.sources[name].refresh_secs()?;
                            (!source.in_flight
                                && source.last_fetched.is_some_and(|t| {
                                    t.elapsed() >= Duration::from_secs(secs.into())
                                }))
                            .then_some(name.clone())
                        })
                        .collect();
                    (!names.is_empty()).then_some((window.clone(), names))
                })
                .collect()
        };
        for (window, names) in due {
            let _ = refresh(&inner, &window, &names, false);
        }
    });
}

#[cfg(test)]
mod freshness_tests {
    use super::*;
    use kaleidoscope_contract::validate::parse_app_definition;
    use serde_json::json;

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

    fn seed_request_cache(runtime: &mut Runtime, plan: &SourcePlan, value: Value) {
        let key = request_cache_key(plan, SourceFormat::Json).unwrap();
        let fetched_at = chrono::Utc::now();
        let fetched_instant = Instant::now();
        request_cache_store(
            runtime,
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
        prepare(&manager, &mut runtime, "window", "item");
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
            &mut runtime,
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
        seed_request_cache(&mut runtime, &request, json!({"cached":true}));
        runtime
            .data
            .insert("stories".into(), json!({"cached":true}));
        runtime.sources.get_mut("stories").unwrap().status = SourceStatus::Ready {
            updated_at: crate::state_commands::timestamp(),
        };

        let job = prepare(&manager, &mut runtime, "window", "stories").unwrap();
        assert_eq!(job.plan, request);
        assert!(matches!(
            runtime.sources["stories"].status,
            SourceStatus::Loading { has_value: true }
        ));
    }
}
