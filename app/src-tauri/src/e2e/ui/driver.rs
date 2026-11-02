use super::*;
use std::sync::Mutex;

static UI_REQUESTS: Mutex<Vec<CoreRequest>> = Mutex::new(Vec::new());
static UI_CAPTURE_DURATIONS: Mutex<Vec<(String, u128)>> = Mutex::new(Vec::new());

pub(super) type WebEvents = Arc<Mutex<Vec<(String, WebPage)>>>;

pub(super) fn observe(request: &CoreRequest) {
    if matches!(
        request,
        CoreRequest::WebAttach { .. }
            | CoreRequest::WebPlace { .. }
            | CoreRequest::WebCapture { .. }
            | CoreRequest::WebNavigate { .. }
            | CoreRequest::FilesPickFolder { .. }
            | CoreRequest::FilesAllowPc { .. }
            | CoreRequest::FilesOpen { .. }
            | CoreRequest::WindowRaise { .. }
            | CoreRequest::ShareView { .. }
            | CoreRequest::ShareFreeze { .. }
            | CoreRequest::ShareCapture { .. }
            | CoreRequest::ShareUnfreeze { .. }
    ) {
        UI_REQUESTS.lock().unwrap().push(request.clone());
    }
}

pub(super) fn complete(request: &CoreRequest, elapsed_ms: u128) {
    if let CoreRequest::ShareCapture { window_id } = request {
        UI_CAPTURE_DURATIONS
            .lock()
            .unwrap()
            .push((window_id.clone(), elapsed_ms));
    }
}

fn has_place(requests: &[CoreRequest], window_id: &str, visible: bool) -> bool {
    requests.iter().any(|request| matches!(request,
        CoreRequest::WebPlace { window_id: id, bounds } if id == window_id && bounds.is_some() == visible
    ))
}

pub(super) fn request_mark() -> usize {
    UI_REQUESTS.lock().unwrap().len()
}

pub(super) fn requests_since(mark: usize) -> Vec<CoreRequest> {
    UI_REQUESTS.lock().unwrap()[mark..].to_vec()
}

pub(super) fn capture_duration_mark() -> usize {
    UI_CAPTURE_DURATIONS.lock().unwrap().len()
}

pub(super) fn capture_durations_since(mark: usize) -> Vec<(String, u128)> {
    UI_CAPTURE_DURATIONS.lock().unwrap()[mark..].to_vec()
}

pub(super) fn latest_share_view(
    window_id: &str,
) -> Option<kaleidoscope_core::kaleidoscope_contract::VisibleView> {
    UI_REQUESTS
        .lock()
        .unwrap()
        .iter()
        .rev()
        .find_map(|request| match request {
            CoreRequest::ShareView {
                window_id: id,
                view,
            } if id == window_id => Some(view.clone()),
            _ => None,
        })
}

pub(super) fn wait_until(
    label: &str,
    mut ready: impl FnMut() -> Result<bool, String>,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if ready()? {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("timed out waiting for {label}"));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

pub(super) fn wait_place(
    window_id: &str,
    start: usize,
    visible: bool,
    log: &mut File,
) -> Result<(), String> {
    wait_until("UI web.place", || {
        let requests = UI_REQUESTS.lock().unwrap();
        Ok(has_place(&requests[start..], window_id, visible))
    })?;
    let request = {
        let requests = UI_REQUESTS.lock().unwrap();
        requests[start..].iter().rev().find(|request| matches!(request,
            CoreRequest::WebPlace { window_id: id, bounds } if id == window_id && bounds.is_some() == visible
        )).cloned().ok_or("UI web.place disappeared")?
    };
    record(
        log,
        "ui.web.place",
        serde_json::to_value(request).map_err(|e| e.to_string())?,
    )
}

pub(super) fn evaluate(app: &AppHandle, body: &str) -> Result<Value, String> {
    let main = app.get_webview("main").ok_or("main webview not found")?;
    let script = format!(
        "(()=>{{try{{return JSON.stringify((()=>{{{body}}})());}}catch(e){{return JSON.stringify({{__error:String(e)}});}}}})()"
    );
    let (tx, rx) = mpsc::channel();
    main.eval_with_callback(script, move |result| {
        let _ = tx.send(result);
    })
    .map_err(|error| error.to_string())?;
    let raw = rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let json: String =
        serde_json::from_str(&raw).map_err(|error| format!("eval response {raw}: {error}"))?;
    let value: Value = serde_json::from_str(&json).map_err(|error| error.to_string())?;
    if let Some(error) = value.get("__error").and_then(Value::as_str) {
        return Err(format!("UI evaluation failed: {error}"));
    }
    Ok(value)
}

pub(super) fn action(app: &AppHandle, body: &str, label: &str) -> Result<(), String> {
    if evaluate(app, body)? == json!(true) {
        Ok(())
    } else {
        Err(format!("UI action failed: {label}"))
    }
}

pub(super) fn wait_dom(app: &AppHandle, body: &str, label: &str) -> Result<(), String> {
    wait_until(label, || Ok(evaluate(app, body)? == json!(true)))
}

pub(super) fn snapshot(
    core: &Core,
) -> Result<kaleidoscope_core::kaleidoscope_contract::ShellSnapshot, String> {
    match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot } => Ok(snapshot),
        reply => Err(format!("unexpected state response: {reply:?}")),
    }
}

