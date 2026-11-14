//! macOS WKWebView 캡처와 격리 캡처 중 메인 창 고정 덮개.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use kaleidoscope_core::kaleidoscope_contract::{errors, CoreError};
use objc2::rc::Retained;
use objc2::runtime::AnyClass;
use objc2::{msg_send, AnyThread, MainThreadMarker};
use objc2_app_kit::{
    NSBackingStoreType, NSBezierPath, NSBitmapImageFileType, NSBitmapImageRep,
    NSCompositingOperation, NSDeviceRGBColorSpace, NSGraphicsContext, NSImage,
    NSImageInterpolation, NSImageScaling, NSImageView, NSView, NSWindow, NSWindowAnimationBehavior,
    NSWindowOrderingMode, NSWindowStyleMask,
};
use objc2_foundation::{NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize};
use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
use tauri::{AppHandle, Manager, Webview};

const TIMEOUT: Duration = Duration::from_secs(2);
const WATCHDOG: Duration = Duration::from_secs(5);
// 창 서버가 덮개를 합성할 시간(약 두 프레임).
const PRESENT: Duration = Duration::from_millis(34);

struct Cover {
    window: Retained<NSWindow>,
    parent: Retained<NSWindow>,
}

// 덮개 상태는 메인 스레드에서만 만진다. 세대가 바뀌면 늦게 온 스냅샷과 watchdog은 무시한다.
thread_local! {
    static COVER: RefCell<Option<Cover>> = const { RefCell::new(None) };
    static GENERATION: Cell<u64> = const { Cell::new(0) };
}

/// 점 크기와 배율로 비트맵 픽셀 크기를 구한다. 비었거나 잘못된 값이면 `None`.
fn pixel_size(width: f64, height: f64, scale: f64) -> Option<(isize, isize)> {
    let valid = |value: f64| value.is_finite() && value > 0.0;
    if !valid(width) || !valid(height) || !valid(scale) {
        return None;
    }
    let pixels = |value: f64| (value * scale).round().max(1.0) as isize;
    Some((pixels(width), pixels(height)))
}

/// 비뒤집힌 부모 좌표(y 위쪽)로 바꾼다. 뒤집힌 부모면 y를 뒤집는다.
fn unflip(rect: NSRect, parent_height: f64, flipped: bool) -> NSRect {
    if !flipped {
        return rect;
    }
    NSRect::new(
        NSPoint::new(
            rect.origin.x,
            parent_height - rect.origin.y - rect.size.height,
        ),
        rect.size,
    )
}

fn scaled(rect: NSRect, scale: f64) -> NSRect {
    NSRect::new(
        NSPoint::new(rect.origin.x * scale, rect.origin.y * scale),
        NSSize::new(rect.size.width * scale, rect.size.height * scale),
    )
}

/// 정확히 `pixels` 크기의 RGBA 비트맵을 만들고 픽셀 좌표로 그린다.
fn draw_bitmap(pixels: (isize, isize), draw: impl FnOnce()) -> Option<Retained<NSBitmapImageRep>> {
    let rep = unsafe {
        NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            pixels.0,
            pixels.1,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        )
    }?;
    // 크기를 픽셀과 같게 두어 그리기 좌표 1 = 1픽셀로 맞춘다.
    rep.setSize(NSSize::new(pixels.0 as f64, pixels.1 as f64));
    let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
    NSGraphicsContext::saveGraphicsState_class();
    NSGraphicsContext::setCurrentContext(Some(&context));
    context.setImageInterpolation(NSImageInterpolation::High);
    draw();
    context.flushGraphics();
    NSGraphicsContext::restoreGraphicsState_class();
    Some(rep)
}

fn png(rep: &NSBitmapImageRep) -> Option<Vec<u8>> {
    let data = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(data.to_vec())
}

fn describe(error: *mut NSError) -> String {
    unsafe { error.as_ref() }
        .map(|error| error.localizedDescription().to_string())
        .unwrap_or_else(|| "이미지가 없습니다.".into())
}

