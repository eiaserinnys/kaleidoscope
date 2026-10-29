use super::*;
use axum::extract::{rejection::JsonRejection, Extension, Path, State};
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    data::{HttpMethod, CONNECTION_TIMEOUT_SECS, MEDIA_MAX_BYTES, SOURCE_MAX_BYTES},
    registry::{ConnectionAccept, ConnectionKind, ConnectionReply, ConnectionRequest},
    validate::valid_request_path,
    FileAccess, PermissionDecl,
};
use reqwest::{header::HeaderName, header::HeaderValue, redirect::Policy, Method, Url};

const REQUEST_BODY_MAX_BYTES: usize = 1024 * 1024;

impl AppState {
    pub(super) async fn relay_request(
        &self,
        name: &str,
        request: ConnectionRequest,
    ) -> Result<ConnectionReply, (StatusCode, CoreError)> {
        let connection = self
            .connection(name)
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    server_error("연결을 찾을 수 없습니다."),
                )
            })?;
        if connection.info.kind != ConnectionKind::Relay {
            return Err((
                StatusCode::BAD_REQUEST,
                CoreError::new(ErrorCode::InvalidRequest),
            ));
        }
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
                CoreError::new(ErrorCode::PermissionDenied),
            ));
        };
        if request.method != HttpMethod::Get
            && (access != FileAccess::Readwrite || !connection.info.writable)
        {
            return Err((
                StatusCode::FORBIDDEN,
                CoreError::new(ErrorCode::PermissionDenied),
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
                CoreError::new(ErrorCode::InvalidRequest),
            ));
        }

        let mut url = Url::parse(&format!("{}{}", connection.info.base_url, request.path))
            .map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    server_error("원천 주소를 만들 수 없습니다."),
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
                CoreError::new(ErrorCode::InvalidRequest),
            )
        })?;
        let accept = request.accept;
        let body_present = request.body.is_some();
        let body = request.body;
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .build()
            .map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    server_error("원천 요청을 준비할 수 없습니다."),
                )
            })?;
        let mut outgoing = client.request(method, url);
        for (name, value) in &connection.headers {
            let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    server_error("연결 헤더 설정을 읽을 수 없습니다."),
                )
            })?;
            if body_present && header_name == reqwest::header::CONTENT_TYPE {
                continue;
            }
            let value = expand_environment(value).map_err(|name| {
                (
                    StatusCode::BAD_GATEWAY,
                    server_error(&format!("서버 환경변수가 없습니다: {name}")),
                )
            })?;
            let header_value = HeaderValue::from_str(&value).map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    server_error("연결 헤더 설정을 읽을 수 없습니다."),
                )
            })?;
            outgoing = outgoing.header(header_name, header_value);
        }
        if let Some(body) = body {
            outgoing = outgoing.json(&body);
        }

        let future = async move {
            let response = outgoing.send().await.map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    server_error("원천에 닿지 못했습니다."),
                )
            })?;
            let status = response.status().as_u16();
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
            while let Some(chunk) = response.chunk().await.map_err(|_| {
                (
                    StatusCode::BAD_GATEWAY,
                    server_error("원천 응답을 읽지 못했습니다."),
                )
            })? {
                if bytes.len().saturating_add(chunk.len()) > max_bytes {
                    return Err((
                        StatusCode::PAYLOAD_TOO_LARGE,
                        CoreError::new(ErrorCode::InvalidRequest),
                    ));
                }
                bytes.extend_from_slice(&chunk);
            }
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
            Ok(ConnectionReply {
                status,
                mime,
                json,
                text,
                data_base64,
            })
        };
        match tokio::time::timeout(Duration::from_secs(CONNECTION_TIMEOUT_SECS), future).await {
            Ok(result) => result,
            Err(_) => Err((
                StatusCode::GATEWAY_TIMEOUT,
                server_error("원천 요청 시간이 지났습니다."),
            )),
        }
    }
}
fn expand_environment(value: &str) -> Result<String, String> {
    let mut result = String::new();
    let mut remainder = value;
    while let Some(start) = remainder.find("${env:") {
        result.push_str(&remainder[..start]);
        let variable_start = start + "${env:".len();
        let tail = &remainder[variable_start..];
        let Some(end) = tail.find('}') else {
            result.push_str(&remainder[start..]);
            return Ok(result);
        };
        let name = &tail[..end];
        if name.is_empty() {
            result.push_str(&remainder[start..variable_start + end + 1]);
        } else {
            result.push_str(&std::env::var(name).map_err(|_| name.to_string())?);
        }
        remainder = &tail[end + 1..];
    }
    result.push_str(remainder);
    Ok(result)
}

pub(super) async fn device_request(
    State(state): State<AppState>,
    Extension(_device): Extension<(String, String)>,
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
            return http::error_response(status, CoreError::new(ErrorCode::InvalidRequest));
        }
    };
    match state.relay_request(&name, request).await {
        Ok(reply) => (StatusCode::OK, Json(reply)).into_response(),
        Err((status, error)) => http::error_response(status, error),
    }
}

pub(super) fn connection_request_body_limit() -> usize {
    REQUEST_BODY_MAX_BYTES
}
