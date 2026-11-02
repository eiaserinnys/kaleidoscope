//! Windows 정지 화면 실험. 모든 호출은 소유 HWND의 UI 스레드에서 한다.
use std::cell::Cell;
use std::ffi::c_void;
type Handle = isize;
#[repr(C)]
#[derive(Default)]
struct Point {
    x: i32,
    y: i32,
}
#[repr(C)]
#[derive(Default)]
struct Size {
    x: i32,
    y: i32,
}
#[repr(C)]
#[derive(Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
#[repr(C)]
struct Blend {
    op: u8,
    flags: u8,
    alpha: u8,
    format: u8,
}
#[link(name = "user32")]
extern "system" {
    fn GetClientRect(w: Handle, r: *mut Rect) -> i32;
    fn ClientToScreen(w: Handle, p: *mut Point) -> i32;
    fn GetDC(w: Handle) -> Handle;
    fn ReleaseDC(w: Handle, dc: Handle) -> i32;
    fn CreateWindowExW(
        ex: u32,
        class: *const u16,
        name: *const u16,
        style: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        parent: Handle,
        menu: Handle,
        instance: Handle,
        param: *const c_void,
    ) -> Handle;
    fn UpdateLayeredWindow(
        w: Handle,
        dst: Handle,
        p: *const Point,
        size: *const Size,
        src: Handle,
        sp: *const Point,
        key: u32,
        blend: *const Blend,
        flags: u32,
    ) -> i32;
    fn ShowWindow(w: Handle, cmd: i32) -> i32;
    fn DestroyWindow(w: Handle) -> i32;
    fn SetTimer(
        w: Handle,
        id: usize,
        ms: u32,
        callback: Option<unsafe extern "system" fn(Handle, u32, usize, u32)>,
    ) -> usize;
    fn IsWindow(w: Handle) -> i32;
    fn GetForegroundWindow() -> Handle;
}
#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleDC(dc: Handle) -> Handle;
    fn CreateCompatibleBitmap(dc: Handle, w: i32, h: i32) -> Handle;
    fn SelectObject(dc: Handle, obj: Handle) -> Handle;
    fn BitBlt(
        dst: Handle,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        src: Handle,
        sx: i32,
        sy: i32,
        op: u32,
    ) -> i32;
    fn DeleteDC(dc: Handle) -> i32;
    fn DeleteObject(obj: Handle) -> i32;
}
#[link(name = "dwmapi")]
extern "system" {
    fn DwmFlush() -> i32;
}
thread_local! { static COVER:Cell<Handle> = const { Cell::new(0) }; }
unsafe extern "system" fn expired(w: Handle, _: u32, _: usize, _: u32) {
    DestroyWindow(w);
    COVER.with(|c| c.set(0));
}
pub fn flush() {
    unsafe {
        DwmFlush();
    }
}
pub fn foreground() -> isize {
    unsafe { GetForegroundWindow() }
}
pub fn active() -> bool {
    COVER.with(|c| unsafe { IsWindow(c.get()) != 0 })
}
pub fn end() {
    COVER.with(|c| {
        let w = c.replace(0);
        if w != 0 {
            unsafe {
                DestroyWindow(w);
            }
        }
    });
}
pub fn begin(owner: Handle, timeout_ms: u32) -> Result<(), String> {
    end();
    unsafe {
        let mut r = Rect::default();
        let mut p = Point::default();
        if GetClientRect(owner, &mut r) == 0 || ClientToScreen(owner, &mut p) == 0 {
            return Err("클라이언트 좌표 실패".into());
        }
        let size = Size {
            x: r.right,
            y: r.bottom,
        };
        let dc = GetDC(0);
        let mem = CreateCompatibleDC(dc);
        let bitmap = CreateCompatibleBitmap(dc, size.x, size.y);
        let old = SelectObject(mem, bitmap);
        let copied = BitBlt(mem, 0, 0, size.x, size.y, dc, p.x, p.y, 0x00CC0020);
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let w = CreateWindowExW(
            0x80000 | 0x20 | 0x08000000 | 0x80,
            class.as_ptr(),
            class.as_ptr(),
            0x80000000,
            p.x,
            p.y,
            size.x,
            size.y,
            owner,
            0,
            0,
            std::ptr::null(),
        );
        let source = Point::default();
        let blend = Blend {
            op: 0,
            flags: 0,
            alpha: 255,
            format: 0,
        };
        let updated = UpdateLayeredWindow(w, dc, &p, &size, mem, &source, 0, &blend, 2);
        SelectObject(mem, old);
        DeleteObject(bitmap);
        DeleteDC(mem);
        ReleaseDC(0, dc);
        if copied == 0 || w == 0 || updated == 0 {
            if w != 0 {
                DestroyWindow(w);
            }
            return Err(format!(
                "정지 화면 생성 실패: {}",
                std::io::Error::last_os_error()
            ));
        }
        COVER.with(|c| c.set(w));
        if SetTimer(w, 1, timeout_ms, Some(expired)) == 0 {
            end();
            return Err("타이머 생성 실패".into());
        }
        ShowWindow(w, 4);
        DwmFlush();
    }
    Ok(())
}

#[link(name = "user32")]
extern "system" {
    fn SetCursorPos(x: i32, y: i32) -> i32;
    fn mouse_event(flags: u32, x: u32, y: u32, data: u32, extra: usize);
}
/// 실제 입력 주입으로 레이어드 창의 클릭 통과를 확인한다.
pub fn click(owner: isize) {
    unsafe {
        let mut p = Point { x: 50, y: 100 };
        ClientToScreen(owner, &mut p);
        SetCursorPos(p.x, p.y);
        mouse_event(2, 0, 0, 0, 0);
        mouse_event(4, 0, 0, 0, 0);
    }
}
