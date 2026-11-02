// 기존 코어의 상태와 명령 진입점이 한 파일에 모여 있어 500줄을 넘는다.
mod app_commands;
mod app_storage;
mod attachment;
pub mod builtin;
mod connections;
mod conversation;
mod conversation_context;
mod conversation_http;
mod conversation_reconcile;
mod conversation_send;
mod conversation_stream;
mod data_runtime;
mod data_sources;
mod error;
mod files;
mod layout_apply;
mod layout_reporter;
mod layout_sync;
mod link;
mod logins;
mod media;
mod oauth;
mod profiler;
mod registry_client;
mod registry_events;
mod share;
mod state_commands;
mod state_events;
mod storage;
mod sync_state;
mod web;

#[cfg(test)]
mod logins_tests;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod update_tests;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Condvar, Mutex};

use kaleidoscope_contract::{
    CoreError, CoreEvent, CoreReply, CoreRequest, DeviceState, ErrorCode, Grant, LinkStatus,
    PcRootKind, Rect, SharedState, ShellSnapshot, UpdateStatus, WebHistoryAction, WebPage,
};
use registry_client::{HttpRegistryClient, RegistryClient};

pub use kaleidoscope_contract;
mod client_files;

/// 쉘 PNG에서 창이 보이는 자리를 잘라 같이 보기 첨부용 PNG로 만든다.
pub fn crop_share_capture_png(bytes: &[u8], bounds: Rect, scale_factor: f64) -> Option<Vec<u8>> {
    share::prepare_png(bytes, Some((bounds, scale_factor))).map(|(png, _)| png)
}

pub trait Host: Send + Sync + 'static {
    /// 폴더 고르기 창을 띄우고 고른 폴더의 절대 경로를 돌려준다. 취소하면 None이다.
    fn pick_folder(&self) -> Option<PathBuf>;
    fn pick_files(
        &self,
        _accept: &[kaleidoscope_contract::data::FileAccept],
        _multiple: bool,
    ) -> Option<Vec<PathBuf>> {
        None
    }
    fn pick_save_file(&self, _suggested_name: &str, _mime: &str) -> Option<PathBuf> {
        None
    }
    fn pc_roots(&self) -> Vec<PcRoot> {
        Vec::new()
    }
    /// 기본 브라우저에서 OAuth 인가 주소를 연다.
    fn open_url(&self, url: &str) -> io::Result<()> {
        opener::open_browser(url).map_err(|error| io::Error::other(error.to_string()))
    }
    fn web(&self) -> Option<&dyn WebHost> {
        None
    }
    fn updater(&self) -> Option<&dyn UpdateHost> {
        None
    }
}

/// 절대 경로는 코어 내부에서만 쓴다.
#[derive(Debug, Clone)]
pub struct PcRoot {
    pub id: String,
    pub kind: PcRootKind,
    pub name: String,
    pub path: PathBuf,
}

/// 준비된 설치본을 검증하고 설치한다.
pub trait UpdateHost: Send + Sync + 'static {
    fn install(&self) -> Result<(), String>;
}

/// 플랫폼 웹뷰의 수명과 조작. 페이지 변화는 Core::web_update로 알린다.
pub trait WebHost: Send + Sync + 'static {
    fn attach(&self, window_id: &str, url: &str) -> Result<WebPage, CoreError>;
    fn place(&self, window_id: &str, bounds: Option<Rect>) -> Result<(), CoreError>;
    fn navigate(&self, window_id: &str, url: &str) -> Result<(), CoreError>;
    fn history(&self, window_id: &str, action: WebHistoryAction) -> Result<(), CoreError>;
    fn capture(&self, window_id: &str) -> Result<Option<Vec<u8>>, CoreError>;
    /// 쉘 메인 웹뷰의 PNG와 CSS px당 픽셀 배율. 개발용 호스트는 캡처를 생략할 수 있다.
    fn capture_shell(&self) -> Result<Option<(Vec<u8>, f64)>, CoreError> {
        Ok(None)
    }
    /// 화면의 현재 구성을 고정해 격리 캡처 중 외부에 변화가 보이지 않게 한다.
    fn freeze(&self) -> Result<bool, CoreError> {
        Ok(false)
    }
    /// `freeze`로 고정한 화면을 원상 복구한다.
    fn unfreeze(&self) -> Result<(), CoreError> {
        Ok(())
    }
    fn detach(&self, window_id: &str) -> Result<(), CoreError>;
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

