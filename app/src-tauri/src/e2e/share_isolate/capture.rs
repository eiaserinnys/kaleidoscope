use super::pixels::PixelStats;
use super::*;
use base64::engine::general_purpose::STANDARD;
use std::collections::BTreeMap;

pub(super) fn decode_image(
    path: &Path,
    out: &Path,
    label: &str,
) -> Result<(Vec<u8>, PixelStats), String> {
    let encoded = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let bytes = STANDARD
        .decode(encoded.trim())
        .map_err(|error| error.to_string())?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("agent image is not PNG".into());
    }
    let rgba = image::load_from_memory(&bytes)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let mut stats = PixelStats {
        width: rgba.width(),
        height: rgba.height(),
        ..Default::default()
    };
    for (x, y, pixel) in rgba.enumerate_pixels() {
        stats.count(x, y, pixel.0);
    }
    fs::write(out.join(format!("{label}.png")), &bytes).map_err(|error| error.to_string())?;
    Ok((bytes, stats))
}

pub(super) fn assert_isolated_surface(
    path: &Path,
    out: &Path,
    label: &str,
    log: &mut File,
    forbidden_blue: bool,
) -> Result<PixelStats, String> {
    let (_, stats) = decode_image(path, out, label)?;
    record(
        log,
        "share.image",
        json!({"label":label,"width":stats.width,"height":stats.height,"green_pixels":stats.green,"blue_pixels":stats.blue,"red_pixels":stats.red,"agent_background_pixels":stats.agent_background}),
    )?;
    stats.validate(false, forbidden_blue)?;
    record(
        log,
        "share.image",
        json!({"label":label,"width":stats.width,"height":stats.height,"green_pixels":stats.green,"blue_pixels":stats.blue,"red_pixels":stats.red,"agent_background_pixels":stats.agent_background,"passed":true}),
    )?;
    Ok(stats)
}

pub(super) fn assert_scrolled_surface(
    path: &Path,
    out: &Path,
    label: &str,
    log: &mut File,
) -> Result<PixelStats, String> {
    let (_, stats) = decode_image(path, out, label)?;
    record(
        log,
        "share.image",
        json!({"label":label,"width":stats.width,"height":stats.height,"green_pixels":stats.green,"blue_pixels":stats.blue,"red_pixels":stats.red,"agent_background_pixels":stats.agent_background}),
    )?;
    stats.validate(true, true)?;
    record(
        log,
        "share.image",
        json!({"label":label,"width":stats.width,"height":stats.height,"green_pixels":stats.green,"blue_pixels":stats.blue,"red_pixels":stats.red,"agent_background_pixels":stats.agent_background,"passed":true}),
    )?;
    Ok(stats)
}

pub(super) fn assert_png(
    path: &Path,
    out: &Path,
    label: &str,
    log: &mut File,
) -> Result<PixelStats, String> {
    let (_, stats) = decode_image(path, out, label)?;
    record(
        log,
        "share.image",
        json!({"label":label,"width":stats.width,"height":stats.height,"green_pixels":stats.green,"blue_pixels":stats.blue,"red_pixels":stats.red,"agent_background_pixels":stats.agent_background,"passed":true}),
    )?;
    Ok(stats)
}

pub(super) fn protected_bounds(app: &AppHandle, _agent_window_id: &str) -> Result<Value, String> {
    let window = app.get_window("main").ok_or("main window not found")?;
    let position = window.inner_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let agent = ui::evaluate(app, &format!(
        "const e=document.querySelector('[data-testid=\\\"app-window-{AGENT_APP_ID}\\\"]');if(!e)throw new Error('agent window missing');const r=e.getBoundingClientRect();return {{x:r.left,y:r.top,width:r.width,height:r.height}};"
    ))?;
    let agent_x =
        position.x + (agent["x"].as_f64().ok_or("agent x missing")? * scale).round() as i32;
    let agent_y =
        position.y + (agent["y"].as_f64().ok_or("agent y missing")? * scale).round() as i32;
    let agent_width =
        (agent["width"].as_f64().ok_or("agent width missing")? * scale).round() as i32;
    let agent_height =
        (agent["height"].as_f64().ok_or("agent height missing")? * scale).round() as i32;
    Ok(json!({
        "client_x": position.x,
        "client_y": position.y,
        "client_width": size.width,
        "client_height": size.height,
        "exclude_x": agent_x,
        "exclude_y": agent_y,
        "exclude_width": agent_width,
        "exclude_height": agent_height
    }))
}

