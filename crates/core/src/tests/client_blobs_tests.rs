use super::*;
use sha2::{Digest, Sha256};

fn window_definition(id: &str) -> String {
    let mut value: serde_json::Value = serde_json::from_str(&definition(id)).unwrap();
    value["requires"]["blocks"] = serde_json::json!(18);
    value["requires"]["modules"]["client"] = serde_json::json!(4);
    value["client"]["device_storage"]["scope"] = serde_json::json!("window");
    value.to_string()
}

fn process_definition(id: &str, scope: &str) -> String {
    let mut value: serde_json::Value = serde_json::from_str(&window_definition(id)).unwrap();
    value["requires"]["modules"]["process"] = serde_json::json!(1);
    value["permissions"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({"module":"process", "id":"run", "label":"프로그램 실행"}));
    value["client"]["process_permissions"] = serde_json::json!(["run"]);
    value["client"]["device_storage"]["scope"] = serde_json::json!(scope);
    value.to_string()
}

fn window_storage_path(core: &Core, window_id: &str) -> PathBuf {
    let state = core.inner.state.lock().unwrap();
    let window = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)
        .unwrap();
    let app_key = format!("{:x}", Sha256::digest(window.app_id.as_bytes()));
    let window_key = format!("{:x}", Sha256::digest(window_id.as_bytes()));
    crate::server_switch::active_archive(&core.inner)
        .join("client-blobs")
        .join(".windows")
        .join(app_key)
        .join(window_key)
}

fn definition(id: &str) -> String {
    json!({"id":id,"name":"바이너리 시험","requires":{"blocks":14,"modules":{"assets":1,"client":2,"http":2}},
        "permissions":[{"id":"public","module":"http","label":"공개","base_url":"https://example.com","paths":["/allowed/"]}],
        "assets":[{"id":"entry","version":1}],"client":{"runtime":"javascript","entry":{"id":"entry","version":1},"http_permissions":["public"],"device_storage":{"prefixes":["cache/"]}},
        "state":{},"ui":{"type":"text","value":"시험"}}).to_string()
}

fn put(core: &Core, window: &str, key: &str, bytes: Vec<u8>) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::ClientBlobPut {
        window_id: window.into(),
        key: key.into(),
        file_id: None,
        bytes: Some(bytes),
    })
}

fn open(core: &Core, window: &str, key: &str) -> Option<kaleidoscope_contract::client::ClientFile> {
    match core
        .handle(CoreRequest::ClientBlobOpen {
            window_id: window.into(),
            key: key.into(),
        })
        .unwrap()
    {
        CoreReply::ClientBlobOpen { file } => file,
        other => panic!("unexpected: {other:?}"),
    }
}

#[test]
fn device_blob_persists_and_is_scoped_to_app_and_server() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let definitions = vec![definition("blob-one"), definition("blob-two")];
    let core = open_core(temp.path(), definitions.clone(), &host);
    let (_, desktop) = active_ids(&core);
    let one = open_window(&core, &desktop, "blob-one");
    let two = open_window(&core, &desktop, "blob-two");
    let bytes = vec![73; 25 * 1024 * 1024];
    put(&core, &one, "cache/image.bin", bytes.clone()).unwrap();
    assert!(open(&core, &two, "cache/image.bin").is_none());
    assert_eq!(
        put(&core, &one, "cache/../secret", vec![1])
            .unwrap_err()
            .code,
        ErrorCode::InvalidRequest
    );
    assert_eq!(
        put(&core, &one, "other/key", vec![1]).unwrap_err().code,
        ErrorCode::PermissionDenied
    );
    let file = open(&core, &one, "cache/image.bin").unwrap();
    assert_eq!(core.client_read_file(&one, &file.id).unwrap(), bytes);
    let CoreReply::ClientBlobList { keys } = core
        .handle(CoreRequest::ClientBlobList {
            window_id: one.clone(),
            prefix: "cache/".into(),
        })
        .unwrap()
    else {
        panic!("blob.list")
    };
    assert_eq!(keys, vec!["cache/image.bin"]);
    core.shutdown();
    drop(core);
    let reopened = open_core(temp.path(), definitions, &host);
    let (_, desktop) = active_ids(&reopened);
    let one = open_window(&reopened, &desktop, "blob-one");
    let file = open(&reopened, &one, "cache/image.bin").unwrap();
    assert_eq!(reopened.client_read_file(&one, &file.id).unwrap(), bytes);
    reopened
        .handle(CoreRequest::ClientBlobRemove {
            window_id: one.clone(),
            key: "cache/image.bin".into(),
        })
        .unwrap();
    assert!(open(&reopened, &one, "cache/image.bin").is_none());
    reopened.shutdown();
}

