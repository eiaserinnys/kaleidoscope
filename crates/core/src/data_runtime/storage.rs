//! 데이터 식이 실제로 읽는 저장 항목만 불러오고 변경 시 다시 계산한다.
use super::*;
use kaleidoscope_contract::{
    app_storage::{StorageReadReply, StorageUpdate},
    data::{self, Action, Actions, Binding, BindingValue},
};
use std::collections::BTreeSet;

#[derive(Clone)]
enum Status {
    Loading,
    Ready,
    Failed(String),
}
pub(super) struct Slot {
    value: Option<StorageReadReply>,
    status: Status,
    generation: u64,
    in_flight: bool,
}
pub(super) struct MetaSlot {
    value: Option<String>,
    status: Status,
    generation: u64,
    in_flight: bool,
    needed: bool,
}

pub(super) fn initial_slots(definition: &AppDefinition) -> (BTreeMap<String, Slot>, MetaSlot) {
    let mut names = BTreeSet::new();
    let mut meta = false;
    for (pointer, expr) in data::all_exprs(definition) {
        if pointer.starts_with("/agent/") {
            continue;
        }
        names.extend(data::storage_refs(expr));
        meta |= !data::storage_meta_refs(expr).is_empty();
    }
    for (_, actions) in data::ui_actions(definition) {
        if let Actions::Many(actions) = actions {
            for action in actions {
                if let Action::SetStorage(spec) = action {
                    names.insert(spec.set_storage.entry.clone());
                }
            }
        }
    }
    let slots = names
        .into_iter()
        .map(|name| {
            (
                name,
                Slot {
                    value: None,
                    status: Status::Loading,
                    generation: 0,
                    in_flight: false,
                },
            )
        })
        .collect();
    (
        slots,
        MetaSlot {
            value: None,
            status: Status::Loading,
            generation: 0,
            in_flight: false,
            needed: meta,
        },
    )
}

impl Runtime {
    pub(super) fn storage_values(&self) -> (BTreeMap<String, Value>, BTreeMap<String, Value>) {
        let values = self
            .storage
            .iter()
            .filter_map(|(name, slot)| {
                slot.value
                    .as_ref()
                    .map(|v| (name.clone(), v.content.clone()))
            })
            .collect();
        let meta = self
            .storage_meta
            .value
            .as_ref()
            .map(|id| ("bucket_id".into(), Value::String(id.clone())))
            .into_iter()
            .collect();
        (values, meta)
    }
    pub(super) fn storage_problem(&self, names: &[String], meta: bool) -> Option<BindingValue> {
        let statuses = names
            .iter()
            .filter_map(|name| self.storage.get(name).map(|slot| &slot.status))
            .chain(meta.then_some(&self.storage_meta.status));
        let mut loading = false;
        for status in statuses {
            match status {
                Status::Failed(message) => {
                    return Some(BindingValue::Failed {
                        message: message.clone(),
                        retry: Vec::new(),
                    })
                }
                Status::Loading => loading = true,
                Status::Ready => {}
            }
        }
        loading.then_some(BindingValue::Loading {})
    }
    fn source_storage_problem(&self, name: &str) -> Option<BindingValue> {
        let mut refs = Vec::new();
        let mut meta = false;
        for (_, binding) in data::source_bindings(&self.definition.sources[name]) {
            if let Binding::Expr(expr) = binding {
                refs.extend(data::storage_refs(&expr.expr));
                meta |= !data::storage_meta_refs(&expr.expr).is_empty();
            }
        }
        self.storage_problem(&refs, meta)
    }
    pub(super) fn plan_source(&self, name: &str) -> SourcePlan {
        self.plan_source_at(name, &self.state)
    }
    pub(super) fn plan_source_at(&self, name: &str, state: &BTreeMap<String, Value>) -> SourcePlan {
        if self.source_storage_problem(name).is_some() || self.source_data_problem(name).is_some() {
            return SourcePlan::Idle;
        }
        let (storage, meta) = self.storage_values();
        self.compiled
            .plan_source_with_data_and_storage(name, state, &self.data, &storage, &meta)
    }
    pub(super) fn source_data_problem(&self, name: &str) -> Option<SourceStatus> {
        let mut result = None;
        let has_value = self.data.contains_key(name);
        for dep in self
            .compiled
            .source_dependencies(name)
            .iter()
            .filter(|dep| !self.data.contains_key(*dep))
        {
            let status = self.sources.get(dep).map(|s| &s.status);
            let candidate = match status {
                Some(SourceStatus::LoginRequired { permission }) => (
                    3,
                    SourceStatus::LoginRequired {
                        permission: permission.clone(),
                    },
                ),
                Some(SourceStatus::Failed { message, .. }) => (
                    2,
                    SourceStatus::Failed {
                        message: message.clone(),
                        has_value,
                    },
                ),
                Some(SourceStatus::Loading { .. }) => (1, SourceStatus::Loading { has_value }),
                _ => (0, SourceStatus::Idle {}),
            };
            if result.as_ref().is_none_or(|(rank, _)| *rank < candidate.0) {
                result = Some(candidate);
            }
        }
        result.map(|(_, status)| status)
    }
    pub(super) fn apply_source_storage_status(&mut self, name: &str) {
        let problem = self.source_storage_problem(name);
        let data_problem = self.source_data_problem(name);
        let source = self.sources.get_mut(name).unwrap();
        match problem {
            Some(BindingValue::Loading {}) => {
                source.status = SourceStatus::Loading { has_value: false }
            }
            Some(BindingValue::Failed { message, .. }) => {
                source.status = SourceStatus::Failed {
                    message,
                    has_value: false,
                }
            }
            None if data_problem.is_some() => source.status = data_problem.unwrap(),
            None if matches!(source.plan, SourcePlan::Idle) => {
                source.status = SourceStatus::Idle {}
            }
            _ => {}
        }
    }
    pub(super) fn action_storage_error(&self, pointer: &str, index: usize) -> Option<CoreError> {
        let prefix = format!("{pointer}/{index}/");
        let mut names = Vec::new();
        let mut meta = false;
        for (at, expr) in data::all_exprs(&self.definition) {
            if at.starts_with(&prefix) {
                names.extend(data::storage_refs(expr));
                meta |= !data::storage_meta_refs(expr).is_empty();
            }
        }
        match self.storage_problem(&names, meta) {
            Some(BindingValue::Failed { message, .. }) => {
                Some(error::with_message(ErrorCode::Server, &message))
            }
            Some(_) => Some(error::make(ErrorCode::Unavailable)),
            None => None,
        }
    }
    pub(super) fn revision(&self, entry: &str) -> Result<Option<String>, CoreError> {
        let slot = self
            .storage
            .get(entry)
            .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
        match (&slot.status, &slot.value) {
            (Status::Ready, Some(value)) => Ok(value.revision.clone()),
            (Status::Failed(message), _) => Err(error::with_message(ErrorCode::Server, message)),
            _ => Err(error::make(ErrorCode::Unavailable)),
        }
    }
}

