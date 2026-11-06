use super::*;
use kaleidoscope_contract::app_comments::AppCommentAppMeta;
use kaleidoscope_contract::registry::LayoutChanges;
use std::io::{Read, Write};
use std::net::TcpListener;

fn meta(app_id: &str, revision: u64) -> AppCommentAppMeta {
    AppCommentAppMeta {
        app_id: app_id.into(),
        revision,
        open_count: revision,
        unsent_count: 0,
        unread_reply_count: 0,
    }
}

#[test]
fn app_comments_snapshots_changes_switch_and_restart() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(dir.path(), vec![], &host, registry_client());
    mark_connected(&core);
    assert_eq!(snapshot(&core).shared.app_comments, None);
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppCommentsSnapshot { apps: vec![] },
    );
    assert_eq!(snapshot(&core).shared.app_comments, Some(BTreeMap::new()));
    for m in [meta("a", 2), meta("b", 3), meta("a", 1)] {
        crate::registry_events::apply_event(
            &core.inner,
            0,
            DeviceEvent::AppCommentsChanged { meta: m },
        );
    }
    let expected = BTreeMap::from([("a".into(), meta("a", 2)), ("b".into(), meta("b", 3))]);
    assert_eq!(snapshot(&core).shared.app_comments, Some(expected.clone()));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: vec![],
            desktops: vec![],
            windows: vec![],
            desktop_shortcuts: vec![],
        },
    );
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges::default(),
        },
    );
    let state = core.inner.state.lock().unwrap();
    assert_eq!(state.shared.app_comments, Some(expected));
    let (batch, _) = crate::layout_sync::batch(&state.shared, &state.sync);
    assert!(serde_json::to_value(batch)
        .unwrap()
        .get("app_comments")
        .is_none());
    drop(state);
    core.inner.generation.store(1, Ordering::SeqCst);
    crate::server_switch::activate(&core.inner, connected_link_file(), 1).unwrap();
    assert_eq!(snapshot(&core).shared.app_comments, None);
    assert!(!crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppCommentsChanged {
            meta: meta("a", 99)
        }
    ));
    assert_eq!(snapshot(&core).shared.app_comments, None);
    crate::registry_events::apply_event(
        &core.inner,
        1,
        DeviceEvent::AppCommentsSnapshot {
            apps: vec![meta("a", 1)],
        },
    );
    core.shutdown();
    drop(core);
    let restarted = open_core_with_client(dir.path(), vec![], &host, registry_client());
    assert_eq!(snapshot(&restarted).shared.app_comments, None);
}

fn thread_json() -> Value {
    json!({"id":"thread", "app_id":"app/한글", "number":1, "created_app_version":1,
        "created_definition_digest":"digest", "created_shell_version":"1", "origin":{"kind":"personal"},
        "source_window_id":"window", "anchor":{"schema_version":1,"kind":"block"}, "text":"본문",
        "reply_count":0, "image":{"width":1,"height":1,"byte_size":3,"capture_surface":"window_body", "target_rect":{"x":0,"y":0,"width":1,"height":1}},
        "resolved":false, "unread_reply":false, "created_at":"today", "updated_at":"today", "revision":1, "replies":[]})
}