#[derive(Debug, Clone)]
pub struct EmbeddedServerInfo {
    pub server_url: String,
    pub device_id: String,
    pub token: String,
}

pub struct CoreConfig {
    pub embedded_server: Option<EmbeddedServerInfo>,
    pub data_dir: PathBuf,
    pub seed_definitions: Vec<String>,
    pub server_url: String,
    pub device_name: String,
}

#[derive(Clone, PartialEq)]
pub(crate) struct CoreState {
    pub(crate) last_transfer: Option<kaleidoscope_contract::transfer::TransferResult>,
    pub(crate) transfer_error: Option<String>,
    pub(crate) embedded_available: bool,
    pub(crate) shared: SharedState,
    pub(crate) device: DeviceState,
    pub(crate) link: LinkStatus,
    pub(crate) update: UpdateStatus,
    pub(crate) sync: sync_state::SyncState,
    pub(crate) share: share::ShareState,
}

pub(crate) struct Inner {
    pub(crate) embedded_server: Option<EmbeddedServerInfo>,
    pub(crate) data_dir: PathBuf,
    pub(crate) state: Mutex<CoreState>,
    pub(crate) flusher: storage::StorageFlusher,
    pub(crate) profiler: profiler::Profiler,
    pub(crate) host: Arc<dyn Host>,
    pub(crate) pc_roots: Mutex<Vec<PcRoot>>,
    pub(crate) listeners: Mutex<Vec<Arc<dyn Fn(&CoreEvent) + Send + Sync>>>,
    state_events: state_events::StateEvents,
    pub(crate) server_url: String,
    pub(crate) device_name: String,
    pub(crate) registry: Arc<dyn RegistryClient>,
    pub(crate) attachment_opener: Arc<dyn AttachmentOpener>,
    pub(crate) link_file: Mutex<Option<storage::LinkFile>>,
    pub(crate) generation: AtomicU64,
    pub(crate) layout_connection_epoch: AtomicU64,
    pub(crate) layout_reported_epoch: Mutex<Option<u64>>,
    pub(crate) layout_synced_epoch: Mutex<Option<u64>>,
    pub(crate) conversation_snapshot_epoch: AtomicU64,
    pub(crate) conversation_workspace_sync_waiting: AtomicBool,
    pub(crate) conversation_reconcile: conversation_reconcile::Runtime,
    pub(crate) layout_signal: LayoutSignal,
    pub(crate) data_runtimes: data_runtime::DataRuntimes,
    pub(crate) local_agents: local_agent::LocalAgents,
    pub(crate) conversation_streams: conversation_stream::Streams,
    pub(crate) conversation_sends: Mutex<HashSet<String>>,
    pub(crate) isolated_captures: Mutex<HashMap<String, share::IsolatedCapture>>,
    pub(crate) connections: Mutex<Vec<kaleidoscope_contract::registry::ConnectionInfo>>,
    pub(crate) login_store: Arc<logins::Logins>,
    pub(crate) login_in_progress: Mutex<HashSet<String>>,
    pub(crate) media_cache: media::MediaCache,
    pub(crate) client_files: client_files::ClientFiles,
    pub(crate) web_attached: Mutex<std::collections::HashSet<String>>,
    pub(crate) web_follow: Mutex<HashMap<String, std::time::Instant>>,
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
    owner: bool,
}

