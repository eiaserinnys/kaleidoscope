use super::*;
use kaleidoscope_contract::ErrorCode;
use std::io::{Read, Write};
use std::net::TcpListener;

#[test]
fn raw_app_value_url_preserves_key_segments_without_empty_segment() {
    let url = raw_app_value_item_url("http://127.0.0.1:1234/", "agent", "settings/agents").unwrap();
    assert_eq!(
        url.as_str(),
        "http://127.0.0.1:1234/api/device/app-values/agent/settings/agents"
    );
}

#[test]
fn parses_deleted_snapshot_and_event() {
    assert!(
        matches!(parse_event_line(r#"data: {"event":"apps.snapshot","apps":[],"deleted":["personal"]}"#), Some(DeviceEvent::AppsSnapshot { deleted, .. }) if deleted == ["personal"])
    );
    assert!(
        matches!(parse_event_line(r#"data: {"event":"app.deleted","app_id":"personal"}"#), Some(DeviceEvent::AppDeleted { app_id }) if app_id == "personal")
    );
}

#[test]
fn old_registry_without_storage_route_reports_unavailable() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let worker = std::thread::spawn(move || {
        let (mut conn, _) = listener.accept().unwrap();
        let mut bytes = [0; 4096];
        let n = conn.read(&mut bytes).unwrap();
        conn.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
            .unwrap();
        String::from_utf8(bytes[..n].to_vec()).unwrap()
    });
    let error = HttpRegistryClient::new()
        .storage_get(
            &format!("http://{addr}"),
            "token",
            "app",
            "entry",
            "workspace",
        )
        .unwrap_err();
    assert!(
        matches!(error, RegistryError::Validation(error) if error.code == ErrorCode::Unavailable)
    );
    assert!(worker
        .join()
        .unwrap()
        .starts_with("GET /api/device/app-storage/app/items/entry?workspace_id=workspace "));
}

#[test]
fn storage_write_conflict_preserves_server_error_and_adds_current_revision() {
    fn server(body: String) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(conn.try_clone().unwrap());
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                headers.push_str(&line);
            }
            let length = headers
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|value| value.trim().parse::<usize>().ok())
                })
                .unwrap();
            let mut request_body = vec![0; length];
            reader.read_exact(&mut request_body).unwrap();
            write!(
                conn,
                "HTTP/1.1 409 Conflict\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            assert!(headers.starts_with("PUT /api/device/app-storage/app/items/entry?"));
        });
        (address, worker)
    }

    let body = serde_json::json!({
        "current_revision":"revision-2",
        "error": {
            "id":"STORAGE_ITEM_WRITE_CONFLICT",
            "code":"conflict",
            "message":"저장 항목 settings/title: 읽은 뒤 값이 바뀌었습니다. 값을 다시 읽고 변경 내용을 적용하세요.",
            "details":[]
        }
    });
    let (url, worker) = server(body.to_string());
    let error = HttpRegistryClient::new()
        .storage_write(
            &url,
            "token",
            "app",
            "entry",
            "workspace",
            &kaleidoscope_contract::app_storage::StorageWriteRequest {
                content: serde_json::json!("changed"),
                expected_revision: kaleidoscope_contract::app_storage::ExpectedRevision(Some(
                    "revision-1".into(),
                )),
            },
        )
        .unwrap_err();
    assert!(matches!(error, RegistryError::Validation(error)
        if error.id.as_deref() == Some("STORAGE_ITEM_WRITE_CONFLICT")
            && error.details == ["current_revision=revision-2"]));
    worker.join().unwrap();

    let (url, worker) = server(r#"{"current_revision":"revision-2"}"#.into());
    let error = HttpRegistryClient::new()
        .storage_write(
            &url,
            "token",
            "app",
            "entry",
            "workspace",
            &kaleidoscope_contract::app_storage::StorageWriteRequest {
                content: serde_json::json!("changed"),
                expected_revision: kaleidoscope_contract::app_storage::ExpectedRevision(None),
            },
        )
        .unwrap_err();
    assert!(matches!(error, RegistryError::Validation(error)
        if error.id.as_deref() == Some("STORAGE_SERVER_WRITE_CONFLICT")
            && error.details == ["current_revision=revision-2"]));
    worker.join().unwrap();
}

#[test]
fn request_failure_does_not_expose_url_query_keys() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let url = format!("http://{address}/api?api_key=secret-query-key");
    let error = reqwest::blocking::Client::new()
        .get(url)
        .send()
        .unwrap_err();

    let error = request_failure(error);

    match error {
        RegistryError::Failure {
            stage: crate::registry_client::FailureStage::Send,
            detail,
        } => {
            assert!(!detail.contains("api_key"));
            assert!(!detail.contains("secret-query-key"));
        }
        error => panic!("unexpected registry error: {error:?}"),
    }
}

#[test]
fn event_connection_reports_builtin_registration_send_failure() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let result =
        HttpRegistryClient::new().open_events(&format!("http://{address}"), "secret-token");
    match result {
        Err(RegistryError::Validation(error)) => {
            assert_eq!(
                error.id.as_deref(),
                Some("CONN_BUILTIN_REGISTER_SEND_FAILED")
            );
            assert!(error
                .details
                .iter()
                .any(|detail| detail.contains("host=127.0.0.1")));
            assert!(!format!("{error:?}").contains("secret-token"));
        }
        _ => panic!("기본 앱 등록의 전송 오류가 나오지 않았습니다"),
    }
}

