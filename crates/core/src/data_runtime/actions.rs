use super::*;
use crate::connections;
use kaleidoscope_contract::{
    data::{self, BindingValue},
    registry::{LayoutDataError, LAYOUT_DATA_ERRORS_MAX},
    LinkStatus,
};
use kaleidoscope_data::{Env, Step};

fn flush_pending_state(
    inner: &Arc<Inner>,
    window_id: &str,
    pending: &mut BTreeMap<String, Value>,
    steps: &mut usize,
) -> Result<(), CoreError> {
    if !pending.is_empty() {
        crate::Core {
            inner: Arc::clone(inner),
            owner: false,
        }
        .set_state_entries(window_id, std::mem::take(pending))?;
        if *steps > 1 {
            inner.profiler.record_batched_steps(*steps - 1);
        }
        *steps = 0;
    }
    Ok(())
}

pub(crate) fn act(
    inner: &Arc<Inner>,
    window_id: &str,
    pointer: &str,
    event: Value,
    item: Value,
) -> Result<CoreReply, CoreError> {
    let item = {
        let windows = inner.data_runtimes.windows.lock().unwrap();
        let runtime = windows
            .get(window_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let mut button_grid = None;
        data::walk_blocks(
            &runtime.definition.ui,
            "/ui",
            &mut |block_pointer, block| {
                if format!("{block_pointer}/on_press") == pointer {
                    if let kaleidoscope_contract::Block::ButtonGrid {
                        columns, buttons, ..
                    } = block
                    {
                        button_grid = Some((
                            *columns,
                            buttons.clone(),
                            format!("{block_pointer}/buttons"),
                        ));
                    }
                }
            },
        );
        if let Some((columns, binding, binding_pointer)) = button_grid {
            let value = match binding {
                data::Binding::Literal(value) => value,
                data::Binding::State(reference) => runtime
                    .state
                    .get(&reference.state)
                    .cloned()
                    .unwrap_or(Value::Null),
                data::Binding::Expr(_) => match runtime.last.values.get(&binding_pointer) {
                    Some(BindingValue::Ready { value }) => value.clone(),
                    _ => return Err(error::make(ErrorCode::InvalidRequest)),
                },
            };
            let buttons = data::validate_button_grid_items(&value, u32::from(columns))
                .map_err(|message| error::with_message(ErrorCode::InvalidRequest, &message))?;
            let key = event
                .as_str()
                .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
            let button = buttons
                .into_iter()
                .find(|button| button.key == key && !button.disabled)
                .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
            serde_json::to_value(button).map_err(|_| error::make(ErrorCode::InvalidRequest))?
        } else {
            item
        }
    };
    let len = {
        let windows = inner.data_runtimes.windows.lock().unwrap();
        windows
            .get(window_id)
            .and_then(|runtime| runtime.compiled.actions_len(pointer))
            .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?
    };
    let started = Instant::now();
    let mut pending = BTreeMap::new();
    let mut pending_steps = 0;
    let mut action_state = {
        let windows = inner.data_runtimes.windows.lock().unwrap();
        windows
            .get(window_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?
            .state
            .clone()
    };
    for index in 0..len {
        let step = (|| -> Result<Step, CoreError> {
            let windows = inner.data_runtimes.windows.lock().unwrap();
            let runtime = windows
                .get(window_id)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            if let Some(error) = runtime.action_storage_error(pointer, index) {
                return Err(error);
            }
            let (storage, storage_meta) = runtime.storage_values();
            runtime
                .compiled
                .action_step(
                    pointer,
                    index,
                    &Env {
                        state: &action_state,
                        data: &runtime.data,
                        data_meta: &runtime.data_meta_values(),
                        storage: &storage,
                        storage_meta: &storage_meta,
                        event: &event,
                        item: &item,
                    },
                )
                .map_err(|message| error::with_message(ErrorCode::InvalidRequest, &message))
        })();
        let step = match step {
            Ok(step) => step,
            Err(err) => {
                let _ = flush_pending_state(inner, window_id, &mut pending, &mut pending_steps);
                return Err(err);
            }
        };
        if !matches!(step, Step::SetState { .. }) {
            flush_pending_state(inner, window_id, &mut pending, &mut pending_steps)?;
        }
        match step {
            Step::Worker { action, args } => {
                let (app, workspace, link) = {
                    let state = inner.state.lock().unwrap();
                    let window = state
                        .shared
                        .windows
                        .iter()
                        .find(|window| window.id == window_id)
                        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
                    let desktop = state
                        .shared
                        .desktops
                        .iter()
                        .find(|desktop| desktop.id == window.desktop_id)
                        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
                    if !matches!(state.link, LinkStatus::Connected { .. }) {
                        return Err(error::make(ErrorCode::Unavailable));
                    }
                    let link = inner
                        .link_file
                        .lock()
                        .unwrap()
                        .clone()
                        .ok_or_else(|| error::make(ErrorCode::Unavailable))?;
                    (window.app_id.clone(), desktop.workspace_id.clone(), link)
                };
                inner
                    .registry
                    .invoke_worker(
                        &link.server_url,
                        &link.token,
                        &app,
                        &kaleidoscope_contract::worker::WorkerInvokeRequest {
                            action,
                            workspace_id: Some(workspace),
                            args,
                        },
                    )
                    .map_err(|err| {
                        if matches!(err, crate::registry_client::RegistryError::Unauthorized) {
                            crate::link::token_rejected(inner, link.clone());
                        }
                        crate::link::registry_error_to_core(err, "서버 워커를 호출할 수 없습니다.")
                    })?;
            }
            Step::SetState { key, value } => {
                let valid = {
                    let windows = inner.data_runtimes.windows.lock().unwrap();
                    let runtime = windows
                        .get(window_id)
                        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
                    let mut next = action_state.clone();
                    next.insert(key.clone(), value.clone());
                    runtime.definition.state.contains_key(&key)
                        && serde_json::to_vec(&next).is_ok_and(|bytes| {
                            bytes.len() <= kaleidoscope_contract::WINDOW_STATE_MAX_BYTES
                        })
                };
                if !valid {
                    let _ = flush_pending_state(inner, window_id, &mut pending, &mut pending_steps);
                    return Err(error::make(ErrorCode::InvalidRequest));
                }
                action_state.insert(key.clone(), value.clone());
                pending.insert(key, value);
                pending_steps += 1;
            }
            Step::SetStorage { entry, value } => {
                let revision = {
                    let windows = inner.data_runtimes.windows.lock().unwrap();
                    windows
                        .get(window_id)
                        .ok_or_else(|| error::make(ErrorCode::NotFound))?
                        .revision(&entry)?
                };
                let revision = crate::app_storage::write(
                    inner,
                    window_id,
                    &entry,
                    value.clone(),
                    kaleidoscope_contract::app_storage::ExpectedRevision(revision),
                )?;
                super::storage::written(inner, window_id, &entry, value, revision);
            }
            Step::Refresh { names } => refresh(inner, window_id, &names, true)?,
            Step::Call {
                permission,
                method,
                path,
                query,
                body,
            } => {
                let reply = connections::request(
                    inner,
                    window_id,
                    &permission,
                    method,
                    &path,
                    query,
                    body,
                    kaleidoscope_contract::registry::ConnectionAccept::Json,
                )
                .map_err(|err| match err {
                    RequestError::Core(err) => err,
                    RequestError::Login(_) => error::make(ErrorCode::NotGranted),
                })?;
                if !(200..300).contains(&reply.status) {
                    return Err(connections::response_error(&reply));
                }
                super::connection_changed(inner, &permission);
            }
        }
    }
    flush_pending_state(inner, window_id, &mut pending, &mut pending_steps)?;
    let windows = inner.data_runtimes.windows.lock().unwrap();
    if let Some(runtime) = windows.get(window_id) {
        inner.profiler.span(
            "data.act",
            pointer,
            &runtime.definition.id,
            &runtime.definition.name,
            started.elapsed().as_secs_f64() * 1000.0,
            0,
            0,
            "",
        );
    }
    Ok(CoreReply::DataAct {})
}

pub(crate) fn layout_errors(inner: &Inner) -> Vec<LayoutDataError> {
    let windows = inner.data_runtimes.windows.lock().unwrap();
    let mut errors = Vec::new();
    for (id, runtime) in windows.iter().filter(|(_, runtime)| runtime.attached > 0) {
        let mut count = 0;
        for (name, source) in &runtime.sources {
            if let SourceStatus::Failed { message, .. } = &source.status {
                errors.push(LayoutDataError {
                    window_id: id.clone(),
                    pointer: format!("/sources/{}", data::escape_pointer(name)),
                    message: message.clone(),
                });
                count += 1;
                if count == LAYOUT_DATA_ERRORS_MAX {
                    break;
                }
            }
        }
        for (pointer, _) in data::ui_bindings(&runtime.definition) {
            if count == LAYOUT_DATA_ERRORS_MAX {
                break;
            }
            if let Some(BindingValue::Failed { message, .. }) = runtime.last.values.get(&pointer) {
                errors.push(LayoutDataError {
                    window_id: id.clone(),
                    pointer,
                    message: message.clone(),
                });
                count += 1;
            }
        }
    }
    errors
}
