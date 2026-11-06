//! Windows 웹뷰 제어. 허용된 변경 범위가 단일 제품 파일이므로 500줄을 넘는다.
use kaleidoscope_core::kaleidoscope_contract as contract;
use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Duration;
use tauri::Webview;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::HSTRING;

// PURE_TEST_BEGIN
#[derive(Default)]
pub(crate) struct WindowControlState {
    document_key: String,
    numbers: std::collections::HashMap<i64, u32>,
    next_number: u32,
    view_id: String,
    targets: std::collections::HashMap<u32, TargetEntry>,
}
#[derive(Clone, Default)]
struct TargetEntry {
    backend_node_id: i64,
    role: String,
    _name: String,
    _value: String,
    center_x: f64,
    center_y: f64,
    disabled: bool,
    readonly: bool,
}
impl WindowControlState {
    fn document(&mut self, key: &str) {
        if self.document_key != key {
            self.document_key = key.into();
            self.numbers.clear();
            self.next_number = 0;
        }
    }
    fn number(&mut self, node: i64) -> u32 {
        *self.numbers.entry(node).or_insert_with(|| {
            self.next_number += 1;
            self.next_number
        })
    }
}
struct KeySpec {
    key: String,
    code: String,
    virtual_key: u32,
    modifiers: u32,
}
fn visible_bounds(model: &Value, width: f64, height: f64) -> Option<(f64, f64)> {
    let points = model["model"]["content"].as_array()?;
    if points.len() != 8 {
        return None;
    }
    let xs: Vec<f64> = (0..4)
        .map(|i| points[i * 2].as_f64())
        .collect::<Option<_>>()?;
    let ys: Vec<f64> = (0..4)
        .map(|i| points[i * 2 + 1].as_f64())
        .collect::<Option<_>>()?;
    let min_x = xs.iter().copied().fold(f64::INFINITY, f64::min);
    let max_x = xs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let min_y = ys.iter().copied().fold(f64::INFINITY, f64::min);
    let max_y = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if max_x - min_x <= 0.5
        || max_y - min_y <= 0.5
        || max_x <= 0.0
        || max_y <= 0.0
        || min_x >= width
        || min_y >= height
    {
        return None;
    }
    Some(((min_x + max_x) / 2.0, (min_y + max_y) / 2.0))
}
fn parse_key(input: &str) -> Option<KeySpec> {
    let literal_plus = input == "+";
    let mut parts = if literal_plus { "" } else { input }.split('+').peekable();
    let mut modifiers = 0;
    let mut key = "";
    while let Some(part) = parts.next() {
        if parts.peek().is_none() {
            key = part;
            break;
        }
        let bit = match part {
            "Alt" => 1,
            "Control" => 2,
            "Meta" => 4,
            "Shift" => 8,
            _ => return None,
        };
        if modifiers & bit != 0 {
            return None;
        }
        modifiers |= bit;
    }
    if literal_plus {
        key = "+";
    }
    let (name, code, vk) = match key {
        "Enter" => ("Enter".into(), "Enter".into(), 13),
        "Escape" => ("Escape".into(), "Escape".into(), 27),
        "Tab" => ("Tab".into(), "Tab".into(), 9),
        "Backspace" => ("Backspace".into(), "Backspace".into(), 8),
        "Delete" => ("Delete".into(), "Delete".into(), 46),
        "Space" => (" ".into(), "Space".into(), 32),
        "ArrowUp" => (key.into(), key.into(), 38),
        "ArrowDown" => (key.into(), key.into(), 40),
        "ArrowLeft" => (key.into(), key.into(), 37),
        "ArrowRight" => (key.into(), key.into(), 39),
        "Home" => (key.into(), key.into(), 36),
        "End" => (key.into(), key.into(), 35),
        "PageUp" => (key.into(), key.into(), 33),
        "PageDown" => (key.into(), key.into(), 34),
        _ if key.chars().count() == 1 => {
            let c = key.chars().next()?;
            let upper = c.to_ascii_uppercase();
            let code = if c.is_ascii_alphabetic() {
                format!("Key{upper}")
            } else if c.is_ascii_digit() {
                format!("Digit{c}")
            } else {
                String::new()
            };
            (
                key.into(),
                code,
                if c.is_ascii() { upper as u32 } else { 0 },
            )
        }
        _ => return None,
    };
    Some(KeySpec {
        key: name,
        code,
        virtual_key: vk,
        modifiers,
    })
}
fn supports_action(action: &contract::WindowAction) -> bool {
    !matches!(action, contract::WindowAction::Point { .. })
}
fn current_target(
    state: &WindowControlState,
    number: u32,
    old: &TargetEntry,
) -> Option<TargetEntry> {
    state
        .targets
        .get(&number)
        .filter(|entry| entry.backend_node_id == old.backend_node_id && entry.role == old.role)
        .cloned()
}
const VISIBLE_POINT_JS: &str = r#"function() {
    let clipLeft = 0, clipTop = 0, clipRight = window.innerWidth, clipBottom = window.innerHeight;
    const ancestor = element => element.parentElement || element.getRootNode?.().host || null;
    for (let parent = ancestor(this); parent; parent = ancestor(parent)) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { clipLeft = Math.max(clipLeft, rect.left); clipRight = Math.min(clipRight, rect.right); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { clipTop = Math.max(clipTop, rect.top); clipBottom = Math.min(clipBottom, rect.bottom); }
    }
    const rects = this.getClientRects();
    for (const box of rects.length ? rects : [this.getBoundingClientRect()]) {
        const left = Math.max(clipLeft, box.left), top = Math.max(clipTop, box.top);
        const right = Math.min(clipRight, box.right), bottom = Math.min(clipBottom, box.bottom);
        if (right - left <= 0.5 || bottom - top <= 0.5) continue;
        for (const [fx, fy] of [[0.5,0.5],[0.2,0.2],[0.8,0.2],[0.2,0.8],[0.8,0.8]]) {
            const x = left + (right-left)*fx, y = top + (bottom-top)*fy;
            let hit = document.elementFromPoint(x,y);
            const roots = [];
            for (let root = this.getRootNode?.(); root?.host; root = root.host.getRootNode?.()) roots.push(root);
            for (const root of roots.reverse()) {
                if (hit !== root.host) break;
                hit = root.elementFromPoint(x,y);
            }
            if (hit === this || this.contains(hit)) return {x,y};
        }
    }
    return null;
}"#;
// PURE_TEST_END

