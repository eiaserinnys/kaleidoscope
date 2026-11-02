//! 클라이언트에 선언된 공개 HTTPS 바이트 읽기.
use crate::{app_commands, error, Inner};
use kaleidoscope_contract::{data, CoreError, ErrorCode, PermissionDecl};
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
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let definition =
            app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        if !definition
            .client
            .as_ref()
            .and_then(|c| c.http_permissions.as_ref())
            .is_some_and(|p| p.iter().any(|p| p == permission))
        {
            return Err(error::with_message(
                ErrorCode::PermissionDenied,
                "클라이언트에 선언되지 않은 HTTP 권한입니다.",
            ));
        }
        match definition.permissions.iter().find(|p| p.id() == permission) {
            Some(PermissionDecl::Http {
                base_url, paths, ..
            }) => (base_url.clone(), paths.clone()),
            _ => {
                return Err(error::with_message(
                    ErrorCode::PermissionDenied,
                    "앱에 선언되지 않은 HTTP 권한입니다.",
                ))
            }
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
    let response =
        kaleidoscope_data::public_http::get(&base, &paths, path, &query, data::SOURCE_MAX_BYTES)
            .map_err(|e| {
                error::with_message(
                    ErrorCode::Server,
                    &format!("공개 HTTPS 경로 {path}를 읽지 못했습니다: {e}"),
                )
            })?;
    if !(200..300).contains(&response.status) {
        return Err(error::with_message(
            ErrorCode::Server,
            &format!(
                "공개 HTTPS 경로 {path}가 상태 {}을 반환했습니다.",
                response.status
            ),
        ));
    }
    Ok((response.bytes, response.mime))
}
