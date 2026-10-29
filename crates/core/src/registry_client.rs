use std::io::{BufRead, BufReader};
use std::sync::OnceLock;
use std::time::Duration;

use kaleidoscope_contract::registry::{
    DeviceEvent, DeviceUploadRequest, PairPollReply, PairPollRequest, PairStartReply,
    PairStartRequest, RegistryApp, DEVICE_APPS_PATH, DEVICE_EVENTS_PATH, PAIR_POLL_PATH,
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
}