#[cfg(feature = "e2e")]
pub(crate) enum ProbeCall {
    NewDocument(String),
    EnableAccessibility,
    AccessibilityTree,
    BoxModel(i64),
    Focus(i64),
    Mouse { pressed: bool, x: f64, y: f64 },
    InsertText(String),
    Enter { down: bool },
    Evaluate(String),
}

#[cfg(feature = "e2e")]
impl ProbeCall {
    fn protocol(self) -> (&'static str, Value) {
        match self {
            Self::NewDocument(source) => ("Page.addScriptToEvaluateOnNewDocument", json!({"source":source})),
            Self::EnableAccessibility => ("Accessibility.enable", json!({})),
            Self::AccessibilityTree => ("Accessibility.getFullAXTree", json!({})),
            Self::BoxModel(id) => ("DOM.getBoxModel", json!({"backendNodeId": id})),
            Self::Focus(id) => ("DOM.focus", json!({"backendNodeId": id})),
            Self::Mouse { pressed, x, y } => (
                "Input.dispatchMouseEvent",
                json!({
                    "type": if pressed { "mousePressed" } else { "mouseReleased" },
                    "x": x, "y": y, "button": "left", "clickCount": 1
                }),
            ),
            Self::InsertText(text) => ("Input.insertText", json!({"text": text})),
            Self::Enter { down } => (
                "Input.dispatchKeyEvent",
                json!({
                    "type": if down { "keyDown" } else { "keyUp" },
                    "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13,
                    "nativeVirtualKeyCode": 13
                }),
            ),
            Self::Evaluate(expression) => (
                "Runtime.evaluate",
                json!({"expression": expression, "returnByValue": true}),
            ),
        }
    }
}

// 호출자는 E2E 작업 스레드다. UI 스레드는 요청과 완료 콜백만 실행한다.
#[cfg(feature = "e2e")]
pub(crate) fn probe(view: &Webview, operation: ProbeCall) -> Result<Value, String> {
    let (method, params) = operation.protocol();
    call(view, method, params)
}

