use super::*;
use axum::body::Body;
use tower::ServiceExt;

const EDITOR: &str = include_str!("../../../examples/md-editor.json");

#[test]
fn app_upload_versions_and_deduplicates_identical_definitions() {
    let state = AppState::in_memory("secret");
    let (first, unchanged) = state.publish_app(EDITOR, "agent", false).unwrap();
    assert_eq!(first.version.version, 1);
    assert!(!unchanged);
    let (same, unchanged) = state.publish_app(EDITOR, "agent", false).unwrap();
    assert_eq!(same.version.version, 1);
    assert!(unchanged);
    let modified = EDITOR.replace("마크다운 편집기", "편집기 변경");
    assert_ne!(modified, EDITOR);
    let (second, unchanged) = state.publish_app(&modified, "agent", false).unwrap();
    assert_eq!(second.version.version, 2);
    assert!(!unchanged);
}

#[test]
fn invalid_definitions_and_outside_paths_are_rejected_without_saving() {
    let state = AppState::in_memory("secret");
    let malformed = r#"{"id":"bad","name":"Bad"}"#;
    let err = state.publish_app(malformed, "agent", false).unwrap_err();
    assert!(!err.details.is_empty());
    let outside = EDITOR.replace(
        r#""path": { "state": "current_file" }"#,
        r#""path": "../secret.md""#,
    );
    assert_ne!(outside, EDITOR);
    let err = state.publish_app(&outside, "agent", false).unwrap_err();
    assert!(err
        .details
        .iter()
        .any(|detail| detail.contains("고른 폴더 밖")));
    let count: i64 = state
        .lock_db()
        .unwrap()
        .query_row("SELECT count(*) FROM apps", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn pairing_start_pending_approve_consumes_token_once_and_expires() {
    let state = AppState::in_memory("secret");
    let start = state.start_pairing("my-pc".into()).await.unwrap();
    assert!(matches!(
        state.poll_pairing(&start.device_code).await.unwrap(),
        PairPollReply::Pending {}
    ));
    let (id, name) = state
        .approve_pairing(&start.user_code.to_lowercase())
        .await
        .unwrap();
    assert_eq!(name, "my-pc");
    let PairPollReply::Approved { device_id, token } =
        state.poll_pairing(&start.device_code).await.unwrap()
    else {
        panic!("승인되어야 함")
    };
    assert_eq!(device_id, id);
    assert_eq!(state.authenticate_device(&token).unwrap().unwrap().0, id);
    assert_eq!(
        state.poll_pairing(&start.device_code).await.unwrap_err().0,
        StatusCode::NOT_FOUND
    );
    let expired = state.start_pairing("old".into()).await.unwrap();
    state
        .0
        .pairings
        .lock()
        .await
        .get_mut(&expired.device_code)
        .unwrap()
        .expires_at_unix = Utc::now().timestamp() - 1;
    assert_eq!(
        state
            .poll_pairing(&expired.device_code)
            .await
            .unwrap_err()
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn pending_pairing_limit_is_twenty() {
    let state = AppState::in_memory("secret");
    for _ in 0..registry::PAIRING_MAX_PENDING {
        state.start_pairing("pc".into()).await.unwrap();
    }
    assert_eq!(
        state.start_pairing("pc".into()).await.unwrap_err().0,
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[tokio::test]
async fn invalid_and_revoked_device_tokens_receive_401() {
    let state = AppState::in_memory("secret");
    let (id, token) = make_device(&state);
    let app = router(state.clone());
    let invalid = app
        .clone()
        .oneshot(request(
            "GET",
            "/api/device/events",
            Some("wrong"),
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);
    state.revoke_device(&id).unwrap();
    let revoked = app
        .oneshot(request(
            "POST",
            "/api/device/apps",
            Some(&token),
            Body::from(r#"{"definition_json":"{}"}"#),
        ))
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn mcp_requires_bearer_token() {
    let app = router(AppState::in_memory("secret"));
    let response=app.oneshot(request("POST","/mcp",None,Body::from(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}"#))).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn event_stream_starts_with_snapshot_then_published_app() {
    use futures::StreamExt;
    let state = AppState::in_memory("secret");
    let (id, token) = make_device(&state);
    let response = router(state.clone())
        .oneshot(request(
            "GET",
            "/api/device/events",
            Some(&token),
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body();
    let mut body_stream = body.into_data_stream();
    let first = String::from_utf8(body_stream.next().await.unwrap().unwrap().to_vec()).unwrap();
    assert!(first.contains("apps.snapshot"), "{first}");
    state.publish_app(EDITOR, "agent", true).unwrap();
    let second = String::from_utf8(body_stream.next().await.unwrap().unwrap().to_vec()).unwrap();
    assert!(second.contains("app.published"), "{second}");
    assert!(second.contains("\"open\":true"), "{second}");
    assert_eq!(state.0.connections.lock().unwrap().get(&id), Some(&1));
}

fn request(method: &str, path: &str, token: Option<&str>, body: Body) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    builder.body(body).unwrap()
}

fn make_device(state: &AppState) -> (String, String) {
    let id = Uuid::new_v4().to_string();
    let token = random_token();
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO devices(id,name,token_sha256,created_at) VALUES(?1,'test',?2,?3)",
            params![id, sha256_hex(token.as_bytes()), timestamp()],
        )
        .unwrap();
    (id, token)
}
