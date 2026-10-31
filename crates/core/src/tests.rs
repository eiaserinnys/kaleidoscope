use std::collections::BTreeMap;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, Cursor};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use kaleidoscope_contract::registry::{
    DeviceEvent, DeviceLayout, DeviceUploadRequest, PairPollReply, PairPollRequest, PairStartReply,
    PairStartRequest, RegistryApp, ShareUpload,
};
use kaleidoscope_contract::{
    App, AppVersion, CoreEvent, CoreReply, CoreRequest, ErrorCode, JsonValue, LinkStatus, Rect,
    ShellSnapshot,
};
use serde_json::{json, Value};
use tempfile::TempDir;

use crate::registry_client::{RegistryClient, RegistryError};
use crate::storage::LinkFile;
use crate::{Core, CoreConfig, CoreError, Host};

mod layout_sync_tests;
mod pc_tests;

const MD_EDITOR: &str = include_str!("../../../apps/md-editor.json");
const MD_VIEWER: &str = include_str!("../../contract/fixtures/md-viewer.json");
const WEB_BROWSER: &str = include_str!("../../../apps/web-browser.json");

struct CaptureTestHost {
    png: Mutex<Vec<u8>>,
    web_captures: AtomicUsize,
    shell_captures: AtomicUsize,
}

impl Host for CaptureTestHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }
    fn web(&self) -> Option<&dyn crate::WebHost> {
        Some(self)
    }
}

impl crate::WebHost for CaptureTestHost {
    fn attach(&self, _: &str, _: &str) -> Result<kaleidoscope_contract::WebPage, CoreError> {
        unreachable!()
    }
    fn place(&self, _: &str, _: Option<Rect>) -> Result<(), CoreError> {
        Ok(())
    }
    fn navigate(&self, _: &str, _: &str) -> Result<(), CoreError> {
        Ok(())
    }
    fn history(
        &self,
        _: &str,
        _: kaleidoscope_contract::WebHistoryAction,
    ) -> Result<(), CoreError> {
        Ok(())
    }
    fn capture(&self, _: &str) -> Result<Option<Vec<u8>>, CoreError> {
        self.web_captures.fetch_add(1, Ordering::SeqCst);
        Ok(Some(self.png.lock().unwrap().clone()))
    }
    fn capture_shell(&self) -> Result<Option<(Vec<u8>, f64)>, CoreError> {
        self.shell_captures.fetch_add(1, Ordering::SeqCst);
        Ok(Some((self.png.lock().unwrap().clone(), 1.0)))
    }
    fn detach(&self, _: &str) -> Result<(), CoreError> {
        Ok(())
    }
}

fn test_png(width: u32, height: u32) -> Vec<u8> {
    test_png_with_blue(width, height, 80)
}

fn test_png_with_blue(width: u32, height: u32, blue: u8) -> Vec<u8> {
    let image = image::RgbaImage::from_fn(width, height, |x, y| {
        image::Rgba([x as u8, y as u8, blue, 255])
    });
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

#[derive(Default)]
struct FakeHost {
    selected: Mutex<Option<PathBuf>>,
    roots: Mutex<Vec<crate::PcRoot>>,
    opened_urls: Mutex<Vec<String>>,
}

impl FakeHost {
    fn choose(&self, path: Option<PathBuf>) {
        *self.selected.lock().unwrap() = path;
    }
}

impl Host for FakeHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        self.selected.lock().unwrap().clone()
    }
    fn pc_roots(&self) -> Vec<crate::PcRoot> {
        self.roots.lock().unwrap().clone()
    }
    fn open_url(&self, url: &str) -> std::io::Result<()> {
        self.opened_urls.lock().unwrap().push(url.to_owned());
        Ok(())
    }
}

#[test]
fn external_links_only_open_http_or_https() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![], &host);
    core.handle(CoreRequest::ExternalOpen {
        window_id: None,
        url: "https://example.com/".into(),
    })
    .unwrap();
    assert_eq!(
        host.opened_urls.lock().unwrap().as_slice(),
        &["https://example.com/"]
    );
    for url in [
        "file:///tmp/test",
        "javascript:alert(1)",
        "data:text/plain,a",
    ] {
        expect_error(
            core.handle(CoreRequest::ExternalOpen {
                window_id: None,
                url: url.into(),
            }),
            ErrorCode::InvalidRequest,
        );
    }
    assert_eq!(host.opened_urls.lock().unwrap().len(), 1);
}

fn open_core(data_dir: &Path, definitions: Vec<String>, host: &Arc<FakeHost>) -> Core {
    Core::open(
        CoreConfig {
            data_dir: data_dir.to_path_buf(),
            seed_definitions: definitions,
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "test-device".into(),
        },
        host.clone(),
    )
    .unwrap()
}

fn test_definition(raw: &str) -> String {
    let definition: Value = serde_json::from_str(raw).unwrap();
    let id = definition["id"].as_str().unwrap();
    raw.replacen(
        &format!("\"id\": \"{id}\""),
        &format!("\"id\": \"test-{id}\""),
        1,
    )
}

fn seeded_core(data_dir: &Path, host: &Arc<FakeHost>) -> Core {
    open_core(data_dir, vec![test_definition(MD_EDITOR)], host)
}

fn snapshot(core: &Core) -> ShellSnapshot {
    match core.handle(CoreRequest::StateGet {}).unwrap() {
        CoreReply::StateGet { snapshot } => snapshot,
        reply => panic!("unexpected reply: {reply:?}"),
    }
}

#[test]
fn builtin_apps_exist_without_a_registry_and_reject_local_import() {
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    let apps = snapshot(&core).shared.apps;
    for (id, version) in [
        ("agent", 1),
        ("explorer", 3),
        ("md-editor", 2),
        ("html-report", 1),
        ("web-browser", 1),
        ("calculator", 1),
        ("weather", 1),
        ("market", 1),
        ("earth", 1),
        ("reader", 1),
    ] {
        assert!(apps
            .iter()
            .any(|app| app.id == id && app.current_version == version));
    }
    assert_eq!(apps.len(), 10);
    let error = core
        .handle(CoreRequest::AppImport {
            definition_json: MD_EDITOR.into(),
        })
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
}

#[test]
fn retired_builtin_is_removed_from_existing_device_state() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let core = open_core(temp.path(), vec![], &host);
    core.handle(CoreRequest::AppImport {
        definition_json: MD_VIEWER.into(),
    })
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "md-viewer");
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "docs".into(),
    })
    .unwrap();
    assert!(snapshot(&core)
        .device
        .grants
        .iter()
        .any(|grant| grant.window_id == window));
    drop(core);
    let reopened = open_core(temp.path(), vec![], &host);
    let snapshot = snapshot(&reopened);
    assert!(!snapshot.shared.apps.iter().any(|app| app.id == "md-viewer"));
    assert!(!snapshot
        .shared
        .app_versions
        .iter()
        .any(|version| version.app_id == "md-viewer"));
    assert!(!snapshot.shared.windows.iter().any(|item| item.id == window));
    assert!(!snapshot
        .device
        .grants
        .iter()
        .any(|grant| grant.window_id == window));
}

#[test]
fn retired_window_deletion_wins_over_the_next_server_snapshot() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![], &host);
    core.handle(CoreRequest::AppImport {
        definition_json: MD_VIEWER.into(),
    })
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "md-viewer");
    let previous = snapshot(&core).shared;
    crate::storage::save_link(temp.path(), &connected_link_file()).unwrap();
    drop(core);
    let reopened = open_core_with_client(temp.path(), vec![], &host, registry_client());
    let mut state = reopened.inner.state.lock().unwrap();
    assert!(state
        .sync
        .contains(crate::sync_state::EntityKind::Window, &window));
    crate::layout_apply::apply_snapshot(
        &mut state,
        "device-id",
        kaleidoscope_contract::registry::LayoutChanges {
            workspaces: previous.workspaces,
            desktops: previous.desktops,
            windows: previous.windows,
            ..Default::default()
        },
    );
    assert!(!state.shared.windows.iter().any(|item| item.id == window));
}

#[test]
fn retired_windows_from_another_device_are_deleted_during_sync() {
    let remote_dir = TempDir::new().unwrap();
    let local_dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let remote = open_core(remote_dir.path(), vec![], &host);
    remote
        .handle(CoreRequest::AppImport {
            definition_json: MD_VIEWER.into(),
        })
        .unwrap();
    let (_, desktop) = active_ids(&remote);
    let remote_window = open_window(&remote, &desktop, "md-viewer");
    let layout = snapshot(&remote).shared;
    let local = open_core(local_dir.path(), vec![], &host);
    let mut state = local.inner.state.lock().unwrap();
    state.sync.merged = true;
    crate::layout_apply::apply_snapshot(
        &mut state,
        "device-id",
        kaleidoscope_contract::registry::LayoutChanges {
            workspaces: layout.workspaces,
            desktops: layout.desktops,
            windows: layout.windows.clone(),
            ..Default::default()
        },
    );
    assert!(!state
        .shared
        .windows
        .iter()
        .any(|item| item.id == remote_window));
    assert!(state
        .sync
        .contains(crate::sync_state::EntityKind::Window, &remote_window));
    let mut later = layout.windows[0].clone();
    later.id = "another-retired-window".into();
    crate::layout_apply::apply_changes(
        &mut state,
        kaleidoscope_contract::registry::LayoutChanges {
            windows: vec![later.clone()],
            ..Default::default()
        },
    );
    assert!(!state.shared.windows.iter().any(|item| item.id == later.id));
    assert!(state
        .sync
        .contains(crate::sync_state::EntityKind::Window, &later.id));
}

