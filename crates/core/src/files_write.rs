use std::path::PathBuf;
use std::sync::Arc;

use kaleidoscope_contract::{
    CoreError, CoreEvent, CoreReply, CoreRequest, ErrorCode, FileChange, FilesScope,
};

use crate::{error, files, CoreState, Inner};

mod ops;

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    // Resolve the grant while state is locked, then release the lock before any file operation.
    let authorization = {
        let state = inner.state.lock().unwrap();
        authorize(inner, &state, &request)?
    };

    match (request, authorization) {
        (
            CoreRequest::FilesWrite {
                window_id: _,
                permission: _,
                path,
                text,
                expected_revision,
            },
            Authorization::Write(root),
        ) => {
            let reply = ops::write(inner, &root, &path, &text, expected_revision.as_deref())?;
            emit_changes(
                inner,
                root,
                vec![FileChange {
                    from: None,
                    to: Some(path),
                }],
            );
            Ok(reply)
        }
        (
            CoreRequest::FilesMkdir {
                window_id: _,
                permission: _,
                parent,
                name,
            },
            Authorization::Write(root),
        ) => {
            let path = ops::mkdir(inner, &root, &parent, &name)?;
            emit_changes(
                inner,
                root,
                vec![FileChange {
                    from: None,
                    to: Some(path.clone()),
                }],
            );
            Ok(CoreReply::FilesMkdir { path })
        }
        (
            CoreRequest::FilesRename {
                window_id: _,
                permission: _,
                path,
                name,
            },
            Authorization::Write(root),
        ) => {
            let change = ops::rename(inner, &root, &path, &name)?;
            let reply = CoreReply::FilesRename {
                from: change.from.clone().unwrap_or_default(),
                to: change.to.clone().unwrap_or_default(),
            };
            emit_changes(inner, root, vec![change]);
            Ok(reply)
        }
        (
            CoreRequest::FilesMove {
                window_id: _,
                permission: _,
                paths,
                destination,
            },
            Authorization::Write(root),
        ) => {
            let results = ops::move_paths(inner, &root, &paths, &destination);
            emit_changes(inner, root, ops::successful_changes(&results));
            Ok(CoreReply::FilesMove { results })
        }
        (
            CoreRequest::FilesCopy {
                window_id: _,
                permission: _,
                paths,
                destination,
            },
            Authorization::Write(root),
        ) => {
            let results = ops::copy_paths(inner, &root, &paths, &destination);
            emit_changes(inner, root, ops::successful_changes(&results));
            Ok(CoreReply::FilesCopy { results })
        }
        (
            CoreRequest::FilesRemove {
                window_id: _,
                permission: _,
                paths,
                permanent,
            },
            Authorization::Write(root),
        ) => {
            let results = ops::remove_paths(inner, &root, &paths, permanent);
            emit_changes(inner, root, ops::successful_changes(&results));
            Ok(CoreReply::FilesRemove { results })
        }
        (
            CoreRequest::FilesReveal {
                window_id: _,
                permission: _,
                path: _,
            },
            Authorization::Read(resolved),
        ) => {
            inner
                .attachment_opener
                .reveal(&resolved)
                .map_err(|error| files::operation_io_error(&error))?;
            Ok(CoreReply::FilesReveal {})
        }
        (
            CoreRequest::FilesPath {
                window_id: _,
                permission: _,
                path: _,
            },
            Authorization::Read(resolved),
        ) => Ok(CoreReply::FilesPath {
            text: resolved.to_string_lossy().into_owned(),
        }),
        _ => Err(error::make(ErrorCode::InvalidRequest)),
    }
}

enum Authorization {
    Write(PathBuf),
    Read(PathBuf),
}

fn authorize(
    inner: &Inner,
    state: &CoreState,
    request: &CoreRequest,
) -> Result<Authorization, CoreError> {
    match request {
        CoreRequest::FilesWrite {
            window_id,
            permission,
            ..
        }
        | CoreRequest::FilesMkdir {
            window_id,
            permission,
            ..
        }
        | CoreRequest::FilesRename {
            window_id,
            permission,
            ..
        }
        | CoreRequest::FilesMove {
            window_id,
            permission,
            ..
        }
        | CoreRequest::FilesCopy {
            window_id,
            permission,
            ..
        }
        | CoreRequest::FilesRemove {
            window_id,
            permission,
            ..
        } => Ok(Authorization::Write(writable_root(
            state, window_id, permission,
        )?)),
        CoreRequest::FilesReveal {
            window_id,
            permission,
            path,
        }
        | CoreRequest::FilesPath {
            window_id,
            permission,
            path,
        } => Ok(Authorization::Read(ops::readable_path(
            inner, state, window_id, permission, path,
        )?)),
        _ => Err(error::make(ErrorCode::InvalidRequest)),
    }
}

fn emit_changes(inner: &Arc<Inner>, root: PathBuf, changes: Vec<FileChange>) {
    if !changes.is_empty() {
        inner.emit(&CoreEvent::FilesChanged {
            root: root.to_string_lossy().into_owned(),
            changes,
        });
    }
}

fn writable_root(state: &CoreState, window: &str, permission: &str) -> Result<PathBuf, CoreError> {
    files::permission(state, window, permission, true)?;
    if files::scope(state, window, permission)? == FilesScope::Pc {
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    files::granted_root(state, window, permission, true)
}
