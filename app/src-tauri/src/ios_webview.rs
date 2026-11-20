//! iPad 메인 웹뷰의 스크롤 뷰가 안전 영역만큼 내용을 안쪽으로 밀지 않게 한다.
//!
//! WKWebView의 기본값(`contentInsetAdjustmentBehavior = automatic`)은 아래 안전 영역만큼
//! 내용을 위로 밀고, 그 자리를 웹뷰 바탕색(밝은 모드에서 흰색)으로 남긴다. 그러면 화면
//! 아래에 흰 띠가 생기고, 쉘 CSS가 안전 영역을 한 번 더 비켜 작업 표시줄이 아래 끝에서
//! 멀어진다. `never`로 두면 웹 내용이 웹뷰 전체를 채우고, 안전 영역은 `:root`의
//! `--ks-safe-*`(`env(safe-area-inset-*)`)로 한 번만 반영된다.

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_ui_kit::{UIScrollView, UIScrollViewContentInsetAdjustmentBehavior};
use tauri::Manager;

pub fn configure_main(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or(tauri::Error::WindowNotFound)?;
    window.with_webview(|webview| {
        let handle = webview.inner() as *mut AnyObject;
        if handle.is_null() {
            return;
        }
        // objc2-web-kit은 WKWebView.scrollView를 바인딩하지 않아 메시지로 읽는다.
        let scroll_view: Option<Retained<UIScrollView>> =
            unsafe { objc2::msg_send![handle, scrollView] };
        if let Some(scroll_view) = scroll_view {
            scroll_view.setContentInsetAdjustmentBehavior(
                UIScrollViewContentInsetAdjustmentBehavior::Never,
            );
        }
    })
}
