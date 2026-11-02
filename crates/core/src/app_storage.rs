//! 창에서 앱과 작업을 해석해 선언된 저장 항목만 기기 API에 전달한다.
use crate::{app_commands, error, link, registry_client::RegistryError, storage::LinkFile, Inner};
use kaleidoscope_contract::app_storage::{
    self as contract, CollectionListReply, CollectionMove, ExpectedRevision, StorageListReply,
    StorageReadReply, StorageResetRequest, StorageWriteRequest,
};
use kaleidoscope_contract::{CoreError, CoreReply, CoreRequest, ErrorCode, LinkStatus};
use serde_json::Value;
use std::sync::Arc;

pub(crate) struct Context {
    pub(crate) app: String,
    pub(crate) workspace: String,
    pub(crate) link: LinkFile,
    pub(crate) entries: Vec<contract::StorageEntryDecl>,
}

pub(crate) fn uses_defaults(inner: &Inner) -> bool {
    let state = inner.state.lock().unwrap();
    uses_defaults_for(&state, inner.link_file.lock().unwrap().is_some())
}

pub(crate) fn uses_defaults_for(state: &crate::CoreState, has_link: bool) -> bool {
    matches!(state.link, LinkStatus::Unlinked {})
        || (matches!(state.link, LinkStatus::Pairing { .. }) && !has_link)
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
        entries: declaration.entries.clone(),
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
    if kaleidoscope_contract::builtin::is_builtin(&ctx.app) {
        match inner
            .registry
            .values_list(&ctx.link.server_url, &ctx.link.token, &ctx.app)
        {
            Ok(list) => {
                let items = ctx
                    .entries
                    .iter()
                    .filter(|entry| !entry.collection)
                    .map(|entry| {
                        let key = entry.key.replace("{workspace_id}", &ctx.workspace);
                        let stored = list.items.iter().find(|item| item.key == key);
                        contract::StorageItemMeta {
                            entry_id: entry.id.clone(),
                            key,
                            kind: entry.kind,
                            revision: stored.and_then(|item| item.revision.clone()),
                            exists: stored.is_some(),
                        }
                    })
                    .collect();
                return Ok(StorageListReply {
                    bucket_id: list.bucket_id,
                    items,
                });
            }
            Err(RegistryError::NotFound) => {}
            Err(err) => return Err(map_error(inner, &ctx.link, err)),
        }
    }
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

fn list_collection(
    inner: &Arc<Inner>,
    window: &str,
    entry: &str,
) -> Result<CollectionListReply, CoreError> {
    let ctx = context(inner, window, Some(entry))?;
    let decl = ctx.entries.iter().find(|item| item.id == entry).unwrap();
    if !decl.collection {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    let reply = if kaleidoscope_contract::builtin::is_builtin(&ctx.app) {
        let prefix = decl.key.replace("{workspace_id}", &ctx.workspace);
        inner.registry.values_collection_list(
            &ctx.link.server_url,
            &ctx.link.token,
            &ctx.app,
            &prefix,
            decl.key
                .contains("{workspace_id}")
                .then_some(ctx.workspace.as_str()),
        )
    } else {
        inner.registry.storage_collection_list(
            &ctx.link.server_url,
            &ctx.link.token,
            &ctx.app,
            entry,
            &ctx.workspace,
        )
    }
    .map_err(|error| map_error(inner, &ctx.link, error))?;
    Ok(reply)
}

pub(crate) fn read(
    inner: &Arc<Inner>,
    window: &str,
    entry: &str,
) -> Result<StorageReadReply, CoreError> {
    read_with_doc(inner, window, entry, None)
}

fn read_with_doc(
    inner: &Arc<Inner>,
    window: &str,
    entry: &str,
    doc: Option<&str>,
) -> Result<StorageReadReply, CoreError> {
    {
        let state = inner.state.lock().unwrap();
        let unlinked = uses_defaults_for(&state, inner.link_file.lock().unwrap().is_some());
        if unlinked {
            let window = state
                .shared
                .windows
                .iter()
                .find(|w| w.id == window)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let definition =
                app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                    .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let item = definition
                .storage
                .as_ref()
                .and_then(|storage| storage.entries.iter().find(|item| item.id == entry))
                .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
            if item.collection {
                return Err(error::make(ErrorCode::Unavailable));
            }
            return Ok(StorageReadReply {
                kind: item.kind,
                content: item.default.clone(),
                revision: None,
                exists: false,
            });
        }
    }
    let ctx = context(inner, window, Some(entry))?;
    let decl = ctx.entries.iter().find(|item| item.id == entry).unwrap();
    if decl.collection {
        let doc = doc.ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
        if !contract::valid_collection_doc(doc) {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        if kaleidoscope_contract::builtin::is_builtin(&ctx.app) {
            let prefix = decl.key.replace("{workspace_id}", &ctx.workspace);
            let key = format!("{prefix}/{doc}");
            let raw = inner
                .registry
                .values_collection_read(
                    &ctx.link.server_url,
                    &ctx.link.token,
                    &ctx.app,
                    &key,
                    decl.key
                        .contains("{workspace_id}")
                        .then_some(ctx.workspace.as_str()),
                )
                .map_err(|error| map_error(inner, &ctx.link, error))?;
            if !raw.exists {
                return Err(error::make(ErrorCode::NotFound));
            }
            let kind = raw
                .kind
                .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
            let content = raw
                .content
                .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
            if kind != decl.kind || contract::validate_storage_content(decl, &content).is_err() {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            return Ok(StorageReadReply {
                kind,
                content,
                revision: raw.revision,
                exists: true,
            });
        }
        return inner
            .registry
            .storage_document_get(
                &ctx.link.server_url,
                &ctx.link.token,
                &ctx.app,
                entry,
                doc,
                &ctx.workspace,
            )
            .map_err(|error| map_error(inner, &ctx.link, error));
    }
    if doc.is_some() {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    if kaleidoscope_contract::builtin::is_builtin(&ctx.app) {
        let key = decl.key.replace("{workspace_id}", &ctx.workspace);
        match inner
            .registry
            .values_get(&ctx.link.server_url, &ctx.link.token, &ctx.app, &key)
        {
            Ok(raw) => {
                let content = if raw.exists {
                    raw.content.unwrap_or(Value::Null)
                } else {
                    decl.default.clone()
                };
                if raw.exists
                    && (raw.kind != Some(decl.kind)
                        || contract::validate_storage_content(decl, &content).is_err())
                {
                    return Err(error::with_message(
                        ErrorCode::InvalidRequest,
                        "저장된 값이 앱의 저장소 선언과 다릅니다",
                    ));
                }
                return Ok(StorageReadReply {
                    kind: decl.kind,
                    content,
                    revision: raw.revision,
                    exists: raw.exists,
                });
            }
            Err(RegistryError::NotFound) => {}
            Err(err) => return Err(map_error(inner, &ctx.link, err)),
        }
    }
    match inner.registry.storage_get(
        &ctx.link.server_url,
        &ctx.link.token,
        &ctx.app,
        entry,
        &ctx.workspace,
    ) {
        Ok(reply) => Ok(reply),
        Err(RegistryError::NotFound) if kaleidoscope_contract::builtin::is_builtin(&ctx.app) => {
            let decl = ctx.entries.iter().find(|item| item.id == entry).unwrap();
            Ok(StorageReadReply {
                kind: decl.kind,
                content: decl.default.clone(),
                revision: None,
                exists: false,
            })
        }
        Err(err) => Err(map_error(inner, &ctx.link, err)),
    }
}

pub(crate) fn write(
    inner: &Arc<Inner>,
    window: &str,
    entry: &str,
    content: Value,
    expected_revision: ExpectedRevision,
) -> Result<String, CoreError> {
    write_with_doc(inner, window, entry, None, content, expected_revision)
}

fn write_with_doc(
    inner: &Arc<Inner>,
    window: &str,
    entry: &str,
    doc: Option<&str>,
    content: Value,
    expected_revision: ExpectedRevision,
) -> Result<String, CoreError> {
    let ctx = context(inner, window, Some(entry))?;
    let decl = ctx.entries.iter().find(|item| item.id == entry).unwrap();
    if decl.collection {
        let doc = doc.ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
        if !contract::valid_collection_doc(doc) {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        contract::validate_storage_content(decl, &content)
            .map_err(|message| error::with_message(ErrorCode::InvalidRequest, &message))?;
        let request = StorageWriteRequest {
            content,
            expected_revision,
        };
        let reply = if kaleidoscope_contract::builtin::is_builtin(&ctx.app) {
            let prefix = decl.key.replace("{workspace_id}", &ctx.workspace);
            let key = format!("{prefix}/{doc}");
            inner.registry.values_write(
                &ctx.link.server_url,
                &ctx.link.token,
                &ctx.app,
                &key,
                &contract::AppValueWrite {
                    kind: decl.kind,
                    content: request.content,
                    expected_revision: request.expected_revision,
                    workspace_id: decl
                        .key
                        .contains("{workspace_id}")
                        .then(|| ctx.workspace.clone()),
                },
            )
        } else {
            inner.registry.storage_document_write(
                &ctx.link.server_url,
                &ctx.link.token,
                &ctx.app,
                entry,
                doc,
                &ctx.workspace,
                &request,
            )
        }
        .map_err(|error| map_error(inner, &ctx.link, error))?;
        crate::conversation_reconcile::storage_changed(inner, &ctx.app, Some(entry));
        return Ok(reply.revision);
    }
    if doc.is_some() {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    if kaleidoscope_contract::builtin::is_builtin(&ctx.app) {
        contract::validate_storage_content(decl, &content)
            .map_err(|message| error::with_message(ErrorCode::InvalidRequest, &message))?;
        let key = decl.key.replace("{workspace_id}", &ctx.workspace);
        let request = contract::AppValueWrite {
            kind: decl.kind,
            content: content.clone(),
            expected_revision: expected_revision.clone(),
            workspace_id: decl
                .key
                .contains("{workspace_id}")
                .then(|| ctx.workspace.clone()),
        };
        match inner.registry.values_write(
            &ctx.link.server_url,
            &ctx.link.token,
            &ctx.app,
            &key,
            &request,
        ) {
            Ok(reply) => {
                crate::conversation_reconcile::storage_changed(inner, &ctx.app, Some(entry));
                return Ok(reply.revision);
            }
            Err(RegistryError::NotFound) => {}
            Err(err) => return Err(map_error(inner, &ctx.link, err)),
        }
    }
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
    crate::conversation_reconcile::storage_changed(inner, &ctx.app, Some(entry));
    Ok(reply.revision)
}

pub(crate) fn write_action_with_doc(
    inner: &Arc<Inner>,
    window: &str,
    entry: &str,
    doc: &str,
    content: Value,
) -> Result<String, CoreError> {
    let expected_revision = match read_with_doc(inner, window, entry, Some(doc)) {
        Ok(current) => current.revision,
        Err(error) if error.code == ErrorCode::NotFound => None,
        Err(error) => return Err(error),
    };
    write_with_doc(
        inner,
        window,
        entry,
        Some(doc),
        content,
        ExpectedRevision(expected_revision),
    )
}

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    match request {
        CoreRequest::StorageGet {
            window_id,
            entry,
            doc,
        } => Ok(CoreReply::StorageGet {
            result: read_with_doc(inner, &window_id, &entry, doc.as_deref())?,
        }),
        CoreRequest::StorageList { window_id, entry } => Ok(CoreReply::StorageList {
            result: list_collection(inner, &window_id, &entry)?,
        }),
        CoreRequest::StorageWrite {
            window_id,
            entry,
            doc,
            content,
            expected_revision,
        } => Ok(CoreReply::StorageWrite {
            revision: write_with_doc(
                inner,
                &window_id,
                &entry,
                doc.as_deref(),
                content,
                expected_revision,
            )?,
        }),
        CoreRequest::StorageReset {
            window_id,
            entry,
            doc,
            expected_revision,
        } => {
            let ctx = context(inner, &window_id, Some(&entry))?;
            let decl = ctx.entries.iter().find(|item| item.id == entry).unwrap();
            if decl.collection {
                let doc = doc
                    .as_deref()
                    .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
                if !contract::valid_collection_doc(doc) || expected_revision.0.is_none() {
                    return Err(error::make(ErrorCode::InvalidRequest));
                }
                let request = StorageResetRequest { expected_revision };
                let reply = if kaleidoscope_contract::builtin::is_builtin(&ctx.app) {
                    let prefix = decl.key.replace("{workspace_id}", &ctx.workspace);
                    let key = format!("{prefix}/{doc}");
                    inner.registry.values_collection_reset(
                        &ctx.link.server_url,
                        &ctx.link.token,
                        &ctx.app,
                        &key,
                        decl.key
                            .contains("{workspace_id}")
                            .then_some(ctx.workspace.as_str()),
                        &request,
                    )
                } else {
                    inner.registry.storage_document_reset(
                        &ctx.link.server_url,
                        &ctx.link.token,
                        &ctx.app,
                        &entry,
                        doc,
                        &ctx.workspace,
                        &request,
                    )
                }
                .map_err(|error| map_error(inner, &ctx.link, error))?;
                crate::conversation_reconcile::storage_changed(inner, &ctx.app, Some(&entry));
                return Ok(CoreReply::StorageReset {
                    revision: reply.revision,
                });
            }
            if doc.is_some() {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            if kaleidoscope_contract::builtin::is_builtin(&ctx.app) {
                let key = decl.key.replace("{workspace_id}", &ctx.workspace);
                match inner.registry.values_reset(
                    &ctx.link.server_url,
                    &ctx.link.token,
                    &ctx.app,
                    &key,
                    &StorageResetRequest {
                        expected_revision: expected_revision.clone(),
                    },
                ) {
                    Ok(result) => {
                        crate::conversation_reconcile::storage_changed(
                            inner,
                            &ctx.app,
                            Some(&entry),
                        );
                        return Ok(CoreReply::StorageReset {
                            revision: result.revision,
                        });
                    }
                    Err(RegistryError::NotFound) => {}
                    Err(err) => return Err(map_error(inner, &ctx.link, err)),
                }
            }
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
            crate::conversation_reconcile::storage_changed(inner, &ctx.app, Some(&entry));
            Ok(CoreReply::StorageReset {
                revision: result.revision,
            })
        }
        CoreRequest::StorageMove {
            window_id,
            entry,
            from,
            to,
            expected_revision,
        } => {
            if !contract::valid_collection_doc(&from) || !contract::valid_collection_doc(&to) {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            let ctx = context(inner, &window_id, Some(&entry))?;
            let decl = ctx.entries.iter().find(|item| item.id == entry).unwrap();
            if !decl.collection {
                return Err(error::make(ErrorCode::InvalidRequest));
            }
            let request = CollectionMove {
                from: from.clone(),
                to: to.clone(),
                expected_revision,
            };
            let reply = if kaleidoscope_contract::builtin::is_builtin(&ctx.app) {
                let prefix = decl.key.replace("{workspace_id}", &ctx.workspace);
                inner.registry.values_collection_move(
                    &ctx.link.server_url,
                    &ctx.link.token,
                    &ctx.app,
                    &contract::AppValueMoveRequest {
                        operation: "move".into(),
                        from_key: format!("{prefix}/{from}"),
                        to_key: format!("{prefix}/{to}"),
                        expected_revision: request.expected_revision,
                    },
                    decl.key
                        .contains("{workspace_id}")
                        .then_some(ctx.workspace.as_str()),
                )
            } else {
                inner.registry.storage_document_move(
                    &ctx.link.server_url,
                    &ctx.link.token,
                    &ctx.app,
                    &entry,
                    &ctx.workspace,
                    &request,
                )
            }
            .map_err(|error| map_error(inner, &ctx.link, error))?;
            crate::conversation_reconcile::storage_changed(inner, &ctx.app, Some(&entry));
            Ok(CoreReply::StorageMove {
                revision: reply.revision,
            })
        }
        _ => Err(error::make(ErrorCode::InvalidRequest)),
    }
}
