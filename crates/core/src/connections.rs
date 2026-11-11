//! 창 권한을 확인한 뒤 서버 중계 또는 기기 로그인 연결로 요청한다.
use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    data::{self, HttpMethod},
    errors,
    registry::{
        ConnectionAccept, ConnectionInfo, ConnectionKind, ConnectionReply, ConnectionRequest,
    },
    validate::valid_request_path,
    CoreError, FileAccess, LinkStatus, PermissionDecl,
};

use crate::{app_commands, Inner};

pub(crate) trait LoginStore: Send + Sync {
    fn token(&self, connection: &str) -> Option<String>;
    fn refresh(&self, connection: &str, rejected_token: &str) -> Option<String>;
    fn invalidate(&self, connection: &str, access_token: &str);
}

pub(crate) fn find_connection(inner: &Arc<Inner>, name: &str) -> Option<ConnectionInfo> {
    inner
        .connections
        .lock()
        .unwrap()
        .iter()
        .find(|info| info.name == name)
        .cloned()
}

enum ConnectionLookup {
    Found(ConnectionInfo),
    Missing,
    ServerNotConnected,
}

fn find_ready_connection(inner: &Arc<Inner>, name: &str) -> ConnectionLookup {
    if let Some(info) = find_connection(inner, name) {
        return ConnectionLookup::Found(info);
    }
    let readiness = crate::startup_readiness::wait(
        inner,
        crate::startup_readiness::WaitFor::ConnectionsSnapshot,
    );
    if readiness == crate::startup_readiness::Readiness::Failed {
        ConnectionLookup::ServerNotConnected
    } else {
        find_connection(inner, name).map_or(ConnectionLookup::Missing, ConnectionLookup::Found)
    }
}

#[derive(Debug)]
pub(crate) enum RequestError {
    Core(CoreError),
    Login(String),
    RateLimited { retry_after: Option<u64> },
}
impl From<CoreError> for RequestError {
    fn from(error: CoreError) -> Self {
        Self::Core(error)
    }
}

