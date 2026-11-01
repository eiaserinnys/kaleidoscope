use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

use crate::logins::LoginEntry;
use kaleidoscope_contract::data::{HttpMethod, SourceStatus};
use kaleidoscope_contract::registry::{ConnectionAccept, ConnectionInfo, ConnectionKind};
use url::Url;

#[derive(Default)]
struct BrowserHost {
    ports: Mutex<Vec<u16>>,
    urls: Mutex<Vec<String>>,
    wrong_state_first: AtomicBool,
}

impl Host for BrowserHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }

    fn open_url(&self, url: &str) -> std::io::Result<()> {
        self.urls.lock().unwrap().push(url.to_string());
        let authorization = Url::parse(url).unwrap();
        let params: std::collections::HashMap<_, _> =
            authorization.query_pairs().into_owned().collect();
        assert_eq!(
            params.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(params.get("code_challenge").unwrap().len(), 43);
        assert_eq!(params.get("scope").map(String::as_str), Some("read"));
        assert_eq!(
            params.get("resource").map(String::as_str),
            Some("urn:example")
        );
        let redirect = Url::parse(params.get("redirect_uri").unwrap()).unwrap();
        self.ports.lock().unwrap().push(redirect.port().unwrap());
        if self.wrong_state_first.swap(false, Ordering::SeqCst) {
            callback(&redirect, "wrong-state", "ignored-code")?;
        }
        callback(
            &redirect,
            params.get("state").unwrap(),
            "authorization-code",
        )
    }
}

struct NoCallbackHost;

impl Host for NoCallbackHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }

    fn open_url(&self, _: &str) -> std::io::Result<()> {
        Ok(())
    }
}

struct UnavailableBrowserHost;

impl Host for UnavailableBrowserHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }

    fn open_url(&self, _: &str) -> std::io::Result<()> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "browser unavailable",
        ))
    }
}

fn callback(redirect: &Url, state: &str, code: &str) -> std::io::Result<()> {
    let mut url = redirect.clone();
    url.query_pairs_mut()
        .append_pair("state", state)
        .append_pair("code", code);
    let mut stream = TcpStream::connect(("127.0.0.1", redirect.port().unwrap()))?;
    let target = url
        .query()
        .map(|query| format!("{}?{query}", url.path()))
        .unwrap_or_else(|| url.path().to_string());
    write!(
        stream,
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        target,
        redirect.port().unwrap()
    )?;
    Ok(())
}

fn connection_definition() -> String {
    json!({
        "id":"connection-app","name":"Connection","requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"readwrite","label":"API"}],
        "state":{"path":"/old","selected":null},
        "sources":{"items":{"kind":"request","permission":"api","path":{"state":"path"},"query":{"n":3}}},
        "ui":{"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$data.items.ok"}}]}
    })
    .to_string()
}

#[derive(Default)]
struct ServerState {
    registrations: usize,
    authorization_exchanges: usize,
    refreshes: usize,
    resource_requests: usize,
    refresh_response_delay: Duration,
    used_refresh_tokens: std::collections::BTreeSet<String>,
    invalid_client_first_exchange: bool,
    resource_requires_refreshed_token: bool,
    last_authorization: Option<String>,
    redirect_uris: Vec<String>,
    stream_status: u16,
    stream_requests: usize,
    stream_item: bool,
}

struct OAuthFixture {
    base: String,
    state: Arc<Mutex<ServerState>>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl OAuthFixture {
    fn start() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(ServerState::default()));
        let stop = Arc::new(AtomicBool::new(false));
        let server_state = state.clone();
        let server_stop = stop.clone();
        let server_base = base.clone();
        let thread = thread::spawn(move || {
            while !server_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let request = read_request(&mut stream);
                        if let Some(request) = request {
                            let (status, body) = respond(&request, &server_base, &server_state);
                            let _ = write!(
                                stream,
                                "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                if status < 400 { "OK" } else { "Bad Request" },
                                body.len(),
                                body
                            );
                            let _ = stream.flush();
                        }
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
}

impl Drop for OAuthFixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

struct HttpRequest {
    method: String,
    path: String,
    headers: String,
    body: String,
}

fn read_request(stream: &mut TcpStream) -> Option<HttpRequest> {
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let size = stream.read(&mut chunk).ok()?;
        if size == 0 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..size]);
        let Some(header_end) = bytes
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|position| position + 4)
        else {
            continue;
        };
        let headers = String::from_utf8_lossy(&bytes[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        if bytes.len() >= header_end + content_length {
            let line = headers.lines().next()?;
            let mut words = line.split_whitespace();
            return Some(HttpRequest {
                method: words.next()?.to_string(),
                path: words.next()?.to_string(),
                headers: headers.into_owned(),
                body: String::from_utf8_lossy(&bytes[header_end..header_end + content_length])
                    .into_owned(),
            });
        }
    }
}

