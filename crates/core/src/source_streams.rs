//! 앱 정의의 상류 SSE 스트림. 기기에서 (연결 이름, path, query)마다 하나를 열어 두고 여러 창과
//! 여러 앱이 나눠 쓴다. 알림은 다시 받기만 일으키며 값으로 쓰지 않는다.
use crate::{
    connections::{self, LoginStore},
    sse, Inner,
};
use kaleidoscope_contract::{
    errors,
    registry::{ConnectionKind, ConnectionInfo},
    validate::valid_request_path,
    CoreError,
};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, Weak};
use std::thread;
use tokio::sync::watch as tokio_watch;

/// 스트림 하나를 가리키는 열쇠. 연결 이름과 고정 경로, 고정 query다.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub(crate) struct StreamKey {
    pub connection: String,
    pub path: String,
    pub query: BTreeMap<String, String>,
}

#[derive(Clone, Copy, PartialEq)]
enum Blocked {
    /// 서버 중계 연결이라 스트림을 열 수 없다.
    Relay,
    /// 로그인이 필요하다. 로그인하면 다시 연다.
    LoginRequired,
    /// 서버가 403을 냈거나 경로가 연결의 경로 접두사 밖이다. 연결이 바뀌면 다시 판단한다.
    Forbidden,
}

struct Entry {
    stop: tokio_watch::Sender<bool>,
    running: bool,
    blocked: Option<Blocked>,
}

/// 열어 두는 스트림들. `Mutex` 하나로 지키고, 각 스트림은 스레드 하나가 읽는다.
#[derive(Default)]
pub(crate) struct Streams(Mutex<HashMap<StreamKey, Entry>>);

/// 지금 필요한 스트림을 열고 필요 없어진 스트림을 닫는다. 포그라운드에서 잠금을 오래 잡지 않는다.
pub(crate) fn reconcile(inner: &Arc<Inner>) {
    let wanted = crate::data_runtime::watch::stream_keys(inner);
    let mut streams = inner.source_streams.0.lock().unwrap();
    streams.retain(|key, entry| {
        let keep = wanted.iter().any(|wanted| wanted == key);
        if !keep {
            let _ = entry.stop.send(true);
        }
        keep
    });
    for key in wanted {
        let entry = streams.entry(key.clone()).or_insert_with(|| Entry {
            stop: tokio_watch::channel(false).0,
            running: false,
            blocked: None,
        });
        if entry.running || entry.blocked.is_some() {
            continue;
        }
        entry.running = true;
        spawn(Arc::downgrade(inner), key, entry.stop.subscribe());
    }
}

/// 연결 설정이 바뀌었다. 그 연결의 스트림이 다시 열릴 수 있게 표시한다.
pub(crate) fn connection_changed(inner: &Arc<Inner>, connection: &str) {
    clear_blocked(inner, connection);
    reconcile(inner);
}

/// 연결에 로그인했다. 로그인이 필요해 멈춘 스트림을 다시 연다.
pub(crate) fn login_succeeded(inner: &Arc<Inner>, connection: &str) {
    clear_blocked(inner, connection);
    reconcile(inner);
}

fn clear_blocked(inner: &Arc<Inner>, connection: &str) {
    let mut streams = inner.source_streams.0.lock().unwrap();
    for (key, entry) in streams.iter_mut() {
        if key.connection == connection {
            entry.blocked = None;
        }
    }
}

fn spawn(inner: Weak<Inner>, key: StreamKey, mut stop: tokio_watch::Receiver<bool>) {
    thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(_) => return,
        };
        let mut delay = sse::INITIAL_RETRY_DELAY_SECS;
        loop {
            if *stop.borrow() {
                return;
            }
            let Some(arc) = inner.upgrade() else {
                return;
            };
            let outcome = runtime.block_on(read_stream(&arc, &key, &mut stop));
            drop(arc);
            match outcome {
                Outcome::Done => return,
                Outcome::Blocked(blocked, error) => {
                    if let Some(inner) = inner.upgrade() {
                        let mut streams = inner.source_streams.0.lock().unwrap();
                        if let Some(entry) = streams.get_mut(&key) {
                            entry.running = false;
                            entry.blocked = Some(blocked);
                        }
                    }
                    eprintln!("{}", error.message);
                    return;
                }
                Outcome::Retry { connected } => {
                    delay = sse::next_delay(delay, connected);
                    if !runtime.block_on(sse::sleep_or_stop(&mut stop, delay)) {
                        return;
                    }
                }
            }
        }
    });
}

