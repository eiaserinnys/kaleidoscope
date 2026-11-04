use std::convert::Infallible;
use std::env;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use kaleidoscope_contract::{CoreEvent, CoreRequest};
use kaleidoscope_core::{Core, CoreConfig, Host, PcRoot};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::CorsLayer;

const DEV_UI_ORIGIN: &str = "http://localhost:1420";

#[derive(Clone)]
struct AppState {
    core: Arc<Core>,
    events: broadcast::Sender<CoreEvent>,
}

#[derive(Default)]
struct DevHost {
    oauth_open_url_file: Option<PathBuf>,
}

impl Host for DevHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        env::var_os("KALEIDOSCOPE_DEV_PICK").map(PathBuf::from)
    }

    fn pick_files(&self, _: &[kaleidoscope_contract::data::FileAccept], multiple: bool) -> Option<Vec<PathBuf>> {
        let raw = env::var("KALEIDOSCOPE_DEV_PICK_FILES").ok()?;
        let mut paths: Vec<PathBuf> = serde_json::from_str(&raw).ok()?;
        if !multiple { paths.truncate(1); }
        if paths.is_empty() { None } else { Some(paths) }
    }

    fn pick_save_file(&self, _: &str, _: &str) -> Option<PathBuf> {
        env::var_os("KALEIDOSCOPE_DEV_PICK_SAVE_FILE").map(PathBuf::from)
    }

    fn pc_roots(&self) -> Vec<PcRoot> {
        let Some(value) = env::var_os("KALEIDOSCOPE_DEV_PC_ROOTS") else {
            return Vec::new();
        };
        let Ok(serde_json::Value::Array(roots)) =
            serde_json::from_slice(value.to_string_lossy().as_bytes())
        else {
            return Vec::new();
        };
        roots
            .into_iter()
            .filter_map(|root| {
                Some(PcRoot {
                    id: root.get("id")?.as_str()?.into(),
                    kind: serde_json::from_value(root.get("kind")?.clone()).ok()?,
                    name: root.get("name")?.as_str()?.into(),
                    path: root.get("path")?.as_str()?.into(),
                })
            })
            .collect()
    }

    fn open_url(&self, url: &str) -> std::io::Result<()> {
        if let Some(path) = &self.oauth_open_url_file {
            return std::fs::write(path, url);
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "개발용 다리에서는 브라우저를 열 수 없습니다",
        ))
    }
}

#[cfg(test)]
mod host_tests {
    use super::{parse_args, DevHost, Host};

    #[test]
    fn devbridge_picks_the_configured_files() {
        std::env::set_var("KALEIDOSCOPE_DEV_PICK_FILES", r#"["/tmp/sample-a.txt","/tmp/sample-b.txt"]"#);
        let paths = DevHost::default().pick_files(&[], true).unwrap();
        assert_eq!(paths, ["/tmp/sample-a.txt", "/tmp/sample-b.txt"].map(std::path::PathBuf::from));
        assert_eq!(DevHost::default().pick_files(&[], false).unwrap().len(), 1);
        std::env::remove_var("KALEIDOSCOPE_DEV_PICK_FILES");
    }

    #[test]
    fn devbridge_does_not_open_oauth_urls() {
        let error = DevHost::default().open_url("https://auth.example").unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::Unsupported);
    }

    #[test]
    fn configured_oauth_url_is_overwritten_in_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("open-url");
        let args = ["--data-dir", "data", "--port", "1234", "--oauth-open-url-file", path.to_str().unwrap()];
        let parsed = parse_args(args.into_iter().map(Into::into)).unwrap();
        let host = DevHost { oauth_open_url_file: parsed.oauth_open_url_file };
        host.open_url("http://localhost/first").unwrap();
        host.open_url("http://localhost/second").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "http://localhost/second");
    }
}