pub(super) fn wait_file(path: &Path, description: &str, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while !path.is_file() {
        if Instant::now() >= deadline {
            return Err(format!("timed out waiting for {description}"));
        }
        thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}

fn remember_recorder_failure(out: &Path, result: Result<(), String>) -> Result<(), String> {
    if let Err(error) = result {
        fs::write(out.join("record.failure"), error).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(super) fn set_phase(
    app: &AppHandle,
    out: &Path,
    agent_window_id: &str,
    phase: &str,
) -> Result<(), String> {
    if out.join("record.failure").is_file() {
        return Ok(());
    }
    let result = (|| -> Result<(), String> {
        let ready = out.join(format!("phase-{phase}.ready"));
        let phase_path = out.join("record.phase");
        if ready.is_file()
            && fs::read_to_string(&phase_path).ok().as_deref() == Some(&format!("{phase}\n"))
        {
            return Ok(());
        }
        if ready.exists() {
            fs::remove_file(&ready).map_err(|error| error.to_string())?;
        }
        fs::write(
            out.join("protected.json"),
            serde_json::to_vec(&protected_bounds(app, agent_window_id)?)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        fs::write(phase_path, format!("{phase}\n")).map_err(|error| error.to_string())?;
        wait_file(&ready, phase, Duration::from_secs(30))
    })();
    remember_recorder_failure(out, result)
}

pub(super) fn start_recorder(
    app: &AppHandle,
    out: &Path,
    agent_window_id: &str,
) -> Result<(), String> {
    let result = (|| -> Result<(), String> {
        fs::write(
            out.join("protected.json"),
            serde_json::to_vec(&protected_bounds(app, agent_window_id)?)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        fs::write(out.join("record.phase"), b"setup\n").map_err(|error| error.to_string())?;
        fs::write(out.join("record.request"), b"").map_err(|error| error.to_string())?;
        wait_file(
            &out.join("record.ready"),
            "screen recorder",
            Duration::from_secs(30),
        )
    })();
    remember_recorder_failure(out, result)
}

pub(super) fn send_prompt(
    app: &AppHandle,
    _core: &Core,
    out: &Path,
    image_dir: &Path,
    agent_window_id: &str,
    text: &str,
    phase: &str,
    focus_results: &mut Vec<(String, bool)>,
    log: &mut File,
) -> Result<Vec<PathBuf>, String> {
    let window = app.get_window("main").ok_or("main window not found")?;
    window.set_focus().map_err(|error| error.to_string())?;
    let selector = format!("[data-testid=\\\"app-window-{AGENT_APP_ID}\\\"]");
    let input = ui::evaluate(app, &format!(
        "const e=document.querySelector('{selector} textarea[aria-label=\\\"메시지\\\"]');if(!e)throw new Error('agent input missing');const r=e.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;return {{x,y,hit:document.elementFromPoint(x,y)?.getAttribute('aria-label')}};"
    ))?;
    let position = window.inner_position().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let x =
        position.x + (input["x"].as_f64().ok_or("agent input x missing")? * scale).round() as i32;
    let y =
        position.y + (input["y"].as_f64().ok_or("agent input y missing")? * scale).round() as i32;
    native_target::wait_shell_at(x, y)?;
    native_input::click(x, y)?;
    let focused = ui::wait_dom(app, &format!(
        "const input=document.querySelector('{selector} textarea[aria-label=\\\"메시지\\\"]');return !!input && document.hasFocus() && document.activeElement===input;"
    ), "agent input focus");
    let focus_before = ui::evaluate(app, &format!(
        "const input=document.querySelector('{selector} textarea[aria-label=\\\"메시지\\\"]');return {{has_focus:document.hasFocus(),active:document.activeElement===input}};"
    ))?;
    record(
        log,
        "agent.input-focus",
        json!({"phase":phase,"hit":input["hit"],"focus":focus_before}),
    )?;
    focused?;
    let text_json = serde_json::to_string(text).map_err(|error| error.to_string())?;
    ui::evaluate(app, &format!(
        "const input=document.querySelector('{selector} textarea[aria-label=\\\"메시지\\\"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,{text_json});input.dispatchEvent(new Event('input',{{bubbles:true}}));return true;"
    ))?;
    ui::wait_dom(app, &format!(
        "const e=document.querySelector('{selector}');const input=e?.querySelector('textarea[aria-label=\\\"메시지\\\"]');const button=e?.querySelector('button[aria-label=\\\"보내기\\\"]');return input?.value==={text_json} && !!button && !button.disabled;"
    ), "agent draft committed and send enabled")?;
    // 전송이 초안을 비운 뒤의 빈 입력 선택 위치가 캡처 내내 유지되어야 한다.
    set_phase(app, out, agent_window_id, phase)?;
    let started = Instant::now();
    ui::evaluate(app, &format!(
        "const input=document.querySelector('{selector} textarea[aria-label=\\\"메시지\\\"]');input.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',code:'Enter',bubbles:true,cancelable:true}}));return true;"
    ))?;
    let images = wait_prompt_images(image_dir, text)?;
    ui::wait_dom(app, &format!(
        "const e=document.querySelector('[data-testid=\\\"app-window-{AGENT_APP_ID}\\\"]');const input=e?.querySelector('textarea[aria-label=\\\"메시지\\\"]');return !!input && !e.querySelector('.ks-agent-chat-working') && !e.querySelector('button[aria-label=\\\"멈춤\\\"]');"
    ), "agent response completed")?;
    let focus = ui::evaluate(app, &format!(
        "const input=document.querySelector('{selector} textarea[aria-label=\\\"메시지\\\"]');return {{has_focus:document.hasFocus(),active:document.activeElement===input,selection:[input?.selectionStart,input?.selectionEnd],value:input?.value}};"
    ))?;
    let focus_ok = focus["has_focus"] == json!(true)
        && focus["active"] == json!(true)
        && focus["selection"] == json!([0, 0])
        && focus["value"] == json!("");
    focus_results.push((phase.to_owned(), focus_ok));
    record(
        log,
        "share.send",
        json!({"phase":phase,"text":text,"visual_count":images.len(),"elapsed_ms":started.elapsed().as_millis(),"focus_after":focus,"focus_ok":focus_ok,"entered_through_input":true}),
    )?;
    Ok(images)
}

pub(super) fn png_stats(bytes: &[u8]) -> Result<PixelStats, String> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let mut stats = PixelStats {
        width: image.width(),
        height: image.height(),
        ..Default::default()
    };
    for (x, y, pixel) in image.enumerate_pixels() {
        stats.count(x, y, pixel.0);
    }
    Ok(stats)
}

pub(super) fn shell_capture(app: &AppHandle) -> Result<(Vec<u8>, f64), String> {
    let host = crate::web_host::TauriWebHost::new(app.clone());
    host.capture_shell()
        .map_err(|error| error.message)?
        .ok_or("main webview capture is empty".into())
}

pub(super) fn assert_restored_scroll(
    app: &AppHandle,
    window_id: &str,
    log: &mut File,
) -> Result<(), String> {
    let view = ui::latest_share_view(window_id).ok_or("share.view missing after restoring A")?;
    let (bytes, scale) = shell_capture(app)?;
    let cropped =
        crop_share_capture_png(&bytes, view.bounds, scale).ok_or("could not crop restored A")?;
    let stats = png_stats(&cropped)?;
    if stats.red == 0 {
        return Err("A returned to the top after restoring from minimized state".into());
    }
    record(
        log,
        "share.scroll-restored",
        json!({"window_id":window_id,"red_bottom_pixels":stats.red,"passed":true}),
    )
}

pub(super) fn cover_active(app: &AppHandle) -> Result<bool, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(crate::freeze_cover::active());
    })
    .map_err(|error| error.to_string())?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|error| error.to_string())
}