#[test]
fn local_agent_is_available_and_reads_defaults_before_linking() {
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "agent");
    let value = crate::app_storage::read(&core.inner, &window, "agents").unwrap();
    assert!(!value.exists);
    assert_eq!(value.revision, None);
    assert!(!value.content.as_array().unwrap().is_empty());
    assert!(
        matches!(core.handle(CoreRequest::LocalAgentAttach { window_id: window }), Ok(CoreReply::LocalAgentAttach { snapshot }) if snapshot.phase == kaleidoscope_contract::local_agent::LocalAgentPhase::ChoosingAgent)
    );
}

#[test]
fn builtin_window_state_survives_restart_at_the_same_version() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![], &host);
    let (_, desktop) = active_ids(&core);
    let window_id = open_window(&core, &desktop, "explorer");
    core.handle(CoreRequest::WindowSetState {
        window_id: window_id.clone(),
        state: BTreeMap::from([
            ("folder".into(), json!("x")),
            ("view".into(), json!("details")),
        ]),
    })
    .unwrap();
    let before = snapshot(&core)
        .shared
        .windows
        .into_iter()
        .find(|w| w.id == window_id)
        .unwrap();
    assert_eq!(before.app_version, 3);
    drop(core);
    let reopened = open_core(temp.path(), vec![], &host);
    let after = snapshot(&reopened)
        .shared
        .windows
        .into_iter()
        .find(|w| w.id == window_id)
        .unwrap();
    assert_eq!(before, after);
    assert_eq!(snapshot(&reopened).shared.apps.len(), 10);
}

#[test]
fn registry_events_remove_personal_apps_but_preserve_builtins() {
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    let mut personal: Value = serde_json::from_str(MD_VIEWER).unwrap();
    personal["id"] = json!("personal-viewer");
    let mut forged: Value = serde_json::from_str(MD_EDITOR).unwrap();
    forged["name"] = json!("바뀐 이름");
    {
        let mut state = core.inner.state.lock().unwrap();
        assert!(crate::app_commands::import_registry(
            &mut state,
            registry_app(1, &personal.to_string())
        ));
        assert!(!crate::app_commands::import_registry(
            &mut state,
            registry_app(9, &forged.to_string())
        ));
    }
    assert!(crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppDeleted {
            app_id: "personal-viewer".into()
        }
    ));
    assert!(!snapshot(&core)
        .shared
        .apps
        .iter()
        .any(|app| app.id == "personal-viewer"));
    {
        let mut state = core.inner.state.lock().unwrap();
        assert!(crate::app_commands::import_registry(
            &mut state,
            registry_app(1, &personal.to_string())
        ));
    }
    assert!(crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppsSnapshot {
            apps: vec![registry_app(9, &forged.to_string())],
            deleted: vec!["personal-viewer".into(), "md-editor".into()]
        }
    ));
    let state = snapshot(&core).shared;
    assert!(!state.apps.iter().any(|app| app.id == "personal-viewer"));
    assert!(state
        .apps
        .iter()
        .any(|app| app.id == "md-editor" && app.current_version == 2 && app.name != "바뀐 이름"));
}

#[test]
fn 대화_삭제는_현재_snapshot과_미전송_없는_작업_정본에서만_판정한다() {
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    let inner = &core.inner;
    {
        let mut state = inner.state.lock().unwrap();
        state.link = LinkStatus::Connected {
            server_url: "test".into(),
            device_name: "test".into(),
        };
    }
    inner.layout_connection_epoch.store(1, Ordering::SeqCst);
    assert!(!crate::conversation_reconcile::safe_to_archive(
        inner, 1, "deleted"
    ));
    inner.conversation_snapshot_epoch.store(1, Ordering::SeqCst);
    assert!(crate::conversation_reconcile::safe_to_archive(
        inner, 1, "deleted"
    ));
    {
        let mut state = inner.state.lock().unwrap();
        let live = state.shared.workspaces[0].id.clone();
        assert!(!state.shared.workspaces.is_empty());
        state
            .sync
            .mark(crate::sync_state::EntityKind::Workspace, &live);
    }
    assert!(!crate::conversation_reconcile::safe_to_archive(
        inner, 1, "deleted"
    ));
    {
        let mut state = inner.state.lock().unwrap();
        state.sync.pending.clear();
        let live = state.shared.workspaces[0].id.clone();
        drop(state);
        assert!(!crate::conversation_reconcile::safe_to_archive(
            inner, 1, &live
        ));
    }
    inner.state.lock().unwrap().shared.workspaces.clear();
    assert!(!crate::conversation_reconcile::safe_to_archive(
        inner, 1, "deleted"
    ));
}

#[test]
fn share_set_updates_snapshot_once_and_share_view_validates_size() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(
        &temp.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
    );
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));

    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: true,
    })
    .unwrap();
    assert_eq!(snapshot(&core).sharing, vec![window_id.clone()]);
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(1)).unwrap(),
        CoreEvent::StateChanged { .. }
    ));
    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: true,
    })
    .unwrap();
    assert!(rx.try_recv().is_err());

    let oversized_view = || kaleidoscope_contract::VisibleView {
        text: "x".repeat(kaleidoscope_contract::SHARE_TEXT_MAX_BYTES + 1),
        visual: false,
        bounds: Rect {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
        },
    };
    expect_error(
        core.handle(CoreRequest::ShareView {
            window_id: "missing-window".into(),
            view: oversized_view(),
        }),
        ErrorCode::NotFound,
    );
    expect_error(
        core.handle(CoreRequest::ShareView {
            window_id: window_id.clone(),
            view: oversized_view(),
        }),
        ErrorCode::InvalidRequest,
    );

    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: false,
    })
    .unwrap();
    assert!(snapshot(&core).sharing.is_empty());
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(1)).unwrap(),
        CoreEvent::StateChanged { .. }
    ));
    core.handle(CoreRequest::ShareView {
        window_id,
        view: oversized_view(),
    })
    .unwrap();
}

#[test]
fn shared_view_delivery_baselines_are_separate_for_each_app() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = seeded_core(temp.path(), &host);
    let (workspace, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    core.handle(CoreRequest::ShareSet {
        window_id: window.clone(),
        on: true,
    })
    .unwrap();
    core.handle(CoreRequest::ShareView {
        window_id: window,
        view: kaleidoscope_contract::VisibleView {
            text: "보이는 내용".into(),
            visual: false,
            bounds: Rect {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
        },
    })
    .unwrap();
    let first = crate::share::prepare_text(&core.inner, &workspace, "app-a").unwrap();
    assert!(first.0.contains("새로 같이 봄"));
    crate::share::mark_sent_text(&core.inner, "app-a", first.1);
    assert!(crate::share::prepare_text(&core.inner, &workspace, "app-a")
        .unwrap()
        .0
        .contains("그대로"));
    assert!(crate::share::prepare_text(&core.inner, &workspace, "app-b")
        .unwrap()
        .0
        .contains("새로 같이 봄"));
}

#[test]
fn shared_view_baselines_survive_core_restart() {
    let temp = TempDir::new().unwrap();
    let data_dir = temp.path().join("data");
    let host = Arc::new(CaptureTestHost {
        png: Mutex::new(test_png(8, 8)),
        web_captures: AtomicUsize::new(0),
        shell_captures: AtomicUsize::new(0),
    });
    let open = || {
        Core::open(
            CoreConfig {
                data_dir: data_dir.clone(),
                seed_definitions: vec![test_definition(MD_EDITOR)],
                server_url: "http://127.0.0.1:4219".into(),
                device_name: "test-device".into(),
            },
            host.clone(),
        )
        .unwrap()
    };
    let core = open();
    let (workspace, desktop_id) = active_ids(&core);
    let window = open_window(&core, &desktop_id, "test-md-editor");
    core.handle(CoreRequest::ShareSet {
        window_id: window.clone(),
        on: true,
    })
    .unwrap();
    core.handle(CoreRequest::ShareView {
        window_id: window.clone(),
        view: kaleidoscope_contract::VisibleView {
            text: "첫 화면".into(),
            visual: true,
            bounds: Rect {
                x: 0,
                y: 0,
                width: 8,
                height: 8,
            },
        },
    })
    .unwrap();
    let first = crate::share::prepare_text(&core.inner, &workspace, "thread").unwrap();
    assert!(first.0.contains("새로 같이 봄"));
    crate::share::mark_sent_text(&core.inner, "thread", first.1);
    let (attachments, visuals) =
        crate::share::capture_for_send(&core.inner, &workspace, "thread", &[]);
    assert_eq!(attachments.len(), 1);
    crate::share::mark_sent_visuals(&core.inner, "thread", visuals);

    let before_restart = snapshot(&core);
    assert_eq!(before_restart.sharing, vec![window.clone()]);
    assert_eq!(
        before_restart.shared.desktops[0].sharing,
        vec![window.clone()]
    );
    let context = &before_restart.shared.desktops[0].last_sent_context["thread"][&window];
    assert_eq!(context.app_name.as_deref(), Some("마크다운 편집기"));
    assert_eq!(context.text.as_deref(), Some("첫 화면"));
    assert!(context.visual_hash.is_some());
    drop(core);

    let reopened = open();
    let after_restart = snapshot(&reopened);
    assert_eq!(after_restart.sharing, vec![window.clone()]);
    assert_eq!(
        after_restart.shared.desktops[0].sharing,
        vec![window.clone()]
    );
    assert!(
        crate::share::prepare_text(&reopened.inner, &workspace, "thread")
            .unwrap()
            .0
            .contains("그대로")
    );

    reopened
        .handle(CoreRequest::ShareView {
            window_id: window.clone(),
            view: kaleidoscope_contract::VisibleView {
                text: "첫 화면".into(),
                visual: true,
                bounds: Rect {
                    x: 0,
                    y: 0,
                    width: 8,
                    height: 8,
                },
            },
        })
        .unwrap();
    assert!(
        crate::share::prepare_text(&reopened.inner, &workspace, "thread")
            .unwrap()
            .0
            .contains("그대로")
    );
    let (same_attachments, _) =
        crate::share::capture_for_send(&reopened.inner, &workspace, "thread", &[]);
    assert!(same_attachments.is_empty());

    reopened
        .handle(CoreRequest::ShareView {
            window_id: window.clone(),
            view: kaleidoscope_contract::VisibleView {
                text: "바뀐 화면".into(),
                visual: true,
                bounds: Rect {
                    x: 0,
                    y: 0,
                    width: 8,
                    height: 8,
                },
            },
        })
        .unwrap();
    let changed = crate::share::prepare_text(&reopened.inner, &workspace, "thread").unwrap();
    assert!(changed.0.contains("바뀜"));
    crate::share::mark_sent_text(&reopened.inner, "thread", changed.1);

    *host.png.lock().unwrap() = test_png_with_blue(8, 8, 200);
    let (changed_attachments, visuals) =
        crate::share::capture_for_send(&reopened.inner, &workspace, "thread", &[]);
    assert_eq!(changed_attachments.len(), 1);
    crate::share::mark_sent_visuals(&reopened.inner, "thread", visuals);

    reopened
        .handle(CoreRequest::WindowClose {
            window_id: window.clone(),
        })
        .unwrap();
    let closed = snapshot(&reopened);
    assert!(closed.shared.desktops[0].sharing.is_empty());
    let context = &closed.shared.desktops[0].last_sent_context["thread"][&window];
    assert!(context.app_name.is_some());
    assert!(context.text.is_some());
    assert!(context.visual_hash.is_none());
}

#[test]
fn legacy_share_block_is_removed_from_user_items_only() {
    use kaleidoscope_contract::conversation::{ConversationItem, ConversationItemKind};

    let block = kaleidoscope_data::share::build_share_block(
        &[kaleidoscope_data::share::View {
            window_id: "window-1234".into(),
            app_name: "작업 PAS".into(),
            text: "옛 같이 보기 글".into(),
        }],
        &std::collections::BTreeMap::new(),
    )
    .unwrap()
    .0;
    let text = format!("오 이거 이제 보여?\n\n{block}");
    let mut user = ConversationItem {
        id: "legacy".into(),
        kind: ConversationItemKind::User,
        text: text.clone(),
        at: "now".into(),
        attachments: vec![],
    };
    crate::share::strip_legacy_share_from_item(&mut user);
    assert_eq!(user.text, "오 이거 이제 보여?");

    let mut assistant = ConversationItem {
        kind: ConversationItemKind::Assistant,
        ..user.clone()
    };
    assistant.text = text.clone();
    crate::share::strip_legacy_share_from_item(&mut assistant);
    assert_eq!(assistant.text, text);

    assert_eq!(
        kaleidoscope_data::share::strip_legacy_share_block(
            "앞 <kaleidoscope-share>중간</kaleidoscope-share> 뒤"
        ),
        "앞 <kaleidoscope-share>중간</kaleidoscope-share> 뒤"
    );
}

#[test]
fn share_view_uploads_once_and_unlink_clears_server_but_keeps_local_toggle() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(
        &temp.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
        client.clone(),
    );
    mark_connected(&core);
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: true,
    })
    .unwrap();
    let view = kaleidoscope_contract::VisibleView {
        text: "visible text".into(),
        visual: false,
        bounds: Rect {
            x: 0,
            y: 0,
            width: 200,
            height: 100,
        },
    };
    core.handle(CoreRequest::ShareView {
        window_id: window_id.clone(),
        view: view.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::ShareView {
        window_id: window_id.clone(),
        view,
    })
    .unwrap();
    assert_eq!(client.share_puts.lock().unwrap().len(), 1);
    assert_eq!(
        client.share_puts.lock().unwrap()[0].1.workspace_id,
        active_ids(&core).0
    );

    core.handle(CoreRequest::LinkUnlink {}).unwrap();
    assert_eq!(
        *client.share_deletes.lock().unwrap(),
        vec![window_id.clone()]
    );
    assert_eq!(snapshot(&core).sharing, vec![window_id]);
}

