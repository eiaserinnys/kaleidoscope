//! 소켓 하나의 작업 스레드와 제한된 메시지 큐.
use super::{Message, Packet, LIMIT_BYTES, LIMIT_COUNT};
use crate::{connections::LoginStore, data_runtime::gates, Inner};
use futures_util::{SinkExt, StreamExt};
use kaleidoscope_contract::{errors, registry::ConnectionInfo, CoreError};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{mpsc, Notify};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{
        self,
        client::IntoClientRequest,
        protocol::{frame::coding::CloseCode, CloseFrame, WebSocketConfig},
        Message as WsMessage,
    },
};

// 클라이언트 프레임은 기본 헤더 2, 확장 길이 8, 마스크 4바이트를 더한다.
const MAX_FRAME_HEADER_BYTES: usize = 14;

pub(super) struct State {
    pub queue: VecDeque<Packet>,
    pub bytes: usize,
    pub sent_bytes: usize,
    pub sent_count: usize,
    pub next: u64,
    pub delivered: u64,
    pub closed: bool,
    pub pending_terminal: Option<Packet>,
}

pub(super) enum Command {
    Send(Message),
    Close(Option<u16>, String),
}
pub(super) enum Stop {
    Abort,
}

pub(super) struct Running {
    pub handle: String,
    pub permission: String,
    pub info: ConnectionInfo,
    pub state: Mutex<State>,
    pub space: Notify,
    command: mpsc::UnboundedSender<Command>,
    stop: mpsc::UnboundedSender<Stop>,
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Running {
    pub fn new(
        permission: &str,
        info: ConnectionInfo,
    ) -> (
        Arc<Self>,
        mpsc::UnboundedReceiver<Command>,
        mpsc::UnboundedReceiver<Stop>,
    ) {
        let (command, commands) = mpsc::unbounded_channel();
        let (stop, stops) = mpsc::unbounded_channel();
        (
            Arc::new(Self {
                handle: uuid::Uuid::new_v4().to_string(),
                permission: permission.into(),
                info,
                state: Mutex::new(State {
                    queue: VecDeque::new(),
                    bytes: 0,
                    sent_bytes: 0,
                    sent_count: 0,
                    next: 1,
                    delivered: 0,
                    closed: false,
                    pending_terminal: None,
                }),
                space: Notify::new(),
                command,
                stop,
                thread: Mutex::new(None),
            }),
            commands,
            stops,
        )
    }

    pub fn launch(
        self: &Arc<Self>,
        inner: &Arc<Inner>,
        path: String,
        protocols: Vec<String>,
        mut commands: mpsc::UnboundedReceiver<Command>,
        mut stops: mpsc::UnboundedReceiver<Stop>,
    ) -> std::sync::mpsc::Receiver<Result<Option<String>, CoreError>> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let run = self.clone();
        let inner = inner.clone();
        let thread = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("실시간 연결 런타임");
            rt.block_on(async move {
                let result = handshake(&inner, &run.info, &path, &protocols, &mut stops).await;
                match result {
                    Ok((socket, protocol)) => {
                        if tx.send(Ok(protocol)).is_err() {
                            return;
                        }
                        drive(run, socket, &mut commands, &mut stops).await;
                    }
                    Err(error) => {
                        let _ = tx.send(Err(error));
                    }
                }
            });
        });
        *self.thread.lock().unwrap() = Some(thread);
        rx
    }

    pub fn cancel(&self) {
        let _ = self.stop.send(Stop::Abort);
        self.space.notify_waiters();
    }

    pub fn join(&self) {
        if let Some(thread) = self.thread.lock().unwrap().take() {
            let _ = thread.join();
        }
    }

    pub fn stop(&self) {
        self.cancel();
        self.join();
    }

    pub fn send(&self, message: Message) -> Result<(), CoreError> {
        if matches!(message, Message::Terminal { .. }) {
            return Err(errors::CONN_REALTIME_PACKET_INVALID());
        }
        let size = message.size();
        let mut state = self.state.lock().unwrap();
        if state.closed {
            return Err(errors::CONN_REALTIME_HANDLE_MISSING());
        }
        if size > LIMIT_BYTES {
            state.closed = true;
            let _ = self.command.send(Command::Close(Some(1009), String::new()));
            return Err(errors::CONN_REALTIME_MESSAGE_TOO_LARGE(&self.info.name));
        }
        if state.sent_count >= LIMIT_COUNT || state.sent_bytes + size > LIMIT_BYTES {
            state.closed = true;
            let _ = self.command.send(Command::Close(Some(1013), String::new()));
            return Err(errors::CONN_REALTIME_SEND_QUEUE_FULL(&self.info.name));
        }
        state.sent_count += 1;
        state.sent_bytes += size;
        if self.command.send(Command::Send(message)).is_err() {
            state.sent_count -= 1;
            state.sent_bytes -= size;
            return Err(errors::CONN_REALTIME_HANDLE_MISSING());
        }
        Ok(())
    }

    pub fn close(&self, code: Option<u16>, reason: String) -> Result<(), CoreError> {
        if reason.len() > 123 || code.is_some_and(|c| !(c == 1000 || (3000..=4999).contains(&c))) {
            return Err(errors::CONN_REALTIME_CLOSE_INVALID());
        }
        let mut state = self.state.lock().unwrap();
        if state.closed {
            return Err(errors::CONN_REALTIME_HANDLE_MISSING());
        }
        state.closed = true;
        self.command
            .send(Command::Close(code, reason))
            .map_err(|_| errors::CONN_REALTIME_HANDLE_MISSING())
    }
}

