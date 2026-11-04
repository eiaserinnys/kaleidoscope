use super::*;
use crate::startup_readiness::{self, Readiness, WaitFor};
use kaleidoscope_contract::data::BindingValue;
use kaleidoscope_contract::registry::{ConnectionInfo, ConnectionKind, ConnectionReply};

fn set_starting(core: &Core) {
    let file = connected_link_file();
    *core.inner.link_file.lock().unwrap() = Some(file.clone());
    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        mode: file.mode,
        server_url: file.server_url,
        device_name: file.device_name,
        reason: None,
    };
}

fn apps(core: &Core) {
    assert!(crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppsSnapshot {
            apps: vec![],
            deleted: vec![]
        }
    ));
}

fn connections(core: &Core, connections: Vec<ConnectionInfo>) {
    assert!(crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::ConnectionsSnapshot { connections }
    ));
}

fn relay() -> ConnectionInfo {
    ConnectionInfo {
        name: "example".into(),
        kind: ConnectionKind::Relay,
        base_url: "https://example.test".into(),
        writable: true,
        paths: vec![],
        issuer: None,
        scopes: None,
        resource: None,
    }
}

fn runtime_app() -> String {
    json!({"id":"startup-runtime","name":"기동 시험","requires":{"blocks":6,"modules":{"connection":1,"storage":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"read","label":"API"}],
        "state":{},"storage":{"entries":[{"id":"choice","key":"settings/choice","kind":"json","schema":{"type":"string"},"default":"local","label":"선택","presentation":"hidden"}]},
        "sources":{"remote":{"kind":"request","permission":"api","path":"/items"}},
        "ui":{"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$storage.choice"}},{"type":"text","value":{"expr":"$data.remote"}}]}}).to_string()
}

#[test]
fn readiness_changes_on_link_and_snapshot_events() {
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    set_starting(&core);
    assert_eq!(
        startup_readiness::snapshot(&core.inner).server,
        Readiness::Pending(WaitFor::Server)
    );
    apps(&core);
    let snap = startup_readiness::snapshot(&core.inner);
    assert_eq!(snap.server, Readiness::Ready);
    assert_eq!(
        snap.connections,
        Readiness::Pending(WaitFor::ConnectionsSnapshot)
    );
    connections(&core, vec![]);
    assert_eq!(
        startup_readiness::snapshot(&core.inner).connections,
        Readiness::Ready
    );
    connections(&core, vec![relay()]);
    assert_eq!(
        startup_readiness::snapshot(&core.inner).connections,
        Readiness::Ready
    );
    let file = connected_link_file();
    crate::link::set_offline(
        &core.inner,
        0,
        &file,
        kaleidoscope_contract::errors::CONN_EVENTS_STATUS_FAILED(),
    );
    assert_eq!(
        startup_readiness::snapshot(&core.inner).server,
        Readiness::Failed
    );
    crate::link::token_rejected(&core.inner, file);
    assert_eq!(
        startup_readiness::snapshot(&core.inner).server,
        Readiness::Failed
    );
}

#[test]
fn runtime_waits_for_both_events_and_fetches_once() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().insert(
        "/items".into(),
        ConnectionReply {
            status: 200,
            rate_limit: None,
            mime: "application/json".into(),
            json: Some(json!("remote")),
            text: None,
            data_base64: None,
        },
    );
    let core = open_core_with_client(temp.path(), vec![runtime_app()], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "startup-runtime");
    set_starting(&core);
    let CoreReply::DataAttach { view } = core
        .handle(CoreRequest::DataAttach {
            window_id: window.clone(),
            dormant: vec![],
        })
        .unwrap()
    else {
        panic!("data.attach")
    };
    assert!(matches!(
        view.values.get("/ui/children/0/value"),
        Some(BindingValue::Loading {})
    ));
    assert!(matches!(
        view.values.get("/ui/children/1/value"),
        Some(BindingValue::Loading {})
    ));
    assert!(client.connection_requests.lock().unwrap().is_empty());
    assert!(client.storage_workspace.lock().unwrap().is_empty());
    assert_eq!(client.storage_reads.load(Ordering::SeqCst), 0);
    apps(&core);
    wait_until(|| {
        matches!(
            crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/value"),
            Some(BindingValue::Ready { .. })
        )
    });
    assert_eq!(client.storage_reads.load(Ordering::SeqCst), 1);
    assert!(matches!(
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/1/value"),
        Some(BindingValue::Loading {})
    ));
    assert!(client.connection_requests.lock().unwrap().is_empty());
    connections(&core, vec![relay()]);
    wait_until(|| {
        matches!(
            crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/1/value"),
            Some(BindingValue::Ready { .. })
        )
    });
    assert_eq!(client.connection_requests.lock().unwrap().len(), 1);
}

#[test]
fn runtime_pending_becomes_failed_on_link_failure() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(temp.path(), vec![runtime_app()], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "startup-runtime");
    set_starting(&core);
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    crate::link::set_offline(
        &core.inner,
        0,
        &connected_link_file(),
        kaleidoscope_contract::errors::CONN_EVENTS_STATUS_FAILED(),
    );
    wait_until(|| {
        matches!(
            crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/value"),
            Some(BindingValue::Failed { .. })
        ) && matches!(
            crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/1/value"),
            Some(BindingValue::Failed { .. })
        )
    });
    assert!(client.connection_requests.lock().unwrap().is_empty());
}