impl Drop for Core {
    fn drop(&mut self) {
        if self.owner {
            local_agent::shutdown(&self.inner);
            if let Err(err) = self.flush_storage() {
                eprintln!("상태를 저장할 수 없습니다: {}", err.message);
            }
            self.inner.flusher.stop();
        }
    }
}

impl Core {
    /// 쉘의 최소화 상태를 데이터 원천 실행에 반영한다.
    pub fn set_shell_visible(&self, visible: bool) {
        data_runtime::set_shell_visible(&self.inner, visible);
    }

    pub fn shell_visible(&self) -> bool {
        self.inner
            .data_runtimes
            .shell_visible
            .load(std::sync::atomic::Ordering::SeqCst)
    }
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
        let started = std::time::Instant::now();
        fs::create_dir_all(&config.data_dir).map_err(|error| error::io_error(&error))?;

        let link_file = server_switch::startup_link(&config)?;
        let link = link_file.as_ref().map_or(LinkStatus::Unlinked {}, |file| {
            if file.revoked {
                LinkStatus::Revoked {
                    server_url: file.server_url.clone(),
                }
            } else {
                LinkStatus::Offline {
                    mode: file.mode,
                    server_url: file.server_url.clone(),
                    device_name: file.device_name.clone(),
                    reason: "연결하는 중".into(),
                }
            }
        });
        let mut state = CoreState {
            last_transfer: None,
            transfer_error: None,
            embedded_available: config.embedded_server.is_some(),
            shared: storage::load_shared(&config.data_dir)?,
            device: storage::load_device(&config.data_dir)?,
            sync: sync_state::load(&config.data_dir, link_file.as_ref())?,
            link,
            share: share::ShareState::default(),
            update: UpdateStatus::Unavailable {},
        };
        layout_apply::reconcile(&mut state);
        state.share.active_shares = share::shared_window_ids(&state.shared);
        let before_builtin = state.shared.clone();
        app_commands::ensure_builtin(&mut state);
        if let Some(file) = &link_file {
            let before_sync = state.sync.clone();
            state.sync.mark_changes(&before_builtin, &state.shared);
            if state.sync != before_sync {
                state.sync.device_id = Some(file.device_id.clone());
                sync_state::save(&config.data_dir, &state.sync)?;
            }
        }
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
            embedded_server: config.embedded_server,
            data_dir: config.data_dir,
            state: Mutex::new(state),
            flusher: storage::StorageFlusher::default(),
            profiler: profiler::Profiler::default(),
            host,
            pc_roots: Mutex::new(Vec::new()),
            listeners: Mutex::new(Vec::new()),
            state_events: state_events::StateEvents::default(),
            server_url: config.server_url,
            device_name: config.device_name,
            registry,
            attachment_opener,
            link_file: Mutex::new(link_file.clone()),
            generation: AtomicU64::new(0),
            layout_connection_epoch: AtomicU64::new(0),
            layout_reported_epoch: Mutex::new(None),
            layout_synced_epoch: Mutex::new(None),
            conversation_snapshot_epoch: AtomicU64::new(0),
            conversation_workspace_sync_waiting: AtomicBool::new(false),
            conversation_reconcile: conversation_reconcile::Runtime::default(),
            web_attached: Mutex::new(std::collections::HashSet::new()),
            web_follow: Mutex::new(HashMap::new()),
            client_files: client_files::ClientFiles::default(),
            layout_signal: LayoutSignal {
                sequence: Mutex::new(0),
                changed: Condvar::new(),
            },
            data_runtimes: data_runtime::DataRuntimes::default(),
            local_agents: local_agent::LocalAgents::default(),
            conversation_streams: conversation_stream::Streams::default(),
            conversation_sends: Mutex::new(HashSet::new()),
            isolated_captures: Mutex::new(HashMap::new()),
            connections: Mutex::new(Vec::new()),
            login_store,
            login_in_progress: Mutex::new(HashSet::new()),
            media_cache: media::MediaCache::default(),
        });
        storage::start_flusher(&inner);
        local_agent::start_events(&inner);
        {
            let state = inner.state.lock().unwrap();
            storage::save_state(&inner.data_dir, &state.shared, &state.device)?;
        }

        inner.profiler.span(
            "command",
            "코어 시작",
            "",
            "",
            started.elapsed().as_secs_f64() * 1000.0,
            0,
            0,
            "초기 앱과 창 준비",
        );
        let core = Core { inner, owner: true };
        data_runtime::start_timer(Arc::downgrade(&core.inner));
        if core
            .inner
            .state
            .lock()
            .unwrap()
            .shared
            .apps
            .iter()
            .all(|app| kaleidoscope_contract::builtin::is_builtin(&app.id))
        {
            for definition_json in config.seed_definitions {
                let definition =
                    kaleidoscope_contract::validate::parse_app_definition(&definition_json)?;
                if kaleidoscope_contract::builtin::is_builtin(&definition.id) {
                    continue;
                }
                core.handle(CoreRequest::AppImport { definition_json })?;
            }
        }
        if let Some(file) = link_file.filter(|file| !file.revoked) {
            link::start_stream(Arc::clone(&core.inner), 0, file);
        }

        Ok(core)
    }

    pub fn handle(&self, request: CoreRequest) -> Result<CoreReply, CoreError> {
        let started = std::time::Instant::now();
        let (target, window_id) = match &request {
            CoreRequest::WindowSetState { window_id, .. } => ("window.set_state", Some(window_id)),
            CoreRequest::WindowSetRect { window_id, .. } => ("window.set_rect", Some(window_id)),
            CoreRequest::WindowRaise { window_id } => ("window.raise", Some(window_id)),
            CoreRequest::WindowMinimize { window_id } => ("window.minimize", Some(window_id)),
            CoreRequest::WindowMaximize { window_id } => ("window.maximize", Some(window_id)),
            CoreRequest::WindowRestore { window_id } => ("window.restore", Some(window_id)),
            CoreRequest::DataAct { window_id, .. } => ("data.act", Some(window_id)),
            CoreRequest::DataAttach { window_id, .. } => ("data.attach", Some(window_id)),
            CoreRequest::DataRefresh { window_id, .. } => ("data.refresh", Some(window_id)),
            _ => ("명령", None),
        };
        let (app_id, app_name) = window_id
            .and_then(|id| {
                let state = self.inner.state.lock().unwrap();
                let window = state.shared.windows.iter().find(|w| &w.id == id)?;
                let app = state.shared.apps.iter().find(|a| a.id == window.app_id)?;
                Some((app.id.clone(), app.name.clone()))
            })
            .unwrap_or_default();
        let result = self.handle_inner(request);
        self.inner.profiler.span(
            "command",
            target,
            &app_id,
            &app_name,
            started.elapsed().as_secs_f64() * 1000.0,
            0,
            0,
            "",
        );
        result
    }

    /// 사용자가 고른 파일을 원시 바이트로 읽는다.
    pub fn client_read_file(&self, window_id: &str, handle: &str) -> Result<Vec<u8>, CoreError> {
        client_files::read(&self.inner, window_id, handle)
    }

    /// 사용자가 고른 출력의 지정 위치에 원시 바이트를 쓴다.
    pub fn client_write_export(
        &self,
        window_id: &str,
        sink_id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<(), CoreError> {
        client_files::write(&self.inner, window_id, sink_id, offset, bytes)
    }

    fn handle_inner(&self, request: CoreRequest) -> Result<CoreReply, CoreError> {
        match request {
            CoreRequest::StateGet {} => {
                let state = self.inner.state.lock().unwrap();
                Ok(CoreReply::StateGet {
                    snapshot: snapshot(&state),
                })
            }
            CoreRequest::LinkStart { server_url } => link::start(&self.inner, server_url),
            CoreRequest::LinkUseLocal {} => server_switch::use_local(&self.inner),
            CoreRequest::LinkSyncLocalToRemote {} => server_switch::sync(&self.inner),
            CoreRequest::LinkCancel {} => link::cancel(&self.inner),
            CoreRequest::LinkUnlink {} => link::unlink(&self.inner),
            request @ (CoreRequest::ConversationApplyStatus { .. }
            | CoreRequest::ConversationApplyRetry { .. }) => {
                conversation_reconcile::handle(&self.inner, request)
            }
            CoreRequest::AppImport { definition_json } => {
                link::import_app(&self.inner, definition_json)
            }
            request @ (CoreRequest::ConversationGet { .. }
            | CoreRequest::ConversationHistory { .. }
            | CoreRequest::ConversationCreate { .. }
            | CoreRequest::ConversationSwitch { .. }
            | CoreRequest::ConversationSend { .. }
            | CoreRequest::ConversationAttachment { .. }
            | CoreRequest::ConversationAttachmentOpen { .. }) => {
                conversation::handle(&self.inner, request)
            }
            request @ (CoreRequest::StorageGet { .. }
            | CoreRequest::StorageList { .. }
            | CoreRequest::StorageWrite { .. }
            | CoreRequest::StorageReset { .. }
            | CoreRequest::StorageMove { .. }) => app_storage::handle(&self.inner, request),
            request @ (CoreRequest::LocalAgentAttach { .. }
            | CoreRequest::LocalAgentDetach { .. }
            | CoreRequest::LocalAgentAllow { .. }
            | CoreRequest::LocalAgentRetry { .. }
            | CoreRequest::LocalAgentAuthenticate { .. }
            | CoreRequest::LocalAgentConfigure { .. }
            | CoreRequest::LocalAgentSend { .. }
            | CoreRequest::LocalAgentCancel { .. }
            | CoreRequest::LocalAgentPermission { .. }
            | CoreRequest::LocalAgentAttachment { .. }
            | CoreRequest::LocalAgentAttachmentOpen { .. }) => {
                local_agent::handle(&self.inner, request)
            }
            CoreRequest::FilesList {
                window_id,
                permission,
                dir,
            } => {
                let state = self.inner.state.lock().unwrap();
                files::list(&self.inner, &state, &window_id, &permission, &dir)
            }
            CoreRequest::FilesRead {
                window_id,
                permission,
                path,
            } => {
                let state = self.inner.state.lock().unwrap();
                files::read(&self.inner, &state, &window_id, &permission, &path)
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
                    &self.inner,
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
            CoreRequest::FilesPick {
                window_id,
                accept,
                multiple,
            } => {
                let (cancelled, files) =
                    client_files::pick(&self.inner, &window_id, &accept, multiple)?;
                Ok(CoreReply::FilesPick { cancelled, files })
            }
            CoreRequest::ExportBegin {
                window_id,
                suggested_name,
                mime,
            } => {
                let sink_id = client_files::begin(&self.inner, &window_id, &suggested_name, &mime)?;
                Ok(CoreReply::ExportBegin {
                    cancelled: sink_id.is_none(),
                    sink_id,
                })
            }
            CoreRequest::ExportClose { window_id, sink_id } => {
                client_files::finish(&self.inner, &window_id, &sink_id, true)?;
                Ok(CoreReply::ExportClose {})
            }
            CoreRequest::ExportAbort { window_id, sink_id } => {
                client_files::finish(&self.inner, &window_id, &sink_id, false)?;
                Ok(CoreReply::ExportAbort {})
            }
            CoreRequest::ClientRelease { window_id } => {
                client_files::release(&self.inner, &window_id);
                Ok(CoreReply::ClientRelease {})
            }
            CoreRequest::ClientCommand {
                window_id,
                name,
                event,
            } => {
                let pointer = format!(
                    "/client/commands/{}",
                    kaleidoscope_contract::data::escape_pointer(&name)
                );
                data_runtime::act(
                    &self.inner,
                    &window_id,
                    &pointer,
                    event,
                    serde_json::Value::Null,
                )?;
                Ok(CoreReply::ClientCommand {})
            }
            CoreRequest::FilesAllowPc {
                window_id,
                permission,
            } => self.allow_pc(&window_id, &permission),
            CoreRequest::FilesOpen {
                window_id,
                permission,
                path,
                app_id,
                rect,
            } => self.apply_state_change(|state| {
                files::open(
                    &self.inner,
                    state,
                    &window_id,
                    &permission,
                    &path,
                    &app_id,
                    rect,
                )
            }),
            request @ (CoreRequest::WebAttach { .. }
            | CoreRequest::WebPlace { .. }
            | CoreRequest::WebNavigate { .. }
            | CoreRequest::WebHistory { .. }
            | CoreRequest::WebCapture { .. }
            | CoreRequest::WebDetach { .. }) => web::handle(&self.inner, request),
            CoreRequest::ExternalOpen { window_id, url } => {
                let parsed =
                    url::Url::parse(&url).map_err(|_| error::make(ErrorCode::InvalidRequest))?;
                if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
                    return Err(error::make(ErrorCode::InvalidRequest));
                }
                if let Some(window_id) = window_id {
                    if !self
                        .inner
                        .state
                        .lock()
                        .unwrap()
                        .shared
                        .windows
                        .iter()
                        .any(|window| window.id == window_id)
                    {
                        return Err(error::make(ErrorCode::NotFound));
                    }
                }
                self.inner
                    .host
                    .open_url(&url)
                    .map_err(|err| error::io_error(&err))?;
                Ok(CoreReply::ExternalOpen {})
            }
            CoreRequest::ShareSet { window_id, on } => share::set(&self.inner, &window_id, on),
            CoreRequest::ShareView { window_id, view } => {
                share::view(&self.inner, &window_id, view)
            }
            CoreRequest::ShareFreeze {} => Ok(share::freeze(&self.inner)),
            CoreRequest::ShareCapture { window_id } => share::capture(&self.inner, &window_id),
            CoreRequest::ShareUnfreeze {} => Ok(share::unfreeze(&self.inner)),
            CoreRequest::UpdateRestart {} => self.restart_for_update(),
            CoreRequest::DataAttach { window_id, dormant } => {
                data_runtime::attach(&self.inner, &window_id, Some(dormant))
            }
            CoreRequest::DataDormant { window_id, dormant } => {
                data_runtime::dormant(&self.inner, &window_id, dormant)
            }
            CoreRequest::DataDetach { window_id } => data_runtime::detach(&self.inner, &window_id),
            CoreRequest::DataAct {
                window_id,
                pointer,
                event,
                item,
            } => data_runtime::act(&self.inner, &window_id, &pointer, event, item),
            CoreRequest::DataRefresh { window_id, sources } => {
                data_runtime::refresh(&self.inner, &window_id, &sources, false, true)?;
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

    pub fn shutdown(&self) {
        client_files::release_all(&self.inner);
        local_agent::shutdown(&self.inner);
        if let Err(err) = self.flush_storage() {
            eprintln!("상태를 저장할 수 없습니다: {}", err.message);
        }
        self.inner.flusher.stop();
    }

    pub fn flush_storage(&self) -> Result<(), CoreError> {
        let state = self.inner.state.lock().unwrap();
        self.inner.save_state_locked(&state, false, false, false)
    }

    /// 앱 업데이터의 현재 상태가 바뀐 경우에만 화면에 알린다.
    pub fn set_update_status(&self, status: UpdateStatus) {
        let mut state = self.inner.state.lock().unwrap();
        if state.update == status {
            return;
        }
        state.update = status;
        let event = self.inner.state_event_locked(&state);
        drop(state);
        self.inner.emit_state(&event);
    }

    fn restart_for_update(&self) -> Result<CoreReply, CoreError> {
        use kaleidoscope_contract::ErrorCode;
        self.flush_storage()?;
        let (current_version, version) = match self.inner.state.lock().unwrap().update.clone() {
            UpdateStatus::Unavailable {} => return Err(error::make(ErrorCode::Unavailable)),
            UpdateStatus::Ready {
                current_version,
                version,
            } => (current_version, version),
            _ => return Err(error::make(ErrorCode::InvalidRequest)),
        };
        let updater = self
            .inner
            .host
            .updater()
            .ok_or_else(|| error::make(ErrorCode::Unavailable))?;
        if let Err(reason) = updater.install() {
            self.set_update_status(UpdateStatus::Failed {
                current_version,
                version: Some(version),
                reason: reason.clone(),
            });
            return Err(error::with_message(ErrorCode::Io, &reason));
        }
        Ok(CoreReply::UpdateRestart {})
    }

    fn handle_state_change(&self, request: CoreRequest) -> Result<CoreReply, CoreError> {
        let debounced = matches!(
            request,
            CoreRequest::WindowSetState { .. }
                | CoreRequest::WindowSetRect { .. }
                | CoreRequest::WindowRaise { .. }
                | CoreRequest::WindowMinimize { .. }
                | CoreRequest::WindowMaximize { .. }
                | CoreRequest::WindowRestore { .. }
        );
        let workspace_change = matches!(
            request,
            CoreRequest::WorkspaceRename { .. }
                | CoreRequest::WorkspaceDelete { .. }
                | CoreRequest::WorkspaceCreate { .. }
        );
        let (reply, _) = self
            .apply_state_change_mode(debounced, |state| state_commands::handle(state, request))?;
        if workspace_change {
            conversation_reconcile::workspace_changed(&self.inner);
        }
        Ok(reply)
    }

    pub(crate) fn set_state_entries(
        &self,
        window_id: &str,
        entries: std::collections::BTreeMap<String, serde_json::Value>,
    ) -> Result<ShellSnapshot, CoreError> {
        self.apply_state_change_mode(true, |state| {
            let mut next = state
                .shared
                .windows
                .iter()
                .find(|window| window.id == window_id)
                .ok_or_else(|| error::make(kaleidoscope_contract::ErrorCode::NotFound))?
                .state
                .clone();
            next.extend(entries);
            state_commands::handle(
                state,
                CoreRequest::WindowSetState {
                    window_id: window_id.into(),
                    state: next,
                },
            )
        })
        .map(|(_, snapshot)| snapshot)
    }

    fn apply_state_change(
        &self,
        change: impl FnOnce(&mut CoreState) -> Result<CoreReply, CoreError>,
    ) -> Result<CoreReply, CoreError> {
        self.apply_state_change_mode(false, change)
            .map(|(reply, _)| reply)
    }

    fn apply_state_change_mode(
        &self,
        debounced: bool,
        change: impl FnOnce(&mut CoreState) -> Result<CoreReply, CoreError>,
    ) -> Result<(CoreReply, ShellSnapshot), CoreError> {
        let mut state = self.inner.state.lock().unwrap();
        let before = state.clone();
        let reply = change(&mut state)?;
        sync_state::mark_local_changes(&self.inner, &before.shared, &mut state);
        let shared_changed = before.shared != state.shared;
        let device_changed = before.device != state.device;
        let sync_changed = before.sync != state.sync;

        if shared_changed || device_changed || sync_changed {
            if debounced {
                self.inner.flusher.schedule(
                    shared_changed,
                    device_changed,
                    sync_changed,
                    &self.inner.profiler,
                );
            } else {
                if let Err(error) = self.inner.save_state_locked(
                    &state,
                    shared_changed,
                    device_changed,
                    sync_changed,
                ) {
                    *state = before;
                    return Err(error);
                }
            }
        }

        let event = self.inner.state_event_locked(&state);
        drop(state);
        web::detach_removed(&self.inner);
        self.inner.emit_state(&event);
        Ok((reply, event.into_snapshot()))
    }

    fn pick_folder(&self, window_id: &str, permission: &str) -> Result<CoreReply, CoreError> {
        {
            let state = self.inner.state.lock().unwrap();
            files::permission(&state, window_id, permission, false)?;
            if files::scope(&state, window_id, permission)? == kaleidoscope_contract::FilesScope::Pc
            {
                return Err(error::make(
                    kaleidoscope_contract::ErrorCode::InvalidRequest,
                ));
            }
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

        if let Err(error) = self.inner.save_state_locked(&state, false, true, false) {
            *state = before;
            return Err(error);
        }
        let event = self.inner.state_event_locked(&state);
        drop(state);
        self.inner.emit_state(&event);
        data_runtime::grant_changed(&self.inner, window_id, permission);

        Ok(CoreReply::FilesPickFolder { grant: Some(grant) })
    }

    fn allow_pc(&self, window_id: &str, permission: &str) -> Result<CoreReply, CoreError> {
        use kaleidoscope_contract::{ErrorCode, FilesScope, PcAccess};
        let mut state = self.inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|w| w.id == window_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let app_id = window.app_id.clone();
        let definition = app_commands::definition_for(&state.shared, &app_id, window.app_version)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        if !definition.permissions.iter().any(|p| matches!(p,
            kaleidoscope_contract::PermissionDecl::Files { id, scope: FilesScope::Pc, .. } if id == permission)) {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        if let Some(access) = state
            .device
            .pc_access
            .iter()
            .find(|a| a.app_id == app_id && a.permission == permission)
        {
            return Ok(CoreReply::FilesAllowPc {
                access: access.clone(),
            });
        }
        let access = PcAccess {
            app_id,
            permission: permission.into(),
            granted_at: state_commands::timestamp(),
        };
        state.device.pc_access.push(access.clone());
        if let Err(err) = self.inner.save_state_locked(&state, false, true, false) {
            state.device.pc_access.pop();
            return Err(err);
        }
        let event = self.inner.state_event_locked(&state);
        drop(state);
        self.inner.emit_state(&event);
        Ok(CoreReply::FilesAllowPc { access })
    }
}

impl Inner {
    pub(crate) fn state_event_locked(&self, state: &CoreState) -> state_events::StateEvent {
        self.state_events.prepare(snapshot(state))
    }

    pub(crate) fn emit(self: &Arc<Self>, event: &CoreEvent) {
        if matches!(event, CoreEvent::AppOpenRequested { .. }) {
            self.state_events
                .deliver_open(event, |event| self.notify(event));
        } else {
            self.notify(event);
        }
    }

    fn notify(&self, event: &CoreEvent) {
        let listeners = self.listeners.lock().unwrap().clone();
        for listener in listeners {
            listener(event);
        }
    }

    pub(crate) fn emit_state(self: &Arc<Self>, event: &state_events::StateEvent) {
        share::state_changed(self);
        self.layout_signal.notify();
        self.state_events.deliver(event, |event| self.notify(event));
        data_runtime::state_changed(self);
        conversation_stream::state_changed(self);
        local_agent::state_changed(self);
    }
}

pub(crate) fn supported() -> kaleidoscope_contract::Supported {
    kaleidoscope_contract::Supported::current()
}

pub(crate) fn snapshot(state: &CoreState) -> ShellSnapshot {
    ShellSnapshot {
        last_transfer: state.last_transfer.clone(),
        transfer_error: state.transfer_error.clone(),
        embedded_available: state.embedded_available,
        shared: state.shared.clone(),
        device: state.device.clone(),
        supported: supported(),
        link: state.link.clone(),
        sharing: share::shared_window_order(&state.shared),
        update: state.update.clone(),
    }
}

mod local_agent;

mod server_switch;
