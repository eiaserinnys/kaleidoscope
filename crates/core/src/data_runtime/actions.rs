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
    modifiers: Option<kaleidoscope_contract::client::EventModifiers>,
) -> Result<CoreReply, CoreError> {
    let item = {
        let windows = inner.data_runtimes.windows.lock().unwrap();
        let runtime = windows.get(window_id).ok_or_else(|| {
            errors::DATA_ACT_ACTION_WINDOW_NOT_FOUND()
                .and_details(vec![format!("window: {}", window_id)])
        })?;
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
                    Some(BindingValue::Ready { value, .. }) => value.clone(),
                    _ => {
                        return Err(errors::DATA_ACT_BUTTON_GRID_EXPR_NOT_READY()
                            .and_details(vec![format!("pointer: {}", &binding_pointer)]))
                    }
                },
                data::Binding::Client(_)
                | data::Binding::Item(_)
                | data::Binding::ParentItem(_)
                | data::Binding::Message(_) => {
                    return Err(errors::DATA_ACT_BUTTON_GRID_BINDING_UNSUPPORTED(
                        &binding_pointer,
                    ))
                }
            };
            let buttons =
                data::validate_button_grid_items(&value, u32::from(columns)).map_err(|reason| {
                    errors::DATA_ACT_BUTTON_GRID_INVALID(&binding_pointer, &reason)
                })?;
            let key = event
                .as_str()
                .ok_or_else(|| errors::DATA_ACT_BUTTON_GRID_EVENT_INVALID(&binding_pointer))?;
            let button = buttons
                .into_iter()
                .find(|button| button.key == key)
                .ok_or_else(|| {
                    errors::DATA_ACT_BUTTON_GRID_KEY_NOT_FOUND(key)
                        .and_details(vec![format!("pointer: {}", &binding_pointer)])
                })?;
            if button.disabled {
                return Err(errors::DATA_ACT_BUTTON_GRID_KEY_DISABLED(key)
                    .and_details(vec![format!("pointer: {}", &binding_pointer)]));
            }
            serde_json::to_value(button)
                .map_err(|_| errors::DATA_ACT_BUTTON_GRID_SERIALIZE_FAILED(&binding_pointer))?
        } else {
            item
        }
    };
    let len = {
        let windows = inner.data_runtimes.windows.lock().unwrap();
        let runtime = windows.get(window_id).ok_or_else(|| {
            errors::DATA_ACT_ACTION_WINDOW_MISSING()
                .and_details(vec![format!("window: {}", window_id)])
        })?;
        runtime
            .compiled
            .actions_len(pointer)
            .ok_or_else(|| errors::DATA_ACT_ACTION_NOT_FOUND(pointer))?
    };
    let started = Instant::now();
    let mut pending = BTreeMap::new();
    let mut pending_steps = 0;
    for index in 0..len {
        let step = (|| -> Result<Step, CoreError> {
            let windows = inner.data_runtimes.windows.lock().unwrap();
            let runtime = windows.get(window_id).ok_or_else(|| {
                errors::DATA_ACT_WINDOW_NOT_FOUND()
                    .and_details(vec![format!("window: {}", window_id)])
            })?;
            if let Some(error) = runtime.action_storage_error(pointer, index) {
                return Err(error);
            }
            let mut action_state = runtime.state.clone();
            action_state.extend(pending.clone());
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
                        modifiers: modifiers.as_ref(),
                    },
                )
                .map_err(|reason| errors::DATA_ACT_STEP_INVALID(pointer, &reason))
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
                let worker_action = action.clone();
                let (app, workspace, link) = {
                    let state = inner.state.lock().unwrap();
                    let window = state
                        .shared
                        .windows
                        .iter()
                        .find(|window| window.id == window_id)
                        .ok_or_else(|| {
                            errors::DATA_ACT_WORKER_WINDOW_NOT_FOUND(&worker_action)
                                .and_details(vec![format!("window: {}", window_id)])
                        })?;
                    let desktop = state
                        .shared
                        .desktops
                        .iter()
                        .find(|desktop| desktop.id == window.desktop_id)
                        .ok_or_else(|| {
                            errors::DATA_ACT_WORKER_DESKTOP_NOT_FOUND(&worker_action)
                                .and_details(vec![format!("window: {}", window_id)])
                        })?;
                    if !matches!(state.link, LinkStatus::Connected { .. }) {
                        return Err(errors::DATA_ACT_WORKER_SERVER_NOT_CONNECTED(&worker_action));
                    }
                    let link = inner
                        .link_file
                        .lock()
                        .unwrap()
                        .clone()
                        .ok_or_else(|| errors::DATA_ACT_WORKER_LINK_MISSING(&worker_action))?;
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
                        if matches!(&err, crate::registry_client::RegistryError::Unauthorized) {
                            crate::link::token_rejected(inner, link.clone());
                        }
                        map_worker_error(err, &worker_action)
                    })?;
            }
            Step::SetState { key, value } => {
                let (declared, valid) = {
                    let windows = inner.data_runtimes.windows.lock().unwrap();
                    let runtime = windows.get(window_id).ok_or_else(|| {
                        errors::DATA_ACT_STATE_WINDOW_NOT_FOUND()
                            .and_details(vec![format!("window: {}", window_id)])
                    })?;
                    let mut next = runtime.state.clone();
                    next.extend(pending.clone());
                    next.insert(key.clone(), value.clone());
                    let declared = runtime.definition.state.contains_key(&key);
                    let valid = serde_json::to_vec(&next).is_ok_and(|bytes| {
                        bytes.len() <= kaleidoscope_contract::WINDOW_STATE_MAX_BYTES
                    });
                    (declared, valid)
                };
                if !declared {
                    let _ = flush_pending_state(inner, window_id, &mut pending, &mut pending_steps);
                    return Err(errors::DATA_ACT_STATE_KEY_NOT_DECLARED(&key));
                }
                if !valid {
                    let _ = flush_pending_state(inner, window_id, &mut pending, &mut pending_steps);
                    return Err(errors::DATA_ACT_STATE_TOO_LARGE(
                        kaleidoscope_contract::size::format_byte_limit(
                            kaleidoscope_contract::WINDOW_STATE_MAX_BYTES as u64,
                        ),
                    ));
                }
                pending.insert(key, value);
                pending_steps += 1;
            }
            Step::SetStorage { entry, doc, value } => {
                if let Some(doc) = doc {
                    crate::app_storage::write_action_with_doc(
                        inner, window_id, &entry, &doc, value,
                    )?;
                    continue;
                }
                let revision = {
                    let windows = inner.data_runtimes.windows.lock().unwrap();
                    windows
                        .get(window_id)
                        .ok_or_else(|| {
                            errors::DATA_ACT_STORAGE_WINDOW_NOT_FOUND()
                                .and_details(vec![format!("window: {}", window_id)])
                        })?
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
            Step::Refresh { names } => refresh(inner, window_id, &names, true, true)?,
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
                    RequestError::Login(_) => errors::DATA_ACT_CALL_LOGIN_REQUIRED(&permission),
                    RequestError::RateLimited { .. } => {
                        errors::DATA_ACT_CALL_RATE_LIMITED(&permission)
                    }
                })?;
                if !(200..300).contains(&reply.status) {
                    return Err(connections::response_error(&reply, &permission));
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
    Ok(CoreReply::DataAct { sequence: inner.state_events.newest() })
}

