//! 외부 웹훅을 선언된 워커 트리거로 전달한다.
use super::*;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
};
use kaleidoscope_contract::worker::WorkerInvokeRequest;
use std::collections::BTreeMap;
use subtle::ConstantTimeEq;

pub(super) async fn webhook(
    State(state): State<AppState>,
    Path(app): Path<String>,
    Query(query): Query<BTreeMap<String, String>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    invoke(state, app, None, query, headers, body).await
}

pub(super) async fn webhook_token(
    State(state): State<AppState>,
    Path((app, token)): Path<(String, String)>,
    Query(query): Query<BTreeMap<String, String>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    invoke(state, app, Some(token), query, headers, body).await
}

async fn invoke(
    state: AppState,
    app: String,
    token: Option<String>,
    query: BTreeMap<String, String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let response = invoke_inner(state, app, token, query, headers, body).await;
    match response {
        Ok(response) => response,
        Err(error) => {
            let status = match error.code {
                ErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
                ErrorCode::NotFound => StatusCode::NOT_FOUND,
                ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            super::http::error_response(status, error)
        }
    }
}

async fn invoke_inner(
    state: AppState,
    app: String,
    token: Option<String>,
    query: BTreeMap<String, String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, CoreError> {
    let account = state.mcp_account_id()?;
    let (_, worker) = state.worker_definition(&app).map_err(|error| {
        if error.code == ErrorCode::InvalidRequest {
            kaleidoscope_contract::errors::WORKER_WEBHOOK_WORKER_MISSING(&app)
        } else {
            error
        }
    })?;
    let webhook = worker
        .webhook
        .ok_or_else(|| kaleidoscope_contract::errors::WORKER_WEBHOOK_NOT_CONFIGURED(&app))?;
    if let Some(entry) = webhook.enabled_entry {
        if state
            .read_app_storage(&account, &app, &entry, None)?
            .content
            != json!(true)
        {
            return Err(kaleidoscope_contract::errors::WORKER_WEBHOOK_DISABLED(&app));
        }
    }
    if let Some(secret) = webhook.token_secret {
        let stored: Option<String> = state
            .lock_db()?
            .query_row(
                "SELECT value FROM app_secrets WHERE account_id=?1 AND app_id=?2 AND secret_id=?3",
                params![account, app, secret],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        let auth = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        let custom = headers
            .get("x-kaleidoscope-webhook-token")
            .and_then(|v| v.to_str().ok());
        let Some(expected) = stored.as_deref().filter(|value| !value.is_empty()) else {
            let error =
                kaleidoscope_contract::errors::WORKER_WEBHOOK_SECRET_NOT_CONFIGURED(&app, &secret);
            super::log_core_error(&error, "401");
            return Err(kaleidoscope_contract::errors::WORKER_WEBHOOK_TOKEN_INVALID(
                &app,
            ));
        };
        let valid = [
            token.as_deref(),
            query.get("token").map(String::as_str),
            auth,
            custom,
        ]
        .into_iter()
        .flatten()
        .any(|provided| bool::from(provided.as_bytes().ct_eq(expected.as_bytes())));
        if !valid {
            return Err(kaleidoscope_contract::errors::WORKER_WEBHOOK_TOKEN_INVALID(
                &app,
            ));
        }
    }
    let raw_body = String::from_utf8(body.to_vec())
        .map_err(|_| kaleidoscope_contract::errors::WORKER_WEBHOOK_BODY_ENCODING_INVALID(&app))?;
    let body_json = serde_json::from_str::<Value>(&raw_body).unwrap_or(Value::Null);
    let header_values: BTreeMap<String, String> = headers
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|v| (key.as_str().to_owned(), v.to_owned()))
        })
        .collect();
    let trigger = json!({"kind":"webhook", "method":"POST", "headers":header_values, "query":query, "body":body_json, "raw_body":raw_body});
    let output = state
        .run_worker(&account, &app, trigger, None, vec![app.clone()], None)
        .await?;
    if let Some(deferred) = output.defer {
        let action = deferred
            .get("action")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                kaleidoscope_contract::errors::WORKER_WEBHOOK_DEFER_ACTION_MISSING(&app)
            })?;
        if !worker.actions.iter().any(|declared| declared == action) {
            return Err(
                kaleidoscope_contract::errors::WORKER_WEBHOOK_DEFER_ACTION_UNDECLARED(&app, action),
            );
        }
        let req = WorkerInvokeRequest {
            action: action.to_owned(),
            args: deferred.get("args").cloned(),
            workspace_id: deferred
                .get("workspace_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
        };
        let state = state.clone();
        let app = app.clone();
        tokio::spawn(async move {
            if let Err(error) = state.invoke_worker(&account, &app, req).await {
                eprintln!("웹훅 후속 실행 실패: {}", error.message);
            }
        });
    }
    if let Some(custom) = output.http_response {
        let status = custom.get("status").and_then(Value::as_u64).unwrap_or(200);
        let status = u16::try_from(status)
            .ok()
            .and_then(|s| StatusCode::from_u16(s).ok())
            .ok_or_else(|| kaleidoscope_contract::errors::WORKER_WEBHOOK_STATUS_INVALID(&app))?;
        let body = match custom.get("body") {
            Some(Value::String(text)) => text.clone(),
            Some(value) => value.to_string(),
            None => String::new(),
        };
        let mut response = (status, body).into_response();
        if let Some(map) = custom.get("headers").and_then(Value::as_object) {
            for (name, value) in map {
                let name = header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
                    kaleidoscope_contract::errors::WORKER_WEBHOOK_HEADER_NAME_INVALID(&app)
                })?;
                let value =
                    header::HeaderValue::from_str(value.as_str().unwrap_or("")).map_err(|_| {
                        kaleidoscope_contract::errors::WORKER_WEBHOOK_HEADER_VALUE_INVALID(&app)
                    })?;
                response.headers_mut().insert(name, value);
            }
        }
        return Ok(response);
    }
    Ok(Json(json!({"ok":true,"result":output.reply.result})).into_response())
}

#[cfg(test)]
mod error_id_tests {
    use super::*;
    use http_body_util::BodyExt;

    #[tokio::test]
    async fn webhook_error_response_contains_registered_id() {
        let response = invoke(
            AppState::in_memory("test-token"),
            "missing-app".into(),
            None,
            BTreeMap::new(),
            HeaderMap::new(),
            Bytes::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let error: CoreError = serde_json::from_slice(&body).unwrap();

        assert_eq!(error.id.as_deref(), Some("WORKER_APP_NOT_FOUND"));
    }
}
