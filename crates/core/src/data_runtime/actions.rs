use super::*;
use crate::connections;
use kaleidoscope_contract::{
    data::{self, BindingValue},
    registry::{LayoutDataError, LAYOUT_DATA_ERRORS_MAX},
};
use kaleidoscope_data::{Env, Step};

pub(crate) fn act(
    inner: &Arc<Inner>,
    window_id: &str,
    pointer: &str,
    event: Value,
    item: Value,
) -> Result<CoreReply, CoreError> {
    let len = {
        let windows = inner.data_runtimes.windows.lock().unwrap();
        windows
            .get(window_id)
            .and_then(|runtime| runtime.compiled.actions_len(pointer))
            .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?
    };
    for index in 0..len {
        let step = {
            let windows = inner.data_runtimes.windows.lock().unwrap();
            let runtime = windows
                .get(window_id)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            runtime
                .compiled
                .action_step(
                    pointer,
                    index,
                    &Env {
                        state: &runtime.state,
                        data: &runtime.data,
                        event: &event,
                        item: &item,
                    },
                )
                .map_err(|message| error::with_message(ErrorCode::InvalidRequest, &message))?
        };
        match step {
            Step::SetState { key, value } => {
                crate::Core {
                    inner: Arc::clone(inner),
                }
                .set_state_key(window_id, key, value)?;
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
            }
        }
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
