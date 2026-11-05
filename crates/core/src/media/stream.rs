//! 폴더 소리와 영상을 창별 권한으로 흘려보내는 루프백 서버.
use super::{authorization, transform::mime_for_path};
use crate::Inner;
use axum::{routing::any, Router};
use kaleidoscope_contract::{
    data::{MediaPlayback, MediaRef, ResourceMediaRef},
    errors, CoreError, PermissionDecl,
};
use std::{
    collections::HashMap,
    fs, io,
    path::PathBuf,
    sync::{atomic::Ordering, Arc, Mutex},
    thread::JoinHandle,
    time::SystemTime,
};
use tokio::sync::{oneshot, watch};

mod http;
use http::{serve, WebState};

struct Lease {
    handle: String,
    window: String,
    media: ResourceMediaRef,
    identity: authorization::Identity,
    generation: u64,
    path: PathBuf,
    len: u64,
    modified: SystemTime,
    mime: String,
    error: Mutex<Option<CoreError>>,
}
struct Server {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
    cancel: watch::Sender<bool>,
    thread: Option<JoinHandle<()>>,
    stopped: Arc<Mutex<Option<String>>>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.cancel.send_replace(true);
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
#[derive(Default)]
pub(crate) struct Streams {
    origin: Option<String>,
    leases: Mutex<HashMap<String, Arc<Lease>>>,
    server: Mutex<Option<Server>>,
    #[cfg(feature = "e2e")]
    observations: Mutex<Vec<(u16, u64, String)>>,
}
impl Streams {
    #[cfg(feature = "e2e")]
    pub(crate) fn observations(&self) -> Vec<(u16, u64, String)> {
        self.observations.lock().unwrap().clone()
    }
    pub(crate) fn new(origin: Option<String>) -> Self {
        Self {
            origin,
            ..Self::default()
        }
    }
    fn port(&self, inner: &Arc<Inner>) -> Result<u16, CoreError> {
        let origin = self
            .origin
            .clone()
            .ok_or_else(errors::MEDIA_STREAM_ORIGIN_NOT_CONFIGURED)?;
        let mut server = self.server.lock().unwrap();
        if let Some(server) = server.as_ref() {
            if let Some(reason) = server.stopped.lock().unwrap().as_ref() {
                return Err(errors::MEDIA_STREAM_SERVER_STOPPED(reason));
            }
            return Ok(server.port);
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| errors::MEDIA_STREAM_LISTEN_FAILED(e))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| errors::MEDIA_STREAM_LISTEN_FAILED(e))?;
        let port = listener
            .local_addr()
            .map_err(|e| errors::MEDIA_STREAM_LISTEN_FAILED(e))?
            .port();
        let (shutdown, rx) = oneshot::channel();
        let (cancel, _) = watch::channel(false);
        let shared = WebState {
            inner: Arc::downgrade(inner),
            origin,
            cancel: cancel.clone(),
        };
        let stopped = Arc::new(Mutex::new(None));
        let result = stopped.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let thread = std::thread::Builder::new().name("media-stream".into()).spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime,
                Err(e) => { let _ = ready_tx.send(Err(errors::MEDIA_STREAM_RUNTIME_START_FAILED(e))); return; }
            };
            runtime.block_on(async move {
                let listener = match tokio::net::TcpListener::from_std(listener) {
                    Ok(listener) => listener,
                    Err(e) => { let _ = ready_tx.send(Err(errors::MEDIA_STREAM_LISTEN_FAILED(e))); return; }
                };
                let router = Router::new().route("/media/{token}", any(serve)).with_state(shared);
                let _ = ready_tx.send(Ok(()));
                tokio::select! {
                    outcome = async { axum::serve(listener, router).await } => {
                        if let Err(e) = outcome { *result.lock().unwrap() = Some(e.to_string()); }
                        else { *result.lock().unwrap() = Some("서버가 종료되었습니다".into()); }
                    }
                    _ = rx => {}
                }
            });
        }).map_err(|e| errors::MEDIA_STREAM_RUNTIME_START_FAILED(e))?;
        match ready_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = thread.join();
                return Err(error);
            }
            Err(error) => {
                let _ = thread.join();
                return Err(errors::MEDIA_STREAM_RUNTIME_START_FAILED(error));
            }
        }
        *server = Some(Server {
            port,
            shutdown: Some(shutdown),
            cancel,
            thread: Some(thread),
            stopped,
        });
        Ok(port)
    }
    pub(crate) fn stop(&self) {
        self.leases.lock().unwrap().clear();
        let server = self.server.lock().unwrap().take();
        drop(server);
    }
    pub(crate) fn release_window(&self, window: &str) {
        self.leases
            .lock()
            .unwrap()
            .retain(|_, lease| lease.window != window);
    }
}

