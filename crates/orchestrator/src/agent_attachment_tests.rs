use super::*;
use axum::extract::State as MockState;
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::registry::AgentSendRequest;
use kaleidoscope_contract::registry::ShareUpload;

#[derive(Clone, Default)]
struct Mock(Arc<Mutex<Vec<(String, Value)>>>);
async fn intervene(MockState(mock): MockState<Mock>, Json(body): Json<Value>) -> Json<Value> {
    mock.0.lock().unwrap().push(("intervene".into(), body));
    Json(json!({}))
}
async fn intervene_fail(Json(_body): Json<Value>) -> StatusCode {
    StatusCode::BAD_GATEWAY
}
async fn session(MockState(mock): MockState<Mock>, Path(id): Path<String>) -> Json<Value> {
    mock.0.lock().unwrap().push(("session".into(), json!(id)));
    Json(json!({"session":{"node_id":"eiaserinnys"}}))
}
async fn upload(MockState(mock): MockState<Mock>, request: axum::extract::Request) -> Response {
    let query = request.uri().query().unwrap_or("").to_string();
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = axum::body::to_bytes(request.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let body = String::from_utf8_lossy(&body).into_owned();
    let mut calls = mock.0.lock().unwrap();
    let count = calls.iter().filter(|(name, _)| name == "upload").count();
    calls.push((
        "upload".into(),
        json!({"query":query,"content_type":content_type,"body":body}),
    ));
    Json(json!({"path":format!("/incoming/{count}.txt")})).into_response()
}
async fn upload_failure(
    MockState(mock): MockState<Mock>,
    request: axum::extract::Request,
) -> Response {
    mock.0
        .lock()
        .unwrap()
        .push(("upload".into(), json!({"failed":true})));
    let _ = axum::body::to_bytes(request.into_body(), 1024 * 1024)
        .await
        .unwrap();
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}
async fn read_file(MockState(mock): MockState<Mock>, request: axum::extract::Request) -> Response {
    let query = request.uri().query().unwrap_or("").to_string();
    mock.0.lock().unwrap().push(("file".into(), json!(query)));
    if query.contains("oversized") {
        return (
            StatusCode::OK,
            axum::body::Body::from(vec![
                b'x';
                (kaleidoscope_contract::AGENT_ATTACHMENT_MAX_BYTES + 1)
                    as usize
            ]),
        )
            .into_response();
    }
    if query.contains("source-missing") {
        return StatusCode::NOT_FOUND.into_response();
    }
    (
        StatusCode::OK,
        axum::body::Body::from(b"file bytes".as_slice()),
    )
        .into_response()
}

#[tokio::test]
async fn send_uploads_attachments_in_order_and_forwards_paths() {
    let mock = Mock::default();
    let app = Router::new()
        .route("/api/persistent-sessions/{id}", get(session))
        .route("/api/attachments/sessions", post(upload))
        .route("/api/sessions/{id}/intervene", post(intervene))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut state = AppState::in_memory("secret");
    state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        None,
    );
    state.lock_db().unwrap().execute(
        "INSERT INTO agents(workspace_id,device_id,session_id,model_preset,workspace_name,created_at) VALUES('w','d','pas1','codex-6.1-sol','작업','now')",
        [],
    ).unwrap();

    let response = send_message(
        State(state),
        Path("w".into()),
        Ok(Json(AgentSendRequest {
            text: "  ".into(),
            attachments: vec![
                kaleidoscope_contract::AgentUpload {
                    name: "첫/파일.txt".into(),
                    mime: "text/plain".into(),
                    data_base64: STANDARD.encode(b"first"),
                },
                kaleidoscope_contract::AgentUpload {
                    name: "둘째.png".into(),
                    mime: "image/png".into(),
                    data_base64: STANDARD.encode(b"second"),
                },
            ],
        })),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    let calls = mock.0.lock().unwrap();
    assert_eq!(
        calls.iter().filter(|(name, _)| name == "session").count(),
        1
    );
    let uploads: Vec<_> = calls.iter().filter(|(name, _)| name == "upload").collect();
    assert_eq!(uploads.len(), 2);
    assert!(uploads[0].1["content_type"]
        .as_str()
        .unwrap()
        .starts_with("multipart/form-data;"));
    assert!(uploads[0].1["body"]
        .as_str()
        .unwrap()
        .contains("name=\"session_id\""));
    assert!(uploads[0].1["body"].as_str().unwrap().contains("pas1"));
    assert!(uploads[0].1["body"]
        .as_str()
        .unwrap()
        .contains("filename=\"첫_파일.txt\""));
    assert!(uploads[0].1["query"]
        .as_str()
        .unwrap()
        .contains("nodeId=eiaserinnys"));
    assert!(uploads[0].1["body"]
        .as_str()
        .unwrap()
        .contains("Content-Type: text/plain"));
    assert!(uploads[0].1["body"].as_str().unwrap().contains("first"));
    assert!(uploads[1].1["body"]
        .as_str()
        .unwrap()
        .contains("filename=\"둘째.png\""));
    assert!(uploads[1].1["body"]
        .as_str()
        .unwrap()
        .contains("Content-Type: image/png"));
    assert!(uploads[1].1["body"].as_str().unwrap().contains("second"));
    let sent = calls.iter().find(|(name, _)| name == "intervene").unwrap();
    assert_eq!(sent.1["text"], "");
    assert_eq!(
        sent.1["attachment_paths"],
        json!(["/incoming/0.txt", "/incoming/1.txt"])
    );
    server.abort();
}

#[tokio::test]
async fn send_appends_share_block_and_only_marks_it_after_success() {
    let mock = Mock::default();
    let app = Router::new()
        .route("/api/sessions/{id}/intervene", post(intervene))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut state = AppState::in_memory("secret");
    state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        None,
    );
    state.lock_db().unwrap().execute(
        "INSERT INTO agents(workspace_id,device_id,session_id,model_preset,workspace_name,created_at) VALUES('w','d','pas1','codex-6.1-sol','작업','now')",
        [],
    ).unwrap();
    state
        .put_shared_view(
            "d",
            "test-pc",
            "window-12345678",
            ShareUpload {
                workspace_id: "w".into(),
                app_name: "편집기".into(),
                text: "보이는 글".into(),
                visual: false,
            },
        )
        .unwrap();

    attachments::send(
        &state,
        "w",
        AgentSendRequest {
            text: "안녕".into(),
            attachments: vec![],
        },
    )
    .await
    .unwrap();
    let sent = mock
        .0
        .lock()
        .unwrap()
        .iter()
        .find(|(kind, _)| kind == "intervene")
        .unwrap()
        .1["text"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(sent.starts_with("안녕\n\n<kaleidoscope-share>"));
    assert!(sent.contains("## 편집기 (창 window-1): 새로 같이 봄\n보이는 글"));
    assert!(state
        .share_block_for_send("w")
        .unwrap()
        .unwrap()
        .0
        .contains("## 편집기 (창 window-1): 그대로"));
    server.abort();

    let app = Router::new().route("/api/sessions/{id}/intervene", post(intervene_fail));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let failing_server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut failed_state = AppState::in_memory("secret");
    failed_state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        None,
    );
    failed_state.lock_db().unwrap().execute(
        "INSERT INTO agents(workspace_id,device_id,session_id,model_preset,workspace_name,created_at) VALUES('w','d','pas1','codex-6.1-sol','작업','now')",
        [],
    ).unwrap();
    failed_state
        .put_shared_view(
            "d",
            "test-pc",
            "window-12345678",
            ShareUpload {
                workspace_id: "w".into(),
                app_name: "편집기".into(),
                text: "보이는 글".into(),
                visual: false,
            },
        )
        .unwrap();
    assert!(attachments::send(
        &failed_state,
        "w",
        AgentSendRequest {
            text: "안녕".into(),
            attachments: vec![],
        },
    )
    .await
    .is_err());
    assert!(failed_state
        .share_block_for_send("w")
        .unwrap()
        .unwrap()
        .0
        .contains("## 편집기 (창 window-1): 새로 같이 봄"));
    failing_server.abort();
}

