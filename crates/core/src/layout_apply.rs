use std::collections::HashSet;

use kaleidoscope_contract::registry::LayoutChanges;
use kaleidoscope_contract::{migrate_window_state, AppWindow, Desktop, Workspace};

use crate::sync_state::{EntityKey, EntityKind, SyncState};
use crate::CoreState;

trait Entity: Clone {
    fn id(&self) -> &str;
}
impl Entity for Workspace {
    fn id(&self) -> &str {
        &self.id
    }
}
impl Entity for Desktop {
    fn id(&self) -> &str {
        &self.id
    }
}
impl Entity for AppWindow {
    fn id(&self) -> &str {
        &self.id
    }
}

fn snapshot_list<T: Entity>(
    local: &mut Vec<T>,
    incoming: Vec<T>,
    sync: &SyncState,
    kind: EntityKind,
) {
    let mut next = Vec::new();
    for item in incoming {
        if sync.contains(kind, item.id()) {
            if let Some(existing) = local.iter().find(|old| old.id() == item.id()) {
                next.push(existing.clone());
            }
        } else {
            next.push(item);
        }
    }
    for item in local.iter() {
        if sync.contains(kind, item.id()) && !next.iter().any(|current| current.id() == item.id()) {
            next.push(item.clone());
        }
    }
    *local = next;
}

fn change_list<T: Entity>(
    local: &mut Vec<T>,
    incoming: Vec<T>,
    deleted: Vec<String>,
    sync: &SyncState,
    kind: EntityKind,
) {
    for item in incoming {
        if sync.contains(kind, item.id()) {
            continue;
        }
        if let Some(existing) = local.iter_mut().find(|old| old.id() == item.id()) {
            *existing = item;
        } else {
            local.push(item);
        }
    }
    local
        .retain(|item| !deleted.iter().any(|id| id == item.id()) || sync.contains(kind, item.id()));
}

pub(crate) fn apply_snapshot(state: &mut CoreState, device_id: &str, changes: LayoutChanges) {
    if !state.sync.merged {
        if !changes.workspaces.is_empty() {
            let occupied: HashSet<_> = state
                .shared
                .windows
                .iter()
                .map(|w| w.desktop_id.as_str())
                .collect();
            let keep: HashSet<_> = state
                .shared
                .desktops
                .iter()
                .filter(|d| occupied.contains(d.id.as_str()))
                .map(|d| d.workspace_id.clone())
                .collect();
            let discarded: HashSet<_> = state
                .shared
                .workspaces
                .iter()
                .filter(|w| !keep.contains(&w.id))
                .map(|w| w.id.clone())
                .collect();
            let desktops: HashSet<_> = state
                .shared
                .desktops
                .iter()
                .filter(|d| discarded.contains(&d.workspace_id))
                .map(|d| d.id.clone())
                .collect();
            state
                .shared
                .workspaces
                .retain(|w| !discarded.contains(&w.id));
            state.shared.desktops.retain(|d| !desktops.contains(&d.id));
            state.sync.pending.retain(|key, _| match key.kind {
                EntityKind::Workspace => !discarded.contains(&key.id),
                EntityKind::Desktop => !desktops.contains(&key.id),
                EntityKind::Window => true,
            });
        }
        state.sync.mark_all(&state.shared);
        state.sync.merged = true;
        state.sync.device_id = Some(device_id.to_owned());
    }
    snapshot_list(
        &mut state.shared.workspaces,
        changes.workspaces,
        &state.sync,
        EntityKind::Workspace,
    );
    snapshot_list(
        &mut state.shared.desktops,
        changes.desktops,
        &state.sync,
        EntityKind::Desktop,
    );
    snapshot_list(
        &mut state.shared.windows,
        changes.windows,
        &state.sync,
        EntityKind::Window,
    );
    reconcile(state);
}

pub(crate) fn apply_changes(state: &mut CoreState, changes: LayoutChanges) {
    change_list(
        &mut state.shared.workspaces,
        changes.workspaces,
        changes.deleted_workspaces,
        &state.sync,
        EntityKind::Workspace,
    );
    change_list(
        &mut state.shared.desktops,
        changes.desktops,
        changes.deleted_desktops,
        &state.sync,
        EntityKind::Desktop,
    );
    change_list(
        &mut state.shared.windows,
        changes.windows,
        changes.deleted_windows,
        &state.sync,
        EntityKind::Window,
    );
    reconcile(state);
}

fn reconcile(state: &mut CoreState) {
    let workspaces: HashSet<_> = state
        .shared
        .workspaces
        .iter()
        .map(|w| w.id.clone())
        .collect();
    state.shared.desktops.retain(|desktop| {
        let valid = workspaces.contains(&desktop.workspace_id);
        if !valid {
            state
                .sync
                .pending
                .remove(&EntityKey::new(EntityKind::Desktop, &desktop.id));
        }
        valid
    });
    let desktops: HashSet<_> = state.shared.desktops.iter().map(|d| d.id.clone()).collect();
    state.shared.windows.retain(|window| {
        let valid = desktops.contains(&window.desktop_id);
        if !valid {
            state
                .sync
                .pending
                .remove(&EntityKey::new(EntityKind::Window, &window.id));
        }
        valid
    });
    for window in &mut state.shared.windows {
        if let Some(app) = state.shared.apps.iter().find(|a| a.id == window.app_id) {
            if window.app_version != app.current_version {
                if let Some(version) = state
                    .shared
                    .app_versions
                    .iter()
                    .find(|v| v.app_id == app.id && v.version == app.current_version)
                {
                    window.state = migrate_window_state(&version.definition, &window.state);
                    window.app_version = app.current_version;
                }
            }
        }
    }
    let windows: HashSet<_> = state.shared.windows.iter().map(|w| w.id.as_str()).collect();
    state
        .device
        .grants
        .retain(|grant| windows.contains(grant.window_id.as_str()));
    state
        .device
        .active_desktop_ids
        .retain(|workspace_id, desktop_id| {
            workspaces.contains(workspace_id)
                && state
                    .shared
                    .desktops
                    .iter()
                    .any(|d| d.id == *desktop_id && d.workspace_id == *workspace_id)
        });
    if !state
        .device
        .active_workspace_id
        .as_ref()
        .is_some_and(|id| workspaces.contains(id))
    {
        state.device.active_workspace_id = state.shared.workspaces.first().map(|w| w.id.clone());
    }
    if let Some(workspace_id) = state.device.active_workspace_id.clone() {
        if let Some(desktop_id) = crate::state_commands::active_desktop(state, &workspace_id) {
            state
                .device
                .active_desktop_ids
                .insert(workspace_id, desktop_id);
        }
    }
}