#[test]
fn shutdown_releases_a_waiting_command() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = Arc::new(open_core_with_client(
        temp.path(),
        vec![runtime_app()],
        &host,
        registry_client(),
    ));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "startup-runtime");
    set_starting(&core);
    let (tx, rx) = mpsc::channel();
    let task_core = core.clone();
    let task = thread::spawn(move || {
        tx.send(crate::app_storage::read(
            &task_core.inner,
            &window,
            "choice",
        ))
        .unwrap()
    });
    assert!(matches!(
        rx.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    core.shutdown();
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap_err()
            .id
            .as_deref(),
        Some("STORAGE_SERVER_NOT_CONNECTED")
    );
    task.join().unwrap();
}

#[test]
fn connected_event_does_not_restart_inflight_oauth_request() {
    use std::io::Write;
    use std::net::TcpListener;

    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(temp.path(), vec![runtime_app()], &host, registry_client());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "startup-runtime");
    set_starting(&core);
    let mut info = relay();
    info.kind = ConnectionKind::Oauth;
    info.base_url = base.clone();
    *core.inner.connections.lock().unwrap() = vec![info];
    core.inner
        .login_store
        .store(
            "example",
            crate::logins::LoginEntry {
                issuer: base,
                client_id: None,
                redirect_port: None,
                access_token: Some("token".into()),
                refresh_token: None,
                expires_at: None,
            },
        )
        .unwrap();
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    let first_deadline = Instant::now() + Duration::from_secs(2);
    let (mut first, _) = loop {
        match listener.accept() {
            Ok(stream) => break stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(
                    Instant::now() < first_deadline,
                    "OAuth 요청이 시작되지 않았다"
                );
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => panic!("연결 수락 실패: {error}"),
        }
    };
    apps(&core);
    first.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 7\r\nConnection: close\r\n\r\n\"value\"").unwrap();
    drop(first);
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut duplicate = false;
    while Instant::now() < deadline {
        if let Ok((mut stream, _)) = listener.accept() {
            duplicate = true;
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 7\r\nConnection: close\r\n\r\n\"value\"");
            break;
        }
        if matches!(
            crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/1/value"),
            Some(BindingValue::Ready { .. })
        ) {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(!duplicate, "서버 연결 사건이 OAuth 원천을 중복 호출했다");
    assert!(matches!(
        crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/1/value"),
        Some(BindingValue::Ready { .. })
    ));
}

#[test]
fn asset_waits_for_link_and_returns_the_download() {
    use kaleidoscope_contract::data::{AssetMediaRef, MediaRef};
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    *client.asset_bytes.lock().unwrap() = Some(b"export default 1".to_vec());
    let app = json!({"id":"startup-asset","name":"자산 시험","requires":{"blocks":4,"modules":{"assets":1}},
        "permissions":[],"state":{},"assets":[{"id":"remote-script","version":1}],"ui":{"type":"text","value":"시험"}}).to_string();
    let core = Arc::new(open_core_with_client(temp.path(), vec![app], &host, client));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "startup-asset");
    set_starting(&core);
    let (tx, rx) = mpsc::channel();
    let task_core = core.clone();
    let task = thread::spawn(move || {
        tx.send(task_core.handle(CoreRequest::DataMedia {
            window_id: window,
            media: MediaRef::Asset(AssetMediaRef {
                asset: "remote-script".into(),
                version: None,
                crop: None,
            }),
            max_px: None,
        }))
        .unwrap()
    });
    assert!(matches!(
        rx.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    apps(&core);
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(1)).unwrap(),
        Ok(CoreReply::DataMedia { .. })
    ));
    task.join().unwrap();
}

#[test]
fn startup_storage_waits_before_the_connecting_thread_starts() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let definition = json!({
        "id":"startup-storage","name":"저장소 시작 시험",
        "requires":{"blocks":6,"modules":{"storage":3}},
        "state":{},"permissions":[],
        "storage":{"entries":[{"id":"documents","key":"documents","collection":true,"kind":"md","default":"","label":"문서","presentation":"hidden"}]},
        "ui":{"type":"text","value":"시험"}
    }).to_string();
    let core = Arc::new(open_core_with_client(
        temp.path(),
        vec![definition],
        &host,
        registry_client(),
    ));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "startup-storage");
    let file = connected_link_file();
    *core.inner.link_file.lock().unwrap() = Some(file.clone());
    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        mode: file.mode,
        server_url: file.server_url,
        device_name: file.device_name,
        reason: None,
    };
    let (tx, rx) = mpsc::channel();
    let task_core = core.clone();
    let task = thread::spawn(move || {
        tx.send(task_core.handle(CoreRequest::StorageList {
            window_id: window,
            entry: "documents".into(),
        }))
        .unwrap();
    });
    let before = rx.recv_timeout(Duration::from_millis(100));
    assert!(crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppsSnapshot {
            apps: vec![],
            deleted: vec![]
        }
    ));
    task.join().unwrap();
    assert!(matches!(before, Err(mpsc::RecvTimeoutError::Timeout)));
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(1)).unwrap(),
        Ok(CoreReply::StorageList { .. })
    ));
}
