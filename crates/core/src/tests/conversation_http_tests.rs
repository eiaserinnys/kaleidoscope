use super::*;
use crate::{conversation_context::Context, conversation_http::Client, logins::LoginEntry};
use kaleidoscope_contract::{
    conversation::EnsureThreadReply,
    registry::{ConnectionInfo, ConnectionKind},
    AppDefinition,
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

fn read_request(stream: &mut TcpStream) -> (String, String) {
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
        let headers = String::from_utf8_lossy(&bytes[..header_end]).to_string();
        let line = headers.lines().next().unwrap_or_default().to_string();
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
            return (
                line,
                String::from_utf8(bytes[header_end..header_end + length].to_vec()).unwrap(),
            );
        }
    }
}

fn server_with_requests(
    responses: Vec<(u16, String)>,
) -> (String, thread::JoinHandle<Vec<(String, String)>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let thread = thread::spawn(move || {
        let mut requests = Vec::new();
        for (status, body) in responses {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            return requests;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("accept failed: {error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            requests.push(read_request(&mut stream));
            write!(
                stream,
                "HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            stream.flush().unwrap();
        }
        requests
    });
    (base, thread)
}

fn pas_definition(attached_template: Option<&str>) -> String {
    let mut definition: Value =
        serde_json::from_str(include_str!("../../../../examples/workspace-pas-v2.json")).unwrap();
    if let Some(template) = attached_template {
        definition["agent"]["attached_instructions_template"] = json!(template);
        definition["requires"]["modules"]["agent"] = json!(4);
    }
    definition.to_string()
}

fn open_pas(
    base: &str,
    temp: &TempDir,
    attached_template: Option<&str>,
) -> (Core, Arc<FakeRegistryClient>, Context) {
    let client = registry_client();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(
        &temp.path().join("data"),
        vec![pas_definition(attached_template)],
        &host,
        client.clone(),
    );
    *core.inner.connections.lock().unwrap() = vec![ConnectionInfo {
        name: "conversation".into(),
        kind: ConnectionKind::Oauth,
        base_url: base.into(),
        writable: true,
        paths: vec![],
        issuer: None,
        scopes: None,
        resource: None,
    }];
    core.inner
        .login_store
        .store(
            "conversation",
            LoginEntry {
                issuer: base.into(),
                client_id: None,
                redirect_port: None,
                access_token: Some("access".into()),
                refresh_token: None,
                expires_at: None,
            },
        )
        .unwrap();
    mark_connected(&core);
    mark_layout_synced(&core);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "workspace-pas-v2");
    let ctx = Context::open(&core.inner, &window).unwrap();
    (core, client, ctx)
}

fn thread_json(id: &str, namespace: &str, key: &str) -> Value {
    json!({
        "id": id,
        "external": {"namespace": namespace, "key": key},
        "title": "연결한 대화",
        "model": {"id": "model-a", "label": "모델 A"},
        "created_at": "2026-11-08T12:00:00Z",
        "archived": false
    })
}

fn thread_info_reply(id: &str, namespace: &str, key: &str) -> String {
    json!({
        "thread": thread_json(id, namespace, key),
        "busy": false,
        "tool": null,
        "current_model": null
    })
    .to_string()
}

fn ensure_thread_reply(id: &str, namespace: &str, key: &str) -> String {
    json!({
        "thread": thread_json(id, namespace, key),
        "created": false,
        "notices": []
    })
    .to_string()
}

fn attached_entry(thread: &str) -> Value {
    json!({
        "connection": "conversation",
        "namespace": "bucket/attached",
        "external_key": thread,
        "thread_id": thread,
        "created_at": "2026-11-08T12:00:00Z",
        "attached": true
    })
}

#[test]
fn attach_reads_existing_thread_or_adopts_it() {
    let (base, server) = server_with_requests(vec![
        (404, String::new()),
        (200, thread_info_reply("thread-9", "elsewhere", "other")),
    ]);
    let temp = TempDir::new().unwrap();
    let (core, registry, ctx) = open_pas(&base, &temp, None);
    let thread = ctx.attach(&core.inner, "bucket", "thread-9").unwrap();
    assert_eq!(thread.id, "thread-9");
    let stored = registry
        .storage_value
        .lock()
        .unwrap()
        .clone()
        .unwrap()
        .0;
    assert_eq!(stored["attached"], json!(true));
    assert_eq!(stored["connection"], json!("conversation"));
    assert_eq!(stored["namespace"], json!("bucket/attached"));
    assert_eq!(stored["external_key"], json!("thread-9"));
    assert_eq!(stored["thread_id"], json!("thread-9"));
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[0]
        .0
        .starts_with("GET /api/conversations/v1/threads/by-key?"));
    assert!(requests[0].0.contains(&format!("key={}", ctx.workspace.id)));
    assert!(requests[0].0.contains("namespace=bucket"));
    assert!(requests[1]
        .0
        .starts_with("GET /api/conversations/v1/threads/thread-9 "));

    let (base, server) = server_with_requests(vec![
        (404, String::new()),
        (404, String::new()),
        (200, ensure_thread_reply("thread-9", "bucket/attached", "thread-9")),
    ]);
    let temp = TempDir::new().unwrap();
    let (core, registry, ctx) = open_pas(&base, &temp, None);
    let thread = ctx.attach(&core.inner, "bucket", "thread-9").unwrap();
    assert_eq!(thread.id, "thread-9");
    let stored = registry
        .storage_value
        .lock()
        .unwrap()
        .clone()
        .unwrap()
        .0;
    assert_eq!(stored["attached"], json!(true));
    assert_eq!(stored["namespace"], json!("bucket/attached"));
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[0]
        .0
        .starts_with("GET /api/conversations/v1/threads/by-key?"));
    assert!(requests[1]
        .0
        .starts_with("GET /api/conversations/v1/threads/thread-9 "));
    let adoption = &requests[2];
    assert!(adoption
        .0
        .starts_with("PUT /api/conversations/v1/threads/by-key/adoption?"));
    assert!(adoption.0.contains("key=thread-9"));
    assert!(adoption.0.contains("namespace=bucket%2Fattached"));
    assert_eq!(
        serde_json::from_str::<Value>(&adoption.1).unwrap(),
        json!({"session_id": "thread-9", "first_input_is_initial_instruction": false})
    );
}

