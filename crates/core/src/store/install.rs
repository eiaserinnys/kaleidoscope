//! 검증한 스토어 묶음을 사용자 동의 뒤 레지스트리에 설치한다.
use std::{num::NonZeroU32, sync::{atomic::Ordering, Arc}};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{errors, store::{DeviceInstallRequest, DeviceRemoveRequest, StoreOrigin}, AppDefinition, CoreError, LinkStatus, PermissionDecl};
use serde_json::Value;
use crate::{app_commands, registry_client::RegistryError, registry_events, Inner};
use super::release_path;

fn scope(definition: &AppDefinition) -> Value {
    let mut permissions = definition.permissions.clone();
    permissions.sort_by(|a, b| a.id().cmp(b.id()));
    serde_json::json!({"permissions":permissions, "storage":definition.storage, "client":definition.client, "worker":definition.worker, "agent":definition.agent})
}

fn context(inner: &Inner, window: &str, permission: &str, install: bool) -> Result<(String, u32, crate::storage::LinkFile, u64), CoreError> {
    let state = inner.state.lock().unwrap();
    let win = state.shared.windows.iter().find(|w| w.id == window).ok_or_else(||
        if install { errors::STORECLIENT_INSTALL_WINDOW_MISSING() } else { errors::STORECLIENT_REMOVE_WINDOW_MISSING() })?;
    let definition = app_commands::definition_for(&state.shared, &win.app_id, win.app_version).ok_or_else(||
        if install { errors::STORECLIENT_INSTALL_WINDOW_MISSING() } else { errors::STORECLIENT_REMOVE_WINDOW_MISSING() })?;
    if !definition.permissions.iter().any(|decl| matches!(decl, PermissionDecl::Store { id, .. } if id == permission)) {
        return Err(if install { errors::STORECLIENT_INSTALL_PERMISSION_UNDECLARED(permission) } else { errors::STORECLIENT_REMOVE_PERMISSION_UNDECLARED(permission) });
    }
    if !matches!(state.link, LinkStatus::Connected { .. }) {
        return Err(if install { errors::STORECLIENT_INSTALL_SERVER_DISCONNECTED() } else { errors::STORECLIENT_REMOVE_SERVER_DISCONNECTED() });
    }
    let link = inner.link_file.lock().unwrap().clone().filter(|link| !link.revoked).ok_or_else(||
        if install { errors::STORECLIENT_INSTALL_SERVER_DISCONNECTED() } else { errors::STORECLIENT_REMOVE_SERVER_DISCONNECTED() })?;
    Ok((win.app_id.clone(), win.app_version, link, inner.generation.load(Ordering::SeqCst)))
}

fn registry_error(error: RegistryError, install: bool) -> CoreError {
    match error {
        RegistryError::Validation(error) => error,
        other => {
            let reason = match other {
                RegistryError::Unauthorized => "인증이 만료되었습니다".to_string(),
                RegistryError::NotFound => "서버 경로를 찾을 수 없습니다".to_string(),
                RegistryError::Failure { detail, .. } => detail,
                RegistryError::Validation(_) => unreachable!(),
            };
            if install { errors::STORECLIENT_INSTALL_REGISTRY_FAILED(&reason) } else { errors::STORECLIENT_REMOVE_REGISTRY_FAILED(&reason) }
        }
    }
}