fn call(view: &Webview, method: &'static str, params: Value) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |native| {
        let immediate = tx.clone();
        let callback =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, result| {
                let output = status.map_err(|e| e.to_string()).and_then(|_| {
                    serde_json::from_str(&result).map_err(|_| format!("{method} 응답을 읽지 못함"))
                });
                let _ = tx.send(output);
                Ok(())
            }));
        let result = unsafe {
            native.controller().CoreWebView2().and_then(|web| {
                let method = HSTRING::from(method);
                let params = HSTRING::from(params.to_string());
                web.CallDevToolsProtocolMethod(&method, &params, &callback)
            })
        };
        if let Err(error) = result {
            let _ = immediate.send(Err(format!("{method}: {error}")));
        }
    })
    .map_err(|error| format!("{method} 예약: {error}"))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|error| format!("{method} 완료 대기: {error}"))?
}

use base64::{engine::general_purpose::STANDARD, Engine as _};
use contract::{
    errors, CoreError, Direction, PointGesture, TextMode, WindowAction, WindowChoice,
    WindowControlOperation, WindowControlResult, WindowControlSuccess, WindowGeometry,
    WindowObservation,
};
use std::sync::atomic::{AtomicU64, Ordering};

static VIEW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn ax_error(id: &str, _: impl std::fmt::Display) -> CoreError {
    errors::WEB_CONTROL_AX_READ_FAILED(id, "웹뷰의 접근성 정보를 가져오지 못했습니다")
}
fn input_error(id: &str, _: impl std::fmt::Display) -> CoreError {
    errors::WEB_CONTROL_INPUT_FAILED(id, "웹뷰에 동작을 전달하지 못했습니다")
}
fn node_error(id: &str, _: impl std::fmt::Display) -> CoreError {
    errors::WEB_CONTROL_NODE_RESOLVE_FAILED(id, "웹뷰의 요소를 찾지 못했습니다")
}
fn prop<'a>(node: &'a Value, name: &str) -> Option<&'a Value> {
    node["properties"]
        .as_array()?
        .iter()
        .find(|p| p["name"] == name)
        .map(|p| &p["value"]["value"])
}
fn actionable(role: &str) -> bool {
    matches!(
        role,
        "button"
            | "link"
            | "textbox"
            | "searchbox"
            | "combobox"
            | "listbox"
            | "option"
            | "checkbox"
            | "radio"
            | "switch"
            | "tab"
            | "menuitem"
            | "menuitemcheckbox"
            | "menuitemradio"
            | "slider"
            | "spinbutton"
            | "treeitem"
            | "DisclosureTriangle"
            | "Summary"
    )
}
fn object_value<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key]["value"].as_str().unwrap_or("")
}

