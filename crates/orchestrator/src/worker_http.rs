//! 기기에서 워커 동작을 호출하는 HTTP 경로.
use super::*;
use axum::extract::{Extension, Path, State};
use kaleidoscope_contract::worker::WorkerInvokeRequest;

pub(super) async fn device_invoke(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(app): Path<String>,
    Json(request): Json<WorkerInvokeRequest>,
) -> Response {
    let result = match state.device_account_id(&device.0) {
        Ok(account) => state.invoke_worker(&account, &app, request).await,
        Err(error) => Err(error),
    };
    match result {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err(error) => {
            let status = match error.code {
                ErrorCode::NotFound => StatusCode::NOT_FOUND,
                ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            super::http::error_response(status, error)
        }
    }
}
