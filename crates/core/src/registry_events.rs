use std::sync::atomic::Ordering;
use std::sync::Arc;

use kaleidoscope_contract::registry::{DeviceEvent, LayoutChanges};
use kaleidoscope_contract::{CoreError, CoreEvent, LinkStatus};

use crate::app_commands;
use crate::link;
use crate::storage;
use crate::{snapshot, Inner};

pub(crate) fn apply_event(inner: &Arc<Inner>, generation: u64, event: DeviceEvent) -> bool {
    if !link::is_current(inner, generation) {
        return false;
    }
    match event {
        DeviceEvent::AppsSnapshot { apps } => {
            let link_file = inner.link_file.lock().unwrap().clone();
            let result = apply_registry_change(inner, |state| {
                if inner.generation.load(Ordering::SeqCst) != generation {
                    return None;
                }
                for app in apps {
                    app_commands::import_registry(state, app);
                }
                let epoch = inner.layout_connection_epoch.fetch_add(1, Ordering::SeqCst) + 1;
                let status = LinkStatus::Connected {
                    server_url: link_file
                        .as_ref()
                        .map(|link| link.server_url.clone())
                        .unwrap_or_default(),
                    device_name: link_file
                        .as_ref()
                        .map(|link| link.device_name.clone())
                        .unwrap_or_default(),
                };
                link::set_link_locked(state, status);
                Some(epoch)
            });
            let (applied, state_event) = match result {
                Ok(result) => result,
                Err(error) => {
                    link::set_offline(inner, generation, &link::load_link(inner), error.message);
                    return true;
                }
            };
            let Some(epoch) = applied else {
                return false;
            };
            if let Some(event) = state_event {
                inner.emit(&event);
            }
            crate::share::on_connected(inner);
            crate::layout_reporter::start(Arc::clone(inner), generation, epoch);
        }
        DeviceEvent::AppPublished {
            app,
            open,
            workspace_id,
        } => {
            let result = apply_registry_change(inner, |state| {
                if inner.generation.load(Ordering::SeqCst) != generation {
                    return None;
                }
                app_commands::import_registry(state, app.clone());
                Some(())
            });
            let (applied, state_event) = match result {
                Ok(result) => result,
                Err(error) => {
                    link::set_offline(inner, generation, &link::load_link(inner), error.message);
                    return true;
                }
            };
            if applied.is_none() {
                return false;
            }
            if let Some(event) = state_event {
                inner.emit(&event);
            }
            if open && has_workspace(inner, workspace_id.as_deref()) {
                inner.emit(&CoreEvent::AppOpenRequested {
                    app_id: app.app.id,
                    workspace_id,
                });
            }
        }
        DeviceEvent::AppOpen {
            app_id,
            workspace_id,
        } => {
            let app_exists = inner
                .state
                .lock()
                .unwrap()
                .shared
                .apps
                .iter()
                .any(|app| app.id == app_id);
            if app_exists && has_workspace(inner, workspace_id.as_deref()) {
                inner.emit(&CoreEvent::AppOpenRequested {
                    app_id,
                    workspace_id,
                });
            }
        }
        DeviceEvent::AgentUpdate {
            workspace_id,
            update,
        } => {
            if has_workspace(inner, Some(&workspace_id)) {
                inner.emit(&CoreEvent::AgentUpdate {
                    workspace_id,
                    update,
                });
            }
        }
        DeviceEvent::LayoutSnapshot {
            workspaces,
            desktops,
            windows,
        } => {
            let device_id = match inner.link_file.lock().unwrap().as_ref() {
                Some(file) => file.device_id.clone(),
                None => return false,
            };
            let result = apply_layout_change(inner, |state| {
                if inner.generation.load(Ordering::SeqCst) != generation {
                    return false;
                }
                crate::layout_apply::apply_snapshot(
                    state,
                    &device_id,
                    LayoutChanges {
                        workspaces,
                        desktops,
                        windows,
                        ..Default::default()
                    },
                );
                true
            });
            match result {
                Ok((true, event)) => {
                    if let Some(event) = event {
                        inner.emit(&event);
                    }
                    let epoch = inner.layout_connection_epoch.load(Ordering::SeqCst);
                    crate::layout_sync::start(Arc::clone(inner), generation, epoch);
                }
                Ok((false, _)) => return false,
                Err(error) => {
                    link::set_offline(inner, generation, &link::load_link(inner), error.message);
                }
            }
        }
        DeviceEvent::LayoutChanged { changes } => {
            let result = apply_layout_change(inner, |state| {
                if inner.generation.load(Ordering::SeqCst) != generation {
                    return false;
                }
                crate::layout_apply::apply_changes(state, changes);
                true
            });
            match result {
                Ok((true, event)) => {
                    if let Some(event) = event {
                        inner.emit(&event);
                    }
                }
                Ok((false, _)) => return false,
                Err(error) => {
                    link::set_offline(inner, generation, &link::load_link(inner), error.message)
                }
            }
        }
        DeviceEvent::ConnectionsSnapshot { connections } => {
            let changed = {
                let mut current = inner.connections.lock().unwrap();
                let mut changed: Vec<String> = current
                    .iter()
                    .chain(&connections)
                    .filter(|info| {
                        current.iter().find(|old| old.name == info.name)
                            != connections.iter().find(|new| new.name == info.name)
                    })
                    .map(|info| info.name.clone())
                    .collect();
                changed.sort();
                changed.dedup();
                *current = connections;
                changed
            };
            if !changed.is_empty() {
                crate::data_runtime::connections_changed(inner, &changed);
            }
        }
    }
    link::is_current(inner, generation)
}