/// 스냅샷 하나를 찍는다. 숨겨진 뷰는 다음 화면 갱신이 오지 않을 수 있어 기다리지 않는다.
fn snapshot(
    mtm: MainThreadMarker,
    view: &WKWebView,
    after_updates: bool,
    done: impl Fn(Option<Retained<NSImage>>, String) + 'static,
) {
    let bounds = view.bounds();
    unsafe {
        let config = WKSnapshotConfiguration::new(mtm);
        config.setRect(bounds);
        config.setSnapshotWidth(Some(&NSNumber::numberWithDouble(bounds.size.width)));
        config.setAfterScreenUpdates(after_updates);
        let block = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let image = Retained::retain(image);
            let reason = if image.is_none() {
                describe(error)
            } else {
                String::new()
            };
            done(image, reason);
        });
        view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &block);
    }
}

fn visible(view: &NSView) -> bool {
    view.window().is_some() && !view.isHiddenOrHasHiddenAncestor()
}

/// 웹뷰를 PNG로 찍는다. 픽셀 크기는 웹뷰 크기 × 창 배율이다. 시간 안에 못 찍으면 `None`.
pub(crate) fn capture_view(view: Webview, window: &str) -> Result<Option<Vec<u8>>, CoreError> {
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |native| {
        let Some(mtm) = MainThreadMarker::new() else {
            eprintln!("웹뷰 캡처 실패: 메인 스레드가 아닙니다.");
            return;
        };
        let Some(view) = (unsafe { Retained::retain(native.inner().cast::<WKWebView>()) }) else {
            eprintln!("웹뷰 캡처 실패: 웹뷰가 없습니다.");
            return;
        };
        let scale = view
            .window()
            .or_else(|| unsafe { Retained::retain(native.ns_window().cast::<NSWindow>()) })
            .map(|window| window.backingScaleFactor())
            .unwrap_or(1.0);
        let bounds = view.bounds();
        let Some(pixels) = pixel_size(bounds.size.width, bounds.size.height, scale) else {
            let _ = tx.send(None);
            return;
        };
        snapshot(mtm, &view, visible(&view), move |image, reason| {
            let bytes = image.and_then(|image| {
                let target = NSRect::new(
                    NSPoint::new(0.0, 0.0),
                    NSSize::new(pixels.0 as f64, pixels.1 as f64),
                );
                let rep = draw_bitmap(pixels, || {
                    image.drawInRect_fromRect_operation_fraction(
                        target,
                        NSRect::ZERO,
                        NSCompositingOperation::Copy,
                        1.0,
                    )
                });
                rep.as_deref().and_then(png)
            });
            if bytes.is_none() {
                eprintln!("웹뷰 캡처 실패: {reason}");
            }
            let _ = tx.send(bytes);
        });
    })
    .map_err(|error| {
        errors::WEB_HOST_CAPTURE_FAILED()
            .and_details(vec![format!("창 ID: {window}"), error.to_string()])
    })?;
    Ok(rx.recv_timeout(TIMEOUT).ok().flatten())
}

/// `root` 아래 보이는 웹뷰를 뒤에서 앞 순서로 모은다.
fn collect(root: &NSView, out: &mut Vec<Retained<WKWebView>>) {
    for child in root.subviews().iter() {
        if child.isHiddenOrHasHiddenAncestor() {
            continue;
        }
        match child.downcast::<WKWebView>() {
            Ok(webview) => out.push(webview),
            Err(child) => collect(&child, out),
        }
    }
}

fn remove_cover() {
    GENERATION.with(|generation| generation.set(generation.get() + 1));
    if let Some(cover) = COVER.with(|cover| cover.borrow_mut().take()) {
        cover.parent.removeChildWindow(&cover.window);
        cover.window.orderOut(None);
        cover.window.close();
    }
}

fn current(generation: u64) -> bool {
    GENERATION.with(|current| current.get() == generation)
}

/// 각 웹뷰 스냅샷을 창 콘텐츠 크기 비트맵에 겹쳐 그린다.
fn compose(
    parent: &NSWindow,
    content: &NSView,
    shots: &[(NSRect, Option<Retained<NSImage>>)],
) -> Result<Retained<NSImage>, String> {
    let bounds = content.bounds();
    let scale = parent.backingScaleFactor();
    let pixels = pixel_size(bounds.size.width, bounds.size.height, scale)
        .ok_or("메인 창 크기가 비었습니다.")?;
    let rep = draw_bitmap(pixels, || {
        parent.backgroundColor().setFill();
        NSBezierPath::fillRect(NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(pixels.0 as f64, pixels.1 as f64),
        ));
        for (frame, image) in shots {
            if let Some(image) = image {
                image.drawInRect_fromRect_operation_fraction(
                    scaled(*frame, scale),
                    NSRect::ZERO,
                    NSCompositingOperation::SourceOver,
                    1.0,
                );
            }
        }
    })
    .ok_or("정지 화면 비트맵을 만들지 못했습니다.")?;
    let image = NSImage::initWithSize(NSImage::alloc(), bounds.size);
    image.addRepresentation(&rep);
    Ok(image)
}

