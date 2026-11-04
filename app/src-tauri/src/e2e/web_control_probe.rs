//! 자식 WebView2의 AX와 입력, 별도 프로세스 포커스를 실제로 측정한다.
use super::*;
use crate::web_control::{call as cdp, ProbeCall};
use std::io::{Read, Write as _};
use std::net::TcpListener;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use tauri::Webview;

mod measure;
#[path = "share_isolate/native_input.rs"]
mod native_input;
mod product;
use measure::{measure_ax, measure_click, measure_key, measure_type};

const APP_ID: &str = "e2e-web-control-probe";
const TIMEOUT: Duration = Duration::from_secs(30);
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn wait_file(path: &Path) -> Result<(), String> {
    let deadline = Instant::now() + TIMEOUT;
    while !path.is_file() {
        if Instant::now() >= deadline {
            return Err(format!("파일 대기 시간 초과: {}", path.display()));
        }
        thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}

fn serve_fixture() -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut stream = stream;
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut request = [0; 4096];
            let _ = stream.read(&mut request);
            let html = include_str!("web_control_probe/fixture.html");
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", html.len(), html);
            let _ = stream.write_all(response.as_bytes());
        }
    });
    Ok(format!("http://{address}/"))
}

struct FocusProbe<'a> {
    out: &'a Path,
    sequence: u32,
    _process: Process,
}
impl<'a> FocusProbe<'a> {
    fn start(app: &AppHandle, out: &'a Path) -> Result<Self, String> {
        let main = app.get_window("main").ok_or("메인 창 없음")?;
        let pos = main.inner_position().map_err(|e| e.to_string())?;
        let size = main.inner_size().map_err(|e| e.to_string())?;
        let script = out.join("focus-window.ps1");
        fs::write(&script, include_str!("web_control_probe/focus-window.ps1"))
            .map_err(|e| e.to_string())?;
        // 웹뷰의 일부만 가려 남은 영역의 깜빡임을 기록할 수 있다.
        let x = pos.x + (size.width as i32 / 2);
        let y = pos.y + 80;
        let child = Command::new("powershell.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(script)
            .arg(out)
            .arg(x.to_string())
            .arg(y.to_string())
            .arg((size.width / 3).max(300).to_string())
            .arg((size.height / 2).max(240).to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("다른 프로그램 실행: {e}"))?;
        let mut probe = Self {
            out,
            sequence: 0,
            _process: Process(child),
        };
        wait_file(&out.join("focus.ready"))?;
        probe.snapshot()?;
        Ok(probe)
    }
    fn snapshot(&mut self) -> Result<Value, String> {
        self.sequence += 1;
        let id = self.sequence.to_string();
        let pending = self.out.join("focus.request.tmp");
        fs::write(&pending, &id).map_err(|e| e.to_string())?;
        fs::rename(pending, self.out.join("focus.request")).map_err(|e| e.to_string())?;
        let path = self.out.join(format!("focus-{id}.json"));
        wait_file(&path)?;
        let value = fs::read(&path).map_err(|e| e.to_string())?;
        serde_json::from_slice(&value).map_err(|e| e.to_string())
    }
    fn prepare(&mut self) -> Result<Value, String> {
        fs::write(self.out.join("focus.raise"), "").map_err(|e| e.to_string())?;
        let geometry = self.snapshot()?;
        let x = geometry["click_x"].as_i64().ok_or("다른 창 x 없음")? as i32;
        let y = geometry["click_y"].as_i64().ok_or("다른 창 y 없음")? as i32;
        native_input::click(x, y)?;
        thread::sleep(Duration::from_millis(150));
        let state = self.snapshot()?;
        if state["foreground"] != state["window"]
            || state["focused"] != true
            || state["caret_ok"] != true
        {
            return Err(format!("다른 프로그램 포커스 준비 실패: {state}"));
        }
        Ok(state)
    }
}

fn outcome(ok: bool, detail: Value) -> Value {
    json!({"status": if ok { "된다" } else { "안 된다" }, "detail": detail})
}
fn failed(error: impl std::fmt::Display) -> Value {
    json!({"status":"측정 실패", "detail":error.to_string()})
}
fn preserve(before: &Value, after: &Value) -> bool {
    [
        "foreground",
        "window",
        "focused",
        "focus_handle",
        "input_handle",
        "text",
        "selection_start",
        "selection_length",
        "caret_ok",
        "caret_handle",
        "caret",
    ]
    .iter()
    .all(|key| before[*key] == after[*key])
}
fn with_focus<T>(
    probe: &mut FocusProbe<'_>,
    foreground: bool,
    operation: impl FnOnce() -> Result<T, String>,
) -> (Result<T, String>, Value) {
    if foreground {
        return (
            operation(),
            failed("쉘이 전경인 상태에서는 다른 프로그램을 동시에 키보드 전경에 둘 수 없음"),
        );
    }
    let before = match probe.prepare() {
        Ok(value) => value,
        Err(error) => return (Err(format!("포커스 준비: {error}")), failed(error)),
    };
    let result = operation();
    let focus = match probe.snapshot() {
        Ok(after) => outcome(
            preserve(&before, &after),
            json!({"before":before,"after":after}),
        ),
        Err(error) => failed(error),
    };
    (result, focus)
}

fn result_or_failed(result: Result<Value, String>) -> Value {
    result.unwrap_or_else(failed)
}

fn phase(view: &Webview, probe: &mut FocusProbe<'_>, foreground: bool, label: &str) -> Value {
    let (ax, ax_focus) = with_focus(probe, foreground, || measure_ax(view));
    let ax = ax.unwrap_or_else(failed);
    let (click, click_focus) = with_focus(probe, foreground, || measure_click(view));
    let (typing, type_focus) = with_focus(probe, foreground, || {
        measure_type(view, &format!("-{label}-"))
    });
    let (key, key_focus) = with_focus(probe, foreground, || measure_key(view));
    let focus = if foreground {
        failed("쉘 전경과 다른 프로그램의 키보드 전경은 동시 성립하지 않음")
    } else if [&ax_focus, &click_focus, &type_focus, &key_focus]
        .iter()
        .any(|v| v["status"] == "측정 실패")
    {
        json!({"status":"측정 실패","detail":{"ax":ax_focus,"click":click_focus,"type":type_focus,"key":key_focus}})
    } else {
        outcome(
            [&ax_focus, &click_focus, &type_focus, &key_focus]
                .iter()
                .all(|v| v["status"] == "된다"),
            json!({"ax":ax_focus,"click":click_focus,"type":type_focus,"key":key_focus}),
        )
    };
    json!({"ax":ax,"click":result_or_failed(click),"type":result_or_failed(typing),"key":result_or_failed(key),"focus":focus})
}

fn capture(out: &Path, label: &str) -> Result<(), String> {
    let script = env::var_os("KALEIDOSCOPE_E2E_CAPTURE_SCRIPT").ok_or("캡처 스크립트 경로 없음")?;
    let status = Command::new("powershell.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script)
        .arg(out.join(format!("{label}.png")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("{label} 화면 캡처 실패: {status}"));
    }
    Ok(())
}
fn place(core: &Core, id: &str, bounds: Option<Rect>) -> Result<(), String> {
    call(
        core,
        CoreRequest::WebPlace {
            window_id: id.into(),
            bounds,
        },
    )?;
    Ok(())
}
fn visible(view: &Webview) -> Result<bool, String> {
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |native| {
        let result = unsafe {
            let mut value = windows::core::BOOL(0);
            native
                .controller()
                .IsVisible(&mut value)
                .map(|_| value.as_bool())
        };
        let _ = tx.send(result.map_err(|e| e.to_string()));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?
}
fn recorder_start(
    app: &AppHandle,
    probe: &mut FocusProbe<'_>,
    out: &Path,
) -> Result<Process, String> {
    let focus = probe.snapshot()?;
    let main = app.get_window("main").ok_or("메인 창 없음")?;
    let pos = main.inner_position().map_err(|e| e.to_string())?;
    let size = main.inner_size().map_err(|e| e.to_string())?;
    let protected = json!({"client_x":pos.x,"client_y":pos.y,"client_width":size.width,"client_height":size.height,
        "exclude_x":focus["x"],"exclude_y":focus["y"],"exclude_width":focus["width"],"exclude_height":focus["height"]});
    fs::write(out.join("protected.json"), protected.to_string()).map_err(|e| e.to_string())?;
    fs::write(out.join("record.phase"), "fallback\n").map_err(|e| e.to_string())?;
    let script = env::var_os("KALEIDOSCOPE_E2E_RECORDER_SCRIPT").ok_or("기록기 경로 없음")?;
    let child = Command::new("powershell.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script)
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let process = Process(child);
    fs::write(out.join("record.request"), "").map_err(|e| e.to_string())?;
    wait_file(&out.join("record.ready"))?;
    Ok(process)
}
fn recorder_stop(mut process: Process, out: &Path) -> Result<Value, String> {
    fs::write(out.join("record.stop"), "").map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(status) = process.0.try_wait().map_err(|e| e.to_string())? {
            if !status.success() {
                return Err(format!("화면 기록기 실패: {status}"));
            }
            break;
        }
        if Instant::now() >= deadline {
            return Err("화면 기록기 종료 시간 초과".into());
        }
        thread::sleep(Duration::from_millis(50));
    }
    let csv = fs::read_to_string(out.join("screen-frames.csv")).map_err(|e| e.to_string())?;
    let mut samples = 0;
    let mut changed = 0;
    for row in csv.lines().skip(1) {
        let cols: Vec<_> = row.split(',').collect();
        if cols.len() >= 7 && cols[6] == "fallback" {
            samples += 1;
            let pixels: u64 = cols[3].parse().map_err(|e| format!("기록 행 오류: {e}"))?;
            changed = changed.max(pixels);
        }
    }
    if samples == 0 {
        return Err("덮개 구간 기록 프레임 없음".into());
    }
    Ok(outcome(
        changed == 0,
        json!({"samples":samples,"max_protected_pixels":changed,"csv":"screen-frames.csv","threshold":"채널 차이 8/255 초과 픽셀 16개 초과"}),
    ))
}
fn needs_fallback(result: &Value) -> bool {
    ["ax", "click", "type", "key", "focus"]
        .iter()
        .any(|key| result[*key]["status"] != "된다")
}
fn fallback(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    id: &str,
    bounds: Rect,
    view: &Webview,
    probe: &mut FocusProbe<'_>,
) -> Value {
    let mut run = || -> Result<Value, String> {
        probe.prepare()?;
        let recorder = recorder_start(app, probe, out)?;
        let frozen = call(core, CoreRequest::ShareFreeze {})?;
        if !matches!(frozen, CoreReply::ShareFreeze { frozen: true }) {
            return Err(format!("덮개 생성 실패: {frozen:?}"));
        }
        let start = Instant::now();
        let test = (|| {
            place(core, id, Some(bounds))?;
            let results = phase(view, probe, false, "fallback");
            Ok::<_, String>(results)
        })();
        // 시험 실패에도 숨기기와 덮개 해제를 실행한다.
        let hidden = place(core, id, None);
        let unfrozen = call(core, CoreRequest::ShareUnfreeze {});
        let elapsed_ms = start.elapsed().as_millis();
        thread::sleep(Duration::from_millis(250));
        let flicker = recorder_stop(recorder, out).unwrap_or_else(failed);
        hidden?;
        unfrozen?;
        let mut results = test?;
        results["flicker"] = flicker;
        results["cover_elapsed_ms"] = json!(elapsed_ms);
        if elapsed_ms >= 5000 {
            for key in ["ax", "click", "type", "key", "focus"] {
                results[key] = failed(format!("덮개 자동 해제 5초를 넘김: {elapsed_ms}ms"));
            }
        }
        Ok(results)
    };
    run().unwrap_or_else(|error| json!({"ax":failed(&error),"click":failed(&error),"type":failed(&error),"key":failed(&error),"focus":failed(&error),"flicker":failed(&error)}))
}

pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    log: &mut File,
) -> Result<(), String> {
    record(log, "start", json!({"scenario":"web-control-probe"}))?;
    thread::sleep(Duration::from_secs(2));
    let url = serve_fixture()?;
    let shell = match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot } => snapshot,
        other => return Err(format!("상태 응답: {other:?}")),
    };
    let workspace = shell
        .device
        .active_workspace_id
        .ok_or("활성 작업 공간 없음")?;
    let desktop = shell
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("활성 데스크톱 없음")?
        .clone();
    for window in shell
        .shared
        .windows
        .iter()
        .filter(|window| window.desktop_id == desktop)
    {
        call(
            core,
            CoreRequest::WindowClose {
                window_id: window.id.clone(),
            },
        )?;
    }
    let mut browser: Value =
        serde_json::from_str(include_str!("../../../../apps/web-browser.json"))
            .map_err(|e| e.to_string())?;
    browser["id"] = json!(APP_ID);
    browser["state"]["url"] = json!(url);
    call(
        core,
        CoreRequest::AppImport {
            definition_json: browser.to_string(),
        },
    )?;
    let events = ui::track_web_events(core);
    let id = match call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop,
            app_id: APP_ID.into(),
            rect: Some(Rect {
                x: 48,
                y: 48,
                width: 800,
                height: 550,
            }),
        },
    )? {
        CoreReply::WindowOpen { window } => window.id,
        other => return Err(format!("창 열기 응답: {other:?}")),
    };
    ui::wait_for_web_page(&events, &id, &url)?;
    ui::wait_web_live(&id)?;
    let selector = format!("[data-testid=\\\"app-window-{APP_ID}\\\"] [data-ks-web-surface]");
    let geometry = ui::evaluate(app, &format!("const e=document.querySelector('{selector}');if(!e)throw Error('surface missing');const r=e.getBoundingClientRect();return {{x:r.x,y:r.y,width:r.width,height:r.height}};"))?;
    let number = |key: &str| {
        geometry[key]
            .as_f64()
            .ok_or_else(|| format!("웹뷰 좌표 없음: {key}"))
    };
    let bounds = Rect {
        x: number("x")?.round() as i32,
        y: number("y")?.round() as i32,
        width: number("width")?.round() as u32,
        height: number("height")?.round() as u32,
    };
    let view = app
        .get_webview(&format!("web-{id}"))
        .ok_or("자식 웹뷰 없음")?;
    let mut probe = FocusProbe::start(app, out)?;
    let main = app.get_window("main").ok_or("메인 창 없음")?;
    main.set_focus().map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(250));
    let shell_handle = main.hwnd().map_err(|e| e.to_string())?.0 as isize as i64;
    let a_setup = probe.snapshot()?;
    if a_setup["foreground"].as_i64() != Some(shell_handle) || !visible(&view)? {
        return Err(format!("A의 쉘 전경 또는 웹뷰 표시 준비 실패: {a_setup}"));
    }
    let a = phase(&view, &mut probe, true, "a");
    let host = app.state::<Arc<crate::web_host::TauriWebHost>>();
    let a_product = product::phase(host.as_ref(), &view, &id, &mut probe, true, out, "a");
    capture(out, "a-visible")?;
    let b_setup = probe.prepare()?;
    let position = main.inner_position().map_err(|e| e.to_string())?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let web_left = position.x as f64 + geometry["x"].as_f64().unwrap() * scale;
    let web_top = position.y as f64 + geometry["y"].as_f64().unwrap() * scale;
    let web_right = web_left + geometry["width"].as_f64().unwrap() * scale;
    let web_bottom = web_top + geometry["height"].as_f64().unwrap() * scale;
    let bx = b_setup["x"].as_f64().ok_or("다른 창 x 없음")?;
    let by = b_setup["y"].as_f64().ok_or("다른 창 y 없음")?;
    let br = bx + b_setup["width"].as_f64().ok_or("다른 창 폭 없음")?;
    let bb = by + b_setup["height"].as_f64().ok_or("다른 창 높이 없음")?;
    if bx >= web_right || br <= web_left || by >= web_bottom || bb <= web_top || !visible(&view)? {
        return Err(format!(
            "B의 다른 창이 표시된 웹뷰를 덮지 않음: {b_setup}, 웹뷰: {geometry}"
        ));
    }
    let b = phase(&view, &mut probe, false, "b");
    let b_product = product::phase(host.as_ref(), &view, &id, &mut probe, false, out, "b");
    capture(out, "b-covered")?;
    place(core, &id, None)?;
    if visible(&view)? {
        return Err("C의 웹뷰가 숨겨지지 않음".into());
    }
    let c = phase(&view, &mut probe, false, "c");
    let c_product = product::phase(host.as_ref(), &view, &id, &mut probe, false, out, "c");
    capture(out, "c-hidden")?;
    let alternative = if needs_fallback(&c) {
        Some(fallback(app, core, out, &id, bounds, &view, &mut probe))
    } else {
        None
    };
    let output = json!({"fixture_url":url,"window_id":id,"web_bounds":geometry,"shell_handle":shell_handle,"a_setup":a_setup,"b_setup":b_setup,
        "states":{"a_visible":a,"b_covered":b,"c_hidden":c,"c_prime_cover":alternative},
        "product":{"a_visible":a_product,"b_covered":b_product,"c_hidden":c_product}});
    fs::write(
        out.join("web-control-results.json"),
        serde_json::to_vec_pretty(&output).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    record(log, "web-control.results", output)?;
    record(
        log,
        "complete",
        json!({"ok":true,"file":"web-control-results.json"}),
    )
}