#[test]
fn share_offline_delete_replays_on_reconnect_and_closed_window_is_removed() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(
        &temp.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
        Arc::clone(&client),
    );
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: true,
    })
    .unwrap();
    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: false,
    })
    .unwrap();
    assert!(client.share_deletes.lock().unwrap().is_empty());
    mark_connected(&core);
    crate::share::on_connected(&core.inner);
    assert_eq!(
        *client.share_deletes.lock().unwrap(),
        vec![window_id.clone()]
    );

    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: true,
    })
    .unwrap();
    let view = kaleidoscope_contract::VisibleView {
        text: "latest".into(),
        visual: false,
        bounds: Rect {
            x: 0,
            y: 0,
            width: 100,
            height: 80,
        },
    };
    core.handle(CoreRequest::ShareView {
        window_id: window_id.clone(),
        view,
    })
    .unwrap();
    assert_eq!(client.share_puts.lock().unwrap().len(), 1);
    crate::share::on_connected(&core.inner);
    assert_eq!(client.share_puts.lock().unwrap().len(), 2);

    let workspace_id = active_ids(&core).0;
    let desktop = match core
        .handle(CoreRequest::DesktopCreate {
            workspace_id,
            name: "삭제 대상".into(),
        })
        .unwrap()
    {
        CoreReply::DesktopCreate { desktop } => desktop,
        reply => panic!("unexpected reply: {reply:?}"),
    };
    let desktop_window = open_window(&core, &desktop.id, "test-md-editor");
    core.handle(CoreRequest::ShareSet {
        window_id: desktop_window.clone(),
        on: true,
    })
    .unwrap();
    core.handle(CoreRequest::DesktopDelete {
        desktop_id: desktop.id,
    })
    .unwrap();
    assert!(!snapshot(&core).sharing.contains(&desktop_window));
    assert!(client
        .share_deletes
        .lock()
        .unwrap()
        .contains(&desktop_window));

    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: true,
    })
    .unwrap();
    core.handle(CoreRequest::WindowClose {
        window_id: window_id.clone(),
    })
    .unwrap();
    assert!(snapshot(&core).sharing.is_empty());
    assert_eq!(
        client.share_deletes.lock().unwrap().last(),
        Some(&window_id)
    );
}

#[test]
fn conversation_capture_respects_visual_baseline() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(CaptureTestHost {
        png: Mutex::new(test_png(8, 8)),
        web_captures: AtomicUsize::new(0),
        shell_captures: AtomicUsize::new(0),
    });
    let client = registry_client();
    let core = Core::open_with_client(
        CoreConfig {
            data_dir: temp.path().join("data"),
            seed_definitions: vec![test_definition(MD_EDITOR), test_definition(WEB_BROWSER)],
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "test-device".into(),
        },
        host.clone(),
        client.clone(),
    )
    .unwrap();
    mark_connected(&core);
    let (workspace_id, desktop_id) = active_ids(&core);
    let editor = open_window(&core, &desktop_id, "test-md-editor");
    let browser = open_window(&core, &desktop_id, "test-web-browser");
    for id in [&editor, &browser] {
        core.handle(CoreRequest::ShareSet {
            window_id: id.clone(),
            on: true,
        })
        .unwrap();
        core.handle(CoreRequest::ShareView {
            window_id: id.clone(),
            view: kaleidoscope_contract::VisibleView {
                text: "[이미지: 화면]".into(),
                visual: true,
                bounds: Rect {
                    x: 1,
                    y: 1,
                    width: 4,
                    height: 4,
                },
            },
        })
        .unwrap();
    }
    let extra_desktop = match core
        .handle(CoreRequest::DesktopCreate {
            workspace_id: workspace_id.clone(),
            name: "비활성 데스크톱".into(),
        })
        .unwrap()
    {
        CoreReply::DesktopCreate { desktop } => desktop,
        reply => panic!("unexpected reply: {reply:?}"),
    };
    core.handle(CoreRequest::DesktopActivate {
        desktop_id: desktop_id.clone(),
    })
    .unwrap();
    let extra_window = open_window(&core, &extra_desktop.id, "test-md-editor");
    core.handle(CoreRequest::DesktopActivate {
        desktop_id: desktop_id.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::ShareSet {
        window_id: extra_window.clone(),
        on: true,
    })
    .unwrap();
    core.handle(CoreRequest::ShareView {
        window_id: extra_window,
        view: kaleidoscope_contract::VisibleView {
            text: "[이미지: 다른 데스크톱]".into(),
            visual: true,
            bounds: Rect {
                x: 1,
                y: 1,
                width: 4,
                height: 4,
            },
        },
    })
    .unwrap();
    let (first, visuals) = crate::share::capture_for_send(&core.inner, &workspace_id, "test", &[]);
    assert_eq!(first.len(), 2);
    assert_eq!(host.shell_captures.load(Ordering::SeqCst), 1);
    assert_eq!(host.web_captures.load(Ordering::SeqCst), 1);
    crate::share::mark_sent_visuals(&core.inner, "test", visuals);
    let (second, _) = crate::share::capture_for_send(&core.inner, &workspace_id, "test", &[]);
    assert!(second.is_empty());
}

fn active_ids(core: &Core) -> (String, String) {
    let snapshot = snapshot(core);
    let workspace_id = snapshot.device.active_workspace_id.unwrap();
    let desktop_id = snapshot.device.active_desktop_ids[&workspace_id].clone();
    (workspace_id, desktop_id)
}

fn import(core: &Core, definition: &str) -> CoreReply {
    core.handle(CoreRequest::AppImport {
        definition_json: definition.to_string(),
    })
    .unwrap()
}

fn open_window(core: &Core, desktop_id: &str, app_id: &str) -> String {
    match core
        .handle(CoreRequest::WindowOpen {
            desktop_id: desktop_id.to_string(),
            app_id: app_id.to_string(),
            rect: None,
        })
        .unwrap()
    {
        CoreReply::WindowOpen { window } => window.id,
        reply => panic!("unexpected reply: {reply:?}"),
    }
}

