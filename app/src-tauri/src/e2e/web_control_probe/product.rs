use super::*;
use kaleidoscope_core::kaleidoscope_contract::{
    Direction, TextMode, WindowAction, WindowChoice, WindowControlOperation, WindowControlResult,
    WindowObservation,
};
use kaleidoscope_core::WebHost;

fn observe(view: &Webview) -> Result<Value, String> {
    let result = cdp(view, ProbeCall::Evaluate(
        "({clicks:document.querySelector('#clicks').textContent, input:document.querySelector('#input').value, keys:document.querySelector('#keys').textContent, choice:document.querySelector('#choice').value, scroll:document.querySelector('#scroll').scrollTop})".into(),
    ))?;
    Ok(result["result"]["value"].clone())
}

fn target(observation: &WindowObservation, role: &str, name: &str) -> Result<u32, String> {
    observation
        .text
        .lines()
        .find_map(|line| {
            let (number, description) = line.strip_prefix('[')?.split_once("] ")?;
            if description.starts_with(&format!("{role} {name}")) {
                number.parse().ok()
            } else {
                None
            }
        })
        .ok_or_else(|| {
            format!(
                "제품 읽기에서 요소 누락: {role} {name}: {}",
                observation.text
            )
        })
}

fn request(
    host: &crate::web_host::TauriWebHost,
    id: &str,
    operation: WindowControlOperation,
    probe: &mut FocusProbe<'_>,
    foreground: bool,
) -> Result<WindowObservation, String> {
    let previous = match &operation {
        WindowControlOperation::Act { view_id, .. } => Some(view_id.clone()),
        WindowControlOperation::Read { .. } => None,
    };
    let (result, focus) = with_focus(probe, foreground, || {
        host.control(id, &operation).map_err(|error| error.message)
    });
    if !foreground && focus["status"] != "된다" {
        return Err(format!("다른 프로그램의 포커스가 바뀜: {focus}"));
    }
    match result? {
        WindowControlResult::Ok { value } => {
            if let Some(previous) = previous {
                if value.before_text.is_none() || value.after.view_id == previous {
                    return Err("조작 전 글 또는 새 읽기 판이 없음".into());
                }
            }
            Ok(value.after)
        }
        WindowControlResult::Error { error, applied } => {
            Err(format!("{} (applied={applied})", error.message))
        }
    }
}

fn act(
    host: &crate::web_host::TauriWebHost,
    id: &str,
    before: &WindowObservation,
    action: WindowAction,
    image: bool,
    probe: &mut FocusProbe<'_>,
    foreground: bool,
) -> Result<WindowObservation, String> {
    request(
        host,
        id,
        WindowControlOperation::Act {
            view_id: before.view_id.clone(),
            action,
            image,
        },
        probe,
        foreground,
    )
}

pub(super) fn phase(
    host: &crate::web_host::TauriWebHost,
    view: &Webview,
    id: &str,
    probe: &mut FocusProbe<'_>,
    foreground: bool,
    out: &Path,
    label: &str,
) -> Value {
    let mut run = || -> Result<Value, String> {
        cdp(
            view,
            ProbeCall::Evaluate("document.querySelector('#scroll').scrollTop = 0".into()),
        )?;
        let before = observe(view)?;
        let mut observation = request(
            host,
            id,
            WindowControlOperation::Read { image: true },
            probe,
            foreground,
        )?;
        let png = STANDARD
            .decode(
                observation
                    .image_base64
                    .as_deref()
                    .ok_or("제품 읽기 PNG 없음")?,
            )
            .map_err(|e| e.to_string())?;
        let (width, height) = png_dimensions(&png)?;
        let decoded = image::load_from_memory(&png)
            .map_err(|e| e.to_string())?
            .to_rgba8();
        let first = decoded.get_pixel(0, 0);
        if !decoded.pixels().any(|pixel| pixel != first) {
            return Err("제품 읽기 그림이 단색임".into());
        }
        let geometry = observation.geometry.as_ref().ok_or("제품 읽기 크기 없음")?;
        if width != geometry.pixel_width
            || height != geometry.pixel_height
            || width.max(height) > 1600
        {
            return Err("제품 읽기 PNG 크기 불일치".into());
        }
        fs::write(out.join(format!("{label}-product.png")), png).map_err(|e| e.to_string())?;
        let button = target(&observation, "button", "Probe button")?;
        observation = act(
            host,
            id,
            &observation,
            WindowAction::Click {
                target: button,
                gesture: None,
            },
            false,
            probe,
            foreground,
        )?;
        let input = target(&observation, "textbox", "Probe input")?;
        observation = act(
            host,
            id,
            &observation,
            WindowAction::Type {
                target: input,
                text: "replace".into(),
                mode: TextMode::Replace,
            },
            false,
            probe,
            foreground,
        )?;
        let input = target(&observation, "textbox", "Probe input")?;
        observation = act(
            host,
            id,
            &observation,
            WindowAction::Type {
                target: input,
                text: "+append".into(),
                mode: TextMode::Append,
            },
            false,
            probe,
            foreground,
        )?;
        let choice = target(&observation, "combobox", "Probe choice")?;
        observation = act(
            host,
            id,
            &observation,
            WindowAction::Select {
                target: choice,
                choice: WindowChoice::Label("Second".into()),
            },
            false,
            probe,
            foreground,
        )?;
        let input = target(&observation, "textbox", "Probe input")?;
        observation = act(
            host,
            id,
            &observation,
            WindowAction::Key {
                target: Some(input),
                key: "Enter".into(),
            },
            false,
            probe,
            foreground,
        )?;
        let scroll = target(&observation, "button", "Scroll target")?;
        let after_observation = act(
            host,
            id,
            &observation,
            WindowAction::Scroll {
                target: Some(scroll),
                direction: Direction::Down,
                amount: 60,
            },
            true,
            probe,
            foreground,
        )?;
        let after_png = STANDARD
            .decode(
                after_observation
                    .image_base64
                    .as_deref()
                    .ok_or("조작 후 PNG 없음")?,
            )
            .map_err(|e| e.to_string())?;
        let after_size = png_dimensions(&after_png)?;
        let after_geometry = after_observation
            .geometry
            .as_ref()
            .ok_or("조작 후 PNG 크기 없음")?;
        if after_size != (after_geometry.pixel_width, after_geometry.pixel_height)
            || after_size.0.max(after_size.1) > 1600
        {
            return Err("조작 후 PNG 크기 불일치".into());
        }
        let after = observe(view)?;
        let count = |value: &Value, field: &str| -> Result<u64, String> {
            value[field]
                .as_str()
                .and_then(|s| s.split_whitespace().last())
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| format!("카운터 오류: {field}"))
        };
        if count(&after, "clicks")? != count(&before, "clicks")? + 1
            || after["input"] != "replace+append"
            || after["choice"] != "two"
            || count(&after, "keys")? != count(&before, "keys")? + 1
            || after["scroll"].as_f64().unwrap_or_default()
                <= before["scroll"].as_f64().unwrap_or_default()
        {
            return Err(format!(
                "제품 조작 결과 불일치: before={before}, after={after}"
            ));
        }
        Ok(json!({"before":before,"after":after,"png":[width,height]}))
    };
    match run() {
        Ok(detail) => outcome(true, detail),
        Err(error) => failed(error),
    }
}
