use super::*;
use axum::body::Body;
use kaleidoscope_contract::registry::WALLPAPER_REGISTRY_VERSION;
use kaleidoscope_contract::store::StoreOrigin;
use kaleidoscope_contract::{
    errors, StoreUpdateRequest, StoreUpdateResponse, StoreUpdateResult, StoreUpdateStatus,
    UpdateAppFromStoreArgs, STORE_UPDATE_REGISTRY_VERSION,
};
use tower::ServiceExt;

const STORE: &str = "https://store.example.org/apps";
const APP: &str = "alpha";

fn setup() -> (AppState, String, String) {
    let state = AppState::in_memory("secret");
    let token = "device-token".to_string();
    let other = "other-token".to_string();
    {
        let db = state.lock_db().unwrap();
        db.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('pc','PC',(SELECT account_id FROM mcp_principal WHERE id=1),?1,'now'),('other','Other',(SELECT account_id FROM mcp_principal WHERE id=1),?2,'now')", params![sha256_hex(token.as_bytes()), sha256_hex(other.as_bytes())]).unwrap();
        db.execute("INSERT INTO workspaces(id,account_id,data,created_at) VALUES('w',(SELECT account_id FROM mcp_principal WHERE id=1),'{\"id\":\"w\",\"name\":\"작업\",\"created_at\":\"now\",\"updated_at\":\"now\"}','now')", []).unwrap();
    }
    (state, token, other)
}

fn principal() -> McpPrincipal {
    McpPrincipal {
        device_id: Some("pc".into()),
        workspace_id: Some("w".into()),
    }
}

fn args(app: &str) -> UpdateAppFromStoreArgs {
    UpdateAppFromStoreArgs {
        app_id: app.into(),
        store_url: Some(STORE.into()),
        replace: None,
        device_id: None,
        workspace_id: None,
    }
}

fn origin(app: &str) -> StoreOrigin {
    StoreOrigin {
        store_url: STORE.into(),
        store_app_id: app.into(),
        release: 3,
        digest: "digest-3".into(),
    }
}

fn reply(request_id: &str, result: StoreUpdateResult) -> String {
    serde_json::to_string(&StoreUpdateResponse {
        request_id: request_id.into(),
        result,
    })
    .unwrap()
}

async fn next_request(
    rx: &mut broadcast::Receiver<Broadcast>,
    state: &AppState,
    target: &str,
) -> StoreUpdateRequest {
    let event = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(state.event_for_broadcast("foreign-target", event.clone()).is_none());
    match state.event_for_broadcast(target, event).unwrap() {
        DeviceEvent::StoreUpdateRequested { request } => request,
        other => panic!("예상하지 못한 이벤트: {other:?}"),
    }
}