pub(super) fn open(
    core: &Core,
    desktop_id: &str,
    app_id: &str,
    rect: Rect,
) -> Result<String, String> {
    match call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop_id.into(),
            app_id: app_id.into(),
            rect: Some(rect),
        },
    )? {
        CoreReply::WindowOpen { window } => Ok(window.id),
        reply => Err(format!("unexpected window response: {reply:?}")),
    }
}

pub(super) fn wait_web(events: &WebEvents, id: &str, url: &str) -> Result<WebPage, String> {
    wait_until("web.update", || {
        Ok(events
            .lock()
            .unwrap()
            .iter()
            .any(|(window, page)| window == id && page.url.starts_with(url) && !page.loading))
    })?;
    events
        .lock()
        .unwrap()
        .iter()
        .rev()
        .find(|(window, page)| window == id && page.url.starts_with(url) && !page.loading)
        .map(|(_, page)| page.clone())
        .ok_or("web.update disappeared".into())
}

pub(super) fn on_top(core: &Core, window_id: &str) -> Result<bool, String> {
    let snap = snapshot(core)?;
    let Some(window) = snap.shared.windows.iter().find(|item| item.id == window_id) else {
        return Ok(false);
    };
    Ok(snap
        .shared
        .windows
        .iter()
        .filter(|item| item.desktop_id == window.desktop_id)
        .all(|other| window.z >= other.z))
}

pub(super) fn editor_state(core: &Core, path: &str) -> Result<Option<(String, usize)>, String> {
    let snap = snapshot(core)?;
    let editors: Vec<_> = snap
        .shared
        .windows
        .iter()
        .filter(|window| window.app_id == "md-editor")
        .collect();
    Ok(editors
        .iter()
        .find(|window| window.state.get("current_file") == Some(&json!(path)))
        .map(|window| (window.id.clone(), editors.len())))
}

pub(super) fn require_request(
    log: &mut File,
    start: usize,
    label: &str,
    predicate: impl Fn(&CoreRequest) -> bool,
) -> Result<(), String> {
    wait_until(label, || {
        Ok(UI_REQUESTS.lock().unwrap()[start..].iter().any(&predicate))
    })?;
    let request = UI_REQUESTS.lock().unwrap()[start..]
        .iter()
        .find(|item| predicate(item))
        .cloned()
        .ok_or_else(|| format!("UI request disappeared: {label}"))?;
    record(
        log,
        "ui.request",
        serde_json::to_value(request).map_err(|e| e.to_string())?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_placing_and_hiding_the_right_window() {
        let shown = CoreRequest::WebPlace {
            window_id: "browser".into(),
            bounds: Some(Rect {
                x: 1,
                y: 2,
                width: 30,
                height: 40,
            }),
        };
        let hidden = CoreRequest::WebPlace {
            window_id: "browser".into(),
            bounds: None,
        };
        assert!(has_place(&[shown.clone()], "browser", true));
        assert!(!has_place(&[shown.clone()], "browser", false));
        assert!(!has_place(&[shown], "other", true));
        assert!(has_place(&[hidden.clone()], "browser", false));
        assert!(!has_place(&[hidden], "browser", true));
        assert!(!has_place(&[], "browser", false));
    }
}
