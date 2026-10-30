use super::*;

#[tokio::test]
async fn relay_endpoint_checks_permission_path_write_and_returns_origin_status_without_redirecting()
{
    use axum::{
        body::to_bytes,
        extract::{Request as AxumRequest, State as AxumState},
        http::Uri,
        response::IntoResponse,
        routing::any,
    };
    use http_body_util::BodyExt;
    use std::sync::{Arc, Mutex as StdMutex};

    #[derive(Clone, Default)]
    struct OriginRecord(Arc<StdMutex<Vec<(String, String, String, String, String)>>>);
    async fn origin(
        AxumState(record): AxumState<OriginRecord>,
        request: AxumRequest,
    ) -> axum::response::Response {
        let (parts, body) = request.into_parts();
        let method = parts.method.to_string();
        let uri: Uri = parts.uri.clone();
        let authorization = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let content_type = parts
            .headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = String::from_utf8(to_bytes(body, 1024 * 1024).await.unwrap().to_vec()).unwrap();
        record
            .0
            .lock()
            .unwrap()
            .push((method, uri.to_string(), authorization, content_type, body));
        if uri.path().ends_with("/large") {
            let body = "x".repeat(kaleidoscope_contract::data::SOURCE_MAX_BYTES as usize + 1);
            return (StatusCode::OK, [(header::CONTENT_TYPE, "text/plain")], body).into_response();
        }
        if uri.path().ends_with("/redirect") {
            return (
                StatusCode::FOUND,
                [(header::LOCATION, "http://127.0.0.1:1/final")],
                "redirect",
            )
                .into_response();
        }
        (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"missing":true}"#,
        )
            .into_response()
    }

    let record = OriginRecord::default();
    let fake = Router::new()
        .fallback(any(origin))
        .with_state(record.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });

    std::env::set_var("KALEIDOSCOPE_TEST_CONNECTION_TOKEN", "secret-from-env");
    let state = AppState::in_memory("secret");
    state.publish_app(BROWSER, "agent", false, None).unwrap();
    state.publish_app(LEGACY_APP, "agent", false, None).unwrap();
    state.publish_app(CARD_BOARD, "agent", false, None).unwrap();
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO connections(name,kind,base_url,writable,paths,headers,description,updated_at) VALUES('board','relay',?1,1,'[\"/v1\"]','{\"Authorization\":\"Bearer ${env:KALEIDOSCOPE_TEST_CONNECTION_TOKEN}\"}','','now')",
            [format!("http://{address}")],
        ).unwrap();
    }
    let app = router(state.clone());
    let request_body = |app_id: &str, path: &str, method: &str| {
        json!({
            "app_id": app_id,
            "method": method,
            "path": path,
            "query": {"z": "a b", "a": "1"},
            "body": {"status": "done"},
            "accept": "json"
        })
    };
    let token = make_device(&state).1;
    let call = |path: &str, method: &str, app_id: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/device/connections/board/request")
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(request_body(app_id, path, method).to_string()))
            .unwrap()
    };

    let response = app
        .clone()
        .oneshot(call("/v1/items", "POST", "card-board"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reply: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(reply["status"], 404);
    assert_eq!(reply["json"]["missing"], true);
    assert_eq!(
        record.0.lock().unwrap().last().unwrap(),
        &(
            "POST".into(),
            "/v1/items?a=1&z=a+b".into(),
            "Bearer secret-from-env".into(),
            "application/json".into(),
            "{\"status\":\"done\"}".into()
        )
    );

    let denied_app = app
        .clone()
        .oneshot(call("/v1/items", "GET", "web-browser"))
        .await
        .unwrap();
    assert_eq!(denied_app.status(), StatusCode::FORBIDDEN);
    let invalid_path = app
        .clone()
        .oneshot(call("/v1/../private", "GET", "card-board"))
        .await
        .unwrap();
    assert_eq!(invalid_path.status(), StatusCode::BAD_REQUEST);
    state
        .lock_db()
        .unwrap()
        .execute("UPDATE connections SET paths='[]' WHERE name='board'", [])
        .unwrap();
    let encoded_dot_path = app
        .clone()
        .oneshot(call("/safe/%2e./secret", "GET", "card-board"))
        .await
        .unwrap();
    assert_eq!(encoded_dot_path.status(), StatusCode::BAD_REQUEST);
    state
        .lock_db()
        .unwrap()
        .execute("UPDATE connections SET writable=0 WHERE name='board'", [])
        .unwrap();
    let denied_write = app
        .clone()
        .oneshot(call("/v1/items", "POST", "card-board"))
        .await
        .unwrap();
    assert_eq!(denied_write.status(), StatusCode::FORBIDDEN);
    let redirect = app
        .clone()
        .oneshot(call("/v1/redirect", "GET", "card-board"))
        .await
        .unwrap();
    assert_eq!(redirect.status(), StatusCode::OK);
    let redirect_reply: Value =
        serde_json::from_slice(&redirect.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(redirect_reply["status"], 302);
    assert_eq!(
        record.0.lock().unwrap().last().unwrap().1,
        "/v1/redirect?a=1&z=a+b"
    );

    let too_large = app
        .clone()
        .oneshot(call("/v1/large", "GET", "card-board"))
        .await
        .unwrap();
    assert_eq!(too_large.status(), StatusCode::PAYLOAD_TOO_LARGE);

    state
        .lock_db()
        .unwrap()
        .execute("UPDATE connections SET kind='oauth' WHERE name='board'", [])
        .unwrap();
    let oauth = app
        .oneshot(call("/v1/items", "GET", "card-board"))
        .await
        .unwrap();
    assert_eq!(oauth.status(), StatusCode::BAD_REQUEST);
    server.abort();
}