struct Args {
    data_dir: PathBuf,
    port: u16,
    server: String,
    device_name: String,
    seeds: Vec<PathBuf>,
    oauth_open_url_file: Option<PathBuf>,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args = parse_args(env::args_os().skip(1))?;
    let seed_definitions = args
        .seeds
        .iter()
        .map(|path| {
            std::fs::read_to_string(path).map_err(|error| {
                format!("앱 정의를 읽을 수 없습니다 ({}): {error}", path.display())
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let embedded = kaleidoscope_orchestrator::EmbeddedServer::start(
        kaleidoscope_orchestrator::EmbeddedConfig {
            db_path: args.data_dir.join("local-orchestrator.db"),
            token_path: args.data_dir.join("local-orchestrator.token"),
            device_name: args.device_name.clone(),
        },
    )
    .await?;
    let config = CoreConfig {
        embedded_server: Some(kaleidoscope_core::EmbeddedServerInfo {
            server_url: embedded.server_url.clone(),
            device_id: embedded.device_id.clone(),
            token: embedded.token.clone(),
        }),
        data_dir: args.data_dir,
        seed_definitions,
        server_url: args.server,
        device_name: args.device_name,
    };
    let host = DevHost { oauth_open_url_file: args.oauth_open_url_file };
    let core = Arc::new(
        tokio::task::spawn_blocking(move || Core::open(config, Arc::new(host)))
            .await
            .map_err(|error| format!("코어 시작 태스크가 실패했습니다: {error}"))?
            .map_err(|error| format!("코어를 열 수 없습니다: {}", error.message))?,
    );
    let (events, _) = broadcast::channel(100);
    let event_sender = events.clone();
    core.subscribe(Box::new(move |event| {
        let _ = event_sender.send(event.clone());
    }));
    let state = AppState {
        core: Arc::clone(&core),
        events,
    };
    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static(DEV_UI_ORIGIN))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([
            header::CONTENT_TYPE,
            HeaderName::from_static("x-ks-operation"),
            HeaderName::from_static("x-ks-window"),
            HeaderName::from_static("x-ks-handle"),
            HeaderName::from_static("x-ks-offset"),
        ]);
    let app = Router::new()
        .route("/core", post(post_core))
        .route(
            "/bytes",
            post(post_core_bytes).layer(DefaultBodyLimit::max(
                kaleidoscope_contract::client::CLIENT_PICK_FILE_MAX_BYTES as usize,
            )),
        )
        .layer(DefaultBodyLimit::max(
            kaleidoscope_contract::CONVERSATION_SEND_BODY_MAX_BYTES,
        ))
        .route("/events", get(get_events))
        .with_state(state)
        .layer(cors)
        .layer(middleware::from_fn(restrict_origin));

    let address = format!("127.0.0.1:{}", args.port);
    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .map_err(|error| format!("개발용 HTTP 다리에 바인드할 수 없습니다: {error}"))?;
    eprintln!("개발용 HTTP 다리: http://{address}");
    let shutdown_core = Arc::clone(&core);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            if let Err(error) = tokio::signal::ctrl_c().await {
                eprintln!("종료 신호를 기다릴 수 없습니다: {error}");
            }
            shutdown_core.shutdown();
        })
        .await
        .map_err(|error| format!("개발용 HTTP 다리가 종료됐습니다: {error}"))?;
    core.shutdown();
    Ok(())
}

async fn restrict_origin(request: Request, next: Next) -> Response {
    if request
        .headers()
        .get(header::ORIGIN)
        .is_some_and(|origin| origin.as_bytes() != DEV_UI_ORIGIN.as_bytes())
    {
        return StatusCode::FORBIDDEN.into_response();
    }

    next.run(request).await
}

async fn post_core(State(state): State<AppState>, body: Bytes) -> Response {
    let request = match serde_json::from_slice::<CoreRequest>(&body) {
        Ok(request) => request,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(
                    kaleidoscope_contract::errors::SERVER_DEVBRIDGE_BODY_INVALID()
                        .and_details(vec![error.to_string()]),
                ),
            )
                .into_response();
        }
    };

    let core = state.core.clone();
    match tokio::task::spawn_blocking(move || core.handle(request)).await {
        Ok(Ok(reply)) => (StatusCode::OK, Json(reply)).into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, Json(error)).into_response(),
        Err(join_error) => {
            eprintln!("코어 명령 실행 태스크가 실패했습니다: {join_error}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    kaleidoscope_contract::errors::SERVER_DEVBRIDGE_TASK_FAILED()
                        .and_details(vec![join_error.to_string()]),
                ),
            )
                .into_response()
        }
    }
}

