use std::env;
use std::fs::{self, File};
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use kaleidoscope_core::kaleidoscope_contract::{
    CoreReply, CoreRequest, ShellSnapshot, UpdateStatus,
};
use kaleidoscope_core::Core;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{call, record, screen};

#[cfg(windows)]
pub(super) fn record_startup(app: &AppHandle) {
    let path = env::temp_dir().join(format!(
        "kaleidoscope-e2e-start-{}.json",
        std::process::id()
    ));
    let entry = json!({
        "pid": std::process::id(),
        "version": app.package_info().version.to_string(),
        "executable": env::current_exe().ok(),
        "scenario": env::var("KALEIDOSCOPE_E2E_SCENARIO").ok(),
        "out": env::var("KALEIDOSCOPE_E2E_OUT").ok(),
    });
    if let Err(error) = fs::write(path, entry.to_string()) {
        eprintln!("E2E 기동 기록 실패: {error}");
    }
}

fn snapshot(core: &Core) -> Result<ShellSnapshot, String> {
    match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot } => Ok(snapshot),
        reply => Err(format!("unexpected state response: {reply:?}")),
    }
}

fn check_restored(snapshot: &ShellSnapshot, ids: &Value) -> Result<(), String> {
    let workspace = ids["workspace_id"].as_str().ok_or("missing workspace id")?;
    let desktop = ids["desktop_id"].as_str().ok_or("missing desktop id")?;
    let window = ids["window_id"].as_str().ok_or("missing window id")?;
    if !snapshot.shared.workspaces.iter().any(|w| w.id == workspace)
        || !snapshot
            .shared
            .desktops
            .iter()
            .any(|d| d.id == desktop && d.workspace_id == workspace)
        || !snapshot
            .shared
            .windows
            .iter()
            .any(|w| w.id == window && w.desktop_id == desktop && w.app_id == "md-editor")
    {
        return Err("workspace, desktop or editor window was not restored".into());
    }
    Ok(())
}

pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    log: &mut File,
) -> Result<(), String> {
    let version = app.package_info().version.to_string();
    let reject = env::var("KALEIDOSCOPE_E2E_SCENARIO").as_deref() == Ok("update-reject");
    record(log, "start", json!({"version": version, "reject": reject}))?;
    if version == "0.0.2" && !reject {
        let ids: Value =
            serde_json::from_slice(&fs::read(out.join("ids.json")).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        check_restored(&snapshot(core)?, &ids)?;
        return record(log, "complete", json!({"version": version, "ids": ids}));
    }
    if version != "0.0.1" {
        return Err(format!("unexpected version: {version}"));
    }
    if !reject {
        let (workspace_id, desktop_id) = match call(
            core,
            CoreRequest::WorkspaceCreate {
                name: "업데이트 시험".into(),
            },
        )? {
            CoreReply::WorkspaceCreate { workspace, desktop } => (workspace.id, desktop.id),
            reply => return Err(format!("unexpected workspace response: {reply:?}")),
        };
        let window_id = match call(
            core,
            CoreRequest::WindowOpen {
                desktop_id: desktop_id.clone(),
                app_id: "md-editor".into(),
                rect: None,
            },
        )? {
            CoreReply::WindowOpen { window } => window.id,
            reply => return Err(format!("unexpected window response: {reply:?}")),
        };
        let ids =
            json!({"workspace_id": workspace_id, "desktop_id": desktop_id, "window_id": window_id});
        fs::write(
            out.join("ids.json"),
            serde_json::to_vec(&ids).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        record(log, "seed", ids)?;
    }
    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline {
        match snapshot(core)?.update {
            UpdateStatus::Ready { version, .. } => {
                record(log, "ready", json!({"version": version}))?;
                if reject || version != "0.0.2" {
                    return Err("unexpected ready update".into());
                }
                screen(out, log, "update-ready")?;
                record(log, "restart.request", json!({"version": version}))?;
                call(core, CoreRequest::UpdateRestart {})?;
                return Err("update restart returned without exiting".into());
            }
            UpdateStatus::Failed {
                version, reason, ..
            } => {
                record(log, "failed", json!({"version": version, "reason": reason}))?;
                if reject
                    && version.as_deref() == Some("0.0.2")
                    && reason == "서명이 맞지 않아 깔지 않았습니다"
                {
                    return Ok(());
                }
                return Err("unexpected update failure".into());
            }
            _ => thread::sleep(Duration::from_millis(100)),
        }
    }
    Err("update status timed out".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restoration_check_rejects_missing_entities() {
        let snapshot: ShellSnapshot = serde_json::from_value(json!({
            "shared": {"apps": [], "app_versions": [], "workspaces": [], "desktops": [], "windows": []},
            "device": {"active_workspace_id": null, "active_desktop_ids": {}, "grants": []},
            "supported": {"blocks": 1, "modules": {}},
            "link": {"state": "unlinked"}, "sharing": [], "update": {"state": "unavailable"}
        })).unwrap();
        assert!(check_restored(
            &snapshot,
            &json!({"workspace_id":"w", "desktop_id":"d", "window_id":"x"})
        )
        .is_err());
    }
}
