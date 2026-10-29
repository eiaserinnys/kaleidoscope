use std::io::{BufRead, BufReader};
use std::sync::OnceLock;
use std::time::Duration;

use kaleidoscope_contract::registry::{
    device_agent_attachment_path, device_agent_messages_path, device_agent_path,
    device_connection_request_path, AgentAttachmentReply, AgentCreateRequest, AgentSendRequest,
    ConnectionReply, ConnectionRequest, DeviceAgentReply, DeviceEvent, DeviceLayout,
    DeviceUploadRequest, PairPollReply, PairPollRequest, PairStartReply, PairStartRequest,
    RegistryApp, DEVICE_APPS_PATH, DEVICE_EVENTS_PATH, DEVICE_LAYOUT_PATH, PAIR_POLL_PATH,
    PAIR_START_PATH,
};
use kaleidoscope_contract::CoreError;

#[derive(Debug, Clone)]
pub(crate) enum RegistryError {
    Unauthorized,
    NotFound,
    Validation(CoreError),
    Failure(String),
}

pub(crate) trait RegistryClient: Send + Sync + 'static {
    fn connection_request(
        &self,
        server_url: &str,
        token: &str,
        name: &str,
        request: &ConnectionRequest,
    ) -> Result<ConnectionReply, RegistryError>;
    fn pair_start(
        &self,
        server_url: &str,
        request: &PairStartRequest,
    ) -> Result<PairStartReply, RegistryError>;

    fn pair_poll(
        &self,
        server_url: &str,
        request: &PairPollRequest,
    ) -> Result<PairPollReply, RegistryError>;

    fn upload(
        &self,
        server_url: &str,
        token: &str,
        request: &DeviceUploadRequest,
    ) -> Result<RegistryApp, RegistryError>;

    fn agent_get(
        &self,
        server_url: &str,
        token: &str,
        workspace_id: &str,
    ) -> Result<DeviceAgentReply, RegistryError>;

    fn agent_create(
        &self,
        server_url: &str,
        token: &str,
        workspace_id: &str,
        request: &AgentCreateRequest,
    ) -> Result<kaleidoscope_contract::AgentInfo, RegistryError>;

    fn agent_send(
        &self,
        server_url: &str,
        token: &str,
        workspace_id: &str,
        request: &AgentSendRequest,
    ) -> Result<(), RegistryError>;

    fn agent_attachment(
        &self,
        server_url: &str,
        token: &str,
        workspace_id: &str,
        item_id: &str,
        index: u32,
    ) -> Result<AgentAttachmentReply, RegistryError>;

    fn put_layout(
        &self,
        server_url: &str,
        token: &str,
        layout: &DeviceLayout,
    ) -> Result<(), RegistryError>;

    fn open_events(
        &self,
        server_url: &str,
        token: &str,
    ) -> Result<Box<dyn BufRead + Send>, RegistryError>;
}

pub(crate) struct HttpRegistryClient {
    requests: OnceLock<Result<reqwest::blocking::Client, RegistryError>>,
    events: OnceLock<Result<reqwest::blocking::Client, RegistryError>>,
}

impl HttpRegistryClient {
    pub(crate) fn new() -> Self {
        Self {
            requests: OnceLock::new(),
            events: OnceLock::new(),
        }
    }

    fn requests(&self) -> Result<&reqwest::blocking::Client, RegistryError> {
        self.requests
            .get_or_init(|| {
                reqwest::blocking::Client::builder()
                    .connect_timeout(Duration::from_secs(10))
                    .timeout(Duration::from_secs(15))
                    .build()
                    .map_err(|error| RegistryError::Failure(error.to_string()))
            })
            .as_ref()
            .map_err(Clone::clone)
    }

    fn events(&self) -> Result<&reqwest::blocking::Client, RegistryError> {
        self.events
            .get_or_init(|| {
                reqwest::blocking::Client::builder()
                    .connect_timeout(Duration::from_secs(10))
                    .timeout(Duration::from_secs(
                        kaleidoscope_contract::registry::STREAM_IDLE_TIMEOUT_SECS,
                    ))
                    .build()
                    .map_err(|error| RegistryError::Failure(error.to_string()))
            })
            .as_ref()
            .map_err(Clone::clone)
    }
}

impl RegistryClient for HttpRegistryClient {
    fn connection_request(
        &self,
        server_url: &str,
        token: &str,
        name: &str,
        request: &ConnectionRequest,
    ) -> Result<ConnectionReply, RegistryError> {
        let response = self
            .requests()?
            .post(format!(
                "{server_url}{}",
                device_connection_request_path(name)
            ))
            .bearer_auth(token)
            .timeout(Duration::from_secs(
                kaleidoscope_contract::data::CONNECTION_TIMEOUT_SECS,
            ))
            .json(request)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        success_json(response)
    }
    fn pair_start(
        &self,
        server_url: &str,
        request: &PairStartRequest,
    ) -> Result<PairStartReply, RegistryError> {
        let response = self
            .requests()?
            .post(format!("{server_url}{PAIR_START_PATH}"))
            .json(request)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        success_json(response)
    }