async fn post_core_bytes(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let get = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let Some((operation, window, handle)) = get("x-ks-operation")
        .zip(get("x-ks-window"))
        .zip(get("x-ks-handle"))
        .map(|((operation, window), handle)| (operation, window, handle))
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let offset = headers.get("x-ks-offset").map(|value| {
        let raw = value
            .to_str()
            .map_err(|_| "읽을 수 없는 값".to_string())?;
        raw.parse::<u64>().map_err(|_| raw.to_string())
    });
    let handle = percent_encoding::percent_decode_str(&handle)
        .decode_utf8_lossy()
        .into_owned();
    let core = state.core.clone();
    let result = tokio::task::spawn_blocking(move || match operation.as_str() {
        "files.read_bytes" => core.client_read_file(&window, &handle),
        "export.write" => match offset.as_ref() {
            None => Err(kaleidoscope_contract::errors::SERVER_DEVBRIDGE_EXPORT_OFFSET_REQUIRED()),
            Some(Err(value)) => Err(
                kaleidoscope_contract::errors::SERVER_DEVBRIDGE_EXPORT_OFFSET_INVALID(value),
            ),
            Some(Ok(offset)) => core
                .client_write_export(&window, &handle, *offset, &body)
                .map(|()| Vec::new()),
        },
        "client.http_read" | "client.blob_put" | "process.write" | "connection.realtime.read" | "connection.realtime.send" => {
            core.client_binary(&operation, &window, &handle, &body)
        }
        operation => {
            Err(kaleidoscope_contract::errors::SERVER_DEVBRIDGE_OPERATION_UNSUPPORTED(operation))
        }
    })
    .await;
    match result {
        Ok(Ok(bytes)) => {
            ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response()
        }
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, Json(error)).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn get_events(State(state): State<AppState>) -> impl IntoResponse {
    let stream = BroadcastStream::new(state.events.subscribe()).filter_map(|result| match result {
        Ok(event) => Some(Ok::<Event, Infallible>(Event::default().data(
            serde_json::to_string(&event).expect("CoreEvent JSON 직렬화는 실패하지 않습니다"),
        ))),
        Err(_) => None,
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

fn parse_args(args: impl Iterator<Item = OsString>) -> Result<Args, String> {
    let mut args = args;
    let mut data_dir = None;
    let mut port = None;
    let mut server = "http://127.0.0.1:4219".to_string();
    let mut device_name = "devbridge".to_string();
    let mut seeds = Vec::new();
    let mut oauth_open_url_file = None;

    while let Some(argument) = args.next() {
        match argument.to_string_lossy().as_ref() {
            "--data-dir" => {
                data_dir = Some(PathBuf::from(
                    args.next()
                        .ok_or_else(|| "--data-dir 값이 필요합니다".to_string())?,
                ));
            }
            "--port" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--port 값이 필요합니다".to_string())?;
                let value = value
                    .to_str()
                    .ok_or_else(|| "--port 값이 올바르지 않습니다".to_string())?;
                port = Some(
                    value
                        .parse::<u16>()
                        .map_err(|_| "--port 값이 올바르지 않습니다".to_string())?,
                );
            }
            "--server" => {
                server = args
                    .next()
                    .ok_or_else(|| "--server 값이 필요합니다".to_string())?
                    .to_string_lossy()
                    .into_owned();
            }
            "--device-name" => {
                device_name = args
                    .next()
                    .ok_or_else(|| "--device-name 값이 필요합니다".to_string())?
                    .to_string_lossy()
                    .into_owned();
            }
            "--seed" => seeds.push(PathBuf::from(
                args.next()
                    .ok_or_else(|| "--seed 값이 필요합니다".to_string())?,
            )),
            "--oauth-open-url-file" => {
                oauth_open_url_file = Some(PathBuf::from(args.next().ok_or_else(|| "--oauth-open-url-file 값이 필요합니다".to_string())?));
            }
            other => return Err(format!("알 수 없는 인자입니다: {other}")),
        }
    }

    Ok(Args {
        data_dir: data_dir.ok_or_else(|| "--data-dir가 필요합니다".to_string())?,
        port: port.ok_or_else(|| "--port가 필요합니다".to_string())?,
        server,
        device_name,
        seeds,
        oauth_open_url_file,
    })
}
