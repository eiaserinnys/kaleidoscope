//! 실제 입력 좌표를 덮은 최상위 창을 확인한다.
use serde_json::{json, Value};
use std::{
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{CloseHandle, HWND, POINT},
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{
            GetAncestor, GetClassNameW, GetForegroundWindow, GetWindowTextW,
            GetWindowThreadProcessId, WindowFromPoint, GA_ROOT,
        },
    },
};

pub(super) fn wait_shell_at(x: i32, y: i32) -> Result<Value, String> {
    let started = Instant::now();
    let mut checks = 0;
    loop {
        checks += 1;
        let root = unsafe { GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT) };
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(root, Some(&mut pid)) };
        if pid == std::process::id() {
            return Ok(json!({"x": x, "y": y, "checks": checks,
                "elapsed_ms": started.elapsed().as_millis(),
                "at_point": unsafe { describe(root) },
                "foreground": unsafe { describe(GetForegroundWindow()) }}));
        }
        if started.elapsed() >= Duration::from_secs(5) {
            return Err(format!(
                "native click target ({x},{y}) is covered by another window; the shell did not come to the front within 5 seconds; at_point: {}; foreground: {}",
                unsafe { describe(root) }, unsafe { describe(GetForegroundWindow()) }
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
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
