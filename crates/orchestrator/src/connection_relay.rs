use super::connections::ConnectionRecord;
use super::*;
use axum::extract::{rejection::JsonRejection, Extension, Path, State};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    data::{HttpMethod, CONNECTION_TIMEOUT_SECS, MEDIA_MAX_BYTES, SOURCE_MAX_BYTES},
    errors,
    registry::{ConnectionAccept, ConnectionKind, ConnectionReply, ConnectionRequest},
    validate::valid_request_path,
    FileAccess, PermissionDecl,
};
use reqwest::{header::HeaderName, header::HeaderValue, redirect::Policy, Method, Url};

const REQUEST_BODY_MAX_BYTES: usize = 1024 * 1024;

impl AppState {
    pub(super) async fn relay_request(
        &self,
        device_id: &str,
        name: &str,
        request: ConnectionRequest,
    ) -> Result<ConnectionReply, (StatusCode, CoreError)> {
        let account_id = self
            .device_account_id(device_id)
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;
        let connection = self.relay_connection(&account_id, name)?;
        let app = self
            .app(&request.app_id, None)
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;
        let access = app.and_then(|app| {
            app.version
                .definition
                .permissions
                .into_iter()
                .find_map(|permission| match permission {
                    PermissionDecl::Connection {
                        connection, access, ..
                    } if connection == name => Some(access),
                    _ => None,
                })
        });
        let Some(access) = access else {
            return Err((
                StatusCode::FORBIDDEN,
                errors::CONN_RELAY_PERMISSION_MISSING(name),
            ));
        };
        self.request_with_access(connection, request, access)
            .await
            .map(|(reply, _)| reply)
    }

    pub(super) async fn relay_preview_request(
        &self,
        name: &str,
        request: ConnectionRequest,
        access: FileAccess,
    ) -> Result<(ConnectionReply, usize), (StatusCode, CoreError)> {
        let account_id = self
            .mcp_account_id()
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;
        let connection = self.relay_connection(&account_id, name)?;
        self.request_with_access(connection, request, access).await
    }

