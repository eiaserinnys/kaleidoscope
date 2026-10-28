mod app_commands;
mod app_definition;
mod error;
mod files;
mod state_commands;
mod storage;

#[cfg(test)]
mod tests;

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use kaleidoscope_contract::{
    CoreError, CoreEvent, CoreReply, CoreRequest, DeviceState, Grant, SharedState, ShellSnapshot,
};

pub use kaleidoscope_contract;

pub trait Host: Send + Sync + 'static {
    /// 폴더 고르기 창을 띄우고 고른 폴더의 절대 경로를 돌려준다. 취소하면 None이다.
    fn pick_folder(&self) -> Option<PathBuf>;
}

pub struct CoreConfig {
    pub data_dir: PathBuf,
    pub seed_definitions: Vec<String>,
}

#[derive(Clone, PartialEq)]
pub(crate) struct CoreState {
    pub(crate) shared: SharedState,
    pub(crate) device: DeviceState,
}

pub struct Core {
    data_dir: PathBuf,
    state: Mutex<CoreState>,
    host: Arc<dyn Host>,
    listeners: Mutex<Vec<Arc<dyn Fn(&CoreEvent) + Send + Sync>>>,
}

impl Core {
    pub fn open(config: CoreConfig, host: Arc<dyn Host>) -> Result<Core, CoreError> {
        fs::create_dir_all(&config.data_dir).map_err(|error| error::io_error(&error))?;

        let mut state = CoreState {
            shared: storage::load_shared(&config.data_dir)?,
            device: storage::load_device(&config.data_dir)?,
        };

        if state.shared.workspaces.is_empty() {
            let now = state_commands::timestamp();
            let workspace = state_commands::new_workspace("작업 1".into(), now.clone());
            let desktop =
                state_commands::new_desktop(workspace.id.clone(), "데스크톱 1".into(), 0, now);
            state.device.active_workspace_id = Some(workspace.id.clone());
            state
                .device
                .active_desktop_ids
                .insert(workspace.id.clone(), desktop.id.clone());
            state.shared.workspaces.push(workspace);
            state.shared.desktops.push(desktop);
        }

        let core = Core {
            data_dir: config.data_dir,
            state: Mutex::new(state),
            host,
            listeners: Mutex::new(Vec::new()),
        };
        {
            let state = core.state.lock().unwrap();
            storage::save_state(&core.data_dir, &state.shared, &state.device)?;
        }

        if core.state.lock().unwrap().shared.apps.is_empty() {
            for definition_json in config.seed_definitions {
                core.handle(CoreRequest::AppImport { definition_json })?;
            }
        }

        Ok(core)
    }

    pub fn handle(&self, request: CoreRequest) -> Result<CoreReply, CoreError> {
        match request {
            CoreRequest::StateGet {} => {
                let state = self.state.lock().unwrap();
                Ok(CoreReply::StateGet {
                    snapshot: snapshot(&state),
                })
            }
            CoreRequest::FilesList {
                window_id,
                permission,
                dir,
            } => {
                let state = self.state.lock().unwrap();
                files::list(&state, &window_id, &permission, &dir)
            }
            CoreRequest::FilesRead {
                window_id,
                permission,
                path,
            } => {
                let state = self.state.lock().unwrap();
                files::read(&state, &window_id, &permission, &path)
            }
            CoreRequest::FilesWrite {
                window_id,
                permission,
                path,
                text,
                expected_revision,
            } => {
                let state = self.state.lock().unwrap();
                files::write(
                    &state,
                    &window_id,
                    &permission,
                    &path,
                    &text,
                    expected_revision.as_deref(),
                )
            }
            CoreRequest::FilesPickFolder {
                window_id,
                permission,
            } => self.pick_folder(&window_id, &permission),
            request => self.handle_state_change(request),
        }
    }

    pub fn subscribe(&self, listener: Box<dyn Fn(&CoreEvent) + Send + Sync>) {
        self.listeners.lock().unwrap().push(Arc::from(listener));
    }

    fn handle_state_change(&self, request: CoreRequest) -> Result<CoreReply, CoreError> {
        let mut state = self.state.lock().unwrap();
        let before = state.clone();
        let reply = state_commands::handle(&mut state, request)?;
        let shared_changed = before.shared != state.shared;
        let device_changed = before.device != state.device;

        if shared_changed || device_changed {
            if let Err(error) = storage::save_changed_state(
                &self.data_dir,
                &state.shared,
                &state.device,
                shared_changed,
                device_changed,
            ) {
                *state = before;
                return Err(error);
            }
        }

        let event = CoreEvent::StateChanged {
            snapshot: snapshot(&state),
        };
        drop(state);
        self.emit(&event);

        Ok(reply)
    }

    fn pick_folder(&self, window_id: &str, permission: &str) -> Result<CoreReply, CoreError> {
        {
            let state = self.state.lock().unwrap();
            files::permission(&state, window_id, permission, false)?;
        }

        let Some(selected_path) = self.host.pick_folder() else {
            return Ok(CoreReply::FilesPickFolder { grant: None });
        };
        let root_path = fs::canonicalize(selected_path).map_err(|error| error::io_error(&error))?;
        if !root_path.is_dir() {
            return Err(error::make(kaleidoscope_contract::ErrorCode::Io));
        }
        let root_name = root_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| root_path.display().to_string());

        let mut state = self.state.lock().unwrap();
        files::permission(&state, window_id, permission, false)?;
        let before = state.clone();
        let grant = Grant {
            window_id: window_id.to_string(),
            permission: permission.to_string(),
            root_path: root_path.to_string_lossy().into_owned(),
            root_name,
            granted_at: state_commands::timestamp(),
        };
        state.device.grants.retain(|existing| {
            existing.window_id != window_id || existing.permission != permission
        });
        state.device.grants.push(grant.clone());

        if let Err(error) =
            storage::save_changed_state(&self.data_dir, &state.shared, &state.device, false, true)
        {
            *state = before;
            return Err(error);
        }
        let event = CoreEvent::StateChanged {
            snapshot: snapshot(&state),
        };
        drop(state);
        self.emit(&event);

        Ok(CoreReply::FilesPickFolder { grant: Some(grant) })
    }

    fn emit(&self, event: &CoreEvent) {
        let listeners = self.listeners.lock().unwrap().clone();
        for listener in listeners {
            listener(event);
        }
    }
}

fn snapshot(state: &CoreState) -> ShellSnapshot {
    ShellSnapshot {
        shared: state.shared.clone(),
        device: state.device.clone(),
        supported: kaleidoscope_contract::Supported::current(),
    }
}