fn read_view(
    view: &Webview,
    id: &str,
    page: &std::sync::Arc<std::sync::Mutex<contract::WebPage>>,
    state: &mut WindowControlState,
    image: bool,
    capture: &impl Fn() -> Result<Vec<u8>, CoreError>,
) -> Result<WindowObservation, CoreError> {
    call(view, "Accessibility.enable", json!({})).map_err(|e| ax_error(id, e))?;
    let tree = call(view, "Accessibility.getFullAXTree", json!({})).map_err(|e| ax_error(id, e))?;
    let viewport = call(view, "Runtime.evaluate", json!({"expression":"({ width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 800), height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 600), docKey: location.origin + location.pathname, title: document.title || '', ready: document.readyState === 'complete' })","returnByValue":true})).map_err(|e| ax_error(id, e))?;
    let viewport = &viewport["result"]["value"];
    let width = viewport["width"]
        .as_f64()
        .ok_or_else(|| ax_error(id, "width"))?;
    let height = viewport["height"]
        .as_f64()
        .ok_or_else(|| ax_error(id, "height"))?;
    let key = viewport["docKey"]
        .as_str()
        .ok_or_else(|| ax_error(id, "document"))?;
    state.document(key);
    let mut targets = std::collections::HashMap::new();
    let mut text = String::new();
    let nodes = tree["nodes"]
        .as_array()
        .ok_or_else(|| ax_error(id, "tree"))?;
    for node in nodes {
        if node["ignored"] == true {
            continue;
        }
        let role = object_value(node, "role");
        let name = object_value(node, "name");
        let backend = node["backendDOMNodeId"].as_i64();
        let mut entry = None;
        let line = if actionable(role) {
            let Some(backend) = backend else { continue };
            let Ok(model) = call(view, "DOM.getBoxModel", json!({"backendNodeId":backend})) else {
                continue;
            };
            if visible_bounds(&model, width, height).is_none() {
                continue;
            }
            let Ok(Some((center_x, center_y))) = visible_point(view, id, backend) else {
                continue;
            };
            let number = state.number(backend);
            let disabled = prop(node, "disabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let readonly = prop(node, "readonly")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let value = object_value(node, "value");
            let mut line = format!("[{number}] {role}");
            if !name.is_empty() {
                line.push(' ');
                line.push_str(name);
            }
            if !value.is_empty() {
                line.push_str(" = ");
                line.push_str(value);
            }
            if disabled {
                line.push_str(" (비활성)");
            }
            if readonly {
                line.push_str(" (읽기 전용)");
            }
            for key in ["checked", "selected"] {
                if let Some(value) = prop(node, key) {
                    line.push_str(&format!(" ({key}: {value})"));
                }
            }
            entry = Some((
                number,
                TargetEntry {
                    backend_node_id: backend,
                    role: role.into(),
                    _name: name.into(),
                    _value: value.into(),
                    center_x,
                    center_y,
                    disabled,
                    readonly,
                },
            ));
            line
        } else if matches!(role, "StaticText" | "heading") && !name.is_empty() {
            if let Some(backend) = backend {
                let parent_backend = nodes
                    .iter()
                    .find(|parent| parent["nodeId"] == node["parentId"])
                    .and_then(|parent| parent["backendDOMNodeId"].as_i64());
                let model = call(view, "DOM.getBoxModel", json!({"backendNodeId":backend}))
                    .or_else(|_| {
                        let parent = parent_backend.ok_or_else(|| "parent".to_owned())?;
                        call(view, "DOM.getBoxModel", json!({"backendNodeId":parent}))
                            .map_err(|_| "parent".to_owned())
                    });
                let Ok(model) = model else { continue };
                if visible_bounds(&model, width, height).is_none() {
                    continue;
                }
                let element = if role == "StaticText" {
                    parent_backend.unwrap_or(backend)
                } else {
                    backend
                };
                if !matches!(visible_point(view, id, element), Ok(Some(_))) {
                    continue;
                }
            }
            name.to_string()
        } else {
            continue;
        };
        if text.len() + line.len() + 1 > contract::SHARE_TEXT_MAX_BYTES {
            break;
        }
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&line);
        if let Some((number, target)) = entry {
            targets.insert(number, target);
        }
    }
    let (geometry, image_base64) = if image {
        let unavailable = || errors::SHARE_CONTROL_IMAGE_UNAVAILABLE(id);
        let bytes = capture().map_err(|_| unavailable())?;
        let image = image::load_from_memory(&bytes).map_err(|_| unavailable())?;
        let image = if image.width().max(image.height()) > 1600 {
            image.resize(1600, 1600, image::imageops::FilterType::Lanczos3)
        } else {
            image
        };
        let (pixel_width, pixel_height) = (image.width(), image.height());
        let mut png = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut png, image::ImageFormat::Png)
            .map_err(|_| unavailable())?;
        (
            Some(WindowGeometry {
                css_width: width,
                css_height: height,
                pixel_width,
                pixel_height,
            }),
            Some(STANDARD.encode(png.into_inner())),
        )
    } else {
        (None, None)
    };
    let view_id = format!(
        "web-{id}-v{}",
        VIEW_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    state.view_id = view_id.clone();
    state.targets = targets;
    Ok(WindowObservation {
        view_id,
        app_name: String::new(),
        window_title: viewport["title"].as_str().unwrap_or("").into(),
        text,
        settled: viewport["ready"].as_bool().unwrap_or(false) && !page.lock().unwrap().loading,
        geometry,
        image_base64,
    })
}

