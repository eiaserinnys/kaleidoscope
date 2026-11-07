// 기존 레지스트리 HTTP 계약과 오류 처리를 한곳에서 유지한다. 후속 작업에서 요청별로 분리한다.
use std::io::{BufRead, BufReader};
use std::sync::OnceLock;
use std::time::Duration;

use kaleidoscope_contract::app_storage::{
    AppValueRead, CollectionListReply, CollectionMove, CollectionMoveReply, StorageConflict,
    StorageListReply, StorageReadReply, StorageResetReply, StorageResetRequest, StorageWriteReply,
    StorageWriteRequest,
};
use kaleidoscope_contract::registry::{
    device_connection_request_path, ConnectionReply, ConnectionRequest, DeviceEvent, DeviceLayout,
    DeviceUploadRequest, LayoutChanges, PairPollReply, PairPollRequest, PairStartReply,
    PairStartRequest, RegistryApp, ShareUpload, DEVICE_APPS_PATH, DEVICE_EVENTS_PATH,
    DEVICE_LAYOUT_CHANGES_PATH, DEVICE_LAYOUT_PATH, DEVICE_SHARES_PATH, PAIR_POLL_PATH,
    PAIR_START_PATH, REGISTRY_HEADER, REGISTRY_VERSION,
};
use kaleidoscope_contract::{errors, CoreError};

fn raw_app_value_item_url(url: &str, app: &str, key: &str) -> Result<reqwest::Url, RegistryError> {
    let base = format!("{}/api/device/app-values/{app}/", url.trim_end_matches('/'));
    let mut address = reqwest::Url::parse(&base).map_err(|_| {
        RegistryError::failure(
            FailureStage::Send,
            "앱 저장소 서버 주소가 올바르지 않습니다",
        )
    })?;
    address
        .path_segments_mut()
        .map_err(|_| {
            RegistryError::failure(FailureStage::Send, "앱 저장소 주소를 만들 수 없습니다.")
        })?
        .pop_if_empty()
        .extend(key.split('/'));
    Ok(address)
}

#[derive(Debug, Clone)]
pub(crate) enum RegistryError {
    Unauthorized,
    NotFound,
    Validation(CoreError),
    Failure { stage: FailureStage, detail: String, http: Option<HttpFailure> },
}

#[derive(Debug, Clone)]
pub(crate) struct HttpFailure {
    pub(crate) status: u16,
    pub(crate) request_bytes: usize,
    pub(crate) host: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FailureStage {
    Send,
    Status,
    Read,
}

impl RegistryError {
    pub(crate) fn failure(stage: FailureStage, detail: impl Into<String>) -> Self {
        Self::Failure {
            stage,
            detail: detail.into(),
            http: None,
        }
    }
}

pub(crate) struct AssetDownload {
    pub(crate) bytes: Vec<u8>,
    pub(crate) sha256: String,
    pub(crate) mime: String,
}

pub(crate) struct CommentRequest<'a> {
    pub(crate) method: reqwest::Method,
    pub(crate) app_id: &'a str,
    pub(crate) id: Option<&'a str>,
    pub(crate) suffix: Option<&'a str>,
    pub(crate) cursor: Option<&'a str>,
    pub(crate) body: Option<serde_json::Value>,
}

