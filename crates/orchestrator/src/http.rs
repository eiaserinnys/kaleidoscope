use super::mcp::McpServer;
use super::*;
use axum::extract::DefaultBodyLimit;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub fn router(state: AppState) -> Router {
    use rmcp::transport::{
        streamable_http_server::{session::local::LocalSessionManager, StreamableHttpService},
        StreamableHttpServerConfig,
    };
    let mcp_state = state.clone();
    let service = StreamableHttpService::new(
        move || Ok(McpServer::new(mcp_state.clone())),
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default().with_json_response(true),
    );
    let mcp = Router::new()
        .route_service("/mcp", service)
        .route_layer(middleware::from_fn_with_state(state.clone(), mcp_auth));
    let device = Router::new()
        .route("/apps", post(device_upload))
        .route("/events", get(device_events))
        .route("/layout", axum::routing::put(super::layouts::put_layout))
        .route(
            "/layout/changes",
            post(super::layouts::post_layout_changes).layer(DefaultBodyLimit::max(
                registry::LAYOUT_CHANGES_BODY_MAX_BYTES,
            )),
        )
        .route(
            "/connections/{name}/request",
            post(super::connection_relay::device_request).layer(DefaultBodyLimit::max(
                super::connection_relay::connection_request_body_limit(),
            )),
        )
        .route(
            "/workspaces/{workspace_id}/agent",
            get(super::agent::get_agent).post(super::agent::create_agent),
        )
        .route(
            "/workspaces/{workspace_id}/agent/messages",
            post(super::agent::send_message)
                .layer(DefaultBodyLimit::max(registry::AGENT_SEND_BODY_MAX_BYTES)),
        )
        .route(
            "/workspaces/{workspace_id}/agent/items/{item_id}/attachments/{index}",
            get(super::agent::get_attachment),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), device_auth))
        .with_state(state.clone());
    let api = Router::new()
        .route(registry::PAIR_START_PATH, post(pair_start))
        .route(registry::PAIR_POLL_PATH, post(pair_poll))
        .route(registry::HEALTH_PATH, get(health))
        .nest("/api/device", device)
        .with_state(state);
    mcp.merge(api)
}

async fn mcp_auth(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if bearer(request.headers())
        .is_some_and(|provided| constant_time_eq(provided.as_bytes(), state.0.mcp_token.as_bytes()))
    {
        next.run(request).await
    } else {
        error_response(
            StatusCode::UNAUTHORIZED,
            server_error("MCP 인증이 필요합니다."),
        )
    }
}

async fn device_auth(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    if let Some(device) = bearer(request.headers())
        .and_then(|provided| state.authenticate_device(provided).ok().flatten())
    {
        request.extensions_mut().insert(device);
        next.run(request).await
    } else {
        error_response(StatusCode::UNAUTHORIZED, device_auth_error())
    }
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let ha = Sha256::digest(a);
    let hb = Sha256::digest(b);
    bool::from(ha.ct_eq(&hb))
}
pub(super) fn error_response(status: StatusCode, error: CoreError) -> Response {
    (status, Json(error)).into_response()
}

async fn pair_start(
    State(state): State<AppState>,
    Json(request): Json<PairStartRequest>,
) -> Response {
    match state.start_pairing(request.device_name).await {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err((status, error)) => error_response(status, error),
    }
}
async fn pair_poll(
    State(state): State<AppState>,
    Json(request): Json<PairPollRequest>,
) -> Response {
    match state.poll_pairing(&request.device_code).await {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err((status, error)) => error_response(status, error),
    }
}
async fn health() -> Json<Value> {
    Json(json!({"ok":true}))
}

async fn device_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<DeviceUploadRequest>,
) -> Response {
    let Some(token) = bearer(&headers) else {
        return error_response(StatusCode::UNAUTHORIZED, device_auth_error());
    };
    let device = match state.authenticate_device(token) {
        Ok(Some(v)) => v,
        Ok(None) | Err(_) => return error_response(StatusCode::UNAUTHORIZED, device_auth_error()),
    };
    match state.publish_app(
        &request.definition_json,
        &format!("device:{}", device.0),
        false,
        None,
    ) {
        Ok((registry_app, _)) => (StatusCode::OK, Json(registry_app)).into_response(),
        Err(error) => error_response(StatusCode::BAD_REQUEST, error),
    }
}
async fn device_events(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(token) = bearer(&headers) else {
        return error_response(StatusCode::UNAUTHORIZED, device_auth_error());
    };
    let device = match state.authenticate_device(token) {
        Ok(Some(v)) => v,
        Ok(None) | Err(_) => return error_response(StatusCode::UNAUTHORIZED, device_auth_error()),
    };
    let supported = headers
        .get(registry::SUPPORTED_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| serde_json::from_str::<Supported>(value).ok());
    let registry_version = headers
        .get(registry::REGISTRY_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);
    match state.stream_with_registry(device.0, supported, registry_version) {
        Ok(stream) => (StatusCode::OK, Sse::new(stream)).into_response(),
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}
fn device_auth_error() -> CoreError {
    server_error("기기 연결이 거부되었습니다. 쉘에서 다시 연결하세요.")
}
