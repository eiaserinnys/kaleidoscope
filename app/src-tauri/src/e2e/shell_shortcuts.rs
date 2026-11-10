//! OS SendInput과 실제 쉘 명령/상태를 대조한다. CDP는 준비와 관찰에만 쓴다.
use super::share_isolate::native_input;
use super::*;
use crate::web_control::{probe, ProbeCall};
use sha2::{Digest, Sha256};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetShellWindow, SetForegroundWindow,
};
mod checks;

const WATCH: &str = r#"window.__ksAppKeys=0;window.__ksRawKeys=[];window.__ksObservedFrames=new Set();
window.addEventListener('message',e=>{if(e.data==='ks-e2e-frame-ready')window.__ksObservedFrames.add(e.source);if(e.data==='ks-e2e-app-key')window.__ksAppKeys++});
window.addEventListener('keydown',e=>{window.__ksRawKeys.push({key:e.key,code:e.code,keyCode:e.keyCode,trusted:e.isTrusted});if(![119,39,34,9].includes(e.keyCode))return;if(window===top)window.__ksAppKeys++;else top.postMessage('ks-e2e-app-key','*')},true);
if(window!==top)top.postMessage('ks-e2e-frame-ready','*');"#;
const HTML: &str =
    "<input autofocus style='width:95%;height:120px' aria-label='키 입력'><p>네이티브 키 시험</p>";

fn watch_documents(view: &tauri::Webview) -> Result<(), String> {
    use webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler;
    use windows::core::HSTRING;
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |native| {
        let immediate = tx.clone();
        let callback = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
            move |status, _| {
                let _ = tx.send(status.map_err(|error| error.to_string()));
                Ok(())
            },
        ));
        let result = unsafe {
            native.controller().CoreWebView2().and_then(|web| {
                web.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(WATCH), &callback)
            })
        };
        if let Err(error) = result {
            let _ = immediate.send(Err(error.to_string()));
        }
    })
    .map_err(|error| error.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?
}

fn eval(view: &tauri::Webview, script: &str) -> Result<Value, String> {
    let reply = probe(view, ProbeCall::Evaluate(script.into()))?;
    if reply.get("exceptionDetails").is_some() {
        return Err(format!("시험 관찰 스크립트 실패: {reply}"));
    }
    Ok(reply["result"]["value"].clone())
}
fn active_workspace(core: &Core) -> Result<String, String> {
    Ok(ui::driver::snapshot(core)?
        .device
        .active_workspace_id
        .ok_or("활성 작업 없음")?)
}

fn next_workspace(core: &Core, workspace: &str) -> Result<String, String> {
    let snapshot = ui::driver::snapshot(core)?;
    let workspaces = &snapshot.shared.workspaces;
    let index = workspaces
        .iter()
        .position(|item| item.id == workspace)
        .ok_or("시험 작업이 스냅숏에 없음")?;
    Ok(workspaces[(index + 1) % workspaces.len()].id.clone())
}

fn state(core: &Core, workspace: &str) -> Result<(String, String), String> {
    let snapshot = ui::driver::snapshot(core)?;
    let desktop = snapshot
        .device
        .active_desktop_ids
        .get(workspace)
        .ok_or("활성 화면 없음")?
        .clone();
    let top = snapshot
        .shared
        .windows
        .iter()
        .filter(|w| w.desktop_id == desktop && !w.minimized)
        .max_by_key(|w| w.z)
        .map(|w| w.id.clone())
        .unwrap_or_default();
    Ok((desktop, top))
}
fn focus(
    app: &AppHandle,
    window: &str,
    selector: &str,
    view: &tauri::Webview,
) -> Result<(), String> {
    app.get_window("main")
        .ok_or("메인 창 없음")?
        .set_focus()
        .map_err(|e| e.to_string())?;
    let script = format!("const root=document.querySelector('[data-window-id=\"{window}\"]')??document.querySelector('[data-testid=\"app-window-{window}\"]');const e=root?.querySelector({});if(!e)return null; const r=e.getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+Math.min(r.height/2,50),observer:e.tagName!=='IFRAME'||window.__ksObservedFrames.has(e.contentWindow)}};", serde_json::to_string(selector).unwrap());
    let mut point = Value::Null;
    ui::driver::wait_until("포커스 표면과 프레임 관찰기 설치", || {
        point = ui::evaluate(app, &script)?;
        Ok(point["observer"] == true)
    })?;
    let win = app.get_window("main").ok_or("메인 창 없음")?;
    let origin = win.inner_position().map_err(|e| e.to_string())?;
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    native_input::click(
        origin.x + (point["x"].as_f64().unwrap() * scale) as i32,
        origin.y + (point["y"].as_f64().unwrap() * scale) as i32,
    )?;
    thread::sleep(Duration::from_millis(200));
    // 같은 표면에 정상 키가 도착하는지 먼저 증명한다.
    eval(view, "window.__ksAppKeys=0")?;
    native_input::chord(&[], 0x77)?; // F8
    ui::driver::wait_until("F8의 실제 포커스 표면 도착", || {
        Ok(eval(view, "window.__ksAppKeys")?.as_u64().unwrap_or(0) > 0)
    })
    .map_err(|error| {
        format!(
            "{error}; 이벤트={:?}; 포커스={:?}; foreground={:?}; 누름 위치={point}",
            eval(view, "window.__ksRawKeys"),
            eval(
                view,
                "({tag:document.activeElement?.tagName,focused:document.hasFocus()})"
            ),
            unsafe { super::native_target::describe(GetForegroundWindow()) }
        )
    })?;
    eval(view, "window.__ksAppKeys=0")?;
    Ok(())
}

pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    log: &mut File,
) -> Result<(), String> {
    let result = run(app, core, out, log);
    let events = fs::read_to_string(out.join("events.jsonl")).map_err(|e| e.to_string())?;
    let events: Vec<Value> = events
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let mut rows = Vec::new();
    for surface in ["main", "html", "sandbox", "client", "web"] {
        for code in ["ArrowRight", "PageDown", "Tab", "CtrlPageDown"] {
            let row = events.iter().find(|event| {
                event["step"] == "shortcut.measure"
                    && event["data"]["surface"] == surface
                    && event["data"]["code"] == code
            });
            rows.push(row.map(|event| event["data"].clone()).unwrap_or_else(|| json!({"surface":surface,"code":code,"status":"not_measured","reason":result.as_ref().err()})));
        }
    }
    let foreground = events
        .iter()
        .find(|event| event["step"] == "shortcut.other-foreground")
        .map(|event| event["data"].clone())
        .unwrap_or_else(|| json!({"status":"not_measured","reason":result.as_ref().err()}));
    let report = json!({"rows":rows,"other_foreground":foreground,"passed":result.is_ok(),"error":result.as_ref().err()});
    fs::write(
        out.join("shortcut-results.json"),
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    record(log, "shortcut.summary", report)?;
    result
}

fn run(app: &AppHandle, core: &Core, out: &Path, log: &mut File) -> Result<(), String> {
    use std::io::Read;
    use std::net::TcpListener;
    record(log, "start", json!({"scenario":"shell-shortcuts"}))?;
    ui::driver::wait_until("내장 서버 연결", || {
        Ok(matches!(
            ui::driver::snapshot(core)?.link,
            kaleidoscope_core::kaleidoscope_contract::LinkStatus::Connected { .. }
        ))
    })?;
    let main = app.get_webview("main").ok_or("메인 웹뷰 없음")?;
    watch_documents(&main)?;
    eval(&main, WATCH)?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let url = format!(
        "http://{}",
        listener.local_addr().map_err(|e| e.to_string())?
    );
    thread::spawn(move || {
        for socket in listener.incoming() {
            let Ok(mut socket) = socket else { break };
            let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
            let mut request = [0; 4096];
            let _ = socket.read(&mut request);
            let body = format!("{HTML}<script>{WATCH}</script>");
            let _ = write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        }
    });
    let (workspace, desktop) = match call(
        core,
        CoreRequest::WorkspaceCreate {
            name: "단축키 시험".into(),
        },
    )? {
        CoreReply::WorkspaceCreate { workspace, desktop } => (workspace.id, desktop.id),
        _ => return Err("작업 생성 응답 없음".into()),
    };
    call(
        core,
        CoreRequest::WorkspaceCreate {
            name: "단축키 다음 작업".into(),
        },
    )?;
    let other = match call(
        core,
        CoreRequest::DesktopCreate {
            workspace_id: workspace.clone(),
            name: "다음 화면".into(),
        },
    )? {
        CoreReply::DesktopCreate { desktop } => desktop.id,
        _ => return Err("화면 생성 응답 없음".into()),
    };
    call(
        core,
        CoreRequest::WorkspaceActivate {
            workspace_id: workspace.clone(),
        },
    )?;
    let client = "kaleidoscope.surfaces.on('preview',s=>{if(s){const c=s.canvas.getContext('2d');c.fillStyle='green';c.fillRect(0,0,s.canvas.width,s.canvas.height)}});";
    super::realtime::fixture::mcp(
        app,
        "upload_asset",
        json!({"id":"shortcut-client","version":1,"format":"javascript","sha256":format!("{:x}",Sha256::digest(client.as_bytes())),"source":"네이티브 키 시험","license":"MIT","data_base64":STANDARD.encode(client)}),
    )?;
    for (name, block) in [
        (
            "main",
            json!({"type":"input","value":{"state":"text"},"on_change":{"set_state":"text"}}),
        ),
        ("html", json!({"type":"html_view","value":HTML})),
        ("sandbox", json!({"type":"sandbox","value":HTML})),
        ("client", json!({"type":"canvas","surface":"preview"})),
        ("web", json!({"type":"web_view","url":url})),
    ] {
        let id = format!("shortcut-{name}");
        let mut definition = json!({"id":id,"name":name,"requires":{"blocks":40,"modules":{}},"permissions":[],"state":{"text":""},"ui":block});
        if name == "client" {
            definition["requires"]["modules"] = json!({"client":1,"assets":1});
            definition["assets"] = json!([{"id":"shortcut-client","version":1}]);
            definition["client"] =
                json!({"runtime":"javascript","entry":{"id":"shortcut-client","version":1}});
        }
        if name == "web" {
            definition["requires"]["modules"] = json!({"web":1});
        }
        call(
            core,
            CoreRequest::AppImport {
                definition_json: definition.to_string(),
            },
        )?;
        call(
            core,
            CoreRequest::DesktopActivate {
                desktop_id: desktop.clone(),
            },
        )?;
        let a = ui::driver::open(
            core,
            &desktop,
            &id,
            Rect {
                x: 40,
                y: 40,
                width: 720,
                height: 480,
            },
        )?;
        let b = ui::driver::open(
            core,
            &desktop,
            "shortcut-main",
            Rect {
                x: 80,
                y: 80,
                width: 600,
                height: 400,
            },
        )?;
        for (modifiers, key, code) in [
            (&[0x11, 0x12][..], 0x27, "ArrowRight"),
            (&[0x11, 0x12][..], 0x22, "PageDown"),
            (&[0x11, 0x12][..], 0x09, "Tab"),
            (&[0x11][..], 0x22, "CtrlPageDown"),
        ] {
            call(
                core,
                CoreRequest::WorkspaceActivate {
                    workspace_id: workspace.clone(),
                },
            )?;
            call(
                core,
                CoreRequest::DesktopActivate {
                    desktop_id: desktop.clone(),
                },
            )?;
            call(
                core,
                CoreRequest::WindowRaise {
                    window_id: a.clone(),
                },
            )?;
            thread::sleep(Duration::from_millis(500));
            let view = if name == "web" {
                let label = format!("web-{a}");
                ui::driver::wait_until("자식 웹뷰", || Ok(app.get_webview(&label).is_some()))?;
                let view = app.get_webview(&label).unwrap();
                ui::driver::wait_until("외부 페이지", || {
                    Ok(eval(&view, "document.querySelector('input')!==null")? == json!(true))
                })?;
                view
            } else {
                main.clone()
            };
            let selector = match name {
                "main" => "input",
                "html" | "sandbox" => "iframe",
                "client" => "canvas",
                _ => ".ks-web-surface",
            };
            focus(app, &a, selector, &view)?;
            if code == "CtrlPageDown" {
                let before = active_workspace(core)?;
                let expected = next_workspace(core, &workspace)?;
                let mark = ui::mark_requests();
                native_input::chord(modifiers, key)?;
                let _ = ui::driver::wait_until("작업 전환 또는 앱 도착", || {
                    let current = active_workspace(core)?;
                    Ok(current == expected
                        || eval(&view, "window.__ksAppKeys")?.as_u64().unwrap_or(0) > 0)
                });
                thread::sleep(Duration::from_millis(700));
                let after = active_workspace(core)?;
                let commands = ui::requests_since(mark)
                    .iter()
                    .filter(|r| matches!(r, CoreRequest::WorkspaceActivate { .. }))
                    .count();
                let app_keys = eval(&view, "window.__ksAppKeys")?
                    .as_u64()
                    .ok_or("앱 키 관찰값 없음")?;
                let foreground = unsafe { super::native_target::describe(GetForegroundWindow()) };
                let ok = checks::switched(&before, &after, &expected, commands, app_keys);
                record(
                    log,
                    "shortcut.measure",
                    json!({"surface":name,"code":code,"before":before,"after":after,"commands":commands,"app_keys":app_keys,"foreground":foreground,"passed":ok}),
                )?;
                if !ok {
                    return Err(format!(
                        "{name} {code}: 실측 전제가 깨져 중단: commands={commands}, app_keys={app_keys}"
                    ));
                }
                continue;
            }
            let before = state(core, &workspace)?;
            let mark = ui::mark_requests();
            native_input::chord(modifiers, key)?;
            if key != 0x09 {
                let _ = ui::driver::wait_until("단축키 전환 또는 앱 도착", || {
                    let current = state(core, &workspace)?;
                    Ok((if key == 0x27 {
                        current.0 == other
                    } else {
                        current.1 == b
                    }) || eval(&view, "window.__ksAppKeys")?.as_u64().unwrap_or(0) > 0)
                });
            }
            thread::sleep(Duration::from_millis(700));
            let after = state(core, &workspace)?;
            let commands = ui::requests_since(mark)
                .iter()
                .filter(|r| {
                    if key == 0x27 {
                        matches!(r, CoreRequest::DesktopActivate { .. })
                    } else {
                        matches!(r, CoreRequest::WindowRaise { .. })
                    }
                })
                .count();
            let app_keys = eval(&view, "window.__ksAppKeys")?
                .as_u64()
                .ok_or("앱 키 관찰값 없음")?;
            let foreground = unsafe { super::native_target::describe(GetForegroundWindow()) };
            let ok = if key == 0x27 {
                checks::switched(&before.0, &after.0, &other, commands, app_keys)
            } else {
                checks::switched(&before.1, &after.1, &b, commands, app_keys)
            };
            record(
                log,
                "shortcut.measure",
                json!({"surface":name,"code":code,"before":before,"after":after,"commands":commands,"app_keys":app_keys,"foreground":foreground,"passed":ok}),
            )?;
            if key == 0x09 {
                let name = format!("tab-{name}");
                fs::write(out.join(format!("{name}.request")), "").map_err(|e| e.to_string())?;
                ui::driver::wait_until("Windows 전환 화면 캡처", || {
                    Ok(out.join(format!("{name}.done")).exists())
                })?;
                native_input::chord(&[], 0x1b)?;
            }
            if key != 0x09 && !ok {
                return Err(format!("{name} {code}: 실측 전제가 깨져 중단: commands={commands}, app_keys={app_keys}"));
            }
        }
        call(
            core,
            CoreRequest::WorkspaceActivate {
                workspace_id: workspace.clone(),
            },
        )?;
        call(
            core,
            CoreRequest::DesktopActivate {
                desktop_id: desktop.clone(),
            },
        )?;
        call(core, CoreRequest::WindowClose { window_id: a })?;
        call(core, CoreRequest::WindowClose { window_id: b })?;
    }
    let workspace_before = active_workspace(core)?;
    let before = state(core, &workspace)?;
    let shell = unsafe { GetShellWindow() };
    if shell.0.is_null() || !unsafe { SetForegroundWindow(shell) }.as_bool() {
        return Err("다른 앱(Windows 바탕화면)을 앞으로 가져오지 못함".into());
    }
    thread::sleep(Duration::from_millis(300));
    let foreground = unsafe { super::native_target::describe(GetForegroundWindow()) };
    let other_process = foreground["pid"]
        .as_u64()
        .is_some_and(|pid| pid != std::process::id() as u64);
    let mark = ui::mark_requests();
    native_input::chord(&[0x11, 0x12], 0x27)?;
    thread::sleep(Duration::from_millis(500));
    native_input::chord(&[0x11], 0x22)?;
    thread::sleep(Duration::from_millis(500));
    let after = state(core, &workspace)?;
    let workspace_after = active_workspace(core)?;
    let commands = ui::requests_since(mark)
        .iter()
        .filter(|r| {
            matches!(
                r,
                CoreRequest::DesktopActivate { .. }
                    | CoreRequest::WindowRaise { .. }
                    | CoreRequest::WorkspaceActivate { .. }
            )
        })
        .count();
    record(
        log,
        "shortcut.other-foreground",
        json!({"before":before,"after":after,"workspace_before":workspace_before,"workspace_after":workspace_after,"commands":commands,"foreground":foreground,"passed":other_process && before==after && workspace_before==workspace_after && commands==0}),
    )?;
    if !other_process || before != after || workspace_before != workspace_after || commands != 0 {
        return Err("다른 앱 포커스에서 쉘이 바뀜".into());
    }
    record(
        log,
        "complete",
        json!({"scenario":"shell-shortcuts","passed":true}),
    )
}
