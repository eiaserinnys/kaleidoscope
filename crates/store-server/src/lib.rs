mod storage;
mod validation;

use axum::{
    body::{to_bytes, Body},
    extract::{DefaultBodyLimit, FromRequest, Multipart, Path, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use kaleidoscope_contract::{errors::store_server as e, CoreError};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};
use tokio::sync::Mutex;
use url::Url;

/// 사설 스토어 초대코드를 담는 요청 헤더 이름.
pub const INVITE_HEADER: &str = "x-kaleidoscope-invite";

/// 색인의 `publish` 선언. 에이전트가 이 스토어에 앱을 어떻게 올리는지 알게 한다.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PublishDeclaration {
    /// 이 서버의 `POST /publish`로 바로 올린다.
    Direct,
    /// 리포에 pull request를 올리면 배포가 색인을 갱신한다.
    PullRequest { url: String },
}

impl PublishDeclaration {
    /// `--publish-pull-request` 값으로 리포 PR 올리기 선언을 만든다.
    /// 사용자 정보, 쿼리, 조각이 없는 https:// 주소만 받는다.
    pub fn pull_request(url: &str) -> Result<Self, CoreError> {
        let parsed = Url::parse(url).map_err(|_| e::STORESERVER_START_PUBLISH_URL_INVALID())?;
        if parsed.scheme() != "https"
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(e::STORESERVER_START_PUBLISH_URL_INVALID());
        }
        Ok(Self::PullRequest {
            url: url.to_owned(),
        })
    }

    /// 색인에 적는 값.
    pub fn value(&self) -> Value {
        match self {
            Self::Direct => json!({"method": "direct", "path": "publish"}),
            Self::PullRequest { url } => json!({"method": "pull_request", "url": url}),
        }
    }
}

#[derive(Clone)]
struct AppState {
    dir: PathBuf,
    publish_lock: Arc<Mutex<()>>,
    invite: Option<String>,
    publish: PublishDeclaration,
}
struct Failure(StatusCode, CoreError);
impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}
type ResultResponse<T> = Result<T, Failure>;

