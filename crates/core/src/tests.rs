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
    DeviceEvent, DeviceUploadRequest, PairPollReply, PairPollRequest, PairStartReply,
    PairStartRequest, RegistryApp,
};
use kaleidoscope_contract::{
    App, AppVersion, CoreEvent, ErrorCode, JsonValue, LinkStatus, Rect, ShellSnapshot,
};
use serde_json::{json, Value};
use tempfile::TempDir;

use crate::registry_client::{RegistryClient, RegistryError};
use crate::storage::LinkFile;
use crate::{Core, CoreConfig, CoreError, CoreReply, CoreRequest, Host};

const MD_EDITOR: &str = include_str!("../../../examples/md-editor.json");
const MD_VIEWER: &str = include_str!("../../../examples/md-viewer.json");

#[derive(Default)]
struct FakeHost {
    selected: Mutex<Option<PathBuf>>,
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

fn seeded_core(data_dir: &Path, host: &Arc<FakeHost>) -> Core {
    open_core(data_dir, vec![MD_EDITOR.to_string()], host)
}

fn snapshot(core: &Core) -> ShellSnapshot {
    match core.handle(CoreRequest::StateGet {}).unwrap() {
        CoreReply::StateGet { snapshot } => snapshot,
        reply => panic!("unexpected reply: {reply:?}"),
    }
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
    pair_start: Mutex<Option<Result<PairStartReply, RegistryError>>>,
    pair_polls: Mutex<VecDeque<Result<PairPollReply, RegistryError>>>,
    uploads: Mutex<VecDeque<Result<RegistryApp, RegistryError>>>,
    streams: Mutex<VecDeque<Result<Vec<DeviceEvent>, RegistryError>>>,
    upload_requests: Mutex<Vec<DeviceUploadRequest>>,
    open_calls: AtomicUsize,
}

impl RegistryClient for FakeRegistryClient {
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
    Core::open_with_client(
        CoreConfig {
            data_dir: data_dir.to_path_buf(),
            seed_definitions: definitions,
            server_url: "https://registry.test".into(),
            device_name: "test-device".into(),
        },
        host.clone(),
        client,
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
    let mut definition: Value = serde_json::from_str(MD_EDITOR).unwrap();
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
    let window_id = open_window(&core, &desktop_id, "md-editor");
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
fn file_commands_enforce_declared_access_and_folder_grants() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("docs");
    fs::create_dir_all(&root).unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root));
    let core = seeded_core(&temp.path().join("data"), &host);
    let (_, desktop_id) = active_ids(&core);
    let editor_id = open_window(&core, &desktop_id, "md-editor");
    let viewer = import(&core, MD_VIEWER);
    assert!(matches!(viewer, CoreReply::AppImport { .. }));
    let viewer_id = open_window(&core, &desktop_id, "md-viewer");

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
    let window_id = open_window(&core, &desktop_id, "md-editor");
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
    let window_id = open_window(&core, &desktop_id, "md-editor");
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
    let window_id = open_window(&core, &desktop_id, "md-editor");
    pick_folder(&core, &window_id);
    let mut old_state = BTreeMap::new();
    old_state.insert("current_file".into(), json!("old.md"));
    core.handle(CoreRequest::WindowSetState {
        window_id: window_id.clone(),
        state: old_state,
    })
    .unwrap();

    let mut definition: Value = serde_json::from_str(MD_EDITOR).unwrap();
    definition["name"] = json!("마크다운 편집기 새 버전");
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
        .find(|app| app.id == "md-editor")
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

    let mut unsupported: Value = serde_json::from_str(MD_EDITOR).unwrap();
    unsupported["requires"]["blocks"] = json!(2);
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

    let mut next_definition: Value = serde_json::from_str(MD_EDITOR).unwrap();
    next_definition["name"] = json!("편집기 v2");
    import(&core, &next_definition.to_string());
    check_one(&events);
    let window_id = open_window(&core, &desktop_id, "md-editor");
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
    assert!(snapshot.shared.apps.is_empty());
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
    let window_id = open_window(&core, &desktop_id, "md-editor");
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
        .push_back(Ok(vec![DeviceEvent::AppsSnapshot { apps: vec![] }]));
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
        vec![MD_EDITOR.into()],
        &host,
        Arc::clone(&client),
    );
    mark_connected(&core);
    let (_, desktop_id) = active_ids(&core);
    let window_id = open_window(&core, &desktop_id, "md-editor");
    let mut old_state = BTreeMap::new();
    old_state.insert("current_file".into(), json!("notes/old.md"));
    core.handle(CoreRequest::WindowSetState {
        window_id: window_id.clone(),
        state: old_state,
    })
    .unwrap();
    pick_folder(&core, &window_id);

    let mut next_definition: Value = serde_json::from_str(MD_EDITOR).unwrap();
    next_definition["name"] = json!("레지스트리 편집기");
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
        },
        DeviceEvent::AppPublished {
            app: version7,
            open: false,
        },
        DeviceEvent::AppPublished {
            app: registry_app(8, &unsupported.to_string()),
            open: false,
        },
        DeviceEvent::AppOpen {
            app_id: "missing-app".into(),
        },
        DeviceEvent::AppOpen {
            app_id: "md-editor".into(),
        },
        DeviceEvent::AppPublished {
            app: registry_app(8, &next_json),
            open: true,
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
        .find(|app| app.id == "md-editor")
        .unwrap();
    assert_eq!(app.current_version, 8);
    assert_eq!(
        snapshot
            .shared
            .app_versions
            .iter()
            .filter(|version| version.app_id == "md-editor")
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
            .filter(|event| matches!(event, CoreEvent::AppOpenRequested { app_id } if app_id == "missing-app"))
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
        .push_back(Ok(registry_app(42, MD_EDITOR)));
    let reply = core
        .handle(CoreRequest::AppImport {
            definition_json: MD_EDITOR.into(),
        })
        .unwrap();
    assert!(
        matches!(reply, CoreReply::AppImport { app, version } if app.current_version == 42 && version.version == 42)
    );
    assert_eq!(
        client.upload_requests.lock().unwrap()[0].definition_json,
        MD_EDITOR
    );
    assert_eq!(snapshot(&core).shared.apps[0].current_version, 42);

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
            definition_json: MD_EDITOR.into(),
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
            definition_json: MD_EDITOR.into(),
        }),
        ErrorCode::Server,
    );
    assert_eq!(
        error.message,
        "kaleidoscope 서버에 연결되어 있지 않아 앱을 가져올 수 없습니다."
    );
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
    let core = open_core_with_client(&data_dir, vec![MD_EDITOR.into()], &host, client);
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