fn pick_folder(core: &Core, window_id: &str) -> CoreReply {
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window_id.to_string(),
        permission: "docs".into(),
    })
    .unwrap()
}

fn expect_error(result: Result<CoreReply, CoreError>, code: ErrorCode) -> CoreError {
    let error = result.expect_err("command unexpectedly succeeded");
    assert_eq!(error.code, code, "{error:?}");
    error
}

#[derive(Default)]
struct FakeRegistryClient {
    raw_values_enabled: std::sync::atomic::AtomicBool,
    legacy_storage_not_found: std::sync::atomic::AtomicBool,
    storage_value: Mutex<Option<(Value, String)>>,
    storage_pause: Mutex<Option<mpsc::Receiver<()>>>,
    storage_workspace: Mutex<String>,
    pair_start: Mutex<Option<Result<PairStartReply, RegistryError>>>,
    pair_polls: Mutex<VecDeque<Result<PairPollReply, RegistryError>>>,
    uploads: Mutex<VecDeque<Result<RegistryApp, RegistryError>>>,
    streams: Mutex<VecDeque<Result<Vec<DeviceEvent>, RegistryError>>>,
    upload_requests: Mutex<Vec<DeviceUploadRequest>>,
    layouts: Mutex<Vec<DeviceLayout>>,
    layout_replies: Mutex<VecDeque<Result<(), RegistryError>>>,
    layout_changes: Mutex<Vec<kaleidoscope_contract::registry::LayoutChanges>>,
    layout_change_replies:
        Mutex<VecDeque<Result<kaleidoscope_contract::registry::LayoutChanges, RegistryError>>>,
    share_puts: Mutex<Vec<(String, ShareUpload)>>,
    share_deletes: Mutex<Vec<String>>,
    share_put_replies: Mutex<VecDeque<Result<(), RegistryError>>>,
    share_delete_replies: Mutex<VecDeque<Result<(), RegistryError>>>,
    layout_change_pause: Mutex<Option<mpsc::Receiver<()>>>,
    open_calls: AtomicUsize,
    connection_requests: Mutex<Vec<kaleidoscope_contract::registry::ConnectionRequest>>,
    connection_replies: Mutex<BTreeMap<String, kaleidoscope_contract::registry::ConnectionReply>>,
    connection_pause: Mutex<Option<mpsc::Receiver<()>>>,
}

impl RegistryClient for FakeRegistryClient {
    fn values_get(
        &self,
        _: &str,
        _: &str,
        _: &str,
        key: &str,
    ) -> Result<kaleidoscope_contract::app_storage::AppValueRead, RegistryError> {
        use kaleidoscope_contract::app_storage::{AppValueRead, StorageKind};
        if !self.raw_values_enabled.load(Ordering::SeqCst) {
            return Err(RegistryError::NotFound);
        }
        assert_eq!(key, "settings/agents");
        let value = self.storage_value.lock().unwrap().clone();
        Ok(AppValueRead {
            bucket_id: "bucket".into(),
            exists: value.is_some(),
            kind: value.as_ref().map(|_| StorageKind::Json),
            content: value.as_ref().map(|v| v.0.clone()),
            revision: value.map(|v| v.1),
        })
    }
    fn values_write(
        &self,
        _: &str,
        _: &str,
        _: &str,
        key: &str,
        request: &kaleidoscope_contract::app_storage::AppValueWrite,
    ) -> Result<kaleidoscope_contract::app_storage::StorageWriteReply, RegistryError> {
        use kaleidoscope_contract::app_storage::{storage_revision, StorageWriteReply};
        if !self.raw_values_enabled.load(Ordering::SeqCst) {
            return Err(RegistryError::NotFound);
        }
        assert_eq!(key, "settings/agents");
        let mut stored = self.storage_value.lock().unwrap();
        if stored.as_ref().map(|v| &v.1) != request.expected_revision.0.as_ref() {
            return Err(RegistryError::Validation(CoreError::new(
                ErrorCode::Conflict,
            )));
        }
        let revision = storage_revision(request.kind, &request.content).unwrap();
        *stored = Some((request.content.clone(), revision.clone()));
        Ok(StorageWriteReply { revision })
    }
    fn storage_get(
        &self,
        _: &str,
        _: &str,
        _: &str,
        _: &str,
        workspace: &str,
    ) -> Result<kaleidoscope_contract::app_storage::StorageReadReply, RegistryError> {
        if self.legacy_storage_not_found.load(Ordering::SeqCst) {
            return Err(RegistryError::NotFound);
        }
        let pause = self.storage_pause.lock().unwrap().take();
        if let Some(pause) = pause {
            let _ = pause.recv_timeout(Duration::from_secs(10));
        }
        *self.storage_workspace.lock().unwrap() = workspace.into();
        let value = self.storage_value.lock().unwrap().clone();
        Ok(kaleidoscope_contract::app_storage::StorageReadReply {
            kind: kaleidoscope_contract::app_storage::StorageKind::Json,
            content: value
                .as_ref()
                .map(|v| v.0.clone())
                .unwrap_or_else(|| json!("one.json")),
            revision: value.as_ref().map(|v| v.1.clone()),
            exists: value.is_some(),
        })
    }
    fn storage_write(
        &self,
        _: &str,
        _: &str,
        _: &str,
        _: &str,
        workspace: &str,
        request: &kaleidoscope_contract::app_storage::StorageWriteRequest,
    ) -> Result<kaleidoscope_contract::app_storage::StorageWriteReply, RegistryError> {
        *self.storage_workspace.lock().unwrap() = workspace.into();
        let mut stored = self.storage_value.lock().unwrap();
        if stored.as_ref().map(|v| &v.1) != request.expected_revision.0.as_ref() {
            return Err(RegistryError::Validation(CoreError::new(
                ErrorCode::Conflict,
            )));
        }
        let revision = kaleidoscope_contract::app_storage::storage_revision(
            kaleidoscope_contract::app_storage::StorageKind::Json,
            &request.content,
        )
        .unwrap();
        *stored = Some((request.content.clone(), revision.clone()));
        Ok(kaleidoscope_contract::app_storage::StorageWriteReply { revision })
    }
    fn push_layout_changes(
        &self,
        _server_url: &str,
        _token: &str,
        changes: &kaleidoscope_contract::registry::LayoutChanges,
    ) -> Result<kaleidoscope_contract::registry::LayoutChanges, RegistryError> {
        self.layout_changes.lock().unwrap().push(changes.clone());
        let pause = self.layout_change_pause.lock().unwrap().take();
        if let Some(pause) = pause {
            let _ = pause.recv_timeout(Duration::from_secs(5));
        }
        self.layout_change_replies
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Err(RegistryError::Failure("unexpected layout change".into())))
    }
    fn connection_request(
        &self,
        _server_url: &str,
        _token: &str,
        _name: &str,
        request: &kaleidoscope_contract::registry::ConnectionRequest,
    ) -> Result<kaleidoscope_contract::registry::ConnectionReply, RegistryError> {
        self.connection_requests
            .lock()
            .unwrap()
            .push(request.clone());
        if request.path == "/old" {
            let pause = self.connection_pause.lock().unwrap().take();
            if let Some(pause) = pause {
                let _ = pause.recv_timeout(Duration::from_secs(5));
            }
        }
        self.connection_replies
            .lock()
            .unwrap()
            .get(&request.path)
            .cloned()
            .ok_or_else(|| RegistryError::Failure("unexpected connection request".into()))
    }
    fn pair_start(
        &self,
        _server_url: &str,
        _request: &PairStartRequest,
    ) -> Result<PairStartReply, RegistryError> {
        self.pair_start
            .lock()
            .unwrap()
            .take()
            .unwrap_or_else(|| Err(RegistryError::Failure("unexpected pair/start".into())))
    }

    fn pair_poll(
        &self,
        _server_url: &str,
        _request: &PairPollRequest,
    ) -> Result<PairPollReply, RegistryError> {
        self.pair_polls
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(PairPollReply::Pending {}))
    }

    fn upload(
        &self,
        _server_url: &str,
        _token: &str,
        request: &DeviceUploadRequest,
    ) -> Result<RegistryApp, RegistryError> {
        self.upload_requests.lock().unwrap().push(request.clone());
        self.uploads
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Err(RegistryError::Failure("unexpected upload".into())))
    }

    fn open_events(
        &self,
        _server_url: &str,
        _token: &str,
    ) -> Result<Box<dyn BufRead + Send>, RegistryError> {
        self.open_calls.fetch_add(1, Ordering::SeqCst);
        match self.streams.lock().unwrap().pop_front() {
            Some(Ok(events)) => {
                let mut body = Vec::new();
                for event in events {
                    body.extend_from_slice(
                        format!("data: {}\n\n", serde_json::to_string(&event).unwrap()).as_bytes(),
                    );
                }
                Ok(Box::new(Cursor::new(body)))
            }
            Some(Err(error)) => Err(error),
            None => Err(RegistryError::Failure("no stream configured".into())),
        }
    }

    fn put_layout(
        &self,
        _server_url: &str,
        _token: &str,
        layout: &DeviceLayout,
    ) -> Result<(), RegistryError> {
        self.layouts.lock().unwrap().push(layout.clone());
        self.layout_replies
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(()))
    }

    fn put_share(
        &self,
        _server_url: &str,
        _token: &str,
        window_id: &str,
        share: &ShareUpload,
    ) -> Result<(), RegistryError> {
        self.share_puts
            .lock()
            .unwrap()
            .push((window_id.into(), share.clone()));
        self.share_put_replies
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(()))
    }

    fn delete_share(
        &self,
        _server_url: &str,
        _token: &str,
        window_id: &str,
    ) -> Result<(), RegistryError> {
        self.share_deletes.lock().unwrap().push(window_id.into());
        self.share_delete_replies
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(()))
    }
}

fn registry_client() -> Arc<FakeRegistryClient> {
    Arc::new(FakeRegistryClient::default())
}

