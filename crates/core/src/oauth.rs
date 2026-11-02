use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use kaleidoscope_contract::{data, errors, registry::ConnectionInfo, CoreError};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

const CALLBACK_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);

use crate::{
    logins::{LoginEntry, Logins},
    Host,
};

#[derive(Debug)]
pub(crate) struct RefreshedTokens {
    pub(crate) access_token: String,
    pub(crate) refresh_token: Option<String>,
    pub(crate) expires_at: Option<i64>,
}

#[derive(Deserialize)]
struct Metadata {
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: String,
    code_challenge_methods_supported: Vec<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

struct Endpoints {
    authorization: Url,
    token: Url,
    registration: Url,
}

pub(crate) enum Callback {
    Code(String),
}

#[derive(Debug)]
pub(crate) enum FlowError {
    Timeout,
    InvalidClient,
    Server,
}

fn client(connection: &str) -> Result<Client, CoreError> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(data::CONNECTION_TIMEOUT_SECS))
        .build()
        .map_err(|detail| {
            let mut error = errors::CONN_LOGIN_OAUTH_CLIENT_FAILED(connection);
            error.details.push(detail.to_string());
            error
        })
}

fn issuer_for(info: &ConnectionInfo) -> Result<String, CoreError> {
    if let Some(issuer) = &info.issuer {
        return Ok(issuer.trim_end_matches('/').to_string());
    }
    let base =
        Url::parse(&info.base_url).map_err(|_| errors::CONN_LOGIN_OAUTH_URL_INVALID(&info.name))?;
    Ok(base.origin().ascii_serialization())
}

fn discover(http: &Client, connection: &str, issuer: &str) -> Result<Metadata, CoreError> {
    let url = Url::parse(&format!(
        "{}/.well-known/oauth-authorization-server",
        issuer.trim_end_matches('/')
    ))
    .map_err(|_| errors::CONN_LOGIN_OAUTH_URL_INVALID(connection))?;
    let host = url.host_str().unwrap_or("알 수 없는 서버").to_owned();
    let response = http.get(url).send().map_err(|detail| {
        let mut error = errors::CONN_LOGIN_OAUTH_DISCOVERY_UNREACHABLE(connection, &host);
        error.details = vec![format!("{}; host={host}", detail.without_url())];
        error
    })?;
    if !response.status().is_success() {
        let status = response.status();
        let mut error = errors::CONN_LOGIN_OAUTH_DISCOVERY_REJECTED(connection, &host);
        error.details = vec![format!("HTTP {status}; host={host}")];
        return Err(error);
    }
    response.json().map_err(|detail| {
        let mut error = errors::CONN_LOGIN_OAUTH_METADATA_INVALID(connection, &host);
        error.details = vec![format!("{}; host={host}", detail.without_url())];
        error
    })
}

fn endpoints(metadata: Metadata, connection: &str, host: &str) -> Result<Endpoints, CoreError> {
    if !metadata
        .code_challenge_methods_supported
        .iter()
        .any(|method| method == "S256")
    {
        return Err(errors::CONN_LOGIN_OAUTH_METHOD_UNSUPPORTED(connection));
    }
    let parse_endpoint = |value: &str| {
        Url::parse(value).map_err(|_| {
            let mut error = errors::CONN_LOGIN_OAUTH_METADATA_INVALID(connection, host);
            error.details = vec![format!("OAuth endpoint is invalid; host={host}")];
            error
        })
    };
    Ok(Endpoints {
        authorization: parse_endpoint(&metadata.authorization_endpoint)?,
        token: parse_endpoint(&metadata.token_endpoint)?,
        registration: parse_endpoint(&metadata.registration_endpoint)?,
    })
}

pub(crate) fn login(
    info: &ConnectionInfo,
    device_name: &str,
    host: &dyn Host,
    logins: &Logins,
) -> Result<(), CoreError> {
    login_with_timeout(
        info,
        device_name,
        host,
        logins,
        Duration::from_secs(data::LOGIN_TIMEOUT_SECS),
    )
}

