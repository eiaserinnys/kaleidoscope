//! 계정 설정 명령과 서버 이벤트는 같은 revision 판정으로 반영한다.
use crate::{
    link,
    registry_client::{FailureStage, RegistryError},
    registry_events, Inner,
};
use kaleidoscope_contract::{
    errors, preferences::AccountPreferences, CoreError, CoreReply, CoreRequest, LinkStatus,
};
use std::sync::{atomic::Ordering, Arc};

pub(crate) fn apply(
    inner: &Arc<Inner>,
    generation: u64,
    preferences: AccountPreferences,
) -> Result<bool, CoreError> {
    let (current, event) = registry_events::apply_registry_change(inner, |state| {
        if !link::is_current(inner, generation) {
            return false;
        }
        if state
            .shared
            .preferences
            .as_ref()
            .is_none_or(|old| preferences.revision > old.revision)
        {
            state.shared.preferences = Some(preferences);
        }
        true
    })?;
    if let Some(event) = event {
        inner.emit_state(&event);
    }
    Ok(current)
}

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    let (operation, body) = match &request {
        CoreRequest::ShellPreferencesSetDefault { app_id } => {
            ("default", serde_json::json!({"app_id": app_id}))
        }
        CoreRequest::ShellPreferencesAnswer {
            app_id,
            use_as_default,
        } => (
            "answer",
            serde_json::json!({"app_id":app_id,"use_as_default":use_as_default}),
        ),
        _ => unreachable!(),
    };
    let (file, generation) = {
        let state = inner.state.lock().unwrap();
        if !matches!(state.link, LinkStatus::Connected { .. }) {
            return Err(errors::SERVER_PREFERENCES_NOT_CONNECTED());
        }
        let file = inner
            .link_file
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(errors::SERVER_PREFERENCES_NOT_CONNECTED)?;
        (file, inner.generation.load(Ordering::SeqCst))
    };
    let preferences = inner
        .registry
        .post_preferences(&file.server_url, &file.token, operation, &body)
        .map_err(|error| match error {
            RegistryError::Validation(error) => error,
            RegistryError::Failure { stage, detail } => {
                let error = match stage {
                    FailureStage::Send => errors::SERVER_PREFERENCES_REQUEST_SEND_FAILED(),
                    FailureStage::Status => errors::SERVER_PREFERENCES_RESPONSE_STATUS_FAILED(),
                    FailureStage::Read => errors::SERVER_PREFERENCES_RESPONSE_READ_FAILED(),
                };
                error.and_details(vec![detail.replace(&file.token, "[가림]")])
            }
            RegistryError::Unauthorized | RegistryError::NotFound => {
                errors::SERVER_PREFERENCES_RESPONSE_STATUS_FAILED()
            }
        })?;
    if !apply(inner, generation, preferences.clone())? {
        return Err(errors::SERVER_SWITCH_CANCELLED());
    }
    match request {
        CoreRequest::ShellPreferencesSetDefault { .. } => {
            Ok(CoreReply::ShellPreferencesSetDefault { preferences })
        }
        CoreRequest::ShellPreferencesAnswer { .. } => {
            Ok(CoreReply::ShellPreferencesAnswer { preferences })
        }
        _ => unreachable!(),
    }
}