fn open_core_with_client(
    data_dir: &Path,
    definitions: Vec<String>,
    host: &Arc<FakeHost>,
    client: Arc<FakeRegistryClient>,
) -> Core {
    open_core_with_attachment_opener(
        data_dir,
        definitions,
        host,
        client,
        Arc::new(crate::SystemAttachmentOpener),
    )
}

fn open_core_with_attachment_opener(
    data_dir: &Path,
    definitions: Vec<String>,
    host: &Arc<FakeHost>,
    client: Arc<FakeRegistryClient>,
    attachment_opener: Arc<dyn crate::AttachmentOpener>,
) -> Core {
    Core::open_with_client_and_opener(
        CoreConfig {
            data_dir: data_dir.to_path_buf(),
            seed_definitions: definitions,
            server_url: "https://registry.test".into(),
            device_name: "test-device".into(),
        },
        host.clone(),
        client,
        attachment_opener,
    )
    .unwrap()
}

fn connected_link_file() -> LinkFile {
    LinkFile {
        format: 1,
        server_url: "https://registry.test".into(),
        device_id: "device-id".into(),
        device_name: "test-device".into(),
        token: "secret-device-token".into(),
    }
}

fn mark_connected(core: &Core) {
    let file = connected_link_file();
    *core.inner.link_file.lock().unwrap() = Some(file.clone());
    core.inner.state.lock().unwrap().link = LinkStatus::Connected {
        server_url: file.server_url,
        device_name: file.device_name,
    };
}

#[test]
fn builtin_raw_storage_uses_declarations_and_translates_change_events() {
    use kaleidoscope_contract::app_storage::{
        AppValueMeta, ExpectedRevision, StorageKind, StorageUpdate,
    };
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = Arc::new(FakeRegistryClient::default());
    client.raw_values_enabled.store(true, Ordering::SeqCst);
    let core = open_core_with_client(temp.path(), vec![], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "agent");
    mark_connected(&core);
    let default = crate::app_storage::read(&core.inner, &window, "agents").unwrap();
    assert!(!default.exists);
    assert!(default
        .content
        .as_array()
        .is_some_and(|items| !items.is_empty()));
    let invalid = crate::app_storage::write(
        &core.inner,
        &window,
        "agents",
        json!("invalid"),
        ExpectedRevision(None),
    )
    .unwrap_err();
    assert_eq!(invalid.code, ErrorCode::InvalidRequest);
    let revision = crate::app_storage::write(
        &core.inner,
        &window,
        "agents",
        json!([]),
        ExpectedRevision(None),
    )
    .unwrap();
    let stored = crate::app_storage::read(&core.inner, &window, "agents").unwrap();
    assert_eq!(stored.content, json!([]));
    assert_eq!(stored.revision.as_deref(), Some(revision.as_str()));

    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    let item = AppValueMeta {
        key: "settings/agents".into(),
        kind: StorageKind::Json,
        revision: Some(revision),
    };
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppValueChanged {
            app_id: "agent".into(),
            bucket_id: "bucket".into(),
            item: item.clone(),
        },
    );
    let event = rx.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(
        matches!(event, CoreEvent::StorageUpdate { window_id, update: StorageUpdate::Changed { changed } } if window_id == window && changed.bucket_id == "bucket" && changed.item.entry_id == "agents")
    );
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppValuesSnapshot {
            app_id: "agent".into(),
            bucket_id: "bucket".into(),
            items: vec![item],
        },
    );
    let event = rx.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(
        matches!(event, CoreEvent::StorageUpdate { window_id, update: StorageUpdate::Snapshot { snapshot } } if window_id == window && snapshot.bucket_id == "bucket" && snapshot.items[0].entry_id == "agents")
    );
}

fn registry_app(version: u32, definition_json: &str) -> RegistryApp {
    let definition = serde_json::from_str(definition_json).unwrap();
    let parsed: kaleidoscope_contract::AppDefinition = definition;
    RegistryApp {
        app: App {
            id: parsed.id.clone(),
            name: parsed.name.clone(),
            current_version: version,
            created_at: "2026-10-29T00:00:00Z".into(),
            updated_at: "2026-10-29T00:00:00Z".into(),
        },
        version: AppVersion {
            app_id: parsed.id.clone(),
            version,
            definition: parsed,
            created_at: "2026-10-29T00:00:00Z".into(),
        },
    }
}

#[test]
fn registry_import_keeps_existing_chat_without_provider() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(&temp.path().join("data"), vec![], &host, client);
    let legacy = include_str!("../../contract/tests/legacy-workspace-pas.json");
    let mut state = core.inner.state.lock().unwrap();
    assert!(crate::app_commands::import_registry(
        &mut state,
        registry_app(1, legacy)
    ));
    let version = state
        .shared
        .app_versions
        .iter()
        .find(|version| version.app_id == "workspace-pas")
        .unwrap();
    assert!(version.definition.agent.is_none());
}

fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if condition() {
            return;
        }
        thread::sleep(Duration::from_millis(5));
    }
    assert!(condition(), "condition did not become true");
}

#[test]
fn app_import_rejects_a_definition_path_outside_the_picked_folder() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(&temp.path().join("data"), vec![], &host);
    let mut definition: Value = serde_json::from_str(&test_definition(MD_EDITOR)).unwrap();
    definition["ui"]["children"][1]["file"]["path"] = json!("../secret.md");

    let error = expect_error(
        core.handle(CoreRequest::AppImport {
            definition_json: definition.to_string(),
        }),
        ErrorCode::InvalidAppDefinition,
    );
    assert!(error.details.iter().any(|detail| detail.contains("경로")));
}

#[test]
fn file_paths_reject_traversal_absolute_windows_and_outside_symlinks() {
    let temp = TempDir::new().unwrap();
    let data_dir = temp.path().join("data");
    let root = temp.path().join("docs");
    let outside = temp.path().join("outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.md"), "secret").unwrap();

    let host = Arc::new(FakeHost::default());
    host.choose(Some(root.clone()));
    let core = seeded_core(&data_dir, &host);
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    pick_folder(&core, &window_id);

    for path in [
        "../x.md",
        "/etc/passwd",
        "C:/x.md",
        r"a\b.md",
        "a/../../b.md",
    ] {
        expect_error(
            core.handle(CoreRequest::FilesRead {
                window_id: window_id.clone(),
                permission: "docs".into(),
                path: path.into(),
            }),
            ErrorCode::PathOutsideRoot,
        );
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        symlink(outside.join("secret.md"), root.join("escape.md")).unwrap();
        expect_error(
            core.handle(CoreRequest::FilesRead {
                window_id: window_id.clone(),
                permission: "docs".into(),
                path: "escape.md".into(),
            }),
            ErrorCode::PathOutsideRoot,
        );

        symlink(outside.join("new.md"), root.join("broken-escape.md")).unwrap();
        expect_error(
            core.handle(CoreRequest::FilesWrite {
                window_id: window_id.clone(),
                permission: "docs".into(),
                path: "broken-escape.md".into(),
                text: "outside".into(),
                expected_revision: None,
            }),
            ErrorCode::PathOutsideRoot,
        );
        assert!(!outside.join("new.md").exists());

        // 밖을 가리키는 링크가 있어도 폴더 목록은 실패하지 않고 그 항목만 뺀다.
        symlink(&outside, root.join("escape-dir")).unwrap();
        fs::write(root.join("inside.md"), "inside").unwrap();
        let names = match core
            .handle(CoreRequest::FilesList {
                window_id,
                permission: "docs".into(),
                dir: String::new(),
            })
            .unwrap()
        {
            CoreReply::FilesList { entries } => entries
                .into_iter()
                .map(|entry| entry.name)
                .collect::<Vec<_>>(),
            reply => panic!("unexpected reply: {reply:?}"),
        };
        assert_eq!(names, vec!["inside.md".to_string()]);
    }
}

#[test]
fn files_list_reports_size_and_modified_time() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("docs");
    fs::create_dir_all(root.join("notes")).unwrap();
    fs::write(root.join("a.md"), "12345").unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root));
    let core = seeded_core(&temp.path().join("data"), &host);
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    pick_folder(&core, &window_id);
    let entries = match core
        .handle(CoreRequest::FilesList {
            window_id,
            permission: "docs".into(),
            dir: String::new(),
        })
        .unwrap()
    {
        CoreReply::FilesList { entries } => entries,
        reply => panic!("unexpected reply: {reply:?}"),
    };
    let names = entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(names, vec!["notes", "a.md"]);
    assert_eq!(entries[0].size, 0);
    assert_eq!(entries[1].size, 5);
    for entry in &entries {
        assert!(
            entry.modified.ends_with('Z') && entry.modified.len() == "2026-10-30T01:02:03Z".len(),
            "{}",
            entry.modified
        );
    }
}

#[test]
fn file_commands_enforce_declared_access_and_folder_grants() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root));
    let core = seeded_core(&temp.path().join("data"), &host);
    let (_, desktop_id) = active_ids(&core);
    let editor_id = open_window(&core, &desktop_id, "test-md-editor");
    let viewer = import(&core, &test_definition(MD_VIEWER));
    assert!(matches!(viewer, CoreReply::AppImport { .. }));
    let viewer_id = open_window(&core, &desktop_id, "test-md-viewer");

    expect_error(
        core.handle(CoreRequest::FilesWrite {
            window_id: viewer_id.clone(),
            permission: "docs".into(),
            path: "read-only.md".into(),
            text: "x".into(),
            expected_revision: None,
        }),
        ErrorCode::PermissionDenied,
    );
    expect_error(
        core.handle(CoreRequest::FilesRead {
            window_id: editor_id.clone(),
            permission: "missing".into(),
            path: "a.md".into(),
        }),
        ErrorCode::PermissionDenied,
    );
    expect_error(
        core.handle(CoreRequest::FilesRead {
            window_id: editor_id,
            permission: "docs".into(),
            path: "a.md".into(),
        }),
        ErrorCode::NotGranted,
    );
}