pub(crate) trait RegistryClient: Send + Sync + 'static {
    fn app_comments_request(&self, _url: &str, _token: &str, _request: &CommentRequest<'_>) -> Result<Vec<u8>, RegistryError> {
        Err(RegistryError::failure(FailureStage::Send, "커멘트 서버를 사용할 수 없습니다"))
    }
    fn install_store_app(&self, _url: &str, _token: &str, _request: &kaleidoscope_contract::store::DeviceInstallRequest) -> Result<kaleidoscope_contract::store::DeviceInstallReply, RegistryError> {
        Err(RegistryError::failure(FailureStage::Send, "앱 설치를 사용할 수 없습니다"))
    }
    fn remove_store_app(&self, _url: &str, _token: &str, _id: &str, _request: &kaleidoscope_contract::store::DeviceRemoveRequest) -> Result<(), RegistryError> {
        Err(RegistryError::failure(FailureStage::Send, "앱 삭제를 사용할 수 없습니다"))
    }
    fn post_preferences(
        &self,
        _url: &str,
        _token: &str,
        _operation: &str,
        _body: &serde_json::Value,
    ) -> Result<kaleidoscope_contract::preferences::AccountPreferences, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "preferences unavailable",
        ))
    }
    fn post_window_control_response(
        &self,
        server_url: &str,
        token: &str,
        response: &kaleidoscope_contract::WindowControlResponse,
    ) -> Result<(), RegistryError>;
    fn invoke_worker(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _request: &kaleidoscope_contract::worker::WorkerInvokeRequest,
    ) -> Result<kaleidoscope_contract::worker::WorkerInvokeReply, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "worker unavailable",
        ))
    }
    fn values_list(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
    ) -> Result<kaleidoscope_contract::app_storage::AppValueList, RegistryError> {
        Err(RegistryError::NotFound)
    }
    fn values_get(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _key: &str,
    ) -> Result<kaleidoscope_contract::app_storage::AppValueRead, RegistryError> {
        Err(RegistryError::NotFound)
    }
    fn values_write(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _key: &str,
        _request: &kaleidoscope_contract::app_storage::AppValueWrite,
    ) -> Result<StorageWriteReply, RegistryError> {
        Err(RegistryError::NotFound)
    }
    fn values_reset(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _key: &str,
        _request: &StorageResetRequest,
    ) -> Result<StorageResetReply, RegistryError> {
        Err(RegistryError::NotFound)
    }
    fn values_collection_list(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _prefix: &str,
        _workspace: Option<&str>,
    ) -> Result<CollectionListReply, RegistryError> {
        Err(RegistryError::NotFound)
    }
    fn values_collection_read(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _key: &str,
        _workspace: Option<&str>,
    ) -> Result<AppValueRead, RegistryError> {
        Err(RegistryError::NotFound)
    }
    fn values_collection_reset(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _key: &str,
        _workspace: Option<&str>,
        _request: &StorageResetRequest,
    ) -> Result<StorageResetReply, RegistryError> {
        Err(RegistryError::NotFound)
    }
    fn values_collection_move(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _request: &kaleidoscope_contract::app_storage::AppValueMoveRequest,
        _workspace: Option<&str>,
    ) -> Result<CollectionMoveReply, RegistryError> {
        Err(RegistryError::NotFound)
    }
    fn asset_get(
        &self,
        _url: &str,
        _token: &str,
        _id: &str,
        _version: u32,
    ) -> Result<AssetDownload, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "asset unavailable",
        ))
    }
    fn storage_list(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _workspace: &str,
    ) -> Result<StorageListReply, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "storage unavailable",
        ))
    }
    fn storage_get(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _entry: &str,
        _workspace: &str,
    ) -> Result<StorageReadReply, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "storage unavailable",
        ))
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
        Err(RegistryError::failure(
            FailureStage::Send,
            "storage unavailable",
        ))
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
        Err(RegistryError::failure(
            FailureStage::Send,
            "storage unavailable",
        ))
    }
    fn storage_collection_list(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _entry: &str,
        _workspace: &str,
    ) -> Result<CollectionListReply, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "storage unavailable",
        ))
    }
    fn storage_document_get(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _entry: &str,
        _doc: &str,
        _workspace: &str,
    ) -> Result<StorageReadReply, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "storage unavailable",
        ))
    }
    fn storage_document_write(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _entry: &str,
        _doc: &str,
        _workspace: &str,
        _request: &StorageWriteRequest,
    ) -> Result<StorageWriteReply, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "storage unavailable",
        ))
    }
    fn storage_document_reset(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _entry: &str,
        _doc: &str,
        _workspace: &str,
        _request: &StorageResetRequest,
    ) -> Result<StorageResetReply, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "storage unavailable",
        ))
    }
    fn storage_document_move(
        &self,
        _url: &str,
        _token: &str,
        _app: &str,
        _entry: &str,
        _workspace: &str,
        _request: &CollectionMove,
    ) -> Result<CollectionMoveReply, RegistryError> {
        Err(RegistryError::failure(
            FailureStage::Send,
            "storage unavailable",
        ))
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
                    .map_err(|error| RegistryError::failure(FailureStage::Send, error.to_string()))
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
                    .map_err(|error| RegistryError::failure(FailureStage::Send, error.to_string()))
            })
            .as_ref()
            .map_err(Clone::clone)
    }
}

