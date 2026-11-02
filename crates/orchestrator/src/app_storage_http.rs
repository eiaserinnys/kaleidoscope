use super::*;
use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use kaleidoscope_contract::app_storage as contract;
use kaleidoscope_contract::app_storage::StorageUpdate;

#[derive(Debug, Deserialize)]
pub(super) struct StorageQuery {
    workspace_id: Option<String>,
    doc: Option<String>,
}

fn status_for(error: &CoreError) -> StatusCode {
    match error.code {
        ErrorCode::NotFound => StatusCode::NOT_FOUND,
        ErrorCode::Conflict => StatusCode::CONFLICT,
        ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn storage_error_response(error: CoreError) -> Response {
    if error.code == ErrorCode::Conflict {
        let current_revision = error
            .details
            .first()
            .and_then(|detail| detail.strip_prefix("current_revision="))
            .filter(|value| *value != "null")
            .map(str::to_string);
        return (
            StatusCode::CONFLICT,
            Json(contract::StorageConflict { current_revision }),
        )
            .into_response();
    }
    let status = status_for(&error);
    super::http::error_response(status, error)
}

pub(super) fn send_storage_update(
    state: &AppState,
    app_id: &str,
    account_id: &str,
    update: StorageUpdate,
) {
    if kaleidoscope_contract::builtin::is_builtin(app_id) {
        if let StorageUpdate::Changed { changed } = &update {
            state.send_event_for_account(
                DeviceEvent::AppValueChanged {
                    app_id: app_id.into(),
                    bucket_id: changed.bucket_id.clone(),
                    item: contract::AppValueMeta {
                        key: changed.item.key.clone(),
                        kind: changed.item.kind,
                        revision: changed.item.revision.clone(),
                    },
                },
                account_id,
            );
        }
    }
    let event = match update {
        StorageUpdate::Snapshot { snapshot } => DeviceEvent::StorageSnapshot {
            app_id: app_id.into(),
            snapshot,
        },
        StorageUpdate::Changed { changed } => DeviceEvent::StorageChanged {
            app_id: app_id.into(),
            changed,
        },
        StorageUpdate::Moved { moved } => DeviceEvent::StorageMoved {
            app_id: app_id.into(),
            moved,
        },
    };
    state.publish_storage_update(event, account_id);
}

pub(super) fn send_raw_storage_move(
    state: &AppState,
    app_id: &str,
    account_id: &str,
    update: StorageUpdate,
    from_key: String,
    to_key: String,
) {
    let StorageUpdate::Moved { moved } = update else {
        return;
    };
    state.publish_storage_update(
        DeviceEvent::AppValueMoved {
            app_id: app_id.into(),
            bucket_id: moved.bucket_id,
            from_key,
            to_key,
            revision: moved.revision,
        },
        account_id,
    );
}

pub(super) async fn device_collection_list(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, entry_id)): Path<(String, String)>,
    Query(query): Query<StorageQuery>,
) -> Response {
    let account_id = match state.device_account_id(&device.0) {
        Ok(value) => value,
        Err(error) => return super::http::error_response(status_for(&error), error),
    };
    match state.list_app_storage_collection(
        &account_id,
        &app_id,
        &entry_id,
        query.workspace_id.as_deref(),
    ) {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err(error) => storage_error_response(error),
    }
}

pub(super) async fn device_collection_read(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, entry_id)): Path<(String, String)>,
    Query(query): Query<StorageQuery>,
) -> Response {
    let account_id = match state.device_account_id(&device.0) {
        Ok(value) => value,
        Err(error) => return super::http::error_response(status_for(&error), error),
    };
    let Some(doc) = query.doc.as_deref() else {
        return storage_error_response(CoreError::new(ErrorCode::InvalidRequest));
    };
    match state.read_app_storage_document(
        &account_id,
        &app_id,
        &entry_id,
        doc,
        query.workspace_id.as_deref(),
    ) {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err(error) => storage_error_response(error),
    }
}

pub(super) async fn device_collection_write(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, entry_id)): Path<(String, String)>,
    Query(query): Query<StorageQuery>,
    Json(request): Json<contract::StorageWriteRequest>,
) -> Response {
    let account_id = match state.device_account_id(&device.0) {
        Ok(value) => value,
        Err(error) => return super::http::error_response(status_for(&error), error),
    };
    let Some(doc) = query.doc.as_deref() else {
        return storage_error_response(CoreError::new(ErrorCode::InvalidRequest));
    };
    match state.write_app_storage_document(
        &account_id,
        &app_id,
        &entry_id,
        doc,
        query.workspace_id.as_deref(),
        request.content,
        request.expected_revision.0,
    ) {
        Ok((reply, account, update)) => {
            send_storage_update(&state, &app_id, &account, update);
            (StatusCode::OK, Json(reply)).into_response()
        }
        Err(error) => storage_error_response(error),
    }
}