#[test]
fn file_write_checks_revisions_and_preserves_crlf_bytes() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("notes.md"), b"first\r\n").unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root.clone()));
    let core = seeded_core(&temp.path().join("data"), &host);
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    pick_folder(&core, &window_id);

    let revision = match core
        .handle(CoreRequest::FilesRead {
            window_id: window_id.clone(),
            permission: "docs".into(),
            path: "notes.md".into(),
        })
        .unwrap()
    {
        CoreReply::FilesRead { revision, .. } => revision,
        reply => panic!("unexpected reply: {reply:?}"),
    };
    fs::write(root.join("notes.md"), b"changed\r\n").unwrap();
    expect_error(
        core.handle(CoreRequest::FilesWrite {
            window_id: window_id.clone(),
            permission: "docs".into(),
            path: "notes.md".into(),
            text: "stale\r\n".into(),
            expected_revision: Some(revision),
        }),
        ErrorCode::Conflict,
    );
    expect_error(
        core.handle(CoreRequest::FilesWrite {
            window_id: window_id.clone(),
            permission: "docs".into(),
            path: "notes.md".into(),
            text: "overwrite".into(),
            expected_revision: None,
        }),
        ErrorCode::Conflict,
    );

    let current_revision = match core
        .handle(CoreRequest::FilesRead {
            window_id: window_id.clone(),
            permission: "docs".into(),
            path: "notes.md".into(),
        })
        .unwrap()
    {
        CoreReply::FilesRead { revision, .. } => revision,
        reply => panic!("unexpected reply: {reply:?}"),
    };
    core.handle(CoreRequest::FilesWrite {
        window_id,
        permission: "docs".into(),
        path: "notes.md".into(),
        text: "saved\r\n".into(),
        expected_revision: Some(current_revision),
    })
    .unwrap();
    assert_eq!(fs::read(root.join("notes.md")).unwrap(), b"saved\r\n");
}

#[test]
fn state_reopens_with_workspace_desktop_window_state_rect_and_grant() {
    let temp = TempDir::new().unwrap();
    let data_dir = temp.path().join("data");
    let root = temp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root));
    let core = seeded_core(&data_dir, &host);
    let (workspace_id, desktop_id) = active_ids(&core);
    let second = match core
        .handle(CoreRequest::DesktopCreate {
            workspace_id: workspace_id.clone(),
            name: "데스크톱 둘".into(),
        })
        .unwrap()
    {
        CoreReply::DesktopCreate { desktop } => desktop.id,
        reply => panic!("unexpected reply: {reply:?}"),
    };
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    core.handle(CoreRequest::WindowSetRect {
        window_id: window_id.clone(),
        rect: Rect {
            x: 17,
            y: 29,
            width: 900,
            height: 700,
        },
    })
    .unwrap();
    let mut state = BTreeMap::new();
    state.insert("current_file".into(), json!("notes/readme.md"));
    core.handle(CoreRequest::WindowSetState {
        window_id: window_id.clone(),
        state,
    })
    .unwrap();
    pick_folder(&core, &window_id);
    core.handle(CoreRequest::WorkspaceCreate {
        name: "다른 작업".into(),
    })
    .unwrap();
    core.handle(CoreRequest::DesktopActivate { desktop_id: second })
        .unwrap();
    let before = snapshot(&core);
    drop(core);

    let reopened = seeded_core(&data_dir, &host);
    assert_eq!(snapshot(&reopened), before);
    assert!(data_dir.join("state.json").exists());
    assert!(data_dir.join("device.json").exists());
}

#[test]
fn import_seeds_versions_migrates_window_state_and_rejects_newer_requirements() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let root = temp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    host.choose(Some(root));
    let core = seeded_core(&temp.path().join("data"), &host);
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    pick_folder(&core, &window_id);
    let mut old_state = BTreeMap::new();
    old_state.insert("current_file".into(), json!("old.md"));
    core.handle(CoreRequest::WindowSetState {
        window_id: window_id.clone(),
        state: old_state,
    })
    .unwrap();

    let mut definition: Value = serde_json::from_str(&test_definition(MD_EDITOR)).unwrap();
    definition["name"] = json!("마크다운 편집기 새 버전");
    // 상태 키를 바꾸므로 예제의 opens(current_file을 가리킴)는 뺀다.
    definition.as_object_mut().unwrap().remove("opens");
    definition["state"] = json!({"new_key": "default"});
    definition["ui"] = json!({
        "type": "markdown_view",
        "file": { "permission": "docs", "path": "readme.md" }
    });
    import(&core, &definition.to_string());

    let snapshot = snapshot(&core);
    let app = snapshot
        .shared
        .apps
        .iter()
        .find(|app| app.id == "test-md-editor")
        .unwrap();
    assert_eq!(app.current_version, 2);
    let window = snapshot
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)
        .unwrap();
    assert_eq!(window.app_version, 2);
    assert_eq!(window.state.get("new_key"), Some(&json!("default")));
    assert!(!window.state.contains_key("current_file"));
    assert!(snapshot
        .device
        .grants
        .iter()
        .any(|grant| { grant.window_id == window_id && grant.permission == "docs" }));

    let mut unsupported: Value = serde_json::from_str(&test_definition(MD_EDITOR)).unwrap();
    unsupported["requires"]["blocks"] = json!(99);
    expect_error(
        core.handle(CoreRequest::AppImport {
            definition_json: unsupported.to_string(),
        }),
        ErrorCode::UnsupportedApp,
    );
}

#[test]
fn state_changes_emit_one_snapshot_event_and_file_reads_failures_emit_none() {
    let temp = TempDir::new().unwrap();
    let data_dir = temp.path().join("data");
    let root = temp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("notes.md"), b"notes").unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root));
    let core = seeded_core(&data_dir, &host);
    let events = Arc::new(Mutex::new(Vec::<CoreEvent>::new()));
    let listener_events = events.clone();
    core.subscribe(Box::new(move |event| {
        listener_events.lock().unwrap().push(event.clone());
    }));

    let check_one = |events: &Mutex<Vec<CoreEvent>>| {
        let mut events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], CoreEvent::StateChanged { .. }));
        events.clear();
    };
    let (workspace_id, desktop_id) = active_ids(&core);

    core.handle(CoreRequest::DesktopActivate {
        desktop_id: desktop_id.clone(),
    })
    .unwrap();
    check_one(&events);

    let created_workspace = match core
        .handle(CoreRequest::WorkspaceCreate {
            name: "추가 작업".into(),
        })
        .unwrap()
    {
        CoreReply::WorkspaceCreate { workspace, .. } => workspace.id,
        reply => panic!("unexpected reply: {reply:?}"),
    };
    check_one(&events);
    core.handle(CoreRequest::WorkspaceRename {
        workspace_id: created_workspace.clone(),
        name: "이름 변경".into(),
    })
    .unwrap();
    check_one(&events);
    core.handle(CoreRequest::WorkspaceActivate {
        workspace_id: workspace_id.clone(),
    })
    .unwrap();
    check_one(&events);
    core.handle(CoreRequest::WorkspaceDelete {
        workspace_id: created_workspace,
    })
    .unwrap();
    check_one(&events);

    let second_desktop = match core
        .handle(CoreRequest::DesktopCreate {
            workspace_id: workspace_id.clone(),
            name: "두 번째 데스크톱".into(),
        })
        .unwrap()
    {
        CoreReply::DesktopCreate { desktop } => desktop.id,
        reply => panic!("unexpected reply: {reply:?}"),
    };
    check_one(&events);
    core.handle(CoreRequest::DesktopRename {
        desktop_id: second_desktop.clone(),
        name: "이름 변경".into(),
    })
    .unwrap();
    check_one(&events);
    core.handle(CoreRequest::DesktopActivate {
        desktop_id: desktop_id.clone(),
    })
    .unwrap();
    check_one(&events);
    core.handle(CoreRequest::DesktopActivate {
        desktop_id: second_desktop.clone(),
    })
    .unwrap();
    check_one(&events);
    core.handle(CoreRequest::DesktopDelete {
        desktop_id: second_desktop,
    })
    .unwrap();
    check_one(&events);

    let mut next_definition: Value = serde_json::from_str(&test_definition(MD_EDITOR)).unwrap();
    next_definition["name"] = json!("편집기 v2");
    import(&core, &next_definition.to_string());
    check_one(&events);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    check_one(&events);
    core.handle(CoreRequest::WindowSetRect {
        window_id: window_id.clone(),
        rect: Rect {
            x: 8,
            y: 8,
            width: 880,
            height: 600,
        },
    })
    .unwrap();
    check_one(&events);
    core.handle(CoreRequest::WindowRaise {
        window_id: window_id.clone(),
    })
    .unwrap();
    check_one(&events);
    let mut state = BTreeMap::new();
    state.insert("current_file".into(), json!("notes.md"));
    core.handle(CoreRequest::WindowSetState {
        window_id: window_id.clone(),
        state,
    })
    .unwrap();
    check_one(&events);
    pick_folder(&core, &window_id);
    check_one(&events);
    core.handle(CoreRequest::FilesList {
        window_id: window_id.clone(),
        permission: "docs".into(),
        dir: String::new(),
    })
    .unwrap();
    assert!(events.lock().unwrap().is_empty());
    core.handle(CoreRequest::FilesRead {
        window_id: window_id.clone(),
        permission: "docs".into(),
        path: "notes.md".into(),
    })
    .unwrap();
    assert!(events.lock().unwrap().is_empty());
    core.handle(CoreRequest::FilesWrite {
        window_id: window_id.clone(),
        permission: "docs".into(),
        path: "created.md".into(),
        text: "created".into(),
        expected_revision: None,
    })
    .unwrap();
    assert!(events.lock().unwrap().is_empty());
    core.handle(CoreRequest::WindowClose { window_id }).unwrap();
    check_one(&events);

    core.handle(CoreRequest::StateGet {}).unwrap();
    assert!(events.lock().unwrap().is_empty());
    core.handle(CoreRequest::FilesRead {
        window_id: "missing".into(),
        permission: "docs".into(),
        path: "notes.md".into(),
    })
    .unwrap_err();
    assert!(events.lock().unwrap().is_empty());
}

