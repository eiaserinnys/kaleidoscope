//! 실제 입력 좌표가 주 웹뷰에 닿는지 창 계층을 확인한다.
use serde_json::{json, Value};
use std::{
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{CloseHandle, HWND, POINT, RECT},
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{
            GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow, GetGUIThreadInfo,
            GetParent, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
            IsWindowVisible, WindowFromPoint, GA_ROOT, GUITHREADINFO,
        },
    },
};

fn hwnd_from(value: usize) -> HWND {
    HWND(value as *mut core::ffi::c_void)
}

/// 주 웹뷰를 담는 WebView2 컨테이너 창 핸들.
pub(super) fn main_webview_hwnd(app: &AppHandle) -> Result<usize, String> {
    let (tx, rx) = mpsc::channel();
    app.get_webview("main")
        .ok_or("main webview missing")?
        .with_webview(move |native| {
            let result = unsafe {
                let mut hwnd = HWND::default();
                native
                    .controller()
                    .ParentWindow(&mut hwnd)
                    .map(|()| hwnd.0 as usize)
                    .map_err(|error| error.to_string())
            };
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?
}

/// 주 웹뷰가 실제 입력 포커스를 받을 때까지 요청하고 관찰한다.
///
/// 최상위 창 활성화만으로는 WebView2 입력 포커스가 옮겨지지 않으므로
/// 창과 웹뷰 포커스를 함께 요청하고, 전경 창과 DOM `hasFocus()`가 모두
/// 참이 될 때만 성공으로 본다. 실패하면 네이티브 상태를 붙여 돌려준다.
pub(super) fn focus_main_webview(app: &AppHandle) -> Result<Value, String> {
    let started = Instant::now();
    let window = app.get_window("main").ok_or("main window not found")?;
    let webview = app.get_webview("main").ok_or("main webview missing")?;
    let window_hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
    let container = main_webview_hwnd(app)?;
    let before = json!({
        "foreground": unsafe { describe(GetForegroundWindow()) },
        "has_focus": dom_has_focus(app),
    });
    let mut checks = 0;
    let mut focus_requests = 0;
    let mut last_error: Option<String> = None;
    let mut next_request = Instant::now();
    loop {
        if Instant::now() >= next_request {
            focus_requests += 1;
            if let Err(error) = window.set_focus() {
                last_error = Some(format!("window.set_focus: {error}"));
            }
            if let Err(error) = webview.set_focus() {
                last_error = Some(format!("webview.set_focus: {error}"));
            }
            next_request = Instant::now() + Duration::from_millis(500);
        }
        checks += 1;
        let foreground = unsafe { GetForegroundWindow() }.0 as usize;
        let has_focus = dom_has_focus(app);
        if foreground == window_hwnd && has_focus {
            return Ok(json!({
                "passed": true, "elapsed_ms": started.elapsed().as_millis(),
                "attempts": checks, "focus_requests": focus_requests,
                "window": window_hwnd, "container": container,
                "wait_needed": checks > 1,
                "before": before, "after": {"foreground": unsafe { describe(GetForegroundWindow()) }, "has_focus": has_focus},
                "error": last_error,
            }));
        }
        if started.elapsed() >= Duration::from_secs(10) {
            let mut cursor = POINT::default();
            let point = unsafe { GetCursorPos(&mut cursor) }.map(|()| (cursor.x, cursor.y));
            let (x, y) = point.unwrap_or((0, 0));
            return Err(format!(
                "main webview did not take input focus within 10 seconds; foreground={} expected={window_hwnd} has_focus={has_focus} checks={checks} requests={focus_requests} error={last_error:?} snapshot={}",
                unsafe { describe(GetForegroundWindow()) },
                gui_thread_snapshot(app, x, y)
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn dom_has_focus(app: &AppHandle) -> bool {
    super::ui::evaluate(app, "return document.hasFocus();")
        .map(|value| value == json!(true))
        .unwrap_or(false)
}

/// 클릭 지점과 포커스 주변의 Win32 상태를 한 번에 담는다.
///
/// 판정에는 쓰지 않고, 실패했을 때 "네이티브 입력이 어디로 갔는가"를
/// 사후에 확인하기 위한 기록이다.
pub(super) fn gui_thread_snapshot(app: &AppHandle, x: i32, y: i32) -> Value {
    unsafe {
        let foreground = GetForegroundWindow();
        let at_point = WindowFromPoint(POINT { x, y });
        let root = GetAncestor(at_point, GA_ROOT);
        let mut cursor = POINT::default();
        let cursor_state = match GetCursorPos(&mut cursor) {
            Ok(()) => json!({"x": cursor.x, "y": cursor.y}),
            Err(error) => json!({"error": error.to_string()}),
        };
        let main_window = app
            .get_window("main")
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as usize);
        let main_window_state = main_window.map(|hwnd| {
            let hwnd = hwnd_from(hwnd);
            json!({"visible": IsWindowVisible(hwnd).as_bool(), "iconic": IsIconic(hwnd).as_bool()})
        });
        let main_container = main_webview_hwnd(app).ok();
        let mut threads = Vec::new();
        let mut seen: Vec<u32> = Vec::new();
        push_thread("foreground", foreground, &mut threads, &mut seen);
        if let Some(container) = main_container {
            push_thread(
                "main_container",
                hwnd_from(container),
                &mut threads,
                &mut seen,
            );
        }
        push_thread("point", at_point, &mut threads, &mut seen);
        json!({
            "x": x, "y": y, "cursor": cursor_state,
            "foreground": describe(foreground),
            "point": {
                "window": describe(at_point), "root": describe(root),
                "chain": window_chain(at_point, root),
            },
            "main_window": main_window, "main_container": main_container,
            "main_window_state": main_window_state, "threads": threads,
        })
    }
}

unsafe fn push_thread(source: &str, hwnd: HWND, threads: &mut Vec<Value>, seen: &mut Vec<u32>) {
    let mut pid = 0;
    let thread = GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if thread == 0 || seen.contains(&thread) {
        return;
    }
    seen.push(thread);
    threads.push(gui_thread_info(source, thread, pid, hwnd));
}

unsafe fn gui_thread_info(source: &str, thread: u32, pid: u32, hwnd: HWND) -> Value {
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    match GetGUIThreadInfo(thread, &mut info) {
        Ok(()) => json!({
            "source": source, "thread": thread, "pid": pid,
            "hwnd": hwnd.0 as usize, "flags": info.flags.0,
            "hwnd_active": info.hwndActive.0 as usize,
            "hwnd_focus": info.hwndFocus.0 as usize,
            "hwnd_capture": info.hwndCapture.0 as usize,
            "hwnd_menu_owner": info.hwndMenuOwner.0 as usize,
            "hwnd_move_size": info.hwndMoveSize.0 as usize,
            "hwnd_caret": info.hwndCaret.0 as usize,
            "active": describe(info.hwndActive), "focus": describe(info.hwndFocus),
            "capture": describe(info.hwndCapture), "menu_owner": describe(info.hwndMenuOwner),
        }),
        Err(error) => json!({"source": source, "thread": thread, "pid": pid,
            "hwnd": hwnd.0 as usize, "error": error.to_string()}),
    }
}

pub(super) fn wait_main_webview_at(app: &AppHandle, x: i32, y: i32) -> Result<Value, String> {
    let main_container = main_webview_hwnd(app)?;
    let started = Instant::now();
    let mut checks = 0;
    let mut first_chain = None;
    loop {
        checks += 1;
        let at_point = unsafe { WindowFromPoint(POINT { x, y }) };
        let root = unsafe { GetAncestor(at_point, GA_ROOT) };
        let chain = unsafe { window_chain(at_point, root) };
        if chain.iter().any(|window| window["hwnd"] == main_container) {
            let mut result = json!({"x": x, "y": y, "checks": checks,
                "elapsed_ms": started.elapsed().as_millis(),
                "main_container": main_container, "chain": chain,
                "foreground": unsafe { describe(GetForegroundWindow()) }});
            if let Some(first_chain) = first_chain {
                result["first_chain"] = json!(first_chain);
            }
            return Ok(result);
        }
        if started.elapsed() >= Duration::from_secs(5) {
            return Err(format!(
                "native click target ({x},{y}) is not the main webview; chain: {}; foreground: {}",
                json!(chain),
                unsafe { describe(GetForegroundWindow()) }
            ));
        }
        if first_chain.is_none() {
            first_chain = Some(chain);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

unsafe fn window_chain(mut hwnd: HWND, root: HWND) -> Vec<Value> {
    let mut chain = Vec::new();
    while !hwnd.is_invalid() {
        let mut window = describe(hwnd);
        let mut rect = RECT::default();
        let rect = GetWindowRect(hwnd, &mut rect).ok().map(|()| {
            json!({"left": rect.left, "top": rect.top, "right": rect.right, "bottom": rect.bottom})
        });
        window["visible"] = json!(IsWindowVisible(hwnd).as_bool());
        window["rect"] = json!(rect);
        chain.push(window);
        if hwnd == root {
            break;
        }
        hwnd = match GetParent(hwnd) {
            Ok(parent) => parent,
            Err(_) => break,
        };
    }
    chain
}

pub(super) unsafe fn describe(hwnd: HWND) -> Value {
    if hwnd.is_invalid() {
        return json!({"error": "no window"});
    }
    let mut class = [0u16; 256];
    let class_len = GetClassNameW(hwnd, &mut class).max(0) as usize;
    let mut title = [0u16; 1024];
    let title_len = GetWindowTextW(hwnd, &mut title).max(0) as usize;
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let process = process_name(pid);
    json!({"hwnd": hwnd.0 as usize, "pid": pid,
        "class": String::from_utf16_lossy(&class[..class_len]),
        "title": String::from_utf16_lossy(&title[..title_len]),
        "process": process.as_ref().ok(), "process_error": process.as_ref().err()})
}

pub(super) unsafe fn process_name(pid: u32) -> Result<String, String> {
    let handle =
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).map_err(|e| e.to_string())?;
    let mut path = [0u16; 32768];
    let mut len = path.len() as u32;
    let result = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        PWSTR(path.as_mut_ptr()),
        &mut len,
    );
    let _ = CloseHandle(handle);
    result.map_err(|e| e.to_string())?;
    let path = String::from_utf16_lossy(&path[..len as usize]);
    Ok(path.rsplit('\\').next().unwrap_or(&path).to_owned())
}
