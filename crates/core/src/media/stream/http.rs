//! HTTP 요청의 출처와 권한, 범위를 확인하고 파일을 전송한다.
use super::{authorization, open_error, read_error, Lease};
use crate::{
    media::range::{self, Range},
    Inner,
};
use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::{header, Method, StatusCode},
    response::Response,
};
use kaleidoscope_contract::{errors, CoreError};
use std::{
    io,
    sync::{atomic::Ordering, Arc, Weak},
};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt},
    sync::watch,
};

#[derive(Clone)]
pub(super) struct WebState {
    pub(super) inner: Weak<Inner>,
    pub(super) origin: String,
    pub(super) cancel: watch::Sender<bool>,
}
fn rejected(status: StatusCode, error: CoreError) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::VARY, "Origin")
        .body(Body::from(serde_json::to_vec(&error).expect("오류 직렬화")))
        .unwrap()
}
fn fail(lease: &Lease, status: StatusCode, error: CoreError) -> Response {
    *lease.error.lock().unwrap() = Some(error.clone());
    rejected(status, error)
}
fn authorized(inner: &Arc<Inner>, lease: &Lease) -> Result<authorization::FileAccess, CoreError> {
    let state = inner.state.lock().unwrap();
    if authorization::identity(&state, &lease.window, &lease.media.permission).as_ref()
        != Some(&lease.identity)
        || inner.generation.load(Ordering::SeqCst) != lease.generation
    {
        return Err(errors::MEDIA_STREAM_AUTHORITY_CHANGED());
    }
    drop(state);
    let file = authorization::file(inner, &lease.window, &lease.media)?;
    if file.identity != lease.identity {
        return Err(errors::MEDIA_STREAM_AUTHORITY_CHANGED());
    }
    if !file.metadata.is_file() {
        return Err(errors::MEDIA_STREAM_FILE_NOT_REGULAR(&lease.media.path));
    }
    if file.path != lease.path
        || file.metadata.len() != lease.len
        || authorization::modified(&file.metadata, &lease.media.path)? != lease.modified
    {
        return Err(errors::MEDIA_STREAM_FILE_CHANGED(&lease.media.path));
    }
    Ok(file)
}
fn failure_status(error: &CoreError) -> StatusCode {
    use kaleidoscope_contract::ErrorCode;
    match error.code {
        ErrorCode::Conflict => StatusCode::CONFLICT,
        ErrorCode::NotFound => StatusCode::NOT_FOUND,
        ErrorCode::NotGranted | ErrorCode::PermissionDenied | ErrorCode::PathOutsideRoot => {
            StatusCode::FORBIDDEN
        }
        ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
pub(super) async fn serve(
    State(shared): State<WebState>,
    Path(token): Path<String>,
    request: Request,
) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    if origin != Some(shared.origin.as_str()) {
        #[cfg(feature = "e2e")]
        if let Some(inner) = shared.inner.upgrade() {
            inner.media_streams.observations.lock().unwrap().push((
                StatusCode::FORBIDDEN.as_u16(),
                0,
                origin.unwrap_or("(없음)").to_string(),
            ));
        }
        return rejected(
            StatusCode::FORBIDDEN,
            errors::MEDIA_STREAM_ORIGIN_REJECTED(),
        );
    }
    let Some(inner) = shared.inner.upgrade() else {
        return rejected(
            StatusCode::INTERNAL_SERVER_ERROR,
            errors::MEDIA_STREAM_SERVER_STOPPED("코어가 종료되었습니다"),
        );
    };
    let lease = inner
        .media_streams
        .leases
        .lock()
        .unwrap()
        .get(&token)
        .cloned();
    let Some(lease) = lease else {
        return rejected(StatusCode::NOT_FOUND, errors::MEDIA_STREAM_HANDLE_INVALID());
    };
    {
        let state = inner.state.lock().unwrap();
        if !state
            .shared
            .windows
            .iter()
            .any(|window| window.id == lease.window)
        {
            inner.media_streams.leases.lock().unwrap().remove(&token);
            return rejected(StatusCode::NOT_FOUND, errors::MEDIA_STREAM_HANDLE_INVALID());
        }
    }
    let method = request.method().clone();
    if !matches!(method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return fail(
            &lease,
            StatusCode::METHOD_NOT_ALLOWED,
            errors::MEDIA_STREAM_METHOD_UNSUPPORTED(&method),
        );
    }
    if let Err(error) = authorized(&inner, &lease) {
        return fail(&lease, failure_status(&error), error);
    }
    if method == Method::OPTIONS {
        let requested = request
            .headers()
            .get(header::ACCESS_CONTROL_REQUEST_METHOD)
            .and_then(|v| v.to_str().ok());
        let headers = request
            .headers()
            .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !matches!(requested, Some("GET" | "HEAD"))
            || headers
                .split(',')
                .map(str::trim)
                .any(|h| !h.is_empty() && !h.eq_ignore_ascii_case("range"))
        {
            return rejected(
                StatusCode::FORBIDDEN,
                errors::MEDIA_STREAM_PREFLIGHT_REJECTED(format!(
                    "메서드 {}, 헤더 {}",
                    requested.unwrap_or("(없음)"),
                    if headers.is_empty() {
                        "(없음)"
                    } else {
                        headers
                    }
                )),
            );
        }
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, &shared.origin)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
            .header(header::CACHE_CONTROL, "no-store")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::VARY, "Origin")
            .body(Body::empty())
            .unwrap();
    }
    let requested_range = if method == Method::HEAD {
        None
    } else {
        request
            .headers()
            .get(header::RANGE)
            .and_then(|v| v.to_str().ok())
    };
    let range = range::parse(requested_range, lease.len);
    let (start, end, status) = match range {
        Range::Full => (0, lease.len.saturating_sub(1), StatusCode::OK),
        Range::Partial(start, end) => (start, end, StatusCode::PARTIAL_CONTENT),
        Range::Invalid => {
            return fail(
                &lease,
                StatusCode::BAD_REQUEST,
                errors::MEDIA_STREAM_RANGE_INVALID(),
            )
        }
        Range::Unsatisfiable => {
            let mut response = fail(
                &lease,
                StatusCode::RANGE_NOT_SATISFIABLE,
                errors::MEDIA_STREAM_RANGE_UNSATISFIABLE(&lease.media.path),
            );
            response.headers_mut().insert(
                header::CONTENT_RANGE,
                format!("bytes */{}", lease.len).parse().unwrap(),
            );
            return response;
        }
    };
    let len = if status == StatusCode::PARTIAL_CONTENT {
        end - start + 1
    } else {
        lease.len
    };
    let mut response = Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, &shared.origin)
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Accept-Ranges, Content-Length",
        )
        .header(header::CONTENT_TYPE, &lease.mime)
        .header(header::CONTENT_LENGTH, len.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::VARY, "Origin");
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{}", lease.len),
        );
    }
    #[cfg(feature = "e2e")]
    inner.media_streams.observations.lock().unwrap().push((
        status.as_u16(),
        start,
        shared.origin.clone(),
    ));
    if method == Method::HEAD {
        return response.body(Body::empty()).unwrap();
    }
    let file = match tokio::fs::File::open(&lease.path).await {
        Ok(file) => file,
        Err(err) => {
            let error = open_error(&lease.media.path, err);
            return fail(&lease, failure_status(&error), error);
        }
    };
    let mut file = file;
    if let Err(err) = file.seek(io::SeekFrom::Start(start)).await {
        return fail(
            &lease,
            StatusCode::INTERNAL_SERVER_ERROR,
            errors::MEDIA_STREAM_SEEK_FAILED(&lease.media.path, err),
        );
    }
    let stream = futures_util::stream::unfold(
        (file, len, shared.cancel.subscribe(), lease),
        |(mut file, remaining, mut cancel, lease)| async move {
            if remaining == 0 || *cancel.borrow() {
                return None;
            }
            let mut bytes = vec![0; (remaining.min(64 * 1024)) as usize];
            let read = tokio::select! { result = file.read(&mut bytes) => result, _ = cancel.changed() => return None };
            match read {
                Ok(0) => {
                    let err = io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "파일을 끝까지 읽지 못했습니다",
                    );
                    *lease.error.lock().unwrap() = Some(read_error(&lease.media.path, &err));
                    Some((Err(err), (file, 0, cancel, lease)))
                }
                Ok(n) => {
                    bytes.truncate(n);
                    Some((Ok(bytes), (file, remaining - n as u64, cancel, lease)))
                }
                Err(err) => {
                    *lease.error.lock().unwrap() = Some(read_error(&lease.media.path, &err));
                    Some((Err(err), (file, 0, cancel, lease)))
                }
            }
        },
    );
    response.body(Body::from_stream(stream)).unwrap()
}