#[test]
fn unreadable_state_json_is_renamed_and_core_starts_with_empty_state() {
    let temp = TempDir::new().unwrap();
    let data_dir = temp.path().join("data");
    fs::create_dir_all(&data_dir).unwrap();
    fs::write(data_dir.join("state.json"), b"{broken").unwrap();
    let host = Arc::new(FakeHost::default());

    let core = open_core(&data_dir, vec![], &host);
    let snapshot = snapshot(&core);
    assert_eq!(snapshot.shared.workspaces.len(), 1);
    assert_eq!(snapshot.shared.apps.len(), 10);
    assert!(fs::read_dir(&data_dir).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("state.json.broken-")
    }));
}

#[test]
fn invalid_state_and_last_workspace_or_desktop_deletions_are_rejected() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = seeded_core(&temp.path().join("data"), &host);
    let (workspace_id, desktop_id) = active_ids(&core);
    expect_error(
        core.handle(CoreRequest::WorkspaceDelete {
            workspace_id: workspace_id.clone(),
        }),
        ErrorCode::InvalidRequest,
    );
    expect_error(
        core.handle(CoreRequest::DesktopDelete {
            desktop_id: desktop_id.clone(),
        }),
        ErrorCode::InvalidRequest,
    );
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    let mut invalid_state = BTreeMap::new();
    invalid_state.insert("not_declared".into(), JsonValue::Null);
    expect_error(
        core.handle(CoreRequest::WindowSetState {
            window_id,
            state: invalid_state,
        }),
        ErrorCode::InvalidRequest,
    );
}

#[test]
fn link_start_pairs_saves_token_privately_and_connects_after_snapshot() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    *client.pair_start.lock().unwrap() = Some(Ok(PairStartReply {
        device_code: "private-device-code".into(),
        user_code: "K7PQ-4XMR".into(),
        expires_at: "2999-12-31T00:00:00Z".into(),
        interval_secs: 1,
    }));
    client
        .pair_polls
        .lock()
        .unwrap()
        .push_back(Ok(PairPollReply::Approved {
            device_id: "device-1".into(),
            token: "secret-device-token".into(),
        }));
    client
        .streams
        .lock()
        .unwrap()
        .push_back(Ok(vec![DeviceEvent::AppsSnapshot {
            apps: vec![],
            deleted: vec![],
        }]));
    let core = open_core_with_client(&temp.path().join("data"), vec![], &host, client);
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));

    let reply = core.handle(CoreRequest::LinkStart {}).unwrap();
    assert!(matches!(reply, CoreReply::LinkStart { user_code, .. } if user_code == "K7PQ-4XMR"));
    let mut observed = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if let Ok(event) = rx.recv_timeout(Duration::from_millis(50)) {
            let connected = matches!(
                event,
                CoreEvent::StateChanged {
                    snapshot: ShellSnapshot {
                        link: LinkStatus::Connected { .. },
                        ..
                    }
                }
            );
            observed.push(event);
            if connected {
                break;
            }
        }
    }
    assert!(observed.iter().any(|event| matches!(
        event,
        CoreEvent::StateChanged { snapshot: ShellSnapshot { link: LinkStatus::Pairing { user_code, .. }, .. } }
            if user_code == "K7PQ-4XMR"
    )));
    assert!(observed.iter().any(|event| matches!(
        event,
        CoreEvent::StateChanged {
            snapshot: ShellSnapshot {
                link: LinkStatus::Connected { .. },
                ..
            }
        }
    )));
    assert!(observed.iter().all(|event| {
        !serde_json::to_string(event)
            .unwrap()
            .contains("secret-device-token")
    }));
    let link_json = fs::read_to_string(temp.path().join("data/link.json")).unwrap();
    assert!(link_json.contains("secret-device-token"));
    core.handle(CoreRequest::LinkUnlink {}).unwrap();
}

#[test]
fn registry_events_update_cache_dedupe_versions_and_order_open_requests() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let docs = temp.path().join("docs");
    fs::create_dir_all(&docs).unwrap();
    host.choose(Some(docs));
    let client = registry_client();
    let core = open_core_with_client(
        &temp.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
        Arc::clone(&client),
    );
    mark_connected(&core);
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    let mut old_state = BTreeMap::new();
    old_state.insert("current_file".into(), json!("notes/old.md"));
    core.handle(CoreRequest::WindowSetState {
        window_id: window_id.clone(),
        state: old_state,
    })
    .unwrap();
    pick_folder(&core, &window_id);

    let mut next_definition: Value = serde_json::from_str(&test_definition(MD_EDITOR)).unwrap();
    next_definition["name"] = json!("레지스트리 편집기");
    next_definition.as_object_mut().unwrap().remove("opens");
    next_definition["state"] = json!({"new_key": "기본값"});
    next_definition["ui"] = json!({
        "type": "markdown_view",
        "file": { "permission": "docs", "path": "readme.md" }
    });
    let next_json = next_definition.to_string();
    let version7 = registry_app(7, &next_json);
    let mut unsupported: Value = serde_json::from_str(&next_json).unwrap();
    unsupported["requires"]["blocks"] = json!(99);
    client.streams.lock().unwrap().push_back(Ok(vec![
        DeviceEvent::AppsSnapshot {
            apps: vec![version7.clone()],
            deleted: vec![],
        },
        DeviceEvent::AppPublished {
            app: version7,
            open: false,
            workspace_id: None,
        },
        DeviceEvent::AppPublished {
            app: registry_app(8, &unsupported.to_string()),
            open: false,
            workspace_id: None,
        },
        DeviceEvent::AppOpen {
            app_id: "missing-app".into(),
            workspace_id: None,
        },
        DeviceEvent::AppOpen {
            app_id: "test-md-editor".into(),
            workspace_id: None,
        },
        DeviceEvent::AppPublished {
            app: registry_app(8, &next_json),
            open: true,
            workspace_id: None,
        },
    ]));
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    crate::link::start_stream(Arc::clone(&core.inner), 0, connected_link_file());

    let mut events = Vec::new();
    let mut open_requests = 0;
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline && open_requests < 2 {
        if let Ok(event) = rx.recv_timeout(Duration::from_millis(50)) {
            if matches!(event, CoreEvent::AppOpenRequested { .. }) {
                open_requests += 1;
            }
            events.push(event);
        }
    }
    assert_eq!(open_requests, 2);
    let snapshot = snapshot(&core);
    let app = snapshot
        .shared
        .apps
        .iter()
        .find(|app| app.id == "test-md-editor")
        .unwrap();
    assert_eq!(app.current_version, 8);
    assert_eq!(
        snapshot
            .shared
            .app_versions
            .iter()
            .filter(|version| version.app_id == "test-md-editor")
            .count(),
        1
    );
    let window = snapshot
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)
        .unwrap();
    assert_eq!(window.app_version, 8);
    assert_eq!(
        window.state,
        BTreeMap::from([("new_key".into(), json!("기본값"))])
    );
    assert_eq!(snapshot.device.grants.len(), 1);

    let state_changed_indices = events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| {
            matches!(event, CoreEvent::StateChanged { .. }).then_some(index)
        })
        .collect::<Vec<_>>();
    let open_indices = events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| {
            matches!(event, CoreEvent::AppOpenRequested { .. }).then_some(index)
        })
        .collect::<Vec<_>>();
    assert_eq!(state_changed_indices.len(), 2);
    assert!(state_changed_indices[1] < open_indices[1]);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, CoreEvent::AppOpenRequested { app_id, .. } if app_id == "missing-app"))
            .count(),
        0
    );
    core.handle(CoreRequest::LinkUnlink {}).unwrap();
}

#[test]
fn connected_import_uploads_and_preserves_server_validation_error() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(
        &temp.path().join("data"),
        vec![],
        &host,
        Arc::clone(&client),
    );
    mark_connected(&core);
    client
        .uploads
        .lock()
        .unwrap()
        .push_back(Ok(registry_app(42, &test_definition(MD_EDITOR))));
    let reply = core
        .handle(CoreRequest::AppImport {
            definition_json: test_definition(MD_EDITOR),
        })
        .unwrap();
    assert!(
        matches!(reply, CoreReply::AppImport { app, version } if app.current_version == 42 && version.version == 42)
    );
    assert_eq!(
        client.upload_requests.lock().unwrap()[0].definition_json,
        test_definition(MD_EDITOR)
    );
    assert_eq!(
        snapshot(&core)
            .shared
            .apps
            .iter()
            .find(|app| app.id == "test-md-editor")
            .unwrap()
            .current_version,
        42
    );

    let expected = CoreError {
        code: ErrorCode::UnsupportedApp,
        message: "서버 검사 실패 원문".into(),
        details: vec!["requires.blocks=99".into()],
    };
    client
        .uploads
        .lock()
        .unwrap()
        .push_back(Err(RegistryError::Validation(expected.clone())));
    let actual = expect_error(
        core.handle(CoreRequest::AppImport {
            definition_json: test_definition(MD_EDITOR),
        }),
        ErrorCode::UnsupportedApp,
    );
    assert_eq!(actual, expected);

    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        server_url: "https://registry.test".into(),
        device_name: "test-device".into(),
        reason: "offline".into(),
    };
    let error = expect_error(
        core.handle(CoreRequest::AppImport {
            definition_json: test_definition(MD_EDITOR),
        }),
        ErrorCode::Server,
    );
    assert_eq!(
        error.message,
        "kaleidoscope 서버에 연결되어 있지 않아 앱을 가져올 수 없습니다."
    );
}

