use super::*;
use kaleidoscope_contract::realtime::{RealtimeItem, RealtimeKind, RealtimePayload};
use kaleidoscope_contract::registry::{ConnectionInfo, ConnectionKind};
use std::net::TcpListener;

fn fixture(declared: bool, base: String) -> (TempDir, Core, String) {
    let temp = TempDir::new().unwrap();
    let mut client = json!({"runtime":"javascript","entry":{"id":"script","version":1}});
    if declared {
        client["realtime_permissions"] = json!(["live"]);
    }
    let definition = json!({
        "id":"public-live", "name":"실시간 시험", "requires":{"blocks":23,"modules":{"assets":1,"client":5,"connection":3}},
        "permissions":[{"module":"connection","id":"live","label":"연결","connection":"example","access":"readwrite"}],
        "assets":[{"id":"script","version":1}], "client":client,
        "ui":{"type":"text","value":"시험"}
    }).to_string();
    let core = open_core(
        temp.path(),
        vec![definition],
        &Arc::new(FakeHost::default()),
    );
    *core.inner.connections.lock().unwrap() = vec![ConnectionInfo {
        name: "example".into(),
        kind: ConnectionKind::Oauth,
        base_url: base,
        writable: true,
        paths: vec![],
        issuer: None,
        scopes: None,
        resource: None,
    }];
    core.inner
        .login_store
        .store(
            "example",
            crate::logins::LoginEntry {
                issuer: "http://127.0.0.1".into(),
                client_id: None,
                redirect_port: None,
                scopes: None,
                access_token: Some("fixture-secret".into()),
                refresh_token: None,
                expires_at: None,
            },
        )
        .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "public-live");
    (temp, core, window)
}

#[test]
fn client에_선언하지_않은_실시간_권한은_거부한다() {
    let (_temp, core, window) = fixture(false, "http://127.0.0.1:1".into());
    let CoreReply::RealtimeSession { session } = core
        .handle(CoreRequest::RealtimeSession {
            window_id: window.clone(),
        })
        .unwrap()
    else {
        panic!("세션 응답이 아닙니다")
    };
    let error = core
        .handle(CoreRequest::RealtimeOpen {
            window_id: window,
            session,
            permission: "live".into(),
            kind: RealtimeKind::Websocket,
            path: "/socket".into(),
            protocols: vec![],
        })
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("CONN_REALTIME_CLIENT_PERMISSION_MISSING")
    );
}

#[test]
fn 공개_명령과_바이트_봉투로_왕복한다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ws = tokio_tungstenite::tungstenite::accept(socket).unwrap();
        let message = ws.read().unwrap();
        ws.send(message).unwrap();
        let _ = ws.read();
    });
    let (_temp, core, window) = fixture(true, base);
    let CoreReply::RealtimeSession { session } = core
        .handle(CoreRequest::RealtimeSession {
            window_id: window.clone(),
        })
        .unwrap()
    else {
        panic!("세션 응답이 아닙니다")
    };
    let CoreReply::RealtimeOpen { handle, .. } = core
        .handle(CoreRequest::RealtimeOpen {
            window_id: window.clone(),
            session: session.clone(),
            permission: "live".into(),
            kind: RealtimeKind::Websocket,
            path: "/socket".into(),
            protocols: vec![],
        })
        .unwrap()
    else {
        panic!("열기 응답이 아닙니다")
    };
    let meta = serde_json::to_vec(&json!({"session":session,"kind":"binary"})).unwrap();
    let mut packet = (meta.len() as u32).to_be_bytes().to_vec();
    packet.extend(meta);
    packet.extend([0, 1, 255]);
    core.client_binary("connection.realtime.send", &window, &handle, &packet)
        .unwrap();
    let body = serde_json::to_vec(&json!({"session":session,"after":0})).unwrap();
    let mut received = Vec::new();
    wait_until(|| {
        received = core
            .client_binary("connection.realtime.read", &window, &handle, &body)
            .unwrap();
        let length = u32::from_be_bytes(received[..4].try_into().unwrap()) as usize;
        received.len() > 4 + length
    });
    let length = u32::from_be_bytes(received[..4].try_into().unwrap()) as usize;
    let metadata: Value = serde_json::from_slice(&received[4..4 + length]).unwrap();
    assert_eq!(metadata["sequence"], 1);
    assert_eq!(metadata["kind"], "binary");
    assert_eq!(&received[4 + length..], &[0, 1, 255]);
    core.handle(CoreRequest::RealtimeAck {
        window_id: window.clone(),
        session: session.clone(),
        handle: handle.clone(),
        through: 1,
    })
    .unwrap();
    core.handle(CoreRequest::RealtimeSend {
        window_id: window.clone(),
        session: session.clone(),
        handle: handle.clone(),
        message: RealtimePayload::Text { text: "끝".into() },
    })
    .unwrap();
    core.handle(CoreRequest::RealtimeRelease {
        window_id: window,
        session,
    })
    .unwrap();
    worker.join().unwrap();
}

#[test]
fn 공개_종료_응답은_서버가_돌려준_코드와_사유를_전달한다() {
    use tokio_tungstenite::tungstenite::Message as WsMessage;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ws = tokio_tungstenite::tungstenite::accept(socket).unwrap();
        let WsMessage::Close(Some(frame)) = ws.read().unwrap() else {
            panic!("종료 프레임이 아닙니다")
        };
        assert_eq!(u16::from(frame.code), 3001);
        assert_eq!(frame.reason, "작업 끝");
        assert!(matches!(
            ws.flush(),
            Ok(()) | Err(tokio_tungstenite::tungstenite::Error::ConnectionClosed)
        ));
    });
    let (_temp, core, window) = fixture(true, base);
    let CoreReply::RealtimeSession { session } = core
        .handle(CoreRequest::RealtimeSession {
            window_id: window.clone(),
        })
        .unwrap()
    else {
        panic!("세션 응답이 아닙니다")
    };
    let CoreReply::RealtimeOpen { handle, .. } = core
        .handle(CoreRequest::RealtimeOpen {
            window_id: window.clone(),
            session: session.clone(),
            permission: "live".into(),
            kind: RealtimeKind::Websocket,
            path: "/socket".into(),
            protocols: vec![],
        })
        .unwrap()
    else {
        panic!("열기 응답이 아닙니다")
    };
    core.handle(CoreRequest::RealtimeClose {
        window_id: window.clone(),
        session: session.clone(),
        handle: handle.clone(),
        code: Some(3001),
        reason: Some("작업 끝".into()),
    })
    .unwrap();
    let mut terminal = None;
    wait_until(|| {
        if let CoreReply::RealtimeRead {
            item: Some(RealtimeItem::Terminal(value)),
        } = core
            .handle(CoreRequest::RealtimeRead {
                window_id: window.clone(),
                session: session.clone(),
                handle: handle.clone(),
                after: 0,
            })
            .unwrap()
        {
            terminal = Some(value);
        }
        terminal.is_some()
    });
    let terminal = terminal.unwrap();
    assert_eq!(terminal.code, 3001);
    assert_eq!(terminal.reason, "작업 끝");
    core.handle(CoreRequest::RealtimeAck {
        window_id: window,
        session,
        handle,
        through: terminal.sequence,
    })
    .unwrap();
    worker.join().unwrap();
}
