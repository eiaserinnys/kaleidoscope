use super::*;
use axum::{
    extract::{Extension, Path, Query},
    response::IntoResponse,
};
use kaleidoscope_contract::app_comments::*;

#[derive(Deserialize)]
pub(super) struct ListQuery {
    cursor: Option<String>,
    resolved: Option<bool>,
}
fn response<T: Serialize>(result: Result<T, CoreError>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => {
            let status = match error.code {
                ErrorCode::NotFound => StatusCode::NOT_FOUND,
                ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
                ErrorCode::Conflict => StatusCode::CONFLICT,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            http::error_response(status, error)
        }
    }
}
pub(super) async fn list(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(app): Path<String>,
    Query(query): Query<ListQuery>,
) -> Response {
    response(state.device_account_id(&device.0).and_then(|account| {
        state.list_comments(&account, &app, query.resolved, query.cursor.as_deref())
    }))
}
pub(super) async fn create(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(app): Path<String>,
    Json(body): Json<AppCommentCreateRequest>,
) -> Response {
    response(
        state
            .device_account_id(&device.0)
            .and_then(|account| state.create_comment(&account, &app, body))
            .map(|(thread, meta)| json!({"thread":thread,"meta":meta})),
    )
}
pub(super) async fn get(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app, id)): Path<(String, String)>,
) -> Response {
    response(
        state
            .device_account_id(&device.0)
            .and_then(|account| state.get_comment(&account, Some(&app), &id))
            .map(|thread| json!({"thread":thread})),
    )
}
pub(super) async fn reply(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app, id)): Path<(String, String)>,
    Json(body): Json<AppCommentReplyRequest>,
) -> Response {
    response(
        state
            .device_account_id(&device.0)
            .and_then(|account| {
                state.reply_comment(&account, Some(&app), &id, body, AppCommentAuthor::User)
            })
            .map(|(reply, meta)| json!({"reply":reply,"meta":meta})),
    )
}
pub(super) async fn resolve(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app, id)): Path<(String, String)>,
    Json(body): Json<AppCommentResolveRequest>,
) -> Response {
    response(
        state
            .device_account_id(&device.0)
            .and_then(|account| state.resolve_comment(&account, Some(&app), &id, body))
            .map(|(thread, meta)| json!({"thread":thread,"meta":meta})),
    )
}
pub(super) async fn delete(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app, id)): Path<(String, String)>,
) -> Response {
    response(
        state
            .device_account_id(&device.0)
            .and_then(|account| state.delete_comment(&account, &app, &id))
            .map(|meta| json!({"meta":meta})),
    )
}
pub(super) async fn sent(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(app): Path<String>,
    Json(body): Json<AppCommentMarkSentRequest>,
) -> Response {
    response(
        state
            .device_account_id(&device.0)
            .and_then(|account| state.mark_comments_sent(&account, &app, &body.ids))
            .map(|meta| json!({"meta":meta})),
    )
}
pub(super) async fn read(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app, id)): Path<(String, String)>,
) -> Response {
    response(
        state
            .device_account_id(&device.0)
            .and_then(|account| state.mark_comment_read(&account, &app, &id))
            .map(|meta| json!({"meta":meta})),
    )
}
pub(super) async fn image(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app, id)): Path<(String, String)>,
) -> Response {
    match state
        .device_account_id(&device.0)
        .and_then(|account| state.comment_image(&account, Some(&app), &id))
    {
        Ok(bytes) => ([(header::CONTENT_TYPE, "image/png")], bytes).into_response(),
        Err(error) => response::<Value>(Err(error)),
    }
}
