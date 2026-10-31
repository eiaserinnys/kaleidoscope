use super::*;

fn pc_explorer() -> String {
    let mut definition: Value =
        serde_json::from_str(include_str!("../../../../apps/explorer.json")).unwrap();
    definition["id"] = json!("test-explorer");
    definition["requires"]["modules"]["files"] = json!(2);
    definition["permissions"][0]["id"] = json!("folder");
    definition["ui"]["root"]["permission"] = json!("folder");
    definition["permissions"][0]["scope"] = json!("pc");
    definition["permissions"][0]["label"] = json!("내 PC");
    definition.to_string()
}

#[test]
fn pc_access_allows_root_listing() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![pc_explorer()], &host);
    let (_, desktop) = active_ids(&core);
    let window_id = open_window(&core, &desktop, "test-explorer");
    expect_error(
        core.handle(CoreRequest::FilesAllowPc {
            window_id: "missing".into(),
            permission: "folder".into(),
        }),
        ErrorCode::NotFound,
    );
    expect_error(
        core.handle(CoreRequest::FilesAllowPc {
            window_id: window_id.clone(),
            permission: "missing".into(),
        }),
        ErrorCode::InvalidRequest,
    );
    let list = || {
        core.handle(CoreRequest::FilesList {
            window_id: window_id.clone(),
            permission: "folder".into(),
            dir: "".into(),
        })
    };
    expect_error(list(), ErrorCode::NotGranted);
    core.handle(CoreRequest::FilesAllowPc {
        window_id: window_id.clone(),
        permission: "folder".into(),
    })
    .unwrap();
    assert!(matches!(list().unwrap(), CoreReply::FilesList { entries } if entries.is_empty()));
}

#[test]
fn pc_lists_virtual_roots_and_guards_data_and_links() {
    use kaleidoscope_contract::PcRootKind;
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("disk");
    let data = root.join("private-data");
    let docs = root.join("docs");
    fs::create_dir_all(&docs).unwrap();
    fs::write(docs.join("a.md"), "hello").unwrap();
    let host = Arc::new(FakeHost::default());
    *host.roots.lock().unwrap() = vec![
        crate::PcRoot {
            id: "C".into(),
            kind: PcRootKind::Volume,
            name: "디스크 (C:)".into(),
            path: root.clone(),
        },
        crate::PcRoot {
            id: "documents".into(),
            kind: PcRootKind::Known,
            name: "문서".into(),
            path: docs.clone(),
        },
    ];
    let core = open_core(&data, vec![pc_explorer()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-explorer");
    let list = |dir: &str| {
        core.handle(CoreRequest::FilesList {
            window_id: window.clone(),
            permission: "folder".into(),
            dir: dir.into(),
        })
    };
    let allow = || {
        core.handle(CoreRequest::FilesAllowPc {
            window_id: window.clone(),
            permission: "folder".into(),
        })
    };
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    let first = allow().unwrap();
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(1)).unwrap(),
        CoreEvent::StateChanged { .. }
    ));
    assert_eq!(first, allow().unwrap());
    assert!(rx.try_recv().is_err());
    let second = open_window(&core, &desktop, "test-explorer");
    assert!(matches!(
        core.handle(CoreRequest::FilesList {
            window_id: second,
            permission: "folder".into(),
            dir: "".into()
        })
        .unwrap(),
        CoreReply::FilesList { .. }
    ));
    let CoreReply::FilesList { entries } = list("").unwrap() else {
        panic!()
    };
    assert_eq!(
        entries
            .iter()
            .map(|e| (&*e.path, &*e.name, e.root_kind))
            .collect::<Vec<_>>(),
        vec![
            ("documents", "문서", Some(PcRootKind::Known)),
            ("C", "디스크 (C:)", Some(PcRootKind::Volume))
        ]
    );
    assert!(entries.iter().all(|e| e.size == 0 && e.modified.is_empty()));
    host.roots.lock().unwrap().retain(|r| r.id != "documents");
    let CoreReply::FilesList { entries } = list("").unwrap() else {
        panic!()
    };
    assert_eq!(entries.len(), 1);
    expect_error(list("documents"), ErrorCode::NotFound);
    host.roots.lock().unwrap().push(crate::PcRoot {
        id: "documents".into(),
        kind: PcRootKind::Known,
        name: "문서".into(),
        path: docs.clone(),
    });
    let CoreReply::FilesList { entries } = list("documents").unwrap() else {
        panic!()
    };
    assert_eq!(entries[0].path, "documents/a.md");
    let CoreReply::FilesList { entries } = list("C").unwrap() else {
        panic!()
    };
    assert!(!entries.iter().any(|e| e.name == "private-data"));
    expect_error(list("missing"), ErrorCode::NotFound);
    expect_error(list("C/private-data"), ErrorCode::PermissionDenied);
    expect_error(
        core.handle(CoreRequest::FilesOpen {
            window_id: window.clone(),
            permission: "folder".into(),
            path: "C/private-data/device.json".into(),
            app_id: "test-md-editor".into(),
            rect: None,
        }),
        ErrorCode::PermissionDenied,
    );
    expect_error(
        core.handle(CoreRequest::FilesWrite {
            window_id: window.clone(),
            permission: "folder".into(),
            path: "documents/a.md".into(),
            text: "x".into(),
            expected_revision: None,
        }),
        ErrorCode::PermissionDenied,
    );
    expect_error(
        core.handle(CoreRequest::FilesRead {
            window_id: window.clone(),
            permission: "folder".into(),
            path: "documents/a.md".into(),
        }),
        ErrorCode::NotGranted,
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(temp.path(), docs.join("outside")).unwrap();
        expect_error(list("documents/outside"), ErrorCode::PathOutsideRoot);
        let CoreReply::FilesList { entries } = list("documents").unwrap() else {
            panic!()
        };
        assert!(!entries.iter().any(|e| e.name == "outside"));
    }
    let saved = fs::read_to_string(data.join("device.json")).unwrap();
    assert!(saved.contains("pc_access"));
    let layout = crate::layout_reporter::device_layout(&core.inner.state.lock().unwrap());
    assert!(layout
        .folders
        .iter()
        .any(|f| f.window_id == window && f.permission == "folder" && f.root_name == "내 PC"));
    assert!(!serde_json::to_string(&layout)
        .unwrap()
        .contains(&root.to_string_lossy().to_string()));
}

