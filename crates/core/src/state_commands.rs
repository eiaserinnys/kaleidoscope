use chrono::{SecondsFormat, Utc};
use uuid::Uuid;

use kaleidoscope_contract::{
    AppWindow, CoreError, CoreReply, CoreRequest, Desktop, ErrorCode, Rect, Workspace,
    WINDOW_STATE_MAX_BYTES,
};

use crate::app_commands;
use crate::error;
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
        created_at: now.clone(),
        updated_at: now,
    }
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
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            workspace.name = name;
            workspace.updated_at = timestamp();
            Ok(CoreReply::WorkspaceRename {
                workspace: workspace.clone(),
            })
        }
        CoreRequest::WorkspaceDelete { workspace_id } => {
            if state.shared.workspaces.len() <= 1 {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            let workspace = state
                .shared
                .workspaces
                .iter()
                .find(|workspace| workspace.id == workspace_id)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
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
                .device
                .grants
                .retain(|grant| !window_ids.contains(&grant.window_id));
            state.device.active_desktop_ids.remove(&workspace_id);
            if deleting_active {
                let active = state.shared.workspaces.first().unwrap();
                state.device.active_workspace_id = Some(active.id.clone());
                let desktop_id = active_desktop(state, &active.id)
                    .ok_or_else(|| error::make(ErrorCode::NotFound))?;
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
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let desktop_id = active_desktop(state, &workspace.id)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            state.device.active_workspace_id = Some(workspace.id.clone());
            state
                .device
                .active_desktop_ids
                .insert(workspace.id.clone(), desktop_id);
            Ok(CoreReply::WorkspaceActivate {})
        }
        CoreRequest::DesktopCreate { workspace_id, name } => {
            if !state
                .shared
                .workspaces
                .iter()
                .any(|workspace| workspace.id == workspace_id)
            {
                return Err(error::make(ErrorCode::NotFound));
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
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
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
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let desktop_count = state
                .shared
                .desktops
                .iter()
                .filter(|desktop| desktop.workspace_id == deleted.workspace_id)
                .count();
            if desktop_count <= 1 {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            let deleting_active = state
                .device
                .active_desktop_ids
                .get(&deleted.workspace_id)
                .is_some_and(|active| active == &desktop_id);
            let active_workspace =
                state.device.active_workspace_id.as_deref() == Some(deleted.workspace_id.as_str());
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
                    .ok_or_else(|| error::make(ErrorCode::NotFound))?;
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
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            state.device.active_workspace_id = Some(desktop.workspace_id.clone());
            state
                .device
                .active_desktop_ids
                .insert(desktop.workspace_id.clone(), desktop.id.clone());
            Ok(CoreReply::DesktopActivate {})
        }
        CoreRequest::FilesOpen { window_id, permission, path, app_id, rect } => {
            crate::files::open(state, &window_id, &permission, &path, &app_id, rect)
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
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let app = state
                .shared
                .apps
                .iter()
                .find(|app| app.id == app_id)
                .cloned()
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let definition =
                app_commands::definition_for(&state.shared, &app.id, app.current_version)
                    .ok_or_else(|| error::make(ErrorCode::NotFound))?;
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
            let rect = rect.unwrap_or_else(|| {
                let offset = (windows.len() % 8) as i32;
                let x = 48 + 32 * offset;
                Rect {
                    x,
                    y: x,
                    width: 880,
                    height: 600,
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
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            window.rect = rect;
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
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
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
            window.updated_at = timestamp();
            Ok(CoreReply::WindowRaise {
                window: window.clone(),
            })
        }
        CoreRequest::WindowClose { window_id } => {
            let before = state.shared.windows.len();
            state.shared.windows.retain(|window| window.id != window_id);
            if state.shared.windows.len() == before {
                return Err(error::make(ErrorCode::NotFound));
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
        } => {
            let (app_id, app_version) = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == window_id)
                .map(|window| (window.app_id.clone(), window.app_version))
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let definition = app_commands::definition_for(&state.shared, &app_id, app_version)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            if next.keys().any(|key| !definition.state.contains_key(key)) {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            let bytes =
                serde_json::to_vec(&next).map_err(|_| error::make(ErrorCode::InvalidRequest))?;
            if bytes.len() > WINDOW_STATE_MAX_BYTES {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            let window = state
                .shared
                .windows
                .iter_mut()
                .find(|window| window.id == window_id)
                .unwrap();
            window.state = next;
            window.updated_at = timestamp();
            Ok(CoreReply::WindowSetState {
                window: window.clone(),
            })
        }
        CoreRequest::AppImport { definition_json } => app_commands::import(state, definition_json),
        // 오케스트레이터 연결은 다음 PR(코어 연결 작업)에서 구현한다. 그 전까지는 서버 오류로 거부한다.
        CoreRequest::LinkStart {} | CoreRequest::LinkCancel {} | CoreRequest::LinkUnlink {} => {
            Err(error::make(ErrorCode::Server))
        }
        CoreRequest::AgentGet { .. }
        | CoreRequest::AgentCreate { .. }
        | CoreRequest::AgentSend { .. }
        | CoreRequest::AgentAttachment { .. }
        | CoreRequest::AgentAttachmentOpen { .. } => Err(error::make(ErrorCode::InvalidRequest)),
        CoreRequest::StateGet {}
        | CoreRequest::FilesPickFolder { .. }
        | CoreRequest::FilesList { .. }
        | CoreRequest::FilesRead { .. }
        | CoreRequest::FilesWrite { .. }
        | CoreRequest::WebAttach { .. }
        | CoreRequest::WebPlace { .. }
        | CoreRequest::WebNavigate { .. }
        | CoreRequest::WebHistory { .. }
        | CoreRequest::WebCapture { .. }
        | CoreRequest::WebDetach { .. }
        | CoreRequest::DataAttach { .. }
        | CoreRequest::DataDetach { .. }
        | CoreRequest::DataAct { .. }
        | CoreRequest::DataRefresh { .. }
        | CoreRequest::DataMedia { .. }
        | CoreRequest::ConnectionLogin { .. } => Err(error::make(ErrorCode::InvalidRequest)),
    }
}

fn active_desktop(state: &CoreState, workspace_id: &str) -> Option<String> {
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
