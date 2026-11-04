use super::*;
use axum::body::Body;
use kaleidoscope_contract::registry::ShareUpload;
use kaleidoscope_contract::{
    ActWindowArgs, Direction, ReadWindowArgs, TextMode, WindowAction, WindowControlRequest,
    WindowControlResponse, WindowControlResult, WindowControlSuccess, WindowObservation,
};
use tower::ServiceExt;

#[path = "window_control_stream_tests.rs"]
mod stream_tests;

fn setup() -> (AppState, String, String) {
    let state = AppState::in_memory("secret");
    let token = "device-token".to_string();
    let other = "other-token".to_string();
    {
        let db = state.lock_db().unwrap();
        db.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('pc','PC',(SELECT account_id FROM mcp_principal WHERE id=1),?1,'now'),('other','Other',(SELECT account_id FROM mcp_principal WHERE id=1),?2,'now')", params![sha256_hex(token.as_bytes()), sha256_hex(other.as_bytes())]).unwrap();
        db.execute("INSERT INTO workspaces(id,account_id,data,created_at) VALUES('w',(SELECT account_id FROM mcp_principal WHERE id=1),'{\"id\":\"w\",\"name\":\"작업\",\"created_at\":\"now\",\"updated_at\":\"now\"}','now')", []).unwrap();
    }
    state
        .put_shared_view(
            "pc",
            "PC",
            "window",
            ShareUpload {
                workspace_id: "w".into(),
                app_name: "편집기".into(),
                text: "기존 글".into(),
                visual: false,
            },
        )
        .unwrap();
    (state, token, other)
}

