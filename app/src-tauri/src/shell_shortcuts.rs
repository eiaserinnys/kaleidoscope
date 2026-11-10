//! 예약 키만 소비하고 실행은 메인 쉘의 공통 판정기로 보낸다.
use std::{cell::RefCell, collections::HashMap};
use tauri::{AppHandle, Emitter, EventTarget};
use webview2_com::{
    AcceleratorKeyPressedEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS,
    },
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};

const EVENT: &str = "shell-shortcut";
/// (가상 키, 쉘 표의 code, Ctrl+Alt에서 Shift 허용, Ctrl만 눌러도 받음)
const KEYS: &[(u32, &str, bool, bool)] = &[
    (0x25, "ArrowLeft", false, false),
    (0x27, "ArrowRight", false, false),
    (0x09, "Tab", true, false),
    (0x22, "PageDown", false, true),
    (0x21, "PageUp", false, true),
    (0x26, "ArrowUp", true, false),
    (0x28, "ArrowDown", true, false),
];

struct Registration {
    controller: ICoreWebView2Controller,
    token: i64,
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Err(error) = unsafe { self.controller.remove_AcceleratorKeyPressed(self.token) } {
            eprintln!("쉘 단축키 등록 해제 실패: {error}");
        }
    }
}
thread_local! {
    // COM 참조와 토큰은 controller를 만든 UI 스레드에서만 다룬다.
    static REGISTRATIONS: RefCell<HashMap<String, Registration>> = RefCell::new(HashMap::new());
}
pub(crate) fn unregister(label: &str) {
    REGISTRATIONS.with(|items| {
        items.borrow_mut().remove(label);
    });
}
pub(crate) fn clear() {
    REGISTRATIONS.with(|items| items.borrow_mut().clear());
}

pub(crate) unsafe fn register(
    app: AppHandle,
    label: String,
    controller: &ICoreWebView2Controller,
) -> windows::core::Result<()> {
    let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else { return Ok(()) };
        let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
        args.KeyEventKind(&mut kind)?;
        if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
            && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
        {
            return Ok(());
        }
        let down = |key: u16| GetKeyState(key as i32) < 0;
        if !down(VK_CONTROL.0) || down(VK_LWIN.0) || down(VK_RWIN.0) {
            return Ok(());
        }
        let alt = down(VK_MENU.0);
        let shift = down(VK_SHIFT.0);
        let mut key = 0;
        args.VirtualKey(&mut key)?;
        let Some(&(_, code, ..)) = KEYS
            .iter()
            .find(|&&(vk, _, allow_shift, ctrl_only)| {
                vk == key && if alt { !shift || allow_shift } else { ctrl_only && !shift }
            })
        else {
            return Ok(());
        };
        args.SetHandled(true)?;
        let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
        args.PhysicalKeyStatus(&mut status)?;
        if status.WasKeyDown.as_bool() {
            return Ok(());
        }
        // 먼저 런타임 작업으로 빠져나가 UI 스레드 즉시 실행에 의한 COM 재진입을 피한다.
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let target = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                if let Err(error) = target.emit_to(
                    EventTarget::webview("main"),
                    EVENT,
                    serde_json::json!({"code":code,"shift":shift,"alt":alt}),
                ) {
                    eprintln!("쉘 단축키 전달 실패: {error}");
                }
            }) {
                eprintln!("쉘 단축키 예약 실패: {error}");
            }
        });
        Ok(())
    }));
    let mut token = 0;
    controller.add_AcceleratorKeyPressed(&handler, &mut token)?;
    REGISTRATIONS.with(|items| {
        items.borrow_mut().insert(
            label,
            Registration {
                controller: controller.clone(),
                token,
            },
        )
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn 예약_키는_쉘_표에도_있다() {
        let shell = include_str!("../../src/shell/shell-shortcuts.ts");
        assert!(shell.contains(&format!("\"{EVENT}\"")));
        for &(_, code, _, _) in KEYS {
            assert!(shell.contains(&format!("\"{code}\"")), "{code}");
        }
    }
}