async fn post(state: &AppState, token: &str, id: &str, body: String) -> StatusCode {
    crate::router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/device/store-updates/{id}"))
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
async fn mcp_store_update_roundtrips_installed_unchanged_consent_and_error() {
    let (state, token, _) = setup();
    let _stream = state
        .stream_with_registry("pc".into(), None, STORE_UPDATE_REGISTRY_VERSION)
        .unwrap();
    let mut events = state.0.events.subscribe();
    // 기기 id가 없는 MCP 연결은 활성 기기 한 대를 고른다.
    let task = tokio::spawn({
        let state = state.clone();
        async move {
            state
                .update_app_from_store(McpPrincipal::default(), args(APP))
                .await
        }
    });
    let request = next_request(&mut events, &state, "pc").await;
    assert_eq!(request.app_id, APP);
    assert_eq!(request.store_url.as_deref(), Some(STORE));
    assert!(!request.replace);
    let expires = chrono::DateTime::parse_from_rfc3339(&request.expires_at).unwrap();
    assert!((58..=60).contains(&(expires.timestamp() - Utc::now().timestamp())));
    assert_eq!(
        post(
            &state,
            &token,
            &request.request_id,
            reply(
                &request.request_id,
                StoreUpdateResult::Installed {
                    origin: origin(APP),
                    version: 4,
                }
            )
        )
        .await,
        StatusCode::OK
    );
    let output = task.await.unwrap().unwrap();
    assert_eq!(output.request_id, request.request_id);
    assert_eq!(output.device_id, "pc");
    assert_eq!(output.app_id, APP);
    assert_eq!(output.status, StoreUpdateStatus::Installed);
    assert_eq!(output.origin, Some(origin(APP)));
    assert_eq!(output.version, Some(4));
    assert_eq!(output.consent_request_id, None);
    assert_eq!(state.store_update_pending_count(), 0);

    let task = tokio::spawn({
        let state = state.clone();
        async move { state.update_app_from_store(principal(), args(APP)).await }
    });
    let request = next_request(&mut events, &state, "pc").await;
    assert_eq!(
        post(
            &state,
            &token,
            &request.request_id,
            reply(
                &request.request_id,
                StoreUpdateResult::Unchanged {
                    origin: origin(APP),
                    version: 4,
                }
            )
        )
        .await,
        StatusCode::OK
    );
    let output = task.await.unwrap().unwrap();
    assert_eq!(output.status, StoreUpdateStatus::Unchanged);
    assert_eq!(output.version, Some(4));

    let task = tokio::spawn({
        let state = state.clone();
        async move { state.update_app_from_store(principal(), args(APP)).await }
    });
    let request = next_request(&mut events, &state, "pc").await;
    assert_eq!(
        post(
            &state,
            &token,
            &request.request_id,
            reply(
                &request.request_id,
                StoreUpdateResult::ConsentRequired {
                    consent_request_id: "consent-1".into(),
                }
            )
        )
        .await,
        StatusCode::OK
    );
    let output = task.await.unwrap().unwrap();
    assert_eq!(output.status, StoreUpdateStatus::ConsentRequired);
    assert_eq!(output.consent_request_id.as_deref(), Some("consent-1"));
    assert_eq!(output.origin, None);
    assert_eq!(output.version, None);
    assert_eq!(state.store_update_pending_count(), 0);

    let task = tokio::spawn({
        let state = state.clone();
        async move { state.update_app_from_store(principal(), args(APP)).await }
    });
    let request = next_request(&mut events, &state, "pc").await;
    let expected = errors::STORECLIENT_FETCH_NOT_FOUND(APP);
    assert_eq!(
        post(
            &state,
            &token,
            &request.request_id,
            reply(
                &request.request_id,
                StoreUpdateResult::Error {
                    error: expected.clone(),
                }
            )
        )
        .await,
        StatusCode::OK
    );
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(error.id, expected.id);
    assert_eq!(error.message, expected.message);
    assert_eq!(state.store_update_pending_count(), 0);
}

#[tokio::test]
async fn missing_offline_legacy_and_foreign_devices_are_rejected_without_waiting() {
    let (state, _token, _) = setup();
    assert!(STORE_UPDATE_REGISTRY_VERSION > WALLPAPER_REGISTRY_VERSION);

    let error = state
        .update_app_from_store(McpPrincipal::default(), args(APP))
        .await
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("MCP_STORE_UPDATE_DEVICE_REQUIRED")
    );

    let error = state
        .update_app_from_store(principal(), args(APP))
        .await
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("MCP_STORE_UPDATE_DEVICE_OFFLINE")
    );
    assert!(error.message.contains("'PC' 기기"));
    assert!(!error.message.contains("pc"));
    assert!(error.details.iter().any(|detail| detail == "device_id: pc"));

    let legacy = state
        .stream_with_registry("pc".into(), None, STORE_UPDATE_REGISTRY_VERSION - 1)
        .unwrap();
    let mut events = state.0.events.subscribe();
    let error = state
        .update_app_from_store(principal(), args(APP))
        .await
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("MCP_STORE_UPDATE_DEVICE_VERSION_UNSUPPORTED")
    );
    assert!(error.message.contains("'PC' 기기"));
    assert!(tokio::time::timeout(Duration::from_millis(200), events.recv())
        .await
        .is_err());
    drop(legacy);

    // 기기는 연결돼 있어도 이 연결의 기기가 아니거나 계정 밖이면 즉시 거부한다.
    let stream = state
        .stream_with_registry("pc".into(), None, STORE_UPDATE_REGISTRY_VERSION)
        .unwrap();
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES('foreign','다른 계정','now')",
            [],
        )
        .unwrap();
        db.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('foreign-pc','Foreign','foreign','foreign-token','now')", []).unwrap();
    }
    for device_id in ["other", "foreign-pc", "없는 기기"] {
        let mut explicit = args(APP);
        explicit.device_id = Some(device_id.into());
        let error = state
            .update_app_from_store(principal(), explicit)
            .await
            .unwrap_err();
        assert_eq!(
            error.id.as_deref(),
            Some("MCP_STORE_UPDATE_DEVICE_FORBIDDEN"),
            "device_id={device_id}"
        );
    }
    let mut outside = args(APP);
    outside.workspace_id = Some("다른 작업".into());
    let error = state
        .update_app_from_store(principal(), outside)
        .await
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("MCP_STORE_UPDATE_DEVICE_FORBIDDEN")
    );
    assert_eq!(state.store_update_pending_count(), 0);
    assert!(tokio::time::timeout(Duration::from_millis(200), events.recv())
        .await
        .is_err());
    drop(stream);
}

