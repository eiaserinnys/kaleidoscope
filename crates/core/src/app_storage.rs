//! 창에서 앱과 작업을 해석해 선언된 저장 항목만 기기 API에 전달한다.
use crate::{app_commands, error, link, registry_client::RegistryError, storage::LinkFile, Inner};
use kaleidoscope_contract::app_storage::{
    ExpectedRevision, StorageListReply, StorageReadReply, StorageResetRequest, StorageWriteRequest,
};
use kaleidoscope_contract::{CoreError, CoreReply, CoreRequest, ErrorCode, LinkStatus};
use serde_json::Value;
use std::sync::Arc;

pub(crate) struct Context {
    pub(crate) app: String,
    pub(crate) workspace: String,
    pub(crate) link: LinkFile,
}

pub(crate) fn context(
    inner: &Inner,
    window_id: &str,
    entry: Option<&str>,
) -> Result<Context, CoreError> {
    let state = inner.state.lock().unwrap();
    let window = state
        .shared
        .windows
        .iter()
        .find(|w| w.id == window_id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let desktop = state
        .shared
        .desktops
        .iter()
        .find(|d| d.id == window.desktop_id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let definition =
        app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let declaration = definition
        .storage
        .as_ref()
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
    if entry.is_some_and(|id| !declaration.entries.iter().any(|item| item.id == id)) {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    if !matches!(state.link, LinkStatus::Connected { .. }) {
        return Err(error::make(ErrorCode::Unavailable));
    }
    let link = inner
        .link_file
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| error::make(ErrorCode::Unavailable))?;
    Ok(Context {
        app: window.app_id.clone(),
        workspace: desktop.workspace_id.clone(),
        link,
    })
}

pub(crate) fn map_error(inner: &Arc<Inner>, file: &LinkFile, err: RegistryError) -> CoreError {
    if matches!(err, RegistryError::Unauthorized) {
        link::token_rejected(inner, file.clone());
    }
    link::registry_error_to_core(err, "저장소에 연결할 수 없습니다.")
}

pub(crate) fn list(inner: &Arc<Inner>, window: &str) -> Result<StorageListReply, CoreError> {
    let ctx = context(inner, window, None)?;
    inner
        .registry
        .storage_list(
            &ctx.link.server_url,
            &ctx.link.token,
            &ctx.app,
            &ctx.workspace,
        )
        .map_err(|e| map_error(inner, &ctx.link, e))
}

pub(crate) fn read(
    inner: &Arc<Inner>,
    window: &str,
    entry: &str,
) -> Result<StorageReadReply, CoreError> {
    let ctx = context(inner, window, Some(entry))?;
    inner
        .registry
        .storage_get(
            &ctx.link.server_url,
            &ctx.link.token,
            &ctx.app,
            entry,
            &ctx.workspace,
        )
        .map_err(|e| map_error(inner, &ctx.link, e))
}

pub(crate) fn write(
    inner: &Arc<Inner>,
    window: &str,
    entry: &str,
    content: Value,
    expected_revision: ExpectedRevision,
) -> Result<String, CoreError> {
    let ctx = context(inner, window, Some(entry))?;
    let reply = inner
        .registry
        .storage_write(
            &ctx.link.server_url,
            &ctx.link.token,
            &ctx.app,
            entry,
            &ctx.workspace,
            &StorageWriteRequest {
                content,
                expected_revision,
            },
        )
        .map_err(|e| map_error(inner, &ctx.link, e))?;
    Ok(reply.revision)
}

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    match request {
        CoreRequest::StorageGet { window_id, entry } => Ok(CoreReply::StorageGet {
            result: read(inner, &window_id, &entry)?,
        }),
        CoreRequest::StorageWrite {
            window_id,
            entry,
            content,
            expected_revision,
        } => Ok(CoreReply::StorageWrite {
            revision: write(inner, &window_id, &entry, content, expected_revision)?,
        }),
        CoreRequest::StorageReset {
            window_id,
            entry,
            expected_revision,
        } => {
            let ctx = context(inner, &window_id, Some(&entry))?;
            let result = inner
                .registry
                .storage_reset(
                    &ctx.link.server_url,
                    &ctx.link.token,
                    &ctx.app,
                    &entry,
                    &ctx.workspace,
                    &StorageResetRequest { expected_revision },
                )
                .map_err(|e| map_error(inner, &ctx.link, e))?;
            Ok(CoreReply::StorageReset {
                revision: result.revision,
            })
        }
        _ => Err(error::make(ErrorCode::InvalidRequest)),
    }
}