pub(crate) fn login_with_timeout(
    info: &ConnectionInfo,
    device_name: &str,
    host: &dyn Host,
    logins: &Logins,
    timeout: Duration,
) -> Result<(), CoreError> {
    let issuer = issuer_for(info)?;
    let http = client(&info.name)?;
    let metadata = discover(&http, &info.name, &issuer)?;
    let issuer_host = Url::parse(&issuer)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| "알 수 없는 서버".into());
    let endpoints = endpoints(metadata, &info.name, &issuer_host)?;
    let deadline = Instant::now() + timeout;
    let previous = logins
        .entry(&info.name)
        .filter(|entry| entry.issuer == issuer);

    for attempt in 0..2 {
        let reusable = (attempt == 0)
            .then(|| previous.as_ref())
            .flatten()
            .and_then(|entry| Some((entry.client_id.clone()?, entry.redirect_port?)));
        let (listener, client_id) = if let Some((client_id, port)) = reusable {
            match TcpListener::bind(("127.0.0.1", port)) {
                Ok(listener) => (listener, client_id),
                Err(_) => register(&http, &endpoints, info, device_name, &issuer, logins)?,
            }
        } else {
            register(&http, &endpoints, info, device_name, &issuer, logins)?
        };
        let redirect_uri = format!(
            "http://127.0.0.1:{}/callback",
            listener
                .local_addr()
                .map_err(|detail| {
                    let mut error = errors::CONN_LOGIN_CALLBACK_LISTENER_FAILED(&info.name);
                    error.details.push(detail.to_string());
                    error
                })?
                .port()
        );
        let verifier = verifier();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let state = Uuid::new_v4().to_string();
        let mut authorization = endpoints.authorization.clone();
        {
            let mut query = authorization.query_pairs_mut();
            query.append_pair("response_type", "code");
            query.append_pair("client_id", &client_id);
            query.append_pair("redirect_uri", &redirect_uri);
            query.append_pair("code_challenge", &challenge);
            query.append_pair("code_challenge_method", "S256");
            query.append_pair("state", &state);
            if let Some(scopes) = &info.scopes {
                query.append_pair("scope", scopes);
            }
            if let Some(resource) = &info.resource {
                query.append_pair("resource", resource);
            }
        }
        host.open_url(authorization.as_str()).map_err(|detail| {
            if detail.kind() == std::io::ErrorKind::Unsupported {
                errors::CONN_LOGIN_BROWSER_UNAVAILABLE(&info.name)
            } else {
                let mut error = errors::CONN_LOGIN_BROWSER_OPEN_FAILED(&info.name);
                error.details.push(detail.to_string());
                error
            }
        })?;

        let remaining = deadline.saturating_duration_since(Instant::now());
        let callback = match wait_for_callback(&listener, &state, remaining) {
            Ok(callback) => callback,
            Err(FlowError::Timeout) => {
                return Err(errors::CONN_LOGIN_CALLBACK_TIMEOUT(&info.name));
            }
            Err(FlowError::InvalidClient) if attempt == 0 => {
                logins.clear_client(&info.name, &issuer);
                continue;
            }
            Err(FlowError::InvalidClient | FlowError::Server) => {
                return Err(errors::CONN_LOGIN_CALLBACK_INVALID(&info.name));
            }
        };
        let code = match callback {
            Callback::Code(code) => code,
        };
        match exchange_code(
            &http,
            &endpoints.token,
            &client_id,
            &redirect_uri,
            &code,
            &verifier,
        ) {
            Ok(tokens) => {
                let mut entry = logins.entry(&info.name).unwrap_or(LoginEntry {
                    issuer: issuer.clone(),
                    client_id: Some(client_id),
                    redirect_port: Some(
                        listener
                            .local_addr()
                            .map_err(|detail| {
                                let mut error =
                                    errors::CONN_LOGIN_CALLBACK_LISTENER_FAILED(&info.name);
                                error.details.push(detail.to_string());
                                error
                            })?
                            .port(),
                    ),
                    access_token: None,
                    refresh_token: None,
                    expires_at: None,
                });
                entry.issuer = issuer;
                entry.access_token = Some(tokens.access_token);
                entry.refresh_token = tokens.refresh_token;
                entry.expires_at = tokens.expires_at;
                logins.store(&info.name, entry)?;
                return Ok(());
            }
            Err(ExchangeError::InvalidClient { .. }) if attempt == 0 => {
                logins.clear_client(&info.name, &issuer);
            }
            Err(error) => {
                return Err(exchange_error_to_core(error, &info.name));
            }
        }
    }
    Err(errors::CONN_LOGIN_CODE_EXCHANGE_RESPONSE_INVALID(
        &info.name,
        &issuer_host,
    ))
}

