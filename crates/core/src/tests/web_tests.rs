use super::*;

mod nested;

/// 고른 폴더 범위의 탐색기(계약 8판 모양). examples/explorer.json은 내 PC 범위로 바뀌었고,
/// 이 시험들은 폴더 범위의 열기 규칙을 본다.
const FOLDER_EXPLORER: &str = r#"{
  "id": "explorer",
  "name": "탐색기",
  "requires": { "blocks": 5, "modules": { "files": 1 } },
  "permissions": [
    { "module": "files", "id": "folder", "access": "read", "label": "볼 폴더" }
  ],
  "state": { "folder": "", "view": "icons" },
  "ui": {
    "type": "explorer",
    "root": { "permission": "folder" },
    "folder": { "state": "folder" },
    "on_folder": { "set_state": "folder" },
    "view": { "state": "view" },
    "on_view": { "set_state": "view" }
  }
}"#;

#[test]
fn explorer_opens_and_reuses_editor_with_folder_grant() {
    let data = TempDir::new().unwrap();
    let docs = TempDir::new().unwrap();
    fs::write(docs.path().join("a.MD"), "a").unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(
        data.path(),
        vec![MD_EDITOR.into(), FOLDER_EXPLORER.into()],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let explorer = open_window(&core, &desktop, "explorer");
    host.choose(Some(docs.path().into()));
    core.handle(CoreRequest::FilesPickFolder {
        window_id: explorer.clone(),
        permission: "folder".into(),
    })
    .unwrap();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observed_copy = observed.clone();
    core.subscribe(Box::new(move |event| {
        observed_copy.lock().unwrap().push(event.clone())
    }));
    let open = || {
        core.handle(CoreRequest::FilesOpen {
            window_id: explorer.clone(),
            permission: "folder".into(),
            path: "a.MD".into(),
            app_id: "md-editor".into(),
            rect: None,
        })
    };
    let window = match open().unwrap() {
        CoreReply::FilesOpen { window } => window,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        observed
            .lock()
            .unwrap()
            .iter()
            .filter(|event| matches!(event, CoreEvent::StateChanged { .. }))
            .count(),
        1
    );
    assert_eq!(window.state["current_file"], json!("a.MD"));
    assert_eq!(
        snapshot(&core)
            .device
            .grants
            .iter()
            .find(|g| g.window_id == window.id)
            .unwrap()
            .root_path,
        fs::canonicalize(docs.path()).unwrap().to_string_lossy()
    );
    let revision = match core
        .handle(CoreRequest::FilesRead {
            window_id: window.id.clone(),
            permission: "docs".into(),
            path: "a.MD".into(),
        })
        .unwrap()
    {
        CoreReply::FilesRead { revision, .. } => revision,
        _ => unreachable!(),
    };
    core.handle(CoreRequest::FilesWrite {
        window_id: window.id.clone(),
        permission: "docs".into(),
        path: "a.MD".into(),
        text: "changed".into(),
        expected_revision: Some(revision),
    })
    .unwrap();
    assert!(matches!(open().unwrap(), CoreReply::FilesOpen { window: w } if w.id == window.id));
}

#[test]
fn explorer_open_reports_missing_grant_file_and_extension() {
    let data = TempDir::new().unwrap();
    let docs = TempDir::new().unwrap();
    fs::write(docs.path().join("a.txt"), "a").unwrap();
    fs::create_dir(docs.path().join("dir.md")).unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(
        data.path(),
        vec![MD_EDITOR.into(), FOLDER_EXPLORER.into()],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let explorer = open_window(&core, &desktop, "explorer");
    let open = |path: &str| {
        core.handle(CoreRequest::FilesOpen {
            window_id: explorer.clone(),
            permission: "folder".into(),
            path: path.into(),
            app_id: "md-editor".into(),
            rect: None,
        })
    };
    expect_error(open("a.md"), ErrorCode::NotGranted);
    host.choose(Some(docs.path().into()));
    core.handle(CoreRequest::FilesPickFolder {
        window_id: explorer.clone(),
        permission: "folder".into(),
    })
    .unwrap();
    expect_error(open("a.md"), ErrorCode::NotFound);
    expect_error(open("a.txt"), ErrorCode::InvalidRequest);
    expect_error(open("dir.md"), ErrorCode::InvalidRequest);
}

#[derive(Default)]
struct FakeWebHost {
    calls: Mutex<Vec<String>>,
}
impl crate::WebHost for FakeWebHost {
    fn attach(&self, id: &str, url: &str) -> Result<kaleidoscope_contract::WebPage, CoreError> {
        if url == "http://tauri.localhost/" {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        self.calls
            .lock()
            .unwrap()
            .push(format!("attach {id} {url}"));
        Ok(kaleidoscope_contract::WebPage {
            url: url.into(),
            title: String::new(),
            loading: false,
            can_go_back: false,
            can_go_forward: false,
        })
    }
    fn place(&self, id: &str, _: Option<Rect>) -> Result<(), CoreError> {
        self.calls.lock().unwrap().push(format!("place {id}"));
        Ok(())
    }
    fn navigate(&self, id: &str, url: &str) -> Result<(), CoreError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("navigate {id} {url}"));
        Ok(())
    }
    fn history(
        &self,
        id: &str,
        _: kaleidoscope_contract::WebHistoryAction,
    ) -> Result<(), CoreError> {
        self.calls.lock().unwrap().push(format!("history {id}"));
        Ok(())
    }
    fn capture(&self, _: &str) -> Result<Option<Vec<u8>>, CoreError> {
        Ok(Some(vec![1, 2, 3]))
    }
    fn detach(&self, id: &str) -> Result<(), CoreError> {
        self.calls.lock().unwrap().push(format!("detach {id}"));
        Ok(())
    }
}
#[derive(Default)]
struct HostWithWeb {
    web: FakeWebHost,
}
impl Host for HostWithWeb {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }
    fn web(&self) -> Option<&dyn crate::WebHost> {
        Some(&self.web)
    }
}