impl RegistryClient for HttpRegistryClient {
    fn app_comments_request(&self, url: &str, token: &str, request: &CommentRequest<'_>) -> Result<Vec<u8>, RegistryError> {
        let mut address = reqwest::Url::parse(&format!("{}/api/device/app-comments/", url.trim_end_matches('/')))
            .map_err(|error| RegistryError::failure(FailureStage::Send, error.to_string()))?;
        {
            let mut segments = address.path_segments_mut().map_err(|_| RegistryError::failure(FailureStage::Send, "커멘트 서버 주소를 만들 수 없습니다"))?;
            segments.pop_if_empty().push(request.app_id);
            if let Some(id) = request.id { segments.push(id); }
            if let Some(suffix) = request.suffix { segments.push(suffix); }
        }
        if let Some(cursor) = request.cursor { address.query_pairs_mut().append_pair("cursor", cursor); }
        let mut builder = self.requests()?.request(request.method.clone(), address).bearer_auth(token);
        if let Some(body) = &request.body { builder = builder.json(body); }
        let response = builder.send_registry()?;
        let status = response.status();
        let host = response_host(&response);
        let bytes = response.bytes().map_err(response_read_failure)?;
        if status.is_success() { return Ok(bytes.to_vec()); }
        if let Ok(error) = serde_json::from_slice::<CoreError>(&bytes) {
            return Err(RegistryError::Validation(error));
        }
        check_status(status, &bytes, &host)?;
        Err(status_failure(status, &host))
    }
    fn post_preferences(
        &self,
        url: &str,
        token: &str,
        operation: &str,
        body: &serde_json::Value,
    ) -> Result<kaleidoscope_contract::preferences::AccountPreferences, RegistryError> {
        let response = self
            .requests()?
            .post(format!(
                "{}/api/device/preferences/{operation}",
                url.trim_end_matches('/')
            ))
            .bearer_auth(token)
            .json(body)
            .send_registry()?;
        let status = response.status();
        let host = response_host(&response);
        if status.is_success() {
            return response.json().map_err(response_read_failure);
        }
        let bytes = response.bytes().map_err(response_read_failure)?;
        if let Ok(error) = serde_json::from_slice::<CoreError>(&bytes) {
            return Err(RegistryError::Validation(error));
        }
        check_status(status, &bytes, &host)?;
        Err(status_failure(status, &host))
    }
    fn post_window_control_response(
        &self,
        server_url: &str,
        token: &str,
        response: &kaleidoscope_contract::WindowControlResponse,
    ) -> Result<(), RegistryError> {
        let response = self
            .requests()?
            .post(format!(
                "{server_url}{}/{}",
                kaleidoscope_contract::registry::DEVICE_WINDOW_CONTROL_PATH,
                response.request_id
            ))
            .bearer_auth(token)
            .json(response)
            .send_registry()?;
        let host = response_host(&response);
        let status = response.status();
        let body = response.bytes().unwrap_or_default();
        check_status(status, &body, &host)
    }
    fn invoke_worker(
        &self,
        url: &str,
        token: &str,
        app: &str,
        request: &kaleidoscope_contract::worker::WorkerInvokeRequest,
    ) -> Result<kaleidoscope_contract::worker::WorkerInvokeReply, RegistryError> {
        let response = self
            .requests()?
            .post(format!("{url}/api/device/apps/{app}/worker"))
            .bearer_auth(token)
            .timeout(Duration::from_secs(65))
            .json(request)
            .send_registry()?;
        storage_success_json(response)
    }
    fn values_list(
        &self,
        url: &str,
        token: &str,
        app: &str,
    ) -> Result<kaleidoscope_contract::app_storage::AppValueList, RegistryError> {
        let response = self
            .requests()?
            .get(format!(
                "{}/api/device/app-values/{app}",
                url.trim_end_matches('/')
            ))
            .bearer_auth(token)
            .send_registry()?;
        if response.status().as_u16() == 404 {
            return Err(RegistryError::NotFound);
        }
        storage_success_json(response)
    }
    fn values_collection_list(
        &self,
        url: &str,
        token: &str,
        app: &str,
        prefix: &str,
        workspace: Option<&str>,
    ) -> Result<CollectionListReply, RegistryError> {
        let mut request = self
            .requests()?
            .get(format!(
                "{}/api/device/app-values/{app}",
                url.trim_end_matches('/')
            ))
            .bearer_auth(token)
            .query(&[("prefix", prefix)]);
        if let Some(workspace) = workspace {
            request = request.query(&[("workspace_id", workspace)]);
        }
        let response = request.send_registry()?;
        if response.status().as_u16() == 404 {
            return Err(RegistryError::NotFound);
        }
        storage_success_json(response)
    }
    fn values_collection_read(
        &self,
        url: &str,
        token: &str,
        app: &str,
        key: &str,
        workspace: Option<&str>,
    ) -> Result<AppValueRead, RegistryError> {
        let mut request = self
            .requests()?
            .get(raw_app_value_item_url(url, app, key)?)
            .bearer_auth(token);
        if let Some(workspace) = workspace {
            request = request.query(&[("workspace_id", workspace)]);
        }
        let response = request.send_registry()?;
        if response.status().as_u16() == 404 {
            return Err(RegistryError::NotFound);
        }
        storage_success_json(response)
    }
    fn values_collection_reset(
        &self,
        url: &str,
        token: &str,
        app: &str,
        key: &str,
        workspace: Option<&str>,
        request: &StorageResetRequest,
    ) -> Result<StorageResetReply, RegistryError> {
        let mut builder = self
            .requests()?
            .delete(raw_app_value_item_url(url, app, key)?)
            .bearer_auth(token);
        if let Some(workspace) = workspace {
            builder = builder.query(&[("workspace_id", workspace)]);
        }
        let response = builder.json(request).send_registry()?;
        if response.status().as_u16() == 404 {
            return Err(RegistryError::NotFound);
        }
        storage_success_json(response)
    }
    fn values_collection_move(
        &self,
        url: &str,
        token: &str,
        app: &str,
        request: &kaleidoscope_contract::app_storage::AppValueMoveRequest,
        workspace: Option<&str>,
    ) -> Result<CollectionMoveReply, RegistryError> {
        let mut builder = self
            .requests()?
            .post(format!(
                "{}/api/device/app-values/{app}",
                url.trim_end_matches('/')
            ))
            .bearer_auth(token);
        if let Some(workspace) = workspace {
            builder = builder.query(&[("workspace_id", workspace)]);
        }
        let response = builder.json(request).send_registry()?;
        storage_success_json(response)
    }
    fn values_get(
        &self,
        url: &str,
        token: &str,
        app: &str,
        key: &str,
    ) -> Result<kaleidoscope_contract::app_storage::AppValueRead, RegistryError> {
        let response = self
            .requests()?
            .get(raw_app_value_item_url(url, app, key)?)
            .bearer_auth(token)
            .send_registry()?;
        if response.status().as_u16() == 404 {
            return Err(RegistryError::NotFound);
        }
        storage_success_json(response)
    }
    fn values_write(
        &self,
        url: &str,
        token: &str,
        app: &str,
        key: &str,
        request: &kaleidoscope_contract::app_storage::AppValueWrite,
    ) -> Result<StorageWriteReply, RegistryError> {
        let response = self
            .requests()?
            .put(raw_app_value_item_url(url, app, key)?)
            .bearer_auth(token)
            .json(request)
            .send_registry()?;
        if response.status().as_u16() == 404 {
            return Err(RegistryError::NotFound);
        }
        storage_success_json(response)
    }
    fn values_reset(
        &self,
        url: &str,
        token: &str,
        app: &str,
        key: &str,
        request: &StorageResetRequest,
    ) -> Result<StorageResetReply, RegistryError> {
        let response = self
            .requests()?
            .delete(raw_app_value_item_url(url, app, key)?)
            .bearer_auth(token)
            .json(request)
            .send_registry()?;
        if response.status().as_u16() == 404 {
            return Err(RegistryError::NotFound);
        }
        storage_success_json(response)
    }
    fn asset_get(
        &self,
        url: &str,
        token: &str,
        id: &str,
        version: u32,
    ) -> Result<AssetDownload, RegistryError> {
        use sha2::{Digest, Sha256};
        use std::io::Read;
        let address = format!(
            "{}/api/device/assets/{}/{}",
            url.trim_end_matches('/'),
            id,
            version
        );
        let mut response = self
            .requests()?
            .get(address)
            .bearer_auth(token)
            .send_registry()?;
        if !response.status().is_success() {
            return Err(RegistryError::failure(
                FailureStage::Status,
                format!(
                    "HTTP {}; host={}",
                    response.status(),
                    response_host(&response)
                ),
            ));
        }
        let hash = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.trim_matches('"').to_owned())
            .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or_else(|| RegistryError::failure(FailureStage::Read, "자산 해시가 없습니다"))?;
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let size = response.content_length();
        let host = response_host(&response);
        let mut bytes = Vec::new();
        (&mut response)
            .take(kaleidoscope_contract::data::MEDIA_MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| {
                RegistryError::failure(
                    FailureStage::Read,
                    format!("자산 응답을 읽지 못했습니다: {error}; host={host}"),
                )
            })?;
        if bytes.len() as u64 > kaleidoscope_contract::data::MEDIA_MAX_BYTES
            || size.is_some_and(|size| size != bytes.len() as u64)
            || format!("{:x}", Sha256::digest(&bytes)) != hash
        {
            return Err(RegistryError::failure(
                FailureStage::Read,
                "자산 크기 또는 해시가 올바르지 않습니다",
            ));
        }
        Ok(AssetDownload {
            bytes,
            sha256: hash,
            mime,
        })
    }
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
            .send_registry()?;
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
            .send_registry()?;
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
            .send_registry()?;
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
            .send_registry()?;
        storage_success_json(response)
    }
    fn storage_collection_list(
        &self,
        url: &str,
        token: &str,
        app: &str,
        entry: &str,
        workspace: &str,
    ) -> Result<CollectionListReply, RegistryError> {
        let response = self
            .requests()?
            .get(format!(
                "{url}/api/device/app-storage/{app}/collections/{entry}"
            ))
            .bearer_auth(token)
            .query(&[("workspace_id", workspace)])
            .send_registry()?;
        storage_success_json(response)
    }
    fn storage_document_get(
        &self,
        url: &str,
        token: &str,
        app: &str,
        entry: &str,
        doc: &str,
        workspace: &str,
    ) -> Result<StorageReadReply, RegistryError> {
        let response = self
            .requests()?
            .get(format!(
                "{url}/api/device/app-storage/{app}/collections/{entry}/document"
            ))
            .bearer_auth(token)
            .query(&[("workspace_id", workspace), ("doc", doc)])
            .send_registry()?;
        storage_success_json(response)
    }
    fn storage_document_write(
        &self,
        url: &str,
        token: &str,
        app: &str,
        entry: &str,
        doc: &str,
        workspace: &str,
        request: &StorageWriteRequest,
    ) -> Result<StorageWriteReply, RegistryError> {
        let response = self
            .requests()?
            .put(format!(
                "{url}/api/device/app-storage/{app}/collections/{entry}/document"
            ))
            .bearer_auth(token)
            .query(&[("workspace_id", workspace), ("doc", doc)])
            .json(request)
            .send_registry()?;
        storage_success_json(response)
    }
    fn storage_document_reset(
        &self,
        url: &str,
        token: &str,
        app: &str,
        entry: &str,
        doc: &str,
        workspace: &str,
        request: &StorageResetRequest,
    ) -> Result<StorageResetReply, RegistryError> {
        let response = self
            .requests()?
            .delete(format!(
                "{url}/api/device/app-storage/{app}/collections/{entry}/document"
            ))
            .bearer_auth(token)
            .query(&[("workspace_id", workspace), ("doc", doc)])
            .json(request)
            .send_registry()?;
        storage_success_json(response)
    }
    fn storage_document_move(
        &self,
        url: &str,
        token: &str,
        app: &str,
        entry: &str,
        workspace: &str,
        request: &CollectionMove,
    ) -> Result<CollectionMoveReply, RegistryError> {
        let response = self
            .requests()?
            .post(format!(
                "{url}/api/device/app-storage/{app}/collections/{entry}/move"
            ))
            .bearer_auth(token)
            .query(&[("workspace_id", workspace)])
            .json(request)
            .send_registry()?;
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
            .header(REGISTRY_HEADER, REGISTRY_VERSION.to_string())
            .json(changes)
            .send_registry()?;
        let status = response.status();
        if status.as_u16() == 404 {
            return Err(status_failure(status, &response_host(&response)));
        }
        success_json(response)
    }

    fn install_store_app(&self, server_url: &str, token: &str, request: &kaleidoscope_contract::store::DeviceInstallRequest) -> Result<kaleidoscope_contract::store::DeviceInstallReply, RegistryError> {
        let response = self.requests()?.post(format!("{server_url}/api/device/app-installs"))
            .bearer_auth(token).json(request).send_registry()?;
        store_success_json(response)
    }

    fn remove_store_app(&self, server_url: &str, token: &str, id: &str, request: &kaleidoscope_contract::store::DeviceRemoveRequest) -> Result<(), RegistryError> {
        let mut url = reqwest::Url::parse(&format!("{server_url}{DEVICE_APPS_PATH}/"))
            .map_err(|e| RegistryError::failure(FailureStage::Send, e.to_string()))?;
        url.path_segments_mut().map_err(|_| RegistryError::failure(FailureStage::Send, "앱 삭제 주소를 만들 수 없습니다"))?.pop_if_empty().push(id);
        let response = self.requests()?.delete(url).bearer_auth(token).json(request).send_registry()?;
        if response.status().is_success() { return Ok(()); }
        store_failure(response)
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
            .send_registry()?;
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
            .send_registry()?;
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
            .send_registry()?;
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
            .send_registry()?;
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
            .send_registry()?;
        let status = response.status();
        if !status.is_success() {
            let host = response_host(&response);
            let body = response.bytes().unwrap_or_default();
            check_status(status, &body, &host)?;
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
            .send_registry()?;
        let host = response_host(&response);
        let status = response.status();
        let body = response.bytes().unwrap_or_default();
        check_status(status, &body, &host)
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
            .send_registry()?;
        let host = response_host(&response);
        let status = response.status();
        let body = response.bytes().unwrap_or_default();
        check_status(status, &body, &host)
    }

    fn open_events(
        &self,
        server_url: &str,
        token: &str,
    ) -> Result<Box<dyn BufRead + Send>, RegistryError> {
        let registration = self
            .requests()
            .map_err(registration_failure)?
            .post(format!(
                "{server_url}{}",
                kaleidoscope_contract::registry::DEVICE_BUILTIN_SPECS_PATH
            ))
            .bearer_auth(token)
            .json(&crate::builtin::builtin_runtime_specs())
            .send_registry()
            .map_err(registration_failure)?;
        if registration.status().as_u16() == 403 {
            eprintln!("기본 앱 실행 선언은 서버의 주 계정 기기에서만 등록할 수 있습니다.");
        } else if registration.status().as_u16() != 404 {
            let host = response_host(&registration);
            let status = registration.status();
            let body = registration.bytes().unwrap_or_default();
            check_status(status, &body, &host).map_err(registration_failure)?;
        }
        let response = self
            .events()?
            .get(format!("{server_url}{DEVICE_EVENTS_PATH}"))
            .header(REGISTRY_HEADER, REGISTRY_VERSION.to_string())
            .header(
                kaleidoscope_contract::registry::SUPPORTED_HEADER,
                serde_json::to_string(&crate::supported()).expect("supported 직렬화"),
            )
            .bearer_auth(token)
            .send_registry()?;
        let host = response_host(&response);
        check_status(response.status(), &[], &host)?;
        Ok(Box::new(BufReader::new(response)))
    }
}

