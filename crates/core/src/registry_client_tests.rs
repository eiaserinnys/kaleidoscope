use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

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
fn events_send_supported_header() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = server.local_addr().unwrap();
    let worker = std::thread::spawn(move || {
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
    assert_eq!(supported.blocks, 6);
    assert_eq!(supported.modules.get("storage"), Some(&2));
    assert_eq!(supported.modules.get("agent"), Some(&2));
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
    let error = CoreError::new(kaleidoscope_contract::ErrorCode::InvalidRequest);
    let (url, worker) = server("400 Bad Request", serde_json::to_string(&error).unwrap());
    assert!(
        matches!(HttpRegistryClient::new().push_layout_changes(&url, "token", &changes), Err(RegistryError::Validation(e)) if e == error)
    );
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
        Err(RegistryError::Failure(_))
    ));
    worker.join().unwrap();
}

#[test]
fn snapshot_keeps_readable_apps_when_another_definition_is_unknown() {
    let definition: serde_json::Value =
        serde_json::from_str(include_str!("../../../examples/md-editor.json")).unwrap();
    let app = serde_json::json!({"app":{"id":"md-editor","name":"editor","current_version":1,"created_at":"now","updated_at":"now"},"version":{"app_id":"md-editor","version":1,"definition":definition,"created_at":"now"}});
    let mut bad = app.clone();
    bad["version"]["definition"]["ui"] = serde_json::json!({"type":"future_block"});
    let line = format!(
        "data: {}",
        serde_json::json!({"event":"apps.snapshot","apps":[bad, app]})
    );
    assert!(
        matches!(parse_event_line(&line), Some(DeviceEvent::AppsSnapshot { apps }) if apps.len() == 1)
    );
}