async fn handshake(
    inner: &Arc<Inner>,
    info: &ConnectionInfo,
    path: &str,
    protocols: &[String],
    stop: &mut mpsc::UnboundedReceiver<Stop>,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Option<String>,
    ),
    CoreError,
> {
    let name = &info.name;
    let store = inner.login_store.clone();
    let connection = name.to_owned();
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let _ = tx.send(store.token(&connection));
    });
    let mut token = tokio::select! {
        _ = stop.recv() => return Err(errors::CONN_REALTIME_SESSION_STALE()),
        result = rx => result.ok().flatten().ok_or_else(|| errors::CONN_REALTIME_LOGIN_REQUIRED(name))?,
    };
    for attempt in 0..2 {
        let base = format!("{}{}", info.base_url, path);
        let mut url =
            url::Url::parse(&base).map_err(|_| errors::CONN_REALTIME_OPEN_REJECTED(name))?;
        let scheme = match url.scheme() {
            "http" => "ws",
            "https" => "wss",
            _ => return Err(errors::CONN_REALTIME_OPEN_REJECTED(name)),
        };
        url.set_scheme(scheme)
            .map_err(|_| errors::CONN_REALTIME_OPEN_REJECTED(name))?;
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|_| errors::CONN_REALTIME_OPEN_REJECTED(name))?;
        request.headers_mut().insert(
            "authorization",
            format!("Bearer {token}")
                .parse()
                .map_err(|_| errors::CONN_REALTIME_LOGIN_REQUIRED(name))?,
        );
        if !protocols.is_empty() {
            request.headers_mut().insert(
                "sec-websocket-protocol",
                protocols
                    .join(", ")
                    .parse()
                    .map_err(|_| errors::CONN_REALTIME_OPEN_REJECTED(name))?,
            );
        }
        let config = WebSocketConfig::default()
            .write_buffer_size(0)
            .max_write_buffer_size(LIMIT_BYTES + MAX_FRAME_HEADER_BYTES)
            .max_message_size(Some(LIMIT_BYTES))
            .max_frame_size(Some(LIMIT_BYTES));
        let result = tokio::select! {
            _ = stop.recv() => return Err(errors::CONN_REALTIME_SESSION_STALE()),
            result = tokio::time::timeout(Duration::from_secs(10), connect_async_with_config(request, Some(config), false)) => result,
        };
        match result {
            Err(_) => return Err(errors::CONN_REALTIME_OPEN_TIMEOUT(name)),
            Ok(Ok((socket, response))) => {
                let protocol = response
                    .headers()
                    .get("sec-websocket-protocol")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_owned);
                gates::release_expired(&inner.data_runtimes, name);
                return Ok((socket, protocol));
            }
            Ok(Err(tungstenite::Error::Http(response))) => {
                let status = response.status().as_u16();
                if let Some(hint) =
                    kaleidoscope_data::rate_limit::rate_limit(status, response.headers())
                {
                    let until =
                        gates::record_limit(&inner.data_runtimes, name, hint.retry_after_secs);
                    let seconds = (until - chrono::Utc::now()).num_seconds().max(0) as u64 + 1;
                    let mut error = errors::CONN_REALTIME_OPEN_RATE_LIMITED(name, seconds);
                    error.details.push(format!("retry_after_secs={seconds}"));
                    return Err(error);
                }
                if status == 401 && attempt == 0 {
                    let store = inner.login_store.clone();
                    let connection = name.to_owned();
                    let rejected = token.clone();
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    std::thread::spawn(move || {
                        let _ = tx.send(store.refresh(&connection, &rejected));
                    });
                    token = tokio::select! {
                        _ = stop.recv() => return Err(errors::CONN_REALTIME_SESSION_STALE()),
                        result = rx => result.ok().flatten().ok_or_else(|| errors::CONN_REALTIME_LOGIN_REQUIRED(name))?,
                    };
                    continue;
                }
                if status == 401 {
                    let store = inner.login_store.clone();
                    let connection = name.to_owned();
                    let rejected = token.clone();
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    std::thread::spawn(move || {
                        store.invalidate(&connection, &rejected);
                        let _ = tx.send(());
                    });
                    tokio::select! {
                        _ = stop.recv() => return Err(errors::CONN_REALTIME_SESSION_STALE()),
                        _ = rx => {},
                    }
                    return Err(errors::CONN_REALTIME_LOGIN_REQUIRED(name));
                }
                let mut error = errors::CONN_REALTIME_OPEN_REJECTED(name);
                error.details.push(format!("HTTP {status}"));
                return Err(error);
            }
            Ok(Err(_)) => {
                return Err(errors::CONN_REALTIME_OPEN_UNREACHABLE(
                    name,
                    "네트워크 연결을 열 수 없음",
                ))
            }
        }
    }
    Err(errors::CONN_REALTIME_LOGIN_REQUIRED(name))
}