fn replan(
    inner: &Arc<Inner>,
    id: &str,
    runtime: &mut Runtime,
    changed_entry: Option<&str>,
) -> Vec<Job> {
    let mut pending = Vec::new();
    let mut changed_sources = BTreeSet::new();
    for name in runtime.compiled.source_order().to_vec() {
        let previous = runtime.sources[&name].status.clone();
        let plan = runtime.plan_source(&name);
        let changed = set_plan(&inner.data_runtimes, runtime, &name, plan);
        runtime.apply_source_storage_status(&name);
        if changed {
            if let Some(job) = prepare(&inner.data_runtimes, runtime, id, &name) {
                pending.push(job);
            }
        }
        if changed || previous != runtime.sources[&name].status {
            changed_sources.insert(name);
        }
    }
    let selected = runtime
        .compiled
        .binding_dependencies()
        .iter()
        .filter(|binding| {
            binding
                .data
                .iter()
                .any(|name| changed_sources.contains(name))
                || binding
                    .data_meta
                    .iter()
                    .any(|name| changed_sources.contains(name))
                || match changed_entry {
                    Some(entry) => binding.storage.iter().any(|name| name == entry),
                    None => !binding.storage.is_empty() || !binding.storage_meta.is_empty(),
                }
        })
        .map(|binding| binding.pointer.clone())
        .collect();
    let next = runtime.view_selected(&selected);
    if let Some(view) = runtime.diff_view(next).filter(|_| runtime.attached > 0) {
        let _ = inner
            .data_runtimes
            .events
            .send((id.into(), runtime.version, view));
    }
    pending
}

