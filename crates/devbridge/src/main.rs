use std::convert::Infallible;
use std::env;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use kaleidoscope_contract::{CoreError, CoreEvent, CoreRequest, ErrorCode};
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

struct DevHost;

impl Host for DevHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        env::var_os("KALEIDOSCOPE_DEV_PICK").map(PathBuf::from)
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

    fn open_url(&self, _: &str) -> std::io::Result<()> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "개발용 다리에서는 브라우저를 열 수 없습니다",
        ))
    }
}

#[cfg(test)]
mod host_tests {
    use super::{DevHost, Host};

    #[test]
    fn devbridge_does_not_open_oauth_urls() {
        let error = DevHost.open_url("https://auth.example").unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::Unsupported);
    }
}

struct Args {
    data_dir: PathBuf,
    port: u16,
    server: String,
    device_name: String,
    seeds: Vec<PathBuf>,
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
    let core = Arc::new(
        Core::open(
            CoreConfig {
                data_dir: args.data_dir,
                seed_definitions,
                server_url: args.server,
                device_name: args.device_name,
            },
            Arc::new(DevHost),
        )
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
        .allow_headers([header::CONTENT_TYPE]);
    let app = Router::new()
        .route("/core", post(post_core))
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
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(CoreError {
                    code: ErrorCode::InvalidRequest,
                    message: "요청 형식이 올바르지 않습니다.".into(),
                    details: Vec::new(),
                }),
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
                Json(CoreError {
                    code: ErrorCode::Io,
                    message: "코어 명령을 실행할 수 없습니다.".into(),
                    details: Vec::new(),
                }),
            )
                .into_response()
        }
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
            other => return Err(format!("알 수 없는 인자입니다: {other}")),
        }
    }

    Ok(Args {
        data_dir: data_dir.ok_or_else(|| "--data-dir가 필요합니다".to_string())?,
        port: port.ok_or_else(|| "--port가 필요합니다".to_string())?,
        server,
        device_name,
        seeds,
    })
}