#[tokio::test]
async fn only_the_supported_target_stream_receives_the_update_request() {
    let (state, token, _) = setup();
    let mut supported = Box::pin(
        state
            .stream_with_registry("pc".into(), None, STORE_UPDATE_REGISTRY_VERSION)
            .unwrap(),
    );
    let mut legacy = Box::pin(
        state
            .stream_with_registry("pc".into(), None, STORE_UPDATE_REGISTRY_VERSION - 1)
            .unwrap(),
    );
    let mut other = Box::pin(
        state
            .stream_with_registry("other".into(), None, STORE_UPDATE_REGISTRY_VERSION)
            .unwrap(),
    );
    let mut events = state.0.events.subscribe();
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.update_app_from_store(principal(), args(APP)).await }
    });
    let req = next_request(&mut events, &state, "pc").await;
    let received = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let event = supported.next().await.unwrap().unwrap();
            if format!("{event:?}").contains("store.update_requested") {
                break;
            }
        }
    })
    .await;
    assert!(received.is_ok());
    for stream in [&mut legacy, &mut other] {
        let received = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                let event = stream.next().await.unwrap().unwrap();
                if format!("{event:?}").contains("store.update_requested") {
                    break;
                }
            }
        })
        .await;
        assert!(received.is_err());
    }
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            reply(
                &req.request_id,
                StoreUpdateResult::Installed {
                    origin: origin(APP),
                    version: 4,
                }
            )
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(
        task.await.unwrap().unwrap().status,
        StoreUpdateStatus::Installed
    );
}

