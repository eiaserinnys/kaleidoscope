use std::io::{BufRead, BufReader};
use std::sync::OnceLock;
use std::time::Duration;

use kaleidoscope_contract::registry::{
    device_agent_attachment_path, device_agent_messages_path, device_agent_path,
    AgentAttachmentReply, AgentCreateRequest, AgentSendRequest, DeviceAgentReply, DeviceEvent,
    DeviceLayout, DeviceUploadRequest, PairPollReply, PairPollRequest, PairStartReply,
    PairStartRequest, RegistryApp, DEVICE_APPS_PATH, DEVICE_EVENTS_PATH, DEVICE_LAYOUT_PATH,
    PAIR_POLL_PATH, PAIR_START_PATH,
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
    serde_json::from_str(json).ok()
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
