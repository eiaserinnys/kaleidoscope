//! 현재 서버의 도구 끝점만 제공하는 프로세스별 루프백 중계.
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    response::Response,
    routing::any,
    Router,
};
use futures_util::StreamExt;
use kaleidoscope_contract::{errors, CoreError};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    thread::JoinHandle,
};
use tokio::sync::{oneshot, watch};

const BODY_LIMIT: usize = 48 * 1024 * 1024;
struct Binding {
    handle: String,
    upstream: String,
    token: String,
    workspace: String,
    revoked: watch::Sender<bool>,
}
struct Shared {
    port: u16,
    client: reqwest::Client,
    bindings: Mutex<HashMap<String, Arc<Binding>>>,
}
pub(super) struct Relay {
    shared: Arc<Shared>,
    shutdown: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}
impl Relay {
    pub fn new() -> Result<Self, CoreError> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|_| errors::PROCESS_RELAY_LISTEN_FAILED())?;
        listener
            .set_nonblocking(true)
            .map_err(|_| errors::PROCESS_RELAY_LISTEN_FAILED())?;
        let port = listener
            .local_addr()
            .map_err(|_| errors::PROCESS_RELAY_LISTEN_FAILED())?
            .port();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| errors::PROCESS_RELAY_CLIENT_FAILED())?;
        let shared = Arc::new(Shared {
            port,
            client,
            bindings: Mutex::new(HashMap::new()),
        });
        let router = Router::new()
            .fallback(any(forward))
            .with_state(shared.clone());
        let (tx, rx) = oneshot::channel();
        let thread = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("중계 런타임");
            runtime.block_on(async move {
                if let Ok(listener) = tokio::net::TcpListener::from_std(listener) {
                    let _ = axum::serve(listener, router)
                        .with_graceful_shutdown(async {
                            let _ = rx.await;
                        })
                        .await;
                }
            });
        });
        Ok(Self {
            shared,
            shutdown: Some(tx),
            thread: Some(thread),
        })
    }
    pub fn bind(&self, handle: &str, server: &str, token: &str, workspace: &str) -> String {
        let credential = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let (revoked, _) = watch::channel(false);
        let binding = Binding {
            handle: handle.into(),
            upstream: format!("{}/mcp", server.trim_end_matches('/')),
            token: token.into(),
            workspace: workspace.into(),
            revoked,
        };
        self.shared
            .bindings
            .lock()
            .unwrap()
            .insert(credential.clone(), Arc::new(binding));
        format!("http://127.0.0.1:{}/{credential}", self.shared.port)
    }
    pub fn revoke(&self, handle: &str) {
        self.shared.bindings.lock().unwrap().retain(|_, binding| {
            if binding.handle == handle {
                binding.revoked.send_replace(true);
                false
            } else {
                true
            }
        });
    }
    pub fn revoke_all(&self) {
        for (_, binding) in self.shared.bindings.lock().unwrap().drain() {
            binding.revoked.send_replace(true);
        }
    }
}
impl Drop for Relay {
    fn drop(&mut self) {
        self.revoke_all();
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
fn rejected(status: StatusCode, error: CoreError) -> Response {
    let body = serde_json::to_vec(&error).expect("등록 오류 직렬화");
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap()
}
async fn forward(State(shared): State<Arc<Shared>>, request: Request) -> Response {
    let expected_host = format!("127.0.0.1:{}", shared.port);
    if request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        != Some(expected_host.as_str())
    {
        return rejected(StatusCode::FORBIDDEN, errors::PROCESS_RELAY_HOST_INVALID());
    }
    if request.headers().contains_key(header::ORIGIN) {
        return rejected(
            StatusCode::FORBIDDEN,
            errors::PROCESS_RELAY_ORIGIN_FORBIDDEN(),
        );
    }
    if !matches!(
        *request.method(),
        Method::GET | Method::POST | Method::DELETE
    ) {
        return rejected(
            StatusCode::METHOD_NOT_ALLOWED,
            errors::PROCESS_RELAY_METHOD_INVALID(),
        );
    }
    let credential = request.uri().path().strip_prefix('/').unwrap_or("");
    let binding = shared.bindings.lock().unwrap().get(credential).cloned();
    let Some(binding) = binding else {
        return rejected(
            StatusCode::FORBIDDEN,
            errors::PROCESS_RELAY_CREDENTIAL_INVALID(),
        );
    };
    let mut revoked = binding.revoked.subscribe();
    if *revoked.borrow() {
        return rejected(
            StatusCode::FORBIDDEN,
            errors::PROCESS_RELAY_CREDENTIAL_INVALID(),
        );
    }
    let method = request.method().clone();
    let headers = request.headers().clone();
    let body = tokio::select! {
        body = to_bytes(request.into_body(), BODY_LIMIT) => match body {
            Ok(body) => body,
            Err(_) => return rejected(StatusCode::BAD_REQUEST, errors::PROCESS_RELAY_BODY_INVALID()),
        },
        _ = revoked.changed() => return rejected(StatusCode::FORBIDDEN, errors::PROCESS_RELAY_CREDENTIAL_INVALID()),
    };
    let mut outgoing = shared
        .client
        .request(method, &binding.upstream)
        .bearer_auth(&binding.token)
        .header(
            kaleidoscope_contract::registry::WORKSPACE_HEADER,
            &binding.workspace,
        )
        .body(body);
    for name in [
        "content-type",
        "accept",
        "mcp-session-id",
        "mcp-protocol-version",
        "last-event-id",
    ] {
        if let Some(value) = headers.get(name) {
            outgoing = outgoing.header(name, value);
        }
    }
    let response = tokio::select! {
        response = outgoing.send() => match response { Ok(response) => response, Err(_) => return rejected(StatusCode::BAD_GATEWAY, errors::PROCESS_RELAY_UPSTREAM_FAILED()) },
        _ = revoked.changed() => return rejected(StatusCode::FORBIDDEN, errors::PROCESS_RELAY_CREDENTIAL_INVALID()),
    };
    let status = response.status();
    let mut result = Response::builder().status(status);
    for name in [
        "content-type",
        "cache-control",
        "mcp-session-id",
        "mcp-protocol-version",
        "retry-after",
    ] {
        if let Some(value) = response.headers().get(name) {
            if let Ok(value) = HeaderValue::from_bytes(value.as_bytes()) {
                result = result.header(name, value);
            }
        }
    }
    let stream = response.bytes_stream();
    let output = futures_util::stream::unfold(
        (Box::pin(stream), revoked),
        |(mut stream, mut revoked)| async move {
            tokio::select! {
                chunk = stream.next() => chunk.map(|chunk| (chunk, (stream, revoked))),
                _ = revoked.changed() => None,
            }
        },
    );
    result.body(Body::from_stream(output)).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        sync::mpsc,
        time::Duration,
    };

    fn read_headers(stream: &std::net::TcpStream) -> String {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut headers = String::new();
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" || line.is_empty() {
                break;
            }
            headers.push_str(&line);
        }
        headers
    }

    #[test]
    fn relay_uses_only_bound_upstream_and_rejects_revoked_credentials() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let server = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        let upstream = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let headers = read_headers(&stream);
            tx.send(headers).unwrap();
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}").unwrap();
        });
        let relay = Relay::new().unwrap();
        let address = relay.bind("handle", &server, "device-secret", "workspace-1");
        let client = reqwest::blocking::Client::new();
        assert_eq!(
            client
                .get(&address)
                .header("origin", "https://example.test")
                .send()
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            client
                .get(&address)
                .header("host", "example.test")
                .send()
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        let reply = client
            .post(&address)
            .header("authorization", "Bearer forged")
            .header(kaleidoscope_contract::registry::WORKSPACE_HEADER, "other")
            .header("content-type", "application/json")
            .body("{}")
            .send()
            .unwrap();
        assert_eq!(reply.status(), StatusCode::OK);
        let headers = rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .to_lowercase();
        assert!(headers.starts_with("post /mcp "));
        assert!(headers.contains("authorization: bearer device-secret"));
        assert!(headers.contains("x-kaleidoscope-workspace: workspace-1"));
        assert!(!headers.contains("bearer forged"));
        assert!(!headers.contains("x-kaleidoscope-workspace: other"));
        relay.revoke("handle");
        let response = client.get(&address).send().unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body = response.text().unwrap();
        assert!(body.contains("PROCESS_RELAY_CREDENTIAL_INVALID"));
        assert!(!body.contains("device-secret"));
        assert!(!body.contains(&address));
        upstream.join().unwrap();
    }

    #[test]
    fn sse_flows_and_closing_the_client_cancels_upstream() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let server = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        let upstream = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            read_headers(&stream);
            stream
                .set_read_timeout(Some(Duration::from_secs(8)))
                .unwrap();
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n9\r\ndata: 1\n\n\r\n").unwrap();
            let mut byte = [0];
            tx.send(matches!(stream.read(&mut byte), Ok(0))).unwrap();
        });
        let relay = Relay::new().unwrap();
        let address = relay.bind("handle", &server, "device-secret", "workspace");
        let mut response = reqwest::blocking::Client::new()
            .get(&address)
            .send()
            .unwrap();
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        let mut first = [0; 9];
        response.read_exact(&mut first).unwrap();
        assert_eq!(&first, b"data: 1\n\n");
        drop(response);
        assert!(
            rx.recv_timeout(Duration::from_secs(10)).unwrap(),
            "클라이언트 취소가 상류에 전달되어야 한다"
        );
        upstream.join().unwrap();
    }
}