pub(super) async fn device_collection_reset(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, entry_id)): Path<(String, String)>,
    Query(query): Query<StorageQuery>,
    Json(request): Json<contract::StorageResetRequest>,
) -> Response {
    let account_id = match state.device_account_id(&device.0) {
        Ok(value) => value,
        Err(error) => return super::http::error_response(status_for(&error), error),
    };
    let Some(doc) = query.doc.as_deref() else {
        return storage_error_response(CoreError::new(ErrorCode::InvalidRequest));
    };
    let Some(expected_revision) = request.expected_revision.0 else {
        return storage_error_response(CoreError::new(ErrorCode::InvalidRequest));
    };
    match state.reset_app_storage_document(
        &account_id,
        &app_id,
        &entry_id,
        doc,
        query.workspace_id.as_deref(),
        Some(expected_revision),
    ) {
        Ok((reply, account, update)) => {
            send_storage_update(&state, &app_id, &account, update);
            (StatusCode::OK, Json(reply)).into_response()
        }
        Err(error) => storage_error_response(error),
    }
}

pub(super) async fn device_collection_move(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, entry_id)): Path<(String, String)>,
    Query(query): Query<StorageQuery>,
    Json(request): Json<contract::CollectionMove>,
) -> Response {
    let account_id = match state.device_account_id(&device.0) {
        Ok(value) => value,
        Err(error) => return super::http::error_response(status_for(&error), error),
    };
    match state.move_app_storage_document(
        &account_id,
        &app_id,
        &entry_id,
        &request,
        query.workspace_id.as_deref(),
    ) {
        Ok((reply, account, update)) => {
            send_storage_update(&state, &app_id, &account, update);
            (StatusCode::OK, Json(reply)).into_response()
        }
        Err(error) => storage_error_response(error),
    }
}

pub(super) async fn device_list(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(app_id): Path<String>,
    Query(query): Query<StorageQuery>,
) -> Response {
    let account_id = match state.device_account_id(&device.0) {
        Ok(value) => value,
        Err(error) => return super::http::error_response(status_for(&error), error),
    };
    match state.list_app_storage(&account_id, &app_id, query.workspace_id.as_deref()) {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err(error) => storage_error_response(error),
    }
}

pub(super) async fn device_read(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, entry_id)): Path<(String, String)>,
    Query(query): Query<StorageQuery>,
) -> Response {
    let account_id = match state.device_account_id(&device.0) {
        Ok(value) => value,
        Err(error) => return super::http::error_response(status_for(&error), error),
    };
    match state.read_app_storage(
        &account_id,
        &app_id,
        &entry_id,
        query.workspace_id.as_deref(),
    ) {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err(error) => storage_error_response(error),
    }
}

pub(super) async fn device_write(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, entry_id)): Path<(String, String)>,
    Query(query): Query<StorageQuery>,
    Json(request): Json<contract::StorageWriteRequest>,
) -> Response {
    let account_id = match state.device_account_id(&device.0) {
        Ok(value) => value,
        Err(error) => return super::http::error_response(status_for(&error), error),
    };
    match state.write_app_storage(
        &account_id,
        &app_id,
        &entry_id,
        query.workspace_id.as_deref(),
        request.content,
        request.expected_revision.0,
    ) {
        Ok((reply, account, update)) => {
            send_storage_update(&state, &app_id, &account, update);
            super::worker::spawn_watch(
                &state,
                &account,
                &app_id,
                &entry_id,
                query.workspace_id.as_deref(),
            );
            (StatusCode::OK, Json(reply)).into_response()
        }
        Err(error) => storage_error_response(error),
    }
}

pub(super) async fn device_reset(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((app_id, entry_id)): Path<(String, String)>,
    Query(query): Query<StorageQuery>,
    Json(request): Json<contract::StorageResetRequest>,
) -> Response {
    let account_id = match state.device_account_id(&device.0) {
        Ok(value) => value,
        Err(error) => return super::http::error_response(status_for(&error), error),
    };
    match state.reset_app_storage(
        &account_id,
        &app_id,
        &entry_id,
        query.workspace_id.as_deref(),
        request.expected_revision.0,
    ) {
        Ok((reply, account, update)) => {
            send_storage_update(&state, &app_id, &account, update);
            super::worker::spawn_watch(
                &state,
                &account,
                &app_id,
                &entry_id,
                query.workspace_id.as_deref(),
            );
            (StatusCode::OK, Json(reply)).into_response()
        }
        Err(error) => storage_error_response(error),
    }
}
