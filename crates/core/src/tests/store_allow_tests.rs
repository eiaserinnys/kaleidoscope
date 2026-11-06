use super::*;
use super::store_runtime_tests::store_caller;

#[test]
fn latest_poll_skips_a_store_without_device_permission() {
    let (_temp, core, _, window) = store_caller();
    core.handle(CoreRequest::WindowClose { window_id: window }).unwrap();
    let definition = json!({"id":"installed","name":"시험","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"시험"}}).to_string();
    let mut app = registry_app(1, &definition);
    app.app.origin = Some(kaleidoscope_contract::store::StoreOrigin {
        store_url: "http://127.0.0.1:12345/appstore".into(), store_app_id: "example".into(), release: 1, digest: "digest".into(),
    });
    crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), app);
    crate::store_latest::tick_at(&core.inner, Instant::now() + Duration::from_secs(11));
    thread::sleep(Duration::from_millis(100));
    assert!(core.inner.state.lock().unwrap().store_latest.is_empty());
}

#[test]
fn allowed_store_reads_real_server_and_denied_store_never_sends_or_returns_cached_media() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

    let (_temp, core, _, window) = store_caller();
    *core.inner.store_transport.lock().unwrap() = None;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let server = format!("http://{address}/appstore");
    for denied in [server.clone(), format!("https://127.0.0.1:{}/appstore", address.port())] {
        let error = crate::store::client(&core.inner, &denied).err().unwrap();
        assert_eq!(error.id.as_deref(), Some("STORECLIENT_SERVER_PERMISSION_REQUIRED"));
        assert!(error.message.contains(&denied));
    }
    assert_eq!(listener.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);

    let (fixture, svg, _) = crate::store::tests::fixture();
    let files = fixture.files.clone();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let observed = requests.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let finished = stop.clone();
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !finished.load(AtomicOrdering::SeqCst) && Instant::now() < deadline {
            let (mut socket, _) = match listener.accept() {
                Ok(pair) => pair,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
                Err(e) => panic!("{e}"),
            };
            socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut request = [0; 8192];
            let count = socket.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]).into_owned();
            let path = request.lines().next().unwrap().split_whitespace().nth(1).unwrap().to_string();
            observed.lock().unwrap().push(request);
            let (status, mime, body) = files.lock().unwrap().get(&path).cloned().unwrap_or((404, "text/plain", Vec::new()));
            write!(socket, "HTTP/1.1 {status} Test\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nLocation: /appstore/index.json\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            socket.write_all(&body).unwrap();
        }
    });

    core.inner.state.lock().unwrap().device.store_servers.push(server.clone());
    let client = crate::store::client(&core.inner, &format!("{server}/")).unwrap();
    let index = client.index("catalog").unwrap();
    let detail = client.app("example", "catalog").unwrap();
    let media = kaleidoscope_contract::data::MediaRef::Resource(index.items[0].icon.clone().unwrap());
    let image = crate::media::get(&core.inner, &window, &media, None).unwrap();
    assert_eq!(base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &image.data_base64).unwrap(), svg);
    let bundle = client.prepare("example", 3, &detail.releases[0].manifest).unwrap();
    assert_eq!(bundle.definition.id, "example");
    assert_eq!(bundle.assets.len(), 1);

    core.inner.state.lock().unwrap().device.store_servers.clear();
    let error = crate::media::get(&core.inner, &window, &media, None).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("STORECLIENT_SERVER_PERMISSION_REQUIRED"));
    core.inner.state.lock().unwrap().device.store_servers.push(server);
    fixture.files.lock().unwrap().insert("/appstore/index.json".into(), (302, "text/plain", Vec::new()));
    let error = client.index("catalog").err().unwrap();
    assert_eq!(error.error.id.as_deref(), Some("STORECLIENT_FETCH_REDIRECT_REJECTED"));
    stop.store(true, AtomicOrdering::SeqCst);
    worker.join().unwrap();
    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 9);
    for request in requests.iter() {
        let lower = request.to_ascii_lowercase();
        assert!(lower.starts_with("get /appstore/"));
        assert!(!lower.contains("authorization:"));
        assert!(!lower.contains("cookie:"));
    }
}

#[test]
fn store_device_permissions_are_saved_and_restored_with_server_state() {
    use kaleidoscope_contract::ServerMode;
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    let local = LinkFile {
        revoked: false, format: 1, mode: ServerMode::Embedded,
        server_url: "http://127.0.0.1:1".into(), device_id: "local".into(),
        device_name: "시험".into(), token: "token".into(),
    };
    let remote = LinkFile {
        revoked: false, format: 1, mode: ServerMode::Remote,
        server_url: "https://remote.example".into(), device_id: "remote".into(),
        device_name: "시험".into(), token: "token".into(),
    };
    *core.inner.link_file.lock().unwrap() = Some(local.clone());
    core.inner.state.lock().unwrap().device.store_servers.push("http://127.0.0.1:9090".into());
    crate::server_switch::activate(&core.inner, remote, 0).unwrap();
    assert!(core.inner.state.lock().unwrap().device.store_servers.is_empty());
    crate::server_switch::activate(&core.inner, local, 0).unwrap();
    assert_eq!(core.inner.state.lock().unwrap().device.store_servers, ["http://127.0.0.1:9090"]);
    assert_eq!(crate::storage::load_device(temp.path()).unwrap().store_servers, ["http://127.0.0.1:9090"]);
    core.shutdown();
}
