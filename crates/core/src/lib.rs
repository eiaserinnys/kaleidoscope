mod agent_commands;
mod app_commands;
mod connections;
mod data_runtime;
mod data_sources;
mod error;
mod files;
mod layout_reporter;
mod link;
mod logins;
mod media;
mod oauth;
mod registry_client;
mod registry_events;
mod state_commands;
mod storage;

#[cfg(test)]
mod logins_tests;

#[cfg(test)]
mod tests;

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Condvar, Mutex};

use kaleidoscope_contract::{
    CoreError, CoreEvent, CoreReply, CoreRequest, DeviceState, Grant, LinkStatus, SharedState,
    ShellSnapshot,
};
use registry_client::{HttpRegistryClient, RegistryClient};

pub use kaleidoscope_contract;

pub trait Host: Send + Sync + 'static {
    /// 폴더 고르기 창을 띄우고 고른 폴더의 절대 경로를 돌려준다. 취소하면 None이다.
    fn pick_folder(&self) -> Option<PathBuf>;

    /// 기본 브라우저에서 OAuth 인가 주소를 연다.
    fn open_url(&self, url: &str) -> io::Result<()> {
        opener::open_browser(url).map_err(|error| io::Error::other(error.to_string()))
    }
}

pub(crate) trait AttachmentOpener: Send + Sync + 'static {
    fn open(&self, path: &Path) -> io::Result<()>;
    fn reveal(&self, path: &Path) -> io::Result<()>;
}

pub(crate) struct SystemAttachmentOpener;

impl AttachmentOpener for SystemAttachmentOpener {
    fn open(&self, path: &Path) -> io::Result<()> {
        opener::open(path).map_err(|error| io::Error::other(error.to_string()))
    }

    fn reveal(&self, path: &Path) -> io::Result<()> {
        opener::reveal(path).map_err(|error| io::Error::other(error.to_string()))
    }
}

pub struct CoreConfig {
    pub data_dir: PathBuf,
    pub seed_definitions: Vec<String>,
    pub server_url: String,
    pub device_name: String,
}

#[derive(Clone, PartialEq)]
pub(crate) struct CoreState {
    pub(crate) shared: SharedState,
    pub(crate) device: DeviceState,
    pub(crate) link: LinkStatus,
}

pub(crate) struct Inner {
    pub(crate) data_dir: PathBuf,
    pub(crate) state: Mutex<CoreState>,
    pub(crate) host: Arc<dyn Host>,
    pub(crate) listeners: Mutex<Vec<Arc<dyn Fn(&CoreEvent) + Send + Sync>>>,
    pub(crate) server_url: String,
    pub(crate) device_name: String,
    pub(crate) registry: Arc<dyn RegistryClient>,
    pub(crate) attachment_opener: Arc<dyn AttachmentOpener>,
    pub(crate) link_file: Mutex<Option<storage::LinkFile>>,
    pub(crate) generation: AtomicU64,
    pub(crate) layout_connection_epoch: AtomicU64,
    pub(crate) layout_reported_epoch: Mutex<Option<u64>>,
    pub(crate) layout_signal: LayoutSignal,
    pub(crate) data_runtimes: data_runtime::DataRuntimes,
    pub(crate) connections: Mutex<Vec<kaleidoscope_contract::registry::ConnectionInfo>>,
    pub(crate) login_store: Arc<logins::Logins>,
    pub(crate) login_in_progress: Mutex<HashSet<String>>,
    pub(crate) media_cache: media::MediaCache,
}

pub(crate) struct LayoutSignal {
    sequence: Mutex<u64>,
    changed: Condvar,
}

impl LayoutSignal {
    pub(crate) fn notify(&self) {
        let mut sequence = self.sequence.lock().unwrap();
        *sequence = sequence.wrapping_add(1);
        self.changed.notify_all();
    }

    pub(crate) fn sequence(&self) -> u64 {
        *self.sequence.lock().unwrap()
    }

    pub(crate) fn wait_after(&self, sequence: u64, duration: std::time::Duration) -> u64 {
        let current = self.sequence.lock().unwrap();
        if *current != sequence {
            return *current;
        }
        let (current, _) = self
            .changed
            .wait_timeout_while(current, duration, |current| *current == sequence)
            .unwrap();
        *current
    }
}

pub struct Core {
    inner: Arc<Inner>,
}

impl Core {
    pub fn open(config: CoreConfig, host: Arc<dyn Host>) -> Result<Core, CoreError> {
        let registry = Arc::new(HttpRegistryClient::new());
        Self::open_with_client(config, host, registry)
    }

