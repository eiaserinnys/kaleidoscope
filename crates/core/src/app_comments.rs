//! 앱별 커멘트 메타는 상태로 전달하고 본문은 요청할 때 서버에서 읽는다.
use std::sync::{atomic::Ordering, Arc};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use kaleidoscope_contract::{
    app_comments::{
        AppCommentAppMeta, AppCommentImage, AppCommentListReply, AppCommentReply, AppCommentThread,
    },
    errors, CoreError, CoreReply, CoreRequest, LinkStatus,
};
use serde::Deserialize;

use crate::{
    link,
    registry_client::{CommentRequest, FailureStage, RegistryError},
    registry_events,
    storage::LinkFile,
    Inner,
};

pub(crate) fn apply_snapshot(
    inner: &Arc<Inner>,
    generation: u64,
    apps: Vec<AppCommentAppMeta>,
) -> Result<bool, CoreError> {
    let (current, event) = registry_events::apply_registry_change(inner, |state| {
        if !link::is_current(inner, generation) {
            return false;
        }
        state.shared.app_comments = Some(
            apps.into_iter()
                .map(|meta| (meta.app_id.clone(), meta))
                .collect(),
        );
        true
    })?;
    if let Some(event) = event {
        inner.emit_state(&event);
    }
    Ok(current)
}

pub(crate) fn apply_changed(
    inner: &Arc<Inner>,
    generation: u64,
    meta: AppCommentAppMeta,
) -> Result<bool, CoreError> {
    let (current, event) = registry_events::apply_registry_change(inner, |state| {
        if !link::is_current(inner, generation) {
            return false;
        }
        let apps = state
            .shared
            .app_comments
            .get_or_insert_with(Default::default);
        if apps
            .get(&meta.app_id)
            .is_none_or(|old| meta.revision > old.revision)
        {
            apps.insert(meta.app_id.clone(), meta);
        }
        true
    })?;
    if let Some(event) = event {
        inner.emit_state(&event);
    }
    Ok(current)
}

fn map_error(file: &LinkFile, error: RegistryError) -> CoreError {
    match error {
        RegistryError::Validation(error) => error,
        RegistryError::Failure { stage, detail, .. } => {
            let error = match stage {
                FailureStage::Send => errors::COMMENT_CLIENT_REQUEST_SEND_FAILED(),
                FailureStage::Status => errors::COMMENT_CLIENT_RESPONSE_STATUS_FAILED(),
                FailureStage::Read => errors::COMMENT_CLIENT_RESPONSE_READ_FAILED(),
            };
            error.and_details(vec![detail.replace(&file.token, "[가림]")])
        }
        RegistryError::Unauthorized | RegistryError::NotFound => {
            errors::COMMENT_CLIENT_RESPONSE_STATUS_FAILED()
        }
    }
}

fn send(
    inner: &Arc<Inner>,
    file: &LinkFile,
    generation: u64,
    request: CommentRequest<'_>,
) -> Result<Vec<u8>, CoreError> {
    if !link::is_current(inner, generation) {
        return Err(errors::SERVER_SWITCH_CANCELLED());
    }
    let result = inner
        .registry
        .app_comments_request(&file.server_url, &file.token, &request);
    if !link::is_current(inner, generation) {
        return Err(errors::SERVER_SWITCH_CANCELLED());
    }
    result.map_err(|error| map_error(file, error))
}

fn decode<T: serde::de::DeserializeOwned>(file: &LinkFile, bytes: &[u8]) -> Result<T, CoreError> {
    serde_json::from_slice(bytes).map_err(|error| {
        map_error(
            file,
            RegistryError::failure(FailureStage::Read, error.to_string()),
        )
    })
}

