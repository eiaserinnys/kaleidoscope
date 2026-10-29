use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use kaleidoscope_contract::{data, registry::ConnectionInfo, CoreError, ErrorCode};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

const CALLBACK_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);

use crate::{
    error,
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

fn client() -> Result<Client, CoreError> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(data::CONNECTION_TIMEOUT_SECS))
        .build()
        .map_err(server)
}

fn issuer_for(info: &ConnectionInfo) -> Result<String, CoreError> {
    if let Some(issuer) = &info.issuer {
        return Ok(issuer.trim_end_matches('/').to_string());
    }
    let base = Url::parse(&info.base_url).map_err(server)?;
    Ok(base.origin().ascii_serialization())
}

fn discover(http: &Client, issuer: &str) -> Result<Metadata, CoreError> {
    let url = format!(
        "{}/.well-known/oauth-authorization-server",
        issuer.trim_end_matches('/')
    );
    http.get(url)
        .send()
        .map_err(server)?
        .error_for_status()
        .map_err(server)?
        .json()
        .map_err(server)
}

fn endpoints(metadata: Metadata) -> Result<Endpoints, CoreError> {
    if !metadata
        .code_challenge_methods_supported
        .iter()
        .any(|method| method == "S256")
    {
        return Err(error::make(ErrorCode::Server));
    }
    Ok(Endpoints {
        authorization: Url::parse(&metadata.authorization_endpoint).map_err(server)?,
        token: Url::parse(&metadata.token_endpoint).map_err(server)?,
        registration: Url::parse(&metadata.registration_endpoint).map_err(server)?,
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
    let http = client()?;
    let metadata = discover(&http, &issuer)?;
    let endpoints = endpoints(metadata)?;
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
            listener.local_addr().map_err(server)?.port()
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
        host.open_url(authorization.as_str()).map_err(|error| {
            if error.kind() == std::io::ErrorKind::Unsupported {
                error::make(ErrorCode::Unavailable)
            } else {
                server(error)
            }
        })?;

        let remaining = deadline.saturating_duration_since(Instant::now());
        let callback = match wait_for_callback(&listener, &state, remaining) {
            Ok(callback) => callback,
            Err(FlowError::Timeout) => {
                return Err(error::with_message(
                    ErrorCode::InvalidRequest,
                    "로그인을 마치지 않았습니다",
                ));
            }
            Err(FlowError::InvalidClient) if attempt == 0 => {
                logins.clear_client(&info.name, &issuer);
                continue;
            }
            Err(FlowError::InvalidClient | FlowError::Server) => {
                return Err(error::make(ErrorCode::Server));
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
                    redirect_port: Some(listener.local_addr().map_err(server)?.port()),
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
            Err(ExchangeError::InvalidClient) if attempt == 0 => {
                logins.clear_client(&info.name, &issuer);
            }
            Err(ExchangeError::InvalidClient | ExchangeError::Server) => {
                return Err(error::make(ErrorCode::Server));
            }
        }
    }
    Err(error::make(ErrorCode::Server))
}

fn register(
    http: &Client,
    endpoints: &Endpoints,
    info: &ConnectionInfo,
    device_name: &str,
    issuer: &str,
    logins: &Logins,
) -> Result<(TcpListener, String), CoreError> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(server)?;
    let port = listener.local_addr().map_err(server)?.port();
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
        .map_err(server)?
        .error_for_status()
        .map_err(server)?
        .json::<Value>()
        .map_err(server)?;
    let client_id = response
        .get("client_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| error::make(ErrorCode::Server))?
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
    InvalidClient,
    Server,
}

fn exchange_code(
    http: &Client,
    endpoint: &Url,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> Result<RefreshedTokens, ExchangeError> {
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
        .map_err(|_| ExchangeError::Server)?;
    if !response.status().is_success() {
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
            ExchangeError::InvalidClient
        } else {
            ExchangeError::Server
        });
    }
    let response: TokenResponse = response.json().map_err(|_| ExchangeError::Server)?;
    if response.access_token.is_empty() {
        return Err(ExchangeError::Server);
    }
    Ok(RefreshedTokens {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: response.expires_in.map(expiry),
    })
}

pub(crate) fn refresh_access_token(entry: &LoginEntry) -> Option<RefreshedTokens> {
    let http = client().ok()?;
    let metadata = discover(&http, &entry.issuer).ok()?;
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

fn server(error: impl std::fmt::Display) -> CoreError {
    error::with_message(ErrorCode::Server, &error.to_string())
}