fn respond(request: &HttpRequest, base: &str, state: &Arc<Mutex<ServerState>>) -> (u16, String) {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/v1/threads/thread-1/events") => {
            let mut state = state.lock().unwrap();
            state.stream_requests += 1;
            if state.stream_status == 401 || state.stream_status == 403 {
                return (state.stream_status, "{}".into());
            }
            let items = if state.stream_item {
                json!([{"id":"item-2","kind":"assistant","text":"새 메시지","at":"now","attachments":[]}])
            } else {
                json!([])
            };
            let snapshot = json!({"kind":"snapshot","snapshot":{"cursor":"1","busy":false,"tool":null,"stream_id":null,"text":null,"items":items}});
            (200, format!("id: 1\r\ndata: {snapshot}\r\n\r\n"))
        }
        ("GET", "/.well-known/oauth-authorization-server") => (
            200,
            json!({
                "authorization_endpoint":format!("{base}/authorize"),
                "token_endpoint":format!("{base}/token"),
                "registration_endpoint":format!("{base}/register"),
                "code_challenge_methods_supported":["S256"]
            })
            .to_string(),
        ),
        ("POST", "/register") => {
            let payload: Value = serde_json::from_str(&request.body).unwrap();
            let mut state = state.lock().unwrap();
            state.registrations += 1;
            state
                .redirect_uris
                .push(payload["redirect_uris"][0].as_str().unwrap().to_string());
            (
                200,
                json!({"client_id":format!("client-{}",state.registrations)}).to_string(),
            )
        }
        ("POST", "/token") => {
            let params: std::collections::HashMap<_, _> =
                url::form_urlencoded::parse(request.body.as_bytes())
                    .into_owned()
                    .collect();
            let mut state = state.lock().unwrap();
            if params.get("grant_type").map(String::as_str) == Some("refresh_token") {
                state.refreshes += 1;
                let refresh_number = state.refreshes;
                let refresh_token = params.get("refresh_token").cloned().unwrap_or_default();
                let duplicate = !state.used_refresh_tokens.insert(refresh_token);
                let response_delay = state.refresh_response_delay;
                drop(state);
                thread::sleep(response_delay);
                if duplicate {
                    (400, json!({"error":"invalid_grant"}).to_string())
                } else {
                    (
                        200,
                        json!({"access_token":"refreshed","refresh_token":format!("rotated-{refresh_number}"),"expires_in":3600})
                            .to_string(),
                    )
                }
            } else {
                state.authorization_exchanges += 1;
                if state.invalid_client_first_exchange && state.authorization_exchanges == 1 {
                    (400, json!({"error":"invalid_client"}).to_string())
                } else {
                    (
                        200,
                        json!({"access_token":"access-token","refresh_token":"refresh-token","expires_in":3600})
                            .to_string(),
                    )
                }
            }
        }
        ("GET", path) if path == "/old" || path.starts_with("/old?") => {
            let authorization = request
                .headers
                .lines()
                .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            let mut state = state.lock().unwrap();
            state.resource_requests += 1;
            state.last_authorization = Some(authorization.clone());
            if state.resource_requires_refreshed_token
                && !authorization.eq_ignore_ascii_case("Authorization: Bearer refreshed")
            {
                (401, json!({"error":"expired"}).to_string())
            } else {
                (200, json!({"ok":true}).to_string())
            }
        }
        _ => (404, json!({"error":"not found"}).to_string()),
    }
}

fn make_core(
    host: Arc<dyn Host>,
    temp: &TempDir,
    fixture: &OAuthFixture,
    kind: ConnectionKind,
) -> (Core, String) {
    let core = Core::open(
        CoreConfig {
            embedded_server: None,
            data_dir: temp.path().to_path_buf(),
            seed_definitions: vec![connection_definition()],
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "test-device".into(),
        },
        host,
    )
    .unwrap();
    *core.inner.connections.lock().unwrap() = vec![ConnectionInfo {
        name: "example".into(),
        kind,
        base_url: fixture.base.clone(),
        writable: true,
        paths: vec![],
        issuer: Some(fixture.base.clone()),
        scopes: Some("read".into()),
        resource: Some("urn:example".into()),
    }];
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-app");
    (core, window)
}

fn login(core: &Core, window: &str) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::ConnectionLogin {
        window_id: window.into(),
        permission: "api".into(),
    })
}

mod flows;