#[test]
fn web_commands_validate_and_delegate_and_emit_updates() {
    let data = TempDir::new().unwrap();
    let host = Arc::new(HostWithWeb::default());
    let core = Core::open(
        CoreConfig {
            data_dir: data.path().into(),
            seed_definitions: vec![
                include_str!("../../../../examples/web-browser.json").into(),
                MD_EDITOR.into(),
            ],
            server_url: "http://localhost".into(),
            device_name: "test".into(),
        },
        host.clone(),
    )
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "web-browser");
    let editor = open_window(&core, &desktop, "md-editor");
    expect_error(
        core.handle(CoreRequest::WebAttach {
            window_id: editor,
            url: "https://example.com".into(),
        }),
        ErrorCode::InvalidRequest,
    );
    expect_error(
        core.handle(CoreRequest::WebAttach {
            window_id: window.clone(),
            url: "file:///secret".into(),
        }),
        ErrorCode::InvalidRequest,
    );
    assert!(matches!(
        core.handle(CoreRequest::WebAttach {
            window_id: window.clone(),
            url: "https://example.com".into()
        }),
        Ok(CoreReply::WebAttach { .. })
    ));
    expect_error(
        core.handle(CoreRequest::WebAttach {
            window_id: window.clone(),
            url: "http://tauri.localhost/".into(),
        }),
        ErrorCode::InvalidRequest,
    );
    core.handle(CoreRequest::WebPlace {
        window_id: window.clone(),
        bounds: Some(Rect {
            x: 1,
            y: 2,
            width: 300,
            height: 200,
        }),
    })
    .unwrap();
    core.handle(CoreRequest::WebNavigate {
        window_id: window.clone(),
        url: "https://example.org".into(),
    })
    .unwrap();
    core.handle(CoreRequest::WebHistory {
        window_id: window.clone(),
        action: kaleidoscope_contract::WebHistoryAction::Back,
    })
    .unwrap();
    assert!(
        matches!(core.handle(CoreRequest::WebCapture { window_id: window.clone() }).unwrap(), CoreReply::WebCapture { image: Some(s) } if s == "data:image/png;base64,AQID")
    );
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_copy = events.clone();
    core.subscribe(Box::new(move |e| {
        events_copy.lock().unwrap().push(e.clone())
    }));
    let page = kaleidoscope_contract::WebPage {
        url: "https://example.org/".into(),
        title: "Example".into(),
        loading: false,
        can_go_back: true,
        can_go_forward: false,
    };
    core.web_update(&window, page.clone());
    assert_eq!(
        snapshot(&core)
            .shared
            .windows
            .iter()
            .find(|w| w.id == window)
            .unwrap()
            .state["url"],
        json!("https://example.org/")
    );
    assert_eq!(
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| matches!(e, CoreEvent::StateChanged { .. }))
            .count(),
        1
    );
    core.web_update(&window, page);
    assert_eq!(
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| matches!(e, CoreEvent::StateChanged { .. }))
            .count(),
        1
    );
    core.handle(CoreRequest::WindowClose {
        window_id: window.clone(),
    })
    .unwrap();
    let calls = host.web.calls.lock().unwrap();
    assert!(calls.contains(&format!("place {window}")));
    assert!(calls.contains(&format!("history {window}")));
    assert!(calls.contains(&format!("navigate {window} https://example.org")));
    assert!(calls.contains(&format!("detach {window}")));
}

