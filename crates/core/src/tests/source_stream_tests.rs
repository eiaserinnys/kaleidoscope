//! 앱 정의의 `streams`와 `watch`. 로컬 가짜 SSE 서버로 규칙 맞춤, 합치기, 보임 판정,
//! 다시 이을 때 받기, relay 거부, 403 멈춤을 본다.
use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

use crate::logins::LoginEntry;
use kaleidoscope_contract::registry::{ConnectionInfo, ConnectionKind};

#[derive(Default)]
struct ServerState {
    stream_status: u16,
    stream_requests: usize,
    open: usize,
    closed: usize,
    item_fetches: usize,
    paged_fetches: usize,
    paths: Vec<String>,
    headers: Vec<String>,
    live: Vec<mpsc::Sender<String>>,
}

struct StreamFixture {
    base: String,
    state: Arc<Mutex<ServerState>>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl StreamFixture {
    fn start() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(ServerState {
            stream_status: 200,
            ..ServerState::default()
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let server_state = state.clone();
        let server_stop = stop.clone();
        let thread = thread::spawn(move || {
            while !server_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let state = server_state.clone();
                        thread::spawn(move || serve(&mut stream, &state));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            base,
            state,
            stop,
            thread: Some(thread),
        }
    }

    fn send(&self, event: &str, data: &str) {
        let mut state = self.state.lock().unwrap();
        state
            .live
            .retain(|sender| sender.send(format!("event: {event}\ndata: {data}\n\n")).is_ok());
    }

    fn close_connections(&self) {
        self.state.lock().unwrap().live.clear();
    }

    fn set_stream_status(&self, status: u16) {
        self.state.lock().unwrap().stream_status = status;
    }

    fn stream_requests(&self) -> usize {
        self.state.lock().unwrap().stream_requests
    }

    fn open(&self) -> usize {
        self.state.lock().unwrap().open
    }

    fn closed(&self) -> usize {
        self.state.lock().unwrap().closed
    }

    fn item_fetches(&self) -> usize {
        self.state.lock().unwrap().item_fetches
    }

    fn paged_fetches(&self) -> usize {
        self.state.lock().unwrap().paged_fetches
    }

    fn paths(&self) -> Vec<String> {
        self.state.lock().unwrap().paths.clone()
    }

    fn headers(&self) -> Vec<String> {
        self.state.lock().unwrap().headers.clone()
    }
}

impl Drop for StreamFixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.state.lock().unwrap().live.clear();
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

fn serve(stream: &mut TcpStream, state: &Arc<Mutex<ServerState>>) {
    let Some((method, target, headers)) = read_request(stream) else {
        return;
    };
    let path = target.split('?').next().unwrap_or(&target).to_string();
    state.lock().unwrap().paths.push(target.clone());
    if method != "GET" {
        let _ = write!(stream, "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    }
    if path == "/items" {
        let version = {
            let mut state = state.lock().unwrap();
            state.item_fetches += 1;
            state.item_fetches
        };
        let body = json!({"version": version}).to_string();
        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let _ = stream.flush();
        return;
    }
    if path == "/paged" {
        let second = target.contains("cursor=c1");
        {
            let mut state = state.lock().unwrap();
            state.paged_fetches += 1;
        }
        let body = if second {
            json!({"items":[{"n":2}],"nextCursor":null}).to_string()
        } else {
            json!({"items":[{"n":1}],"nextCursor":"c1"}).to_string()
        };
        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let _ = stream.flush();
        return;
    }
    if path == "/first" {
        let body = json!({"path":"/items"}).to_string();
        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let _ = stream.flush();
        return;
    }
    if path != "/events" {
        let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    }
    let (status, receiver) = {
        let mut state = state.lock().unwrap();
        state.stream_requests += 1;
        state.headers.push(headers);
        if state.stream_status != 200 {
            (state.stream_status, None)
        } else {
            state.open += 1;
            let (sender, receiver) = mpsc::channel();
            state.live.push(sender);
            (200, Some(receiver))
        }
    };
    if status != 200 {
        let _ = write!(stream, "HTTP/1.1 {status} Error\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}");
        return;
    }
    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: keep-alive\r\n\r\n");
    let _ = stream.flush();
    stream.set_nonblocking(true).ok();
    let receiver = receiver.unwrap();
    let mut scratch = [0u8; 64];
    let mut broken = false;
    loop {
        loop {
            match receiver.try_recv() {
                Ok(frame) => {
                    if stream.write_all(frame.as_bytes()).is_err() {
                        broken = true;
                        break;
                    }
                    let _ = stream.flush();
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    broken = true;
                    break;
                }
            }
        }
        if broken {
            break;
        }
        match stream.read(&mut scratch) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break,
        }
    }
    let mut state = state.lock().unwrap();
    state.open = state.open.saturating_sub(1);
    state.closed += 1;
}

fn read_request(stream: &mut TcpStream) -> Option<(String, String, String)> {
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let size = stream.read(&mut chunk).ok()?;
        if size == 0 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..size]);
        let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&bytes[..end]).into_owned();
        let line = headers.lines().next()?;
        let mut words = line.split_whitespace();
        return Some((
            words.next()?.to_string(),
            words.next()?.to_string(),
            headers,
        ));
    }
}

