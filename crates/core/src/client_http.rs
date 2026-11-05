//! 클라이언트에 선언된 공개 HTTPS 바이트 읽기.
use crate::{app_commands, Inner};
use kaleidoscope_contract::{data::{self, HttpMethod}, errors, CoreError, FileAccess, PermissionDecl};
use serde_json::Value;
use std::collections::BTreeMap;

const FORBIDDEN_HEADERS: &[&str] = &[
    "authorization", "proxy-authorization", "cookie", "cookie2", "set-cookie", "host",
    "content-length", "transfer-encoding", "connection", "keep-alive", "upgrade", "te", "trailer",
    "expect", "origin", "referer", "user-agent", "via", "date", "dnt", "accept-charset",
    "accept-encoding", "access-control-request-headers", "access-control-request-method",
];

fn forbidden_header(name: &str, value: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with("proxy-") || name.starts_with("sec-") || FORBIDDEN_HEADERS.contains(&name.as_str())
        || (["x-http-method", "x-http-method-override", "x-method-override"].contains(&name.as_str())
            && value.split(',').map(str::trim).any(|method| ["CONNECT", "TRACE", "TRACK"].iter().any(|forbidden| method.eq_ignore_ascii_case(forbidden))))
}

pub(crate) fn encode_response(response: kaleidoscope_data::public_http::PublicResponse) -> Vec<u8> {
    let metadata = serde_json::to_vec(&serde_json::json!({"status":response.status, "headers":response.headers, "mime":response.mime}))
        .expect("HTTP 응답 메타는 JSON으로 직렬화할 수 있다");
    let mut result = Vec::with_capacity(4 + metadata.len() + response.bytes.len());
    result.extend_from_slice(&(metadata.len() as u32).to_be_bytes());
    result.extend_from_slice(&metadata);
    result.extend_from_slice(&response.bytes);
    result
}

pub(crate) fn request(
    inner: &Inner, window: &str, permission: &str, method: HttpMethod, path: &str,
    query: BTreeMap<String, Value>, headers: BTreeMap<String, String>, body: Option<&[u8]>,
) -> Result<kaleidoscope_data::public_http::PublicResponse, CoreError> {
    let (base, paths) = {
        let state = inner.state.lock().unwrap();
        let window = state.shared.windows.iter().find(|w| w.id == window)
            .ok_or_else(errors::DATA_CLIENT_HTTP_REQUEST_WINDOW_NOT_FOUND)?;
        let definition = app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
            .ok_or_else(|| errors::DATA_CLIENT_HTTP_REQUEST_APP_NOT_FOUND(&window.app_id))?;
        if !definition.client.as_ref().and_then(|c| c.http_permissions.as_ref()).is_some_and(|p| p.iter().any(|p| p == permission)) {
            return Err(errors::DATA_CLIENT_HTTP_REQUEST_CLIENT_PERMISSION_DENIED(permission));
        }
        let (base, paths, access) = match definition.permissions.iter().find(|p| p.id() == permission) {
            Some(PermissionDecl::Http { base_url, paths, access, .. }) => (base_url.clone(), paths.clone(), *access),
            _ => return Err(errors::DATA_CLIENT_HTTP_REQUEST_PERMISSION_INVALID(permission)),
        };
        if definition.requires.modules.get("http").copied().unwrap_or(0) < 3 {
            return Err(errors::DATA_CLIENT_HTTP_REQUEST_MODULE_VERSION(permission));
        }
        if method != HttpMethod::Get && access != FileAccess::Readwrite {
            return Err(errors::DATA_CLIENT_HTTP_REQUEST_WRITE_DENIED(permission));
        }
        (base, paths)
    };
    if method == HttpMethod::Get && body.is_some() { return Err(errors::DATA_CLIENT_HTTP_REQUEST_GET_BODY()); }
    if headers.len() > 32 { return Err(errors::DATA_CLIENT_HTTP_REQUEST_HEADERS_TOO_MANY()); }
    for (name, value) in &headers {
        if reqwest::header::HeaderName::from_bytes(name.as_bytes()).is_err() { return Err(errors::DATA_CLIENT_HTTP_REQUEST_HEADER_NAME_INVALID(name)); }
        if value.len() > 8 * 1024 { return Err(errors::DATA_CLIENT_HTTP_REQUEST_HEADER_VALUE_TOO_LARGE(name)); }
        if reqwest::header::HeaderValue::from_str(value).is_err() { return Err(errors::DATA_CLIENT_HTTP_REQUEST_HEADER_VALUE_INVALID(name)); }
        if forbidden_header(name, value) { return Err(errors::DATA_CLIENT_HTTP_REQUEST_HEADER_FORBIDDEN(name)); }
    }
    if body.is_some_and(|bytes| bytes.len() as u64 > data::SOURCE_MAX_BYTES) { return Err(errors::DATA_CLIENT_HTTP_REQUEST_BODY_TOO_LARGE("16MiB")); }
    let query = query.into_iter().filter_map(|(k, v)| match v {
        Value::Null => None, Value::String(s) => Some((k, s)), other => Some((k, other.to_string())),
    }).collect();
    let host = reqwest::Url::parse(&base).ok().and_then(|url| url.host_str().map(str::to_owned));
    let response = kaleidoscope_data::public_http::request_typed(&base, &paths, path, &query, method, &headers, body, data::SOURCE_MAX_BYTES)
        .map_err(|error| match error {
            kaleidoscope_data::public_http::PublicHttpError::InvalidAddress => errors::DATA_CLIENT_HTTP_REQUEST_ADDRESS_INVALID(path.split(['?', '#']).next().unwrap_or("")),
            kaleidoscope_data::public_http::PublicHttpError::PrivateAddress => errors::DATA_CLIENT_HTTP_REQUEST_PRIVATE_ADDRESS(path),
            kaleidoscope_data::public_http::PublicHttpError::TooLarge => errors::DATA_CLIENT_HTTP_REQUEST_RESPONSE_TOO_LARGE("16MiB"),
            kaleidoscope_data::public_http::PublicHttpError::Transport(reason) => {
                let mut error = errors::DATA_CLIENT_HTTP_REQUEST_TRANSPORT_FAILED(path);
                error.details.push(format!("원인: {reason}"));
                if let Some(host) = &host { error.details.push(format!("호스트: {host}")); }
                error
            }
        })?;
    if method != HttpMethod::Get && (200..300).contains(&response.status) {
        crate::data_runtime::connection_changed(inner, permission);
    }
    Ok(response)
}

