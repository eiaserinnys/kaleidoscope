//! 대화 제공자에 기기 OAuth 자격으로 직접 요청한다.
use std::collections::BTreeMap;
use std::io::Read;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use crate::{
    connections::{self, LoginStore},
    error,
    logins::Logins,
    Inner,
};
use kaleidoscope_contract::{
    conversation::{ConversationErrorCode, ConversationErrorEnvelope},
    data::HttpMethod,
    registry::{ConnectionInfo, ConnectionKind},
    validate::valid_request_path,
    CoreError, ErrorCode,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const PENDING_RETRY_INTERVAL: Duration = Duration::from_secs(1);
const PENDING_TIMEOUT_MESSAGE: &str = "아직 처리 중입니다. 잠시 뒤 다시 확인해 주세요";

#[derive(Clone)]
pub(crate) struct Client {
    pub info: ConnectionInfo,
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
            .ok_or_else(|| error::make(ErrorCode::Unavailable))?;
        if info.kind != ConnectionKind::Oauth || !info.writable {
            return Err(error::make(ErrorCode::PermissionDenied));
        }
        Ok(Self {
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
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        Ok(Self {
            info,
            base_path: base_path.to_string(),
            logins: inner.login_store.clone(),
            profiler: inner.profiler.clone(),
        })
    }

    pub fn require_login(&self) -> Result<(), CoreError> {
        self.logins
            .token(&self.info.name)
            .map(|_| ())
            .ok_or_else(|| error::make(ErrorCode::LoginRequired))
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
            return Err(error::make(ErrorCode::PermissionDenied));
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
                serde_json::to_value(b).map_err(|_| error::make(ErrorCode::InvalidRequest))
            })
            .transpose()?,
            false,
            None,
        )?;
        let status = response.status();
        let response = if status.as_u16() == 404 {
            response
        } else {
            Self::status(response)?
        };
        let body = response.bytes().map_err(server)?;
        self.record_network(&target, status.as_u16(), body.len(), started);
        if status.as_u16() == 404 {
            return Ok(None);
        }
        serde_json::from_slice(&body).map(Some).map_err(server)
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
                serde_json::to_value(body).map_err(|_| error::make(ErrorCode::InvalidRequest))
            })
            .transpose()?;
        let target = self.network_target(&method, path);
        let started = Instant::now();
        loop {
            let attempt = Instant::now();
            let response = self.send(method.clone(), path, query, body.clone(), false, None)?;
            let status = response.status();
            if status.as_u16() == 504 {
                let bytes = response.bytes().map_err(server)?;
                self.record_network(&target, 504, bytes.len(), attempt);
                if matches!(
                    serde_json::from_slice::<ConversationErrorEnvelope>(&bytes),
                    Ok(envelope) if envelope.error.code == ConversationErrorCode::Pending
                ) {
                    if started.elapsed() >= REQUEST_TIMEOUT {
                        return Err(error::with_message(
                            ErrorCode::Server,
                            PENDING_TIMEOUT_MESSAGE,
                        ));
                    }
                    thread::sleep(PENDING_RETRY_INTERVAL);
                    continue;
                }
                return Err(error::make(ErrorCode::Server));
            }
            let response = if status.as_u16() == 404 {
                response
            } else {
                Self::status(response)?
            };
            let bytes = response.bytes().map_err(server)?;
            self.record_network(&target, status.as_u16(), bytes.len(), attempt);
            if status.as_u16() == 404 {
                return Ok(None);
            }
            return serde_json::from_slice(&bytes).map(Some).map_err(server);
        }
    }

    pub fn bytes(&self, path: &str) -> Result<(String, String, Vec<u8>), CoreError> {
        let target = self.network_target(&reqwest::Method::GET, path);
        let started = Instant::now();
        let mut response = Self::status(self.send(
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
            .map_err(server)?;
        self.record_network(&target, status, bytes.len(), started);
        if bytes.len() as u64 > kaleidoscope_contract::AGENT_ATTACHMENT_MAX_BYTES {
            return Err(error::make(ErrorCode::InvalidRequest));
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
            || (method != reqwest::Method::GET && !self.info.writable)
        {
            return Err(error::make(ErrorCode::PermissionDenied));
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
            request.send().map_err(server)
        };
        let token = self
            .logins
            .token(&self.info.name)
            .ok_or_else(|| error::make(ErrorCode::LoginRequired))?;
        let reply = send(&token)?;
        if reply.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(reply);
        }
        let refreshed = self
            .logins
            .refresh(&self.info.name, &token)
            .ok_or_else(|| error::make(ErrorCode::LoginRequired))?;
        let reply = send(&refreshed)?;
        if reply.status() == reqwest::StatusCode::UNAUTHORIZED {
            self.logins.invalidate(&self.info.name, &refreshed);
            return Err(error::make(ErrorCode::LoginRequired));
        }
        Ok(reply)
    }

    pub fn status(
        reply: reqwest::blocking::Response,
    ) -> Result<reqwest::blocking::Response, CoreError> {
        if reply.status().is_success() {
            return Ok(reply);
        }
        let code = match reply.status().as_u16() {
            401 => ErrorCode::LoginRequired,
            403 => ErrorCode::PermissionDenied,
            404 => ErrorCode::NotFound,
            409 => ErrorCode::Conflict,
            400 | 413 | 422 => ErrorCode::InvalidRequest,
            _ => ErrorCode::Server,
        };
        Err(error::make(code))
    }
}

fn server(error: impl std::fmt::Display) -> CoreError {
    error::with_message(ErrorCode::Server, &error.to_string())
}
