//! DOM 바깥에서 전경을 가져가거나 좌표를 덮는 창을 시험 로그에 남긴다.
use serde_json::{json, Value};
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

pub(super) fn capture(from: (i32, i32), to: (i32, i32)) -> Value {
    let at = |(x, y)| unsafe {
        let hwnd = WindowFromPoint(POINT { x, y });
        json!({"x": x, "y": y, "window": describe(hwnd), "root": describe(GetAncestor(hwnd, GA_ROOT))})
    };
    json!({"foreground": unsafe { describe(GetForegroundWindow()) }, "from": at(from), "to": at(to)})
}

unsafe fn describe(hwnd: HWND) -> Value {
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

unsafe fn process_name(pid: u32) -> Result<String, String> {
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
