use kaleidoscope_orchestrator::{EmbeddedConfig, EmbeddedServer};

#[tokio::test]
async fn embedded_restarts_with_persistent_identity_and_loopback_port() {
    let dir = tempfile::tempdir().unwrap();
    let config = || EmbeddedConfig {
        db_path: dir.path().join("local-orchestrator.db"),
        token_path: dir.path().join("local-orchestrator.token"),
        device_name: "시험 기기".into(),
    };
    let first = EmbeddedServer::start(config()).await.unwrap();
    let second = EmbeddedServer::start(config()).await.unwrap();
    assert_ne!(first.server_url, second.server_url);
    assert_eq!(first.device_id, second.device_id);
    assert_eq!(first.token, second.token);
    let response = reqwest::Client::new()
        .get(format!("{}/api/device/events", second.server_url))
        .bearer_auth(&second.token)
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
}

#[tokio::test]
async fn embedded_migrates_v14_through_comments_then_restarts() {
    use kaleidoscope_contract::{registry, Supported};
    use kaleidoscope_orchestrator::AppState;
    use rusqlite::Connection;
    use serde_json::{json, Value};
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    let config = || EmbeddedConfig {
        db_path: dir.path().join("test.sqlite"),
        token_path: dir.path().join("test.token"),
        device_name: "시험 기기".into(),
    };
    let state = AppState::open(config().db_path, "test-seed".into()).unwrap();
    let definition = json!({"id":"personal-app","name":"개인 앱","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"안녕"}}).to_string();
    state.publish_app(&definition, "test", false, None).unwrap();
    drop(state);
    let db = Connection::open(config().db_path).unwrap();
    db.execute_batch("DROP TABLE desktop_wallpapers; DROP TABLE desktop_shortcuts; DROP TABLE app_comment_replies; DROP TABLE app_comments; DROP TABLE app_comment_apps; DROP TABLE account_preferences; ALTER TABLE apps DROP COLUMN installation_json; PRAGMA user_version=14;").unwrap();
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        14
    );
    drop(db);


    let first = EmbeddedServer::start(config()).await.unwrap();
    let db = Connection::open(config().db_path).unwrap();
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        19
    );
    for table in [
        "app_comment_apps",
        "app_comments",
        "app_comment_replies",
        "desktop_shortcuts",
        "desktop_wallpapers",
    ] {
        let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)", [table], |row| row.get(0)).unwrap();
        assert!(exists, "커멘트 표가 없습니다: {table}");
    }
    let preferences_table: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_preferences')", [], |row| row.get(0)).unwrap();
    assert!(preferences_table);
    let origin: Option<String> = db
        .query_row(
            "SELECT installation_json FROM apps WHERE id='personal-app'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(origin.is_none());
    drop(db);
    drop(first);

    let second = EmbeddedServer::start(config()).await.unwrap();
    let mut response = reqwest::Client::new()
        .get(format!("{}/api/device/events", second.server_url))
        .bearer_auth(&second.token)
        .header(
            registry::REGISTRY_HEADER,
            registry::PREFERENCES_REGISTRY_VERSION.to_string(),
        )
        .header(
            registry::SUPPORTED_HEADER,
            serde_json::to_string(&Supported::current()).unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let events = tokio::time::timeout(Duration::from_secs(10), async {
        let mut buffer = Vec::new();
        loop {
            let chunk = response
                .chunk()
                .await
                .unwrap()
                .expect("이벤트 스트림이 끝났습니다");
            buffer.extend_from_slice(&chunk);
            let text = String::from_utf8_lossy(&buffer);
            let events: Vec<Value> = text
                .lines()
                .filter_map(|line| line.strip_prefix("data: "))
                .filter_map(|data| serde_json::from_str(data).ok())
                .collect();
            if events.len() >= 2 {
                break events;
            }
        }
    })
    .await
    .expect("스냅샷을 받지 못했습니다");
    assert_eq!(events[0]["event"], "apps.snapshot");
    assert_eq!(events[1]["event"], "preferences.snapshot");
    let app = events[0]["apps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["app"]["id"] == "personal-app")
        .unwrap();
    assert!(app["app"]["origin"].is_null());
    assert!(app["app"]["installed_version"].is_null());
}

#[tokio::test]
async fn embedded_serves_device_asset_upload_and_download() {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use sha2::{Digest, Sha256};

    let dir = tempfile::tempdir().unwrap();
    let config = || EmbeddedConfig {
        db_path: dir.path().join("assets.sqlite"),
        token_path: dir.path().join("assets.token"),
        device_name: "시험 기기".into(),
    };
    let server = EmbeddedServer::start(config()).await.unwrap();
    let bytes = STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        .unwrap();
    let upload = serde_json::json!({
        "id": "wall-1",
        "version": 1,
        "format": "png",
        "sha256": format!("{:x}", Sha256::digest(&bytes)),
        "source": "시험",
        "license": "user-provided",
        "data_base64": STANDARD.encode(&bytes),
    });
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/api/device/assets", server.server_url))
        .bearer_auth(&server.token)
        .json(&upload)
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let response = client
        .get(format!("{}/api/device/assets/wall-1/1", server.server_url))
        .bearer_auth(&server.token)
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    assert_eq!(response.bytes().await.unwrap().as_ref(), bytes.as_slice());
}
