//! 루프백 서버의 접속/종료는 브라우저가 보고한 상태와 독립적으로 센다.
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;
use tokio_tungstenite::tungstenite::{
    accept_hdr,
    handshake::server::{Request, Response},
    Message,
};

#[derive(Default)]
pub struct Counts {
    pub opened: AtomicUsize,
    pub closed: AtomicUsize,
    pub rejected: AtomicUsize,
}

pub struct Echo {
    pub origin: String,
    pub counts: Arc<Counts>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Echo {
    pub fn start() -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let origin = format!(
            "http://{}",
            listener.local_addr().map_err(|e| e.to_string())?
        );
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let counts = Arc::new(Counts::default());
        let stop = Arc::new(AtomicBool::new(false));
        let (stats, stopping) = (counts.clone(), stop.clone());
        let worker = thread::spawn(move || {
            let mut clients = Vec::new();
            while !stopping.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((socket, _)) => {
                        let stats = stats.clone();
                        clients.push(thread::spawn(move || {
                            let _ = socket.set_read_timeout(Some(Duration::from_secs(10)));
                            let _ = socket.set_write_timeout(Some(Duration::from_secs(5)));
                            let mut ws = match accept_hdr(socket, |request: &Request, response: Response| {
                                if request.uri().path() != "/socket"
                                    || request.headers().get("authorization").and_then(|v| v.to_str().ok()) != Some("Bearer fixture-secret")
                                {
                                    stats.rejected.fetch_add(1, Ordering::SeqCst);
                                    let mut denied = tokio_tungstenite::tungstenite::http::Response::new(None);
                                    *denied.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED;
                                    return Err(denied);
                                }
                                Ok(response)
                            }) {
                                Ok(ws) => ws,
                                Err(_) => return,
                            };
                            stats.opened.fetch_add(1, Ordering::SeqCst);
                            while let Ok(message) = ws.read() {
                                match message {
                                    Message::Text(_) | Message::Binary(_) => {
                                        if ws.send(message).is_err() { break; }
                                    }
                                    Message::Close(_) => { let _ = ws.flush(); break; }
                                    _ => {}
                                }
                            }
                            stats.closed.fetch_add(1, Ordering::SeqCst);
                        }));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(20))
                    }
                    Err(_) => break,
                }
            }
            for client in clients {
                let _ = client.join();
            }
        });
        Ok(Self {
            origin,
            counts,
            stop,
            worker: Some(worker),
        })
    }
}

impl Drop for Echo {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;
    use std::time::Instant;
    use tokio_tungstenite::tungstenite::{client, client::IntoClientRequest};

    #[test]
    fn 잘못된_bearer는_열지_않고_거부로_센다() {
        let echo = Echo::start().unwrap();
        let address = echo.origin.strip_prefix("http://").unwrap();
        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        assert!(client(format!("ws://{address}/socket"), stream).is_err());
        assert_eq!(echo.counts.opened.load(Ordering::SeqCst), 0);
        assert_eq!(echo.counts.rejected.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn 올바른_bearer의_문자와_바이트를_돌려주고_tcp_종료를_센다() {
        let echo = Echo::start().unwrap();
        let address = echo.origin.strip_prefix("http://").unwrap();
        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = format!("ws://{address}/socket")
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("Authorization", "Bearer fixture-secret".parse().unwrap());
        let (mut ws, _) = client(request, stream).unwrap();
        for message in [
            Message::Text("문자 왕복".into()),
            Message::Binary(vec![0, 1, 255].into()),
        ] {
            ws.send(message.clone()).unwrap();
            assert_eq!(ws.read().unwrap(), message);
        }
        ws.close(None).unwrap();
        let _ = ws.read();
        let deadline = Instant::now() + Duration::from_secs(5);
        while echo.counts.closed.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(echo.counts.opened.load(Ordering::SeqCst), 1);
        assert_eq!(echo.counts.closed.load(Ordering::SeqCst), 1);
        assert_eq!(echo.counts.rejected.load(Ordering::SeqCst), 0);
    }
}