pub(crate) fn request(
    inner: &Arc<Inner>,
    window_id: &str,
    permission: &str,
    method: HttpMethod,
    path: &str,
    query: std::collections::BTreeMap<String, String>,
    body: Option<serde_json::Value>,
    accept: ConnectionAccept,
) -> Result<ConnectionReply, RequestError> {
    let is_profiler = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|item| item.id == window_id)
            .ok_or_else(errors::CONN_REQUEST_WINDOW_NOT_FOUND)?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(errors::CONN_REQUEST_APP_NOT_FOUND)?;
        definition
            .permissions
            .iter()
            .any(|decl| matches!(decl, PermissionDecl::Profiler { id, .. } if id == permission))
    };
    if is_profiler {
        return crate::profiler::request(inner, method, path, &query, body)
            .map_err(RequestError::Core);
    }
    let public = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|item| item.id == window_id)
            .ok_or_else(errors::CONN_REQUEST_WINDOW_NOT_FOUND)?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(errors::CONN_REQUEST_APP_NOT_FOUND)?;
        match definition
            .permissions
            .iter()
            .find(|decl| decl.id() == permission)
        {
            Some(PermissionDecl::Http {
                base_url, paths, ..
            }) => Some((base_url.clone(), paths.clone())),
            _ => None,
        }
    };
    if let Some((base_url, paths)) = public {
        if method != HttpMethod::Get || body.is_some() {
            return Err(errors::CONN_REQUEST_HTTP_READ_ONLY().into());
        }
        let limit = if matches!(accept, ConnectionAccept::Bytes) {
            data::MEDIA_MAX_BYTES
        } else {
            data::SOURCE_MAX_BYTES
        };
        let response = kaleidoscope_data::public_http::get(&base_url, &paths, path, &query, limit)
            .map_err(|detail| {
                let mut error = errors::CONN_REQUEST_PUBLIC_HTTP_FAILED();
                error.details.push(detail);
                RequestError::Core(error)
            })?;
        let mut reply = ConnectionReply {
            status: response.status,
            rate_limit: response.rate_limit,
            mime: response.mime,
            json: None,
            text: None,
            data_base64: None,
        };
        match accept {
            ConnectionAccept::Bytes => reply.data_base64 = Some(STANDARD.encode(response.bytes)),
            ConnectionAccept::Text => {
                reply.text = Some(String::from_utf8(response.bytes).map_err(|detail| {
                    let mut error = errors::CONN_REQUEST_PUBLIC_TEXT_INVALID();
                    error.details.push(detail.to_string());
                    RequestError::Core(error)
                })?)
            }
            ConnectionAccept::Json => match serde_json::from_slice(&response.bytes) {
                Ok(value) => reply.json = Some(value),
                Err(_) => reply.text = Some(String::from_utf8_lossy(&response.bytes).into_owned()),
            },
        }
        return Ok(reply);
    }
    let (app_id, info) = authorize(inner, window_id, permission, method, path)?;
    let connection = info.name.clone();
    let req = ConnectionRequest {
        app_id,
        method,
        path: path.into(),
        query,
        body,
        accept,
    };
    match info.kind {
        ConnectionKind::Relay => {
            crate::startup_readiness::wait(inner, crate::startup_readiness::WaitFor::Server);
            let connected = matches!(
                inner.state.lock().unwrap().link,
                LinkStatus::Connected { .. }
            );
            let file = inner.link_file.lock().unwrap().clone();
            let Some(file) = file.filter(|_| connected) else {
                return Err(errors::CONN_REQUEST_RELAY_DISCONNECTED(&connection).into());
            };
            inner
                .registry
                .connection_request(&file.server_url, &file.token, &connection, &req)
                .map_err(|err| {
                    let host = reqwest::Url::parse(&file.server_url)
                        .ok()
                        .and_then(|url| url.host_str().map(str::to_owned))
                        .unwrap_or_else(|| "알 수 없는 서버".into());
                    match err {
                        crate::registry_client::RegistryError::Validation(mut error) => {
                            error.code = kaleidoscope_contract::ErrorCode::Server;
                            RequestError::Core(error)
                        }
                        crate::registry_client::RegistryError::Unauthorized => {
                            let mut error = errors::CONN_REQUEST_RELAY_REJECTED(&connection, &host);
                            error.details = vec![format!("HTTP 401; host={host}")];
                            RequestError::Core(error)
                        }
                        crate::registry_client::RegistryError::NotFound => {
                            let mut error = errors::CONN_REQUEST_RELAY_REJECTED(&connection, &host);
                            error.details = vec![format!("HTTP 404; host={host}")];
                            RequestError::Core(error)
                        }
                        crate::registry_client::RegistryError::Failure { stage, detail, .. } => {
                            let mut error = match stage {
                                crate::registry_client::FailureStage::Send => {
                                    errors::CONN_REQUEST_RELAY_UNREACHABLE(&connection, &host)
                                }
                                crate::registry_client::FailureStage::Status => {
                                    errors::CONN_REQUEST_RELAY_REJECTED(&connection, &host)
                                }
                                crate::registry_client::FailureStage::Read => {
                                    errors::CONN_REQUEST_RELAY_RESPONSE_READ_FAILED(
                                        &connection,
                                        &host,
                                    )
                                }
                            };
                            error.details = vec![detail];
                            RequestError::Core(error)
                        }
                    }
                })
        }
        ConnectionKind::Oauth => {
            let Some(token) = inner.login_store.token(&connection) else {
                return Err(RequestError::Login(permission.into()));
            };
            let reply = oauth_request(&info, &token, &req)?;
            if reply.status != 401 {
                return Ok(reply);
            }
            let Some(refreshed) = inner.login_store.refresh(&connection, &token) else {
                return Err(RequestError::Login(permission.into()));
            };
            let reply = oauth_request(&info, &refreshed, &req)?;
            if reply.status == 401 {
                inner.login_store.invalidate(&connection, &refreshed);
                return Err(RequestError::Login(permission.into()));
            }
            Ok(reply)
        }
    }
}

