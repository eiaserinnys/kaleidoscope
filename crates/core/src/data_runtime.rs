//! 창별 원천과 식 결과. 입출력은 잠금 밖에서 수행하고 세대가 같은 결과만 반영한다.
// 기존 창별 원천 수명 경로가 이미 500줄을 넘는다. 별도 수명 리팩터링은 이 변경에 섞지 않는다.
mod actions;
mod storage;
pub(crate) use actions::{act, layout_errors};
use std::collections::BTreeMap;
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
    data::{DataView, SourceDecl, SourceFormat, SourceStatus},
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
    storage: BTreeMap<String, storage::Slot>,
    storage_meta: storage::MetaSlot,
    attached: usize,
    last: DataView,
}
struct Source {
    plan: SourcePlan,
    status: SourceStatus,
    generation: u64,
    in_flight: bool,
    last_fetched: Option<Instant>,
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
            storage,
            storage_meta,
            attached: 0,
            last: DataView::default(),
        }
    }
    fn view(&self) -> DataView {
        let statuses: BTreeMap<_, _> = self
            .sources
            .iter()
            .map(|(name, source)| (name.clone(), source.status.clone()))
            .collect();
        let (storage, meta) = self.storage_values();
        let mut values = self.compiled.evaluate_with_storage(
            &self.state,
            &self.data,
            &storage,
            &meta,
            &statuses,
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
        }
    }
    fn view_selected(&self, selected: &std::collections::BTreeSet<String>) -> DataView {
        let statuses: BTreeMap<_, _> = self
            .sources
            .iter()
            .map(|(name, source)| (name.clone(), source.status.clone()))
            .collect();
        let (storage, meta) = self.storage_values();
        let mut values = self.last.values.clone();
        values.extend(self.compiled.evaluate_selected_with_storage(
            &self.state,
            &self.data,
            &storage,
            &meta,
            &statuses,
            Some(selected),
        ));
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
        }
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
            values: next
                .values
                .iter()
                .filter(|(key, value)| self.last.values.get(*key) != Some(*value))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        };
        self.last = next;
        if delta.sources.is_empty() && delta.values.is_empty() {
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

fn set_plan(manager: &DataRuntimes, runtime: &mut Runtime, name: &str, plan: SourcePlan) -> bool {
    let source = runtime.sources.get_mut(name).unwrap();
    if source.plan == plan {
        return false;
    }
    source.generation = manager.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
    source.in_flight = false;
    source.last_fetched = None;
    if matches!(&plan, SourcePlan::Idle) {
        runtime.data.remove(name);
    }
    source.status = match &plan {
        SourcePlan::Invalid(message) => SourceStatus::Failed {
            message: message.clone(),
            has_value: runtime.data.contains_key(name),
        },
        _ => SourceStatus::Idle {},
    };
    source.plan = plan;
    true
}

fn prepare(manager: &DataRuntimes, runtime: &mut Runtime, window: &str, name: &str) -> Option<Job> {
    let source = runtime.sources.get_mut(name)?;
    if matches!(source.plan, SourcePlan::Idle | SourcePlan::Invalid(_)) {
        return None;
    }
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
                let result = data_sources::fetch(&inner, &job.window, &job.plan, job.format);
                {
                    let state = inner.state.lock().unwrap();
                    let mut windows = inner.data_runtimes.windows.lock().unwrap();
                    let Some(runtime) = windows.get_mut(&job.window) else {
                        return;
                    };
                    if !state.shared.windows.iter().any(|window| {
                        window.id == job.window
                            && window.app_version == runtime.version
                            && runtime.plan_source_at(&job.name, &window.state) == job.plan
                    }) {
                        return;
                    }
                    let Some(source) = runtime.sources.get_mut(&job.name) else {
                        return;
                    };
                    if source.generation != job.generation {
                        return;
                    }
                    source.in_flight = false;
                    match result {
                        Ok(value) => {
                            runtime.data.insert(job.name.clone(), value);
                            source.status = SourceStatus::Ready {
                                updated_at: crate::state_commands::timestamp(),
                            };
                        }
                        Err(RequestError::Login(permission)) => {
                            source.status = SourceStatus::LoginRequired { permission }
                        }
                        Err(RequestError::Core(err)) => {
                            source.status = SourceStatus::Failed {
                                message: err.message,
                                has_value: runtime.data.contains_key(&job.name),
                            }
                        }
                    }
                    if let Some(view) = runtime.diff().filter(|_| runtime.attached > 0) {
                        let _ = inner.data_runtimes.events.send((
                            job.window.clone(),
                            runtime.version,
                            view,
                        ));
                    }
                }
                crate::local_agent::data_changed(&inner, &job.window);
                inner.layout_signal.notify();
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
            )
        });
        let already_attached = runtime.attached > 0;
        runtime.state = window.state.clone();
        runtime.attached += 1;
        let names: Vec<_> = runtime.sources.keys().cloned().collect();
        let mut pending = Vec::new();
        for name in names {
            let plan = runtime.plan_source(&name);
            let changed = set_plan(&inner.data_runtimes, runtime, &name, plan);
            runtime.apply_source_storage_status(&name);
            if (changed || !runtime.data.contains_key(&name)) && !runtime.sources[&name].in_flight {
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
        let names: Vec<_> = if names.is_empty() {
            runtime.sources.keys().cloned().collect()
        } else {
            names.to_vec()
        };
        let pending = names
            .iter()
            .filter_map(|name| prepare(&inner.data_runtimes, runtime, window_id, name))
            .collect();
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
            runtime.state = window.state.clone();
            let names: Vec<_> = runtime.sources.keys().cloned().collect();
            for name in names {
                let plan = runtime.plan_source(&name);
                if set_plan(&inner.data_runtimes, runtime, &name, plan) {
                    runtime.apply_source_storage_status(&name);
                    if let Some(job) = prepare(&inner.data_runtimes, runtime, id, &name) {
                        pending.push(job);
                    }
                }
            }
            if let Some(view) = runtime.diff().filter(|_| runtime.attached > 0) {
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
        let windows = inner.data_runtimes.windows.lock().unwrap();
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
            let windows = inner.data_runtimes.windows.lock().unwrap();
            windows
                .iter()
                .filter(|(_, runtime)| runtime.attached > 0)
                .filter_map(|(window, runtime)| {
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
