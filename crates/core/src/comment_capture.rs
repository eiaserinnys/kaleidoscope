//! 같이 보기와 별개인 명시적 커멘트 그림 캡처.
use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use kaleidoscope_contract::{
    app_comments::{
        AppCommentCaptureSurface, AppCommentImage, AppCommentImageMeta, AppCommentRect,
    },
    data::MEDIA_MAX_BYTES,
    errors, CoreError, CoreReply, Rect,
};

use crate::{share, Inner};

// 라이트 테마의 --ks-color-accent와 --ks-color-accent-contrast.
const ACCENT: Rgba<u8> = Rgba([111, 86, 154, 255]);
const CONTRAST: Rgba<u8> = Rgba([255, 255, 255, 255]);

pub(crate) fn capture(
    inner: &Inner,
    window_id: &str,
    bounds: Rect,
    surface_bounds: Option<Rect>,
    target: AppCommentRect,
) -> Result<CoreReply, CoreError> {
    if !inner
        .state
        .lock()
        .unwrap()
        .shared
        .windows
        .iter()
        .any(|window| window.id == window_id)
    {
        return Err(errors::COMMENT_CAPTURE_WINDOW_NOT_FOUND());
    }
    let unavailable = errors::COMMENT_CAPTURE_IMAGE_UNAVAILABLE;
    let source = surface_bounds.unwrap_or(bounds);
    let (png, width, height) =
        share::capture_native(inner, window_id, bounds, surface_bounds.is_some())
            .ok_or_else(unavailable)?;
    if source.width == 0 || source.height == 0 {
        return Err(unavailable());
    }
    let sx = width as f64 / source.width as f64;
    let sy = height as f64 / source.height as f64;
    let target_rect = AppCommentRect {
        x: (target.x + bounds.x as f64 - source.x as f64) * sx,
        y: (target.y + bounds.y as f64 - source.y as f64) * sy,
        width: target.width * sx,
        height: target.height * sy,
    };
    let mut image = image::load_from_memory(&png)
        .map_err(|_| unavailable())?
        .to_rgba8();
    mark(&mut image, &target_rect);
    let mut result = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut result, ImageFormat::Png)
        .map_err(|_| unavailable())?;
    let bytes = result.into_inner();
    if bytes.len() as u64 > MEDIA_MAX_BYTES {
        return Err(unavailable());
    }
    Ok(CoreReply::CommentCapture {
        image: AppCommentImage {
            meta: AppCommentImageMeta {
                width,
                height,
                byte_size: bytes.len() as u64,
                capture_surface: if surface_bounds.is_some() {
                    AppCommentCaptureSurface::WebView
                } else {
                    AppCommentCaptureSurface::WindowBody
                },
                target_rect,
            },
            image_base64: STANDARD.encode(bytes),
        },
    })
}

fn mark(image: &mut RgbaImage, target: &AppCommentRect) {
    if target.width == 0.0 && target.height == 0.0 {
        let cx = target.x.round() as i64;
        let cy = target.y.round() as i64;
        for y in cy - 5..=cy + 5 {
            for x in cx - 5..=cx + 5 {
                let distance = (x - cx).pow(2) + (y - cy).pow(2);
                if distance <= 25 {
                    put(image, x, y, if distance <= 9 { ACCENT } else { CONTRAST });
                }
            }
        }
    } else {
        let left = target.x.floor() as i64;
        let top = target.y.floor() as i64;
        let right = (target.x + target.width).ceil() as i64 - 1;
        let bottom = (target.y + target.height).ceil() as i64 - 1;
        outline(image, left - 1, top - 1, right + 1, bottom + 1, CONTRAST);
        outline(image, left, top, right, bottom, ACCENT);
    }
}

fn outline(image: &mut RgbaImage, left: i64, top: i64, right: i64, bottom: i64, color: Rgba<u8>) {
    for x in left.max(0)..=right.min(image.width() as i64 - 1) {
        put(image, x, top, color);
        put(image, x, bottom, color);
    }
    for y in top.max(0)..=bottom.min(image.height() as i64 - 1) {
        put(image, left, y, color);
        put(image, right, y, color);
    }
}

fn put(image: &mut RgbaImage, x: i64, y: i64, color: Rgba<u8>) {
    if x >= 0 && y >= 0 && x < image.width() as i64 && y < image.height() as i64 {
        image.put_pixel(x as u32, y as u32, color);
    }
}
