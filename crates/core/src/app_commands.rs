use std::collections::BTreeMap;

use kaleidoscope_contract::registry::RegistryApp;
use kaleidoscope_contract::{App, AppDefinition, AppVersion, CoreError, CoreReply, SharedState};

use crate::state_commands::timestamp;
use crate::CoreState;
use kaleidoscope_contract::validate as app_definition;

pub(crate) fn import(
    state: &mut CoreState,
    definition_json: String,
) -> Result<CoreReply, CoreError> {
    let definition = app_definition::parse_app_definition(&definition_json)?;
    if kaleidoscope_contract::builtin::is_builtin(&definition.id) {
        return Err(CoreError::with_details(
            kaleidoscope_contract::ErrorCode::InvalidAppDefinition,
            vec!["기본 앱은 kaleidoscope 리포의 apps/에서 고치고 쉘 새 판으로 냅니다".into()],
        ));
    }
    if !crate::supported().renders(&definition.requires) {
        return Err(CoreError::new(
            kaleidoscope_contract::ErrorCode::UnsupportedApp,
        ));
    }
    Ok(import_definition(state, definition))
}

pub(crate) fn definition_for(
    shared: &SharedState,
    app_id: &str,
    version: u32,
) -> Option<AppDefinition> {
    shared
        .app_versions
        .iter()
        .find(|candidate| candidate.app_id == app_id && candidate.version == version)
        .map(|candidate| candidate.definition.clone())
}

fn import_definition(state: &mut CoreState, definition: AppDefinition) -> CoreReply {
    let now = timestamp();
    let existing = state
        .shared
        .apps
        .iter()
        .find(|app| app.id == definition.id)
        .cloned();
    let previous_version = existing
        .as_ref()
        .map(|app| app.current_version)
        .unwrap_or(0);
    let version_number = previous_version + 1;
    let app = App {
        id: definition.id.clone(),
        name: definition.name.clone(),
        current_version: version_number,
        created_at: existing
            .as_ref()
            .map(|app| app.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now.clone(),
    };
    let version = AppVersion {
        app_id: definition.id.clone(),
        version: version_number,
        definition: definition.clone(),
        created_at: now,
    };
    apply_version(state, app, version.clone(), false);
    CoreReply::AppImport {
        app: version_app(state, &version),
        version,
    }
}

pub(crate) fn import_registry(state: &mut CoreState, received: RegistryApp) -> bool {
    if kaleidoscope_contract::builtin::is_builtin(&received.app.id) {
        return false;
    }
    if !crate::supported().renders(&received.version.definition.requires) {
        return false;
    }
    if state
        .shared
        .apps
        .iter()
        .any(|app| app.id == received.app.id && app.current_version == received.app.current_version)
        && state.shared.app_versions.iter().any(|version| {
            version.app_id == received.app.id
                && version.version == received.app.current_version
                && version.definition == received.version.definition
        })
    {
        return false;
    }

    let app_id = received.app.id.clone();
    let definition_json = match serde_json::to_string(&received.version.definition) {
        Ok(json) => json,
        Err(error) => {
            eprintln!("레지스트리 앱 반영을 건너뜁니다: app_id={app_id}, code=serialization");
            let _ = error;
            return false;
        }
    };
    if let Err(error) = app_definition::parse_cached_app_definition(&definition_json) {
        eprintln!(
            "레지스트리 앱 반영을 건너뜁니다: app_id={app_id}, code={:?}",
            error.code
        );
        return false;
    }

    apply_version(state, received.app, received.version, true);
    true
}

pub(crate) fn ensure_builtin(state: &mut CoreState) {
    for row in kaleidoscope_contract::builtin::builtin_apps() {
        let same = state
            .shared
            .apps
            .iter()
            .any(|app| app.id == row.app.id && app.current_version == row.app.current_version)
            && state.shared.app_versions.iter().any(|version| {
                version.app_id == row.app.id
                    && version.version == row.version.version
                    && version.definition == row.version.definition
            });
        if !same {
            apply_version(state, row.app, row.version, true);
        }
    }
}

pub(crate) fn remove_registry_app(state: &mut CoreState, app_id: &str) {
    if kaleidoscope_contract::builtin::is_builtin(app_id) {
        return;
    }
    state.shared.apps.retain(|app| app.id != app_id);
    state
        .shared
        .app_versions
        .retain(|version| version.app_id != app_id);
    state
        .device
        .pc_access
        .retain(|access| access.app_id != app_id);
}

fn version_app(state: &CoreState, version: &AppVersion) -> App {
    state
        .shared
        .apps
        .iter()
        .find(|app| app.id == version.app_id)
        .expect("imported app is in shared state")
        .clone()
}

fn apply_version(state: &mut CoreState, app: App, version: AppVersion, replace_history: bool) {
    let definition = &version.definition;
    let new_permissions = app_definition::permission_modules(definition);
    state.device.pc_access.retain(|access| {
        access.app_id != app.id || definition.permissions.iter().any(|permission| matches!(permission,
            kaleidoscope_contract::PermissionDecl::Files { id, scope: kaleidoscope_contract::FilesScope::Pc, .. }
            if id == &access.permission))
    });

    if state.shared.apps.iter().any(|current| current.id == app.id) {
        let windows_to_update = state
            .shared
            .windows
            .iter()
            .filter(|window| window.app_id == app.id)
            .map(|window| (window.id.clone(), window.app_version, window.state.clone()))
            .collect::<Vec<_>>();
        let mut old_permissions_by_window = BTreeMap::new();
        for (window_id, old_version, old_state) in windows_to_update {
            let old_permissions = definition_for(&state.shared, &app.id, old_version)
                .map(|old| app_definition::permission_modules(&old))
                .unwrap_or_default();
            let mut next_state = definition.state.clone();
            for (key, value) in &old_state {
                if next_state.contains_key(key) {
                    next_state.insert(key.clone(), value.clone());
                }
            }
            let window = state
                .shared
                .windows
                .iter_mut()
                .find(|window| window.id == window_id)
                .unwrap();
            window.state = next_state;
            window.app_version = version.version;
            window.updated_at = version.created_at.clone();
            old_permissions_by_window.insert(window_id, old_permissions);
        }
        state.device.grants.retain(|grant| {
            let Some(old_permissions) = old_permissions_by_window.get(&grant.window_id) else {
                return true;
            };
            old_permissions
                .get(&grant.permission)
                .zip(new_permissions.get(&grant.permission))
                .is_some_and(|(old_module, new_module)| old_module == new_module)
        });
    }

    if let Some(current) = state
        .shared
        .apps
        .iter_mut()
        .find(|current| current.id == app.id)
    {
        *current = app;
    } else {
        state.shared.apps.push(app);
    }
    if replace_history {
        state
            .shared
            .app_versions
            .retain(|existing| existing.app_id != version.app_id);
    }
    state.shared.app_versions.push(version.clone());
}