fn resolve(view: &Webview, id: &str, backend: i64) -> Result<String, CoreError> {
    let result = call(view, "DOM.resolveNode", json!({"backendNodeId":backend}))
        .map_err(|e| node_error(id, e))?;
    result["object"]["objectId"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| node_error(id, "object"))
}
fn function(
    view: &Webview,
    id: &str,
    object: &str,
    source: &str,
    args: Vec<Value>,
) -> Result<Value, CoreError> {
    let args: Vec<Value> = args
        .into_iter()
        .map(|value| json!({"value":value}))
        .collect();
    let result = call(view, "Runtime.callFunctionOn", json!({"objectId":object,"functionDeclaration":source,"arguments":args,"returnByValue":true})).map_err(|e| input_error(id,e))?;
    if !result["exceptionDetails"].is_null() {
        return Err(input_error(id, "script"));
    }
    Ok(result["result"]["value"].clone())
}
fn visible_point(view: &Webview, id: &str, backend: i64) -> Result<Option<(f64, f64)>, CoreError> {
    let object = resolve(view, id, backend)?;
    let result = function(view, id, &object, VISIBLE_POINT_JS, vec![])?;
    Ok(result["x"].as_f64().zip(result["y"].as_f64()))
}
fn dispatch(
    view: &Webview,
    id: &str,
    method: &'static str,
    params: Value,
) -> Result<(), CoreError> {
    call(view, method, params)
        .map(|_| ())
        .map_err(|e| input_error(id, e))
}
fn perform(
    view: &Webview,
    id: &str,
    action: &WindowAction,
    target: Option<&TargetEntry>,
    center: Option<(f64, f64)>,
    applied: &mut bool,
) -> Result<(), CoreError> {
    match action {
        WindowAction::Point { .. } => Err(errors::SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED(
            "웹 화면",
            "point",
        )),
        WindowAction::Click { gesture, .. } => {
            let (x, y) = center.unwrap();
            for count in 1..=if *gesture == Some(PointGesture::DoubleClick) {
                2
            } else {
                1
            } {
                dispatch(
                    view,
                    id,
                    "Input.dispatchMouseEvent",
                    json!({"type":"mousePressed","x":x,"y":y,"button":"left","buttons":1,"clickCount":count}),
                )?;
                *applied = true;
                dispatch(
                    view,
                    id,
                    "Input.dispatchMouseEvent",
                    json!({"type":"mouseReleased","x":x,"y":y,"button":"left","buttons":0,"clickCount":count}),
                )?;
            }
            Ok(())
        }
        WindowAction::Type {
            target: number,
            text,
            mode,
        } => {
            let entry = target.unwrap();
            if entry.readonly {
                return Err(errors::SHELL_WINDOW_CONTROL_TARGET_READONLY(
                    &number.to_string(),
                ));
            }
            if !matches!(
                entry.role.as_str(),
                "textbox" | "searchbox" | "combobox" | "spinbutton"
            ) {
                return Err(errors::SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED(
                    &number.to_string(),
                    "type",
                ));
            }
            call(
                view,
                "DOM.focus",
                json!({"backendNodeId":entry.backend_node_id}),
            )
            .map_err(|e| node_error(id, e))?;
            let object = resolve(view, id, entry.backend_node_id)?;
            let script = "function(replace, empty) { if (replace) { if (this.isContentEditable) { this.textContent = ''; } else { const proto = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (setter) setter.call(this, ''); else this.value = ''; } this.dispatchEvent(new Event('input',{bubbles:true})); if(empty) this.dispatchEvent(new Event('change',{bubbles:true})); } else if(this.isContentEditable) { const r=document.createRange(); r.selectNodeContents(this); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); } else { try { this.setSelectionRange(this.value.length,this.value.length); } catch (_) {} } }";
            function(
                view,
                id,
                &object,
                script,
                vec![json!(*mode == TextMode::Replace), json!(text.is_empty())],
            )?;
            *applied = *mode == TextMode::Replace;
            if !text.is_empty() {
                dispatch(view, id, "Input.insertText", json!({"text":text}))?;
                *applied = true;
            }
            Ok(())
        }
        WindowAction::Select {
            target: number,
            choice,
        } => {
            let entry = target.unwrap();
            let object = resolve(view, id, entry.backend_node_id)?;
            let (by, value) = match choice {
                WindowChoice::Value(v) => ("value", v.clone()),
                WindowChoice::Label(v) => ("label", json!(v)),
            };
            let result = function(view,id,&object,"function(by, value) { if (!(this instanceof HTMLSelectElement)) return 'unsupported'; const matches = Array.from(this.options).filter(o => by === 'label' ? o.label === value : o.value === String(value)); if (!matches.length) return 'missing'; if (by === 'label' && matches.length > 1) return 'ambiguous'; this.value = matches[0].value; this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; }",vec![json!(by),value.clone()])?;
            let display = value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string());
            let display = display.split(['?', '#']).next().unwrap_or("");
            match result.as_str() {
                Some("ok") => {
                    *applied = true;
                    Ok(())
                }
                Some("missing") => Err(errors::SHELL_WINDOW_CONTROL_OPTION_NOT_FOUND(display)),
                Some("ambiguous") => Err(errors::SHELL_WINDOW_CONTROL_OPTION_AMBIGUOUS(display)),
                _ => Err(errors::SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED(
                    &number.to_string(),
                    "select",
                )),
            }
        }
        WindowAction::Key { key, .. } => {
            let key = parse_key(key).ok_or_else(|| {
                errors::SHELL_WINDOW_CONTROL_KEY_INVALID(key.split(['?', '#']).next().unwrap_or(""))
            })?;
            if let Some(entry) = target {
                call(
                    view,
                    "DOM.focus",
                    json!({"backendNodeId":entry.backend_node_id}),
                )
                .map_err(|e| node_error(id, e))?;
            }
            let text = if key.key.chars().count() == 1 && key.modifiers & 7 == 0 {
                key.key.as_str()
            } else {
                ""
            };
            for event in ["keyDown", "keyUp"] {
                dispatch(
                    view,
                    id,
                    "Input.dispatchKeyEvent",
                    json!({"type":event,"key":key.key,"code":key.code,"windowsVirtualKeyCode":key.virtual_key,"nativeVirtualKeyCode":key.virtual_key,"modifiers":key.modifiers,"text":if event == "keyDown" { text } else { "" }}),
                )?;
                *applied = true;
            }
            Ok(())
        }
        WindowAction::Scroll {
            direction, amount, ..
        } => {
            let amount = *amount as f64;
            let (dx, dy) = match direction {
                Direction::Up => (0.0, -amount),
                Direction::Down => (0.0, amount),
                Direction::Left => (-amount, 0.0),
                Direction::Right => (amount, 0.0),
            };
            if let Some(entry) = target {
                let object = resolve(view, id, entry.backend_node_id)?;
                function(view,id,&object,"function(dx,dy) { let e=this; while(e) { const s=getComputedStyle(e); if ((e.scrollHeight>e.clientHeight && /(auto|scroll)/.test(s.overflowY)) || (e.scrollWidth>e.clientWidth && /(auto|scroll)/.test(s.overflowX))) { e.scrollBy(dx,dy); return; } e=e.parentElement; } window.scrollBy(dx,dy); }",vec![json!(dx),json!(dy)])?;
                *applied = true;
            } else {
                dispatch(
                    view,
                    id,
                    "Runtime.evaluate",
                    json!({"expression":format!("window.scrollBy({dx},{dy})")}),
                )?;
                *applied = true;
            }
            Ok(())
        }
    }
}

