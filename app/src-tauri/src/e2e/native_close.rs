//! 실제 X(WM_CLOSE)와 Alt+F4가 마지막 편집을 저장한 뒤에만 프로그램을 닫는지 확인한다.
//!
//! 닫기 요청 뒤에는 시나리오가 스스로 끝나지 않는다. 공통 종료(app.exit)를 타면
//! 저장하지 않고 닫히는 결함을 가리므로, 프로세스는 셸의 `shell_finish_close` 경로로만 끝난다.
use std::fs::{self, File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use kaleidoscope_core::kaleidoscope_contract::{CoreReply, CoreRequest, Rect};
use kaleidoscope_core::Core;
use serde_json::json;
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, IsWindowVisible, PostMessageW, WM_CLOSE,
};

use super::share_isolate::native_input;
use super::{call, record, setting};
use super::ui;

const FILE_NAME: &str = "note.md";
const TYPED: &str = "native close keeps the last edit";

#[derive(Clone, Copy)]
enum Method {
    /// 실제 X 버튼과 같은 창 메시지.
    Hwnd,
    /// 실제 키보드 Alt+F4.
    AltF4,
}

impl Method {
    fn name(self) -> &'static str {
        match self {
            Method::Hwnd => "hwnd",
            Method::AltF4 => "alt-f4",
        }
    }
}

fn method() -> Result<Method, String> {
    match setting("NATIVE_CLOSE_METHOD")
        .as_deref()
        .and_then(std::ffi::OsStr::to_str)
    {
        None | Some("hwnd") => Ok(Method::Hwnd),
        Some("alt-f4") => Ok(Method::AltF4),
        Some(other) => Err(format!("unknown native close method: {other}")),
    }
}

fn flagged(name: &str) -> bool {
    setting(name).as_deref().and_then(std::ffi::OsStr::to_str) == Some("1")
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

fn main_hwnd(app: &AppHandle) -> Result<HWND, String> {
    let window = app.get_window("main").ok_or("main window missing")?;
    let raw = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
    Ok(HWND(raw as *mut core::ffi::c_void))
}

fn request_close(
    method: Method,
    hwnd: HWND,
    input_ms: u128,
    second: bool,
    log: &mut File,
) -> Result<(), String> {
    let close_ms = now_ms();
    let foreground = unsafe { super::native_target::describe(GetForegroundWindow()) };
    record(
        log,
        "native-close.request",
        json!({
            "method": method.name(),
            "second": second,
            "input_ms": input_ms,
            "close_ms": close_ms,
            "delta_ms": close_ms.saturating_sub(input_ms),
            "hwnd": hwnd.0 as usize,
            "foreground": foreground,
        }),
    )?;
    match method {
        Method::Hwnd => unsafe {
            PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))
                .map_err(|error| format!("WM_CLOSE 전달 실패: {error}"))
        },
        // Alt=0x12, F4=0x73. 지금 포커스가 있는 창이 닫기 요청을 받는다.
        Method::AltF4 => native_input::chord(&[0x12], 0x73),
    }
}

