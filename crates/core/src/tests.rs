use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use kaleidoscope_contract::{CoreEvent, ErrorCode, JsonValue, Rect, ShellSnapshot};
use serde_json::{json, Value};
use tempfile::TempDir;

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