async fn drive(
    run: Arc<Running>,
    mut socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    commands: &mut mpsc::UnboundedReceiver<Command>,
    stop: &mut mpsc::UnboundedReceiver<Stop>,
) {
    let mut pending: Option<Message> = None;
    loop {
        let notified = run.space.notified();
        if let Some(message) = pending.take() {
            let mut state = run.state.lock().unwrap();
            if state.queue.len() < LIMIT_COUNT && state.bytes + message.size() <= LIMIT_BYTES {
                state.bytes += message.size();
                let sequence = state.next;
                state.next += 1;
                state.queue.push_back(Packet { sequence, message });
            } else {
                pending = Some(message);
            }
        }
        let can_read = {
            let state = run.state.lock().unwrap();
            pending.is_none() && state.queue.len() < LIMIT_COUNT && state.bytes < LIMIT_BYTES
        };
        tokio::select! {
            _ = stop.recv() => { close_socket(&mut socket, None).await; break; }
            _ = notified, if !can_read => {},
            command = commands.recv() => match command {
                Some(Command::Send(message)) => {
                    let size = message.size();
                    let ws = match message { Message::Text(text) => WsMessage::Text(text.into()), Message::Binary(bytes) => WsMessage::Binary(bytes.into()), Message::Terminal { .. } => unreachable!() };
                    let result = tokio::select! {
                        _ = stop.recv() => { close_socket(&mut socket, None).await; break; },
                        result = socket.send(ws) => result,
                    };
                    { let mut state = run.state.lock().unwrap(); state.sent_bytes -= size; state.sent_count -= 1; }
                    if result.is_err() { terminal(&run, 1006, "", false, Some(errors::CONN_REALTIME_STREAM_FAILED(&run.info.name, "전송 연결이 끊김"))); break; }
                }
                Some(Command::Close(code, reason)) => {
                    let frame = code.map(|code| CloseFrame { code: CloseCode::from(code), reason: reason.into() });
                    let clean = close_socket(&mut socket, frame).await;
                    terminal(&run, code.unwrap_or(1000), "", clean, None); break;
                }
                None => break,
            },
            received = socket.next(), if can_read => match received {
                Some(Ok(WsMessage::Text(text))) => pending = Some(Message::Text(text.to_string())),
                Some(Ok(WsMessage::Binary(bytes))) => pending = Some(Message::Binary(bytes.to_vec())),
                Some(Ok(WsMessage::Close(frame))) => {
                    let (code, reason) = frame.map(|f| (u16::from(f.code), f.reason.to_string())).unwrap_or((1000, String::new()));
                    let clean = tokio::select! {
                        _ = stop.recv() => break,
                        clean = finish_remote_close(&mut socket) => clean,
                    };
                    terminal(&run, code, &reason, clean, None); break;
                }
                Some(Ok(_)) => {},
                Some(Err(tungstenite::Error::Capacity(_))) => { terminal(&run, 1009, "", false, Some(errors::CONN_REALTIME_MESSAGE_TOO_LARGE(&run.info.name))); break; }
                Some(Err(_)) | None => { terminal(&run, 1006, "", false, Some(errors::CONN_REALTIME_STREAM_FAILED(&run.info.name, "수신 연결이 끊김"))); break; }
            }
        }
    }
}

async fn finish_remote_close(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> bool {
    tokio::time::timeout(Duration::from_secs(1), async {
        if socket.flush().await.is_err() {
            return false;
        }
        loop {
            match socket.next().await {
                None | Some(Err(tungstenite::Error::ConnectionClosed)) => return true,
                Some(Err(_)) => return false,
                _ => {}
            }
        }
    })
    .await
    .unwrap_or(false)
}

async fn close_socket(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    frame: Option<CloseFrame>,
) -> bool {
    tokio::time::timeout(Duration::from_secs(1), async {
        if socket.close(frame).await.is_err() {
            return false;
        }
        loop {
            match socket.next().await {
                Some(Ok(WsMessage::Close(_)))
                | Some(Err(tungstenite::Error::ConnectionClosed))
                | None => return true,
                Some(Err(_)) => return false,
                _ => {}
            }
        }
    })
    .await
    .unwrap_or(false)
}

fn terminal(run: &Running, code: u16, reason: &str, clean: bool, error: Option<CoreError>) {
    let mut state = run.state.lock().unwrap();
    state.closed = true;
    let sequence = state.next;
    state.next += 1;
    let packet = Packet {
        sequence,
        message: Message::Terminal {
            code,
            reason: reason.into(),
            clean,
            error,
        },
    };
    if state.queue.len() < LIMIT_COUNT {
        state.queue.push_back(packet);
    } else {
        state.pending_terminal = Some(packet);
    }
}