pub(crate) fn read(
    inner: &Inner,
    window: &str,
    permission: &str,
    path: &str,
    query: BTreeMap<String, Value>,
) -> Result<(Vec<u8>, String), CoreError> {
    let (base, paths) = {
        let state = inner.state.lock().unwrap();
        let window = state
            .shared
            .windows
            .iter()
            .find(|w| w.id == window)
            .ok_or_else(|| {
                errors::DATA_CLIENT_HTTP_WINDOW_NOT_FOUND()
                    .and_details(vec![format!("window: {}", window)])
            })?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| errors::DATA_CLIENT_HTTP_APP_NOT_FOUND(&window.app_id))?;
        if !definition
            .client
            .as_ref()
            .and_then(|c| c.http_permissions.as_ref())
            .is_some_and(|p| p.iter().any(|p| p == permission))
        {
            return Err(errors::DATA_CLIENT_HTTP_CLIENT_PERMISSION_DENIED(
                permission,
            ));
        }
        match definition.permissions.iter().find(|p| p.id() == permission) {
            Some(PermissionDecl::Http {
                base_url, paths, ..
            }) => (base_url.clone(), paths.clone()),
            _ => return Err(errors::DATA_CLIENT_HTTP_APP_PERMISSION_DENIED(permission)),
        }
    };
    let query = query
        .into_iter()
        .filter_map(|(k, v)| match v {
            Value::Null => None,
            Value::String(s) => Some((k, s)),
            other => Some((k, other.to_string())),
        })
        .collect();
    let host = reqwest::Url::parse(&base)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned));
    let response =
        kaleidoscope_data::public_http::get(&base, &paths, path, &query, data::SOURCE_MAX_BYTES)
            .map_err(|e| {
                let mut error = errors::DATA_CLIENT_HTTP_READ_FAILED(path);
                let mut details = vec![e];
                if let Some(host) = &host {
                    details.push(format!("호스트: {host}"));
                }
                error.details = details;
                error
            })?;
    if !(200..300).contains(&response.status) {
        let mut error = errors::DATA_CLIENT_HTTP_STATUS_FAILED(path);
        let mut details = vec![format!("HTTP 상태: {}", response.status)];
        if let Some(host) = host {
            details.push(format!("호스트: {host}"));
        }
        error.details = details;
        return Err(error);
    }
    Ok((response.bytes, response.mime))
}
