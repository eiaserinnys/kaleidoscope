use std::env;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use kaleidoscope_core::kaleidoscope_contract::{
    CoreEvent, CoreReply, CoreRequest, ErrorCode, Rect, WebHistoryAction, WebPage,
};
use kaleidoscope_core::Core;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

mod ui;
mod update;

fn resolve_setting(
    args: impl Iterator<Item = std::ffi::OsString>,
    name: &str,
    fallback: Option<std::ffi::OsString>,
) -> Option<std::ffi::OsString> {
    let prefix = format!("--e2e-{}=", name.to_ascii_lowercase());
    args.filter_map(|arg| {
        arg.to_str()
            .and_then(|value| value.strip_prefix(&prefix))
            .map(std::ffi::OsString::from)
    })
    .next()
    .or(fallback)
}

pub(crate) fn setting(name: &str) -> Option<std::ffi::OsString> {
    resolve_setting(
        env::args_os(),
        name,
        env::var_os(format!("KALEIDOSCOPE_E2E_{name}")),
    )
}

pub(crate) fn observe_ui(request: &CoreRequest) {
    ui::observe(request);
}

const IPC_TEST: &str = r#"
(async () => {
  try {
    if (!window.__TAURI_INTERNALS__?.invoke) throw new Error('unavailable');
    await window.__TAURI_INTERNALS__.invoke('core', {request: {op: 'state.get'}});
    location.hash = 'ipc-allowed';
  } catch (_) {
    location.hash = 'ipc-denied';
  }
})();
"#;

fn png_bytes(image: Option<&str>) -> Result<Vec<u8>, String> {
    let encoded = image
        .and_then(|image| image.strip_prefix("data:image/png;base64,"))
        .ok_or("web.capture did not return PNG data")?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("web.capture returned an invalid PNG signature".into());
    }
    Ok(bytes)
}

fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("invalid PNG".into());
    }
    Ok((
        u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
        u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
    ))
}

fn ipc_denied(url: &str) -> Result<(), String> {
    if url.ends_with("#ipc-denied") {
        Ok(())
    } else {
        Err(format!("child webview IPC was not denied: {url}"))
    }
}

fn record(log: &mut File, step: &str, data: Value) -> Result<(), String> {
    serde_json::to_writer(&mut *log, &json!({"step": step, "data": data}))
        .map_err(|error| error.to_string())?;
    writeln!(log).map_err(|error| error.to_string())?;
    log.flush().map_err(|error| error.to_string())
}

fn call(core: &Core, request: CoreRequest) -> Result<CoreReply, String> {
    core.handle(request).map_err(|error| format!("{error:?}"))
}

type Updates = mpsc::Receiver<(String, WebPage)>;

fn wait_page(
    updates: &Updates,
    log: &mut File,
    window_id: &str,
    description: &str,
    condition: impl Fn(&WebPage) -> bool,
) -> Result<WebPage, String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let timeout = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| format!("timed out waiting for {description}"))?;
        let (id, page) = updates
            .recv_timeout(timeout)
            .map_err(|error| format!("waiting for {description}: {error}"))?;
        record(log, "web.update", json!({"window_id": id, "page": page}))?;
        if id == window_id && condition(&page) {
            return Ok(page);
        }
    }
}

fn drain_updates(updates: &Updates, log: &mut File) -> Result<Option<WebPage>, String> {
    let mut latest = None;
    while let Ok((id, page)) = updates.try_recv() {
        record(log, "web.update", json!({"window_id": id, "page": page}))?;
        latest = Some(page);
    }
    Ok(latest)
}

fn screen(out: &Path, log: &mut File, name: &str) -> Result<(), String> {
    // 화면이 로드된 뒤 외부 프로세스가 화면을 찍을 때까지 창을 그대로 둔다.
    thread::sleep(Duration::from_millis(800));
    record(log, "capture.request", json!({"name": name}))?;
    fs::write(out.join(format!("{name}.request")), b"").map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while !out.join(format!("{name}.done")).is_file() {
        if Instant::now() >= deadline {
            return Err(format!("external capture timed out: {name}"));
        }
        thread::sleep(Duration::from_millis(100));
    }
    record(log, "capture.done", json!({"name": name}))
}

