//! 같이 보기 격리 캡처 중 메인 창을 가리는 Windows 덮개.
use std::cell::Cell;

use windows::core::w;
use windows::Win32::Foundation::{HWND, POINT, SIZE};
use windows::Win32::Graphics::Dwm::DwmFlush;
use windows::Win32::Graphics::Gdi::{
    BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
    GetDC, ReleaseDC, SelectObject, BLENDFUNCTION, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, GetClientRect, KillTimer, SetTimer, ShowWindow,
    UpdateLayeredWindow, SW_SHOWNOACTIVATE, ULW_ALPHA, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_POPUP,
};

const WATCHDOG_MS: u32 = 5_000;
const WATCHDOG_ID: usize = 1;

thread_local! {
    static COVER: Cell<HWND> = const { Cell::new(HWND(std::ptr::null_mut())) };
}

unsafe extern "system" fn expire(window: HWND, _: u32, timer: usize, _: u32) {
    let _ = KillTimer(Some(window), timer);
    let _ = DestroyWindow(window);
    COVER.with(|cover| {
        if cover.get() == window {
            cover.set(HWND(std::ptr::null_mut()));
        }
    });
}

pub fn freeze(owner: HWND) -> Result<(), String> {
    unfreeze();
    unsafe {
        let mut client = windows::Win32::Foundation::RECT::default();
        let mut origin = POINT::default();
        GetClientRect(owner, &mut client).map_err(|error| error.to_string())?;
        if !ClientToScreen(owner, &mut origin).as_bool() {
            return Err("클라이언트 좌표를 얻지 못했습니다.".into());
        }
        let size = SIZE {
            cx: client.right - client.left,
            cy: client.bottom - client.top,
        };
        if size.cx <= 0 || size.cy <= 0 {
            return Err("메인 창 크기가 비었습니다.".into());
        }

        let screen = GetDC(None);
        if screen.0.is_null() {
            return Err("화면 DC를 얻지 못했습니다.".into());
        }
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, size.cx, size.cy);
        if memory.0.is_null() || bitmap.0.is_null() {
            if !memory.0.is_null() {
                let _ = DeleteDC(memory);
            }
            if !bitmap.0.is_null() {
                let _ = DeleteObject(bitmap.into());
            }
            let _ = ReleaseDC(None, screen);
            return Err("정지 화면 비트맵을 만들지 못했습니다.".into());
        }
        let previous = SelectObject(memory, bitmap.into());
        if previous.0.is_null() {
            let _ = DeleteObject(bitmap.into());
            let _ = DeleteDC(memory);
            let _ = ReleaseDC(None, screen);
            return Err("정지 화면 비트맵을 선택하지 못했습니다.".into());
        }
        let copied = BitBlt(
            memory,
            0,
            0,
            size.cx,
            size.cy,
            Some(screen),
            origin.x,
            origin.y,
            SRCCOPY,
        );
        if let Err(error) = copied {
            let _ = SelectObject(memory, previous);
            let _ = DeleteObject(bitmap.into());
            let _ = DeleteDC(memory);
            let _ = ReleaseDC(None, screen);
            return Err(error.to_string());
        }
        let cover = match CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            w!("STATIC"),
            w!(""),
            WS_POPUP,
            origin.x,
            origin.y,
            size.cx,
            size.cy,
            Some(owner),
            None,
            None,
            None,
        ) {
            Ok(cover) => cover,
            Err(error) => {
                let _ = SelectObject(memory, previous);
                let _ = DeleteObject(bitmap.into());
                let _ = DeleteDC(memory);
                let _ = ReleaseDC(None, screen);
                return Err(error.to_string());
            }
        };
        let blend = BLENDFUNCTION {
            BlendOp: 0,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: 0,
        };
        let updated = UpdateLayeredWindow(
            cover,
            Some(screen),
            Some(&origin),
            Some(&size),
            Some(memory),
            Some(&POINT::default()),
            windows::Win32::Foundation::COLORREF(0),
            Some(&blend),
            ULW_ALPHA,
        );
        let _ = SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        let _ = ReleaseDC(None, screen);
        if let Err(error) = updated {
            let _ = DestroyWindow(cover);
            return Err(error.to_string());
        }
        if SetTimer(Some(cover), WATCHDOG_ID, WATCHDOG_MS, Some(expire)) == 0 {
            let _ = DestroyWindow(cover);
            return Err("정지 화면 자동 해제 타이머를 만들지 못했습니다.".into());
        }
        COVER.with(|current| current.set(cover));
        let _ = ShowWindow(cover, SW_SHOWNOACTIVATE);
        Ok(())
    }
}

pub fn unfreeze() {
    COVER.with(|current| {
        let cover = current.replace(HWND(std::ptr::null_mut()));
        if !cover.0.is_null() {
            unsafe {
                let _ = KillTimer(Some(cover), WATCHDOG_ID);
                let _ = DestroyWindow(cover);
            }
        }
    });
}

pub fn flush() -> Result<(), String> {
    unsafe { DwmFlush().map_err(|error| error.to_string()) }
}

#[cfg(feature = "e2e")]
pub fn active() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    COVER.with(|current| unsafe { IsWindow(Some(current.get())).as_bool() })
}