fn show_cover(
    mtm: MainThreadMarker,
    parent: Retained<NSWindow>,
    content: &NSView,
    image: &NSImage,
) -> Result<(), String> {
    let frame = parent.convertRectToScreen(content.convertRect_toView(content.bounds(), None));
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            mtm.alloc(),
            frame,
            NSWindowStyleMask::Borderless,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    unsafe { window.setReleasedWhenClosed(false) };
    window.setOpaque(true);
    window.setHasShadow(false);
    window.setIgnoresMouseEvents(true);
    window.setAnimationBehavior(NSWindowAnimationBehavior::None);
    window.setBackgroundColor(Some(&parent.backgroundColor()));
    let view = NSImageView::imageViewWithImage(image, mtm);
    view.setImageScaling(NSImageScaling::ScaleAxesIndependently);
    window.setContentView(Some(&view));
    unsafe { parent.addChildWindow_ordered(&window, NSWindowOrderingMode::Above) };
    if !window.isVisible() {
        parent.removeChildWindow(&window);
        window.close();
        return Err("정지 화면 창을 띄우지 못했습니다.".into());
    }
    window.display();
    // 덮개 레이어 변경을 지금 창 서버로 보낸다.
    if let Some(transaction) = AnyClass::get(c"CATransaction") {
        let _: () = unsafe { msg_send![transaction, flush] };
    }
    COVER.with(|cover| *cover.borrow_mut() = Some(Cover { window, parent }));
    Ok(())
}

type Shots = Vec<(NSRect, Option<Retained<NSImage>>)>;

/// 메인 스레드에서 스냅샷을 모두 받은 뒤 덮개를 띄우고 `tx`로 알린다.
fn start_freeze(
    mtm: MainThreadMarker,
    app: AppHandle,
    parent: Retained<NSWindow>,
    tx: mpsc::Sender<Result<(), String>>,
) {
    remove_cover();
    let generation = GENERATION.with(Cell::get);
    let Some(content) = parent.contentView() else {
        let _ = tx.send(Err("메인 창 콘텐츠 뷰가 없습니다.".into()));
        return;
    };
    let mut views = Vec::new();
    collect(&content, &mut views);
    let height = content.bounds().size.height;
    let flipped = content.isFlipped();
    let shots: Rc<RefCell<Shots>> = Rc::new(RefCell::new(
        views
            .iter()
            .map(|view| {
                let frame = view.convertRect_toView(view.bounds(), Some(&content));
                (unflip(frame, height, flipped), None)
            })
            .collect(),
    ));
    let left = Rc::new(Cell::new(views.len()));
    if views.is_empty() {
        let _ = tx.send(Err("메인 창에 웹뷰가 없습니다.".into()));
        return;
    }
    let content = Rc::new(content);
    for (index, view) in views.iter().enumerate() {
        let (shots, left, content, parent, tx, app) = (
            shots.clone(),
            left.clone(),
            content.clone(),
            parent.clone(),
            tx.clone(),
            app.clone(),
        );
        // 지금 화면에 있는 모습을 고정하므로 갱신을 기다리지 않는다.
        snapshot(mtm, view, false, move |image, reason| {
            if image.is_none() {
                eprintln!("정지 화면 스냅샷 실패: {reason}");
            }
            shots.borrow_mut()[index].1 = image;
            left.set(left.get() - 1);
            if left.get() > 0 || !current(generation) {
                return;
            }
            let shots = shots.borrow();
            if shots.iter().all(|(_, image)| image.is_none()) {
                let _ = tx.send(Err(format!("웹뷰 스냅샷 실패: {reason}")));
                return;
            }
            let shown = compose(&parent, &content, &shots)
                .and_then(|image| show_cover(mtm, parent.clone(), &content, &image));
            if shown.is_ok() {
                let app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(WATCHDOG);
                    let _ = app.run_on_main_thread(move || {
                        if current(generation) {
                            remove_cover();
                        }
                    });
                });
            }
            let _ = tx.send(shown);
        });
    }
}