#[test]
fn regression_unlinked_import_persists_removed_folder_grants() {
    let temp = TempDir::new().unwrap();
    let data_dir = temp.path().join("data");
    let host = Arc::new(FakeHost::default());
    let docs = temp.path().join("docs");
    fs::create_dir_all(&docs).unwrap();
    host.choose(Some(docs));
    let core = seeded_core(&data_dir, &host);
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    pick_folder(&core, &window_id);
    assert_eq!(snapshot(&core).device.grants.len(), 1);

    let mut next_definition: Value = serde_json::from_str(&test_definition(MD_EDITOR)).unwrap();
    next_definition["permissions"] = json!([
        { "module": "files", "id": "manuals", "access": "readwrite", "label": "문서 폴더" }
    ]);
    next_definition["ui"]["children"][0]["root"]["permission"] = json!("manuals");
    next_definition["ui"]["children"][1]["file"]["permission"] = json!("manuals");
    next_definition["opens"]["permission"] = json!("manuals");
    import(&core, &next_definition.to_string());
    assert!(snapshot(&core).device.grants.is_empty());
    drop(core);

    let reopened = open_core(&data_dir, vec![], &host);
    assert!(snapshot(&reopened).device.grants.is_empty());
}

#[test]
fn connected_import_persists_removed_folder_grants() {
    let temp = TempDir::new().unwrap();
    let data_dir = temp.path().join("data");
    let host = Arc::new(FakeHost::default());
    let docs = temp.path().join("docs");
    fs::create_dir_all(&docs).unwrap();
    host.choose(Some(docs));
    let client = registry_client();
    let core = open_core_with_client(
        &data_dir,
        vec![test_definition(MD_EDITOR)],
        &host,
        Arc::clone(&client),
    );
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    pick_folder(&core, &window_id);
    assert_eq!(snapshot(&core).device.grants.len(), 1);

    let mut next_definition: Value = serde_json::from_str(&test_definition(MD_EDITOR)).unwrap();
    next_definition["permissions"] = json!([
        { "module": "files", "id": "manuals", "access": "readwrite", "label": "문서 폴더" }
    ]);
    next_definition["ui"]["children"][0]["root"]["permission"] = json!("manuals");
    next_definition["ui"]["children"][1]["file"]["permission"] = json!("manuals");
    next_definition["opens"]["permission"] = json!("manuals");
    let definition_json = next_definition.to_string();
    client
        .uploads
        .lock()
        .unwrap()
        .push_back(Ok(registry_app(2, &definition_json)));
    mark_connected(&core);
    core.handle(CoreRequest::AppImport { definition_json })
        .unwrap();

    assert!(snapshot(&core).device.grants.is_empty());
    drop(core);

    let reopened = open_core_with_client(&data_dir, vec![], &host, registry_client());
    assert!(snapshot(&reopened).device.grants.is_empty());
}

#[test]
fn registry_snapshot_applies_server_version_when_only_old_cached_version_matches() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(
        &temp.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
        Arc::clone(&client),
    );
    let mut local_v2: Value = serde_json::from_str(&test_definition(MD_EDITOR)).unwrap();
    local_v2["name"] = json!("로컬 편집기 v2");
    import(&core, &local_v2.to_string());
    assert_eq!(
        snapshot(&core)
            .shared
            .apps
            .iter()
            .find(|app| app.id == "test-md-editor")
            .unwrap()
            .current_version,
        2
    );

    mark_connected(&core);
    client
        .streams
        .lock()
        .unwrap()
        .push_back(Ok(vec![DeviceEvent::AppsSnapshot {
            apps: vec![registry_app(1, &test_definition(MD_EDITOR))],
            deleted: vec![],
        }]));
    crate::link::start_stream(Arc::clone(&core.inner), 0, connected_link_file());

    wait_until(|| {
        snapshot(&core)
            .shared
            .apps
            .iter()
            .any(|app| app.id == "test-md-editor" && app.current_version == 1)
    });
    let state = snapshot(&core).shared;
    assert_eq!(
        state
            .apps
            .iter()
            .find(|app| app.id == "test-md-editor")
            .unwrap()
            .name,
        "마크다운 편집기"
    );
    let versions: Vec<_> = state
        .app_versions
        .iter()
        .filter(|version| version.app_id == "test-md-editor")
        .collect();
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].version, 1);
    core.handle(CoreRequest::LinkUnlink {}).unwrap();
}

#[test]
fn saved_link_reconnects_and_unauthorized_stream_revokes_it() {
    let temp = TempDir::new().unwrap();
    let data_dir = temp.path().join("data");
    fs::create_dir_all(&data_dir).unwrap();
    let file = connected_link_file();
    fs::write(
        data_dir.join("link.json"),
        serde_json::to_vec(&file).unwrap(),
    )
    .unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .streams
        .lock()
        .unwrap()
        .push_back(Err(RegistryError::Unauthorized));
    let core = open_core_with_client(&data_dir, vec![], &host, Arc::clone(&client));
    wait_until(|| matches!(snapshot(&core).link, LinkStatus::Revoked { .. }));
    assert_eq!(client.open_calls.load(Ordering::SeqCst), 1);
    assert!(!data_dir.join("link.json").exists());
    assert!(!serde_json::to_string(&snapshot(&core))
        .unwrap()
        .contains("secret-device-token"));
}

#[test]
fn cancel_and_unlink_clear_only_connection_state() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    *client.pair_start.lock().unwrap() = Some(Ok(PairStartReply {
        device_code: "private-device-code".into(),
        user_code: "K7PQ-4XMR".into(),
        expires_at: "2999-12-31T00:00:00Z".into(),
        interval_secs: 1,
    }));
    client
        .pair_polls
        .lock()
        .unwrap()
        .push_back(Ok(PairPollReply::Pending {}));
    let data_dir = temp.path().join("data");
    let core = open_core_with_client(&data_dir, vec![test_definition(MD_EDITOR)], &host, client);
    let before = snapshot(&core).shared;
    core.handle(CoreRequest::LinkStart {}).unwrap();
    core.handle(CoreRequest::LinkCancel {}).unwrap();
    assert!(matches!(snapshot(&core).link, LinkStatus::Unlinked {}));

    let file = connected_link_file();
    crate::storage::save_link(&data_dir, &file).unwrap();
    *core.inner.link_file.lock().unwrap() = Some(file.clone());
    core.inner.state.lock().unwrap().link = LinkStatus::Connected {
        server_url: file.server_url,
        device_name: file.device_name,
    };
    core.handle(CoreRequest::LinkUnlink {}).unwrap();
    assert!(matches!(snapshot(&core).link, LinkStatus::Unlinked {}));
    assert!(!data_dir.join("link.json").exists());
    assert_eq!(snapshot(&core).shared, before);
}

#[test]
fn conversation_commands_resolve_the_window_and_advertise_agent_three() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = seeded_core(temp.path(), &host);
    for request in [
        serde_json::json!({"op":"conversation.get","window_id":"w"}),
        serde_json::json!({"op":"conversation.history","window_id":"w","before":"c"}),
        serde_json::json!({"op":"conversation.create","window_id":"w","model":"m"}),
        serde_json::json!({"op":"conversation.send","window_id":"w","request_id":"r","text":"안녕","attachments":[]}),
        serde_json::json!({"op":"conversation.attachment","window_id":"w","item_id":"i","attachment_id":"a"}),
        serde_json::json!({"op":"conversation.attachment_open","window_id":"w","item_id":"i","attachment_id":"a"}),
    ] {
        let request = serde_json::from_value(request).unwrap();
        expect_error(core.handle(request), ErrorCode::NotFound);
    }
    assert_eq!(snapshot(&core).supported.modules.get("agent"), Some(&3));
}

#[test]
fn layout_report_sends_sanitized_initial_state_and_debounces_changes() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(
        &temp.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
        Arc::clone(&client),
    );
    mark_connected(&core);
    let (workspace_id, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "test-md-editor");
    let root = temp.path().join("private-folder");
    fs::create_dir_all(&root).unwrap();
    host.choose(Some(root.clone()));
    pick_folder(&core, &window_id);

    assert!(crate::registry_events::apply_event(
        &Arc::clone(&core.inner),
        0,
        DeviceEvent::AppsSnapshot {
            apps: vec![],
            deleted: vec![]
        },
    ));
    wait_until(|| client.layouts.lock().unwrap().len() == 1);
    let first = client.layouts.lock().unwrap()[0].clone();
    assert_eq!(first.workspaces[0].id, workspace_id);
    assert!(first.windows.iter().any(|window| window.id == window_id));
    assert_eq!(first.folders[0].window_id, window_id);
    assert_eq!(first.folders[0].root_name, "private-folder");
    assert!(!serde_json::to_string(&first)
        .unwrap()
        .contains(&root.to_string_lossy().to_string()));

    for x in [42, 64] {
        core.handle(CoreRequest::WindowSetRect {
            window_id: window_id.clone(),
            rect: Rect {
                x,
                y: 20,
                width: 300,
                height: 250,
            },
        })
        .unwrap();
    }
    wait_until(|| client.layouts.lock().unwrap().len() == 2);
    thread::sleep(Duration::from_millis(1200));
    assert_eq!(client.layouts.lock().unwrap().len(), 2);
    assert_eq!(client.layouts.lock().unwrap()[1].windows[0].rect.x, 64);

    core.inner.emit(&CoreEvent::StateChanged {
        snapshot: snapshot(&core),
    });
    thread::sleep(Duration::from_millis(1200));
    assert_eq!(client.layouts.lock().unwrap().len(), 2);
    core.handle(CoreRequest::LinkUnlink {}).unwrap();
}

mod data_tests;
mod oauth_tests;
mod web_tests;

mod local_agent_tests;
mod local_agent_wiring_tests;