fn success_json<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, RegistryError> {
    let status = response.status();
    let host = response_host(&response);
    if status.is_success() {
        return response.json().map_err(response_read_failure);
    }

    let body = response.bytes().unwrap_or_default();
    check_status(status, &body, &host)?;
    Err(status_failure(status, &host))
}

fn store_success_json<T: serde::de::DeserializeOwned>(response: reqwest::blocking::Response) -> Result<T, RegistryError> {
    if response.status().is_success() { return response.json().map_err(response_read_failure); }
    store_failure(response)
}

fn store_failure<T>(response: reqwest::blocking::Response) -> Result<T, RegistryError> {
    let status = response.status();
    let host = response_host(&response);
    let body = response.bytes().unwrap_or_default();
    if let Ok(mut error) = serde_json::from_slice::<CoreError>(&body) {
        error.details.push(format!("HTTP {status}; host={host}"));
        return Err(RegistryError::Validation(error));
    }
    check_status(status, &body, &host)?;
    Err(status_failure(status, &host))
}

fn storage_success_json<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, RegistryError> {
    let status = response.status();
    let host = response_host(&response);
    if status.is_success() {
        return response.json().map_err(response_read_failure);
    }
    let body = response.bytes().unwrap_or_default();
    if status.as_u16() == 409 {
        let conflict: StorageConflict = serde_json::from_slice(&body)
            .map_err(|e| RegistryError::failure(FailureStage::Read, e.to_string()))?;
        let current_revision = format!(
            "current_revision={}",
            conflict.current_revision.as_deref().unwrap_or("null")
        );
        let mut error = conflict
            .error
            .unwrap_or_else(kaleidoscope_contract::errors::STORAGE_SERVER_WRITE_CONFLICT);
        error
            .details
            .retain(|detail| !detail.starts_with("current_revision="));
        error.details.push(current_revision);
        return Err(RegistryError::Validation(error));
    }
    if status.as_u16() == 404 {
        return Err(match serde_json::from_slice::<CoreError>(&body) {
            Ok(mut error) => {
                error.details.push(format!("HTTP {status}; host={host}"));
                RegistryError::Validation(error)
            }
            Err(_) => {
                let mut error = errors::CONN_REGISTRY_STORAGE_RESPONSE_INVALID();
                error.details.push(format!("HTTP {status}; host={host}"));
                RegistryError::Validation(error)
            }
        });
    }
    check_status(status, &body, &host)?;
    Err(status_failure(status, &host))
}

