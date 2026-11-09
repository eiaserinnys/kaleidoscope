use chrono::{SecondsFormat, Utc};
use std::collections::BTreeMap;
use uuid::Uuid;

use kaleidoscope_contract::{
    errors, AppWindow, CoreError, CoreReply, CoreRequest, Desktop, DesktopShortcut,
    DesktopWallpaper, JsonValue, Rect, Workspace, WINDOW_STATE_MAX_BYTES,
};

use crate::app_commands;
use crate::CoreState;

pub(crate) fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub(crate) fn new_workspace(name: String, now: String) -> Workspace {
    Workspace {
        id: Uuid::new_v4().to_string(),
        name,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub(crate) fn new_desktop(
    workspace_id: String,
    name: String,
    position: u32,
    now: String,
) -> Desktop {
    Desktop {
        id: Uuid::new_v4().to_string(),
        workspace_id,
        name,
        position,
        sharing: Vec::new(),
        last_sent_context: Default::default(),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn set_window_state(
    state: &mut CoreState,
    window_id: &str,
    next: BTreeMap<String, JsonValue>,
) -> Result<AppWindow, CoreError> {
    let (app_id, app_version) = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)
        .map(|window| (window.app_id.clone(), window.app_version))
        .ok_or_else(|| {
            errors::DESK_WINDOW_STATE_WINDOW_NOT_FOUND()
                .and_details(vec![format!("window_id: {window_id}")])
        })?;
    let definition = app_commands::definition_for(&state.shared, &app_id, app_version)
        .ok_or_else(|| errors::DESK_WINDOW_STATE_APP_VERSION_NOT_FOUND(&app_id, app_version))?;
    if let Some(key) = next.keys().find(|key| !definition.state.contains_key(*key)) {
        return Err(errors::DESK_WINDOW_STATE_KEY_NOT_DECLARED(&app_id, key)
            .and_details(vec![format!("window_id: {window_id}")]));
    }
    let bytes = serde_json::to_vec(&next).map_err(|_| {
        errors::DESK_WINDOW_STATE_SERIALIZATION_FAILED(&app_id)
            .and_details(vec![format!("window_id: {window_id}")])
    })?;
    if bytes.len() > WINDOW_STATE_MAX_BYTES {
        return Err(errors::DESK_WINDOW_STATE_TOO_LARGE(
            &app_id,
            kaleidoscope_contract::size::format_byte_limit(WINDOW_STATE_MAX_BYTES as u64),
        )
        .and_details(vec![format!("window_id: {window_id}")]));
    }
    let window = state
        .shared
        .windows
        .iter_mut()
        .find(|window| window.id == window_id)
        .unwrap();
    window.state = next;
    window.updated_at = timestamp();
    Ok(window.clone())
}

pub(crate) fn handle(state: &mut CoreState, request: CoreRequest) -> Result<CoreReply, CoreError> {
    match request {
        CoreRequest::WorkspaceCreate { name } => {
            let now = timestamp();
            let workspace = new_workspace(name, now.clone());
            let desktop = new_desktop(workspace.id.clone(), "데스크톱 1".into(), 0, now);
            state
                .device
                .active_desktop_ids
                .insert(workspace.id.clone(), desktop.id.clone());
            state.device.active_workspace_id = Some(workspace.id.clone());
            state.shared.workspaces.push(workspace.clone());
            state.shared.desktops.push(desktop.clone());
            Ok(CoreReply::WorkspaceCreate { workspace, desktop })
        }
        CoreRequest::WorkspaceRename { workspace_id, name } => {
            let workspace = state
                .shared
                .workspaces
                .iter_mut()
                .find(|workspace| workspace.id == workspace_id)
                .ok_or_else(|| {
                    errors::DESK_WORKSPACE_RENAME_NOT_FOUND()
                        .and_details(vec![format!("workspace_id: {}", &workspace_id)])
                })?;
            workspace.name = name;
            workspace.updated_at = timestamp();
            Ok(CoreReply::WorkspaceRename {
                workspace: workspace.clone(),
            })
        }
        CoreRequest::WorkspaceDelete { workspace_id } => {
            if state.shared.workspaces.len() <= 1 {
                return Err(errors::DESK_WORKSPACE_DELETE_LAST());
            }
            let workspace = state
                .shared
                .workspaces
                .iter()
                .find(|workspace| workspace.id == workspace_id)
                .ok_or_else(|| {
                    errors::DESK_WORKSPACE_DELETE_NOT_FOUND()
                        .and_details(vec![format!("workspace_id: {}", &workspace_id)])
                })?;
            let deleting_active =
                state.device.active_workspace_id.as_deref() == Some(workspace.id.as_str());
            let desktop_ids = state
                .shared
                .desktops
                .iter()
                .filter(|desktop| desktop.workspace_id == workspace_id)
                .map(|desktop| desktop.id.clone())
                .collect::<Vec<_>>();
            let window_ids = state
                .shared
                .windows
                .iter()
                .filter(|window| desktop_ids.contains(&window.desktop_id))
                .map(|window| window.id.clone())
                .collect::<Vec<_>>();
            state
                .shared
                .workspaces
                .retain(|workspace| workspace.id != workspace_id);
            state
                .shared
                .desktops
                .retain(|desktop| desktop.workspace_id != workspace_id);
            state
                .shared
                .windows
                .retain(|window| !desktop_ids.contains(&window.desktop_id));
            state
                .shared
                .desktop_shortcuts
                .retain(|s| !desktop_ids.contains(&s.desktop_id));
            state
                .device
                .grants
                .retain(|grant| !window_ids.contains(&grant.window_id));
            state.device.active_desktop_ids.remove(&workspace_id);
            if deleting_active {
                let active = state.shared.workspaces.first().unwrap();
                state.device.active_workspace_id = Some(active.id.clone());
                let desktop_id = active_desktop(state, &active.id).ok_or_else(|| {
                    errors::DESK_WORKSPACE_DELETE_ACTIVE_DESKTOP_MISSING(&active.name)
                })?;
                state
                    .device
                    .active_desktop_ids
                    .insert(active.id.clone(), desktop_id);
            }
            Ok(CoreReply::WorkspaceDelete {})
        }
        CoreRequest::WorkspaceActivate { workspace_id } => {
            let workspace = state
                .shared
                .workspaces
                .iter()
                .find(|workspace| workspace.id == workspace_id)
                .ok_or_else(|| {
                    errors::DESK_WORKSPACE_ACTIVATE_NOT_FOUND()
                        .and_details(vec![format!("workspace_id: {}", &workspace_id)])
                })?;
            let desktop_id = active_desktop(state, &workspace.id)
                .ok_or_else(|| errors::DESK_WORKSPACE_ACTIVATE_DESKTOP_MISSING(&workspace.name))?;
            state.device.active_workspace_id = Some(workspace.id.clone());
            state
                .device
                .active_desktop_ids
                .insert(workspace.id.clone(), desktop_id);
            Ok(CoreReply::WorkspaceActivate {})
        }
        CoreRequest::DeviceThemeSet { theme } => {
            state.device.theme = theme;
            Ok(CoreReply::DeviceThemeSet {})
        }
        CoreRequest::DesktopCreate { workspace_id, name } => {
            if !state
                .shared
                .workspaces
                .iter()
                .any(|workspace| workspace.id == workspace_id)
            {
                return Err(errors::DESK_DESKTOP_CREATE_WORKSPACE_NOT_FOUND()
                    .and_details(vec![format!("workspace_id: {}", &workspace_id)]));
            }
            let position = state
                .shared
                .desktops
                .iter()
                .filter(|desktop| desktop.workspace_id == workspace_id)
                .map(|desktop| desktop.position)
                .max()
                .map(|position| position.saturating_add(1))
                .unwrap_or(0);
            let now = timestamp();
            state
                .shared
                .workspaces
                .iter_mut()
                .find(|workspace| workspace.id == workspace_id)
                .unwrap()
                .updated_at = now.clone();
            let desktop = new_desktop(workspace_id.clone(), name, position, now);
            state.shared.desktops.push(desktop.clone());
            state.device.active_workspace_id = Some(workspace_id.clone());
            state
                .device
                .active_desktop_ids
                .insert(workspace_id, desktop.id.clone());
            Ok(CoreReply::DesktopCreate { desktop })
        }
        CoreRequest::DesktopRename { desktop_id, name } => {
            let desktop = state
                .shared
                .desktops
                .iter_mut()
                .find(|desktop| desktop.id == desktop_id)
                .ok_or_else(|| {
                    errors::DESK_DESKTOP_RENAME_NOT_FOUND()
                        .and_details(vec![format!("desktop_id: {}", &desktop_id)])
                })?;
            desktop.name = name;
            desktop.updated_at = timestamp();
            Ok(CoreReply::DesktopRename {
                desktop: desktop.clone(),
            })
        }
        CoreRequest::DesktopDelete { desktop_id } => {
            let deleted = state
                .shared
                .desktops
                .iter()
                .find(|desktop| desktop.id == desktop_id)
                .cloned()
                .ok_or_else(|| {
                    errors::DESK_DESKTOP_DELETE_NOT_FOUND()
                        .and_details(vec![format!("desktop_id: {}", &desktop_id)])
                })?;
            let desktop_count = state
                .shared
                .desktops
                .iter()
                .filter(|desktop| desktop.workspace_id == deleted.workspace_id)
                .count();
            if desktop_count <= 1 {
                return Err(errors::DESK_DESKTOP_DELETE_LAST());
            }
            let deleting_active = state
                .device
                .active_desktop_ids
                .get(&deleted.workspace_id)
                .is_some_and(|active| active == &desktop_id);
            let active_workspace =
                state.device.active_workspace_id.as_deref() == Some(deleted.workspace_id.as_str());
            let workspace_name = state
                .shared
                .workspaces
                .iter()
                .find(|workspace| workspace.id == deleted.workspace_id)
                .map(|workspace| workspace.name.clone())
                .unwrap_or_else(|| deleted.workspace_id.clone());
            let window_ids = state
                .shared
                .windows
                .iter()
                .filter(|window| window.desktop_id == desktop_id)
                .map(|window| window.id.clone())
                .collect::<Vec<_>>();
            state
                .shared
                .desktops
                .retain(|desktop| desktop.id != desktop_id);
            state
                .shared
                .windows
                .retain(|window| window.desktop_id != desktop_id);
            state
                .shared
                .desktop_shortcuts
                .retain(|s| s.desktop_id != desktop_id);
            state
                .device
                .grants
                .retain(|grant| !window_ids.contains(&grant.window_id));
            let now = timestamp();
            let mut remaining = state
                .shared
                .desktops
                .iter_mut()
                .filter(|desktop| desktop.workspace_id == deleted.workspace_id)
                .collect::<Vec<_>>();
            remaining.sort_by_key(|desktop| desktop.position);
            for (position, desktop) in remaining.iter_mut().enumerate() {
                desktop.position = position as u32;
                desktop.updated_at = now.clone();
            }
            if deleting_active {
                let nearest = state
                    .shared
                    .desktops
                    .iter()
                    .filter(|desktop| desktop.workspace_id == deleted.workspace_id)
                    .min_by_key(|desktop| desktop.position.abs_diff(deleted.position))
                    .ok_or_else(|| {
                        errors::DESK_DESKTOP_DELETE_REPLACEMENT_MISSING(&workspace_name)
                    })?;
                state
                    .device
                    .active_desktop_ids
                    .insert(deleted.workspace_id.clone(), nearest.id.clone());
                if active_workspace {
                    state.device.active_workspace_id = Some(deleted.workspace_id);
                }
            }
            Ok(CoreReply::DesktopDelete {})
        }
        CoreRequest::DesktopActivate { desktop_id } => {
            let desktop = state
                .shared
                .desktops
                .iter()
                .find(|desktop| desktop.id == desktop_id)
                .cloned()
                .ok_or_else(|| {
                    errors::DESK_DESKTOP_ACTIVATE_NOT_FOUND()
                        .and_details(vec![format!("desktop_id: {}", &desktop_id)])
                })?;
            state.device.active_workspace_id = Some(desktop.workspace_id.clone());
            state
                .device
                .active_desktop_ids
                .insert(desktop.workspace_id.clone(), desktop.id.clone());
            Ok(CoreReply::DesktopActivate {})
        }
        CoreRequest::DesktopShortcutAdd { desktop_id, app_id } => {
            if !state.shared.desktops.iter().any(|d| d.id == desktop_id) {
                return Err(errors::DESK_SHORTCUT_ADD_DESKTOP_NOT_FOUND()
                    .and_details(vec![format!("desktop_id: {desktop_id}")]));
            }
            let id = format!("{desktop_id}/{app_id}");
            if let Some(shortcut) = state.shared.desktop_shortcuts.iter().find(|s| s.id == id) {
                return Ok(CoreReply::DesktopShortcutAdd {
                    shortcut: shortcut.clone(),
                });
            }
            if !state.shared.apps.iter().any(|app| app.id == app_id) {
                return Err(errors::DESK_SHORTCUT_ADD_APP_NOT_FOUND(&app_id));
            }
            let column =
                (0..)
                    .find(|column| {
                        !state.shared.desktop_shortcuts.iter().any(|s| {
                            s.desktop_id == desktop_id && s.row == 0 && s.column == *column
                        })
                    })
                    .expect("빈 열");
            let now = timestamp();
            let shortcut = DesktopShortcut {
                id,
                desktop_id,
                app_id,
                column,
                row: 0,
                created_at: now.clone(),
                updated_at: now,
            };
            state.shared.desktop_shortcuts.push(shortcut.clone());
            Ok(CoreReply::DesktopShortcutAdd { shortcut })
        }
        CoreRequest::DesktopShortcutMove {
            shortcut_id,
            column,
            row,
        } => {
            let shortcut = state
                .shared
                .desktop_shortcuts
                .iter_mut()
                .find(|s| s.id == shortcut_id)
                .ok_or_else(|| errors::DESK_SHORTCUT_MOVE_NOT_FOUND(&shortcut_id))?;
            let (Ok(column_value), Ok(row_value)) = (u32::try_from(column), u32::try_from(row))
            else {
                return Err(errors::DESK_SHORTCUT_MOVE_POSITION_INVALID(column, row));
            };
            shortcut.column = column_value;
            shortcut.row = row_value;
            shortcut.updated_at = timestamp();
            Ok(CoreReply::DesktopShortcutMove {
                shortcut: shortcut.clone(),
            })
        }
        CoreRequest::DesktopShortcutRemove { shortcut_id } => {
            state
                .shared
                .desktop_shortcuts
                .retain(|s| s.id != shortcut_id);
            Ok(CoreReply::DesktopShortcutRemove {})
        }
        CoreRequest::DesktopWallpaperReset { desktop_id } => {
            if !state.shared.desktops.iter().any(|d| d.id == desktop_id) {
                return Err(errors::DESK_WALLPAPER_DESKTOP_NOT_FOUND()
                    .and_details(vec![format!("desktop_id: {desktop_id}")]));
            }
            state
                .shared
                .desktop_wallpapers
                .retain(|wallpaper| wallpaper.desktop_id != desktop_id);
            Ok(CoreReply::DesktopWallpaperReset {})
        }
        CoreRequest::WindowOpen {
            desktop_id,
            app_id,
            rect,
        } => {
            let desktop = state
                .shared
                .desktops
                .iter()
                .find(|desktop| desktop.id == desktop_id)
                .cloned()
                .ok_or_else(|| {
                    errors::DESK_WINDOW_OPEN_DESKTOP_NOT_FOUND()
                        .and_details(vec![format!("desktop_id: {}", &desktop_id)])
                })?;
            let app = state
                .shared
                .apps
                .iter()
                .find(|app| app.id == app_id)
                .cloned()
                .ok_or_else(|| errors::DESK_WINDOW_OPEN_APP_NOT_FOUND(&app_id))?;
            let definition =
                app_commands::definition_for(&state.shared, &app.id, app.current_version)
                    .ok_or_else(|| {
                        errors::DESK_WINDOW_OPEN_APP_VERSION_NOT_FOUND(
                            &app.name,
                            app.current_version,
                        )
                        .and_details(vec![format!("app_id: {}", app.id)])
                    })?;
            let windows = state
                .shared
                .windows
                .iter()
                .filter(|window| window.desktop_id == desktop_id)
                .collect::<Vec<_>>();
            let z = windows
                .iter()
                .map(|window| window.z)
                .max()
                .map(|z| z.saturating_add(1))
                .unwrap_or(0);
            if definition.single_window {
                if let Some(existing_id) = state
                    .shared
                    .windows
                    .iter()
                    .filter(|window| window.desktop_id == desktop_id && window.app_id == app.id)
                    .max_by_key(|window| window.z)
                    .map(|window| window.id.clone())
                {
                    let window = state
                        .shared
                        .windows
                        .iter_mut()
                        .find(|window| window.id == existing_id)
                        .unwrap();
                    window.z = z;
                    window.minimized = false;
                    window.updated_at = timestamp();
                    let window = window.clone();
                    state.device.active_workspace_id = Some(desktop.workspace_id.clone());
                    state
                        .device
                        .active_desktop_ids
                        .insert(desktop.workspace_id.clone(), desktop.id.clone());
                    return Ok(CoreReply::WindowOpen { window });
                }
            }
            let rect = rect.unwrap_or_else(|| {
                let offset = (windows.len() % 8) as i32;
                let x = 48 + 32 * offset;
                Rect {
                    x,
                    y: x,
                    width: definition.window_size.map_or(880, |size| size.width as u32),
                    height: definition.window_size.map_or(600, |size| size.height as u32),
                }
            });
            let now = timestamp();
            let window = AppWindow {
                id: Uuid::new_v4().to_string(),
                desktop_id: desktop_id.clone(),
                app_id: app.id,
                app_version: app.current_version,
                rect,
                z,
                minimized: false,
                maximized: false,
                state: definition.state,
                created_at: now.clone(),
                updated_at: now,
            };
            state.shared.windows.push(window.clone());
            state.device.active_workspace_id = Some(desktop.workspace_id.clone());
            state
                .device
                .active_desktop_ids
                .insert(desktop.workspace_id.clone(), desktop.id.clone());
            Ok(CoreReply::WindowOpen { window })
        }
        CoreRequest::WindowSetRect { window_id, rect } => {
            let window = state
                .shared
                .windows
                .iter_mut()
                .find(|window| window.id == window_id)
                .ok_or_else(|| {
                    errors::DESK_WINDOW_SET_RECT_NOT_FOUND()
                        .and_details(vec![format!("window_id: {}", &window_id)])
                })?;
            window.rect = rect;
            window.maximized = false;
            window.updated_at = timestamp();
            Ok(CoreReply::WindowSetRect {
                window: window.clone(),
            })
        }
        CoreRequest::WindowRaise { window_id } => {
            let desktop_id = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == window_id)
                .map(|window| window.desktop_id.clone())
                .ok_or_else(|| {
                    errors::DESK_WINDOW_RAISE_NOT_FOUND()
                        .and_details(vec![format!("window_id: {}", &window_id)])
                })?;
            let z = state
                .shared
                .windows
                .iter()
                .filter(|window| window.desktop_id == desktop_id)
                .map(|window| window.z)
                .max()
                .unwrap_or(0)
                .saturating_add(1);
            let window = state
                .shared
                .windows
                .iter_mut()
                .find(|window| window.id == window_id)
                .unwrap();
            window.z = z;
            window.minimized = false;
            window.updated_at = timestamp();
            Ok(CoreReply::WindowRaise {
                window: window.clone(),
            })
        }
        CoreRequest::WindowMinimize { window_id } => {
            let window = state
                .shared
                .windows
                .iter_mut()
                .find(|window| window.id == window_id)
                .ok_or_else(|| {
                    errors::DESK_WINDOW_MINIMIZE_NOT_FOUND()
                        .and_details(vec![format!("window_id: {}", &window_id)])
                })?;
            window.minimized = true;
            window.updated_at = timestamp();
            Ok(CoreReply::WindowMinimize {
                window: window.clone(),
            })
        }
        CoreRequest::WindowMaximize { window_id } => {
            let desktop_id = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == window_id)
                .map(|window| window.desktop_id.clone())
                .ok_or_else(|| {
                    errors::DESK_WINDOW_MAXIMIZE_NOT_FOUND()
                        .and_details(vec![format!("window_id: {}", &window_id)])
                })?;
            let z = state
                .shared
                .windows
                .iter()
                .filter(|window| window.desktop_id == desktop_id)
                .map(|window| window.z)
                .max()
                .unwrap_or(0)
                .saturating_add(1);
            let window = state
                .shared
                .windows
                .iter_mut()
                .find(|window| window.id == window_id)
                .unwrap();
            window.maximized = true;
            window.minimized = false;
            window.z = z;
            window.updated_at = timestamp();
            Ok(CoreReply::WindowMaximize {
                window: window.clone(),
            })
        }
        CoreRequest::WindowRestore { window_id } => {
            let desktop_id = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == window_id)
                .map(|window| window.desktop_id.clone())
                .ok_or_else(|| {
                    errors::DESK_WINDOW_RESTORE_NOT_FOUND()
                        .and_details(vec![format!("window_id: {}", &window_id)])
                })?;
            let z = state
                .shared
                .windows
                .iter()
                .filter(|window| window.desktop_id == desktop_id)
                .map(|window| window.z)
                .max()
                .unwrap_or(0)
                .saturating_add(1);
            let window = state
                .shared
                .windows
                .iter_mut()
                .find(|window| window.id == window_id)
                .unwrap();
            window.maximized = false;
            window.minimized = false;
            window.z = z;
            window.updated_at = timestamp();
            Ok(CoreReply::WindowRestore {
                window: window.clone(),
            })
        }
        CoreRequest::WindowClose { window_id } => {
            let desktop_id = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == window_id)
                .map(|window| window.desktop_id.clone())
                .ok_or_else(|| {
                    errors::DESK_WINDOW_CLOSE_NOT_FOUND()
                        .and_details(vec![format!("window_id: {}", &window_id)])
                })?;
            let before = state.shared.windows.len();
            state.shared.windows.retain(|window| window.id != window_id);
            if state.shared.windows.len() != before {
                if let Some(desktop) = state
                    .shared
                    .desktops
                    .iter_mut()
                    .find(|desktop| desktop.id == desktop_id)
                {
                    let old_context = desktop.last_sent_context.clone();
                    for contexts in desktop.last_sent_context.values_mut() {
                        if let Some(context) = contexts.get_mut(&window_id) {
                            context.visual_hash = None;
                        }
                        contexts.retain(|_, context| {
                            context.app_name.is_some()
                                || context.text.is_some()
                                || context.visual_hash.is_some()
                        });
                    }
                    desktop
                        .last_sent_context
                        .retain(|_, contexts| !contexts.is_empty());
                    if desktop.last_sent_context != old_context {
                        desktop.updated_at = timestamp();
                    }
                }
            }
            state
                .device
                .grants
                .retain(|grant| grant.window_id != window_id);
            Ok(CoreReply::WindowClose {})
        }
        CoreRequest::WindowSetState {
            window_id,
            state: next,
        } => Ok(CoreReply::WindowSetState {
            window: set_window_state(state, &window_id, next)?,
        }),
        CoreRequest::WindowPatchState { window_id, patch } => {
            let mut next = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == window_id)
                .ok_or_else(|| {
                    errors::DESK_WINDOW_STATE_WINDOW_NOT_FOUND()
                        .and_details(vec![format!("window_id: {window_id}")])
                })?
                .state
                .clone();
            next.extend(patch);
            Ok(CoreReply::WindowPatchState {
                window: set_window_state(state, &window_id, next)?,
            })
        }
        CoreRequest::AppImport { definition_json } => app_commands::import(state, definition_json),
        // 오케스트레이터 연결은 다음 PR(코어 연결 작업)에서 구현한다. 그 전까지는 서버 오류로 거부한다.
        CoreRequest::LinkStart { .. }
        | CoreRequest::LinkCancel {}
        | CoreRequest::LinkUnlink {}
        | CoreRequest::LinkUseLocal {}
        | CoreRequest::LinkSyncLocalToRemote {} => Err(errors::DESK_LINK_COMMAND_UNHANDLED()),
        CoreRequest::StateGet {}
        | CoreRequest::ConversationApplyStatus { .. }
        | CoreRequest::ConversationApplyRetry { .. }
        | CoreRequest::ConversationGet { .. }
        | CoreRequest::ConversationHistory { .. }
        | CoreRequest::ConversationCreate { .. }
        | CoreRequest::ConversationSwitch { .. }
        | CoreRequest::ConversationSend { .. }
        | CoreRequest::ConversationAttachment { .. }
        | CoreRequest::ConversationAttachmentOpen { .. }
        | CoreRequest::StorageGet { .. }
        | CoreRequest::StorageList { .. }
        | CoreRequest::StorageWrite { .. }
        | CoreRequest::StorageReset { .. }
        | CoreRequest::StorageMove { .. }
        | CoreRequest::FilesPickFolder { .. }
        | CoreRequest::FilesPrepareDefaultFolder { .. }
        | CoreRequest::FilesAllowDefaultFolder { .. }
        | CoreRequest::ClientFileOpen { .. }
        | CoreRequest::FilesAllowPc { .. }
        | CoreRequest::FilesOpen { .. }
        | CoreRequest::FilesList { .. }
        | CoreRequest::FilesRead { .. }
        | CoreRequest::FilesWrite { .. }
        | CoreRequest::FilesMkdir { .. }
        | CoreRequest::FilesRename { .. }
        | CoreRequest::FilesMove { .. }
        | CoreRequest::FilesCopy { .. }
        | CoreRequest::FilesRemove { .. }
        | CoreRequest::FilesReveal { .. }
        | CoreRequest::FilesPath { .. }
        | CoreRequest::WebAttach { .. }
        | CoreRequest::WebPlace { .. }
        | CoreRequest::WebNavigate { .. }
        | CoreRequest::WebHistory { .. }
        | CoreRequest::WebCapture { .. }
        | CoreRequest::WebDetach { .. }
        | CoreRequest::DataAttach { .. }
        | CoreRequest::DataDormant { .. }
        | CoreRequest::DataDetach { .. }
        | CoreRequest::DataRead { .. }
        | CoreRequest::DataAct { .. }
        | CoreRequest::DataRefresh { .. }
        | CoreRequest::DataMedia { .. }
        | CoreRequest::ConnectionLogin { .. }
        | CoreRequest::ShareSet { .. }
        | CoreRequest::ShareView { .. }
        | CoreRequest::ShareFreeze {}
        | CoreRequest::ShareCapture { .. }
        | CoreRequest::ShareUnfreeze {}
        | CoreRequest::UpdateRestart {} => Err(errors::DESK_STATE_COMMAND_UNHANDLED()),
        _ => Err(errors::DESK_STATE_COMMAND_UNHANDLED()),
    }
}

