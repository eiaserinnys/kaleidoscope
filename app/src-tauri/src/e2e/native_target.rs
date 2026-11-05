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
            GetAncestor, GetClassNameW, GetForegroundWindow, GetParent, GetWindowRect,
            GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, WindowFromPoint, GA_ROOT,
        },
    },
};

pub(super) fn wait_main_webview_at(app: &AppHandle, x: i32, y: i32) -> Result<Value, String> {
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
    let main_container = rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())??;
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