#[test]
fn switching_servers_selects_that_servers_blob_files() {
    use kaleidoscope_contract::ServerMode;
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![definition("blob-one")],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let one = open_window(&core, &desktop, "blob-one");
    put(&core, &one, "cache/item", b"local".to_vec()).unwrap();
    let shared = core.inner.state.lock().unwrap().shared.clone();
    let remote = LinkFile {
        revoked: false,
        format: 1,
        mode: ServerMode::Remote,
        server_url: "https://remote.example".into(),
        device_id: "device".into(),
        device_name: "시험".into(),
        token: "token".into(),
    };
    crate::server_switch::activate(&core.inner, remote, 0).unwrap();
    core.inner.state.lock().unwrap().shared = shared.clone();
    assert!(open(&core, &one, "cache/item").is_none());
    put(&core, &one, "cache/item", b"remote".to_vec()).unwrap();
    let local = LinkFile {
        revoked: false,
        format: 1,
        mode: ServerMode::Embedded,
        server_url: "http://127.0.0.1:1".into(),
        device_id: "local".into(),
        device_name: "시험".into(),
        token: "token".into(),
    };
    crate::server_switch::activate(&core.inner, local, 0).unwrap();
    core.inner.state.lock().unwrap().shared = shared;
    let file = open(&core, &one, "cache/item").unwrap();
    assert_eq!(core.client_read_file(&one, &file.id).unwrap(), b"local");
    core.shutdown();
}

#[test]
fn window_storage_returns_with_its_server_for_the_same_window() {
    use kaleidoscope_contract::ServerMode;
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![window_definition("server-window-blob")],
        &Arc::new(FakeHost::default()),
    );
    let local = LinkFile {
        revoked: false,
        format: 1,
        mode: ServerMode::Embedded,
        server_url: "http://127.0.0.1:1".into(),
        device_id: "local".into(),
        device_name: "test".into(),
        token: "token".into(),
    };
    *core.inner.link_file.lock().unwrap() = Some(local.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "server-window-blob");
    put(&core, &window, "cache/item", b"local".to_vec()).unwrap();
    let shared = core.inner.state.lock().unwrap().shared.clone();
    let remote = LinkFile {
        revoked: false,
        format: 1,
        mode: ServerMode::Remote,
        server_url: "https://window-remote.example".into(),
        device_id: "device".into(),
        device_name: "test".into(),
        token: "token".into(),
    };
    crate::server_switch::activate(&core.inner, remote.clone(), 0).unwrap();
    core.inner.state.lock().unwrap().shared = shared.clone();
    assert!(open(&core, &window, "cache/item").is_none());
    put(&core, &window, "cache/item", b"remote".to_vec()).unwrap();

    crate::server_switch::activate(&core.inner, local.clone(), 0).unwrap();
    core.inner.state.lock().unwrap().shared = shared;
    let file = open(&core, &window, "cache/item").expect("local server window blob");
    assert_eq!(core.client_read_file(&window, &file.id).unwrap(), b"local");

    crate::server_switch::activate(&core.inner, remote, 0).unwrap();
    let file = open(&core, &window, "cache/item").expect("remote server window blob");
    assert_eq!(core.client_read_file(&window, &file.id).unwrap(), b"remote");

    crate::server_switch::activate(&core.inner, local, 0).unwrap();
    let file = open(&core, &window, "cache/item").expect("local server window blob again");
    assert_eq!(core.client_read_file(&window, &file.id).unwrap(), b"local");
    core.shutdown();
}

#[test]
fn window_scoped_blobs_isolate_same_key_between_windows() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![window_definition("window-blob")], &host);
    let (_, desktop) = active_ids(&core);
    let first = open_window(&core, &desktop, "window-blob");
    let second = open_window(&core, &desktop, "window-blob");

    put(
        &core,
        &first,
        "cache/history.json",
        b"first window".to_vec(),
    )
    .unwrap();
    put(
        &core,
        &second,
        "cache/history.json",
        b"second window".to_vec(),
    )
    .unwrap();

    for (window, expected) in [
        (&first, b"first window".as_slice()),
        (&second, b"second window".as_slice()),
    ] {
        let file = open(&core, window, "cache/history.json").expect("window blob");
        assert_eq!(core.client_read_file(window, &file.id).unwrap(), expected);
    }
    core.shutdown();
}

#[test]
fn window_scoped_blobs_survive_core_restart_for_the_same_window() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let definition = window_definition("window-restart");
    let core = open_core(temp.path(), vec![definition.clone()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "window-restart");
    put(&core, &window, "cache/history.json", b"persisted".to_vec()).unwrap();
    core.shutdown();
    drop(core);

    let reopened = open_core(temp.path(), vec![definition], &host);
    let file = open(&reopened, &window, "cache/history.json").expect("same window's blob");
    assert_eq!(
        reopened.client_read_file(&window, &file.id).unwrap(),
        b"persisted"
    );
    reopened.shutdown();
}