fn check_status(status: reqwest::StatusCode, body: &[u8], host: &str) -> Result<(), RegistryError> {
    if status.is_success() {
        return Ok(());
    }
    match status.as_u16() {
        401 => Err(RegistryError::Unauthorized),
        404 => Err(RegistryError::NotFound),
        400 => match serde_json::from_slice::<CoreError>(body) {
            Ok(mut error) => {
                error.details.push(format!("HTTP {status}; host={host}"));
                Err(RegistryError::Validation(error))
            }
            Err(_) => Err(RegistryError::failure(
                FailureStage::Read,
                format!("서버 검사 오류를 읽을 수 없습니다; HTTP {status}; host={host}"),
            )),
        },
        _ => Err(status_failure(status, host)),
    }
}

fn registration_failure(error: RegistryError) -> RegistryError {
    match error {
        RegistryError::Failure { stage, detail, .. } => {
            let error = match stage {
                FailureStage::Send => errors::CONN_BUILTIN_REGISTER_SEND_FAILED(),
                FailureStage::Status => errors::CONN_BUILTIN_REGISTER_STATUS_FAILED(),
                FailureStage::Read => errors::CONN_BUILTIN_REGISTER_READ_FAILED(),
            };
            RegistryError::Validation(error.and_details(vec![detail]))
        }
        other => other,
    }
}

