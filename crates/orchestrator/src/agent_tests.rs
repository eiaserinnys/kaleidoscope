use super::*;
use axum::{extract::State as MockState, http::HeaderMap as MockHeaders};

#[derive(Clone, Default)]
struct Mock(Arc<Mutex<Vec<(String, Value)>>>);
async fn make(MockState(mock): MockState<Mock>, Json(body): Json<Value>) -> Response {
    let preset = body["settings"]["default_model"]["model_preset"]
        .as_str()
        .unwrap()
        .to_string();
    mock.0.lock().unwrap().push(("create".into(), body));
    if preset == "gemini-4-argon" {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error":{"code":"INVALID_MODEL_PRESET"}})),
        )
            .into_response()
    } else {
        (
            StatusCode::CREATED,
            Json(json!({"session":{"session_id":"pas1"}})),
        )
            .into_response()
    }
}
async fn fallback(MockState(mock): MockState<Mock>, Json(body): Json<Value>) -> Json<Value> {
    mock.0.lock().unwrap().push(("fallback".into(), body));
    Json(json!({}))
}
async fn instruction(MockState(mock): MockState<Mock>, Json(body): Json<Value>) -> Json<Value> {
    mock.0.lock().unwrap().push(("instruction".into(), body));
    Json(json!({}))
}
async fn intervene(MockState(mock): MockState<Mock>, Json(body): Json<Value>) -> Json<Value> {
    mock.0.lock().unwrap().push(("intervene".into(), body));
    Json(json!({}))
}
async fn events(MockState(mock): MockState<Mock>, headers: MockHeaders) -> Response {
    let cursor = headers
        .get("Last-Event-ID")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    mock.0
        .lock()
        .unwrap()
        .push(("events".into(), json!(cursor)));
    let body = if cursor == "1" {
        "event: user_message\r\nid: 2\r\ndata: {\"type\":\"user_message\",\"text\":\"안녕\",\"caller_info\":{\"source\":\"kaleidoscope\"}}\r\n\r\nevent: assistant_message\nid: 3\ndata: {\"content\":\"반가워\"}\n\n"
    } else {
        ""
    };
    ([(header::CONTENT_TYPE, "text/event-stream")], body).into_response()
}

#[tokio::test]
async fn creates_fallback_sets_instructions_sends_and_resumes_cursor() {
    let mock = Mock::default();
    let app = Router::new()
        .route("/api/persistent-sessions", post(make))
        .route(
            "/api/persistent-sessions/{id}",
            axum::routing::put(fallback),
        )
        .route(
            "/api/persistent-sessions/{id}/instructions",
            post(instruction),
        )
        .route("/api/sessions/{id}/intervene", post(intervene))
        .route("/api/sessions/{id}/events", get(events))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut state = AppState::in_memory("secret");
    state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        Some("folder".into()),
    );
    let req = || AgentCreateRequest {
        workspace_name: "작업".into(),
        model_preset: "gemini-4-argon".into(),
    };
    let info = create(&state, "w", "d", req()).await.unwrap();
    assert_eq!(info.model_preset, "claude-opus");
    assert!(info.busy);
    assert_eq!(create(&state, "w", "d", req()).await.unwrap(), info);
    let response = send_message(
        State(state.clone()),
        Path("w".into()),
        Ok(Json(AgentSendRequest {
            text: "  안녕  ".into(),
        })),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let empty = send_message(
        State(state.clone()),
        Path("w".into()),
        Ok(Json(AgentSendRequest { text: "  ".into() })),
    )
    .await;
    assert_eq!(empty.status(), StatusCode::BAD_REQUEST);
    let missing = send_message(
        State(state.clone()),
        Path("missing".into()),
        Ok(Json(AgentSendRequest { text: "a".into() })),
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    tokio::time::timeout(Duration::from_secs(6), async {
        loop {
            if mock
                .0
                .lock()
                .unwrap()
                .iter()
                .any(|(name, value)| name == "events" && value == "3")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    let calls = mock.0.lock().unwrap();
    assert_eq!(calls.iter().filter(|(name, _)| name == "create").count(), 2);
    let first = &calls.iter().find(|(name, _)| name == "create").unwrap().1;
    assert_eq!(first["folder_id"], "folder");
    let fallback = &calls.iter().find(|(name, _)| name == "fallback").unwrap().1;
    assert_eq!(
        fallback["settings"]["fallback_models"][0]["model_preset"],
        "gemini-4-argon"
    );
    assert_eq!(
        fallback["settings"]["fallback_models"][1]["model_preset"],
        "codex-6.1-sol"
    );
    assert!(calls.iter().any(|(name, value)| name == "instruction"
        && value["text"].as_str().unwrap().contains("workspace_id: w")));
    assert!(calls.iter().any(|(name, value)| name == "intervene"
        && value["text"] == "안녕"
        && value["caller_info"]["source"] == "kaleidoscope"));
    assert!(calls
        .iter()
        .any(|(name, value)| name == "events" && value == "1"));
    drop(calls);
    let history = state.history("w").unwrap();
    assert_eq!(
        history.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(),
        vec![
            "Argon 모델을 지금 쓸 수 없어 Opus 모델로 시작했습니다.",
            "안녕",
            "반가워"
        ]
    );
    assert_eq!(state.agent_row("w").unwrap().unwrap().cursor, 3);
    task.abort();
}

#[tokio::test]
async fn creation_finishes_and_broadcasts_after_client_disconnects() {
    #[derive(Clone)]
    struct Gate {
        started: Arc<tokio::sync::Notify>,
        release: Arc<tokio::sync::Notify>,
    }
    async fn delayed_create(MockState(gate): MockState<Gate>, Json(_): Json<Value>) -> Response {
        gate.started.notify_one();
        gate.release.notified().await;
        (
            StatusCode::CREATED,
            Json(json!({"session":{"session_id":"delayed-pas"}})),
        )
            .into_response()
    }
    let gate = Gate {
        started: Arc::new(tokio::sync::Notify::new()),
        release: Arc::new(tokio::sync::Notify::new()),
    };
    let app = Router::new()
        .route("/api/persistent-sessions", post(delayed_create))
        .route(
            "/api/persistent-sessions/{id}",
            axum::routing::put(|| async { Json(json!({})) }),
        )
        .route(
            "/api/persistent-sessions/{id}/instructions",
            post(|| async { Json(json!({})) }),
        )
        .route("/api/sessions/{id}/events", get(|| async { "" }))
        .with_state(gate.clone());
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
    let mut events = state.0.events.subscribe();
    let handler_state = state.clone();
    let handler = tokio::spawn(async move {
        create_agent(
            State(handler_state),
            Path("w".into()),
            Extension(("d".into(), "pc".into())),
            Ok(Json(AgentCreateRequest {
                workspace_name: "작업".into(),
                model_preset: "codex-6.1-sol".into(),
            })),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), gate.started.notified())
        .await
        .unwrap();
    handler.abort();
    assert!(handler.await.unwrap_err().is_cancelled());
    gate.release.notify_one();
    let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(
        matches!(event, DeviceEvent::AgentUpdate {workspace_id,update:AgentUpdate::Created {..}} if workspace_id == "w")
    );
    assert_eq!(
        state.agent_row("w").unwrap().unwrap().session_id,
        "delayed-pas"
    );
    server.abort();
}