#[test]
fn deleting_a_window_removes_only_its_window_storage() {
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![window_definition("window-delete")],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let first = open_window(&core, &desktop, "window-delete");
    let second = open_window(&core, &desktop, "window-delete");
    put(&core, &first, "cache/item", b"first".to_vec()).unwrap();
    put(&core, &second, "cache/item", b"second".to_vec()).unwrap();
    let first_root = window_storage_path(&core, &first);
    let second_root = window_storage_path(&core, &second);

    core.handle(CoreRequest::WindowClose {
        window_id: first.clone(),
    })
    .unwrap();

    assert!(!first_root.exists());
    assert!(second_root.exists());
    let file = open(&core, &second, "cache/item").expect("other window retains its blob");
    assert_eq!(core.client_read_file(&second, &file.id).unwrap(), b"second");
    core.shutdown();
}

#[test]
fn deleting_window_with_absolute_id_keeps_storage_outside_windows_root() {
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![window_definition("absolute-window-id")],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let original_id = open_window(&core, &desktop, "absolute-window-id");
    let outside = temp.path().join("outside-window-storage");
    std::fs::create_dir_all(&outside).unwrap();
    let marker = outside.join("keep.txt");
    std::fs::write(&marker, b"keep").unwrap();
    let malicious_id = outside.to_string_lossy().into_owned();

    {
        let mut state = core.inner.state.lock().unwrap();
        state
            .shared
            .windows
            .iter_mut()
            .find(|window| window.id == original_id)
            .unwrap()
            .id = malicious_id.clone();
    }
    crate::process_host::state_changed(&core.inner);
    put(&core, &malicious_id, "cache/item", b"window data".to_vec()).unwrap();

    core.handle(CoreRequest::WindowClose {
        window_id: malicious_id,
    })
    .unwrap();

    assert!(
        marker.exists(),
        "outside storage must survive window deletion"
    );
    core.shutdown();
}

#[test]
fn deleting_a_desktop_removes_storage_for_its_windows() {
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![window_definition("desktop-delete")],
        &Arc::new(FakeHost::default()),
    );
    let (workspace, _) = active_ids(&core);
    let desktop = match core
        .handle(CoreRequest::DesktopCreate {
            workspace_id: workspace,
            name: "Other".into(),
        })
        .unwrap()
    {
        CoreReply::DesktopCreate { desktop } => desktop.id,
        other => panic!("unexpected: {other:?}"),
    };
    let window = open_window(&core, &desktop, "desktop-delete");
    put(&core, &window, "cache/item", b"saved".to_vec()).unwrap();
    let root = window_storage_path(&core, &window);

    core.handle(CoreRequest::DesktopDelete {
        desktop_id: desktop,
    })
    .unwrap();

    assert!(!root.exists());
    core.shutdown();
}

#[test]
fn deleting_a_workspace_removes_storage_for_its_windows() {
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![window_definition("workspace-delete")],
        &Arc::new(FakeHost::default()),
    );
    let (workspace, _) = active_ids(&core);
    let (deleted_workspace, desktop) = match core
        .handle(CoreRequest::WorkspaceCreate {
            name: "Other".into(),
        })
        .unwrap()
    {
        CoreReply::WorkspaceCreate { workspace, desktop } => (workspace.id, desktop.id),
        other => panic!("unexpected: {other:?}"),
    };
    assert_ne!(workspace, deleted_workspace);
    let window = open_window(&core, &desktop, "workspace-delete");
    put(&core, &window, "cache/item", b"saved".to_vec()).unwrap();
    let root = window_storage_path(&core, &window);

    core.handle(CoreRequest::WorkspaceDelete {
        workspace_id: deleted_workspace,
    })
    .unwrap();

    assert!(!root.exists());
    core.shutdown();
}

#[test]
fn remote_layout_window_deletion_removes_window_storage() {
    use kaleidoscope_contract::registry::{DeviceEvent, LayoutChanges};
    let temp = TempDir::new().unwrap();
    let core = open_core_with_client(
        temp.path(),
        vec![window_definition("remote-delete")],
        &Arc::new(FakeHost::default()),
        registry_client(),
    );
    mark_connected(&core);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "remote-delete");
    put(&core, &window, "cache/item", b"saved".to_vec()).unwrap();
    let root = window_storage_path(&core, &window);
    core.inner.state.lock().unwrap().sync.pending.clear();

    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges {
                deleted_windows: vec![window],
                ..Default::default()
            },
        },
    );

    assert!(!root.exists());
    core.shutdown();
}