enum Outcome {
    /// 스트림이 필요 없어져 닫았다(항목이 사라졌다).
    Done,
    /// 다시 열지 않고 멈춘다. 등록 오류를 남긴다.
    Blocked(Blocked, CoreError),
    /// 끊겼거나 실패했다. `connected`는 이번 시도가 응답을 받아 읽기 시작했는지다.
    Retry { connected: bool },
}

async fn read_stream(
    inner: &Arc<Inner>,
    key: &StreamKey,
    stop: &mut tokio_watch::Receiver<bool>,
) -> Outcome {
    let Some(info) = connections::find_connection(inner, &key.connection) else {
        return Outcome::Retry { connected: false };
    };
    if info.kind != ConnectionKind::Oauth {
        return Outcome::Blocked(
            Blocked::Relay,
            errors::DATA_STREAM_RELAY_UNSUPPORTED(&key.connection),
        );
    }
    if !valid_request_path(&key.path)
        || (!info.paths.is_empty()
            && !info.paths.iter().any(|prefix| key.path.starts_with(prefix)))
    {
        return Outcome::Blocked(
            Blocked::Forbidden,
            errors::DATA_STREAM_PATH_DENIED(&key.connection, &key.path),
        );
    }
    let logins = inner.login_store.clone();
    let name = info.name.clone();
    let scopes = info.scopes.clone();
    let token = match tokio::task::spawn_blocking(move || logins.token(&name, scopes.as_deref()))
        .await
    {
        Ok(Ok(Some(token))) => token,
        Ok(Ok(None)) => {
            return Outcome::Blocked(
                Blocked::LoginRequired,
                errors::DATA_STREAM_LOGIN_REQUIRED(&info.name),
            )
        }
        Ok(Err(_)) | Err(_) => return Outcome::Retry { connected: false },
    };
    let client = match sse::client() {
        Ok(client) => client,
        Err(_) => return Outcome::Retry { connected: false },
    };
    let request = |token: &str| {
        client
            .get(format!("{}{}", info.base_url, key.path))
            .bearer_auth(token)
            .query(&key.query)
            .send()
    };
    let mut response = match request(&token).await {
        Ok(response) => response,
        Err(_) => return Outcome::Retry { connected: false },
    };
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        let Some(refreshed) = refresh(inner, &info, &token).await else {
            return Outcome::Retry { connected: false };
        };
        let Some(refreshed) = refreshed else {
            return Outcome::Blocked(
                Blocked::LoginRequired,
                errors::DATA_STREAM_LOGIN_REQUIRED(&info.name),
            );
        };
        response = match request(&refreshed).await {
            Ok(response) => response,
            Err(_) => return Outcome::Retry { connected: false },
        };
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            let logins = inner.login_store.clone();
            let name = info.name.clone();
            let rejected = refreshed.clone();
            let _ = tokio::task::spawn_blocking(move || logins.invalidate(&name, &rejected)).await;
            return Outcome::Blocked(
                Blocked::LoginRequired,
                errors::DATA_STREAM_LOGIN_REQUIRED(&info.name),
            );
        }
    }
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Outcome::Blocked(
            Blocked::Forbidden,
            errors::DATA_STREAM_PERMISSION_DENIED(&info.name),
        );
    }
    if !response.status().is_success() {
        return Outcome::Retry { connected: false };
    }
    crate::data_runtime::watch::connected(inner, key);
    let end = sse::read_frames(&mut response, Some(stop), |frame| {
        let event = frame.event.as_deref().unwrap_or("message");
        crate::data_runtime::watch::notified(inner, key, event, &frame.data);
        sse::Control::Continue
    })
    .await;
    match end {
        sse::ReadEnd::Stopped | sse::ReadEnd::Close => Outcome::Done,
        sse::ReadEnd::Retry | sse::ReadEnd::Disconnected => Outcome::Retry { connected: true },
    }
}

async fn refresh(
    inner: &Arc<Inner>,
    info: &ConnectionInfo,
    rejected: &str,
) -> Option<Option<String>> {
    let logins = inner.login_store.clone();
    let name = info.name.clone();
    let rejected = rejected.to_owned();
    match tokio::task::spawn_blocking(move || logins.refresh(&name, &rejected)).await {
        Ok(Ok(token)) => Some(token),
        _ => None,
    }
}