#[test]
fn attach_reuses_an_owned_thread_entry_without_the_attached_mark() {
    let (base, server) = server_with_requests(vec![(
        200,
        json!({"thread": thread_json("thread-9", "bucket", "placeholder")}).to_string(),
    )]);
    let temp = TempDir::new().unwrap();
    let (core, registry, ctx) = open_pas(&base, &temp, None);
    let thread = ctx.attach(&core.inner, "bucket", "thread-9").unwrap();
    assert_eq!(thread.id, "thread-9");
    let stored = registry
        .storage_value
        .lock()
        .unwrap()
        .clone()
        .unwrap()
        .0;
    assert_eq!(stored["connection"], json!("conversation"));
    assert_eq!(stored["namespace"], json!("bucket"));
    assert_eq!(stored["external_key"], json!(ctx.workspace.id));
    assert_eq!(stored["thread_id"], json!("thread-9"));
    assert!(stored.get("attached").is_none());
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0]
        .0
        .starts_with("GET /api/conversations/v1/threads/by-key?"));
    assert!(requests[0].0.contains(&format!("key={}", ctx.workspace.id)));
    assert!(requests[0].0.contains("namespace=bucket"));
}

#[test]
fn reconcile_skips_attached_conversations() {
    let temp = TempDir::new().unwrap();
    let (core, registry, ctx) = open_pas("http://127.0.0.1:1", &temp, None);
    let workspace = ctx.workspace.clone();
    *registry.storage_value.lock().unwrap() = Some((attached_entry("thread-9"), "r0".into()));
    let (base, server) = server_with_requests(vec![
        (
            200,
            json!({"refs":[{"id":"thread-9","title":"연결한 대화","created_at":"2026-11-08T12:00:00Z","archived":false}]})
                .to_string(),
        ),
        (200, thread_info_reply("thread-9", "bucket", &workspace.id)),
    ]);
    core.inner.connections.lock().unwrap()[0].base_url = base;
    let definition: AppDefinition = serde_json::from_str(&pas_definition(None)).unwrap();
    let mut applied = crate::conversation_reconcile::Applied::default();
    crate::conversation_reconcile::reconcile_app(
        &core.inner,
        &definition,
        &[workspace],
        1,
        &mut applied,
    )
    .unwrap();
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests
        .iter()
        .all(|(line, _)| !line.starts_with("PATCH ")));
}

#[test]
fn detach_clears_the_entry_without_talking_to_the_provider() {
    let (base, server) = server_with_requests(vec![]);
    let temp = TempDir::new().unwrap();
    let (core, registry, ctx) = open_pas(&base, &temp, None);
    *registry.storage_value.lock().unwrap() = Some((attached_entry("thread-9"), "r0".into()));
    ctx.detach(&core.inner).unwrap();
    assert!(registry
        .storage_value
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .0
        .is_null());
    assert!(server.join().unwrap().is_empty());

    let (base, server) = server_with_requests(vec![]);
    let temp = TempDir::new().unwrap();
    let (core, registry, ctx) = open_pas(&base, &temp, None);
    ctx.detach(&core.inner).unwrap();
    assert!(registry.storage_value.lock().unwrap().is_none());
    assert!(server.join().unwrap().is_empty());
}

#[test]
fn attached_send_prepends_the_configured_instructions() {
    let (base, server) = server_with_requests(vec![
        (
            200,
            thread_info_reply("thread-9", "bucket/attached", "thread-9"),
        ),
        (
            200,
            json!({"request_id": "r1", "status": "accepted"}).to_string(),
        ),
    ]);
    let temp = TempDir::new().unwrap();
    let (core, registry, ctx) = open_pas(
        &base,
        &temp,
        Some("연결한 대화입니다: {workspace.name} ({workspace.id})"),
    );
    *registry.storage_value.lock().unwrap() = Some((attached_entry("thread-9"), "r0".into()));
    crate::conversation_send::send(&core.inner, &ctx, "r1".into(), "안녕".into(), vec![]).unwrap();
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1]
        .0
        .starts_with("POST /api/conversations/v1/threads/thread-9/messages "));
    let body: Value = serde_json::from_str(&requests[1].1).unwrap();
    assert_eq!(body["text"], json!("안녕"));
    assert_eq!(
        body["context"],
        json!(format!(
            "연결한 대화입니다: 작업 1 ({})",
            ctx.workspace.id
        ))
    );
}

#[test]
fn attached_conversation_rejects_profile_and_model_switches() {
    let (base, server) = server_with_requests(vec![]);
    let temp = TempDir::new().unwrap();
    let (core, registry, ctx) = open_pas(&base, &temp, None);
    *registry.storage_value.lock().unwrap() = Some((attached_entry("thread-9"), "r0".into()));
    let error = ctx
        .switch(&core.inner, "bucket", None, Some("model-b"))
        .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONV_SWITCH_ATTACHED"));
    assert!(server.join().unwrap().is_empty());
}
