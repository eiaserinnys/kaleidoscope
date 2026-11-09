use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use kaleidoscope_core::kaleidoscope_contract::CoreError;
use kaleidoscope_core::Core;
use tauri::{AppHandle, Emitter, EventTarget, Manager, State};

const CLOSE_REQUESTED_EVENT: &str = "shell-close-requested";

/// 메인 웹뷰가 닫기 요청을 저장 절차로 받을 준비가 됐는지.
pub struct CloseState(AtomicBool);

impl Default for CloseState {
    fn default() -> Self {
        Self(AtomicBool::new(false))
    }
}

/// 메인 웹뷰가 로드되기 시작하면 이전 페이지의 리스너는 사라지므로 준비를 끈다.
pub fn set_ready(app: &AppHandle, ready: bool) {
    if let Some(state) = app.try_state::<CloseState>() {
        state.0.store(ready, Ordering::SeqCst);
    }
}

/// 메인 창의 닫기 요청을 보류하고 메인 웹뷰에만 저장 뒤 종료를 요청한다.
/// 준비되지 않았으면 아무것도 하지 않아 지금처럼 바로 닫힌다.
pub fn handle_close_requested(window: &tauri::Window, event: &tauri::WindowEvent) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.label() != "main" {
        return;
    }
    let Some(state) = window.try_state::<CloseState>() else {
        return;
    };
    if !state.0.load(Ordering::SeqCst) {
        return;
    }
    api.prevent_close();
    if let Err(error) =
        window
            .app_handle()
            .emit_to(EventTarget::webview("main"), CLOSE_REQUESTED_EVENT, ())
    {
        eprintln!("네이티브 닫기 요청 전달 실패: {error}");
    }
}

/// 메인 웹뷰가 닫기 요청 리스너를 걸거나 뗄 때 부른다.
#[tauri::command]
pub fn shell_close_ready(state: State<'_, CloseState>, ready: bool) {
    state.0.store(ready, Ordering::SeqCst);
}

/// 웹뷰가 저장 절차를 마친 뒤 부른다. 저장소를 저장하지 못하면 그 오류를 그대로 돌려주고
/// 프로그램을 살려 둔다. 성공하면 종료를 시작하고 정리는 RunEvent::Exit에서 한다.
#[tauri::command]
pub fn shell_finish_close(app: AppHandle, core: State<'_, Arc<Core>>) -> Result<(), CoreError> {
    core.flush_storage()?;
    app.exit(0);
    Ok(())
}
