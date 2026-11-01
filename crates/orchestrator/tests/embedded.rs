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
