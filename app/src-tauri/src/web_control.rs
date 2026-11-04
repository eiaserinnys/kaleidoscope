//! Windows E2E 실측에서만 사용하는 제한된 DevTools 호출.
use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Duration;
use tauri::Webview;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::HSTRING;

pub(crate) enum ProbeCall {
    EnableAccessibility,
    AccessibilityTree,
    BoxModel(i64),
    Focus(i64),
    Mouse { pressed: bool, x: f64, y: f64 },
    InsertText(String),
    Enter { down: bool },
    Evaluate(String),
}

impl ProbeCall {
    fn protocol(self) -> (&'static str, Value) {
        match self {
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
pub(crate) fn call(view: &Webview, operation: ProbeCall) -> Result<Value, String> {
    let (method, params) = operation.protocol();
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |native| {
        let immediate = tx.clone();
        let callback =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, result| {
                let output = status.map_err(|e| e.to_string()).and_then(|_| {
                    serde_json::from_str(&result)
                        .map_err(|e| format!("{method} JSON: {e}: {result}"))
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