pub(super) fn wait_for_recorder(out: &Path, log: &mut File) -> Result<(), String> {
    if let Ok(error) = fs::read_to_string(out.join("record.failure")) {
        let recorder_error = fs::read_to_string(out.join("recorder-error.txt")).unwrap_or_default();
        return Err(format!("screen recorder failed: {error}; {recorder_error}"));
    }
    wait_file(
        &out.join("screen-frames.csv"),
        "screen frame report",
        Duration::from_secs(15),
    )?;
    let content =
        fs::read_to_string(out.join("screen-frames.csv")).map_err(|error| error.to_string())?;
    let rows = content.lines().skip(1).collect::<Vec<_>>();
    if rows.is_empty() {
        return Err("screen recorder captured no frames".into());
    }
    let first = rows
        .first()
        .and_then(|row| row.split(',').nth(1))
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    let last = rows
        .last()
        .and_then(|row| row.split(',').nth(1))
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(first);
    let average_interval_ms = if rows.len() > 1 {
        (last - first) / (rows.len() - 1) as f64
    } else {
        0.0
    };
    let required_phases = [
        "a-covered-by-b",
        "a-covered-by-agent",
        "a-minimized",
        "web-covered",
        "web-minimized",
        "both-covered",
        "a-visible",
        "watchdog",
    ];
    let measured_phases = [
        "a-covered-by-b",
        "a-covered-by-agent",
        "a-minimized",
        "web-covered",
        "web-minimized",
        "both-covered",
        "a-visible",
    ];
    let mut max_protected_pixels = 0usize;
    let mut phases = BTreeMap::<String, usize>::new();
    let mut phase_peaks = BTreeMap::<String, (usize, usize, usize)>::new();
    let mut phase_elapsed = BTreeMap::<String, (f64, f64)>::new();
    let mut first_change = None;
    for row in &rows {
        let columns = row.split(',').collect::<Vec<_>>();
        if columns.len() != 8 {
            return Err(format!("invalid screen recorder row: {row}"));
        }
        let elapsed = columns[1]
            .parse::<f64>()
            .map_err(|error| error.to_string())?;
        let protected = columns[3]
            .parse::<usize>()
            .map_err(|error| error.to_string())?;
        let raw = columns[4]
            .parse::<usize>()
            .map_err(|error| error.to_string())?;
        let max_delta = columns[5]
            .parse::<usize>()
            .map_err(|error| error.to_string())?;
        let phase = columns[6].to_owned();
        if first_change.is_none() && protected > 0 && measured_phases.contains(&phase.as_str()) {
            first_change = Some(format!(
                "phase={phase}, frame={}, ms={}, bbox={}",
                columns[0], columns[1], columns[7]
            ));
        }
        phase_peaks
            .entry(phase.clone())
            .and_modify(|peak| {
                peak.0 = peak.0.max(protected);
                peak.1 = peak.1.max(raw);
                peak.2 = peak.2.max(max_delta);
            })
            .or_insert((protected, raw, max_delta));
        if measured_phases.contains(&phase.as_str()) {
            max_protected_pixels = max_protected_pixels.max(protected);
        }
        *phases.entry(phase.clone()).or_default() += 1;
        phase_elapsed
            .entry(phase)
            .and_modify(|range| range.1 = elapsed)
            .or_insert((elapsed, elapsed));
    }
    let missing = required_phases
        .iter()
        .filter(|phase| !phases.contains_key(**phase))
        .copied()
        .collect::<Vec<_>>();
    let phase_peaks = phase_peaks.into_iter().map(|(phase, (protected, raw, max_delta))| {
        (phase, json!({"protected_pixels":protected,"protected_raw_pixels":raw,"protected_max_delta":max_delta}))
    }).collect::<BTreeMap<_, _>>();
    record(
        log,
        "screen.recording",
        json!({"frames":rows.len(),"average_interval_ms":average_interval_ms,"phase_frames":phases,"phase_peaks":phase_peaks,"max_protected_pixels":max_protected_pixels,"missing_phases":missing,"csv":"screen-frames.csv"}),
    )?;
    if !missing.is_empty() {
        return Err(format!("screen recorder missed phases: {missing:?}"));
    }
    if max_protected_pixels != 0 {
        let changed = phase_elapsed
            .iter()
            .filter(|(phase, _)| measured_phases.contains(&phase.as_str()))
            .filter_map(|(phase, _)| {
                rows.iter()
                    .filter(|row| row.split(',').nth(6) == Some(phase.as_str()))
                    .any(|row| {
                        row.split(',')
                            .nth(3)
                            .and_then(|value| value.parse::<usize>().ok())
                            .is_some_and(|count| count > 0)
                    })
                    .then_some(phase)
            })
            .collect::<Vec<_>>();
        return Err(format!("protected screen pixels changed during isolation: {max_protected_pixels}; phases={changed:?}; first_change={}", first_change.unwrap_or_default()));
    }
    let durations = phase_elapsed
        .iter()
        .map(|(phase, (start, end))| (phase, (end - start).max(0.0)))
        .collect::<BTreeMap<_, _>>();
    fs::write(
        out.join("screen-phase-duration-ms.json"),
        serde_json::to_vec(&durations).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    record(
        log,
        "screen.recording",
        json!({"frames":rows.len(),"average_interval_ms":average_interval_ms,"csv":"screen-frames.csv"}),
    )
}

#[cfg(test)]
#[path = "capture_tests.rs"]
mod tests;