pub(crate) fn login(
    inner: &Arc<Inner>,
    window_id: &str,
    permission: &str,
) -> Result<kaleidoscope_contract::CoreReply, CoreError> {
    let connection_name = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|window| window.id == window_id)
            .ok_or_else(errors::CONN_LOGIN_WINDOW_NOT_FOUND)?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(errors::CONN_LOGIN_APP_NOT_FOUND)?;
        match definition
            .permissions
            .iter()
            .find(|decl| decl.id() == permission)
        {
            Some(PermissionDecl::Connection { connection, .. }) => connection.clone(),
            _ => return Err(errors::CONN_LOGIN_PERMISSION_MISSING(permission)),
        }
    };
    let info = match find_ready_connection(inner, &connection_name) {
        ConnectionLookup::Found(info) => info,
        ConnectionLookup::Missing => {
            return Err(errors::CONN_LOGIN_CONNECTION_MISSING(&connection_name));
        }
        ConnectionLookup::ServerNotConnected => {
            return Err(errors::CONN_LOGIN_SERVER_NOT_CONNECTED(&connection_name));
        }
    };
    if info.kind != ConnectionKind::Oauth {
        return Err(errors::CONN_LOGIN_NOT_OAUTH(&connection_name));
    }
    {
        let mut active = inner.login_in_progress.lock().unwrap();
        if !active.insert(connection_name.clone()) {
            return Err(errors::CONN_LOGIN_ALREADY_RUNNING(&connection_name));
        }
    }
    let result = crate::oauth::login(
        &info,
        &inner.device_name,
        inner.host.as_ref(),
        &inner.login_store,
    );
    inner
        .login_in_progress
        .lock()
        .unwrap()
        .remove(&connection_name);
    result?;
    crate::data_runtime::connection_changed(inner, permission);
    crate::data_runtime::refresh_login_required(inner, &connection_name);
    crate::conversation_stream::login_succeeded(inner, &connection_name);
    crate::conversation_send::recover(inner);
    crate::conversation_reconcile::schedule(inner);
    Ok(kaleidoscope_contract::CoreReply::ConnectionLogin {})
}

pub(crate) fn authorize(
    inner: &Arc<Inner>,
    window_id: &str,
    permission: &str,
    method: HttpMethod,
    path: &str,
) -> Result<(String, ConnectionInfo), CoreError> {
    let access = if method == HttpMethod::Get {
        FileAccess::Read
    } else {
        FileAccess::Readwrite
    };
    authorize_access(inner, window_id, permission, access, path)
}

pub(crate) fn authorize_access(
    inner: &Arc<Inner>,
    window_id: &str,
    permission: &str,
    requested: FileAccess,
    path: &str,
) -> Result<(String, ConnectionInfo), CoreError> {
    let (app_id, connection) = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|window| window.id == window_id)
            .ok_or_else(errors::CONN_AUTHORIZE_WINDOW_NOT_FOUND)?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(errors::CONN_AUTHORIZE_APP_NOT_FOUND)?;
        let declaration = definition
            .permissions
            .iter()
            .find(|decl| decl.id() == permission);
        let Some(PermissionDecl::Connection {
            connection, access, ..
        }) = declaration
        else {
            return Err(errors::CONN_AUTHORIZE_PERMISSION_MISSING(permission));
        };
        if requested == FileAccess::Readwrite && *access != FileAccess::Readwrite {
            return Err(errors::CONN_AUTHORIZE_READ_ONLY(permission));
        }
        (window.app_id.clone(), connection.clone())
    };
    let info = match find_ready_connection(inner, &connection) {
        ConnectionLookup::Found(info) => info,
        ConnectionLookup::Missing => {
            return Err(errors::CONN_AUTHORIZE_CONNECTION_MISSING(&connection));
        }
        ConnectionLookup::ServerNotConnected => {
            return Err(errors::CONN_AUTHORIZE_SERVER_NOT_CONNECTED(&connection));
        }
    };
    if !valid_request_path(path)
        || (!info.paths.is_empty() && !info.paths.iter().any(|prefix| path.starts_with(prefix)))
    {
        return Err(errors::CONN_AUTHORIZE_PATH_DENIED(&connection));
    }
    if requested == FileAccess::Readwrite && !info.writable {
        return Err(errors::CONN_AUTHORIZE_WRITE_DENIED(&connection));
    }
    Ok((app_id, info))
}

