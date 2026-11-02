//! 대화 제공자에 기기 OAuth 자격으로 직접 요청한다.
use std::collections::BTreeMap;
use std::io::Read;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use crate::{
    Inner,
    connections::{self, LoginStore},
    logins::Logins,
};
use kaleidoscope_contract::{
    CoreError,
    conversation::{ConversationErrorCode, ConversationErrorEnvelope},
    data::HttpMethod,
    registry::{ConnectionInfo, ConnectionKind},
    validate::valid_request_path,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const PENDING_RETRY_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone)]
pub(crate) struct Client {
    pub info: ConnectionInfo,
    pub workspace_name: String,
    pub base_path: String,
    pub(crate) logins: Arc<Logins>,
    pub(crate) profiler: crate::profiler::Profiler,
}

impl Client {
    pub fn restore(
        inner: &Arc<Inner>,
        connection: &str,
        base_path: &str,
    ) -> Result<Self, CoreError> {
        let info = inner
            .connections
            .lock()
            .unwrap()
            .iter()
            .find(|item| item.name == connection)
            .cloned()
            .ok_or_else(|| {
                kaleidoscope_contract::errors::CONV_HTTP_PROVIDER_UNAVAILABLE(connection)
            })?;
        if info.kind != ConnectionKind::Oauth || !info.writable {
            return Err(
                kaleidoscope_contract::errors::CONV_CONTEXT_CONNECTION_NOT_WRITABLE(connection),
            );
        }
        Ok(Self {
            workspace_name: connection.to_string(),
            info,
            base_path: base_path.into(),
            logins: inner.login_store.clone(),
            profiler: inner.profiler.clone(),
        })
    }
    pub fn new(
        inner: &Arc<Inner>,
        window: &str,
        permission: &str,
        base_path: &str,
    ) -> Result<Self, CoreError> {
        let (_, info) = connections::authorize(
            inner,
            window,
            permission,
            HttpMethod::Get,
            &format!("{base_path}/models"),
        )?;
        if info.kind != ConnectionKind::Oauth {
            return Err(kaleidoscope_contract::errors::CONV_CONTEXT_PROVIDER_NOT_OAUTH());
        }
        Ok(Self {
            workspace_name: info.name.clone(),
            info,
            base_path: base_path.to_string(),
            logins: inner.login_store.clone(),
            profiler: inner.profiler.clone(),
        })
    }

    pub fn with_workspace_name(mut self, workspace_name: &str) -> Self {
        self.workspace_name = workspace_name.to_string();
        self
    }

    pub fn require_login(&self) -> Result<(), CoreError> {
        self.logins
            .token(&self.info.name)
            .map(|_| ())
            .ok_or_else(|| kaleidoscope_contract::errors::CONV_HTTP_LOGIN_REQUIRED(&self.info.name))
    }

    pub fn path(&self, segments: &[&str]) -> Result<String, CoreError> {
        let mut path = self.base_path.trim_end_matches('/').to_string();
        for segment in segments {
            path.push('/');
            for encoded in url::form_urlencoded::byte_serialize(segment.as_bytes()) {
                path.push_str(if encoded == "+" { "%20" } else { encoded });
            }
        }
        if !valid_request_path(&path)
            || (!self.info.paths.is_empty() && !self.info.paths.iter().any(|p| path.starts_with(p)))
        {
            return Err(kaleidoscope_contract::errors::CONV_HTTP_PATH_INVALID(path));
        }
        Ok(path)
    }