fn scenario(app: &AppHandle, core: &Core, out: &Path, log: &mut File) -> Result<(), String> {
    let (tx, updates) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::WebUpdate { window_id, page } = event {
            let _ = tx.send((window_id.clone(), page.clone()));
        }
    }));
    record(log, "start", json!({}))?;
    // 메인 웹뷰가 초기 상태를 읽어 창을 그릴 시간을 준다.
    thread::sleep(Duration::from_secs(3));
    let snapshot = match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot } => snapshot,
        reply => return Err(format!("unexpected state response: {reply:?}")),
    };
    let workspace = snapshot
        .device
        .active_workspace_id
        .ok_or("no active workspace")?;
    let desktop_id = snapshot
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("no active desktop")?
        .clone();
    let window_id = match call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop_id.clone(),
            app_id: "web-browser".into(),
            rect: Some(Rect {
                x: 48,
                y: 48,
                width: 880,
                height: 600,
            }),
        },
    )? {
        CoreReply::WindowOpen { window } => window.id,
        reply => return Err(format!("unexpected window response: {reply:?}")),
    };
    record(log, "window.open", json!({"window_id": window_id}))?;
    let page = match call(
        core,
        CoreRequest::WebAttach {
            window_id: window_id.clone(),
            url: "https://example.com/".into(),
        },
    )? {
        CoreReply::WebAttach { page } => page,
        reply => return Err(format!("unexpected attach response: {reply:?}")),
    };
    call(
        core,
        CoreRequest::WebPlace {
            window_id: window_id.clone(),
            bounds: Some(Rect {
                x: 120,
                y: 150,
                width: 700,
                height: 450,
            }),
        },
    )?;
    if !page.url.starts_with("https://example.com/") || page.loading {
        wait_page(&updates, log, &window_id, "example.com load", |page| {
            page.url.starts_with("https://example.com/") && !page.loading
        })?;
    }
    drain_updates(&updates, log)?;
    screen(out, log, "01-example-com")?;

    call(
        core,
        CoreRequest::WebNavigate {
            window_id: window_id.clone(),
            url: "https://example.org/".into(),
        },
    )?;
    wait_page(
        &updates,
        log,
        &window_id,
        "example.org load and history",
        |page| page.url.starts_with("https://example.org/") && !page.loading && page.can_go_back,
    )?;
    drain_updates(&updates, log)?;
    call(
        core,
        CoreRequest::WebHistory {
            window_id: window_id.clone(),
            action: WebHistoryAction::Back,
        },
    )?;
    let back = wait_page(&updates, log, &window_id, "back to example.com", |page| {
        page.url.starts_with("https://example.com/") && !page.loading
    })?;
    record(log, "history.back", json!({"url": back.url}))?;

    thread::sleep(Duration::from_millis(800));
    let image = match call(
        core,
        CoreRequest::WebCapture {
            window_id: window_id.clone(),
        },
    )? {
        CoreReply::WebCapture { image } => image,
        reply => return Err(format!("unexpected capture response: {reply:?}")),
    };
    let bytes = png_bytes(image.as_deref())?;
    fs::write(out.join("02-web-capture.png"), &bytes).map_err(|error| error.to_string())?;
    record(
        log,
        "web.capture",
        json!({"file": "02-web-capture.png", "bytes": bytes.len()}),
    )?;
    call(
        core,
        CoreRequest::WebPlace {
            window_id: window_id.clone(),
            bounds: None,
        },
    )?;
    screen(out, log, "03-hidden")?;

    drain_updates(&updates, log)?;
    for url in ["file:///C:/Windows/win.ini", "http://tauri.localhost/"] {
        let error = core
            .handle(CoreRequest::WebNavigate {
                window_id: window_id.clone(),
                url: url.into(),
            })
            .err()
            .ok_or_else(|| format!("forbidden navigation unexpectedly succeeded: {url}"))?;
        if error.code != ErrorCode::InvalidRequest {
            return Err(format!("unexpected error for {url}: {error:?}"));
        }
        thread::sleep(Duration::from_millis(300));
        if let Some(latest) = drain_updates(&updates, log)? {
            if latest.url != back.url {
                return Err(format!(
                    "URL changed after rejected navigation to {url}: {}",
                    latest.url
                ));
            }
        }
        record(
            log,
            "navigation.rejected",
            json!({"url": url, "current_url": back.url, "code": error.code}),
        )?;
    }

    app.get_webview(&format!("web-{window_id}"))
        .ok_or("child webview not found")?
        .eval(IPC_TEST)
        .map_err(|error| error.to_string())?;
    let page = wait_page(&updates, log, &window_id, "child IPC result", |page| {
        page.url.ends_with("#ipc-allowed") || page.url.ends_with("#ipc-denied")
    })?;
    record(log, "child.ipc", json!({"url": page.url}))?;
    ipc_denied(&page.url)?;
    let (editor_id, editor_bounds) = match call(
        core,
        CoreRequest::WindowOpen {
            desktop_id,
            app_id: "md-editor".into(),
            rect: Some(Rect {
                x: 48,
                y: 48,
                width: 500,
                height: 300,
            }),
        },
    )? {
        CoreReply::WindowOpen { window } => (window.id, window.rect),
        reply => return Err(format!("unexpected editor response: {reply:?}")),
    };
    thread::sleep(Duration::from_millis(800));
    #[cfg(windows)]
    {
        use kaleidoscope_core::WebHost;
        let host = super::web_host::TauriWebHost::new(app.clone());
        let (shell, scale) = host
            .capture_shell()
            .map_err(|error| error.message)?
            .ok_or("capture_shell returned no image")?;
        let cropped = kaleidoscope_core::crop_share_capture_png(&shell, editor_bounds, scale)
            .ok_or("could not crop share capture")?;
        let (width, height) = png_dimensions(&cropped)?;
        let expected_width = (editor_bounds.width as f64 * scale).round() as i64;
        let expected_height = (editor_bounds.height as f64 * scale).round() as i64;
        if (width as i64 - expected_width).abs() > 2 || (height as i64 - expected_height).abs() > 2
        {
            return Err(format!(
                "share capture size {width}x{height} differs from window bounds"
            ));
        }
        fs::write(out.join("share-capture.png"), &cropped).map_err(|error| error.to_string())?;
        record(
            log,
            "share.capture_shell",
            json!({
                "file": "share-capture.png", "width": width, "height": height, "scale": scale
            }),
        )?;
    }
    app.get_webview(&format!("web-{window_id}"))
        .ok_or("child webview disappeared before folder selection")?;
    record(
        log,
        "files.pick_folder.request",
        json!({"window_id": editor_id}),
    )?;
    let expected = fs::canonicalize(
        env::var_os("KALEIDOSCOPE_E2E_PICK_FOLDER").ok_or("folder selection fixture is missing")?,
    )
    .map_err(|error| error.to_string())?;
    let grant = match call(
        core,
        CoreRequest::FilesPickFolder {
            window_id: editor_id.clone(),
            permission: "docs".into(),
        },
    )? {
        CoreReply::FilesPickFolder { grant: Some(grant) } => grant,
        reply => return Err(format!("folder selection did not grant access: {reply:?}")),
    };
    if grant.window_id != editor_id
        || grant.permission != "docs"
        || Path::new(&grant.root_path) != expected
    {
        return Err(format!("unexpected folder grant: {grant:?}"));
    }
    let snapshot = match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot } => snapshot,
        reply => return Err(format!("unexpected state response: {reply:?}")),
    };
    if !snapshot.device.grants.contains(&grant) {
        return Err("folder grant was not saved in device state".into());
    }
    record(
        log,
        "files.pick_folder",
        json!({"window_id": editor_id, "permission": "docs", "granted": true}),
    )?;
    call(
        core,
        CoreRequest::WindowClose {
            window_id: window_id.clone(),
        },
    )?;
    if let Err(error) = ui::run(app, core, out, log) {
        let _ = record(log, "ui.error", json!({"message": error}));
        let _ = screen(out, log, "99-ui-failure");
        return Err(error);
    }
    record(log, "complete", json!({"ok": true}))
}