fn oauth_request(
    info: &ConnectionInfo,
    token: &str,
    request: &ConnectionRequest,
) -> Result<ConnectionReply, RequestError> {
    let client = crate::http_client::shared().map_err(|detail| {
        let mut error = errors::CONN_REQUEST_OAUTH_CLIENT_FAILED(&info.name);
        error.details.push(detail.message);
        RequestError::Core(error)
    })?;
    let method =
        reqwest::Method::from_bytes(request.method.as_str().as_bytes()).map_err(|detail| {
            let mut error = errors::CONN_REQUEST_OAUTH_METHOD_INVALID(&info.name);
            error.details.push(detail.to_string());
            RequestError::Core(error)
        })?;
    let mut builder = client
        .request(method, format!("{}{}", info.base_url, request.path))
        .bearer_auth(token)
        .query(&request.query)
        .timeout(Duration::from_secs(data::CONNECTION_TIMEOUT_SECS));
    if let Some(body) = &request.body {
        builder = builder.json(body);
    }
    let mut response = builder.send().map_err(|detail| {
        let host = detail
            .url()
            .and_then(|url| url.host_str())
            .unwrap_or("알 수 없는 서버")
            .to_owned();
        let mut error = errors::CONN_REQUEST_OAUTH_UNREACHABLE(&info.name, &host);
        error.details = vec![format!("{}; host={host}", detail.without_url())];
        RequestError::Core(error)
    })?;
    let status = response.status().as_u16();
    let response_host = response
        .url()
        .host_str()
        .unwrap_or("알 수 없는 서버")
        .to_owned();
    let rate_limit = kaleidoscope_data::rate_limit::rate_limit(status, response.headers());
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let limit = match request.accept {
        ConnectionAccept::Bytes => data::MEDIA_MAX_BYTES,
        _ => data::SOURCE_MAX_BYTES,
    };
    let mut bytes = Vec::new();
    (&mut response)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|detail| {
            let mut error =
                errors::CONN_REQUEST_OAUTH_RESPONSE_READ_FAILED(&info.name, &response_host);
            error.details = vec![format!("{}; host={response_host}", detail)];
            RequestError::Core(error)
        })?;
    if bytes.len() as u64 > limit {
        return Err(errors::CONN_REQUEST_OAUTH_RESPONSE_TOO_LARGE(
            &info.name,
            kaleidoscope_contract::size::format_byte_limit(limit),
        )
        .into());
    }
    let mut reply = ConnectionReply {
        status,
        rate_limit,
        mime,
        json: None,
        text: None,
        data_base64: None,
    };
    match request.accept {
        ConnectionAccept::Bytes => reply.data_base64 = Some(STANDARD.encode(bytes)),
        ConnectionAccept::Text => {
            reply.text = Some(String::from_utf8(bytes).map_err(|detail| {
                let mut error = errors::CONN_REQUEST_OAUTH_RESPONSE_TEXT_INVALID(&info.name);
                error.details.push(detail.to_string());
                RequestError::Core(error)
            })?)
        }
        ConnectionAccept::Json => match serde_json::from_slice(&bytes) {
            Ok(value) => reply.json = Some(value),
            Err(_) => reply.text = Some(String::from_utf8_lossy(&bytes).into_owned()),
        },
    }
    Ok(reply)
}