    fn open_with_client(
        config: CoreConfig,
        host: Arc<dyn Host>,
        registry: Arc<dyn RegistryClient>,
    ) -> Result<Core, CoreError> {
        Self::open_with_client_and_opener(config, host, registry, Arc::new(SystemAttachmentOpener))
    }

    fn open_with_client_and_opener(
        config: CoreConfig,
        host: Arc<dyn Host>,
        registry: Arc<dyn RegistryClient>,
        attachment_opener: Arc<dyn AttachmentOpener>,
    ) -> Result<Core, CoreError> {
        fs::create_dir_all(&config.data_dir).map_err(|error| error::io_error(&error))?;

        let link_file = storage::load_link(&config.data_dir)?;
        let link = link_file
            .as_ref()
            .map_or(LinkStatus::Unlinked {}, |file| LinkStatus::Offline {
                server_url: file.server_url.clone(),
                device_name: file.device_name.clone(),
                reason: "연결하는 중".into(),
            });
        let mut state = CoreState {
            shared: storage::load_shared(&config.data_dir)?,
            device: storage::load_device(&config.data_dir)?,
            link,
        };
        let login_store = Arc::new(logins::Logins::open(&config.data_dir)?);

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

        let inner = Arc::new(Inner {
            data_dir: config.data_dir,
            state: Mutex::new(state),
            host,
            listeners: Mutex::new(Vec::new()),
            server_url: config.server_url,
            device_name: config.device_name,
            registry,
            attachment_opener,
            link_file: Mutex::new(link_file.clone()),
            generation: AtomicU64::new(0),
            layout_connection_epoch: AtomicU64::new(0),
            layout_reported_epoch: Mutex::new(None),
            layout_signal: LayoutSignal {
                sequence: Mutex::new(0),
                changed: Condvar::new(),
            },
            data_runtimes: data_runtime::DataRuntimes::default(),
            connections: Mutex::new(Vec::new()),
            login_store,
            login_in_progress: Mutex::new(HashSet::new()),
            media_cache: media::MediaCache::default(),
        });
        {
            let state = inner.state.lock().unwrap();
            storage::save_state(&inner.data_dir, &state.shared, &state.device)?;
        }

        let core = Core { inner };
        data_runtime::start_timer(Arc::downgrade(&core.inner));
        if core.inner.state.lock().unwrap().shared.apps.is_empty() {
            for definition_json in config.seed_definitions {
                core.handle(CoreRequest::AppImport { definition_json })?;
            }
        }
        if let Some(file) = link_file {
            link::start_stream(Arc::clone(&core.inner), 0, file);
        }

        Ok(core)
    }