fn has_workspace(inner: &Inner, workspace_id: Option<&str>) -> bool {
    let Some(workspace_id) = workspace_id else {
        return true;
    };
    inner
        .state
        .lock()
        .unwrap()
        .shared
        .workspaces
        .iter()
        .any(|workspace| workspace.id == workspace_id)
}

pub(crate) fn apply_registry_change<T>(
    inner: &Inner,
    update: impl FnOnce(&mut crate::CoreState) -> T,
) -> Result<(T, Option<CoreEvent>), CoreError> {
    apply_change(inner, update, false)
}

pub(crate) fn apply_layout_change<T>(
    inner: &Inner,
    update: impl FnOnce(&mut crate::CoreState) -> T,
) -> Result<(T, Option<CoreEvent>), CoreError> {
    apply_change(inner, update, true)
}

fn apply_change<T>(
    inner: &Inner,
    update: impl FnOnce(&mut crate::CoreState) -> T,
    server_layout: bool,
) -> Result<(T, Option<CoreEvent>), CoreError> {
    let mut state = inner.state.lock().unwrap();
    let before = state.clone();
    let result = update(&mut state);
    let shared_changed = before.shared != state.shared;
    let device_changed = before.device != state.device;
    let link_changed = before.link != state.link;
    let sync_changed = before.sync != state.sync;

    if shared_changed || device_changed || sync_changed {
        if let Err(error) = storage::save_changed_state(
            &inner.data_dir,
            &state.shared,
            &state.device,
            shared_changed,
            device_changed,
        ) {
            *state = before;
            return Err(error);
        }
        if sync_changed {
            if let Err(error) = crate::sync_state::save(&inner.data_dir, &state.sync) {
                *state = before;
                return Err(error);
            }
        }
    }

    if server_layout && shared_changed {
        crate::web::record_server_navigation(inner, &before, &state);
    }

    let event =
        (shared_changed || device_changed || link_changed).then(|| CoreEvent::StateChanged {
            snapshot: snapshot(&state),
        });
    drop(state);
    crate::web::detach_removed(inner);
    Ok((result, event))
}