    fn pair_poll(
        &self,
        server_url: &str,
        request: &PairPollRequest,
    ) -> Result<PairPollReply, RegistryError> {
        let response = self
            .requests()?
            .post(format!("{server_url}{PAIR_POLL_PATH}"))
            .json(request)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        success_json(response)
    }

    fn upload(
        &self,
        server_url: &str,
        token: &str,
        request: &DeviceUploadRequest,
    ) -> Result<RegistryApp, RegistryError> {
        let response = self
            .requests()?
            .post(format!("{server_url}{DEVICE_APPS_PATH}"))
            .bearer_auth(token)
            .json(request)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        success_json(response)
    }

    fn agent_get(
        &self,
        server_url: &str,
        token: &str,
        workspace_id: &str,
    ) -> Result<DeviceAgentReply, RegistryError> {
        let response = self
            .requests()?
            .get(format!("{server_url}{}", device_agent_path(workspace_id)))
            .bearer_auth(token)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        agent_success_json(response)
    }

    fn agent_create(
        &self,
        server_url: &str,
        token: &str,
        workspace_id: &str,
        request: &AgentCreateRequest,
    ) -> Result<kaleidoscope_contract::AgentInfo, RegistryError> {
        let response = self
            .requests()?
            .post(format!("{server_url}{}", device_agent_path(workspace_id)))
            .bearer_auth(token)
            .timeout(Duration::from_secs(
                kaleidoscope_contract::registry::AGENT_CREATE_TIMEOUT_SECS,
            ))
            .json(request)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        agent_success_json(response)
    }

    fn agent_send(
        &self,
        server_url: &str,
        token: &str,
        workspace_id: &str,
        request: &AgentSendRequest,
    ) -> Result<(), RegistryError> {
        let response = self
            .requests()?
            .post(format!(
                "{server_url}{}",
                device_agent_messages_path(workspace_id)
            ))
            .bearer_auth(token)
            .timeout(Duration::from_secs(
                kaleidoscope_contract::registry::AGENT_SEND_TIMEOUT_SECS,
            ))
            .json(request)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        agent_success_json::<serde_json::Value>(response).map(|_| ())
    }

    fn agent_attachment(
        &self,
        server_url: &str,
        token: &str,
        workspace_id: &str,
        item_id: &str,
        index: u32,
    ) -> Result<AgentAttachmentReply, RegistryError> {
        let response = self
            .requests()?
            .get(format!(
                "{server_url}{}",
                device_agent_attachment_path(workspace_id, item_id, index)
            ))
            .bearer_auth(token)
            .timeout(Duration::from_secs(
                kaleidoscope_contract::registry::AGENT_SEND_TIMEOUT_SECS,
            ))
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        agent_success_json(response)
    }

    fn put_layout(
        &self,
        server_url: &str,
        token: &str,
        layout: &DeviceLayout,
    ) -> Result<(), RegistryError> {
        let response = self
            .requests()?
            .put(format!("{server_url}{DEVICE_LAYOUT_PATH}"))
            .bearer_auth(token)
            .json(layout)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.bytes().unwrap_or_default();
            check_status(status, &body)?;
        }
        Ok(())
    }

    fn open_events(
        &self,
        server_url: &str,
        token: &str,
    ) -> Result<Box<dyn BufRead + Send>, RegistryError> {
        let response = self
            .events()?
            .get(format!("{server_url}{DEVICE_EVENTS_PATH}"))
            .header(
                kaleidoscope_contract::registry::SUPPORTED_HEADER,
                serde_json::to_string(&kaleidoscope_contract::Supported::current())
                    .expect("supported 직렬화"),
            )
            .bearer_auth(token)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        check_status(response.status(), &[])?;
        Ok(Box::new(BufReader::new(response)))
    }
}

fn success_json<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, RegistryError> {
    let status = response.status();
    if status.is_success() {
        return response
            .json()
            .map_err(|error| RegistryError::Failure(error.to_string()));
    }

    let body = response.bytes().unwrap_or_default();
    check_status(status, &body)?;
    Err(RegistryError::Failure(format!("HTTP {status}")))
}

fn agent_success_json<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, RegistryError> {
    let status = response.status();
    if status.is_success() {
        return response
            .json()
            .map_err(|error| RegistryError::Failure(error.to_string()));
    }

    let body = response.bytes().unwrap_or_default();
    check_agent_status(status, &body)?;
    Err(RegistryError::Failure(format!("HTTP {status}")))
}

