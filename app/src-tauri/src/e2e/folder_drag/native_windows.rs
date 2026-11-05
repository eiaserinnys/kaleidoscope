//! DOM 바깥에서 전경을 가져가거나 좌표를 덮는 창을 시험 로그에 남긴다.
use super::super::native_target::describe;
use serde_json::{json, Value};
use windows::Win32::{
    Foundation::POINT,
    UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, WindowFromPoint, GA_ROOT},
};

pub(super) fn capture(from: (i32, i32), to: (i32, i32)) -> Value {
    let at = |(x, y)| unsafe {
        let hwnd = WindowFromPoint(POINT { x, y });
        json!({"x": x, "y": y, "window": describe(hwnd), "root": describe(GetAncestor(hwnd, GA_ROOT))})
    };
    json!({"foreground": unsafe { describe(GetForegroundWindow()) }, "from": at(from), "to": at(to)})
}