fn definition() -> String {
    json!({
        "id":"watch-app","name":"알림 원천","requires":{"blocks":4,"modules":{"connection":4}},
        "permissions":[{"module":"connection","id":"feed","connection":"example","access":"read","label":"피드"}],
        "streams":{"changes":{"permission":"feed","path":"/events","query":{"channel":"cards"}}},
        "state":{"kind":"card"},
        "sources":{"items":{"kind":"request","permission":"feed","path":"/items","refresh_secs":3600,
            "watch":{"stream":"changes","coalesce_secs":1,"on":[
                {"event":"message"},
                {"event":"update","where":{"kind":{"state":"kind"},"all":null}},
                {"event":"expr","where":{"kind":{"expr":"$state.kind"}}}
            ]}}},
        "ui":{"type":"text","value":{"expr":"$data.items.version"}}
    })
    .to_string()
}

fn paged_definition() -> String {
    json!({
        "id":"watch-paged","name":"쪽 있는 알림 원천","requires":{"blocks":22,"modules":{"connection":4}},
        "permissions":[{"module":"connection","id":"feed","connection":"example","access":"read","label":"피드"}],
        "streams":{"changes":{"permission":"feed","path":"/events"}},
        "state":{},
        "sources":{"items":{"kind":"request","permission":"feed","path":"/paged","refresh_secs":3600,
            "page":{"param":"cursor","next":"nextCursor","items":"items"},
            "watch":{"stream":"changes","coalesce_secs":1,"on":[{"event":"message"}]}}},
        "ui":{"type":"text","value":{"expr":"$data.items.items"}}
    })
    .to_string()
}

fn dependent_definition() -> String {
    json!({
        "id":"watch-dependent","name":"앞 원천을 기다리는 알림 원천","requires":{"blocks":4,"modules":{"connection":4}},
        "permissions":[{"module":"connection","id":"feed","connection":"example","access":"read","label":"피드"}],
        "streams":{"changes":{"permission":"feed","path":"/events"}},
        "state":{},
        "sources":{
            "first":{"kind":"request","permission":"feed","path":"/first","refresh_secs":3600},
            "items":{"kind":"request","permission":"feed","path":{"expr":"$data.first.path"},"refresh_secs":3600,
                "watch":{"stream":"changes","coalesce_secs":1,"on":[{"event":"message"}]}}
        },
        "ui":{"type":"text","value":{"expr":"$data.items.version"}}
    })
    .to_string()
}

struct Harness {
    fixture: StreamFixture,
    core: Core,
    window: String,
    _temp: TempDir,
}

fn harness(kind: ConnectionKind) -> Harness {
    harness_with(definition(), kind)
}

