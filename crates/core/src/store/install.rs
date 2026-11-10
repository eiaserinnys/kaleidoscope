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

pub(crate) fn registry_error(error: RegistryError, install: bool, app_id: &str) -> CoreError {
    match error {
        RegistryError::Validation(error) => error,
        RegistryError::Failure { http: Some(http), .. } if install && http.status == 413 => {
            let size = kaleidoscope_contract::size::format_byte_limit(http.request_bytes as u64);
            errors::STORECLIENT_INSTALL_REQUEST_TOO_LARGE(app_id, &size)
                .and_details(vec![format!("HTTP {}; host={}", http.status, http.host)])
        },
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

/// 사용자 동의를 받기 전에 확정한 설치 대상과 스토어가 준 바이트.
/// 동의 정책은 부르는 쪽이 정하고, 확정 단계는 여기 담긴 같은 바이트를 보낸다.
pub(crate) struct PreparedInstall {
    window: String,
    permission: String,
    caller: String,
    caller_version: u32,
    link: crate::storage::LinkFile,
    generation: u64,
    server: String,
    id: String,
    release: u32,
    bundle: super::bundle::PreparedBundle,
    /// 설치 뒤 상태를 비교할 기준 판. 확정 단계에서 다시 대조한다.
    expected_current_version: Option<u32>,
    /// 동의를 받을 때의 설치 기준 판. 출처(`from_origin`)와 함께 확정 단계에서 다시 대조한다.
    expected_installed_version: Option<u32>,
    replace: bool,
    from_origin: Option<StoreOrigin>,
    replacing: bool,
    modified: bool,
    needs_consent: bool,
}

/// 대상을 잡고 스토어가 준 묶음을 검증해 설치 준비를 만든다. 사용자 동의는 아직 받지 않는다.
pub(crate) fn prepare_install(inner: &Arc<Inner>, window: &str, permission: &str, server: Value, id: Value, release: Value, replace: bool) -> Result<PreparedInstall, CoreError> {
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
    let bundle = client.prepare(id, release, &manifest_path).map_err(|failure| {
        if failure.error.id.as_deref() == Some("APP_DEFINITION_REQUIRES_NEWER_SHELL") { errors::STORECLIENT_INSTALL_INCOMPATIBLE(id) } else { failure.error }
    })?;
    if !crate::supported().renders_app(&bundle.definition) { return Err(errors::STORECLIENT_INSTALL_INCOMPATIBLE(id)); }
    let modified = current.as_ref().is_some_and(|app| app.origin.is_some() && app.installed_version != Some(app.current_version));
    // 스토어 판으로 바꾸는 요청은 수정본을 되돌리는 것이 목적이므로 사전 거부하지 않고 동의로 확인한다.
    if modified && !replace { return Err(errors::STORECLIENT_INSTALL_LOCAL_MODIFIED(id)); }
    let same_origin = current.as_ref().and_then(|app| app.origin.as_ref())
        .is_some_and(|origin| origin.store_url == client.server.as_str() && origin.store_app_id == id);
    let needs_consent = replace || !same_origin || previous.as_ref().is_none_or(|old| scope(old) != scope(&bundle.definition));
    let from_origin = current.as_ref().and_then(|app| app.origin.clone());
    let replacing = replace && current.is_some() && !(same_origin && !modified);
    Ok(PreparedInstall {
        window: window.into(),
        permission: permission.into(),
        caller,
        caller_version,
        link,
        generation,
        server: client.server.as_str().into(),
        id: id.into(),
        release,
        bundle,
        expected_current_version: current.as_ref().map(|app| app.current_version),
        expected_installed_version: current.as_ref().and_then(|app| app.installed_version),
        replace,
        from_origin,
        replacing,
        modified,
        needs_consent,
    })
}

/// 동의받은 준비 그대로 보낸다. 기다리는 동안 연결 세대, 대상 판, 출처, 설치 기준 판이 바뀌었으면 보내지 않는다.
pub(crate) fn commit_prepared_install(inner: &Arc<Inner>, prepared: PreparedInstall) -> Result<bool, CoreError> {
    let PreparedInstall { window, permission, caller, caller_version, link, generation, server, id, release, bundle, expected_current_version, expected_installed_version, replace, from_origin, .. } = prepared;
    if !crate::link::is_current(inner, generation) { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
    let (current_caller, current_version, _, current_generation) = context(inner, &window, &permission, true).map_err(|error| {
        if !crate::link::is_current(inner, generation) { errors::STORECLIENT_INSTALL_CONTEXT_CHANGED() } else { error }
    })?;
    if current_caller != caller || current_version != caller_version || current_generation != generation { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
    // 같은 정의를 다른 스토어에서 설치하면 판 번호는 그대로이고 출처만 바뀐다. 사용자가 본 출처와 다르면 보내지 않는다.
    let unchanged = inner.state.lock().unwrap().shared.apps.iter().find(|app| app.id == id).map(|app| (app.current_version, app.origin.as_ref(), app.installed_version))
        == expected_current_version.map(|version| (version, from_origin.as_ref(), expected_installed_version));
    if !unchanged { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
    let request = DeviceInstallRequest {
        definition_json: bundle.definition_json,
        asset_uploads: bundle.assets,
        connections: bundle.connections,
        manifest_base64: STANDARD.encode(&bundle.manifest),
        approved_digest: bundle.digest.clone(),
        origin: StoreOrigin { store_url: server, store_app_id: id, release, digest: bundle.digest },
        expected_current_version: expected_current_version.and_then(NonZeroU32::new),
        replace,
    };
    let result = inner.registry.install_store_app(&link.server_url, &link.token, &request);
    let (applied, event) = registry_events::apply_registry_change(inner, |state| {
        if inner.generation.load(Ordering::SeqCst) != generation { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
        let result = result.map_err(|error| registry_error(error, true, &request.origin.store_app_id))?;
        app_commands::import_registry(state, result.app);
        Ok(())
    })?;
    applied?;
    crate::data_runtime::apps_changed(inner);
    if let Some(event) = event { inner.emit_state(&event); }
    Ok(true)
}

/// false는 사용자가 취소한 경우이며 호출자는 나머지 동작을 실행하지 않는다.
pub(crate) fn install(inner: &Arc<Inner>, window: &str, permission: &str, server: Value, id: Value, release: Value, replace: bool) -> Result<bool, CoreError> {
    let prepared = prepare_install(inner, window, permission, server, id, release, replace)?;
    if prepared.needs_consent && !crate::installation_consent::wait(
        inner, &prepared.window, &prepared.caller, prepared.caller_version, prepared.release,
        &prepared.server, &prepared.bundle.digest, &prepared.bundle.definition,
        prepared.from_origin.clone(), prepared.replacing, prepared.modified,
    )? { return Ok(false); }
    commit_prepared_install(inner, prepared)
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
    let result = inner.registry.remove_store_app(&link.server_url, &link.token, id, &DeviceRemoveRequest { expected_current_version: version, allow_custom: false });
    let (applied, event) = registry_events::apply_registry_change(inner, |state| {
        if inner.generation.load(Ordering::SeqCst) != generation { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
        result.map_err(|error| registry_error(error, false, id))?;
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