fn request(stream: &mut std::net::TcpStream) -> (String, Value, String) {
    let mut bytes = Vec::new();
    let mut buf = [0; 4096];
    loop {
        let n = stream.read(&mut buf).unwrap();
        assert_ne!(n, 0);
        bytes.extend_from_slice(&buf[..n]);
        let Some(end) = bytes
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|i| i + 4)
        else {
            continue;
        };
        let header = String::from_utf8_lossy(&bytes[..end]);
        let length = header
            .lines()
            .find_map(|l| {
                l.split_once(':')
                    .filter(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                    .map(|(_, v)| v.trim().parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        if bytes.len() >= end + length {
            let body = if length == 0 {
                Value::Null
            } else {
                serde_json::from_slice(&bytes[end..end + length]).unwrap()
            };
            return (
                header.lines().next().unwrap().to_string(),
                body,
                header.to_string(),
            );
        }
    }
}

#[test]
fn app_comments_commands_use_device_http_and_preserve_server_errors() {
    let dir = TempDir::new().unwrap();
    let core = open_core(dir.path(), vec![], &Arc::new(FakeHost::default()));
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut file = connected_link_file();
    file.server_url = format!("http://{}", listener.local_addr().unwrap());
    *core.inner.link_file.lock().unwrap() = Some(file.clone());
    core.inner.state.lock().unwrap().link = LinkStatus::Connected {
        mode: file.mode,
        server_url: file.server_url,
        device_name: file.device_name,
    };
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppCommentsSnapshot { apps: vec![] },
    );
    let metadata = serde_json::to_value(meta("app/한글", 2)).unwrap();
    let thread = thread_json();
    let reply = json!({"id":"reply","author":"user","text":"답글","created_at":"today"});
    let image = vec![1u8, 2, 3];
    let responses: Vec<(u16, Vec<u8>)> = vec![
        (
            200,
            json!({"items":[thread],"next_cursor":"next","app_revision":2})
                .to_string()
                .into_bytes(),
        ),
        (200, json!({"thread":thread}).to_string().into_bytes()),
        (
            200,
            json!({"thread":thread,"meta":metadata})
                .to_string()
                .into_bytes(),
        ),
        (
            200,
            json!({"reply":reply,"meta":metadata})
                .to_string()
                .into_bytes(),
        ),
        (
            200,
            json!({"thread":thread,"meta":metadata})
                .to_string()
                .into_bytes(),
        ),
        (200, json!({"meta":metadata}).to_string().into_bytes()),
        (200, json!({"meta":metadata}).to_string().into_bytes()),
        (200, json!({"meta":metadata}).to_string().into_bytes()),
        (200, json!({"thread":thread}).to_string().into_bytes()),
        (200, image),
        (
            404,
            serde_json::to_vec(&kaleidoscope_contract::errors::COMMENT_GET_NOT_FOUND(
                "missing",
            ))
            .unwrap(),
        ),
    ];
    let worker = thread::spawn(move || {
        let mut received = Vec::new();
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            received.push(request(&mut stream));
            write!(
                stream,
                "HTTP/1.1 {status} Response\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
        }
        received
    });
    let create = json!({"id":"thread", "anchor":{"schema_version":1,"kind":"block"}, "text":"본문", "origin":{"kind":"personal"}, "created_app_version":1,"created_definition_digest":"digest","created_shell_version":"1","source_window_id":"window"});
    let cases = vec![
        json!({"op":"comment.list","app_id":"app/한글","cursor":"c /"}),
        json!({"op":"comment.get","app_id":"app/한글","id":"t/1"}),
        json!({"op":"comment.create","app_id":"app/한글","request":create}),
        json!({"op":"comment.reply","app_id":"app/한글","id":"t/1","request":{"id":"reply","text":"답글"}}),
        json!({"op":"comment.resolve","app_id":"app/한글","id":"t/1","request":{"resolved":true,"fixed_app_version":2}}),
        json!({"op":"comment.delete","app_id":"app/한글","id":"t/1"}),
        json!({"op":"comment.mark_sent","app_id":"app/한글","ids":["t/1"]}),
        json!({"op":"comment.mark_read","app_id":"app/한글","id":"t/1"}),
        json!({"op":"comment.image","app_id":"app/한글","id":"t/1"}),
    ];
    let mut results = Vec::new();
    for value in cases {
        results.push(
            serde_json::to_value(core.handle(serde_json::from_value(value).unwrap()).unwrap())
                .unwrap(),
        );
    }
    assert_eq!(results[0]["next_cursor"], "next");
    assert_eq!(results[1]["thread"]["text"], "본문");
    assert_eq!(results[2]["thread"]["id"], "thread");
    assert_eq!(results[3]["reply"]["text"], "답글");
    for result in &results[2..8] {
        assert_eq!(result["meta"]["revision"], 2);
    }
    assert_eq!(results[8]["image"]["image_base64"], "AQID");
    assert_eq!(
        snapshot(&core).shared.app_comments.unwrap()["app/한글"],
        meta("app/한글", 2)
    );
    let error = core
        .handle(CoreRequest::CommentGet {
            app_id: "app/한글".into(),
            id: "missing".into(),
        })
        .unwrap_err();
    assert_eq!(
        error,
        kaleidoscope_contract::errors::COMMENT_GET_NOT_FOUND("missing")
    );
    let requests = worker.join().unwrap();
    let base = "/api/device/app-comments/app%2F%ED%95%9C%EA%B8%80";
    let thread_path = format!("{base}/t%2F1");
    let expected = vec![
        format!("GET {base}?cursor=c+%2F HTTP/1.1"),
        format!("GET {thread_path} HTTP/1.1"),
        format!("POST {base} HTTP/1.1"),
        format!("POST {thread_path}/replies HTTP/1.1"),
        format!("PUT {thread_path}/resolved HTTP/1.1"),
        format!("DELETE {thread_path} HTTP/1.1"),
        format!("POST {base}/sent HTTP/1.1"),
        format!("POST {thread_path}/read HTTP/1.1"),
        format!("GET {thread_path} HTTP/1.1"),
        format!("GET {thread_path}/image HTTP/1.1"),
        format!("GET {base}/missing HTTP/1.1"),
    ];
    assert_eq!(
        requests.iter().map(|r| &r.0).collect::<Vec<_>>(),
        expected.iter().collect::<Vec<_>>()
    );
    assert_eq!(requests[2].1, create);
    assert_eq!(requests[3].1, json!({"id":"reply","text":"답글"}));
    assert_eq!(
        requests[4].1,
        json!({"resolved":true,"fixed_app_version":2})
    );
    assert_eq!(requests[6].1, json!({"ids":["t/1"]}));
    assert!(requests.iter().all(|r| r
        .2
        .to_lowercase()
        .contains("authorization: bearer secret-device-token")));
}

#[test]
fn app_comments_old_server_write_response_cannot_overwrite_new_server() {
    let dir = TempDir::new().unwrap();
    let core = Arc::new(open_core(
        dir.path(),
        vec![],
        &Arc::new(FakeHost::default()),
    ));
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut file = connected_link_file();
    file.server_url = format!("http://{}", listener.local_addr().unwrap());
    *core.inner.link_file.lock().unwrap() = Some(file.clone());
    core.inner.state.lock().unwrap().link = LinkStatus::Connected {
        mode: file.mode,
        server_url: file.server_url,
        device_name: file.device_name,
    };
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppCommentsSnapshot { apps: vec![] },
    );
    let (sent, waiting) = mpsc::channel();
    let (release, proceed) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = request(&mut stream);
        sent.send(()).unwrap();
        proceed.recv_timeout(Duration::from_secs(10)).unwrap();
        let body = json!({"meta":meta("app",99)}).to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
    });
    let worker_core = core.clone();
    let worker = thread::spawn(move || {
        worker_core.handle(CoreRequest::CommentMarkRead {
            app_id: "app".into(),
            id: "id".into(),
        })
    });
    waiting.recv_timeout(Duration::from_secs(10)).unwrap();
    core.inner.generation.store(1, Ordering::SeqCst);
    crate::server_switch::activate(&core.inner, connected_link_file(), 1).unwrap();
    crate::registry_events::apply_event(
        &core.inner,
        1,
        DeviceEvent::AppCommentsSnapshot {
            apps: vec![meta("app", 1)],
        },
    );
    release.send(()).unwrap();
    let error = worker.join().unwrap().unwrap_err();
    assert_eq!(
        error,
        kaleidoscope_contract::errors::SERVER_SWITCH_CANCELLED()
    );
    assert_eq!(
        snapshot(&core).shared.app_comments.unwrap()["app"],
        meta("app", 1)
    );
    server.join().unwrap();
}
