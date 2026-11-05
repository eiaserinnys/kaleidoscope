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
        // /mcp는 모든 요청에 bearer를 요구하므로 DNS 리바인딩된 페이지가 인증된 요청을 만들 수 없다.
        // 원격 서버는 프록시의 공개 Host로 사용하며, 같은 라우터를 쓰는 내장 서버도 bearer가 필수다.
        // 따라서 루프백만 허용하는 rmcp 기본 Host 검사를 끈다.
        StreamableHttpServerConfig::default()
            .with_json_response(true)
            .disable_allowed_hosts(),
    );
    let mcp = Router::new()
        .route_service("/mcp", service)
        .layer(body_limit(48 * 1024 * 1024))
        .route_layer(middleware::from_fn_with_state(state.clone(), mcp_auth));
    let device = Router::new()
        .route(
            "/builtin-specs",
            post(super::builtin_specs::device_register).layer(body_limit(4 * 1024 * 1024)),
        )
        .route(
            "/transfer",
            get(super::transfer::export)
                .post(super::transfer::import)
                .layer(body_limit(
                    kaleidoscope_contract::transfer::TRANSFER_MAX_BYTES,
                )),
        )
        .route(
            "/apps",
            post(device_upload).layer(body_limit(2 * 1024 * 1024)),
        )
        .route(
            "/app-installs",
            post(super::registry_install::device_install).layer(body_limit(32 * 1024 * 1024)),
        )
        .route(
            "/apps/{app_id}",
            axum::routing::delete(super::app_delete::device_delete)
                .layer(body_limit(2 * 1024 * 1024)),
        )
        .route(
            "/apps/{app_id}/worker",
            post(super::worker_http::device_invoke).layer(body_limit(2 * 1024 * 1024)),
        )
        .route("/assets/{id}/{version}", get(super::assets::device_get))
        .route(
            "/app-values/{app_id}",
            get(super::app_values::list)
                .post(super::app_values::move_collection_http)
                .layer(body_limit(2 * 1024 * 1024)),
        )
        .route(
            "/app-values/{app_id}/{*key}",
            get(super::app_values::read)
                .put(super::app_values::write)
                .delete(super::app_values::reset)
                .layer(body_limit(
                    kaleidoscope_contract::app_storage::STORAGE_COMMAND_BODY_MAX_BYTES,
                )),
        )
        .route(
            "/app-storage/{app_id}/items",
            get(super::app_storage_http::device_list),
        )
        .route(
            "/app-storage/{app_id}/items/{entry_id}",
            get(super::app_storage_http::device_read)
                .put(super::app_storage_http::device_write)
                .delete(super::app_storage_http::device_reset)
                .layer(body_limit(
                    kaleidoscope_contract::app_storage::STORAGE_COMMAND_BODY_MAX_BYTES,
                )),
        )
        .route(
            "/app-storage/{app_id}/collections/{entry_id}",
            get(super::app_storage_http::device_collection_list),
        )
        .route(
            "/app-storage/{app_id}/collections/{entry_id}/document",
            get(super::app_storage_http::device_collection_read)
                .put(super::app_storage_http::device_collection_write)
                .delete(super::app_storage_http::device_collection_reset)
                .layer(body_limit(
                    kaleidoscope_contract::app_storage::STORAGE_COMMAND_BODY_MAX_BYTES,
                )),
        )
        .route(
            "/app-storage/{app_id}/collections/{entry_id}/move",
            post(super::app_storage_http::device_collection_move)
                .layer(body_limit(2 * 1024 * 1024)),
        )
        .route("/events", get(device_events))
        .route("/preferences", get(super::preferences::get_preferences))
        .route(
            "/preferences/default",
            post(super::preferences::set_default).layer(body_limit(2 * 1024 * 1024)),
        )
        .route(
            "/preferences/answer",
            post(super::preferences::answer).layer(body_limit(2 * 1024 * 1024)),
        )
        .route(
            "/window-control/{request_id}",
            post(super::window_control::device_reply).layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/layout",
            axum::routing::put(super::layouts::put_layout).layer(body_limit(2 * 1024 * 1024)),
        )
        .route(
            "/layout/changes",
            post(super::layouts::post_layout_changes)
                .layer(body_limit(registry::LAYOUT_CHANGES_BODY_MAX_BYTES)),
        )
        .route(
            "/shares/{window_id}",
            axum::routing::put(super::share::put_share)
                .delete(super::share::delete_share)
                .layer(body_limit(2 * 1024 * 1024)),
        )
        .route(
            "/connections/{name}/request",
            post(super::connection_relay::device_request).layer(body_limit(
                super::connection_relay::connection_request_body_limit(),
            )),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), device_auth))
        .with_state(state.clone());
    let api = Router::new()
        .route(
            "/api/webhooks/{app_id}",
            post(super::worker_webhook::webhook).layer(body_limit(256 * 1024)),
        )
        .route(
            "/api/webhooks/{app_id}/{token}",
            post(super::worker_webhook::webhook_token).layer(body_limit(256 * 1024)),
        )
        .route(
            registry::PAIR_START_PATH,
            post(pair_start).layer(body_limit(2 * 1024 * 1024)),
        )
        .route(
            registry::PAIR_POLL_PATH,
            post(pair_poll).layer(body_limit(2 * 1024 * 1024)),
        )
        .route(registry::HEALTH_PATH, get(health))
        .nest("/api/device", device)
        .with_state(state);
    mcp.merge(api)
}

