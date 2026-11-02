use super::*;

fn writable_core(temp: &TempDir, root: &Path, host: &Arc<FakeHost>) -> (Core, String) {
    host.choose(Some(root.to_path_buf()));
    let core = seeded_core(&temp.path().join("data"), host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "docs".into(),
    })
    .unwrap();
    (core, window)
}

fn mkdir(core: &Core, window: &str, name: &str) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::FilesMkdir {
        window_id: window.into(),
        permission: "docs".into(),
        parent: String::new(),
        name: name.into(),
    })
}

#[test]
fn file_write_commands_validate_names_and_emit_grant_relative_changes() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("documents");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("note.txt"), "hello").unwrap();
    let host = Arc::new(FakeHost::default());
    let (core, window) = writable_core(&temp, &root, &host);
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));

    assert!(matches!(
        mkdir(&core, &window, "notes").unwrap(),
        CoreReply::FilesMkdir { path } if path == "notes"
    ));
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(1)).unwrap(),
        CoreEvent::FilesChanged { root: event_root, changes }
            if event_root == fs::canonicalize(&root).unwrap().to_string_lossy()
                && changes == vec![kaleidoscope_contract::FileChange {
                    from: None,
                    to: Some("notes".into()),
                }]
    ));
    assert_eq!(
        mkdir(&core, &window, "notes").unwrap_err().code,
        ErrorCode::Conflict
    );
    for name in ["", ".", "..", "bad:name", "NUL.txt", "trailing."] {
        assert_eq!(
            mkdir(&core, &window, name).unwrap_err().code,
            ErrorCode::InvalidName
        );
    }

    let CoreReply::FilesRename { from, to } = core
        .handle(CoreRequest::FilesRename {
            window_id: window.clone(),
            permission: "docs".into(),
            path: "note.txt".into(),
            name: "renamed.txt".into(),
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert_eq!((from.as_str(), to.as_str()), ("note.txt", "renamed.txt"));
    assert_eq!(
        fs::read_to_string(root.join("renamed.txt")).unwrap(),
        "hello"
    );

    assert_eq!(
        core.handle(CoreRequest::FilesWrite {
            window_id: window.clone(),
            permission: "docs".into(),
            path: "renamed.txt".into(),
            text: "overwrite".into(),
            expected_revision: None,
        })
        .unwrap_err()
        .code,
        ErrorCode::Conflict
    );
    assert_eq!(
        fs::read_to_string(root.join("renamed.txt")).unwrap(),
        "hello"
    );

    for expected in ["renamed - 복사본.txt", "renamed - 복사본 (2).txt"] {
        let CoreReply::FilesCopy { results } = core
            .handle(CoreRequest::FilesCopy {
                window_id: window.clone(),
                permission: "docs".into(),
                paths: vec!["renamed.txt".into()],
                destination: String::new(),
            })
            .unwrap()
        else {
            panic!("unexpected reply")
        };
        assert!(matches!(
            &results[0],
            kaleidoscope_contract::FileOpResult::Ok { path, ok }
                if path == "renamed.txt" && ok.to.as_deref() == Some(expected)
        ));
    }

    fs::create_dir(root.join("notes/sub")).unwrap();
    let CoreReply::FilesMove { results } = core
        .handle(CoreRequest::FilesMove {
            window_id: window.clone(),
            permission: "docs".into(),
            paths: vec!["notes".into()],
            destination: "notes/sub".into(),
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert!(matches!(
        &results[0],
        kaleidoscope_contract::FileOpResult::Error { error, .. }
            if error.code == ErrorCode::PathOutsideRoot
    ));
    assert!(root.join("notes/sub").is_dir());

    let CoreReply::FilesMove { results } = core
        .handle(CoreRequest::FilesMove {
            window_id: window.clone(),
            permission: "docs".into(),
            paths: vec!["renamed.txt".into()],
            destination: "notes".into(),
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert!(matches!(
        &results[0],
        kaleidoscope_contract::FileOpResult::Ok { ok, .. }
            if ok.from.as_deref() == Some("renamed.txt")
                && ok.to.as_deref() == Some("notes/renamed.txt")
    ));

    fs::create_dir(root.join("source")).unwrap();
    fs::write(root.join("source/occupied.txt"), "source").unwrap();
    fs::write(root.join("notes/occupied.txt"), "keep").unwrap();
    fs::write(root.join("another.txt"), "another").unwrap();
    let CoreReply::FilesMove { results } = core
        .handle(CoreRequest::FilesMove {
            window_id: window.clone(),
            permission: "docs".into(),
            paths: vec!["another.txt".into(), "missing.txt".into()],
            destination: "notes".into(),
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert!(matches!(
        &results[0],
        kaleidoscope_contract::FileOpResult::Ok { path, .. } if path == "another.txt"
    ));
    assert!(matches!(
        &results[1],
        kaleidoscope_contract::FileOpResult::Error { path, error }
            if path == "missing.txt" && error.code == ErrorCode::NotFound
    ));
    let CoreReply::FilesMove { results } = core
        .handle(CoreRequest::FilesMove {
            window_id: window.clone(),
            permission: "docs".into(),
            paths: vec!["source/occupied.txt".into()],
            destination: "notes".into(),
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert!(matches!(
        &results[0],
        kaleidoscope_contract::FileOpResult::Error { error, .. }
            if error.code == ErrorCode::Conflict
    ));
    assert_eq!(
        fs::read_to_string(root.join("notes/occupied.txt")).unwrap(),
        "keep"
    );

    let CoreReply::FilesRemove { results } = core
        .handle(CoreRequest::FilesRemove {
            window_id: window.clone(),
            permission: "docs".into(),
            paths: vec!["notes/renamed.txt".into()],
            permanent: true,
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert!(matches!(
        &results[0],
        kaleidoscope_contract::FileOpResult::Ok { ok, .. }
            if ok.from.as_deref() == Some("notes/renamed.txt") && ok.to.is_none()
    ));
    assert!(!root.join("notes/renamed.txt").exists());

    assert!(matches!(
        core.handle(CoreRequest::FilesPath {
            window_id: window,
            permission: "docs".into(),
            path: "notes".into(),
        })
        .unwrap(),
        CoreReply::FilesPath { text } if Path::new(&text) == root.join("notes")
    ));
}

#[test]
fn file_write_commands_reject_read_pc_roots_and_protected_ancestors() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("documents");
    fs::create_dir(&root).unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root.clone()));
    let core_data = temp.path().join("protected/data");
    let core = seeded_core(&core_data, &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "docs".into(),
    })
    .unwrap();

    let CoreReply::FilesRemove { results } = core
        .handle(CoreRequest::FilesRemove {
            window_id: window.clone(),
            permission: "docs".into(),
            paths: vec![String::new()],
            permanent: true,
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert!(matches!(
        &results[0],
        kaleidoscope_contract::FileOpResult::Error { error, .. }
            if error.code == ErrorCode::PermissionDenied
    ));
    fs::create_dir(core_data.join("private")).unwrap();
    core.inner
        .state
        .lock()
        .unwrap()
        .device
        .grants
        .iter_mut()
        .find(|grant| grant.window_id == window && grant.permission == "docs")
        .unwrap()
        .root_path = temp.path().to_string_lossy().to_string();
    let CoreReply::FilesRemove { results } = core
        .handle(CoreRequest::FilesRemove {
            window_id: window.clone(),
            permission: "docs".into(),
            paths: vec!["protected".into()],
            permanent: true,
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert!(matches!(
        &results[0],
        kaleidoscope_contract::FileOpResult::Error { error, .. }
            if error.code == ErrorCode::PermissionDenied
    ));
    assert!(core_data.exists());

    let CoreReply::FilesMove { results } = core
        .handle(CoreRequest::FilesMove {
            window_id: window.clone(),
            permission: "docs".into(),
            paths: vec!["../outside".into()],
            destination: String::new(),
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert!(matches!(
        &results[0],
        kaleidoscope_contract::FileOpResult::Error { error, .. }
            if error.code == ErrorCode::PathOutsideRoot
    ));
}

#[test]
fn file_write_commands_reject_read_and_pc_permissions() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("documents");
    fs::create_dir(&root).unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root));
    let definition = test_definition(MD_VIEWER);
    let read_data = temp.path().join("read-data");
    let core = open_core(&read_data, vec![definition.to_string()], &host);
    let (_, desktop) = active_ids(&core);
    let read_window = open_window(&core, &desktop, "test-md-viewer");
    core.handle(CoreRequest::FilesPickFolder {
        window_id: read_window.clone(),
        permission: "docs".into(),
    })
    .unwrap();
    assert_eq!(
        core.handle(CoreRequest::FilesMkdir {
            window_id: read_window,
            permission: "docs".into(),
            parent: String::new(),
            name: "new".into(),
        })
        .unwrap_err()
        .code,
        ErrorCode::PermissionDenied
    );

    let mut explorer: serde_json::Value =
        serde_json::from_str(include_str!("../../../../apps/explorer.json")).unwrap();
    explorer["id"] = json!("test-pc-explorer");
    let pc_data = temp.path().join("pc-data");
    let pc_core = open_core(&pc_data, vec![explorer.to_string()], &host);
    let (_, desktop) = active_ids(&pc_core);
    let pc_window = open_window(&pc_core, &desktop, "test-pc-explorer");
    assert_eq!(
        pc_core
            .handle(CoreRequest::FilesMkdir {
                window_id: pc_window,
                permission: "pc".into(),
                parent: String::new(),
                name: "new".into(),
            })
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
}

#[cfg(unix)]
#[test]
fn file_write_commands_reject_links() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = temp.path().join("documents");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("target.txt"), "target").unwrap();
    symlink(root.join("target.txt"), root.join("link.txt")).unwrap();
    let host = Arc::new(FakeHost::default());
    let (core, window) = writable_core(&temp, &root, &host);
    let CoreReply::FilesRemove { results } = core
        .handle(CoreRequest::FilesRemove {
            window_id: window,
            permission: "docs".into(),
            paths: vec!["link.txt".into()],
            permanent: true,
        })
        .unwrap()
    else {
        panic!("unexpected reply")
    };
    assert!(matches!(
        &results[0],
        kaleidoscope_contract::FileOpResult::Error { error, .. }
            if error.code == ErrorCode::PathOutsideRoot
    ));
    assert!(root.join("target.txt").exists());
}
