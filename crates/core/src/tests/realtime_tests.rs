// 위임에서 지정한 하나의 통합 시험 파일에 실시간 연결과 공통 픽스처를 둔다.
use super::*;
use crate::realtime_host::{self, Message};
use kaleidoscope_contract::registry::{ConnectionInfo, ConnectionKind};
use std::net::TcpListener;
use tokio_tungstenite::tungstenite::{
    accept_hdr,
    handshake::server::{Request, Response},
};

fn fixture(
    access: &str,
    kind: ConnectionKind,
    writable: bool,
    paths: Vec<String>,
    base: String,
) -> (TempDir, Core, String) {
    let temp = TempDir::new().unwrap();
    let definition = json!({
        "id":"realtime-fixture", "name":"실시간 시험", "requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"live","label":"연결","connection":"example","access":access}],
        "sources":{"items":{"kind":"request","permission":"live","path":"/socket"}},
        "ui":{"type":"text","value":{"expr":"$data.items"}}
    }).to_string();
    let core = open_core(
        temp.path(),
        vec![definition],
        &Arc::new(FakeHost::default()),
    );
    *core.inner.connections.lock().unwrap() = vec![ConnectionInfo {
        name: "example".into(),
        kind,
        base_url: base,
        writable,
        paths,
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
                access_token: Some("fixture-secret".into()),
                refresh_token: None,
                expires_at: None,
            },
        )
        .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "realtime-fixture");
    (temp, core, window)
}

#[test]
fn 문자열과_바이트를_경계와_순서대로_주고받고_ack한다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ws = accept_hdr(socket, |request: &Request, response: Response| {
            assert_eq!(request.headers()["authorization"], "Bearer fixture-secret");
            Ok(response)
        })
        .unwrap();
        for _ in 0..2 {
            let message = ws.read().unwrap();
            ws.send(message).unwrap();
        }
        let _ = ws.read();
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let opened =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    assert!(!format!("{opened:?}").contains("fixture-secret"));
    realtime_host::send(
        &core.inner,
        &window,
        &session,
        &opened.handle,
        Message::Text("안녕".into()),
    )
    .unwrap();
    realtime_host::send(
        &core.inner,
        &window,
        &session,
        &opened.handle,
        Message::Binary(vec![0, 1, 255]),
    )
    .unwrap();
    let mut received = Vec::new();
    wait_until(|| {
        if let Some(packet) = realtime_host::read(
            &core.inner,
            &window,
            &session,
            &opened.handle,
            received.len() as u64,
        )
        .unwrap()
        {
            received.push(packet);
        }
        received.len() == 2
    });
    assert_eq!(received[0].sequence, 1);
    assert_eq!(received[0].message, Message::Text("안녕".into()));
    assert_eq!(received[1].sequence, 2);
    assert_eq!(received[1].message, Message::Binary(vec![0, 1, 255]));
    realtime_host::ack(&core.inner, &window, &session, &opened.handle, 2).unwrap();
    assert!(
        realtime_host::read(&core.inner, &window, &session, &opened.handle, 2)
            .unwrap()
            .is_none()
    );
    realtime_host::release(&core.inner, &window, &session);
    worker.join().unwrap();
}