    fn relay_connection(
        &self,
        account_id: &str,
        name: &str,
    ) -> Result<ConnectionRecord, (StatusCode, CoreError)> {
        let connection = self
            .connection_for_account(account_id, name)
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    errors::CONN_RELAY_CONNECTION_NOT_FOUND(name),
                )
            })?;
        if connection.info.kind != ConnectionKind::Relay {
            return Err((
                StatusCode::BAD_REQUEST,
                errors::CONN_RELAY_INVALID_KIND(name),
            ));
        }
        Ok(connection)
    }

    async fn request_with_access(
        &self,
        connection: ConnectionRecord,
        request: ConnectionRequest,
        access: FileAccess,
    ) -> Result<(ConnectionReply, usize), (StatusCode, CoreError)> {
        if request.method != HttpMethod::Get
            && (access != FileAccess::Readwrite || !connection.info.writable)
        {
            return Err((
                StatusCode::FORBIDDEN,
                errors::CONN_RELAY_WRITE_DENIED(&connection.info.name),
            ));
        }
        if !valid_request_path(&request.path)
            || (!connection.info.paths.is_empty()
                && !connection
                    .info
                    .paths
                    .iter()
                    .any(|path| request.path.starts_with(path)))
        {
            return Err((
                StatusCode::BAD_REQUEST,
                errors::CONN_RELAY_PATH_INVALID(&connection.info.name),
            ));
        }

        let mut url = Url::parse(&format!("{}{}", connection.info.base_url, request.path))
            .map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    errors::CONN_RELAY_URL_INVALID(&connection.info.name),
                )
            })?;
        {
            let mut query = url.query_pairs_mut();
            for (key, value) in request.query {
                query.append_pair(&key, &value);
            }
        }
        let method = Method::from_bytes(request.method.as_str().as_bytes()).map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                errors::CONN_REQUEST_RELAY_METHOD_INVALID(&connection.info.name),
            )
        })?;
        let accept = request.accept;
        let connection_name = connection.info.name.clone();
        let host = url.host_str().unwrap_or("알 수 없는 서버").to_owned();
        let timeout_host = host.clone();
        let body_present = request.body.is_some();
        let body = request.body;
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .build()
            .map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    errors::CONN_RELAY_CLIENT_FAILED(&connection_name),
                )
            })?;
        let mut outgoing = client.request(method, url);
        for (name, value) in &connection.headers {
            let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    errors::CONN_RELAY_HEADER_NAME_INVALID(&connection_name),
                )
            })?;
            if value.contains("${env:") {
                return Err((
                    StatusCode::BAD_GATEWAY,
                    errors::CONN_RELAY_ENV_HEADER_UNSUPPORTED(&connection_name),
                ));
            }
            if body_present && header_name == reqwest::header::CONTENT_TYPE {
                continue;
            }
            let header_value = HeaderValue::from_str(value).map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    errors::CONN_RELAY_HEADER_VALUE_INVALID(&connection_name),
                )
            })?;
            outgoing = outgoing.header(header_name, header_value);
        }
        if let Some(body) = body {
            outgoing = outgoing.json(&body);
        }

        let future = async move {
            let response = outgoing.send().await.map_err(|detail| {
                let mut error = errors::CONN_RELAY_UNREACHABLE(&connection_name, &host);
                error.details = vec![format!("{}; host={host}", detail.without_url())];
                (StatusCode::BAD_GATEWAY, error)
            })?;
            let status = response.status().as_u16();
            let rate_limit = kaleidoscope_data::rate_limit::rate_limit(status, response.headers());
            let mime = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_string();
            let max_bytes = if accept == ConnectionAccept::Bytes {
                MEDIA_MAX_BYTES
            } else {
                SOURCE_MAX_BYTES
            } as usize;
            let mut response = response;
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|detail| {
                let mut error = errors::CONN_RELAY_RESPONSE_READ_FAILED(&connection_name, &host);
                error.details = vec![format!("{}; host={host}", detail.without_url())];
                (StatusCode::BAD_GATEWAY, error)
            })? {
                if bytes.len().saturating_add(chunk.len()) > max_bytes {
                    return Err((
                        StatusCode::PAYLOAD_TOO_LARGE,
                        errors::CONN_RELAY_RESPONSE_TOO_LARGE(&connection_name),
                    ));
                }
                bytes.extend_from_slice(&chunk);
            }
            let byte_count = bytes.len();
            let (json, text, data_base64) = match accept {
                ConnectionAccept::Json => match serde_json::from_slice(&bytes) {
                    Ok(value) => (Some(value), None, None),
                    Err(_) => (
                        None,
                        Some(String::from_utf8_lossy(&bytes).into_owned()),
                        None,
                    ),
                },
                ConnectionAccept::Text => (
                    None,
                    Some(String::from_utf8_lossy(&bytes).into_owned()),
                    None,
                ),
                ConnectionAccept::Bytes => (None, None, Some(STANDARD.encode(bytes))),
            };
            Ok((
                ConnectionReply {
                    status,
                    rate_limit,
                    mime,
                    json,
                    text,
                    data_base64,
                },
                byte_count,
            ))
        };
        match tokio::time::timeout(Duration::from_secs(CONNECTION_TIMEOUT_SECS), future).await {
            Ok(result) => result,
            Err(_) => Err((
                StatusCode::GATEWAY_TIMEOUT,
                errors::CONN_RELAY_TIMEOUT(&connection.info.name, &timeout_host),
            )),
        }
    }
}
pub(super) async fn device_request(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path(name): Path<String>,
    body: Result<axum::Json<ConnectionRequest>, JsonRejection>,
) -> Response {
    let request = match body {
        Ok(axum::Json(request)) => request,
        Err(rejection) => {
            let status = if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::BAD_REQUEST
            };
            return http::error_response(status, errors::CONN_RELAY_REQUEST_BODY_INVALID());
        }
    };
    match state.relay_request(&device.0, &name, request).await {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err((status, error)) => http::error_response(status, error),
    }
}

pub(super) fn connection_request_body_limit() -> usize {
    REQUEST_BODY_MAX_BYTES
}
