use super::*;

pub(super) fn set_scroll_to_bottom(
    app: &AppHandle,
    window_id: &str,
    log: &mut File,
) -> Result<(), String> {
    scroll_html_frame(app, window_id, 0x23, "red", "share.scroll-position", log)
}

pub(super) fn set_scroll_to_top(
    app: &AppHandle,
    window_id: &str,
    log: &mut File,
) -> Result<(), String> {
    scroll_html_frame(app, window_id, 0x24, "green", "share.scroll-top", log)
}

fn scroll_html_frame(
    app: &AppHandle,
    window_id: &str,
    key: u16,
    expected_color: &str,
    step: &str,
    log: &mut File,
) -> Result<(), String> {
    let bounds = ui::evaluate(app, &format!(
        "const e=document.querySelector('[data-testid=\\\"app-window-{A_ID}\\\"] iframe');if(!e)throw new Error('HTML frame missing');const r=e.getBoundingClientRect();return {{x:r.left+Math.min(40,r.width/2),y:r.top+Math.min(80,r.height/2)}};"
    ))?;
    let window = app.get_window("main").ok_or("main window not found")?;
    let position = window.inner_position().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let x = position.x + (bounds["x"].as_f64().ok_or("frame x missing")? * scale).round() as i32;
    let y = position.y + (bounds["y"].as_f64().ok_or("frame y missing")? * scale).round() as i32;
    window.set_focus().map_err(|error| error.to_string())?;
    native_input::click_and_key(x, y, key)?;
    thread::sleep(Duration::from_millis(250));
    let view = ui::latest_share_view(window_id).ok_or("share.view is missing before scrolling")?;
    let image = capture::shell_capture(app)?;
    let cropped = crop_share_capture_png(&image.0, view.bounds, image.1)
        .ok_or("could not crop the scrolled HTML frame")?;
    let stats = capture::png_stats(&cropped)?;
    let expected_pixels = match expected_color {
        "red" => stats.red,
        _ => stats.green,
    };
    if expected_pixels == 0 {
        return Err(format!(
            "HTML frame did not scroll to its {expected_color} region: {stats:?}"
        ));
    }
    record(
        log,
        step,
        json!({"window_id":window_id,"color":expected_color,"pixels":expected_pixels,"passed":true}),
    )
}