    pub fn json<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        query: &BTreeMap<String, String>,
        body: Option<&impl Serialize>,
    ) -> Result<Option<T>, CoreError> {
        let target = self.network_target(&method, path);
        let started = Instant::now();
        let response = self.send(
            method,
            path,
            query,
            body.map(|b| {
                serde_json::to_value(b)
                    .map_err(|_| kaleidoscope_contract::errors::CONV_HTTP_BODY_INVALID())
            })
            .transpose()?,
            false,
            None,
        )?;
        let status = response.status();
        let response = if status.as_u16() == 404 {
            response
        } else {
            self.status(response)?
        };
        let body = response
            .bytes()
            .map_err(|error| self.response_read_failed(error))?;
        self.record_network(&target, status.as_u16(), body.len(), started);
        if status.as_u16() == 404 {
            return Ok(None);
        }
        serde_json::from_slice(&body)
            .map(Some)
            .map_err(|error| self.response_invalid(error))
    }

    /// 제공자는 오래 걸리는 일에 504 `pending`으로 답하고 일을 뒤에서 계속한다.
    /// 같은 요청은 다시 보내도 일이 겹치지 않으므로 끝날 때까지 다시 보낸다.
    pub fn json_until_settled<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        query: &BTreeMap<String, String>,
        body: Option<&impl Serialize>,
    ) -> Result<Option<T>, CoreError> {
        let body = body
            .map(|body| {
                serde_json::to_value(body)
                    .map_err(|_| kaleidoscope_contract::errors::CONV_HTTP_BODY_INVALID())
            })
            .transpose()?;
        let target = self.network_target(&method, path);
        let started = Instant::now();
        loop {
            let attempt = Instant::now();
            let response = self.send(method.clone(), path, query, body.clone(), false, None)?;
            let status = response.status();
            if status.as_u16() == 504 {
                let bytes = response
                    .bytes()
                    .map_err(|error| self.response_read_failed(error))?;
                self.record_network(&target, 504, bytes.len(), attempt);
                if matches!(
                    serde_json::from_slice::<ConversationErrorEnvelope>(&bytes),
                    Ok(envelope) if envelope.error.code == ConversationErrorCode::Pending
                ) {
                    if started.elapsed() >= REQUEST_TIMEOUT {
                        return Err(kaleidoscope_contract::errors::CONV_SEND_PENDING_TIMEOUT(
                            &self.workspace_name,
                        ));
                    }
                    thread::sleep(PENDING_RETRY_INTERVAL);
                    continue;
                }
                return Err(self.provider_error_or_status(&bytes, 504));
            }
            let response = if status.as_u16() == 404 {
                response
            } else {
                self.status(response)?
            };
            let bytes = response
                .bytes()
                .map_err(|error| self.response_read_failed(error))?;
            self.record_network(&target, status.as_u16(), bytes.len(), attempt);
            if status.as_u16() == 404 {
                return Ok(None);
            }
            return serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|error| self.response_invalid(error));
        }
    }

    pub fn bytes(&self, path: &str) -> Result<(String, String, Vec<u8>), CoreError> {
        let target = self.network_target(&reqwest::Method::GET, path);
        let started = Instant::now();
        let mut response = self.status(self.send(
            reqwest::Method::GET,
            path,
            &BTreeMap::new(),
            None,
            false,
            None,
        )?)?;
        let status = response.status().as_u16();
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let name = response
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|v| v.to_str().ok())
            .and_then(|header| {
                header
                    .split(';')
                    .map(str::trim)
                    .find_map(|part| {
                        part.strip_prefix("filename*=UTF-8''").and_then(|value| {
                            percent_encoding::percent_decode_str(value)
                                .decode_utf8()
                                .ok()
                                .map(|s| s.into_owned())
                        })
                    })
                    .or_else(|| {
                        header.split(';').map(str::trim).find_map(|part| {
                            part.strip_prefix("filename=")
                                .map(|name| name.trim_matches('"').to_string())
                        })
                    })
            })
            .unwrap_or_else(|| "첨부".into());
        let mut bytes = Vec::new();
        (&mut response)
            .take(kaleidoscope_contract::AGENT_ATTACHMENT_MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| {
                let host = self.host();
                kaleidoscope_contract::errors::CONV_HTTP_RESPONSE_READ_FAILED(&host)
                    .and_details(vec![format!("호스트: {host}"), error.to_string()])
            })?;
        self.record_network(&target, status, bytes.len(), started);
        if bytes.len() as u64 > kaleidoscope_contract::AGENT_ATTACHMENT_MAX_BYTES {
            return Err(kaleidoscope_contract::errors::CONV_HTTP_ATTACHMENT_TOO_LARGE());
        }
        Ok((name, mime, bytes))
    }

    fn network_target(&self, method: &reqwest::Method, path: &str) -> String {
        let base_path = self.base_path.trim_end_matches('/');
        let path = path.strip_prefix(base_path).unwrap_or(path);
        let path = path
            .split('/')
            .map(|segment| {
                if uuid::Uuid::parse_str(segment).is_ok() {
                    "{id}"
                } else {
                    segment
                }
            })
            .collect::<Vec<_>>()
            .join("/");
        format!("{method} {path}")
    }

    fn record_network(&self, target: &str, status: u16, bytes: usize, started: Instant) {
        self.profiler.span(
            "network",
            target,
            "",
            "",
            started.elapsed().as_secs_f64() * 1000.0,
            0,
            0,
            &format!("상태 {status}, 응답 {:.1}KB", bytes as f64 / 1024.0),
        );
    }

    pub fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        query: &BTreeMap<String, String>,
        body: Option<Value>,
        stream: bool,
        cursor: Option<&str>,
    ) -> Result<reqwest::blocking::Response, CoreError> {
        if !valid_request_path(path)
            || (!self.info.paths.is_empty() && !self.info.paths.iter().any(|p| path.starts_with(p)))
        {
            return Err(kaleidoscope_contract::errors::CONV_HTTP_PATH_INVALID(path));
        }
        if method != reqwest::Method::GET && !self.info.writable {
            return Err(kaleidoscope_contract::errors::CONV_HTTP_PERMISSION_DENIED(
                &self.info.name,
            ));
        }
        let client = crate::http_client::shared()?;
        let send = |token: &str| {
            let mut request = client
                .request(method.clone(), format!("{}{}", self.info.base_url, path))
                .bearer_auth(token)
                .query(query);
            if !stream {
                request = request.timeout(REQUEST_TIMEOUT);
            }
            if let Some(body) = &body {
                request = request.json(body);
            }
            if let Some(cursor) = cursor {
                request = request.header("Last-Event-ID", cursor);
            }
            request.send().map_err(|error| self.request_failed(error))
        };
        let token = self.logins.token(&self.info.name).ok_or_else(|| {
            kaleidoscope_contract::errors::CONV_HTTP_LOGIN_REQUIRED(&self.info.name)
        })?;
        let reply = send(&token)?;
        if reply.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(reply);
        }
        let refreshed = self
            .logins
            .refresh(&self.info.name, &token)
            .ok_or_else(|| {
                kaleidoscope_contract::errors::CONV_HTTP_LOGIN_REQUIRED(&self.info.name)
            })?;
        let reply = send(&refreshed)?;
        if reply.status() == reqwest::StatusCode::UNAUTHORIZED {
            self.logins.invalidate(&self.info.name, &refreshed);
            return Err(kaleidoscope_contract::errors::CONV_HTTP_LOGIN_REQUIRED(
                &self.info.name,
            ));
        }
        Ok(reply)
    }

    fn status(
        &self,
        reply: reqwest::blocking::Response,
    ) -> Result<reqwest::blocking::Response, CoreError> {
        if reply.status().is_success() {
            return Ok(reply);
        }
        let status = reply.status().as_u16();
        let body = reply
            .bytes()
            .map_err(|error| self.response_read_failed(error))?;
        Err(self.provider_error_or_status(&body, status))
    }

    fn host(&self) -> String {
        url::Url::parse(&self.info.base_url)
            .ok()
            .and_then(|url| {
                let host = url.host_str()?;
                Some(match url.port() {
                    Some(port) => format!("{host}:{port}"),
                    None => host.to_string(),
                })
            })
            .unwrap_or_else(|| "대화 제공자".into())
    }

    fn request_failed(&self, error: reqwest::Error) -> CoreError {
        let host = self.host();
        let reason = error.without_url().to_string();
        kaleidoscope_contract::errors::CONV_HTTP_REQUEST_FAILED(&host)
            .and_details(vec![format!("호스트: {host}"), reason])
    }

    fn response_read_failed(&self, error: reqwest::Error) -> CoreError {
        let host = self.host();
        let reason = error.without_url().to_string();
        kaleidoscope_contract::errors::CONV_HTTP_RESPONSE_READ_FAILED(&host)
            .and_details(vec![format!("호스트: {host}"), reason])
    }

    fn response_invalid(&self, error: serde_json::Error) -> CoreError {
        kaleidoscope_contract::errors::CONV_HTTP_RESPONSE_INVALID(
            &self.info.name,
            error.to_string(),
        )
    }

    fn provider_error_or_status(&self, body: &[u8], status: u16) -> CoreError {
        if let Ok(envelope) = serde_json::from_slice::<ConversationErrorEnvelope>(body) {
            return crate::conversation_send::provider_error(envelope.error, &self.workspace_name)
                .and_details(vec![
                    format!("HTTP 상태: {status}"),
                    format!("호스트: {}", self.host()),
                ]);
        }
        let error = match status {
            401 => kaleidoscope_contract::errors::CONV_HTTP_STATUS_LOGIN_REQUIRED(&self.info.name),
            403 => kaleidoscope_contract::errors::CONV_HTTP_STATUS_FORBIDDEN(&self.info.name),
            404 => kaleidoscope_contract::errors::CONV_HTTP_STATUS_NOT_FOUND(&self.info.name),
            409 => kaleidoscope_contract::errors::CONV_HTTP_STATUS_CONFLICT(&self.info.name),
            400 | 413 | 422 => {
                kaleidoscope_contract::errors::CONV_HTTP_STATUS_INVALID_REQUEST(&self.info.name)
            }
            _ => kaleidoscope_contract::errors::CONV_HTTP_STATUS_SERVER(&self.info.name),
        };
        error.and_details(vec![
            format!("HTTP 상태: {status}"),
            format!("호스트: {}", self.host()),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::Client;
    use crate::{logins::LoginEntry, profiler::Profiler};
    use kaleidoscope_contract::registry::{ConnectionInfo, ConnectionKind};
    use std::{collections::BTreeMap, net::TcpListener, sync::Arc};

    #[test]
    fn failed_request_does_not_expose_query_keys_or_tokens() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let temp = tempfile::tempdir().unwrap();
        let logins = Arc::new(crate::logins::Logins::open(temp.path()).unwrap());
        logins
            .store(
                "provider",
                LoginEntry {
                    issuer: format!("http://{address}"),
                    client_id: None,
                    redirect_port: None,
                    access_token: Some("bearer-token-secret".into()),
                    refresh_token: None,
                    expires_at: None,
                },
            )
            .unwrap();
        let client = Client {
            info: ConnectionInfo {
                name: "provider".into(),
                kind: ConnectionKind::Oauth,
                base_url: format!("http://{address}"),
                writable: true,
                paths: vec![],
                issuer: None,
                scopes: None,
                resource: None,
            },
            workspace_name: "provider".into(),
            base_path: "/v1".into(),
            logins,
            profiler: Profiler::default(),
        };
        let query = BTreeMap::from([("api_key".into(), "query-secret".into())]);

        let error = client
            .json::<serde_json::Value>(
                reqwest::Method::GET,
                "/v1/models",
                &query,
                None::<&serde_json::Value>,
            )
            .unwrap_err();

        let output = format!("{} {:?}", error.message, error.details);
        assert_eq!(error.id.as_deref(), Some("CONV_HTTP_REQUEST_FAILED"));
        assert!(output.contains(&address.to_string()));
        assert!(!output.contains("api_key"));
        assert!(!output.contains("query-secret"));
        assert!(!output.contains("bearer-token-secret"));
    }

    #[test]
    fn provider_error_uses_the_workspace_name_in_its_message() {
        let temp = tempfile::tempdir().unwrap();
        let logins = Arc::new(crate::logins::Logins::open(temp.path()).unwrap());
        let client = Client {
            info: ConnectionInfo {
                name: "provider".into(),
                kind: ConnectionKind::Oauth,
                base_url: "https://provider.example".into(),
                writable: true,
                paths: vec![],
                issuer: None,
                scopes: None,
                resource: None,
            },
            workspace_name: "kaleidoscope".into(),
            base_path: "/v1".into(),
            logins,
            profiler: Profiler::default(),
        };
        let body = serde_json::json!({
            "error": {"code": "unavailable", "message": "시험용 제공자 오류"}
        });

        let error = client.provider_error_or_status(&serde_json::to_vec(&body).unwrap(), 503);

        assert_eq!(error.id.as_deref(), Some("CONV_SEND_PROVIDER_UNAVAILABLE"));
        assert!(error.message.contains("작업 kaleidoscope"));
        assert!(error.message.contains("시험용 제공자 오류"));
        assert!(!error.message.contains("provider"));
    }
}