#[tokio::test]
async fn wrong_device_and_second_replies_are_rejected() {
    let (state, token, other) = setup();
    let _stream = state
        .stream_with_registry("pc".into(), None, STORE_UPDATE_REGISTRY_VERSION)
        .unwrap();
    let mut events = state.0.events.subscribe();

    {
        let task = tokio::spawn({
            let state = state.clone();
            async move { state.update_app_from_store(principal(), args(APP)).await }
        });
        let request = next_request(&mut events, &state, "pc").await;
        // 다른 기기의 응답과 다른 request_id의 응답은 대기를 그대로 둔다.
        assert_eq!(
            post(
                &state,
                &other,
                &request.request_id,
                reply(
                    &request.request_id,
                    StoreUpdateResult::Installed {
                        origin: origin(APP),
                        version: 4,
                    }
                )
            )
            .await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            post(
                &state,
                &token,
                &request.request_id,
                reply(
                    "다른 요청",
                    StoreUpdateResult::Installed {
                        origin: origin(APP),
                        version: 4,
                    }
                )
            )
            .await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(state.store_update_pending_count(), 1);
        assert_eq!(
            post(
                &state,
                &token,
                &request.request_id,
                reply(
                    &request.request_id,
                    StoreUpdateResult::Installed {
                        origin: origin(APP),
                        version: 4,
                    }
                )
            )
            .await,
            StatusCode::OK
        );
        assert_eq!(
            task.await.unwrap().unwrap().status,
            StoreUpdateStatus::Installed
        );
        assert_eq!(state.store_update_pending_count(), 0);
        // 같은 request_id의 두 번째 응답은 받지 않는다.
        assert_eq!(
            post(
                &state,
                &token,
                &request.request_id,
                reply(
                    &request.request_id,
                    StoreUpdateResult::Installed {
                        origin: origin(APP),
                        version: 5,
                    }
                )
            )
            .await,
            StatusCode::GONE
        );
    }

    // 읽을 수 없는 본문은 대기를 닫고 오류로 만든다.
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.update_app_from_store(principal(), args(APP)).await }
    });
    let request = next_request(&mut events, &state, "pc").await;
    assert_eq!(
        post(&state, &token, &request.request_id, "{".into()).await,
        StatusCode::BAD_REQUEST
    );
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("MCP_STORE_UPDATE_REPLY_INVALID")
    );
    assert_eq!(state.store_update_pending_count(), 0);
    assert_eq!(
        post(
            &state,
            &token,
            &request.request_id,
            reply(
                &request.request_id,
                StoreUpdateResult::Installed {
                    origin: origin(APP),
                    version: 4,
                }
            )
        )
        .await,
        StatusCode::GONE
    );

    // 1MiB를 넘는 본문은 받지 않고 대기를 닫는다.
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.update_app_from_store(principal(), args(APP)).await }
    });
    let request = next_request(&mut events, &state, "pc").await;
    assert_eq!(
        post(&state, &token, &request.request_id, "x".repeat(1024 * 1024 + 1)).await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        task.await.unwrap().unwrap_err().id.as_deref(),
        Some("MCP_STORE_UPDATE_REPLY_INVALID")
    );
    assert_eq!(state.store_update_pending_count(), 0);
}

#[tokio::test(start_paused = true)]
async fn timeout_leaves_no_pending_request_and_late_reply_is_rejected() {
    let (state, token, _) = setup();
    let _stream = state
        .stream_with_registry("pc".into(), None, STORE_UPDATE_REGISTRY_VERSION)
        .unwrap();
    let mut events = state.0.events.subscribe();
    let error = state
        .update_app_from_store(principal(), args(APP))
        .await
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("MCP_STORE_UPDATE_TIMEOUT")
    );
    assert!(error.message.contains("'PC' 기기"));
    assert_eq!(state.store_update_pending_count(), 0);
    let request = next_request(&mut events, &state, "pc").await;
    assert_eq!(
        post(
            &state,
            &token,
            &request.request_id,
            reply(
                &request.request_id,
                StoreUpdateResult::Installed {
                    origin: origin(APP),
                    version: 4,
                }
            )
        )
        .await,
        StatusCode::GONE
    );
}

#[tokio::test]
async fn disconnecting_the_device_fails_the_pending_request() {
    let (state, token, _) = setup();
    let stream = state
        .stream_with_registry("pc".into(), None, STORE_UPDATE_REGISTRY_VERSION)
        .unwrap();
    let mut events = state.0.events.subscribe();
    let task = tokio::spawn({
        let state = state.clone();
        async move { state.update_app_from_store(principal(), args(APP)).await }
    });
    let request = next_request(&mut events, &state, "pc").await;
    drop(stream);
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("MCP_STORE_UPDATE_DEVICE_OFFLINE")
    );
    assert_eq!(state.store_update_pending_count(), 0);
    assert_eq!(
        post(
            &state,
            &token,
            &request.request_id,
            reply(
                &request.request_id,
                StoreUpdateResult::Installed {
                    origin: origin(APP),
                    version: 4,
                }
            )
        )
        .await,
        StatusCode::GONE
    );
}
