use super::*;
use super::store_runtime_tests::store_caller;

#[test]
fn indexes_fetch_stores_concurrently_in_input_order() {
    struct SlowTransport {
        active: AtomicUsize,
        peak: AtomicUsize,
        body: Vec<u8>,
    }
    impl crate::store::fetch::Transport for SlowTransport {
        fn get(&self, _: &str, _: &[String], _: &str, _: u64) -> Result<kaleidoscope_data::public_http::PublicResponse, kaleidoscope_data::public_http::PublicHttpError> {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(active, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(300));
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(kaleidoscope_data::public_http::PublicResponse {
                status: 200, headers: BTreeMap::new(), rate_limit: None, retry_after: None,
                mime: "application/json".into(), bytes: self.body.clone(),
            })
        }
    }
    let (_temp, core, _, window) = store_caller();
    let (fixture, _, _) = crate::store::tests::fixture();
    let body = fixture.files.lock().unwrap()["/appstore/index.json"].2.clone();
    let transport = Arc::new(SlowTransport { active: AtomicUsize::new(0), peak: AtomicUsize::new(0), body });
    *core.inner.store_transport.lock().unwrap() = Some(transport.clone());
    let servers = vec!["https://first.example/appstore".into(), "https://second.example/appstore".into()];
    let start = Instant::now();
    let value = crate::data_sources::fetch(&core.inner, &window,
        &kaleidoscope_data::SourcePlan::StoreIndexes { permission: "catalog".into(), servers: servers.clone() },
        kaleidoscope_contract::data::SourceFormat::Json).unwrap();
    println!("두 스토어 조회 시간: {:?}", start.elapsed());
    assert_eq!(transport.peak.load(Ordering::SeqCst), 2, "두 주소를 동시에 읽는다");
    assert_eq!(value["stores"][0]["server"], servers[0]);
    assert_eq!(value["stores"][1]["server"], servers[1]);
}

#[test]
fn indexes_read_independently_and_respect_liveness() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let ready = format!("http://{}/appstore", listener.local_addr().unwrap());
    let limited = format!("http://{}/limited", listener.local_addr().unwrap());
    let offline = TcpListener::bind("127.0.0.1:0").unwrap();
    let offline_url = format!("http://{}/appstore", offline.local_addr().unwrap());
    drop(offline);
    let denied = TcpListener::bind("127.0.0.1:0").unwrap();
    denied.set_nonblocking(true).unwrap();
    let denied_url = format!("http://{}/appstore", denied.local_addr().unwrap());
    let (fixture, _, _) = crate::store::tests::fixture();
    let body = fixture.files.lock().unwrap()["/appstore/index.json"].2.clone();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let observed = requests.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let finished = stop.clone();
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !finished.load(AtomicOrdering::SeqCst) && Instant::now() < deadline {
            match listener.accept() {
                Ok((mut socket, _)) => {
                    socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                    let mut request = [0; 4096];
                    let count = socket.read(&mut request).unwrap();
                    let request = String::from_utf8_lossy(&request[..count]).to_string();
                    let is_limited = request.starts_with("GET /limited/");
                    observed.lock().unwrap().push(request);
                    if is_limited {
                        write!(socket, "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                    } else {
                        write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                        socket.write_all(&body).unwrap();
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(5)),
                Err(e) => panic!("{e}"),
            }
        }
    });
    let definition = json!({
        "id":"indexes-test","name":"스토어", "requires":{"blocks":4,"modules":{"store":3}},
        "permissions":[{"module":"store","id":"catalog","label":"스토어"}],
        "state":{"servers":[limited, format!("{ready}/"), ready, offline_url, denied_url, "틀린 주소"]},
        "sources":{"catalog":{"kind":"store","store":"indexes","permission":"catalog","servers":{"state":"servers"}}},
        "ui":{"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$data.catalog"}}]}
    });
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![definition.to_string()], &Arc::new(FakeHost::default()));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "indexes-test");
    mark_connected(&core);
    core.inner.state.lock().unwrap().device.store_servers.extend([limited.clone(), ready.clone(), offline_url.clone()]);
    let installed_definition = json!({"id":"example","name":"시험 앱","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"시험"}}).to_string();
    let mut installed = registry_app(1, &installed_definition);
    installed.app.origin = Some(kaleidoscope_contract::store::StoreOrigin { store_url:ready.clone(), store_app_id:"example".into(), release:1, digest:"digest".into() });
    crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), installed);
    core.set_shell_visible(false);
    core.handle(CoreRequest::DataAttach { window_id:window.clone(), dormant:vec![] }).unwrap();
    thread::sleep(Duration::from_millis(200));
    assert!(requests.lock().unwrap().is_empty());
    core.handle(serde_json::from_value(json!({"op":"data.dormant","window_id":window,"dormant":["/ui/children/0"]})).unwrap()).unwrap();
    core.set_shell_visible(true);
    thread::sleep(Duration::from_millis(200));
    assert!(requests.lock().unwrap().is_empty());
    core.handle(serde_json::from_value(json!({"op":"data.dormant","window_id":window,"dormant":[]})).unwrap()).unwrap();
    let read = || crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/value");
    wait_until(|| matches!(read(), Some(kaleidoscope_contract::data::BindingValue::Ready { .. })));
    let Some(kaleidoscope_contract::data::BindingValue::Ready { value, .. }) = read() else { panic!("목록 결과 없음") };
    let stores = value["stores"].as_array().unwrap();
    assert_eq!(stores.len(), 5);
    assert_eq!(stores[0]["server"], limited);
    assert_eq!(stores[0]["state"], "error");
    assert_eq!(stores[0]["error"]["id"], "STORECLIENT_FETCH_HTTP_REJECTED");
    assert_eq!(stores[1]["server"], ready);
    assert_eq!(stores[1]["state"], "ready");
    assert!(stores[1]["generated_at"].is_string());
    assert_eq!(stores[1]["items"][0]["id"], "example");
    assert_eq!(stores[2]["server"], offline_url);
    assert_eq!(stores[2]["state"], "error");
    assert_eq!(stores[2]["items"], json!([]));
    assert_eq!(stores[3]["server"], denied_url);
    assert_eq!(stores[3]["state"], "permission_required");
    assert_eq!(stores[3]["error"]["id"], "STORECLIENT_SERVER_PERMISSION_REQUIRED");
    assert_eq!(stores[4]["server"], "틀린 주소");
    assert_eq!(stores[4]["state"], "error");
    assert_eq!(denied.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
    assert_eq!(requests.lock().unwrap().len(), 2);
    {
        let state = core.inner.state.lock().unwrap();
        assert_eq!(state.store_latest[&ready]["example"].release, 3);
        let definition = crate::app_commands::definition_for(&state.shared, "indexes-test", 1).unwrap();
        let apps = crate::data_runtime::apps_for(&state, &definition).unwrap();
        assert_eq!(apps.iter().find(|app| app.id == "example").unwrap().latest.as_ref().unwrap().release, 3);
    }
    core.handle(CoreRequest::DataRefresh { window_id:window.clone(), sources:vec!["catalog".into()] }).unwrap();
    wait_until(|| requests.lock().unwrap().len() == 3);
    let calls = requests.lock().unwrap();
    assert_eq!(calls.iter().filter(|call| call.starts_with("GET /limited/")).count(), 1);
    assert_eq!(calls.iter().filter(|call| call.starts_with("GET /appstore/")).count(), 2);
    drop(calls);
    stop.store(true, AtomicOrdering::SeqCst);
    worker.join().unwrap();
}

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