#[tokio::test]
async fn send_validates_attachment_limits_and_encodings() {
    let state = AppState::in_memory("secret");
    let mut requests = vec![AgentSendRequest {
        text: "  ".into(),
        attachments: vec![],
    }];
    requests.push(AgentSendRequest {
        text: "x".repeat(kaleidoscope_contract::registry::AGENT_MESSAGE_MAX_CHARS + 1),
        attachments: vec![],
    });
    requests.push(AgentSendRequest {
        text: "".into(),
        attachments: (0..=kaleidoscope_contract::AGENT_ATTACHMENTS_MAX)
            .map(|_| kaleidoscope_contract::AgentUpload {
                name: "a".into(),
                mime: "".into(),
                data_base64: "".into(),
            })
            .collect(),
    });
    requests.push(AgentSendRequest {
        text: "x".into(),
        attachments: vec![kaleidoscope_contract::AgentUpload {
            name: "  ".into(),
            mime: "".into(),
            data_base64: "".into(),
        }],
    });
    requests.push(AgentSendRequest {
        text: "x".into(),
        attachments: vec![kaleidoscope_contract::AgentUpload {
            name: "a".into(),
            mime: "".into(),
            data_base64: "not base64!".into(),
        }],
    });
    let one_file_groups = (kaleidoscope_contract::AGENT_ATTACHMENT_MAX_BYTES / 3 + 1) as usize;
    requests.push(AgentSendRequest {
        text: "x".into(),
        attachments: vec![kaleidoscope_contract::AgentUpload {
            name: "large.bin".into(),
            mime: "".into(),
            data_base64: "AAAA".repeat(one_file_groups),
        }],
    });
    let half_total_groups = (kaleidoscope_contract::AGENT_ATTACHMENTS_TOTAL_MAX_BYTES / 6) as usize;
    requests.push(AgentSendRequest {
        text: "x".into(),
        attachments: vec![
            kaleidoscope_contract::AgentUpload {
                name: "a.bin".into(),
                mime: "".into(),
                data_base64: "AAAA".repeat(half_total_groups),
            },
            kaleidoscope_contract::AgentUpload {
                name: "b.bin".into(),
                mime: "".into(),
                data_base64: "AAAA".repeat(half_total_groups + 1),
            },
        ],
    });

    for request in requests {
        let Err((status, error)) = super::attachments::send(&state, "w", request).await else {
            panic!("잘못된 요청이 통과했습니다")
        };
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert!(!error.message.is_empty());
    }
}