fn request_failure(error: reqwest::Error) -> RegistryError {
    let host = error
        .url()
        .and_then(reqwest::Url::host_str)
        .unwrap_or("알 수 없는 서버")
        .to_owned();
    RegistryError::failure(
        FailureStage::Send,
        format!("요청 전송 실패: {}; host={host}", error.without_url()),
    )
}

fn response_read_failure(error: reqwest::Error) -> RegistryError {
    let host = error
        .url()
        .and_then(reqwest::Url::host_str)
        .unwrap_or("알 수 없는 서버")
        .to_owned();
    RegistryError::failure(
        FailureStage::Read,
        format!(
            "서버 응답을 읽지 못했습니다: {}; host={host}",
            error.without_url()
        ),
    )
}

fn response_host(response: &reqwest::blocking::Response) -> String {
    response
        .url()
        .host_str()
        .unwrap_or("알 수 없는 서버")
        .to_owned()
}

fn status_failure(status: reqwest::StatusCode, host: &str) -> RegistryError {
    RegistryError::failure(FailureStage::Status, format!("HTTP {status}; host={host}"))
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
    fn raw_app_value_item_url_removes_empty_base_path_segment() {
        let address =
            raw_app_value_item_url("http://127.0.0.1:4219/", "md-editor", "documents/a.md")
                .unwrap();

        assert_eq!(
            address.as_str(),
            "http://127.0.0.1:4219/api/device/app-values/md-editor/documents/a.md"
        );
    }

    #[test]
    fn regression_successful_event_stream_status_is_accepted() {
        assert!(check_status(reqwest::StatusCode::OK, &[], "registry.example").is_ok());
    }
}