fn harness_with(definition: String, kind: ConnectionKind) -> Harness {
    let fixture = StreamFixture::start();
    let temp = TempDir::new().unwrap();
    let app_id = serde_json::from_str::<Value>(&definition).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let core = open_core(
        temp.path(),
        vec![definition],
        &Arc::new(FakeHost::default()),
    );
    *core.inner.connections.lock().unwrap() = vec![ConnectionInfo {
        name: "example".into(),
        kind,
        base_url: fixture.base.clone(),
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
            LoginEntry {
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
    let window = open_window(&core, &desktop, &app_id);
    Harness {
        fixture,
        core,
        window,
        _temp: temp,
    }
}

impl Harness {
    fn attach(&self) {
        self.core
            .handle(CoreRequest::DataAttach {
                window_id: self.window.clone(),
                dormant: vec![],
            })
            .unwrap();
    }

    fn wait_stream(&self) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if self.fixture.stream_requests() >= 1 && self.fixture.open() >= 1 {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!(
            "스트림이 열리지 않았습니다: requests={}, open={}",
            self.fixture.stream_requests(),
            self.fixture.open()
        );
    }

    fn wait_fetches(&self, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if self.fixture.item_fetches() >= expected {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!(
            "원천을 {expected}번 받지 않았습니다: {}",
            self.fixture.item_fetches()
        );
    }

    fn wait_paged_fetches(&self, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if self.fixture.paged_fetches() >= expected {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!(
            "쪽 원천을 {expected}번 받지 않았습니다: {}",
            self.fixture.paged_fetches()
        );
    }
}

#[test]
fn matching_notifications_refetch_watching_source_once_per_coalesce() {
    let harness = harness(ConnectionKind::Oauth);
    harness.attach();
    harness.wait_fetches(1);
    harness.wait_stream();
    assert!(
        harness
            .fixture
            .paths()
            .iter()
            .any(|path| path == "/events?channel=cards"),
        "{:?}",
        harness.fixture.paths()
    );
    assert!(harness
        .fixture
        .headers()
        .iter()
        .any(|headers| headers.to_ascii_lowercase().contains("authorization: bearer fixture-secret")));

    harness.fixture.send("other", r#"{"kind":"card"}"#);
    thread::sleep(Duration::from_millis(1500));
    assert_eq!(harness.fixture.item_fetches(), 1);

    harness.fixture.send("update", r#"{"kind":"other"}"#);
    thread::sleep(Duration::from_millis(1500));
    assert_eq!(harness.fixture.item_fetches(), 1);

    harness.fixture.send("update", r#"{"kind":"card","all":null}"#);
    harness.fixture.send("update", r#"{"kind":"card"}"#);
    harness.fixture.send("message", "not json");
    harness.wait_fetches(2);
    thread::sleep(Duration::from_millis(1500));
    assert_eq!(harness.fixture.item_fetches(), 2);
}

#[test]
fn where_expr_rule_matches_the_window_state_value() {
    let harness = harness(ConnectionKind::Oauth);
    harness.attach();
    harness.wait_fetches(1);
    harness.wait_stream();

    harness.fixture.send("expr", r#"{"kind":"other"}"#);
    thread::sleep(Duration::from_millis(1500));
    assert_eq!(harness.fixture.item_fetches(), 1);

    harness.fixture.send("expr", r#"{"kind":"card"}"#);
    harness.wait_fetches(2);
    thread::sleep(Duration::from_millis(1500));
    assert_eq!(harness.fixture.item_fetches(), 2);
}

#[test]
fn paged_source_does_not_refetch_from_the_first_page_on_a_notification() {
    let harness = harness_with(paged_definition(), ConnectionKind::Oauth);
    harness.attach();
    harness.wait_paged_fetches(1);
    harness.wait_stream();

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let reply = harness
            .core
            .handle(CoreRequest::DataMore {
                window_id: harness.window.clone(),
                source: "items".into(),
            })
            .unwrap();
        if matches!(reply, CoreReply::DataMore { started: true }) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "쪽 더 받기가 시작되지 않았습니다"
        );
        thread::sleep(Duration::from_millis(20));
    }
    harness.wait_paged_fetches(2);

    harness.fixture.send("message", "{}");
    thread::sleep(Duration::from_millis(1500));
    assert_eq!(harness.fixture.paged_fetches(), 2);
}

#[test]
fn watched_source_opens_its_stream_after_the_source_it_depends_on_fetches() {
    let harness = harness_with(dependent_definition(), ConnectionKind::Oauth);
    harness.attach();
    harness.wait_fetches(1);
    harness.wait_stream();
}

#[test]
fn hidden_window_opens_no_stream_and_refetches_stale_source_on_return() {
    let harness = harness(ConnectionKind::Oauth);
    harness.core.handle(CoreRequest::WindowMinimize { window_id: harness.window.clone() }).unwrap();
    harness.attach();
    thread::sleep(Duration::from_millis(300));
    assert_eq!(harness.fixture.stream_requests(), 0);
    assert_eq!(harness.fixture.item_fetches(), 0);

    harness.core.handle(CoreRequest::WindowRestore { window_id: harness.window.clone() }).unwrap();
    harness.wait_stream();
    harness.wait_fetches(1);

    harness.core.handle(CoreRequest::WindowMinimize { window_id: harness.window.clone() }).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && harness.fixture.open() > 0 {
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(harness.fixture.open(), 0);
    assert!(harness.fixture.closed() >= 1);

    thread::sleep(Duration::from_millis(1200));
    harness.core.handle(CoreRequest::WindowRestore { window_id: harness.window.clone() }).unwrap();
    harness.wait_stream();
    harness.wait_fetches(2);
}

#[test]
fn reconnect_refetches_sources_older_than_coalesce() {
    let harness = harness(ConnectionKind::Oauth);
    harness.attach();
    harness.wait_fetches(1);
    harness.wait_stream();
    thread::sleep(Duration::from_millis(1200));
    harness.fixture.close_connections();
    harness.wait_fetches(2);
    harness.wait_stream();
}

#[test]
fn relay_connections_never_open_a_stream() {
    let harness = harness(ConnectionKind::Relay);
    harness.attach();
    thread::sleep(Duration::from_millis(700));
    assert_eq!(harness.fixture.stream_requests(), 0);
}

#[test]
fn forbidden_stream_stops_until_connection_changes() {
    let harness = harness(ConnectionKind::Oauth);
    harness.fixture.set_stream_status(403);
    harness.attach();
    harness.wait_fetches(1);
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && harness.fixture.stream_requests() < 1 {
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(harness.fixture.stream_requests(), 1);
    thread::sleep(Duration::from_millis(2500));
    assert_eq!(harness.fixture.stream_requests(), 1);

    harness.fixture.set_stream_status(200);
    crate::source_streams::connection_changed(&harness.core.inner, "example");
    harness.wait_stream();
    assert_eq!(harness.fixture.stream_requests(), 2);
}
