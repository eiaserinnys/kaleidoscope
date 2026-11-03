//! 클라이언트에 선언된 공개 HTTPS 바이트 읽기.
use crate::{app_commands, Inner};
use kaleidoscope_contract::{data, errors, CoreError, PermissionDecl};
use serde_json::Value;
use std::collections::BTreeMap;

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