#[test]
fn forced_refresh_while_a_store_index_is_in_flight_uses_the_new_invite() {
    struct GatedTransport {
        calls: Arc<Mutex<Vec<Option<String>>>>,
        started: mpsc::Sender<()>,
        release: Mutex<mpsc::Receiver<()>>,
        first: Vec<u8>,
        second: Vec<u8>,
    }
    impl GatedTransport {
        fn answer(&self, invite: Option<&str>) -> Result<kaleidoscope_data::public_http::PublicResponse, kaleidoscope_data::public_http::PublicHttpError> {
            let index = {
                let mut calls = self.calls.lock().unwrap();
                calls.push(invite.map(str::to_owned));
                calls.len()
            };
            if index == 1 {
                self.started.send(()).unwrap();
                self.release.lock().unwrap().recv_timeout(Duration::from_secs(10)).unwrap();
            }
            let body = if invite == Some("code-2") { self.second.clone() } else { self.first.clone() };
            Ok(kaleidoscope_data::public_http::PublicResponse {
                status: 200, headers: BTreeMap::new(), rate_limit: None, retry_after: None,
                mime: "application/json".into(), bytes: body,
            })
        }
    }
    impl crate::store::fetch::Transport for GatedTransport {
        fn get(&self, _: &str, _: &[String], _: &str, _: u64) -> Result<kaleidoscope_data::public_http::PublicResponse, kaleidoscope_data::public_http::PublicHttpError> {
            self.answer(None)
        }
        fn get_with_invite(&self, _: &str, _: &[String], _: &str, invite: &str, _: u64) -> Result<kaleidoscope_data::public_http::PublicResponse, kaleidoscope_data::public_http::PublicHttpError> {
            self.answer(Some(invite))
        }
    }

    let server = "https://private.example/appstore";
    let (fixture, _, _) = crate::store::tests::fixture();
    let first = fixture.files.lock().unwrap()["/appstore/index.json"].2.clone();
    let second = {
        let mut index: Value = serde_json::from_slice(&first).unwrap();
        index["generated_at"] = json!("second");
        index.to_string().into_bytes()
    };
    let definition = json!({
        "id":"invite-refresh-test","name":"스토어",
        "requires":{"blocks":4,"modules":{"store":3}},
        "permissions":[{"module":"store","id":"catalog","label":"스토어"}],
        "state":{"servers":[server]},
        "sources":{"catalog":{"kind":"store","store":"indexes","permission":"catalog","servers":{"state":"servers"}}},
        "ui":{"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$data.catalog"}}]}
    });
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![definition.to_string()], &Arc::new(FakeHost::default()));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "invite-refresh-test");
    mark_connected(&core);
    let (started, started_rx) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    let calls = Arc::new(Mutex::new(Vec::new()));
    *core.inner.store_transport.lock().unwrap() = Some(Arc::new(GatedTransport {
        calls: calls.clone(),
        started,
        release: Mutex::new(release_rx),
        first,
        second,
    }));
    core.handle(CoreRequest::DataAttach { window_id: window.clone(), dormant: vec![] }).unwrap();
    started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(*calls.lock().unwrap(), [None], "초대코드 없는 첫 요청이 도는 중이다");

    crate::store::sync_store_invites(&core.inner, &json!({ server: "code-2" }));
    release.send(()).unwrap();

    let read = || crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/value");
    wait_until(|| {
        matches!(read(), Some(kaleidoscope_contract::data::BindingValue::Ready { value, .. })
            if value["stores"][0]["generated_at"] == "second")
    });
    assert_eq!(
        *calls.lock().unwrap(),
        [None, Some("code-2".into())],
        "in-flight 중에도 강제 갱신이 새 초대코드로 요청을 시작한다"
    );
}
