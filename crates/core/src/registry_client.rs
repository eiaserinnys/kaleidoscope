// 기존 레지스트리 HTTP 계약과 오류 처리를 한곳에서 유지한다. 후속 작업에서 요청별로 분리한다.
use std::io::{BufRead, BufReader};
use std::sync::OnceLock;
use std::time::Duration;

use kaleidoscope_contract::app_storage::{
    StorageConflict, StorageListReply, StorageReadReply, StorageResetReply, StorageResetRequest,
    StorageWriteReply, StorageWriteRequest,
};
use kaleidoscope_contract::registry::{
    device_connection_request_path, ConnectionReply, ConnectionRequest, DeviceEvent, DeviceLayout,
    DeviceUploadRequest, LayoutChanges, PairPollReply, PairPollRequest, PairStartReply,
    PairStartRequest, RegistryApp, ShareUpload, DEVICE_APPS_PATH, DEVICE_EVENTS_PATH,
    DEVICE_LAYOUT_CHANGES_PATH, DEVICE_LAYOUT_PATH, DEVICE_SHARES_PATH, PAIR_POLL_PATH,
    PAIR_START_PATH, REGISTRY_HEADER, REGISTRY_VERSION,
};
use kaleidoscope_contract::{CoreError, ErrorCode};

#[derive(Debug, Clone)]
pub(crate) enum RegistryError {
    Unauthorized,
    NotFound,
    Validation(CoreError),
    Failure(String),
}