pub fn initialize(dir: &FsPath, declaration: &PublishDeclaration) -> Result<(), CoreError> {
    storage::initialize(dir, declaration)
}
pub fn router(dir: PathBuf) -> Router {
    router_with_invite(dir, None)
}
/// `invite`가 있으면 읽기와 직접 게시 요청에 초대코드 헤더를 요구한다.
pub fn router_with_invite(dir: PathBuf, invite: Option<String>) -> Router {
    router_with_publish(dir, invite, PublishDeclaration::Direct)
}
/// `declaration`은 색인에 적는 올리기 선언이다. `POST /publish`는 선언과 무관하게 초대코드로 계속 받는다.
pub fn router_with_publish(
    dir: PathBuf,
    invite: Option<String>,
    declaration: PublishDeclaration,
) -> Router {
    initialize(&dir, &declaration).expect("스토어 자료 폴더 준비");
    let invite = invite
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let state = AppState {
        dir,
        publish_lock: Arc::new(Mutex::new(())),
        invite,
        publish: declaration,
    };
    Router::new()
        .route("/index.json", get(index))
        .route("/apps/{*path}", get(app_file))
        .route("/publish", post(publish))
        .fallback(not_found)
        .layer(DefaultBodyLimit::disable())
        .with_state(state)
}
fn check_invite(state: &AppState, headers: &HeaderMap) -> Result<(), Failure> {
    let Some(expected) = state.invite.as_deref() else {
        return Ok(());
    };
    let actual = headers
        .get(INVITE_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_ascii_lowercase());
    if actual.as_deref() == Some(expected) {
        Ok(())
    } else {
        Err(Failure(
            StatusCode::FORBIDDEN,
            e::STORESERVER_AUTH_INVITE_INVALID(),
        ))
    }
}
async fn publish(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
) -> ResultResponse<impl IntoResponse> {
    check_invite(&state, &headers)?;
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, 22 * 1024 * 1024).await.map_err(|_| {
        Failure(
            StatusCode::PAYLOAD_TOO_LARGE,
            e::STORESERVER_PUBLISH_BODY_TOO_LARGE(),
        )
    })?;
    let req = Request::from_parts(parts, Body::from(bytes));
    let mut multipart = Multipart::from_request(req, &state).await.map_err(|_| {
        Failure(
            StatusCode::BAD_REQUEST,
            e::STORESERVER_PUBLISH_MULTIPART_INVALID(),
        )
    })?;
    let mut files = BTreeMap::new();
    while let Some(field) = multipart.next_field().await.map_err(|_| {
        Failure(
            StatusCode::BAD_REQUEST,
            e::STORESERVER_PUBLISH_MULTIPART_INVALID(),
        )
    })? {
        let name = field
            .file_name()
            .ok_or_else(|| {
                Failure(
                    StatusCode::BAD_REQUEST,
                    e::STORESERVER_PUBLISH_MULTIPART_INVALID(),
                )
            })?
            .to_string();
        if validation::secret_path(&name) {
            return Err(Failure(
                StatusCode::UNPROCESSABLE_ENTITY,
                e::STORESERVER_PUBLISH_SECRET_DETECTED(),
            ));
        }
        if !validation::safe_path(&name) {
            return Err(Failure(
                StatusCode::BAD_REQUEST,
                e::STORESERVER_PUBLISH_PATH_INVALID(),
            ));
        }
        let bytes = field.bytes().await.map_err(|_| {
            Failure(
                StatusCode::BAD_REQUEST,
                e::STORESERVER_PUBLISH_MULTIPART_INVALID(),
            )
        })?;
        if name == "app.json" && bytes.len() > 1024 * 1024 {
            return Err(Failure(
                StatusCode::PAYLOAD_TOO_LARGE,
                e::STORESERVER_PUBLISH_APP_TOO_LARGE(),
            ));
        }
        if name == "store.json" && bytes.len() > 256 * 1024 {
            return Err(Failure(
                StatusCode::PAYLOAD_TOO_LARGE,
                e::STORESERVER_PUBLISH_METADATA_TOO_LARGE(),
            ));
        }
        if files.insert(name.clone(), bytes.to_vec()).is_some() {
            return Err(Failure(
                StatusCode::BAD_REQUEST,
                e::STORESERVER_PUBLISH_FILE_DUPLICATE(&name),
            ));
        }
    }
    let input = validation::validate(files).map_err(|err| {
        let status = if matches!(
            err.id.as_deref(),
            Some(
                "STORESERVER_PUBLISH_ASSETS_TOO_LARGE" | "STORESERVER_PUBLISH_SCREENSHOT_TOO_LARGE"
            )
        ) {
            StatusCode::PAYLOAD_TOO_LARGE
        } else {
            StatusCode::UNPROCESSABLE_ENTITY
        };
        Failure(status, err)
    })?;
    let _guard = state.publish_lock.lock().await;
    let (unchanged, response) = storage::publish(&state.dir, input, &state.publish)
        .map_err(|err| Failure(StatusCode::INTERNAL_SERVER_ERROR, err))?;
    Ok((
        if unchanged {
            StatusCode::OK
        } else {
            StatusCode::CREATED
        },
        Json(response),
    ))
}
async fn index(State(state): State<AppState>, headers: HeaderMap) -> ResultResponse<Response> {
    check_invite(&state, &headers)?;
    read(&state, "index.json")
}
async fn app_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<String>,
) -> ResultResponse<Response> {
    check_invite(&state, &headers)?;
    if validation::secret_path(&path) {
        return Err(Failure(
            StatusCode::BAD_REQUEST,
            e::STORESERVER_READ_PATH_INVALID(),
        ));
    }
    if !validation::safe_path(&path) {
        return Err(Failure(
            StatusCode::BAD_REQUEST,
            e::STORESERVER_READ_PATH_INVALID(),
        ));
    }
    read(&state, &format!("apps/{path}"))
}
async fn not_found() -> impl IntoResponse {
    Failure(
        StatusCode::NOT_FOUND,
        e::STORESERVER_READ_FILE_NOT_FOUND("요청한 경로"),
    )
}
fn read(state: &AppState, path: &str) -> ResultResponse<Response> {
    let root = std::fs::canonicalize(&state.dir).map_err(|_| {
        Failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            e::STORESERVER_READ_FILE_FAILED(),
        )
    })?;
    let file = state.dir.join(path);
    let actual = std::fs::canonicalize(&file).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            Failure(
                StatusCode::NOT_FOUND,
                e::STORESERVER_READ_FILE_NOT_FOUND(path),
            )
        } else {
            Failure(
                StatusCode::INTERNAL_SERVER_ERROR,
                e::STORESERVER_READ_FILE_FAILED(),
            )
        }
    })?;
    let allowed = if path.starts_with("apps/") {
        root.join("apps")
    } else {
        root
    };
    if !actual.starts_with(&allowed) {
        return Err(Failure(
            StatusCode::BAD_REQUEST,
            e::STORESERVER_READ_PATH_INVALID(),
        ));
    }
    let bytes = std::fs::read(actual).map_err(|_| {
        Failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            e::STORESERVER_READ_FILE_FAILED(),
        )
    })?;
    let mutable =
        path == "index.json" || (path.starts_with("apps/") && path.ends_with("/index.json"));
    let mut format = if path.ends_with(".json") {
        "json".to_string()
    } else if path.ends_with(".png") {
        "png".into()
    } else if path.ends_with(".webp") {
        "webp".into()
    } else {
        String::new()
    };
    let segments: Vec<_> = path.split('/').collect();
    if segments.len() >= 5 && segments[0] == "apps" && segments[3] == "assets" {
        let manifest = state
            .dir
            .join("apps")
            .join(segments[1])
            .join(segments[2])
            .join("manifest.json");
        if let Ok(bytes) = std::fs::read(manifest) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(f) = value["files"][path]["format"].as_str() {
                    format = f.to_string();
                }
            }
        }
    }
    let mime = match format.as_str() {
        "json" => "application/json",
        "html" => "text/html; charset=utf-8",
        "javascript" => "text/javascript; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "webp" => "image/webp",
        "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    };
    let mut response = Response::new(Body::from(bytes));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if mutable {
            "no-cache"
        } else {
            "public, max-age=31536000, immutable"
        }),
    );
    if matches!(format.as_str(), "html" | "javascript") {
        response.headers_mut().insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment"),
        );
    }
    Ok(response)
}