fn principal() -> McpPrincipal {
    McpPrincipal {
        device_id: Some("pc".into()),
        workspace_id: Some("w".into()),
    }
}
fn read() -> ReadWindowArgs {
    ReadWindowArgs {
        window_id: "window".into(),
        image: None,
    }
}
fn act(view: &str, action: WindowAction) -> ActWindowArgs {
    ActWindowArgs {
        window_id: "window".into(),
        view_id: view.into(),
        action,
        image: None,
    }
}
fn click() -> WindowAction {
    WindowAction::Click { target: 1 }
}
fn observation(view: &str, text: &str) -> WindowObservation {
    WindowObservation {
        view_id: view.into(),
        app_name: "편집기".into(),
        window_title: "제목".into(),
        text: text.into(),
        settled: true,
        geometry: None,
        image_base64: None,
    }
}
fn response(
    request: &WindowControlRequest,
    view: &str,
    before: Option<&str>,
    after: &str,
) -> WindowControlResponse {
    WindowControlResponse {
        request_id: request.request_id.clone(),
        window_id: request.window_id.clone(),
        result: WindowControlResult::Ok {
            value: WindowControlSuccess {
                before_text: before.map(str::to_string),
                after: observation(view, after),
            },
        },
    }
}
async fn next_request(
    rx: &mut broadcast::Receiver<Broadcast>,
    state: &AppState,
    target: &str,
) -> WindowControlRequest {
    let event = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(state.event_for_broadcast("other", event.clone()).is_none());
    match state.event_for_broadcast(target, event).unwrap() {
        DeviceEvent::WindowControl { request } => request,
        _ => panic!("예상하지 못한 이벤트"),
    }
}
async fn post(state: &AppState, token: &str, id: &str, body: String) -> StatusCode {
    crate::router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/device/window-control/{id}"))
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn read_act_busy_reply_owner_and_view_lifetime() {
    let (state, token, other) = setup();
    let stream = state.stream_with_registry("pc".into(), None, 12).unwrap();
    let mut events = state.0.events.subscribe();
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.read_window(principal(), read()).await }
    });
    let req = next_request(&mut events, &state, "pc").await;
    let expires = chrono::DateTime::parse_from_rfc3339(&req.expires_at).unwrap();
    assert!((8..=10).contains(&(expires.timestamp() - Utc::now().timestamp())));
    let busy = state.read_window(principal(), read()).await.unwrap_err();
    assert_eq!(busy.error.id.as_deref(), Some("MCP_WINDOW_CONTROL_BUSY"));
    let reply = response(&req, "v1", None, "하나\n둘\n셋\n넷\n다섯\n여섯\n일곱\n");
    assert_eq!(
        post(
            &state,
            &other,
            &req.request_id,
            serde_json::to_string(&reply).unwrap()
        )
        .await,
        StatusCode::FORBIDDEN
    );
    let mut wrong_window = reply.clone();
    wrong_window.window_id = "다른 창".into();
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            serde_json::to_string(&wrong_window).unwrap()
        )
        .await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            serde_json::to_string(&reply).unwrap()
        )
        .await,
        StatusCode::OK
    );
    let out = task.await.unwrap().unwrap();
    assert_eq!(
        out.output.mode,
        kaleidoscope_contract::WindowControlMode::Full
    );
    assert_eq!(out.output.view_id, "v1");
    assert!(out.output.settled);
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            serde_json::to_string(&reply).unwrap()
        )
        .await,
        StatusCode::GONE
    );
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.act_window(principal(), act("v1", click())).await }
    });
    let req = next_request(&mut events, &state, "pc").await;
    let before = "하나\n둘\n셋\n넷\n다섯\n여섯\n일곱\n";
    let after = "하나\n둘\n셋\n변경\n다섯\n여섯\n일곱\n";
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            serde_json::to_string(&response(&req, "v2", Some(before), after)).unwrap()
        )
        .await,
        StatusCode::OK
    );
    let out = task.await.unwrap().unwrap();
    assert_eq!(
        out.output.mode,
        kaleidoscope_contract::WindowControlMode::Diff
    );
    assert!(out.output.text.contains("변경"));
    assert_eq!(
        state
            .act_window(principal(), act("v1", click()))
            .await
            .unwrap_err()
            .error
            .id
            .as_deref(),
        Some("MCP_WINDOW_CONTROL_VIEW_UNKNOWN")
    );
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.act_window(principal(), act("v2", click())).await }
    });
    let req = next_request(&mut events, &state, "pc").await;
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            serde_json::to_string(&response(&req, "v3", Some(after), after)).unwrap()
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(
        task.await.unwrap().unwrap().output.mode,
        kaleidoscope_contract::WindowControlMode::Unchanged
    );
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.act_window(principal(), act("v3", click())).await }
    });
    let req = next_request(&mut events, &state, "pc").await;
    let error = kaleidoscope_contract::errors::SHELL_WINDOW_CONTROL_TARGET_DISABLED(1);
    let reply = WindowControlResponse {
        request_id: req.request_id.clone(),
        window_id: req.window_id.clone(),
        result: WindowControlResult::Error {
            error: error.clone(),
            applied: true,
        },
    };
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            serde_json::to_string(&reply).unwrap()
        )
        .await,
        StatusCode::OK
    );
    let result = task.await.unwrap().unwrap_err();
    assert_eq!(result.error.id, error.id);
    assert_eq!(result.applied, Some(true));
    state.delete_shared_view("pc", "window");
    assert_eq!(
        state
            .act_window(principal(), act("v3", click()))
            .await
            .unwrap_err()
            .error
            .id
            .as_deref(),
        Some("MCP_WINDOW_CONTROL_VIEW_UNKNOWN")
    );
    drop(stream);
}

