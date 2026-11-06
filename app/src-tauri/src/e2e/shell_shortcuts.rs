//! OS SendInput과 실제 쉘 명령/상태를 대조한다. CDP는 준비와 관찰에만 쓴다.
use super::share_isolate::native_input;
use super::*;
use crate::web_control::{probe, ProbeCall};
use sha2::{Digest, Sha256};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetShellWindow, SetForegroundWindow,
};
mod checks;

const WATCH: &str = r#"window.__ksAppKeys=0;
window.addEventListener('message',e=>{if(e.data==='ks-e2e-app-key')window.__ksAppKeys++});
window.addEventListener('keydown',()=>{if(window===top)window.__ksAppKeys++;else top.postMessage('ks-e2e-app-key','*')});"#;
const HTML: &str =
    "<input autofocus style='width:95%;height:120px' aria-label='키 입력'><p>네이티브 키 시험</p>";

fn eval(view: &tauri::Webview, script: &str) -> Result<Value, String> {
    let reply = probe(view, ProbeCall::Evaluate(script.into()))?;
    if reply.get("exceptionDetails").is_some() {
        return Err(format!("시험 관찰 스크립트 실패: {reply}"));
    }
    Ok(reply["result"]["value"].clone())
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
    let script = format!("const root=document.querySelector('[data-window-id=\"{window}\"]')??document.querySelector('[data-testid=\"app-window-{window}\"]');const e=root?.querySelector({});if(!e)return null; const r=e.getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+Math.min(r.height/2,50)}};", serde_json::to_string(selector).unwrap());
    let mut point = Value::Null;
    ui::driver::wait_until("포커스 표면", || {
        point = ui::evaluate(app, &script)?;
        Ok(point.is_object())
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
    thread::sleep(Duration::from_millis(200));
    if eval(view, "window.__ksAppKeys")?.as_u64().unwrap_or(0) == 0 {
        return Err("F8이 포커스 표면에 도착하지 않음: 대화형 데스크톱/포커스 확인 필요".into());
    }
    eval(view, "window.__ksAppKeys=0")?;
    Ok(())
}

pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    log: &mut File,
) -> Result<(), String> {
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
    probe(&main, ProbeCall::NewDocument(WATCH.into()))?;
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
        for (key, code) in [(0x27, "ArrowRight"), (0x22, "PageDown"), (0x09, "Tab")] {
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
            let before = state(core, &workspace)?;
            let mark = ui::mark_requests();
            native_input::chord(&[0x11, 0x12], key)?;
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
            CoreRequest::DesktopActivate {
                desktop_id: desktop.clone(),
            },
        )?;
        call(core, CoreRequest::WindowClose { window_id: a })?;
        call(core, CoreRequest::WindowClose { window_id: b })?;
    }
    let before = state(core, &workspace)?;
    let shell = unsafe { GetShellWindow() };
    if shell.0.is_null() || !unsafe { SetForegroundWindow(shell) }.as_bool() {
        return Err("다른 앱(Windows 바탕화면)을 앞으로 가져오지 못함".into());
    }
    thread::sleep(Duration::from_millis(300));
    let mark = ui::mark_requests();
    native_input::chord(&[0x11, 0x12], 0x27)?;
    thread::sleep(Duration::from_millis(500));
    let after = state(core, &workspace)?;
    let commands = ui::requests_since(mark)
        .iter()
        .filter(|r| {
            matches!(
                r,
                CoreRequest::DesktopActivate { .. } | CoreRequest::WindowRaise { .. }
            )
        })
        .count();
    record(
        log,
        "shortcut.other-foreground",
        json!({"before":before,"after":after,"commands":commands,"passed":before==after && commands==0}),
    )?;
    if before != after || commands != 0 {
        return Err("다른 앱 포커스에서 쉘이 바뀜".into());
    }
    record(
        log,
        "complete",
        json!({"scenario":"shell-shortcuts","passed":true}),
    )
}
