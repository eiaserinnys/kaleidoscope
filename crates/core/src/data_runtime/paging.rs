//! 쪽 응답을 첫 응답의 항목 배열에 이어 붙인다.
use super::*;
use kaleidoscope_contract::data::{BindingMore, MoreState, PageDecl};

#[derive(Clone, Default)]
pub(super) struct Paging {
    pub cursor: Option<String>,
    pub pages: usize,
    pub state: PagingState,
    pub generation: u64,
}

#[derive(Clone, Default)]
pub(super) enum PagingState {
    #[default]
    Idle,
    Loading,
    Failed(CoreError, bool),
}

impl Paging {
    pub fn more(&self, name: &str) -> Option<BindingMore> {
        let (state, message, id, retry) = match &self.state {
            PagingState::Idle if self.cursor.is_some() => (MoreState::Ready, None, None, false),
            PagingState::Idle => return None,
            PagingState::Loading => (MoreState::Loading, None, None, false),
            PagingState::Failed(error, retry) => (MoreState::Failed, Some(error.message.clone()), error.id.clone(), *retry),
        };
        Some(BindingMore { source: name.into(), state, message, id, retry })
    }

    pub fn fail(&mut self, error: CoreError, retry: bool) {
        if !retry { self.cursor = None; }
        self.state = PagingState::Failed(error, retry);
    }
}

fn items<'a>(value: &'a Value, path: &str) -> Option<&'a Vec<Value>> {
    let value = if path.is_empty() { value } else { path.split('.').try_fold(value, |value, key| value.get(key))? };
    value.as_array()
}

fn items_mut<'a>(value: &'a mut Value, path: &str) -> Option<&'a mut Vec<Value>> {
    let value = if path.is_empty() { value } else { path.split('.').try_fold(value, |value, key| value.get_mut(key))? };
    value.as_array_mut()
}

fn next(name: &str, page: &PageDecl, response: &Value, loaded: usize, pages: usize) -> Result<Option<String>, CoreError> {
    let value = kaleidoscope_data::evaluate_page_next(&page.next, response, loaded, pages)
        .map_err(|reason| errors::DATA_SOURCE_PAGE_NEXT_FAILED(name, reason))?;
    match value {
        Value::Null | Value::Bool(false) => Ok(None),
        Value::String(value) if value.is_empty() => Ok(None),
        Value::String(value) => Ok(Some(value)),
        Value::Number(value) => {
            let number = value.as_f64().unwrap();
            Ok(Some(if number.fract() == 0.0 { format!("{number:.0}") } else { number.to_string() }))
        }
        Value::Bool(true) => Err(errors::DATA_SOURCE_PAGE_NEXT_INVALID(name, "참/거짓")),
        Value::Array(_) => Err(errors::DATA_SOURCE_PAGE_NEXT_INVALID(name, "배열")),
        Value::Object(_) => Err(errors::DATA_SOURCE_PAGE_NEXT_INVALID(name, "객체")),
    }
}

pub(super) fn first(name: &str, page: &PageDecl, response: &Value) -> Paging {
    let mut paging = Paging { pages: 1, ..Default::default() };
    match items(response, &page.items) {
        Some(list) => match next(name, page, response, list.len(), 1) {
            Ok(cursor) => paging.cursor = cursor,
            Err(error) => paging.fail(error, false),
        },
        None => paging.fail(errors::DATA_SOURCE_PAGE_ITEMS_NOT_ARRAY(name, &page.items), false),
    }
    paging
}

pub(super) fn append(name: &str, page: &PageDecl, paging: &mut Paging, combined: &mut Value, response: &Value) {
    let Some(incoming) = items(response, &page.items) else {
        paging.fail(errors::DATA_SOURCE_PAGE_ITEMS_NOT_ARRAY(name, &page.items), false);
        return;
    };
    let Some(target) = items_mut(combined, &page.items) else {
        paging.fail(errors::DATA_SOURCE_PAGE_ITEMS_NOT_ARRAY(name, &page.items), false);
        return;
    };
    target.extend(incoming.iter().cloned());
    paging.pages += 1;
    match next(name, page, response, target.len(), paging.pages) {
        Ok(cursor) => { paging.cursor = cursor; paging.state = PagingState::Idle; }
        Err(error) => paging.fail(error, false),
    }
}

pub(super) fn plan_with_cursor(plan: &SourcePlan, page: &PageDecl, cursor: &str) -> SourcePlan {
    let mut plan = plan.clone();
    if let SourcePlan::Request { query, .. } = &mut plan { query.insert(page.param.clone(), cursor.into()); }
    plan
}

pub(super) fn rebuild(inner: &Arc<Inner>, job: &Job, page: &PageDecl, first_value: &Value) -> (Value, Paging) {
    let mut combined = first_value.clone();
    let mut paging = first(&job.name, page, first_value);
    while paging.pages < job.pages {
        let Some(cursor) = paging.cursor.clone() else { break; };
        let plan = plan_with_cursor(&job.plan, page, &cursor);
        let response = match data_sources::fetch_named(inner, &job.window, &job.name, &plan, job.format) {
            Ok(response) => response,
            Err(RequestError::RateLimited { retry_after }) => {
                if let Some(key) = &job.gate { gates::record_limit(&inner.data_runtimes, key, retry_after); }
                break;
            }
            Err(_) => break,
        };
        append(&job.name, page, &mut paging, &mut combined, &response);
    }
    (combined, paging)
}

fn publish(inner: &Inner, runtime: &mut Runtime, window: &str, name: &str) {
    let changed = BTreeSet::from([name.to_owned()]);
    let selected = runtime.selected_for(&BTreeSet::new(), &changed);
    let next = runtime.view_selected(&selected);
    if let Some(delta) = runtime.diff_view(next).filter(|_| runtime.attached > 0) {
        let _ = inner.data_runtimes.events.send((window.into(), runtime.version, delta));
    }
}