#[tokio::test]
async fn account_scope_and_timeout_leave_no_pending_request() {
    let (state, token, _) = setup();
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES('foreign','다른 계정','now')",
            [],
        )
        .unwrap();
        db.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('foreign-pc','Foreign','foreign','foreign-token','now')", []).unwrap();
        db.execute("INSERT INTO workspaces(id,account_id,data,created_at) VALUES('foreign-w','foreign','{\"id\":\"foreign-w\",\"name\":\"다른 작업\",\"created_at\":\"now\",\"updated_at\":\"now\"}','now')", []).unwrap();
    }
    state
        .put_shared_view(
            "foreign-pc",
            "Foreign",
            "foreign-window",
            ShareUpload {
                workspace_id: "foreign-w".into(),
                app_name: "다른 앱".into(),
                text: "비공개".into(),
                visual: false,
            },
        )
        .unwrap();
    let global = McpPrincipal::default();
    for id in ["없는 창", "foreign-window"] {
        let error = state
            .read_window(
                global.clone(),
                ReadWindowArgs {
                    window_id: id.into(),
                    image: None,
                },
            )
            .await
            .unwrap_err();
        assert_eq!(
            error.error.id.as_deref(),
            Some("MCP_WINDOW_CONTROL_TARGET_UNAVAILABLE")
        );
    }
    let stream = state.stream_with_registry("pc".into(), None, 12).unwrap();
    let mut events = state.0.events.subscribe();
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.read_window(global, read()).await }
    });
    let req = next_request(&mut events, &state, "pc").await;
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(
        error.error.id.as_deref(),
        Some("MCP_WINDOW_CONTROL_TIMEOUT")
    );
    assert!(error.applied.is_none());
    assert_eq!(state.control_pending_count(), 0);
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            serde_json::to_string(&response(&req, "late", None, "늦음")).unwrap()
        )
        .await,
        StatusCode::GONE
    );
    drop(stream);
}

#[tokio::test]
async fn version_input_offline_and_invalid_replies() {
    let (state, token, _) = setup();
    let legacy = state.stream_with_registry("pc".into(), None, 11).unwrap();
    assert_eq!(
        state
            .read_window(principal(), read())
            .await
            .unwrap_err()
            .error
            .id
            .as_deref(),
        Some("MCP_WINDOW_CONTROL_DEVICE_VERSION_UNSUPPORTED")
    );
    drop(legacy);
    state
        .put_shared_view(
            "pc",
            "PC",
            "window",
            ShareUpload {
                workspace_id: "w".into(),
                app_name: "편집기".into(),
                text: "기존 글".into(),
                visual: false,
            },
        )
        .unwrap();
    for (action, code) in [
        (
            WindowAction::Type {
                target: 1,
                text: "가".repeat(5462),
                mode: TextMode::Append,
            },
            "MCP_WINDOW_CONTROL_TYPE_TEXT_TOO_LARGE",
        ),
        (
            WindowAction::Scroll {
                target: None,
                direction: Direction::Down,
                amount: 0,
            },
            "MCP_WINDOW_CONTROL_SCROLL_AMOUNT_OUT_OF_RANGE",
        ),
        (
            WindowAction::Scroll {
                target: None,
                direction: Direction::Down,
                amount: 10001,
            },
            "MCP_WINDOW_CONTROL_SCROLL_AMOUNT_OUT_OF_RANGE",
        ),
    ] {
        assert_eq!(
            state
                .act_window(principal(), act("v", action))
                .await
                .unwrap_err()
                .error
                .id
                .as_deref(),
            Some(code)
        );
    }
    let stream = state.stream_with_registry("pc".into(), None, 12).unwrap();
    let mut events = state.0.events.subscribe();
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.read_window(principal(), read()).await }
    });
    let req = next_request(&mut events, &state, "pc").await;
    assert_eq!(
        post(&state, &token, &req.request_id, "{".into()).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        task.await.unwrap().unwrap_err().error.id.as_deref(),
        Some("MCP_WINDOW_CONTROL_REPLY_BODY_INVALID")
    );
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.read_window(principal(), read()).await }
    });
    let req = next_request(&mut events, &state, "pc").await;
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            "x".repeat(15 * 1024 * 1024 + 1)
        )
        .await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        task.await.unwrap().unwrap_err().error.id.as_deref(),
        Some("MCP_WINDOW_CONTROL_REPLY_TOO_LARGE")
    );
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.read_window(principal(), read()).await }
    });
    let _req = next_request(&mut events, &state, "pc").await;
    drop(stream);
    let error = task.await.unwrap().unwrap_err().error;
    assert_eq!(
        error.id.as_deref(),
        Some("MCP_WINDOW_CONTROL_DEVICE_OFFLINE")
    );
    assert!(error.message.contains("PC 기기"));
    assert!(!error.message.contains("pc"));
    assert!(error.details.iter().any(|detail| detail == "device_id: pc"));
}