/// None은 재연결 snapshot이나 최초 연결이며 전부 다시 읽는다.
pub(super) fn load(inner: &Arc<Inner>, window: &str, selected: Option<&str>) {
    let (reads, metadata) = {
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        let Some(runtime) = windows.get_mut(window) else {
            return;
        };
        if runtime.attached == 0 {
            return;
        }
        let mut reads = Vec::new();
        for (name, slot) in &mut runtime.storage {
            if selected.is_some_and(|selected| selected != name) {
                continue;
            }
            slot.generation = inner
                .data_runtimes
                .next_generation
                .fetch_add(1, Ordering::SeqCst)
                + 1;
            slot.in_flight = true;
            slot.status = Status::Loading;
            slot.value = None;
            reads.push((name.clone(), slot.generation));
        }
        let meta = &mut runtime.storage_meta;
        let metadata = if selected.is_none() && meta.needed {
            meta.generation = inner
                .data_runtimes
                .next_generation
                .fetch_add(1, Ordering::SeqCst)
                + 1;
            meta.in_flight = true;
            meta.status = Status::Loading;
            meta.value = None;
            Some(meta.generation)
        } else {
            None
        };
        let pending = replan(inner, window, runtime, selected);
        jobs(inner, pending);
        (reads, metadata)
    };
    for (entry, generation) in reads {
        let inner = Arc::clone(inner);
        let window = window.to_string();
        thread::spawn(move || {
            let result = crate::app_storage::read(&inner, &window, &entry);
            let pending = {
                let mut windows = inner.data_runtimes.windows.lock().unwrap();
                let Some(runtime) = windows.get_mut(&window) else {
                    return;
                };
                let Some(slot) = runtime.storage.get_mut(&entry) else {
                    return;
                };
                if slot.generation != generation {
                    return;
                }
                slot.in_flight = false;
                match result {
                    Ok(value) => {
                        slot.value = Some(value);
                        slot.status = Status::Ready;
                    }
                    Err(err) => {
                        slot.value = None;
                        slot.status = Status::Failed(err.message);
                    }
                }
                replan(&inner, &window, runtime, Some(&entry))
            };
            jobs(&inner, pending);
            crate::local_agent::data_changed(&inner, &window);
            inner.layout_signal.notify();
        });
    }
    if let Some(generation) = metadata {
        let inner = Arc::clone(inner);
        let window = window.to_string();
        thread::spawn(move || {
            let result = if crate::app_storage::uses_defaults(&inner) {
                Ok(None)
            } else {
                crate::app_storage::list(&inner, &window).map(|value| Some(value.bucket_id))
            };
            let pending = {
                let mut windows = inner.data_runtimes.windows.lock().unwrap();
                let Some(runtime) = windows.get_mut(&window) else {
                    return;
                };
                let meta = &mut runtime.storage_meta;
                if meta.generation != generation {
                    return;
                }
                meta.in_flight = false;
                match result {
                    Ok(value) => {
                        meta.value = value;
                        meta.status = Status::Ready;
                    }
                    Err(err) => {
                        meta.value = None;
                        meta.status = Status::Failed(err.message);
                    }
                }
                replan(&inner, &window, runtime, None)
            };
            jobs(&inner, pending);
            crate::local_agent::data_changed(&inner, &window);
            inner.layout_signal.notify();
        });
    }
}

pub(super) fn written(
    inner: &Arc<Inner>,
    window: &str,
    entry: &str,
    content: Value,
    revision: String,
) {
    let pending = {
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        let Some(runtime) = windows.get_mut(window) else {
            return;
        };
        let kind = match runtime
            .definition
            .storage
            .as_ref()
            .and_then(|storage| storage.entries.iter().find(|item| item.id == entry))
        {
            Some(item) => item.kind,
            None => return,
        };
        let Some(slot) = runtime.storage.get_mut(entry) else {
            return;
        };
        let value = StorageReadReply {
            kind,
            content,
            revision: Some(revision),
            exists: true,
        };
        slot.generation = inner
            .data_runtimes
            .next_generation
            .fetch_add(1, Ordering::SeqCst)
            + 1;
        slot.in_flight = false;
        slot.value = Some(value);
        slot.status = Status::Ready;
        replan(inner, window, runtime, Some(entry))
    };
    jobs(inner, pending);
    crate::local_agent::data_changed(inner, window);
    inner.layout_signal.notify();
}

pub(crate) fn changed(inner: &Arc<Inner>, window: &str, update: &StorageUpdate) {
    match update {
        StorageUpdate::Snapshot { .. } => load(inner, window, None),
        StorageUpdate::Changed { changed } => {
            let unchanged = {
                let windows = inner.data_runtimes.windows.lock().unwrap();
                windows
                    .get(window)
                    .and_then(|runtime| runtime.storage.get(&changed.item.entry_id))
                    .and_then(|slot| slot.value.as_ref())
                    .is_some_and(|value| {
                        value.revision == changed.item.revision
                            && value.exists == changed.item.exists
                    })
            };
            if !unchanged {
                load(inner, window, Some(&changed.item.entry_id));
            }
        }
    }
}