pub(crate) fn more(inner: &Arc<Inner>, window: &str, name: &str) -> Result<bool, CoreError> {
    let job = {
        let state = inner.state.lock().unwrap();
        let target = state.shared.windows.iter().find(|item| item.id == window)
            .ok_or_else(errors::DATA_RUNTIME_MORE_WINDOW_NOT_FOUND)?;
        let definition = app_commands::definition_for(&state.shared, &target.app_id, target.app_version);
        let page = match definition.and_then(|definition| definition.sources.get(name).cloned()) {
            Some(SourceDecl::Request { page: Some(page), .. }) => page,
            _ => return Err(errors::DATA_RUNTIME_MORE_SOURCE_NOT_PAGED(name)),
        };
        let mut windows = inner.data_runtimes.windows.lock().unwrap();
        let Some(runtime) = windows.get_mut(window) else { return Ok(false); };
        if runtime.version != target.app_version { return Ok(false); }
        let live = liveness::live_sources(runtime);
        let source = &runtime.sources[name];
        if !matches!(source.status, SourceStatus::Ready { .. }) || source.in_flight
            || matches!(source.paging.state, PagingState::Loading)
            || source.paging.cursor.is_none() || !liveness::source_live(runtime, &live, name) {
            return Ok(false);
        }
        let gate = gate_key(runtime, name);
        let until = gate.as_ref().and_then(|key| gates::blocked(&inner.data_runtimes, key));
        if let Some(until) = until {
            let time = until.with_timezone(&chrono::Local).format("%H:%M").to_string();
            runtime.sources.get_mut(name).unwrap().paging.fail(errors::DATA_SOURCE_MORE_RATE_LIMITED(name, time), true);
            publish(inner, runtime, window, name);
            inner.layout_signal.notify();
            return Ok(false);
        }
        let format = source_format(&runtime.definition.sources[name]);
        let source = runtime.sources.get_mut(name).unwrap();
        let plan = source.plan.clone();
        let request = plan_with_cursor(&plan, &page, source.paging.cursor.as_deref().unwrap());
        source.paging.generation += 1;
        source.paging.state = PagingState::Loading;
        let generations = (source.generation, source.paging.generation);
        publish(inner, runtime, window, name);
        (page, plan, request, format, generations, gate)
    };
    inner.layout_signal.notify();
    let inner = Arc::clone(inner);
    let window = window.to_owned();
    let name = name.to_owned();
    thread::spawn(move || {
        let (page, plan, request, format, generations, gate) = job;
        let started = Instant::now();
        let result = data_sources::fetch_named(&inner, &window, &name, &request, format);
        let until = match (&gate, &result) {
            (Some(key), Err(RequestError::RateLimited { retry_after })) => Some(gates::record_limit(&inner.data_runtimes, key, *retry_after)),
            (Some(key), Ok(_)) => {
                gates::release_expired(&inner.data_runtimes, key);
                None
            }
            _ => None,
        };
        let mut follow_up = Vec::new();
        {
            let state = inner.state.lock().unwrap();
            let mut windows = inner.data_runtimes.windows.lock().unwrap();
            let Some(runtime) = windows.get_mut(&window) else { return; };
            if !state.shared.windows.iter().any(|item| item.id == window && item.app_version == runtime.version && runtime.plan_source_at(&name, &item.state) == plan) { return; }
            let Some(source) = runtime.sources.get_mut(&name) else { return; };
            if (source.generation, source.paging.generation) != generations { return; }
            inner.profiler.span("data.source", &name, &runtime.definition.id, &runtime.definition.name, started.elapsed().as_secs_f64() * 1000.0, 0, 0, "");
            match result {
                Ok(response) => {
                    if let Some(combined) = runtime.data.get_mut(&name) {
                        append(&name, &page, &mut source.paging, combined, &response);
                    }
                }
                Err(RequestError::Login(permission)) => source.paging.fail(errors::DATA_SOURCE_MORE_LOGIN_REQUIRED(&name, permission), true),
                Err(RequestError::RateLimited { .. }) => {
                    let time = until.unwrap_or_else(chrono::Utc::now).with_timezone(&chrono::Local).format("%H:%M").to_string();
                    source.paging.fail(errors::DATA_SOURCE_MORE_RATE_LIMITED(&name, time), true);
                }
                Err(RequestError::Core(error)) => source.paging.fail(error, true),
            }
            let mut changed = BTreeSet::from([name.clone()]);
            let live = liveness::live_sources(runtime);
            for other in runtime.compiled.source_order().to_vec() {
                if other == name { continue; }
                let new_plan = runtime.plan_source(&other);
                let was_changed = set_plan(&inner.data_runtimes, runtime, &other, new_plan);
                let old_status = runtime.sources[&other].status.clone();
                runtime.apply_source_storage_status(&other);
                if was_changed || old_status != runtime.sources[&other].status { changed.insert(other.clone()); }
                if should_prepare_after_plan(runtime, &live, &other, was_changed, false) {
                    if let Some(job) = prepare(&inner.data_runtimes, runtime, &window, &other, false) { follow_up.push(job); }
                }
            }
            let selected = runtime.selected_for(&BTreeSet::new(), &changed);
            let next = runtime.view_selected(&selected);
            if let Some(delta) = runtime.diff_view(next).filter(|_| runtime.attached > 0) {
                let _ = inner.data_runtimes.events.send((window.clone(), runtime.version, delta));
            }
        }
        let handles = jobs(&inner, follow_up);
        inner.layout_signal.notify();
        for handle in handles { let _ = handle.join(); }
    });
    Ok(true)
}
