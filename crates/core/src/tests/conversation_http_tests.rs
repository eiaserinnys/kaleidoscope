use super::*;
use crate::{conversation_http::Client, logins::LoginEntry};
use kaleidoscope_contract::{
    conversation::EnsureThreadReply,
    registry::{ConnectionInfo, ConnectionKind},
};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

fn read_body(stream: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let read = stream.read(&mut buffer).unwrap();
        assert_ne!(read, 0, "request ended before its full body arrived");
        bytes.extend_from_slice(&buffer[..read]);
        let Some(header_end) = bytes
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|index| index + 4)
        else {
            continue;
        };
        let headers = String::from_utf8_lossy(&bytes[..header_end]);
        let length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        if bytes.len() >= header_end + length {
            return String::from_utf8(bytes[header_end..header_end + length].to_vec()).unwrap();
        }
    }
}

fn server(responses: Vec<(u16, String)>) -> (String, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let thread = thread::spawn(move || {
        let mut bodies = Vec::new();
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            bodies.push(read_body(&mut stream));
            write!(
                stream,
                "HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            stream.flush().unwrap();
        }
        bodies
    });
    (base, thread)
}

fn client(base: String, temp: &TempDir) -> Client {
    let logins = Arc::new(crate::logins::Logins::open(temp.path()).unwrap());
    logins
        .store(
            "provider",
            LoginEntry {
                issuer: base.clone(),
                client_id: None,
                redirect_port: None,
                access_token: Some("access".into()),
                refresh_token: None,
                expires_at: None,
            },
        )
        .unwrap();
    Client {
        info: ConnectionInfo {
            name: "provider".into(),
            kind: ConnectionKind::Oauth,
            base_url: base,
            writable: true,
            paths: vec![],
            issuer: None,
            scopes: None,
            resource: None,
        },
        workspace_name: "작업".into(),
        base_path: "/v1".into(),
        logins,
        profiler: Default::default(),
    }
}

fn settled_reply() -> String {
    json!({
        "thread": {
            "id": "thread-1",
            "external": {"namespace": "n", "key": "k"},
            "title": "대화",
            "model": {"id": "model-2", "label": "모델 2"},
            "profile": {"id": "profile-b", "label": "키키"},
            "created_at": "2026-11-02T00:00:00Z",
            "archived": false
        },
        "created": true,
        "notices": []
    })
    .to_string()
}

fn pending_reply() -> String {
    json!({
        "error": {"code": "pending", "message": "still running"}
    })
    .to_string()
}

fn check_pending_put(path: &str) {
    let (base, server) = server(vec![(504, pending_reply()), (200, settled_reply())]);
    let temp = TempDir::new().unwrap();
    let client = client(base, &temp);
    let body = json!({"selected_model": "model-2", "profile": "profile-b"});
    let reply: Option<EnsureThreadReply> = client
        .json_until_settled(reqwest::Method::PUT, path, &BTreeMap::new(), Some(&body))
        .unwrap();
    let reply = reply.unwrap();
    assert_eq!(reply.thread.model.id, "model-2");
    assert!(reply.created);
    let bodies = server.join().unwrap();
    assert_eq!(bodies.len(), 2);
    assert_eq!(bodies[0], bodies[1]);
    assert_eq!(serde_json::from_str::<Value>(&bodies[0]).unwrap(), body);
}

#[test]
fn create_request_waits_for_pending_provider_result_and_reuses_body() {
    check_pending_put("/v1/threads/by-key");
}

#[test]
fn switch_request_waits_for_pending_provider_result_and_reuses_body() {
    check_pending_put("/v1/threads/thread-1/execution");
}

#[test]
fn unrelated_504_fails_without_retrying() {
    let (base, server) = server(vec![(
        504,
        json!({
            "error": {"code": "unavailable", "message": "failed"}
        })
        .to_string(),
    )]);
    let temp = TempDir::new().unwrap();
    let client = client(base, &temp);
    let body = json!({"selected_model": "model-2"});
    let result: Result<Option<EnsureThreadReply>, _> = client.json_until_settled(
        reqwest::Method::PUT,
        "/v1/threads/thread-1/execution",
        &BTreeMap::new(),
        Some(&body),
    );
    assert_eq!(result.unwrap_err().code, ErrorCode::Server);
    assert_eq!(server.join().unwrap().len(), 1);
}