pub(crate) fn open(
    inner: &Arc<Inner>,
    window: &str,
    media: &MediaRef,
) -> Result<MediaPlayback, CoreError> {
    let MediaRef::Resource(resource) = media else {
        return Ok(MediaPlayback::Inline {
            media: super::get(inner, window, media, None)?,
        });
    };
    let permission =
        authorization::permission(&inner.state.lock().unwrap(), window, &resource.permission)?;
    let mime = mime_for_path(&resource.path);
    if !matches!(permission, PermissionDecl::Files { .. })
        || !(mime.starts_with("audio/") || mime.starts_with("video/"))
    {
        return Ok(MediaPlayback::Inline {
            media: super::get(inner, window, media, None)?,
        });
    }
    let file = authorization::file(inner, window, resource)?;
    if !file.metadata.is_file() {
        return Err(errors::MEDIA_STREAM_FILE_NOT_REGULAR(&resource.path));
    }
    let modified = authorization::modified(&file.metadata, &resource.path)?;
    fs::File::open(&file.path).map_err(|err| open_error(&resource.path, err))?;
    let port = inner.media_streams.port(inner)?;
    let handle = uuid::Uuid::new_v4().to_string();
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let lease = Lease {
        handle: handle.clone(),
        window: window.into(),
        media: resource.clone(),
        identity: file.identity,
        generation: inner.generation.load(Ordering::SeqCst),
        path: file.path,
        len: file.metadata.len(),
        modified,
        mime: mime.into(),
        error: Mutex::new(None),
    };
    {
        let state = inner.state.lock().unwrap();
        let mut leases = inner.media_streams.leases.lock().unwrap();
        leases.retain(|_, lease| {
            state
                .shared
                .windows
                .iter()
                .any(|window| window.id == lease.window)
        });
        leases.insert(token.clone(), Arc::new(lease));
    }
    Ok(MediaPlayback::Stream {
        handle,
        url: format!("http://127.0.0.1:{port}/media/{token}"),
        mime: mime.into(),
    })
}
fn open_error(path: &str, err: io::Error) -> CoreError {
    let error = if err.kind() == io::ErrorKind::NotFound {
        errors::MEDIA_LOAD_FILE_OPEN_NOT_FOUND(path)
    } else {
        errors::MEDIA_LOAD_FILE_OPEN_FAILED(path)
    };
    error.and_details(vec![err.to_string()])
}
fn read_error(path: &str, err: &io::Error) -> CoreError {
    let error = if err.kind() == io::ErrorKind::NotFound {
        errors::MEDIA_LOAD_FILE_READ_NOT_FOUND(path)
    } else {
        errors::MEDIA_LOAD_FILE_READ_FAILED(path)
    };
    error.and_details(vec![err.to_string()])
}
pub(crate) fn close(inner: &Arc<Inner>, window: &str, handle: &str) -> Result<(), CoreError> {
    let mut leases = inner.media_streams.leases.lock().unwrap();
    let token = leases
        .iter()
        .find(|(_, lease)| lease.handle == handle)
        .map(|(token, lease)| {
            if lease.window != window {
                Err(errors::MEDIA_STREAM_HANDLE_OWNER_MISMATCH())
            } else {
                Ok(token.clone())
            }
        })
        .transpose()?;
    if let Some(token) = token {
        leases.remove(&token);
    }
    Ok(())
}
pub(crate) fn status(
    inner: &Arc<Inner>,
    window: &str,
    handle: &str,
) -> Result<Option<CoreError>, CoreError> {
    let leases = inner.media_streams.leases.lock().unwrap();
    let lease = leases
        .values()
        .find(|lease| lease.handle == handle)
        .ok_or_else(errors::MEDIA_STREAM_HANDLE_INVALID)?;
    if lease.window != window {
        return Err(errors::MEDIA_STREAM_HANDLE_OWNER_MISMATCH());
    }
    let result = lease.error.lock().unwrap().clone();
    Ok(result)
}