fn register(
    http: &Client,
    endpoints: &Endpoints,
    info: &ConnectionInfo,
    device_name: &str,
    issuer: &str,
    logins: &Logins,
) -> Result<(TcpListener, String), CoreError> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|detail| {
        let mut error = errors::CONN_LOGIN_CALLBACK_LISTENER_FAILED(&info.name);
        error.details.push(detail.to_string());
        error
    })?;
    let port = listener
        .local_addr()
        .map_err(|detail| {
            let mut error = errors::CONN_LOGIN_CALLBACK_LISTENER_FAILED(&info.name);
            error.details.push(detail.to_string());
            error
        })?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let mut body = json!({
        "client_name": format!("kaleidoscope ({device_name})"),
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none"
    });
    if let Some(scopes) = &info.scopes {
        body["scope"] = Value::String(scopes.clone());
    }
    let response = http
        .post(endpoints.registration.clone())
        .json(&body)
        .send()
        .map_err(|detail| {
            let host = endpoints
                .registration
                .host_str()
                .unwrap_or("알 수 없는 서버");
            let mut error = errors::CONN_LOGIN_CLIENT_REGISTER_UNREACHABLE(&info.name, host);
            error.details = vec![format!("{}; host={host}", detail.without_url())];
            error
        })?;
    let registration_host = response
        .url()
        .host_str()
        .unwrap_or("알 수 없는 서버")
        .to_owned();
    if !response.status().is_success() {
        let status = response.status();
        let mut error = errors::CONN_LOGIN_CLIENT_REGISTER_REJECTED(&info.name, &registration_host);
        error.details = vec![format!("HTTP {status}; host={registration_host}")];
        return Err(error);
    }
    let response: Value = response.json().map_err(|detail| {
        let mut error =
            errors::CONN_LOGIN_CLIENT_REGISTER_RESPONSE_INVALID(&info.name, &registration_host);
        error.details = vec![format!(
            "{}; host={registration_host}",
            detail.without_url()
        )];
        error
    })?;
    let client_id = response
        .get("client_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| {
            errors::CONN_LOGIN_CLIENT_REGISTER_RESPONSE_INVALID(&info.name, &registration_host)
        })?
        .to_string();
    logins.update_client(&info.name, issuer, client_id.clone(), port)?;
    Ok((listener, client_id))
}

fn verifier() -> String {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

enum ExchangeError {
    InvalidClient {
        status: reqwest::StatusCode,
        host: String,
    },
    Unreachable {
        host: String,
        detail: String,
    },
    Rejected {
        status: reqwest::StatusCode,
        host: String,
    },
    ResponseInvalid {
        host: String,
        detail: String,
    },
}

fn exchange_code(
    http: &Client,
    endpoint: &Url,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> Result<RefreshedTokens, ExchangeError> {
    let host = endpoint.host_str().unwrap_or("알 수 없는 서버").to_owned();
    let response = http
        .post(endpoint.clone())
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", client_id),
            ("code_verifier", verifier),
        ])
        .send()
        .map_err(|detail| ExchangeError::Unreachable {
            host: host.clone(),
            detail: detail.without_url().to_string(),
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let invalid_client = response
            .json::<Value>()
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .is_some_and(|error| error == "invalid_client");
        return Err(if invalid_client {
            ExchangeError::InvalidClient { status, host }
        } else {
            ExchangeError::Rejected { status, host }
        });
    }
    let response: TokenResponse =
        response
            .json()
            .map_err(|detail| ExchangeError::ResponseInvalid {
                host: host.clone(),
                detail: detail.without_url().to_string(),
            })?;
    if response.access_token.is_empty() {
        return Err(ExchangeError::ResponseInvalid {
            host,
            detail: "OAuth 서버가 빈 access token을 반환했습니다".into(),
        });
    }
    Ok(RefreshedTokens {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: response.expires_in.map(expiry),
    })
}

fn exchange_error_to_core(error: ExchangeError, connection: &str) -> CoreError {
    match error {
        ExchangeError::InvalidClient { status, host }
        | ExchangeError::Rejected { status, host } => {
            let mut error = errors::CONN_LOGIN_CODE_EXCHANGE_REJECTED(connection, &host);
            error.details = vec![format!("HTTP {status}; host={host}")];
            error
        }
        ExchangeError::Unreachable { host, detail } => {
            let mut error = errors::CONN_LOGIN_CODE_EXCHANGE_UNREACHABLE(connection, &host);
            error.details = vec![format!("{detail}; host={host}")];
            error
        }
        ExchangeError::ResponseInvalid { host, detail } => {
            let mut error = errors::CONN_LOGIN_CODE_EXCHANGE_RESPONSE_INVALID(connection, &host);
            error.details = vec![format!("{detail}; host={host}")];
            error
        }
    }
}

pub(crate) fn refresh_access_token(entry: &LoginEntry) -> Option<RefreshedTokens> {
    let http = client("OAuth").ok()?;
    let metadata = discover(&http, "OAuth", &entry.issuer).ok()?;
    let token_endpoint = Url::parse(&metadata.token_endpoint).ok()?;
    let refresh_token = entry.refresh_token.as_deref()?;
    let client_id = entry.client_id.as_deref()?;
    let response = http
        .post(token_endpoint)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ])
        .send()
        .ok()?
        .error_for_status()
        .ok()?
        .json::<TokenResponse>()
        .ok()?;
    (!response.access_token.is_empty()).then(|| RefreshedTokens {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: response.expires_in.map(expiry),
    })
}