/// false는 사용자가 취소한 경우이며 호출자는 나머지 동작을 실행하지 않는다.
pub(crate) fn install(inner: &Arc<Inner>, window: &str, permission: &str, server: Value, id: Value, release: Value) -> Result<bool, CoreError> {
    let (caller, caller_version, link, generation) = context(inner, window, permission, true)?;
    let server = server.as_str().ok_or_else(errors::STORECLIENT_INSTALL_SERVER_INVALID)?;
    let id = id.as_str().ok_or_else(errors::STORECLIENT_INSTALL_ID_INVALID)?;
    let release = release.as_f64().filter(|n| n.fract() == 0.0 && *n >= 1.0 && *n <= u32::MAX as f64)
        .map(|n| n as u32).ok_or_else(errors::STORECLIENT_INSTALL_RELEASE_INVALID)?;
    let client = super::client(inner, server)?;
    let (current, previous) = {
        let state = inner.state.lock().unwrap();
        let current = state.shared.apps.iter().find(|app| app.id == id).cloned();
        let previous = current.as_ref().and_then(|app| app_commands::definition_for(&state.shared, id, app.current_version));
        (current, previous)
    };
    let manifest_path = format!("{}manifest.json", release_path(id, release)?);
    let prepared = client.prepare(id, release, &manifest_path).map_err(|failure| {
        if failure.error.id.as_deref() == Some("APP_DEFINITION_REQUIRES_NEWER_SHELL") { errors::STORECLIENT_INSTALL_INCOMPATIBLE(id) } else { failure.error }
    })?;
    if !crate::supported().renders_app(&prepared.definition) { return Err(errors::STORECLIENT_INSTALL_INCOMPATIBLE(id)); }
    if current.as_ref().is_some_and(|app| app.origin.is_some() && app.installed_version != Some(app.current_version)) {
        return Err(errors::STORECLIENT_INSTALL_LOCAL_MODIFIED(id));
    }
    let same_origin = current.as_ref().and_then(|app| app.origin.as_ref())
        .is_some_and(|origin| origin.store_url == client.server.as_str() && origin.store_app_id == id);
    let needs_consent = !same_origin || previous.as_ref().is_none_or(|old| scope(old) != scope(&prepared.definition));
    if needs_consent && !crate::installation_consent::wait(inner, window, &caller, caller_version, release, &prepared.digest, &prepared.definition)? { return Ok(false); }
    if needs_consent && !crate::link::is_current(inner, generation) { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
    let (current_caller, current_version, _, current_generation) = context(inner, window, permission, true).map_err(|error| {
        if needs_consent && !crate::link::is_current(inner, generation) { errors::STORECLIENT_INSTALL_CONTEXT_CHANGED() } else { error }
    })?;
    if current_caller != caller || current_version != caller_version || (needs_consent && current_generation != generation) { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
    let request = DeviceInstallRequest {
        definition_json: prepared.definition_json,
        asset_uploads: prepared.assets,
        manifest_base64: STANDARD.encode(prepared.manifest),
        approved_digest: prepared.digest.clone(),
        origin: StoreOrigin { store_url: client.server.as_str().into(), store_app_id: id.into(), release, digest: prepared.digest },
        expected_current_version: current.and_then(|app| NonZeroU32::new(app.current_version)),
    };
    let result = inner.registry.install_store_app(&link.server_url, &link.token, &request);
    let (applied, event) = registry_events::apply_registry_change(inner, |state| {
        if inner.generation.load(Ordering::SeqCst) != generation { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
        let result = result.map_err(|error| registry_error(error, true))?;
        app_commands::import_registry(state, result.app);
        Ok(())
    })?;
    applied?;
    crate::data_runtime::apps_changed(inner);
    if let Some(event) = event { inner.emit_state(&event); }
    Ok(true)
}

pub(crate) fn remove(inner: &Arc<Inner>, window: &str, permission: &str, id: Value) -> Result<(), CoreError> {
    let (_, _, link, generation) = context(inner, window, permission, false)?;
    let id = id.as_str().ok_or_else(errors::STORECLIENT_REMOVE_ID_INVALID)?;
    let version = {
        let state = inner.state.lock().unwrap();
        if inner.generation.load(Ordering::SeqCst) != generation { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
        state.shared.apps.iter().find(|app| app.id == id)
            .and_then(|app| NonZeroU32::new(app.current_version)).ok_or_else(|| errors::STORECLIENT_REMOVE_APP_MISSING(id))?
    };
    let result = inner.registry.remove_store_app(&link.server_url, &link.token, id, &DeviceRemoveRequest { expected_current_version: version });
    let (applied, event) = registry_events::apply_registry_change(inner, |state| {
        if inner.generation.load(Ordering::SeqCst) != generation { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
        result.map_err(|error| registry_error(error, false))?;
        app_commands::remove_registry_app(state, id);
        Ok(())
    })?;
    applied?;
    crate::data_runtime::apps_changed(inner);
    if let Some(event) = event { inner.emit_state(&event); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn review_scope_ignores_permission_order_but_detects_worker_changes() {
        let definition = json!({
            "id":"fixture", "name":"보기", "requires":{"blocks":4,"modules":{"store":1,"worker":1}},
            "permissions":[{"module":"store","id":"z","label":"스토어"},{"module":"store","id":"a","label":"앱"}],
            "worker":{"runtime":"python3","code":"print(1)"}, "ui":{"type":"text","value":"보기"}
        });
        let before: AppDefinition = serde_json::from_value(definition.clone()).unwrap();
        let mut same = definition.clone();
        same["permissions"].as_array_mut().unwrap().reverse();
        same["name"] = json!("새 이름");
        same["ui"]["value"] = json!("새 내용");
        let same: AppDefinition = serde_json::from_value(same).unwrap();
        assert_eq!(scope(&before), scope(&same));
        let mut changed = definition;
        changed["worker"]["code"] = json!("print(2)");
        let changed: AppDefinition = serde_json::from_value(changed).unwrap();
        assert_ne!(scope(&before), scope(&changed));
    }
}