#[test]
fn 앱과_연결_권한_경로_종류_및_숨김을_접속_전에_검사한다() {
    for (access, kind, writable, paths, path, expected) in [
        (
            "read",
            ConnectionKind::Oauth,
            true,
            vec![],
            "/socket",
            "CONN_AUTHORIZE_READ_ONLY",
        ),
        (
            "readwrite",
            ConnectionKind::Oauth,
            false,
            vec![],
            "/socket",
            "CONN_AUTHORIZE_WRITE_DENIED",
        ),
        (
            "readwrite",
            ConnectionKind::Oauth,
            true,
            vec!["/allowed".into()],
            "/socket",
            "CONN_AUTHORIZE_PATH_DENIED",
        ),
        (
            "readwrite",
            ConnectionKind::Relay,
            true,
            vec![],
            "/socket",
            "CONN_REALTIME_RELAY_UNSUPPORTED",
        ),
    ] {
        let (_temp, core, window) =
            fixture(access, kind, writable, paths, "http://127.0.0.1:1".into());
        let session = realtime_host::session(&core.inner, &window).unwrap();
        let error =
            realtime_host::open(&core.inner, &window, &session, "live", path, &[]).unwrap_err();
        assert_eq!(error.id.as_deref(), Some(expected));
        assert!(!format!("{error:?}").contains("fixture-secret"));
    }
    let (_temp, core, window) = fixture(
        "readwrite",
        ConnectionKind::Oauth,
        true,
        vec![],
        "http://127.0.0.1:1".into(),
    );
    let session = realtime_host::session(&core.inner, &window).unwrap();
    core.set_shell_visible(false);
    let error =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_WINDOW_HIDDEN"));
}

#[test]
fn 네트워크_실패는_로그인_필요가_아니다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let error =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_OPEN_UNREACHABLE"));
    assert_ne!(error.code, ErrorCode::LoginRequired);
    assert!(!format!("{error:?}").contains("fixture-secret"));
}

#[test]
fn 관문에_걸린_연결은_다음_소켓을_열지_않는다() {
    use std::io::{Read, Write};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 2048];
        let _ = socket.read(&mut request).unwrap();
        socket
            .write_all(
                b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 5\r\nContent-Length: 0\r\n\r\n",
            )
            .unwrap();
        listener.set_nonblocking(true).unwrap();
        let deadline = Instant::now() + Duration::from_millis(700);
        while Instant::now() < deadline {
            match listener.accept() {
                Ok(_) => return true,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(error) => panic!("요청 감시 실패: {error}"),
            }
        }
        false
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let error =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_OPEN_RATE_LIMITED"));
    assert!(crate::data_runtime::gates::blocked(&core.inner.data_runtimes, "example").is_some());
    let CoreReply::DataAttach { view } = core
        .handle(CoreRequest::DataAttach {
            window_id: window.clone(),
            dormant: vec![],
        })
        .unwrap()
    else {
        panic!("원천 첨부 응답이 아닙니다")
    };
    assert!(matches!(
        view.sources.get("items"),
        Some(kaleidoscope_contract::data::SourceStatus::Loading { .. })
    ));
    let error =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_OPEN_RATE_LIMITED"));
    assert!(
        !worker.join().unwrap(),
        "관문이 닫힌 동안 네트워크 요청이 나갔습니다"
    );
}

#[test]
fn 숨기면_연결이_닫히고_다시_보이면_같은_세션을_쓸_수_있다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        for _ in 0..2 {
            let (socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut ws = tokio_tungstenite::tungstenite::accept(socket).unwrap();
            let _ = ws.read();
            tx.send(()).unwrap();
        }
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let opened =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    core.set_shell_visible(false);
    rx.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(
        realtime_host::read(&core.inner, &window, &session, &opened.handle, 0)
            .unwrap_err()
            .id
            .as_deref(),
        Some("CONN_REALTIME_HANDLE_MISSING")
    );
    core.set_shell_visible(true);
    realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    realtime_host::release(&core.inner, &window, &session);
    rx.recv_timeout(Duration::from_secs(3)).unwrap();
    worker.join().unwrap();
}

fn reject_handshake(mut socket: std::net::TcpStream, status: u16) -> String {
    use std::io::{Read, Write};
    socket
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut request = Vec::new();
    let mut bytes = [0; 1024];
    while !request.windows(4).any(|part| part == b"\r\n\r\n") {
        let n = socket.read(&mut bytes).unwrap();
        assert!(n > 0);
        request.extend_from_slice(&bytes[..n]);
    }
    write!(
        socket,
        "HTTP/1.1 {status} Rejected\r\nContent-Length: 0\r\n\r\n"
    )
    .unwrap();
    String::from_utf8(request).unwrap()
}