#[derive(Deserialize)]
struct ThreadReply {
    thread: AppCommentThread,
}
#[derive(Deserialize)]
struct ThreadMetaReply {
    thread: AppCommentThread,
    meta: AppCommentAppMeta,
}
#[derive(Deserialize)]
struct ReplyMetaReply {
    reply: AppCommentReply,
    meta: AppCommentAppMeta,
}
#[derive(Deserialize)]
struct MetaReply {
    meta: AppCommentAppMeta,
}

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    let (file, generation) = {
        let state = inner.state.lock().unwrap();
        if !matches!(state.link, LinkStatus::Connected { .. }) {
            return Err(errors::COMMENT_CLIENT_NOT_CONNECTED());
        }
        let file = inner
            .link_file
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(errors::COMMENT_CLIENT_NOT_CONNECTED)?;
        (file, inner.generation.load(Ordering::SeqCst))
    };
    let call = |method,
                app_id: &str,
                id: Option<&str>,
                suffix: Option<&str>,
                cursor: Option<&str>,
                body| {
        send(
            inner,
            &file,
            generation,
            CommentRequest {
                method,
                app_id,
                id,
                suffix,
                cursor,
                body,
            },
        )
    };
    let reply = match request {
        CoreRequest::CommentList { app_id, cursor } => {
            let bytes = call(
                reqwest::Method::GET,
                &app_id,
                None,
                None,
                cursor.as_deref(),
                None,
            )?;
            let AppCommentListReply {
                items,
                next_cursor,
                app_revision,
            } = decode(&file, &bytes)?;
            CoreReply::CommentList {
                items,
                next_cursor,
                app_revision,
            }
        }
        CoreRequest::CommentGet { app_id, id } => {
            let bytes = call(reqwest::Method::GET, &app_id, Some(&id), None, None, None)?;
            let ThreadReply { thread } = decode(&file, &bytes)?;
            CoreReply::CommentGet { thread }
        }
        CoreRequest::CommentCreate { app_id, request } => {
            let bytes = call(
                reqwest::Method::POST,
                &app_id,
                None,
                None,
                None,
                Some(serde_json::json!(request)),
            )?;
            let ThreadMetaReply { thread, meta } = decode(&file, &bytes)?;
            CoreReply::CommentCreate { thread, meta }
        }
        CoreRequest::CommentReply {
            app_id,
            id,
            request,
        } => {
            let bytes = call(
                reqwest::Method::POST,
                &app_id,
                Some(&id),
                Some("replies"),
                None,
                Some(serde_json::json!(request)),
            )?;
            let ReplyMetaReply { reply, meta } = decode(&file, &bytes)?;
            CoreReply::CommentReply { reply, meta }
        }
        CoreRequest::CommentResolve {
            app_id,
            id,
            request,
        } => {
            let bytes = call(
                reqwest::Method::PUT,
                &app_id,
                Some(&id),
                Some("resolved"),
                None,
                Some(serde_json::json!(request)),
            )?;
            let ThreadMetaReply { thread, meta } = decode(&file, &bytes)?;
            CoreReply::CommentResolve { thread, meta }
        }
        CoreRequest::CommentDelete { app_id, id } => {
            let bytes = call(
                reqwest::Method::DELETE,
                &app_id,
                Some(&id),
                None,
                None,
                None,
            )?;
            let MetaReply { meta } = decode(&file, &bytes)?;
            CoreReply::CommentDelete { meta }
        }
        CoreRequest::CommentMarkSent { app_id, ids } => {
            let bytes = call(
                reqwest::Method::POST,
                &app_id,
                None,
                Some("sent"),
                None,
                Some(serde_json::json!({"ids":ids})),
            )?;
            let MetaReply { meta } = decode(&file, &bytes)?;
            CoreReply::CommentMarkSent { meta }
        }
        CoreRequest::CommentMarkRead { app_id, id } => {
            let bytes = call(
                reqwest::Method::POST,
                &app_id,
                Some(&id),
                Some("read"),
                None,
                None,
            )?;
            let MetaReply { meta } = decode(&file, &bytes)?;
            CoreReply::CommentMarkRead { meta }
        }
        CoreRequest::CommentImage { app_id, id } => {
            let bytes = call(reqwest::Method::GET, &app_id, Some(&id), None, None, None)?;
            let ThreadReply { thread } = decode(&file, &bytes)?;
            let meta = thread
                .summary
                .image
                .ok_or_else(errors::COMMENT_IMAGE_NOT_FOUND)?;
            let bytes = call(
                reqwest::Method::GET,
                &app_id,
                Some(&id),
                Some("image"),
                None,
                None,
            )?;
            CoreReply::CommentImage {
                image: AppCommentImage {
                    meta,
                    image_base64: STANDARD.encode(bytes),
                },
            }
        }
        _ => unreachable!(),
    };
    let meta = match &reply {
        CoreReply::CommentCreate { meta, .. }
        | CoreReply::CommentReply { meta, .. }
        | CoreReply::CommentResolve { meta, .. }
        | CoreReply::CommentDelete { meta }
        | CoreReply::CommentMarkSent { meta }
        | CoreReply::CommentMarkRead { meta } => Some(meta),
        _ => None,
    };
    if let Some(meta) = meta {
        if !apply_changed(inner, generation, meta.clone())? {
            return Err(errors::SERVER_SWITCH_CANCELLED());
        }
    }
    Ok(reply)
}