pub fn start(app: AppHandle, core: Arc<Core>) {
    #[cfg(windows)]
    update::record_startup(&app);
    let Some(out) = setting("OUT") else {
        return;
    };
    thread::spawn(move || {
        let out = PathBuf::from(out);
        let update_scenario = matches!(
            setting("SCENARIO")
                .as_deref()
                .and_then(std::ffi::OsStr::to_str),
            Some("update" | "update-reject")
        );
        let status = match fs::create_dir_all(&out).and_then(|_| {
            if update_scenario {
                fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(out.join("events.jsonl"))
            } else {
                File::create(out.join("events.jsonl"))
            }
        }) {
            Ok(mut log) => match if update_scenario {
                update::scenario(&app, &core, &out, &mut log)
            } else {
                scenario(&app, &core, &out, &mut log)
            } {
                Ok(()) => 0,
                Err(error) => {
                    let _ = record(&mut log, "error", json!({"message": error}));
                    eprintln!("E2E 실패: {error}");
                    1
                }
            },
            Err(error) => {
                eprintln!("E2E 로그 생성 실패: {error}");
                1
            }
        };
        app.exit(status);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_arguments_override_environment_and_preserve_fallback() {
        use std::ffi::OsString;
        let args = || {
            vec![
                OsString::from("app.exe"),
                OsString::from("--e2e-scenario=update"),
                OsString::from("--e2e-out=C:/시험 폴더"),
            ]
            .into_iter()
        };
        assert_eq!(
            resolve_setting(args(), "SCENARIO", Some("update-reject".into())),
            Some("update".into())
        );
        assert_eq!(
            resolve_setting(args(), "OUT", Some("old".into())),
            Some("C:/시험 폴더".into())
        );
        assert_eq!(
            resolve_setting(std::iter::empty(), "SCENARIO", Some("update-reject".into())),
            Some("update-reject".into())
        );
        assert_eq!(resolve_setting(std::iter::empty(), "OUT", None), None);
    }

    #[test]
    fn png_check_rejects_missing_and_non_png_data() {
        assert!(png_bytes(None).is_err());
        assert!(png_bytes(Some("data:image/png;base64,AA==")).is_err());
        assert_eq!(
            png_bytes(Some("data:image/png;base64,iVBORw0KGgo=")).unwrap(),
            b"\x89PNG\r\n\x1a\n"
        );
    }

    #[test]
    fn ipc_check_rejects_allowed_or_missing_result() {
        assert!(ipc_denied("https://example.com/#ipc-allowed").is_err());
        assert!(ipc_denied("https://example.com/").is_err());
        assert!(ipc_denied("https://example.com/#ipc-denied").is_ok());
    }
}