/// 서버에 올린 그림 참조를 그 데스크톱의 배경으로 저장한다.
pub(crate) fn store_wallpaper(
    state: &mut CoreState,
    wallpaper: DesktopWallpaper,
) -> Result<CoreReply, CoreError> {
    if !state
        .shared
        .desktops
        .iter()
        .any(|desktop| desktop.id == wallpaper.desktop_id)
    {
        return Err(errors::DESK_WALLPAPER_DESKTOP_NOT_FOUND()
            .and_details(vec![format!("desktop_id: {}", wallpaper.desktop_id)]));
    }
    if let Some(existing) = state
        .shared
        .desktop_wallpapers
        .iter_mut()
        .find(|existing| existing.id == wallpaper.id)
    {
        *existing = wallpaper.clone();
    } else {
        state.shared.desktop_wallpapers.push(wallpaper.clone());
    }
    Ok(CoreReply::DesktopWallpaperUpload { wallpaper })
}

pub(crate) fn active_desktop(state: &CoreState, workspace_id: &str) -> Option<String> {
    state
        .device
        .active_desktop_ids
        .get(workspace_id)
        .filter(|desktop_id| {
            state
                .shared
                .desktops
                .iter()
                .any(|desktop| desktop.id == **desktop_id && desktop.workspace_id == workspace_id)
        })
        .cloned()
        .or_else(|| {
            state
                .shared
                .desktops
                .iter()
                .filter(|desktop| desktop.workspace_id == workspace_id)
                .min_by_key(|desktop| desktop.position)
                .map(|desktop| desktop.id.clone())
        })
}