pub(super) fn scenario(app: &AppHandle, core: &Core, log: &mut File) -> Result<(), String> {
    let method = method()?;
    let save_failure = flagged("SAVE_FAILURE");
    let folder = PathBuf::from(setting("PICK_FOLDER").ok_or("native-close test folder is missing")?);
    if !folder.is_dir() {
        return Err(format!("test folder is missing: {}", folder.display()));
    }
    record(
        log,
        "start",
        json!({"scenario": "native-close", "method": method.name(), "save_failure": save_failure}),
    )?;

    ui::driver::wait_until("셸 화면", || {
        Ok(ui::evaluate(app, "return !!document.querySelector('.ks-shell-bar');")? == json!(true))
    })?;
    let snapshot = ui::driver::snapshot(core)?;
    let workspace = snapshot
        .device
        .active_workspace_id
        .clone()
        .ok_or("no active workspace")?;
    let desktop = snapshot
        .device
        .active_desktop_ids
        .get(&workspace)
        .cloned()
        .ok_or("no active desktop")?;

    let editor = ui::driver::open(
        core,
        &desktop,
        "md-editor",
        Rect {
            x: 60,
            y: 60,
            width: 720,
            height: 520,
        },
    )?;
    let expected = fs::canonicalize(&folder).map_err(|error| error.to_string())?;
    let grant = match call(
        core,
        CoreRequest::FilesPickFolder {
            window_id: editor.clone(),
            permission: "docs".into(),
        },
    )? {
        CoreReply::FilesPickFolder { grant: Some(grant) } => grant,
        reply => return Err(format!("test folder was not granted: {reply:?}")),
    };
    if std::path::Path::new(&grant.root_path) != expected {
        return Err(format!("unexpected test folder grant: {grant:?}"));
    }
    // 초기 내용을 비워 두어 커서 위치와 무관하게 마지막 문자열만 비교한다.
    fs::write(folder.join(FILE_NAME), "").map_err(|error| error.to_string())?;
    let editor = match call(
        core,
        CoreRequest::FilesOpen {
            window_id: editor.clone(),
            permission: "docs".into(),
            path: FILE_NAME.into(),
            app_id: "md-editor".into(),
            rect: None,
        },
    )? {
        CoreReply::FilesOpen { window } => window.id,
        reply => return Err(format!("unexpected file open response: {reply:?}")),
    };
    record(
        log,
        "editor.open",
        json!({"window_id": editor, "path": FILE_NAME}),
    )?;
    ui::driver::wait_dom(
        app,
        "return !!document.querySelector('[data-testid=\"app-window-md-editor\"] .ks-editor-view .cm-content');",
        "편집기 본문",
    )?;

    let focus = super::native_target::focus_main_webview(app)?;
    record(log, "native-close.focus", focus)?;
    let point = ui::evaluate(
        app,
        r#"const root=document.querySelector('[data-testid="app-window-md-editor"]');
const content=root?.querySelector('.ks-editor-view .cm-content');
if(!content)return null;
const rect=content.getBoundingClientRect();
return {x:rect.x+24,y:rect.y+16};"#,
    )?;
    let x = point["x"].as_f64().ok_or("editor point is missing")?;
    let y = point["y"].as_f64().ok_or("editor point is missing")?;
    let window = app.get_window("main").ok_or("main window missing")?;
    let origin = window.inner_position().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    native_input::click(origin.x + (x * scale) as i32, origin.y + (y * scale) as i32)?;
    ui::driver::wait_until("편집기 입력 포커스", || {
        Ok(ui::evaluate(
            app,
            "return !!document.activeElement && !!document.activeElement.closest && document.activeElement.closest('.ks-editor-view') !== null;",
        )? == json!(true))
    })?;

    native_input::type_text(TYPED)?;
    let input_ms = now_ms();
    record(
        log,
        "native-close.input",
        json!({"text": TYPED, "input_ms": input_ms}),
    )?;
    let typed = serde_json::to_string(TYPED).map_err(|error| error.to_string())?;
    ui::driver::wait_dom(
        app,
        &format!(
            "const content=document.querySelector('[data-testid=\"app-window-md-editor\"] .ks-editor-view .cm-content');return !!content && content.textContent.includes({typed});"
        ),
        "입력한 문자열",
    )?;

    // 저장을 막을 파일 잠금은 입력이 화면에 보인 뒤에 잡는다. 편집 중인 편집기는 창 포커스 때
    // 파일을 다시 읽지 않으므로 그 읽기가 잠금에 걸릴 일이 없고, 자동 저장(마지막 입력 1초 뒤)보다
    // 먼저 닫기 요청이 간다.
    let lock = if save_failure {
        Some(
            OpenOptions::new()
                .read(true)
                .write(true)
                .share_mode(0)
                .open(folder.join(FILE_NAME))
                .map_err(|error| format!("could not lock {FILE_NAME}: {error}"))?,
        )
    } else {
        None
    };

    let hwnd = main_hwnd(app)?;
    let foreground = unsafe { GetForegroundWindow() };
    if foreground != hwnd {
        return Err(format!(
            "main window is not foreground before close: {}",
            unsafe { super::native_target::describe(foreground) }
        ));
    }

    request_close(method, hwnd, input_ms, false, log)?;
    if !save_failure {
        return Ok(());
    }

    // 저장 실패: 프로그램과 초안이 남고 쉘의 안내가 떠야 한다.
    let message = kaleidoscope_core::kaleidoscope_contract::errors::SHELL_PROGRAM_CLOSE_UNSAVED()
        .message;
    let message = serde_json::to_string(&message).map_err(|error| error.to_string())?;
    let started = Instant::now();
    ui::driver::wait_dom(
        app,
        &format!(
            "const notice=document.querySelector('.ks-shell-notice-layer [role=\"alert\"]');return !!notice && notice.textContent.includes({message});"
        ),
        "저장 실패 안내",
    )?;
    let notice_ms = started.elapsed().as_millis();
    let draft = ui::evaluate(
        app,
        &format!(
            "const content=document.querySelector('[data-testid=\"app-window-md-editor\"] .ks-editor-view .cm-content');return !!content && content.textContent.includes({typed});"
        ),
    )? == json!(true);
    let visible = unsafe { IsWindowVisible(hwnd).as_bool() };
    if !draft {
        return Err("저장 실패 뒤 편집기 초안이 남지 않았다".into());
    }
    if !visible {
        return Err("저장 실패 뒤 메인 창이 사라졌다".into());
    }
    record(
        log,
        "native-close.blocked",
        json!({
            "notice_shown": true,
            "draft": draft,
            "main_visible": visible,
            "notice_ms": notice_ms,
        }),
    )?;

    drop(lock);
    request_close(method, hwnd, now_ms(), true, log)
}