pub(crate) fn control(
    view: &Webview,
    id: &str,
    page: &std::sync::Arc<std::sync::Mutex<contract::WebPage>>,
    state: &mut WindowControlState,
    operation: &WindowControlOperation,
    capture: impl Fn() -> Result<Vec<u8>, CoreError>,
) -> WindowControlResult {
    let error = |error, applied| WindowControlResult::Error { error, applied };
    match operation {
        WindowControlOperation::Read { image } => {
            match read_view(view, id, page, state, *image, &capture) {
                Ok(after) => WindowControlResult::Ok {
                    value: WindowControlSuccess {
                        before_text: None,
                        after,
                    },
                },
                Err(e) => error(e, false),
            }
        }
        WindowControlOperation::Act {
            view_id,
            action,
            image,
        } => {
            if state.view_id.is_empty() || &state.view_id != view_id {
                return error(errors::SHELL_WINDOW_CONTROL_REFERENCE_STALE("창"), false);
            }
            let old_document = state.document_key.clone();
            let number = match action {
                WindowAction::Click { target, .. }
                | WindowAction::Type { target, .. }
                | WindowAction::Select { target, .. } => Some(*target),
                WindowAction::Key { target, .. } | WindowAction::Scroll { target, .. } => *target,
                WindowAction::Point { .. } => None,
            };
            let entry = match number {
                Some(n) => match state.targets.get(&n) {
                    Some(e) => Some(e.clone()),
                    None => {
                        return error(
                            errors::SHELL_WINDOW_CONTROL_REFERENCE_STALE(&n.to_string()),
                            false,
                        )
                    }
                },
                None => None,
            };
            let before = match read_view(view, id, page, state, false, &capture) {
                Ok(v) => v,
                Err(e) => return error(e, false),
            };
            if state.document_key != old_document {
                return error(errors::SHELL_WINDOW_CONTROL_REFERENCE_STALE("창"), false);
            }
            if !supports_action(action) {
                return error(
                    errors::SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED("웹 화면", "point"),
                    false,
                );
            }
            let entry = match (number, entry) {
                (Some(number), Some(old)) => match current_target(state, number, &old) {
                    Some(current) => Some(current),
                    None => {
                        let label = number.to_string();
                        if state.targets.contains_key(&number)
                            || call(
                                view,
                                "DOM.getBoxModel",
                                json!({"backendNodeId":old.backend_node_id}),
                            )
                            .is_err()
                        {
                            return error(
                                errors::SHELL_WINDOW_CONTROL_REFERENCE_STALE(&label),
                                false,
                            );
                        }
                        return error(errors::SHELL_WINDOW_CONTROL_TARGET_HIDDEN(&label), false);
                    }
                },
                _ => None,
            };
            let center = if let Some(entry) = &entry {
                let n = number.unwrap().to_string();
                if entry.disabled {
                    return error(errors::SHELL_WINDOW_CONTROL_TARGET_DISABLED(&n), false);
                }
                Some((entry.center_x, entry.center_y))
            } else {
                None
            };
            let mut applied = false;
            if let Err(e) = perform(view, id, action, entry.as_ref(), center, &mut applied) {
                return error(e, applied);
            }
            std::thread::sleep(Duration::from_millis(30));
            match read_view(view, id, page, state, *image, &capture) {
                Ok(after) => WindowControlResult::Ok {
                    value: WindowControlSuccess {
                        before_text: Some(before.text),
                        after,
                    },
                },
                Err(e) => error(e, true),
            }
        }
    }
}