#[test]
fn process_file_uri_returns_only_a_window_blob_file_address() {
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![process_definition("file-uri", "window")],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "file-uri");
    let key = "cache/한글 file.bin";
    let bytes = b"attachment".to_vec();
    put(&core, &window, key, bytes.clone()).unwrap();

    let CoreReply::ProcessFileUri { uri } = core
        .handle(CoreRequest::ProcessFileUri {
            window_id: window.clone(),
            blob_key: key.into(),
        })
        .unwrap()
    else {
        panic!("process.file_uri")
    };
    let parsed = url::Url::parse(&uri).unwrap();
    assert_eq!(parsed.scheme(), "file");
    assert!(uri.contains("%20"), "space must be encoded: {uri}");
    let path = parsed.to_file_path().unwrap();
    assert_eq!(fs::read(path).unwrap(), bytes);
    core.shutdown();
}

#[test]
fn process_file_uri_rejects_undeclared_permission_app_scope_and_missing_key() {
    let temp = TempDir::new().unwrap();
    let mut no_storage: serde_json::Value =
        serde_json::from_str(&process_definition("uri-no-storage", "window")).unwrap();
    no_storage["client"]["device_storage"] = serde_json::Value::Null;
    let core = open_core(
        temp.path(),
        vec![
            window_definition("uri-no-permission"),
            process_definition("uri-app-scope", "app"),
            process_definition("uri-missing", "window"),
            no_storage.to_string(),
        ],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let no_permission = open_window(&core, &desktop, "uri-no-permission");
    let app_scope = open_window(&core, &desktop, "uri-app-scope");
    let missing = open_window(&core, &desktop, "uri-missing");
    let no_storage = open_window(&core, &desktop, "uri-no-storage");

    for (window_id, key, code) in [
        (
            &no_permission,
            "cache/item",
            "PROCESS_FILE_URI_CLIENT_PERMISSION_UNDECLARED",
        ),
        (
            &app_scope,
            "cache/item",
            "PROCESS_FILE_URI_WINDOW_STORAGE_REQUIRED",
        ),
        (&missing, "cache/item", "PROCESS_FILE_URI_BLOB_NOT_FOUND"),
        (
            &no_storage,
            "cache/item",
            "PROCESS_FILE_URI_WINDOW_STORAGE_REQUIRED",
        ),
    ] {
        let error = core
            .handle(CoreRequest::ProcessFileUri {
                window_id: window_id.clone(),
                blob_key: key.into(),
            })
            .unwrap_err();
        assert_eq!(error.id.as_deref(), Some(code));
    }
    core.shutdown();
}

#[test]
fn public_bytes_require_declared_permission_and_allowed_path() {
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![definition("http-client")],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "http-client");
    for (permission, path) in [("missing", "/allowed/x"), ("public", "/outside")] {
        assert!(core
            .handle(CoreRequest::ClientHttpRead {
                window_id: window.clone(),
                permission: permission.into(),
                path: path.into(),
                query: BTreeMap::new()
            })
            .is_err());
    }
    core.shutdown();
}

#[test]
fn picked_file_can_be_saved_without_exposing_its_path() {
    struct PickHost(PathBuf);
    impl Host for PickHost {
        fn pick_folder(&self) -> Option<PathBuf> {
            None
        }
        fn pick_files(
            &self,
            _: &[kaleidoscope_contract::data::FileAccept],
            _: bool,
        ) -> Option<Vec<PathBuf>> {
            Some(vec![self.0.clone()])
        }
    }
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("input.bin");
    let bytes = vec![42; 25 * 1024 * 1024];
    fs::write(&input, &bytes).unwrap();
    let core = Core::open(
        CoreConfig {
            data_dir: temp.path().join("data"),
            seed_definitions: vec![definition("picked-file")],
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "시험".into(),
            embedded_server: None,
        },
        Arc::new(PickHost(input)),
    )
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let one = open_window(&core, &desktop, "picked-file");
    let other = open_window(&core, &desktop, "picked-file");
    let CoreReply::FilesPick { files, .. } = core
        .handle(CoreRequest::FilesPick {
            window_id: one.clone(),
            accept: vec![],
            multiple: false,
        })
        .unwrap()
    else {
        panic!("files.pick")
    };
    let request = |window: &str| CoreRequest::ClientBlobPut {
        window_id: window.into(),
        key: "cache/upload.bin".into(),
        file_id: Some(files[0].id.clone()),
        bytes: None,
    };
    assert!(core.handle(request(&other)).is_err());
    core.handle(request(&one)).unwrap();
    let file = open(&core, &one, "cache/upload.bin").unwrap();
    assert_eq!(core.client_read_file(&one, &file.id).unwrap(), bytes);
    core.shutdown();
}