#[test]
fn 첫_401은_갱신한_bearer로_한번만_다시_연다() {
    let oauth = super::oauth_tests::OAuthFixture::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        assert!(reject_handshake(socket, 401).contains("Bearer fixture-secret"));
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ws = accept_hdr(socket, |request: &Request, response: Response| {
            assert_eq!(request.headers()["authorization"], "Bearer refreshed");
            Ok(response)
        })
        .unwrap();
        let _ = ws.read();
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    core.inner
        .login_store
        .store(
            "example",
            crate::logins::LoginEntry {
                issuer: oauth.base.clone(),
                client_id: Some("client".into()),
                redirect_port: Some(40000),
                access_token: Some("fixture-secret".into()),
                refresh_token: Some("refresh".into()),
                expires_at: None,
            },
        )
        .unwrap();
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let opened =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    assert!(!format!("{opened:?}").contains("fixture-secret"));
    realtime_host::release(&core.inner, &window, &session);
    worker.join().unwrap();
}

#[test]
fn 두번째_401은_갱신한_토큰을_무효화하고_로그인을_요구한다() {
    let oauth = super::oauth_tests::OAuthFixture::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        assert!(reject_handshake(socket, 401).contains("Bearer fixture-secret"));
        let (socket, _) = listener.accept().unwrap();
        assert!(reject_handshake(socket, 401).contains("Bearer refreshed"));
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    core.inner
        .login_store
        .store(
            "example",
            crate::logins::LoginEntry {
                issuer: oauth.base.clone(),
                client_id: Some("client".into()),
                redirect_port: Some(40000),
                access_token: Some("fixture-secret".into()),
                refresh_token: Some("refresh".into()),
                expires_at: None,
            },
        )
        .unwrap();
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let error =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_LOGIN_REQUIRED"));
    assert_eq!(
        core.inner
            .login_store
            .entry("example")
            .unwrap()
            .access_token,
        None
    );
    assert!(!format!("{error:?}").contains("fixture-secret"));
    worker.join().unwrap();
}

#[test]
fn 메시지_한도를_넘는_전송은_거부한다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ws = tokio_tungstenite::tungstenite::accept(socket).unwrap();
        let _ = ws.read();
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let opened =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    let error = realtime_host::send(
        &core.inner,
        &window,
        &session,
        &opened.handle,
        Message::Binary(vec![0; 8 * 1024 * 1024 + 1]),
    )
    .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_MESSAGE_TOO_LARGE"));
    let error = realtime_host::send(
        &core.inner,
        &window,
        &session,
        &opened.handle,
        Message::Text("뒤의 메시지".into()),
    )
    .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_HANDLE_MISSING"));
    realtime_host::release(&core.inner, &window, &session);
    worker.join().unwrap();
}

#[test]
fn 수신_큐가_차면_ack_뒤_다음_메시지를_읽는다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ws = tokio_tungstenite::tungstenite::accept(socket).unwrap();
        for i in 0..257 {
            ws.send(tokio_tungstenite::tungstenite::Message::text(i.to_string()))
                .unwrap();
        }
        let _ = ws.read();
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let opened =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    let mut after = 0;
    wait_until(|| {
        while let Some(packet) =
            realtime_host::read(&core.inner, &window, &session, &opened.handle, after).unwrap()
        {
            after = packet.sequence;
        }
        after == 256
    });
    assert!(
        realtime_host::read(&core.inner, &window, &session, &opened.handle, 256)
            .unwrap()
            .is_none()
    );
    realtime_host::ack(&core.inner, &window, &session, &opened.handle, 1).unwrap();
    wait_until(|| {
        realtime_host::read(&core.inner, &window, &session, &opened.handle, 256)
            .unwrap()
            .is_some()
    });
    realtime_host::release(&core.inner, &window, &session);
    worker.join().unwrap();
}