fn check_status(status: reqwest::StatusCode, body: &[u8]) -> Result<(), RegistryError> {
    if status.is_success() {
        return Ok(());
    }
    match status.as_u16() {
        401 => Err(RegistryError::Unauthorized),
        404 => Err(RegistryError::NotFound),
        400 => match serde_json::from_slice::<CoreError>(body) {
            Ok(error) => Err(RegistryError::Validation(error)),
            Err(_) => Err(RegistryError::Failure(
                "서버 검사 오류를 읽을 수 없습니다".into(),
            )),
        },
        _ => Err(RegistryError::Failure(format!("HTTP {status}"))),
    }
}

pub(crate) fn parse_event_line(line: &str) -> Option<DeviceEvent> {
    let json = line.strip_prefix("data: ")?;
    let mut value: serde_json::Value = serde_json::from_str(json).ok()?;
    match value.get("event").and_then(|event| event.as_str()) {
        Some("apps.snapshot") => {
            let apps = value.get_mut("apps")?.as_array_mut()?;
            apps.retain(
                |app| match serde_json::from_value::<RegistryApp>(app.clone()) {
                    Ok(_) => true,
                    Err(error) => {
                        eprintln!("레지스트리 앱을 읽지 못해 건너뜁니다: {error}");
                        false
                    }
                },
            );
        }
        Some("app.published") => {
            if let Err(error) = serde_json::from_value::<RegistryApp>(value.get("app")?.clone()) {
                eprintln!("레지스트리 앱을 읽지 못해 건너뜁니다: {error}");
                return None;
            }
        }
        _ => {}
    }
    serde_json::from_value(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regression_successful_event_stream_status_is_accepted() {
        assert!(check_status(reqwest::StatusCode::OK, &[]).is_ok());
    }

    #[test]
    fn agent_404_preserves_core_error_but_unstructured_route_miss_is_failure() {
        let error = CoreError::new(kaleidoscope_contract::ErrorCode::NotFound);
        let body = serde_json::to_vec(&error).unwrap();
        assert!(matches!(
            check_agent_status(reqwest::StatusCode::NOT_FOUND, &body),
            Err(RegistryError::Validation(actual)) if actual == error
        ));
        let error = CoreError {
            code: kaleidoscope_contract::ErrorCode::InvalidRequest,
            message: "bad request".into(),
            details: vec!["detail".into()],
        };
        let body = serde_json::to_vec(&error).unwrap();
        assert!(matches!(
            check_agent_status(reqwest::StatusCode::BAD_REQUEST, &body),
            Err(RegistryError::Validation(actual)) if actual == error
        ));
        assert!(matches!(
            check_agent_status(reqwest::StatusCode::NOT_FOUND, b"not found"),
            Err(RegistryError::Failure(_))
        ));
    }
}

fn check_agent_status(status: reqwest::StatusCode, body: &[u8]) -> Result<(), RegistryError> {
    if status.as_u16() == 404 {
        return match serde_json::from_slice::<CoreError>(body) {
            Ok(error) => Err(RegistryError::Validation(error)),
            Err(_) => Err(RegistryError::Failure(format!("HTTP {status}"))),
        };
    }
    check_status(status, body)
}

#[cfg(test)]
mod version_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn events_send_supported_header() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let (mut conn, _) = server.accept().unwrap();
            let mut bytes = [0; 8192];
            let size = conn.read(&mut bytes).unwrap();
            conn.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
            String::from_utf8(bytes[..size].to_vec()).unwrap()
        });
        HttpRegistryClient::new()
            .open_events(&format!("http://{addr}"), "token")
            .unwrap();
        let request = worker.join().unwrap().to_lowercase();
        let value = serde_json::to_string(&kaleidoscope_contract::Supported::current())
            .unwrap()
            .to_lowercase();
        assert!(request.contains(&format!(
            "{}: {}",
            kaleidoscope_contract::registry::SUPPORTED_HEADER.to_lowercase(),
            value
        )));
    }

    #[test]
    fn snapshot_keeps_readable_apps_when_another_definition_is_unknown() {
        let definition: serde_json::Value =
            serde_json::from_str(include_str!("../../../examples/md-editor.json")).unwrap();
        let app = serde_json::json!({"app":{"id":"md-editor","name":"editor","current_version":1,"created_at":"now","updated_at":"now"},"version":{"app_id":"md-editor","version":1,"definition":definition,"created_at":"now"}});
        let mut bad = app.clone();
        bad["version"]["definition"]["ui"] = serde_json::json!({"type":"future_block"});
        let line = format!(
            "data: {}",
            serde_json::json!({"event":"apps.snapshot","apps":[bad, app]})
        );
        assert!(
            matches!(parse_event_line(&line), Some(DeviceEvent::AppsSnapshot { apps }) if apps.len() == 1)
        );
    }
}