/// 메인 스레드 큐를 한 바퀴 돌려 앞선 작업과 그 CATransaction 커밋이 끝났음을 확인한다.
fn round_trip(app: &AppHandle) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(());
    })
    .map_err(|error| error.to_string())?;
    rx.recv_timeout(TIMEOUT).map_err(|error| error.to_string())
}

/// 메인 창의 현재 모습을 덮개로 고정한다. 어느 스레드에서 불러도 된다.
pub(crate) fn freeze(app: &AppHandle) -> Result<bool, CoreError> {
    let failed = |detail: String| errors::WEB_HOST_FREEZE_FAILED().and_details(vec![detail]);
    // 스냅샷 완료가 메인 스레드로 오므로 메인 스레드에서 기다리면 멈춘다.
    if MainThreadMarker::new().is_some() {
        return Err(failed("메인 스레드에서는 기다릴 수 없습니다.".into()));
    }
    let view = app
        .get_webview("main")
        .ok_or_else(|| failed("메인 웹뷰가 없습니다.".into()))?;
    let (tx, rx) = mpsc::channel();
    let task_app = app.clone();
    view.with_webview(move |native| {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("메인 스레드가 아닙니다.".into()));
            return;
        };
        let parent = unsafe { Retained::retain(native.ns_window().cast::<NSWindow>()) };
        match parent {
            Some(parent) => start_freeze(mtm, task_app, parent, tx),
            None => {
                let _ = tx.send(Err("메인 창이 없습니다.".into()));
            }
        }
    })
    .map_err(|error| failed(error.to_string()))?;
    let shown = rx
        .recv_timeout(TIMEOUT)
        .map_err(|error| format!("정지 화면 대기 실패: {error}"))
        .and_then(|shown| shown);
    if let Err(detail) = shown {
        let _ = unfreeze(app);
        return Err(failed(detail));
    }
    if let Err(detail) = round_trip(app) {
        let _ = unfreeze(app);
        return Err(failed(detail));
    }
    std::thread::sleep(PRESENT);
    Ok(true)
}

/// `freeze`로 씌운 덮개를 걷는다. 어느 스레드에서 불러도 된다.
pub(crate) fn unfreeze(app: &AppHandle) -> Result<(), CoreError> {
    if MainThreadMarker::new().is_some() {
        remove_cover();
        return Ok(());
    }
    let failed = |detail: String| errors::WEB_HOST_UNFREEZE_FAILED().and_details(vec![detail]);
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        remove_cover();
        let _ = tx.send(());
    })
    .map_err(|error| failed(error.to_string()))?;
    rx.recv_timeout(TIMEOUT)
        .map_err(|error| failed(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pixel_size_multiplies_points_by_scale() {
        assert_eq!(pixel_size(800.0, 600.0, 2.0), Some((1600, 1200)));
        assert_eq!(pixel_size(801.0, 601.0, 1.5), Some((1202, 902)));
        assert_eq!(pixel_size(0.4, 0.4, 1.0), Some((1, 1)));
    }

    #[test]
    fn pixel_size_rejects_empty_or_invalid() {
        assert_eq!(pixel_size(0.0, 600.0, 2.0), None);
        assert_eq!(pixel_size(800.0, -1.0, 2.0), None);
        assert_eq!(pixel_size(800.0, 600.0, 0.0), None);
        assert_eq!(pixel_size(f64::NAN, 600.0, 2.0), None);
    }

    #[test]
    fn unflip_converts_flipped_parent_to_bottom_left_origin() {
        let rect = NSRect::new(NSPoint::new(10.0, 20.0), NSSize::new(100.0, 50.0));
        assert_eq!(unflip(rect, 500.0, false), rect);
        let flipped = unflip(rect, 500.0, true);
        assert_eq!(flipped.origin, NSPoint::new(10.0, 430.0));
        assert_eq!(flipped.size, rect.size);
    }

    #[test]
    fn scaled_multiplies_every_edge() {
        let rect = NSRect::new(NSPoint::new(1.0, 2.0), NSSize::new(3.0, 4.0));
        let result = scaled(rect, 2.0);
        assert_eq!(result.origin, NSPoint::new(2.0, 4.0));
        assert_eq!(result.size, NSSize::new(6.0, 8.0));
    }
}