#[tokio::test]
async fn upload_failure_does_not_send_intervention() {
    let mock = Mock::default();
    let app = Router::new()
        .route("/api/persistent-sessions/{id}", get(session))
        .route("/api/attachments/sessions", post(upload_failure))
        .route("/api/sessions/{id}/intervene", post(intervene))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut state = AppState::in_memory("secret");
    state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        None,
    );
    state.lock_db().unwrap().execute("INSERT INTO agents(workspace_id,device_id,session_id,model_preset,workspace_name,created_at) VALUES('w','d','pas1','codex-6.1-sol','작업','now')", []).unwrap();
    let result = super::attachments::send(
        &state,
        "w",
        AgentSendRequest {
            text: "요청".into(),
            attachments: vec![kaleidoscope_contract::AgentUpload {
                name: "a.txt".into(),
                mime: "text/plain".into(),
                data_base64: STANDARD.encode(b"a"),
            }],
        },
    )
    .await
    .unwrap_err();
    assert_eq!(result.0, StatusCode::BAD_GATEWAY);
    assert!(!mock
        .0
        .lock()
        .unwrap()
        .iter()
        .any(|(name, _)| name == "intervene"));
    server.abort();
}

#[tokio::test]
async fn attachment_route_authenticates_and_reads_only_recorded_workspace_files() {
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    let mock = Mock::default();
    let upstream = Router::new()
        .route("/api/persistent-sessions/{id}", get(session))
        .route("/api/attachments/files", get(read_file))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });

    let mut state = AppState::in_memory("secret");
    state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        None,
    );
    state.lock_db().unwrap().execute("INSERT INTO agents(workspace_id,device_id,session_id,model_preset,workspace_name,created_at) VALUES('w','d','pas1','codex-6.1-sol','작업','now'),('other','d','pas2','codex-6.1-sol','다른 작업','now')", []).unwrap();
    state.lock_db().unwrap().execute(
        "INSERT INTO agent_items(id,workspace_id,kind,text,at,attachments) VALUES(1,'w','user','','now',?1),(2,'other','user','','now',?2),(3,'w','user','','now',?3),(4,'w','user','','now',?4)",
        params![
            serde_json::to_string(&vec![super::StoredAgentAttachment { name:"hello.txt".into(), mime:"text/plain".into(), path:"/incoming/hello.txt".into() }]).unwrap(),
            serde_json::to_string(&vec![super::StoredAgentAttachment { name:"other.txt".into(), mime:"text/plain".into(), path:"/incoming/other.txt".into() }]).unwrap(),
            serde_json::to_string(&vec![super::StoredAgentAttachment { name:"large.txt".into(), mime:"text/plain".into(), path:"/incoming/oversized".into() }]).unwrap(),
            serde_json::to_string(&vec![super::StoredAgentAttachment { name:"missing.txt".into(), mime:"text/plain".into(), path:"/incoming/source-missing".into() }]).unwrap(),
        ],
    ).unwrap();
    let token = random_token();
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO devices(id,name,token_sha256,created_at) VALUES('device','test',?1,'now')",
            [sha256_hex(token.as_bytes())],
        )
        .unwrap();
    let app = crate::router(state);
    let unauthenticated = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/device/workspaces/w/agent/items/1/attachments/0")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
    let request = |workspace: &str, item: &str, index: u32| {
        axum::http::Request::builder()
            .uri(format!(
                "/api/device/workspaces/{workspace}/agent/items/{item}/attachments/{index}"
            ))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(axum::body::Body::empty())
            .unwrap()
    };
    let response = app.clone().oneshot(request("w", "1", 0)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let value: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(
        value,
        json!({"name":"hello.txt","mime":"text/plain","data_base64":STANDARD.encode(b"file bytes")})
    );
    assert_eq!(
        app.clone()
            .oneshot(request("other", "1", 0))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.clone()
            .oneshot(request("w", "1", 1))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.clone()
            .oneshot(request("w", "3", 0))
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.clone()
            .oneshot(request("w", "4", 0))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert!(mock
        .0
        .lock()
        .unwrap()
        .iter()
        .any(|(name, value)| name == "file"
            && value.as_str().unwrap().contains("nodeId=eiaserinnys")));
    server.abort();
}