    pub fn handle(&self, request: CoreRequest) -> Result<CoreReply, CoreError> {
        match request {
            CoreRequest::StateGet {} => {
                let state = self.inner.state.lock().unwrap();
                Ok(CoreReply::StateGet {
                    snapshot: snapshot(&state),
                })
            }
            CoreRequest::LinkStart {} => link::start(&self.inner),
            CoreRequest::LinkCancel {} => link::cancel(&self.inner),
            CoreRequest::LinkUnlink {} => link::unlink(&self.inner),
            CoreRequest::AppImport { definition_json } => {
                link::import_app(&self.inner, definition_json)
            }
            request @ (CoreRequest::AgentGet { .. }
            | CoreRequest::AgentCreate { .. }
            | CoreRequest::AgentSend { .. }
            | CoreRequest::AgentAttachment { .. }
            | CoreRequest::AgentAttachmentOpen { .. }) => link::handle_agent(&self.inner, request),
            CoreRequest::FilesList {
                window_id,
                permission,
                dir,
            } => {
                let state = self.inner.state.lock().unwrap();
                files::list(&state, &window_id, &permission, &dir)
            }
            CoreRequest::FilesRead {
                window_id,
                permission,
                path,
            } => {
                let state = self.inner.state.lock().unwrap();
                files::read(&state, &window_id, &permission, &path)
            }
            CoreRequest::FilesWrite {
                window_id,
                permission,
                path,
                text,
                expected_revision,
            } => {
                let state = self.inner.state.lock().unwrap();
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
            // 계약 5판의 탐색기 열기와 웹 화면은 다음 PR(코어 구현)에서 채운다. 그 전까지는 쓸 수 없다고 답한다.
            CoreRequest::FilesOpen { .. }
            | CoreRequest::WebAttach { .. }
            | CoreRequest::WebPlace { .. }
            | CoreRequest::WebNavigate { .. }
            | CoreRequest::WebHistory { .. }
            | CoreRequest::WebCapture { .. }
            | CoreRequest::WebDetach { .. } => {
                Err(error::make(kaleidoscope_contract::ErrorCode::Unavailable))
            }
            CoreRequest::DataAttach { window_id } => data_runtime::attach(&self.inner, &window_id),
            CoreRequest::DataDetach { window_id } => data_runtime::detach(&self.inner, &window_id),
            CoreRequest::DataAct {
                window_id,
                pointer,
                event,
                item,
            } => data_runtime::act(&self.inner, &window_id, &pointer, event, item),
            CoreRequest::DataRefresh { window_id, sources } => {
                data_runtime::refresh(&self.inner, &window_id, &sources, false)?;
                Ok(CoreReply::DataRefresh {})
            }
            CoreRequest::DataMedia {
                window_id,
                media,
                max_px,
            } => Ok(CoreReply::DataMedia {
                media: media::get(&self.inner, &window_id, &media, max_px)?,
            }),
            CoreRequest::ConnectionLogin {
                window_id,
                permission,
            } => connections::login(&self.inner, &window_id, &permission),
            request => self.handle_state_change(request),
        }
    }

    pub fn subscribe(&self, listener: Box<dyn Fn(&CoreEvent) + Send + Sync>) {
        self.inner
            .listeners
            .lock()
            .unwrap()
            .push(Arc::from(listener));
    }

    fn handle_state_change(&self, request: CoreRequest) -> Result<CoreReply, CoreError> {
        self.apply_state_change(|state| state_commands::handle(state, request))
    }

    fn set_state_key(
        &self,
        window_id: &str,
        key: String,
        value: serde_json::Value,
    ) -> Result<CoreReply, CoreError> {
        self.apply_state_change(|state| {
            let mut next = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == window_id)
                .ok_or_else(|| error::make(kaleidoscope_contract::ErrorCode::NotFound))?
                .state
                .clone();
            next.insert(key, value);
            state_commands::handle(
                state,
                CoreRequest::WindowSetState {
                    window_id: window_id.into(),
                    state: next,
                },
            )
        })
    }

    fn apply_state_change(
        &self,
        change: impl FnOnce(&mut CoreState) -> Result<CoreReply, CoreError>,
    ) -> Result<CoreReply, CoreError> {
        let mut state = self.inner.state.lock().unwrap();
        let before = state.clone();
        let reply = change(&mut state)?;
        let shared_changed = before.shared != state.shared;
        let device_changed = before.device != state.device;

        if shared_changed || device_changed {
            if let Err(error) = storage::save_changed_state(
                &self.inner.data_dir,
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
        self.inner.emit(&event);

        Ok(reply)
    }

    fn pick_folder(&self, window_id: &str, permission: &str) -> Result<CoreReply, CoreError> {
        {
            let state = self.inner.state.lock().unwrap();
            files::permission(&state, window_id, permission, false)?;
        }

        let Some(selected_path) = self.inner.host.pick_folder() else {
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

        let mut state = self.inner.state.lock().unwrap();
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

        if let Err(error) = storage::save_changed_state(
            &self.inner.data_dir,
            &state.shared,
            &state.device,
            false,
            true,
        ) {
            *state = before;
            return Err(error);
        }
        let event = CoreEvent::StateChanged {
            snapshot: snapshot(&state),
        };
        drop(state);
        self.inner.emit(&event);
        data_runtime::grant_changed(&self.inner, window_id, permission);

        Ok(CoreReply::FilesPickFolder { grant: Some(grant) })
    }
}

impl Inner {
    pub(crate) fn emit(self: &Arc<Self>, event: &CoreEvent) {
        if matches!(event, CoreEvent::StateChanged { .. }) {
            self.layout_signal.notify();
        }
        let listeners = self.listeners.lock().unwrap().clone();
        for listener in listeners {
            listener(event);
        }
        if matches!(event, CoreEvent::StateChanged { .. }) {
            data_runtime::state_changed(self);
        }
    }
}

pub(crate) fn snapshot(state: &CoreState) -> ShellSnapshot {
    ShellSnapshot {
        shared: state.shared.clone(),
        device: state.device.clone(),
        supported: kaleidoscope_contract::Supported::current(),
        link: state.link.clone(),
    }
}