#[test]
fn explorer_opens_new_window_for_a_different_folder() {
    let data = TempDir::new().unwrap();
    let first = TempDir::new().unwrap();
    let second = TempDir::new().unwrap();
    fs::write(first.path().join("a.md"), "a").unwrap();
    fs::write(second.path().join("a.md"), "b").unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(
        data.path(),
        vec![MD_EDITOR.into(), FOLDER_EXPLORER.into()],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let explorer = open_window(&core, &desktop, "explorer");
    let run = |folder: &Path| {
        host.choose(Some(folder.into()));
        core.handle(CoreRequest::FilesPickFolder {
            window_id: explorer.clone(),
            permission: "folder".into(),
        })
        .unwrap();
        match core
            .handle(CoreRequest::FilesOpen {
                window_id: explorer.clone(),
                permission: "folder".into(),
                path: "a.md".into(),
                app_id: "md-editor".into(),
                rect: None,
            })
            .unwrap()
        {
            CoreReply::FilesOpen { window } => window,
            _ => unreachable!(),
        }
    };
    let a = run(first.path());
    let b = run(second.path());
    assert_ne!(a.id, b.id);
    assert_eq!(
        snapshot(&core)
            .device
            .grants
            .iter()
            .filter(|g| g.window_id == a.id || g.window_id == b.id)
            .count(),
        2
    );
}

#[test]
fn web_without_host_is_unavailable_and_detach_is_idempotent() {
    let data = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(
        data.path(),
        vec![include_str!("../../../../examples/web-browser.json").into()],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "web-browser");
    expect_error(
        core.handle(CoreRequest::WebAttach {
            window_id: window.clone(),
            url: "https://example.com".into(),
        }),
        ErrorCode::Unavailable,
    );
    assert!(core
        .handle(CoreRequest::WebDetach { window_id: window })
        .is_ok());
}

#[test]
fn web_detaches_when_definition_loses_web_block() {
    let data = TempDir::new().unwrap();
    let host = Arc::new(HostWithWeb::default());
    let core = Core::open(
        CoreConfig {
            data_dir: data.path().into(),
            seed_definitions: vec![include_str!("../../../../examples/web-browser.json").into()],
            server_url: "http://localhost".into(),
            device_name: "test".into(),
        },
        host.clone(),
    )
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "web-browser");
    core.handle(CoreRequest::WebAttach {
        window_id: window.clone(),
        url: "https://example.com".into(),
    })
    .unwrap();
    let mut definition: Value = serde_json::from_str(MD_EDITOR).unwrap();
    definition["id"] = json!("web-browser");
    import(&core, &definition.to_string());
    assert!(host
        .web
        .calls
        .lock()
        .unwrap()
        .contains(&format!("detach {window}")));
}

#[test]
fn removing_desktop_detaches_only_its_web_windows() {
    let data = TempDir::new().unwrap();
    let host = Arc::new(HostWithWeb::default());
    let core = Core::open(
        CoreConfig {
            data_dir: data.path().into(),
            seed_definitions: vec![include_str!("../../../../examples/web-browser.json").into()],
            server_url: "http://localhost".into(),
            device_name: "test".into(),
        },
        host.clone(),
    )
    .unwrap();
    let (workspace, first) = active_ids(&core);
    let second = match core
        .handle(CoreRequest::DesktopCreate {
            workspace_id: workspace,
            name: "둘".into(),
        })
        .unwrap()
    {
        CoreReply::DesktopCreate { desktop } => desktop.id,
        _ => unreachable!(),
    };
    let a = open_window(&core, &first, "web-browser");
    let b = open_window(&core, &second, "web-browser");
    for window_id in [&a, &b] {
        core.handle(CoreRequest::WebAttach {
            window_id: window_id.clone(),
            url: "https://example.com".into(),
        })
        .unwrap();
    }
    core.handle(CoreRequest::DesktopDelete { desktop_id: second })
        .unwrap();
    let calls = host.web.calls.lock().unwrap();
    assert!(calls.contains(&format!("detach {b}")));
    assert!(!calls.contains(&format!("detach {a}")));
}

mod sync;