fn map_worker_error(error: crate::registry_client::RegistryError, action: &str) -> CoreError {
    match error {
        crate::registry_client::RegistryError::Validation(error) => error,
        crate::registry_client::RegistryError::Unauthorized => {
            errors::DATA_ACT_WORKER_UNAUTHORIZED(action)
        }
        crate::registry_client::RegistryError::NotFound => {
            errors::DATA_ACT_WORKER_NOT_FOUND(action)
        }
        crate::registry_client::RegistryError::Failure { stage, detail } => {
            let error = match stage {
                crate::registry_client::FailureStage::Send => {
                    errors::DATA_ACT_WORKER_UNREACHABLE(action)
                }
                crate::registry_client::FailureStage::Status => {
                    errors::DATA_ACT_WORKER_REJECTED(action)
                }
                crate::registry_client::FailureStage::Read => {
                    errors::DATA_ACT_WORKER_RESPONSE_READ_FAILED(action)
                }
            };
            error.and_details(vec![detail])
        }
    }
}

#[cfg(test)]
mod error_mapping_tests {
    use super::map_worker_error;
    use crate::registry_client::{FailureStage, RegistryError};
    use kaleidoscope_contract::ErrorCode;

    #[test]
    fn worker_failure_stages_have_distinct_codes_and_preserve_detail() {
        for (stage, id) in [
            (FailureStage::Send, "DATA_ACT_WORKER_UNREACHABLE"),
            (FailureStage::Status, "DATA_ACT_WORKER_REJECTED"),
            (FailureStage::Read, "DATA_ACT_WORKER_RESPONSE_READ_FAILED"),
        ] {
            let error = map_worker_error(
                RegistryError::Failure {
                    stage,
                    detail: "HTTP 503; host=registry.example".into(),
                },
                "save",
            );

            assert_eq!(error.code, ErrorCode::Server);
            assert_eq!(error.id.as_deref(), Some(id));
            assert!(error.message.contains("save"));
            assert_eq!(error.details, vec!["HTTP 503; host=registry.example"]);
        }
    }
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