#[cfg(test)]
mod product_tests {
    use super::contract::{PointGesture, WindowAction};
    use super::*;

    #[test]
    fn numbers_are_stable_within_a_document_and_reset_on_navigation() {
        let mut state = WindowControlState::default();
        state.document("https://example.test/first");
        assert_eq!(state.number(12), 1);
        assert_eq!(state.number(34), 2);
        state.document("https://example.test/first");
        assert_eq!(state.number(34), 2);
        assert_eq!(state.number(12), 1);
        assert_eq!(state.number(56), 3);
        state.document("https://example.test/second");
        assert_eq!(state.number(56), 1);
    }

    #[test]
    fn box_must_have_area_and_intersect_viewport() {
        let model = |x, y, w, h| json!({"model":{"content":[x,y,x+w,y,x+w,y+h,x,y+h]}});
        assert!(visible_bounds(&model(5.0, 5.0, 20.0, 10.0), 100.0, 100.0).is_some());
        assert!(visible_bounds(&model(100.0, 5.0, 20.0, 10.0), 100.0, 100.0).is_none());
        assert!(visible_bounds(&model(5.0, 5.0, 0.5, 10.0), 100.0, 100.0).is_none());
    }

    #[test]
    fn keys_accept_named_and_modified_keys_and_reject_unknown_names() {
        let enter = parse_key("Enter").unwrap();
        assert_eq!(enter.key, "Enter");
        assert_eq!(enter.virtual_key, 13);
        let modified = parse_key("Control+Shift+A").unwrap();
        assert_eq!(modified.modifiers, 10);
        assert_eq!(modified.code, "KeyA");
        assert!(parse_key("Control+UnknownKey").is_none());
    }

    #[test]
    fn point_is_not_supported_on_web_screens() {
        assert!(!supports_action(&WindowAction::Point {
            x: 1.0,
            y: 2.0,
            gesture: PointGesture::Click,
        }));
        assert!(supports_action(&WindowAction::Key {
            target: None,
            key: "Enter".into()
        }));
    }

    #[test]
    fn action_uses_current_readonly_and_disabled_state_for_same_node() {
        let old = TargetEntry {
            backend_node_id: 42,
            role: "textbox".into(),
            ..Default::default()
        };
        let mut state = WindowControlState::default();
        state.targets.insert(
            1,
            TargetEntry {
                readonly: true,
                disabled: true,
                center_x: 25.0,
                center_y: 40.0,
                ..old.clone()
            },
        );
        let current = current_target(&state, 1, &old).unwrap();
        assert!(current.readonly && current.disabled);
        assert_eq!((current.center_x, current.center_y), (25.0, 40.0));
        state.targets.get_mut(&1).unwrap().backend_node_id = 43;
        assert!(current_target(&state, 1, &old).is_none());
    }
}