#[test]
fn 닫힌_세션의_늦은_핸드셰이크는_핸들을_공개하지_않는다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (started_tx, started_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        let _ = accept_hdr(socket, |_request: &Request, response: Response| {
            started_tx.send(()).unwrap();
            resume_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            Ok(response)
        });
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let core = Arc::new(core);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let other_core = core.clone();
    let other_window = window.clone();
    let other_session = session.clone();
    let opening = thread::spawn(move || {
        realtime_host::open(
            &other_core.inner,
            &other_window,
            &other_session,
            "live",
            "/socket",
            &[],
        )
    });
    started_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    realtime_host::release(&core.inner, &window, &session);
    resume_tx.send(()).unwrap();
    assert_eq!(
        opening.join().unwrap().unwrap_err().id.as_deref(),
        Some("CONN_REALTIME_SESSION_STALE")
    );
    worker.join().unwrap();
}

#[test]
fn 사백삼_거부는_로그인_필요로_바꾸지_않는다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        reject_handshake(socket, 403);
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let error =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_OPEN_REJECTED"));
    assert_ne!(error.code, ErrorCode::LoginRequired);
    worker.join().unwrap();
}

#[test]
fn 정확히_팔미비_바이트_메시지가_실제_소켓에서_왕복한다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut ws = tokio_tungstenite::tungstenite::accept(socket).unwrap();
        let message = ws.read().unwrap();
        assert_eq!(message.len(), 8 * 1024 * 1024);
        ws.send(message).unwrap();
        let _ = ws.read();
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let opened =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    let payload = vec![0x5a; 8 * 1024 * 1024];
    realtime_host::send(
        &core.inner,
        &window,
        &session,
        &opened.handle,
        Message::Binary(payload.clone()),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let packet = loop {
        if let Some(packet) =
            realtime_host::read(&core.inner, &window, &session, &opened.handle, 0).unwrap()
        {
            break packet;
        }
        assert!(Instant::now() < deadline, "최대 메시지 왕복 시간 초과");
        thread::sleep(Duration::from_millis(5));
    };
    assert_eq!(packet.sequence, 1);
    match packet.message {
        Message::Binary(actual) => assert!(actual == payload, "왕복 바이트가 다릅니다"),
        other => panic!("바이너리 대신 다른 메시지를 받았습니다: {other:?}"),
    }
    realtime_host::ack(&core.inner, &window, &session, &opened.handle, 1).unwrap();
    realtime_host::release(&core.inner, &window, &session);
    worker.join().unwrap();
}

#[test]
fn 한_창에서_네_연결까지만_열린다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let mut sockets = Vec::new();
        for _ in 0..4 {
            let (socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(8)))
                .unwrap();
            sockets.push(tokio_tungstenite::tungstenite::accept(socket).unwrap());
        }
        for mut socket in sockets {
            let _ = socket.read();
        }
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    for _ in 0..4 {
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    }
    let error =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_OPEN_LIMIT"));
    realtime_host::release(&core.inner, &window, &session);
    worker.join().unwrap();
}

#[test]
fn 연결_실패_직후_같은_세션은_일초를_기다린다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let first =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap_err();
    assert_eq!(first.id.as_deref(), Some("CONN_REALTIME_OPEN_UNREACHABLE"));
    let second =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap_err();
    assert_eq!(second.id.as_deref(), Some("CONN_REALTIME_OPEN_COOLDOWN"));
}

#[test]
fn 만료_토큰은_런타임_밖에서_갱신하고_새_bearer로_연결한다() {
    let oauth = super::oauth_tests::OAuthFixture::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        let socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(error) => panic!("소켓 접속을 받지 못했습니다: {error}"),
            }
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ws = accept_hdr(socket, |request: &Request, response: Response| {
            assert_eq!(request.headers()["authorization"], "Bearer refreshed");
            Ok(response)
        })
        .unwrap();
        let _ = ws.read();
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    core.inner
        .login_store
        .store(
            "example",
            crate::logins::LoginEntry {
                issuer: oauth.base.clone(),
                client_id: Some("client".into()),
                redirect_port: Some(40000),
                access_token: Some("expired".into()),
                refresh_token: Some("refresh".into()),
                expires_at: Some(1),
            },
        )
        .unwrap();
    let session = realtime_host::session(&core.inner, &window).unwrap();
    realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    realtime_host::release(&core.inner, &window, &session);
    worker.join().unwrap();
}

