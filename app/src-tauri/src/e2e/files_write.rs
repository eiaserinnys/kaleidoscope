use std::fs::{self, File};
use std::path::Path;

#[cfg(windows)]
use std::fs::OpenOptions;

#[cfg(windows)]
use kaleidoscope_core::kaleidoscope_contract::ErrorCode;
use kaleidoscope_core::kaleidoscope_contract::{CoreReply, CoreRequest, FileOpResult};
use kaleidoscope_core::Core;
use serde_json::json;

use super::{call, record};
use tauri::AppHandle;

pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    folder: &Path,
    log: &mut File,
) -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(error) = core_scenario(app, core, folder, log) {
        record(
            log,
            "files-write.core-error",
            json!({"passed": false, "error": error}),
        )?;
        errors.push(error);
    }
    #[cfg(windows)]
    if let Err(error) = super::folder_drag::external_drop_guard(app, log) {
        record(
            log,
            "files-write.external-drop-guard",
            json!({"passed": false, "error": error}),
        )?;
        errors.push(error);
    }
    #[cfg(not(windows))]
    let _ = app;
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    record(
        log,
        "complete",
        json!({"scenario": "files-write", "passed": true}),
    )
}

fn core_scenario(
    app: &AppHandle,
    core: &Core,
    folder: &Path,
    log: &mut File,
) -> Result<(), String> {
    #[cfg(not(windows))]
    let _ = app;
    if !folder.is_dir() {
        return Err(format!("test folder is missing: {}", folder.display()));
    }
    if fs::read_dir(folder)
        .map_err(|error| error.to_string())?
        .next()
        .is_some()
    {
        return Err("files-write test folder must be empty".into());
    }
    let snapshot = match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot } => snapshot,
        reply => return Err(format!("unexpected state response: {reply:?}")),
    };
    let workspace = snapshot
        .device
        .active_workspace_id
        .ok_or("no active workspace")?;
    let desktop = snapshot
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("no active desktop")?
        .clone();
    let window_id = match call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop,
            app_id: "md-editor".into(),
            rect: None,
        },
    )? {
        CoreReply::WindowOpen { window } => window.id,
        reply => return Err(format!("unexpected editor response: {reply:?}")),
    };
    let grant = match call(
        core,
        CoreRequest::FilesPickFolder {
            window_id: window_id.clone(),
            permission: "docs".into(),
        },
    )? {
        CoreReply::FilesPickFolder { grant: Some(grant) } => grant,
        reply => return Err(format!("test folder was not granted: {reply:?}")),
    };
    if Path::new(&grant.root_path) != fs::canonicalize(folder).map_err(|error| error.to_string())? {
        return Err(format!("unexpected test folder grant: {grant:?}"));
    }

    let mut failures = Vec::new();
    macro_rules! check {
        ($name:expr, $body:block) => {
            if let Err(error) = (|| -> Result<(), String> { $body })() {
                record(log, $name, json!({"passed": false, "error": error}))?;
                failures.push(error);
            }
        };
    }

    check!("files-write.case-only-rename", {
        match call(
            core,
            CoreRequest::FilesMkdir {
                window_id: window_id.clone(),
                permission: "docs".into(),
                parent: String::new(),
                name: "created".into(),
            },
        )? {
            CoreReply::FilesMkdir { path } if path == "created" => {}
            reply => return Err(format!("unexpected mkdir response: {reply:?}")),
        }
        write_file(core, &window_id, "case.txt")?;
        match call(
            core,
            CoreRequest::FilesPath {
                window_id: window_id.clone(),
                permission: "docs".into(),
                path: "case.txt".into(),
            },
        )? {
            CoreReply::FilesPath { text } if Path::new(&text) == folder.join("case.txt") => {}
            reply => return Err(format!("unexpected absolute path response: {reply:?}")),
        }
        rename(core, &window_id, "case.txt", "CASE.txt")?;
        let actual_names = fs::read_dir(folder)
            .map_err(|error| error.to_string())?
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        if !actual_names
            .iter()
            .any(|name| name.to_string_lossy() == "CASE.txt")
        {
            return Err(format!(
                "case-only rename did not update the on-disk name: {actual_names:?}"
            ));
        }
        record(
            log,
            "files-write.case-only-rename",
            json!({"passed": true, "actual_name": "CASE.txt"}),
        )?;
        Ok(())
    });

    #[cfg(windows)]
    check!("files-write.file-busy-recovery", {
        write_file(core, &window_id, "locked.txt")?;
        use std::os::windows::fs::OpenOptionsExt;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(folder.join("locked.txt"))
            .map_err(|error| error.to_string())?;
        let error = match core.handle(CoreRequest::FilesRename {
            window_id: window_id.clone(),
            permission: "docs".into(),
            path: "locked.txt".into(),
            name: "unlocked.txt".into(),
        }) {
            Err(error) => error,
            Ok(_) => return Err("rename of a locked file should fail".into()),
        };
        if error.code != ErrorCode::FileBusy || !folder.join("locked.txt").exists() {
            return Err(format!("locked file did not report file_busy: {error:?}"));
        }
        drop(lock);
        rename(core, &window_id, "locked.txt", "unlocked.txt")?;
        record(
            log,
            "files-write.file-busy-recovery",
            json!({"error": error.code, "released_then_renamed": true}),
        )?;
        Ok(())
    });

    check!("files-write.trash", {
        write_file(core, &window_id, "trash-me.txt")?;
        let reply = call(
            core,
            CoreRequest::FilesRemove {
                window_id: window_id.clone(),
                permission: "docs".into(),
                paths: vec!["trash-me.txt".into()],
                permanent: false,
            },
        )?;
        if !matches!(
            &reply,
            CoreReply::FilesRemove { results }
                if matches!(results.as_slice(), [FileOpResult::Ok { path, .. }] if path == "trash-me.txt")
        ) || folder.join("trash-me.txt").exists()
        {
            return Err(format!("trash operation did not move the file: {reply:?}"));
        }
        record(
            log,
            "files-write.trash",
            json!({"source_absent": true, "used_system_trash": true}),
        )?;
        Ok(())
    });
    // 외부 OS 창을 여는 reveal은 네이티브 입력을 모두 보낸 뒤에 시험한다.
    #[cfg(windows)]
    check!("files-write.drag", {
        super::folder_drag::scenario(app, core, folder, log)?;
        Ok(())
    });
    check!("files-write.reveal", {
        write_file(core, &window_id, "reveal-me.txt")?;
        call(
            core,
            CoreRequest::FilesReveal {
                window_id: window_id.clone(),
                permission: "docs".into(),
                path: "reveal-me.txt".into(),
            },
        )?;
        record(log, "files-write.reveal", json!({"passed": true}))?;
        Ok(())
    });
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn write_file(core: &Core, window_id: &str, path: &str) -> Result<(), String> {
    match call(
        core,
        CoreRequest::FilesWrite {
            window_id: window_id.into(),
            permission: "docs".into(),
            path: path.into(),
            text: "test".into(),
            expected_revision: None,
        },
    )? {
        CoreReply::FilesWrite { .. } => Ok(()),
        reply => Err(format!("unexpected file write response: {reply:?}")),
    }
}

fn rename(core: &Core, window_id: &str, path: &str, name: &str) -> Result<(), String> {
    match call(
        core,
        CoreRequest::FilesRename {
            window_id: window_id.into(),
            permission: "docs".into(),
            path: path.into(),
            name: name.into(),
        },
    )? {
        CoreReply::FilesRename { from, to } if from == path && to == name => Ok(()),
        reply => Err(format!("unexpected rename response: {reply:?}")),
    }
}