async fn mcp_auth(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    let Some(provided) = bearer(request.headers()) else {
        return error_response(
            StatusCode::UNAUTHORIZED,
            kaleidoscope_contract::errors::SERVER_HTTP_MCP_AUTH_REJECTED(),
        );
    };
    let mut principal = if constant_time_eq(provided.as_bytes(), state.0.mcp_token.as_bytes()) {
        McpPrincipal::default()
    } else {
        let device_id = match state.authenticate_device(provided) {
            Ok(Some((id, _))) => id,
            Ok(None) => {
                return error_response(
                    StatusCode::UNAUTHORIZED,
                    kaleidoscope_contract::errors::SERVER_HTTP_MCP_AUTH_REJECTED(),
                );
            }
            Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        };
        let account = match state.device_account_id(&device_id) {
            Ok(account) => account,
            Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        };
        let principal_account = match state.mcp_account_id() {
            Ok(account) => account,
            Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        };
        if account != principal_account {
            return error_response(
                StatusCode::FORBIDDEN,
                kaleidoscope_contract::errors::SERVER_HTTP_MCP_ACCOUNT_FORBIDDEN(),
            );
        }
        McpPrincipal {
            device_id: Some(device_id),
            workspace_id: None,
        }
    };

    if let Some(value) = request.headers().get(registry::WORKSPACE_HEADER) {
        let Ok(workspace_id) = value.to_str() else {
            return error_response(
                StatusCode::FORBIDDEN,
                kaleidoscope_contract::errors::SERVER_HTTP_MCP_WORKSPACE_HEADER_INVALID(),
            );
        };
        match state.mcp_owns_workspace(workspace_id) {
            Ok(true) => principal.workspace_id = Some(workspace_id.to_string()),
            Ok(false) => {
                return error_response(
                    StatusCode::FORBIDDEN,
                    kaleidoscope_contract::errors::SERVER_HTTP_MCP_WORKSPACE_FORBIDDEN(),
                );
            }
            Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
        }
    }

    request.extensions_mut().insert(principal);
    next.run(request).await
}

async fn device_auth(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    if let Some(device) = bearer(request.headers())
        .and_then(|provided| state.authenticate_device(provided).ok().flatten())
    {
        let request_path = request
            .extensions()
            .get::<axum::extract::OriginalUri>()
            .map(|original| original.0.path())
            .unwrap_or_else(|| request.uri().path())
            .to_string();
        if let Some(workspace_id) = request_path
            .strip_prefix("/api/device/workspaces/")
            .or_else(|| request_path.strip_prefix("/workspaces/"))
            .and_then(|tail| tail.split('/').next())
            .filter(|id| !id.is_empty())
        {
            if !state
                .device_owns_workspace(&device.0, workspace_id)
                .unwrap_or(false)
            {
                return error_response(
                    StatusCode::NOT_FOUND,
                    kaleidoscope_contract::errors::SERVER_HTTP_DEVICE_WORKSPACE_NOT_FOUND(),
                );
            }
        }
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
    super::log_core_error(&error, &status.as_u16().to_string());
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
    kaleidoscope_contract::errors::SERVER_HTTP_DEVICE_AUTH_REJECTED()
}

type BodyLimitFuture = std::pin::Pin<Box<dyn std::future::Future<Output = Response> + Send>>;
type BodyLimitHandler = fn(State<usize>, Request, Next) -> BodyLimitFuture;

// 한도 설정과 사전 검사를 함께 붙여 경로마다 다른 거절 처리가 생기지 않게 한다.
fn body_limit(
    limit: usize,
) -> (
    DefaultBodyLimit,
    axum::middleware::FromFnLayer<BodyLimitHandler, usize, (State<usize>, Request)>,
) {
    (
        DefaultBodyLimit::max(limit),
        middleware::from_fn_with_state(limit, check_body_limit as BodyLimitHandler),
    )
}

fn check_body_limit(State(limit): State<usize>, request: Request, next: Next) -> BodyLimitFuture {
    Box::pin(async move {
        let (parts, body) = request.into_parts();
        match axum::body::to_bytes(body, limit).await {
            Ok(bytes) => {
                next.run(Request::from_parts(parts, axum::body::Body::from(bytes)))
                    .await
            }
            Err(error) => {
                use std::error::Error;
                if error
                    .source()
                    .is_some_and(|source| source.is::<http_body_util::LengthLimitError>())
                {
                    error_response(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        kaleidoscope_contract::errors::SERVER_HTTP_BODY_TOO_LARGE(
                            &kaleidoscope_contract::size::format_byte_limit(limit as u64),
                        ),
                    )
                } else {
                    // 크기와 무관한 읽기 실패는 기존 추출기의 경로별 오류 처리로 넘긴다.
                    let stream =
                        futures::stream::once(async move { Err::<axum::body::Bytes, _>(error) });
                    next.run(Request::from_parts(
                        parts,
                        axum::body::Body::from_stream(stream),
                    ))
                    .await
                }
            }
        }
    })
}