pub(crate) trait RegistryClient: Send + Sync + 'static {
    fn storage_list(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _workspace: &str,
    ) -> Result<StorageListReply, RegistryError> {
        Err(RegistryError::Failure("storage unavailable".into()))
    }
    fn storage_get(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _entry: &str,
        _workspace: &str,
    ) -> Result<StorageReadReply, RegistryError> {
        Err(RegistryError::Failure("storage unavailable".into()))
    }
    fn storage_write(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _entry: &str,
        _workspace: &str,
        _request: &StorageWriteRequest,
    ) -> Result<StorageWriteReply, RegistryError> {
        Err(RegistryError::Failure("storage unavailable".into()))
    }
    fn storage_reset(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _entry: &str,
        _workspace: &str,
        _request: &StorageResetRequest,
    ) -> Result<StorageResetReply, RegistryError> {
        Err(RegistryError::Failure("storage unavailable".into()))
    }
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

    fn put_layout(
        &self,
        server_url: &str,
        token: &str,
        layout: &DeviceLayout,
    ) -> Result<(), RegistryError>;

    fn put_share(
        &self,
        server_url: &str,
        token: &str,
        window_id: &str,
        share: &ShareUpload,
    ) -> Result<(), RegistryError>;

    fn delete_share(
        &self,
        server_url: &str,
        token: &str,
        window_id: &str,
    ) -> Result<(), RegistryError>;

    fn push_layout_changes(
        &self,
        server_url: &str,
        token: &str,
        changes: &LayoutChanges,
    ) -> Result<LayoutChanges, RegistryError>;

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
    fn storage_list(
        &self,
        url: &str,
        token: &str,
        app: &str,
        workspace: &str,
    ) -> Result<StorageListReply, RegistryError> {
        let path = kaleidoscope_contract::registry::device_app_storage_items_path(app);
        let response = self
            .requests()?
            .get(format!("{url}{path}"))
            .bearer_auth(token)
            .query(&[("workspace_id", workspace)])
            .send()
            .map_err(|e| RegistryError::Failure(e.to_string()))?;
        storage_success_json(response)
    }
    fn storage_get(
        &self,
        url: &str,
        token: &str,
        app: &str,
        entry: &str,
        workspace: &str,
    ) -> Result<StorageReadReply, RegistryError> {
        let path = kaleidoscope_contract::registry::device_app_storage_item_path(app, entry);
        let response = self
            .requests()?
            .get(format!("{url}{path}"))
            .bearer_auth(token)
            .query(&[("workspace_id", workspace)])
            .send()
            .map_err(|e| RegistryError::Failure(e.to_string()))?;
        storage_success_json(response)
    }
    fn storage_write(
        &self,
        url: &str,
        token: &str,
        app: &str,
        entry: &str,
        workspace: &str,
        request: &StorageWriteRequest,
    ) -> Result<StorageWriteReply, RegistryError> {
        let path = kaleidoscope_contract::registry::device_app_storage_item_path(app, entry);
        let response = self
            .requests()?
            .put(format!("{url}{path}"))
            .bearer_auth(token)
            .query(&[("workspace_id", workspace)])
            .json(request)
            .send()
            .map_err(|e| RegistryError::Failure(e.to_string()))?;
        storage_success_json(response)
    }
    fn storage_reset(
        &self,
        url: &str,
        token: &str,
        app: &str,
        entry: &str,
        workspace: &str,
        request: &StorageResetRequest,
    ) -> Result<StorageResetReply, RegistryError> {
        let path = kaleidoscope_contract::registry::device_app_storage_item_path(app, entry);
        let response = self
            .requests()?
            .delete(format!("{url}{path}"))
            .bearer_auth(token)
            .query(&[("workspace_id", workspace)])
            .json(request)
            .send()
            .map_err(|e| RegistryError::Failure(e.to_string()))?;
        storage_success_json(response)
    }
    fn push_layout_changes(
        &self,
        server_url: &str,
        token: &str,
        changes: &LayoutChanges,
    ) -> Result<LayoutChanges, RegistryError> {
        let response = self
            .requests()?
            .post(format!("{server_url}{DEVICE_LAYOUT_CHANGES_PATH}"))
            .bearer_auth(token)
            .json(changes)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        let status = response.status();
        if status.as_u16() == 404 {
            return Err(RegistryError::Failure(format!("HTTP {status}")));
        }
        success_json(response)
    }
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

    fn put_share(
        &self,
        server_url: &str,
        token: &str,
        window_id: &str,
        share: &ShareUpload,
    ) -> Result<(), RegistryError> {
        let response = self
            .requests()?
            .put(format!("{server_url}{DEVICE_SHARES_PATH}/{window_id}"))
            .bearer_auth(token)
            .json(share)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        check_status(response.status(), &response.bytes().unwrap_or_default())
    }

    fn delete_share(
        &self,
        server_url: &str,
        token: &str,
        window_id: &str,
    ) -> Result<(), RegistryError> {
        let response = self
            .requests()?
            .delete(format!("{server_url}{DEVICE_SHARES_PATH}/{window_id}"))
            .bearer_auth(token)
            .send()
            .map_err(|error| RegistryError::Failure(error.to_string()))?;
        check_status(response.status(), &response.bytes().unwrap_or_default())
    }

    fn open_events(
        &self,
        server_url: &str,
        token: &str,
    ) -> Result<Box<dyn BufRead + Send>, RegistryError> {
        let response = self
            .events()?
            .get(format!("{server_url}{DEVICE_EVENTS_PATH}"))
            .header(REGISTRY_HEADER, REGISTRY_VERSION.to_string())
            .header(
                kaleidoscope_contract::registry::SUPPORTED_HEADER,
                serde_json::to_string(&crate::supported()).expect("supported 직렬화"),
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

fn storage_success_json<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, RegistryError> {
    let status = response.status();
    if status.is_success() {
        return response
            .json()
            .map_err(|e| RegistryError::Failure(e.to_string()));
    }
    let body = response.bytes().unwrap_or_default();
    if status.as_u16() == 409 {
        let conflict: StorageConflict =
            serde_json::from_slice(&body).map_err(|e| RegistryError::Failure(e.to_string()))?;
        return Err(RegistryError::Validation(CoreError {
            code: ErrorCode::Conflict,
            message: "저장 항목이 읽은 뒤 바뀌었습니다.".into(),
            details: vec![format!(
                "current_revision={}",
                conflict.current_revision.as_deref().unwrap_or("null")
            )],
        }));
    }
    if status.as_u16() == 404 {
        return Err(match serde_json::from_slice::<CoreError>(&body) {
            Ok(error) => RegistryError::Validation(error),
            Err(_) => RegistryError::Validation(CoreError::new(ErrorCode::Unavailable)),
        });
    }
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
}

#[cfg(test)]
#[path = "registry_client_tests.rs"]
mod version_tests;