#[test]
fn events_send_supported_header() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = server.local_addr().unwrap();
    let worker = std::thread::spawn(move || {
        let (mut register, _) = server.accept().unwrap();
        let mut reader = BufReader::new(register.try_clone().unwrap());
        let mut headers = String::new();
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            headers.push_str(&line);
        }
        assert!(headers.starts_with("POST /api/device/builtin-specs "));
        let length = headers
            .lines()
            .find_map(|line| {
                line.to_lowercase()
                    .strip_prefix("content-length: ")
                    .and_then(|value| value.trim().parse::<usize>().ok())
            })
            .unwrap();
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        let specs: Vec<kaleidoscope_contract::worker::BuiltinRuntimeSpec> =
            serde_json::from_slice(&body).unwrap();
        assert!(specs
            .iter()
            .any(|spec| spec.app_id == "slackbot" && spec.worker.is_some()));
        register
            .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap();
        drop(register);
        drop(reader);
        let (mut conn, _) = server.accept().unwrap();
        let mut bytes = [0; 8192];
        let size = conn.read(&mut bytes).unwrap();
        conn.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .unwrap();
        String::from_utf8(bytes[..size].to_vec()).unwrap()
    });
    HttpRegistryClient::new()
        .open_events(&format!("http://{addr}"), "token")
        .unwrap();
    let request = worker.join().unwrap().to_lowercase();
    let header = request
        .lines()
        .find(|line| line.starts_with("x-kaleidoscope-supported: "))
        .unwrap();
    let supported: kaleidoscope_contract::Supported =
        serde_json::from_str(header.split_once(": ").unwrap().1).unwrap();
    assert_eq!(supported.blocks, kaleidoscope_contract::BLOCK_SET_VERSION);
    assert_eq!(supported.modules.get("storage"), Some(&3));
    assert_eq!(supported.modules.get("agent"), Some(&3));
    assert!(request.contains(&format!("{REGISTRY_HEADER}: {REGISTRY_VERSION}")));
}

#[test]
fn layout_changes_posts_and_classifies_responses() {
    fn server(status: &str, body: String) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let status = status.to_owned();
        let worker = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(conn.try_clone().unwrap());
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                headers.push_str(&line);
            }
            let length = headers
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|v| v.trim().parse::<usize>().ok())
                })
                .unwrap();
            let mut request_body = vec![0; length];
            reader.read_exact(&mut request_body).unwrap();
            write!(conn, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\n\r\n{body}", body.len()).unwrap();
            format!("{headers}{}", String::from_utf8(request_body).unwrap())
        });
        (address, worker)
    }
    let changes = LayoutChanges {
        deleted_windows: vec!["window".into()],
        ..Default::default()
    };
    let (url, worker) = server("200 OK", serde_json::to_string(&changes).unwrap());
    assert_eq!(
        HttpRegistryClient::new()
            .push_layout_changes(&url, "token", &changes)
            .unwrap(),
        changes
    );
    let request = worker.join().unwrap();
    assert!(request.starts_with(&format!("POST {DEVICE_LAYOUT_CHANGES_PATH} ")));
    assert!(request.contains("\"deleted_windows\":[\"window\"]"));
    let expected_error = kaleidoscope_contract::errors::SERVER_LAYOUT_CHANGE_BODY_INVALID();
    let (url, worker) = server(
        "400 Bad Request",
        serde_json::to_string(&expected_error).unwrap(),
    );
    let result = HttpRegistryClient::new().push_layout_changes(&url, "token", &changes);
    assert!(matches!(result, Err(RegistryError::Validation(error))
            if error.code == expected_error.code
                && error.id.as_deref() == expected_error.id.as_deref()
                && error.message == expected_error.message
                && error.details.iter().any(|detail| detail.contains("HTTP 400"))));
    worker.join().unwrap();
    let (url, worker) = server("401 Unauthorized", "{}".into());
    assert!(matches!(
        HttpRegistryClient::new().push_layout_changes(&url, "token", &changes),
        Err(RegistryError::Unauthorized)
    ));
    worker.join().unwrap();
    let (url, worker) = server("404 Not Found", "{}".into());
    assert!(matches!(
        HttpRegistryClient::new().push_layout_changes(&url, "token", &changes),
        Err(RegistryError::Failure {
            stage: crate::registry_client::FailureStage::Status,
            ..
        })
    ));
    worker.join().unwrap();
}

#[test]
fn snapshot_keeps_readable_apps_when_another_definition_is_unknown() {
    let definition: serde_json::Value =
        serde_json::from_str(include_str!("../../../apps/md-editor.json")).unwrap();
    let app = serde_json::json!({"app":{"id":"md-editor","name":"editor","current_version":1,"created_at":"now","updated_at":"now"},"version":{"app_id":"md-editor","version":1,"definition":definition,"created_at":"now"}});
    let mut bad = app.clone();
    bad["version"]["definition"]["ui"] = serde_json::json!({"type":"future_block"});
    let line = format!(
        "data: {}",
        serde_json::json!({"event":"apps.snapshot","apps":[bad, app]})
    );
    assert!(
        matches!(parse_event_line(&line), Some(DeviceEvent::AppsSnapshot { apps, .. }) if apps.len() == 1)
    );
}