#[test]
fn 팔미비를_넘는_수신_메시지를_거부한다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        let mut ws = tokio_tungstenite::tungstenite::accept(socket).unwrap();
        let _ = ws.send(tokio_tungstenite::tungstenite::Message::binary(vec![
            0;
            8 * 1024 * 1024
                + 1
        ]));
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let opened =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    let mut packet = None;
    wait_until(|| {
        packet = realtime_host::read(&core.inner, &window, &session, &opened.handle, 0).unwrap();
        packet.is_some()
    });
    let Message::Terminal {
        error: Some(error), ..
    } = packet.unwrap().message
    else {
        panic!("크기 오류 종료를 받지 못했습니다")
    };
    assert_eq!(error.id.as_deref(), Some("CONN_REALTIME_MESSAGE_TOO_LARGE"));
    realtime_host::release(&core.inner, &window, &session);
    worker.join().unwrap();
}

#[test]
fn 여러_연결을_숨길_때_종료_신호를_함께_보낸다() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (ready_tx, ready_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        let mut sockets = Vec::new();
        for _ in 0..4 {
            let (socket, _) = listener.accept().unwrap();
            sockets.push(tokio_tungstenite::tungstenite::accept(socket).unwrap());
        }
        ready_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(8)).unwrap();
        drop(sockets);
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    for _ in 0..4 {
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    }
    ready_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    let started = Instant::now();
    core.set_shell_visible(false);
    let elapsed = started.elapsed();
    release_tx.send(()).unwrap();
    worker.join().unwrap();
    assert!(
        elapsed < Duration::from_millis(2500),
        "종료가 순차 대기했습니다: {elapsed:?}"
    );
}

#[test]
fn 원격_정상_종료에_응답하고_받은_메시지_뒤에_종료를_전달한다() {
    use tokio_tungstenite::tungstenite::{
        protocol::{frame::coding::CloseCode, CloseFrame},
        Message as WsMessage,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ws = tokio_tungstenite::tungstenite::accept(socket).unwrap();
        ws.send(WsMessage::text("마지막 메시지")).unwrap();
        ws.send(WsMessage::Close(Some(CloseFrame {
            code: CloseCode::Normal,
            reason: "완료".into(),
        })))
        .unwrap();
        matches!(
            ws.read(),
            Ok(WsMessage::Close(_)) | Err(tokio_tungstenite::tungstenite::Error::ConnectionClosed)
        )
    });
    let (_temp, core, window) = fixture("readwrite", ConnectionKind::Oauth, true, vec![], base);
    let session = realtime_host::session(&core.inner, &window).unwrap();
    let opened =
        realtime_host::open(&core.inner, &window, &session, "live", "/socket", &[]).unwrap();
    let mut packets = Vec::new();
    wait_until(|| {
        if let Some(packet) = realtime_host::read(
            &core.inner,
            &window,
            &session,
            &opened.handle,
            packets.len() as u64,
        )
        .unwrap()
        {
            packets.push(packet);
        }
        packets.len() == 2
    });
    assert_eq!(packets[0].message, Message::Text("마지막 메시지".into()));
    assert!(
        matches!(&packets[1].message, Message::Terminal { code: 1000, reason, clean: true, error: None } if reason == "완료")
    );
    assert!(worker.join().unwrap(), "서버가 종료 응답을 받지 못했습니다");
    realtime_host::ack(&core.inner, &window, &session, &opened.handle, 2).unwrap();
    assert_eq!(
        realtime_host::read(&core.inner, &window, &session, &opened.handle, 2)
            .unwrap_err()
            .id
            .as_deref(),
        Some("CONN_REALTIME_HANDLE_MISSING")
    );
}
