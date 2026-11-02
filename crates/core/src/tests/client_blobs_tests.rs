use super::*;

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
    assert!(put(&core, &one, "cache/../secret", vec![1]).is_err());
    assert!(put(&core, &one, "other/key", vec![1]).is_err());
    let file = open(&core, &one, "cache/image.bin").unwrap();
    assert_eq!(core.client_read_file(&one, &file.id).unwrap(), bytes);
    let CoreReply::ClientBlobList { keys } = core.handle(CoreRequest::ClientBlobList { window_id: one.clone(), prefix: "cache/".into() }).unwrap() else { panic!("blob.list") };
    assert_eq!(keys, vec!["cache/image.bin"]);
    core.shutdown();
    drop(core);
    let reopened = open_core(temp.path(), definitions, &host);
    let (_, desktop) = active_ids(&reopened);
    let one = open_window(&reopened, &desktop, "blob-one");
    let file = open(&reopened, &one, "cache/image.bin").unwrap();
    assert_eq!(reopened.client_read_file(&one, &file.id).unwrap(), bytes);
    reopened.handle(CoreRequest::ClientBlobRemove { window_id: one.clone(), key: "cache/image.bin".into() }).unwrap();
    assert!(open(&reopened, &one, "cache/image.bin").is_none());
    reopened.shutdown();
}

#[test]
fn switching_servers_selects_that_servers_blob_files() {
    use kaleidoscope_contract::ServerMode;
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![definition("blob-one")], &Arc::new(FakeHost::default()));
    let (_, desktop) = active_ids(&core);
    let one = open_window(&core, &desktop, "blob-one");
    put(&core, &one, "cache/item", b"local".to_vec()).unwrap();
    let shared = core.inner.state.lock().unwrap().shared.clone();
    let remote = LinkFile { revoked: false, format: 1, mode: ServerMode::Remote, server_url: "https://remote.example".into(), device_id: "device".into(), device_name: "시험".into(), token: "token".into() };
    crate::server_switch::activate(&core.inner, remote, 0).unwrap();
    core.inner.state.lock().unwrap().shared = shared.clone();
    assert!(open(&core, &one, "cache/item").is_none());
    put(&core, &one, "cache/item", b"remote".to_vec()).unwrap();
    let local = LinkFile { revoked: false, format: 1, mode: ServerMode::Embedded, server_url: "http://127.0.0.1:1".into(), device_id: "local".into(), device_name: "시험".into(), token: "token".into() };
    crate::server_switch::activate(&core.inner, local, 0).unwrap();
    core.inner.state.lock().unwrap().shared = shared;
    let file = open(&core, &one, "cache/item").unwrap();
    assert_eq!(core.client_read_file(&one, &file.id).unwrap(), b"local");
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