#[cfg(test)]
#[path = "registry_client_tests.rs"]
mod version_tests;

// 직렬화한 바로 그 본문을 보내고, 프록시의 평문 413과 서버의 등록 오류를 구분한다.
pub(crate) trait SendRegistry {
    fn send_registry(self) -> Result<reqwest::blocking::Response, RegistryError>;
}
impl SendRegistry for reqwest::blocking::RequestBuilder {
    fn send_registry(self) -> Result<reqwest::blocking::Response, RegistryError> {
        let (client, request) = self.build_split();
        let request = request.map_err(request_failure)?;
        let request_bytes = request
            .body()
            .and_then(|body| body.as_bytes())
            .map_or(0, |bytes| bytes.len());
        let response = client.execute(request).map_err(request_failure)?;
        if response.status() != reqwest::StatusCode::PAYLOAD_TOO_LARGE {
            return Ok(response);
        }
        let host = response_host(&response);
        let body = response.bytes().map_err(response_read_failure)?;
        if let Ok(mut error) = serde_json::from_slice::<CoreError>(&body) {
            error.details.push(format!("HTTP 413; host={host}"));
            return Err(RegistryError::Validation(error));
        }
        let size = kaleidoscope_contract::size::format_byte_limit(request_bytes as u64);
        Err(RegistryError::Failure {
            stage: FailureStage::Status,
            detail: format!("요청 {size}가 서버 한도를 넘었습니다(HTTP 413); host={host}"),
            http: Some(HttpFailure {
                status: 413,
                request_bytes,
                host,
            }),
        })
    }
}
