use std::collections::BTreeMap;

use kaleidoscope_contract::{App, AppDefinition, AppVersion, CoreError, CoreReply, SharedState};

use crate::app_definition;
use crate::state_commands::timestamp;
use crate::CoreState;

pub(crate) fn import(
    state: &mut CoreState,
    definition_json: String,
) -> Result<CoreReply, CoreError> {
    let definition = app_definition::parse(&definition_json)?;
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
    let new_permissions = app_definition::permission_modules(&definition);

    if existing.is_some() {
        let windows_to_update = state
            .shared
            .windows
            .iter()
            .filter(|window| window.app_id == definition.id)
            .map(|window| (window.id.clone(), window.app_version, window.state.clone()))
            .collect::<Vec<_>>();
        let mut old_permissions_by_window = BTreeMap::new();
        for (window_id, old_version, old_state) in windows_to_update {
            let old_permissions = definition_for(&state.shared, &definition.id, old_version)
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
            window.app_version = version_number;
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
        .find(|current| current.id == definition.id)
    {
        *current = app.clone();
    } else {
        state.shared.apps.push(app.clone());
    }
    state.shared.app_versions.push(version.clone());

    CoreReply::AppImport { app, version }
}
