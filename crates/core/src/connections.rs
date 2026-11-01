//! 창 권한을 확인한 뒤 서버 중계 또는 기기 로그인 연결로 요청한다.
use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    data::{self, HttpMethod},
    registry::{
        ConnectionAccept, ConnectionInfo, ConnectionKind, ConnectionReply, ConnectionRequest,
    },
    validate::valid_request_path,
    CoreError, ErrorCode, FileAccess, LinkStatus, PermissionDecl,
};

use crate::{app_commands, error, Inner};

pub(crate) trait LoginStore: Send + Sync {
    fn token(&self, connection: &str) -> Option<String>;
    fn refresh(&self, connection: &str, rejected_token: &str) -> Option<String>;
    fn invalidate(&self, connection: &str, access_token: &str);
}
#[derive(Debug)]
pub(crate) enum RequestError {
    Core(CoreError),
    Login(String),
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
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
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
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
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
            return Err(error::make(ErrorCode::PermissionDenied).into());
        }
        let limit = if matches!(accept, ConnectionAccept::Bytes) {
            data::MEDIA_MAX_BYTES
        } else {
            data::SOURCE_MAX_BYTES
        };
        let response = kaleidoscope_data::public_http::get(&base_url, &paths, path, &query, limit)
            .map_err(server)?;
        let mut reply = ConnectionReply {
            status: response.status,
            mime: response.mime,
            json: None,
            text: None,
            data_base64: None,
        };
        match accept {
            ConnectionAccept::Bytes => reply.data_base64 = Some(STANDARD.encode(response.bytes)),
            ConnectionAccept::Text => {
                reply.text = Some(String::from_utf8(response.bytes).map_err(server)?)
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
            let connected = matches!(
                inner.state.lock().unwrap().link,
                LinkStatus::Connected { .. }
            );
            let file = inner.link_file.lock().unwrap().clone();
            let Some(file) = file.filter(|_| connected) else {
                return Err(error::with_message(
                    ErrorCode::Server,
                    "서버에 연결되어 있지 않습니다",
                )
                .into());
            };
            inner
                .registry
                .connection_request(&file.server_url, &file.token, &connection, &req)
                .map_err(|err| {
                    error::with_message(ErrorCode::Server, &format!("연결 요청 실패: {err:?}"))
                        .into()
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
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        match definition
            .permissions
            .iter()
            .find(|decl| decl.id() == permission)
        {
            Some(PermissionDecl::Connection { connection, .. }) => connection.clone(),
            _ => return Err(error::make(ErrorCode::PermissionDenied)),
        }
    };
    let info = inner
        .connections
        .lock()
        .unwrap()
        .iter()
        .find(|info| info.name == connection_name)
        .cloned()
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
    if info.kind != ConnectionKind::Oauth {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    {
        let mut active = inner.login_in_progress.lock().unwrap();
        if !active.insert(connection_name.clone()) {
            return Err(error::with_message(
                ErrorCode::InvalidRequest,
                "이미 로그인하는 중입니다",
            ));
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
    let (app_id, connection) = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|window| window.id == window_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let declaration = definition
            .permissions
            .iter()
            .find(|decl| decl.id() == permission);
        let Some(PermissionDecl::Connection {
            connection, access, ..
        }) = declaration
        else {
            return Err(error::make(ErrorCode::PermissionDenied));
        };
        if method != HttpMethod::Get && *access != FileAccess::Readwrite {
            return Err(error::make(ErrorCode::PermissionDenied));
        }
        (window.app_id.clone(), connection.clone())
    };
    let info = inner
        .connections
        .lock()
        .unwrap()
        .iter()
        .find(|info| info.name == connection)
        .cloned()
        .ok_or_else(|| error::with_message(ErrorCode::Server, "서버에 없는 연결입니다"))?;
    if !valid_request_path(path)
        || (!info.paths.is_empty() && !info.paths.iter().any(|prefix| path.starts_with(prefix)))
    {
        return Err(error::with_message(
            ErrorCode::PermissionDenied,
            "허용하지 않은 연결 경로입니다",
        ));
    }
    if method != HttpMethod::Get && !info.writable {
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    Ok((app_id, info))
}

fn oauth_request(
    info: &ConnectionInfo,
    token: &str,
    request: &ConnectionRequest,
) -> Result<ConnectionReply, RequestError> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(data::CONNECTION_TIMEOUT_SECS))
        .build()
        .map_err(server)?;
    let method = reqwest::Method::from_bytes(request.method.as_str().as_bytes()).map_err(server)?;
    let mut builder = client
        .request(method, format!("{}{}", info.base_url, request.path))
        .bearer_auth(token)
        .query(&request.query);
    if let Some(body) = &request.body {
        builder = builder.json(body);
    }
    let mut response = builder.send().map_err(server)?;
    let status = response.status().as_u16();
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
        .map_err(server)?;
    if bytes.len() as u64 > limit {
        return Err(error::with_message(ErrorCode::Io, "응답이 너무 큽니다").into());
    }
    let mut reply = ConnectionReply {
        status,
        mime,
        json: None,
        text: None,
        data_base64: None,
    };
    match request.accept {
        ConnectionAccept::Bytes => reply.data_base64 = Some(STANDARD.encode(bytes)),
        ConnectionAccept::Text => reply.text = Some(String::from_utf8(bytes).map_err(server)?),
        ConnectionAccept::Json => match serde_json::from_slice(&bytes) {
            Ok(value) => reply.json = Some(value),
            Err(_) => reply.text = Some(String::from_utf8_lossy(&bytes).into_owned()),
        },
    }
    Ok(reply)
}

fn server(error: impl std::fmt::Display) -> RequestError {
    error::with_message(ErrorCode::Server, &error.to_string()).into()
}

pub(crate) fn response_error(reply: &ConnectionReply) -> CoreError {
    let body = reply
        .text
        .clone()
        .or_else(|| reply.json.as_ref().map(|value| value.to_string()))
        .unwrap_or_default();
    let excerpt: String = body.chars().take(200).collect();
    error::with_message(
        ErrorCode::Server,
        &format!("HTTP {}: {}", reply.status, excerpt),
    )
}