#[test]
fn pc_open_grants_parent_and_reuses_editor_then_revokes_on_version_change() {
    use kaleidoscope_contract::PcRootKind;
    let temp = TempDir::new().unwrap();
    let docs = temp.path().join("docs");
    let notes = docs.join("notes");
    fs::create_dir_all(&notes).unwrap();
    fs::write(notes.join("a.md"), "a").unwrap();
    fs::write(notes.join("b.md"), "b").unwrap();
    let host = Arc::new(FakeHost::default());
    host.roots.lock().unwrap().push(crate::PcRoot {
        id: "documents".into(),
        kind: PcRootKind::Known,
        name: "문서".into(),
        path: docs,
    });
    let core = open_core(
        &temp.path().join("data"),
        vec![pc_explorer(), test_definition(MD_EDITOR)],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let explorer = open_window(&core, &desktop, "test-explorer");
    let editor = open_window(&core, &desktop, "test-md-editor");
    expect_error(
        core.handle(CoreRequest::FilesAllowPc {
            window_id: editor,
            permission: "docs".into(),
        }),
        ErrorCode::InvalidRequest,
    );
    let open = |path: &str| {
        core.handle(CoreRequest::FilesOpen {
            window_id: explorer.clone(),
            permission: "folder".into(),
            path: path.into(),
            app_id: "test-md-editor".into(),
            rect: None,
        })
    };
    expect_error(open("documents/notes/a.md"), ErrorCode::NotGranted);
    core.handle(CoreRequest::FilesAllowPc {
        window_id: explorer.clone(),
        permission: "folder".into(),
    })
    .unwrap();
    expect_error(open(""), ErrorCode::NotFound);
    expect_error(open("documents/notes"), ErrorCode::InvalidRequest);
    let CoreReply::FilesOpen { window } = open("documents/notes/a.md").unwrap() else {
        panic!()
    };
    assert_eq!(window.state["current_file"], json!("a.md"));
    let grant = snapshot(&core)
        .device
        .grants
        .into_iter()
        .find(|g| g.window_id == window.id)
        .unwrap();
    assert_eq!(
        grant.root_path,
        fs::canonicalize(&notes).unwrap().to_string_lossy()
    );
    assert_eq!(grant.root_name, "notes");
    let CoreReply::FilesOpen { window: reused } = open("documents/notes/b.md").unwrap() else {
        panic!()
    };
    assert_eq!(reused.id, window.id);
    assert_eq!(reused.state["current_file"], json!("b.md"));
    import(&core, &pc_explorer());
    assert_eq!(snapshot(&core).device.pc_access.len(), 1);
    let mut folder_definition: Value = serde_json::from_str(&pc_explorer()).unwrap();
    folder_definition["permissions"][0]["scope"] = json!("folder");
    import(&core, &folder_definition.to_string());
    assert!(snapshot(&core).device.pc_access.is_empty());
}

#[cfg(windows)]
#[test]
fn windows_hidden_and_system_entries_are_omitted() {
    use kaleidoscope_contract::PcRootKind;
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("docs");
    fs::create_dir(&root).unwrap();
    let hidden = root.join("hidden.txt");
    let system = root.join("system.txt");
    fs::write(&hidden, "hidden").unwrap();
    fs::write(&system, "system").unwrap();
    assert!(std::process::Command::new("attrib")
        .arg("+H")
        .arg(&hidden)
        .status()
        .unwrap()
        .success());
    assert!(std::process::Command::new("attrib")
        .arg("+S")
        .arg(&system)
        .status()
        .unwrap()
        .success());
    let host = Arc::new(FakeHost::default());
    host.roots.lock().unwrap().push(crate::PcRoot {
        id: "documents".into(),
        kind: PcRootKind::Known,
        name: "문서".into(),
        path: root.clone(),
    });
    let core = open_core(
        &temp.path().join("data"),
        vec![pc_explorer(), test_definition(MD_EDITOR)],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let pc = open_window(&core, &desktop, "test-explorer");
    core.handle(CoreRequest::FilesAllowPc {
        window_id: pc.clone(),
        permission: "folder".into(),
    })
    .unwrap();
    let CoreReply::FilesList { entries } = core
        .handle(CoreRequest::FilesList {
            window_id: pc,
            permission: "folder".into(),
            dir: "documents".into(),
        })
        .unwrap()
    else {
        panic!()
    };
    assert!(entries.is_empty());
    let folder = open_window(&core, &desktop, "test-md-editor");
    host.choose(Some(root));
    pick_folder(&core, &folder);
    let CoreReply::FilesList { entries } = core
        .handle(CoreRequest::FilesList {
            window_id: folder,
            permission: "docs".into(),
            dir: "".into(),
        })
        .unwrap()
    else {
        panic!()
    };
    assert!(entries.is_empty());
    let _ = std::process::Command::new("attrib")
        .arg("-H")
        .arg(&hidden)
        .status();
    let _ = std::process::Command::new("attrib")
        .arg("-S")
        .arg(&system)
        .status();
}

fn assert_grant_protect_data_dir(core: &Core, window: &str) {
    let list = || {
        core.handle(CoreRequest::FilesList {
            window_id: window.into(),
            permission: "docs".into(),
            dir: "".into(),
        })
    };
    let CoreReply::FilesList { entries } = list().unwrap() else {
        panic!()
    };
    assert!(entries.iter().any(|entry| entry.name == "readme.md"));
    assert!(!entries.iter().any(|entry| entry.name == "private-data"));
    expect_error(
        core.handle(CoreRequest::FilesRead {
            window_id: window.into(),
            permission: "docs".into(),
            path: "private-data/missing.json".into(),
        }),
        ErrorCode::PermissionDenied,
    );
    expect_error(
        core.handle(CoreRequest::FilesRead {
            window_id: window.into(),
            permission: "docs".into(),
            path: "private-data/link.json".into(),
        }),
        ErrorCode::PermissionDenied,
    );
    expect_error(
        core.handle(CoreRequest::FilesWrite {
            window_id: window.into(),
            permission: "docs".into(),
            path: "private-data/new.md".into(),
            text: "x".into(),
            expected_revision: None,
        }),
        ErrorCode::PermissionDenied,
    );
    expect_error(
        core.handle(CoreRequest::FilesOpen {
            window_id: window.into(),
            permission: "docs".into(),
            path: "private-data/link.json".into(),
            app_id: "test-md-editor".into(),
            rect: None,
        }),
        ErrorCode::PermissionDenied,
    );
    expect_error(
        core.handle(CoreRequest::DataMedia {
            window_id: window.into(),
            media: kaleidoscope_contract::data::MediaRef::Resource(
                kaleidoscope_contract::data::ResourceMediaRef {
                    permission: "docs".into(),
                    path: "private-data/link.json".into(),
                    query: Default::default(),
                    crop: None,
                },
            ),
            max_px: None,
        }),
        ErrorCode::PermissionDenied,
    );
}

#[test]
fn pc_opened_parent_grant_must_protect_data_dir() {
    use kaleidoscope_contract::PcRootKind;
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("sandbox");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("readme.md"), "readme").unwrap();
    let host = Arc::new(FakeHost::default());
    host.roots.lock().unwrap().push(crate::PcRoot {
        id: "C".into(),
        kind: PcRootKind::Volume,
        name: "C".into(),
        path: root.clone(),
    });
    let core = open_core(
        &root.join("private-data"),
        vec![pc_explorer(), test_definition(MD_EDITOR)],
        &host,
    );
    fs::write(root.join("private-data/link.json"), "secret").unwrap();
    let (_, desktop) = active_ids(&core);
    let explorer = open_window(&core, &desktop, "test-explorer");
    core.handle(CoreRequest::FilesAllowPc {
        window_id: explorer.clone(),
        permission: "folder".into(),
    })
    .unwrap();
    let CoreReply::FilesOpen { window } = core
        .handle(CoreRequest::FilesOpen {
            window_id: explorer,
            permission: "folder".into(),
            path: "C/readme.md".into(),
            app_id: "test-md-editor".into(),
            rect: None,
        })
        .unwrap()
    else {
        panic!()
    };
    assert_grant_protect_data_dir(&core, &window.id);
}

#[test]
fn selected_parent_grant_must_protect_data_dir() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("sandbox");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("readme.md"), "readme").unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(root.clone()));
    let core = open_core(
        &root.join("private-data"),
        vec![test_definition(MD_EDITOR)],
        &host,
    );
    fs::write(root.join("private-data/link.json"), "secret").unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    pick_folder(&core, &window);
    assert_grant_protect_data_dir(&core, &window);
}
