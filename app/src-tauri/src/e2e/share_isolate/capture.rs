use super::*;

#[derive(Debug, Default)]
pub(super) struct PixelStats {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) green: usize,
    pub(super) blue: usize,
    pub(super) red: usize,
}

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
    for pixel in rgba.pixels() {
        let [r, g, b, _] = pixel.0;
        if g > 150 && g > r.saturating_mul(3) / 2 && g > b.saturating_mul(3) / 2 {
            stats.green += 1;
        }
        if b > 170 && b > r.saturating_mul(3) / 2 && b > g.saturating_mul(6) / 5 {
            stats.blue += 1;
        }
        if r > 160 && r > g.saturating_mul(3) / 2 && r > b.saturating_mul(3) / 2 {
            stats.red += 1;
        }
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
    let pixels = (stats.width as usize)
        .saturating_mul(stats.height as usize)
        .max(1);
    if stats.green * 100 < pixels * 60 {
        return Err(format!(
            "{label} image is not mostly the target surface: {} green pixels / {pixels}",
            stats.green
        ));
    }
    if forbidden_blue && stats.blue != 0 {
        return Err(format!(
            "{label} image contains {} pixels from the blue covering window",
            stats.blue
        ));
    }
    record(
        log,
        "share.image",
        json!({"label":label,"width":stats.width,"height":stats.height,"green_pixels":stats.green,"blue_pixels":stats.blue,"red_pixels":stats.red,"passed":true}),
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
    let pixels = (stats.width as usize)
        .saturating_mul(stats.height as usize)
        .max(1);
    if stats.red * 100 < pixels * 60 {
        return Err(format!(
            "{label} image does not show the scrolled lower region: {} red pixels / {pixels}",
            stats.red
        ));
    }
    if stats.blue != 0 {
        return Err(format!(
            "{label} image contains {} pixels from the blue covering window",
            stats.blue
        ));
    }
    record(
        log,
        "share.image",
        json!({"label":label,"width":stats.width,"height":stats.height,"green_pixels":stats.green,"blue_pixels":stats.blue,"red_pixels":stats.red,"passed":true}),
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
        json!({"label":label,"width":stats.width,"height":stats.height,"green_pixels":stats.green,"blue_pixels":stats.blue,"red_pixels":stats.red,"passed":true}),
    )?;
    Ok(stats)
}

pub(super) fn protected_bounds(app: &AppHandle, agent_window_id: &str) -> Result<Value, String> {
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

pub(super) fn set_phase(
    app: &AppHandle,
    out: &Path,
    agent_window_id: &str,
    phase: &str,
) -> Result<(), String> {
    let ready = out.join(format!("phase-{phase}.ready"));
    if ready.exists() {
        fs::remove_file(&ready).map_err(|error| error.to_string())?;
    }
    fs::write(
        out.join("protected.json"),
        serde_json::to_vec(&protected_bounds(app, agent_window_id)?)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::write(out.join("record.phase"), phase.as_bytes()).map_err(|error| error.to_string())?;
    wait_file(&ready, phase, Duration::from_secs(30))
}

pub(super) fn start_recorder(
    app: &AppHandle,
    out: &Path,
    agent_window_id: &str,
) -> Result<(), String> {
    fs::write(
        out.join("protected.json"),
        serde_json::to_vec(&protected_bounds(app, agent_window_id)?)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::write(out.join("record.phase"), b"setup").map_err(|error| error.to_string())?;
    fs::write(out.join("record.request"), b"").map_err(|error| error.to_string())?;
    wait_file(
        &out.join("record.ready"),
        "screen recorder",
        Duration::from_secs(30),
    )
}

pub(super) fn send_prompt(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    image_dir: &Path,
    agent_window_id: &str,
    text: &str,
    expected_visuals: usize,
    phase: &str,
    log: &mut File,
) -> Result<Vec<PathBuf>, String> {
    set_phase(app, out, agent_window_id, phase)?;
    let start_count = count_images(image_dir)?;
    let started = Instant::now();
    let text_json = serde_json::to_string(text).map_err(|error| error.to_string())?;
    let result = ui::evaluate(app, &format!(
        "const input=document.querySelector('[data-testid=\\\"app-window-{AGENT_APP_ID}\\\"] textarea[aria-label=\\\"메시지\\\"]');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;setter.call(input,{text_json});input.dispatchEvent(new Event('input',{{bubbles:true}}));input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',code:'Enter',bubbles:true,cancelable:true}}));return true;"
    ))?;
    if result != json!(true) {
        return Err("could not submit through the agent input".into());
    }
    let images = wait_images(image_dir, start_count + expected_visuals)?;
    wait_agent_phase(core, agent_window_id, LocalAgentPhase::Ready)?;
    let focus = ui::evaluate(app, &format!(
        "const input=document.querySelector('[data-testid=\\\"app-window-{AGENT_APP_ID}\\\"] textarea[aria-label=\\\"메시지\\\"]');return {{has_focus:document.hasFocus(),active:document.activeElement===input,selection:[input?.selectionStart,input?.selectionEnd]}};"
    ))?;
    if focus["has_focus"] != json!(true) || focus["active"] != json!(true) {
        return Err(format!(
            "agent input focus changed during image capture: {focus}"
        ));
    }
    record(
        log,
        "share.send",
        json!({"phase":phase,"text":text,"visual_count":expected_visuals,"elapsed_ms":started.elapsed().as_millis(),"focus":focus,"entered_through_input":true}),
    )?;
    Ok(images
        .into_iter()
        .skip(start_count)
        .take(expected_visuals)
        .collect())
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
    for pixel in image.pixels() {
        let [r, g, b, _] = pixel.0;
        if g > 150 && g > r.saturating_mul(3) / 2 && g > b.saturating_mul(3) / 2 {
            stats.green += 1;
        }
        if b > 170 && b > r.saturating_mul(3) / 2 && b > g.saturating_mul(6) / 5 {
            stats.blue += 1;
        }
        if r > 160 && r > g.saturating_mul(3) / 2 && r > b.saturating_mul(3) / 2 {
            stats.red += 1;
        }
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
    out: &Path,
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

pub(super) fn wait_web_loaded(core: &Core, window_id: &str) -> Result<WebPage, String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        match call(
            core,
            CoreRequest::WebAttach {
                window_id: window_id.into(),
                url: "https://example.com/".into(),
            },
        )? {
            CoreReply::WebAttach { page }
                if !page.loading && page.url.starts_with("https://example.com") =>
            {
                return Ok(page)
            }
            CoreReply::WebAttach { .. } => {}
            reply => return Err(format!("unexpected web.attach response: {reply:?}")),
        }
        if Instant::now() >= deadline {
            return Err("example.com web view did not finish loading".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
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
    let mut phase_elapsed = BTreeMap::<String, (f64, f64)>::new();
    for row in &rows {
        let columns = row.split(',').collect::<Vec<_>>();
        if columns.len() != 5 {
            return Err(format!("invalid screen recorder row: {row}"));
        }
        let elapsed = columns[1]
            .parse::<f64>()
            .map_err(|error| error.to_string())?;
        let protected = columns[3]
            .parse::<usize>()
            .map_err(|error| error.to_string())?;
        let phase = columns[4].to_owned();
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
    if !missing.is_empty() {
        return Err(format!("screen recorder missed phases: {missing:?}"));
    }
    if max_protected_pixels != 0 {
        let changed = phase_elapsed
            .iter()
            .filter(|(phase, _)| measured_phases.contains(&phase.as_str()))
            .filter_map(|(phase, _)| {
                rows.iter()
                    .filter(|row| row.split(',').nth(4) == Some(phase.as_str()))
                    .any(|row| {
                        row.split(',')
                            .nth(3)
                            .and_then(|value| value.parse::<usize>().ok())
                            .is_some_and(|count| count > 0)
                    })
                    .then_some(phase)
            })
            .collect::<Vec<_>>();
        return Err(format!("protected screen pixels changed during isolation: {max_protected_pixels}; phases={changed:?}"));
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