fn expiry(seconds: u64) -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_add(seconds) as i64
}

pub(crate) fn wait_for_callback(
    listener: &TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<Callback, FlowError> {
    listener
        .set_nonblocking(true)
        .map_err(|_| FlowError::Server)?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(FlowError::Timeout);
                }
                let socket_timeout = remaining.min(CALLBACK_REQUEST_TIMEOUT);
                stream
                    .set_read_timeout(Some(socket_timeout))
                    .map_err(|_| FlowError::Server)?;
                stream
                    .set_write_timeout(Some(socket_timeout))
                    .map_err(|_| FlowError::Server)?;
                match read_callback(&mut stream, expected_state) {
                    Ok(Some(callback)) => return Ok(callback),
                    Ok(None) => {}
                    Err(FlowError::InvalidClient) => return Err(FlowError::InvalidClient),
                    Err(FlowError::Timeout | FlowError::Server) => {}
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return Err(FlowError::Server),
        }
    }
    Err(FlowError::Timeout)
}

fn read_callback(
    stream: &mut TcpStream,
    expected_state: &str,
) -> Result<Option<Callback>, FlowError> {
    let mut request = [0u8; 8192];
    let size = stream.read(&mut request).map_err(|_| FlowError::Server)?;
    let request = String::from_utf8_lossy(&request[..size]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or(FlowError::Server)?;
    let url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| FlowError::Server)?;
    if url.path() != "/callback" {
        respond(stream, 404, "요청을 찾을 수 없습니다.");
        return Ok(None);
    }
    let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    if params.get("state").map(String::as_str) != Some(expected_state) {
        respond(stream, 400, "로그인을 확인할 수 없습니다.");
        return Ok(None);
    }
    if let Some(error) = params.get("error") {
        respond(stream, 400, "로그인에 실패했습니다.");
        return if matches!(error.as_str(), "invalid_client" | "unauthorized_client") {
            Err(FlowError::InvalidClient)
        } else {
            Err(FlowError::Server)
        };
    }
    if let Some(code) = params.get("code").filter(|code| !code.is_empty()) {
        respond(stream, 200, "로그인했습니다. 이 창을 닫아도 됩니다.");
        return Ok(Some(Callback::Code(code.clone())));
    }
    respond(stream, 400, "로그인을 마치지 않았습니다.");
    Ok(None)
}

fn respond(stream: &mut TcpStream, status: u16, message: &str) {
    let body =
        format!("<!doctype html><html><meta charset=\"utf-8\"><body>{message}</body></html>");
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        if status == 200 {
            "OK"
        } else if status == 404 {
            "Not Found"
        } else {
            "Bad Request"
        },
        body.len()
    );
    let _ = stream.flush();
}