pub(crate) fn response_error(reply: &ConnectionReply, target: &str) -> CoreError {
    let mut error = errors::CONN_REQUEST_SERVER_RESPONSE_FAILED(target, response_reason(reply));
    error.details = vec![format!("HTTP {}", reply.status)];
    error
}

pub(crate) fn response_reason(reply: &ConnectionReply) -> String {
    let reason = match reply.json.as_ref() {
        Some(json) => json.get("error").and_then(|value| value.as_str())
            .or_else(|| json.get("message").and_then(|value| value.as_str()))
            .or_else(|| json.get("error").and_then(|value| value.get("message")).and_then(|value| value.as_str()))
            .or_else(|| json.get("detail").and_then(|value| value.as_str()))
            .or_else(|| json.get("detail").and_then(|value| value.get("error")).and_then(|value| value.as_str()))
            .or_else(|| json.get("detail").and_then(|value| value.get("message")).and_then(|value| value.as_str()))
            .or_else(|| json.get("detail").and_then(|value| value.get("error")).and_then(|value| value.get("message")).and_then(|value| value.as_str())),
        None => reply.text.as_deref().map(str::trim),
    }.filter(|value| !value.is_empty()).unwrap_or("서버가 사유를 보내지 않았습니다");
    let line = reason.lines().collect::<Vec<_>>().join(" ");
    let mut chars = line.chars();
    let mut result: String = chars.by_ref().take(300).collect();
    if chars.next().is_some() { result.push('…'); }
    result
}

#[cfg(test)]
mod rate_limit_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn oauth_response_preserves_rate_limit_hint() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            stream.write_all(b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 7\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
        });
        let info = ConnectionInfo {
            name: "test".into(),
            kind: ConnectionKind::Oauth,
            base_url: format!("http://{address}"),
            writable: false,
            paths: vec![],
            issuer: None,
            scopes: None,
            resource: None,
        };
        let request = ConnectionRequest {
            app_id: "test".into(),
            method: HttpMethod::Get,
            path: "/items".into(),
            query: Default::default(),
            body: None,
            accept: ConnectionAccept::Json,
        };
        let reply = oauth_request(&info, "token", &request).unwrap();
        assert_eq!(reply.rate_limit.unwrap().retry_after_secs, Some(7));
        server.join().unwrap();
    }

    #[test]
    fn oauth_network_error_does_not_expose_query_parameters() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let info = ConnectionInfo {
            name: "github".into(),
            kind: ConnectionKind::Oauth,
            base_url: format!("http://{address}"),
            writable: false,
            paths: vec![],
            issuer: None,
            scopes: None,
            resource: None,
        };
        let request = ConnectionRequest {
            app_id: "test".into(),
            method: HttpMethod::Get,
            path: "/items".into(),
            query: [("api_key".into(), "query-secret".into())].into(),
            body: None,
            accept: ConnectionAccept::Json,
        };

        let error = match oauth_request(&info, "header-secret", &request) {
            Ok(_) => panic!("연결이 끊긴 주소는 요청에 실패해야 합니다"),
            Err(RequestError::Core(error)) => error,
            Err(RequestError::Login(_)) => {
                panic!("네트워크 오류가 로그인 필요 오류가 되면 안 됩니다")
            }
            Err(RequestError::RateLimited { .. }) => {
                panic!("연결 거절은 속도 제한 오류가 되면 안 됩니다")
            }
        };
        let rendered = format!("{} {:?}", error.message, error.details);

        assert!(!rendered.contains("api_key"));
        assert!(!rendered.contains("query-secret"));
        assert!(!rendered.contains("header-secret"));
    }
}
