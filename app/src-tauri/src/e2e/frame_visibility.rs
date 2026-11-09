//! 카드 #1136: 창이 최소화되면 샌드박스 프레임의 rAF 콜백이 멈추고 복원되면 잇는지(#913),
//! 클라이언트 캔버스가 준비되기 전에 기존 로딩 표시가 보이는지(#992)를 실제 Windows
//! WebView2에서 잰다. 창 틀을 다루는 ui.rs를 건드리지 않도록 시나리오를 따로 둔다.
use super::*;
use kaleidoscope_core::kaleidoscope_contract::VisibleView;
use sha2::{Digest, Sha256};
use std::time::Instant;

const SANDBOX_APP_ID: &str = "frame-visibility-1136";
const CANVAS_APP_ID: &str = "canvas-loading-1136";
const CLIENT_ASSET_ID: &str = "canvas-loading-1136-client";
const SANDBOX_HTML: &str =
    include_str!("../../../../ui/e2e/fixtures/frame-visibility-1136/sandbox.html");
const CLIENT_JS: &str = include_str!("../../../../ui/e2e/fixtures/frame-visibility-1136/client.js");
const WINDOW_READY_TIMEOUT: Duration = Duration::from_secs(30);
const REPORT_TIMEOUT: Duration = Duration::from_secs(10);
const HIDDEN_MEASURE: Duration = Duration::from_millis(1500);

fn snapshot(core: &Core) -> Result<kaleidoscope_core::kaleidoscope_contract::ShellSnapshot, String> {
    match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot, .. } => Ok(snapshot),
        reply => Err(format!("unexpected state response: {reply:?}")),
    }
}

fn open_window(core: &Core, desktop_id: &str, app_id: &str, rect: Rect) -> Result<String, String> {
    match call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop_id.into(),
            app_id: app_id.into(),
            rect: Some(rect),
        },
    )? {
        CoreReply::WindowOpen { window } => Ok(window.id),
        reply => Err(format!("unexpected window.open response: {reply:?}")),
    }
}

fn minimize(core: &Core, window_id: &str) -> Result<(), String> {
    call(
        core,
        CoreRequest::WindowMinimize {
            window_id: window_id.into(),
        },
    )?;
    Ok(())
}

fn restore(core: &Core, window_id: &str) -> Result<(), String> {
    call(
        core,
        CoreRequest::WindowRestore {
            window_id: window_id.into(),
        },
    )?;
    Ok(())
}

fn share(core: &Core, window_id: &str, on: bool) -> Result<(), String> {
    call(
        core,
        CoreRequest::ShareSet {
            window_id: window_id.into(),
            on,
        },
    )?;
    Ok(())
}

fn import_definition(core: &Core, definition: Value) -> Result<(), String> {
    call(
        core,
        CoreRequest::AppImport {
            definition_json: definition.to_string(),
        },
    )?;
    Ok(())
}

// 같이 보기 글에서 샌드박스 앱이 남기는 "프레임 N"과 "갱신 M"을 읽는다.
fn parse_count(text: &str, prefix: &str) -> Option<u64> {
    let start = text.find(prefix)? + prefix.len();
    let digits: String = text[start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

fn view_counts(view: &VisibleView) -> Result<(u64, u64), String> {
    let frames = parse_count(&view.text, "프레임 ").ok_or("share text has no frame count")?;
    let reports = parse_count(&view.text, "갱신 ").unwrap_or(0);
    Ok((frames, reports))
}

fn wait_view(window_id: &str, occluded: bool, label: &str) -> Result<VisibleView, String> {
    let deadline = Instant::now() + WINDOW_READY_TIMEOUT;
    loop {
        if let Some(view) = ui::latest_share_view(window_id) {
            if view.visual
                && view.occluded == occluded
                && parse_count(&view.text, "프레임 ").is_some()
            {
                return Ok(view);
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "{label}: share.view did not reach occluded={occluded} in time"
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

// 최소화 뒤 새 보고가 도착했는지(갱신 증가) 기다린다.
fn wait_reports_above(
    window_id: &str,
    occluded: bool,
    above: u64,
    label: &str,
) -> Result<VisibleView, String> {
    let deadline = Instant::now() + REPORT_TIMEOUT;
    loop {
        if let Some(view) = ui::latest_share_view(window_id) {
            if view.occluded == occluded {
                if let Ok((_, reports)) = view_counts(&view) {
                    if reports > above {
                        return Ok(view);
                    }
                }
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "{label}: share report did not advance past 갱신 {above} in time"
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

// 복원 뒤 rAF가 다시 돌았는지(프레임 증가) 기다린다.
fn wait_frame_above(
    window_id: &str,
    occluded: bool,
    above: u64,
    label: &str,
) -> Result<VisibleView, String> {
    let deadline = Instant::now() + REPORT_TIMEOUT;
    loop {
        if let Some(view) = ui::latest_share_view(window_id) {
            if view.occluded == occluded {
                if let Ok((frames, _)) = view_counts(&view) {
                    if frames > above {
                        return Ok(view);
                    }
                }
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "{label}: frame count did not advance past {above} in time"
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn sandbox_definition() -> Value {
    json!({
        "id": SANDBOX_APP_ID,
        "name": "프레임 보임 시험",
        "requires": {"blocks": 11, "modules": {}},
        "permissions": [],
        "state": {},
        "ui": {"type": "sandbox", "title": "프레임 보임 시험", "value": SANDBOX_HTML}
    })
}

fn canvas_definition() -> Value {
    json!({
        "id": CANVAS_APP_ID,
        "name": "캔버스 준비 시험",
        "requires": {"blocks": 12, "modules": {"assets": 1, "client": 1}},
        "permissions": [],
        "state": {},
        "assets": [{"id": CLIENT_ASSET_ID, "version": 1}],
        "client": {
            "runtime": "javascript",
            "entry": {"id": CLIENT_ASSET_ID, "version": 1},
            "inputs": {}, "outputs": {}, "actions": [], "commands": {},
            "state_keys": [], "storage_entries": []
        },
        "ui": {"type": "canvas", "surface": "stage", "description": "준비된 색상 무대"}
    })
}

pub(super) fn scenario(app: &AppHandle, core: &Core, log: &mut File) -> Result<(), String> {
    record(log, "start", json!({"scenario":"frame-visibility"}))?;
    let shell = snapshot(core)?;
    let workspace = shell
        .device
        .active_workspace_id
        .ok_or("active workspace is missing")?;
    let desktop_id = shell
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("active desktop is missing")?
        .clone();
    // 앞 시나리오에서 남은 창이 겹쳐 occluded 판정을 흔들지 않게 한다.
    for window in shell
        .shared
        .windows
        .iter()
        .filter(|window| window.desktop_id == desktop_id)
    {
        call(
            core,
            CoreRequest::WindowClose {
                window_id: window.id.clone(),
            },
        )?;
    }

    import_definition(core, sandbox_definition())?;
    let window_id = open_window(
        core,
        &desktop_id,
        SANDBOX_APP_ID,
        Rect {
            x: 64,
            y: 64,
            width: 720,
            height: 520,
        },
    )?;
    record(log, "frame.window", json!({"window_id": window_id}))?;
    share(core, &window_id, true)?;

    let mut failed = false;
    macro_rules! check {
        ($id:expr, $body:block) => {{
            let result: Result<(), String> = (|| $body)();
            let ok = result.is_ok();
            if !ok { failed = true; }
            record(log, "check.result", json!({"id":$id,"ok":ok,"message":result.err().unwrap_or_default()}))?;
        }};
    }

    // B1-1: 보이는 동안 앱의 rAF 루프가 돈다.
    check!("frame-visible-runs", {
        let shown = wait_view(&window_id, false, "frame visible")?;
        let (shown_frames, shown_reports) = view_counts(&shown)?;
        let later = wait_frame_above(&window_id, false, shown_frames, "frame visible running")?;
        let (later_frames, later_reports) = view_counts(&later)?;
        record(log, "frame.sample", json!({
            "phase": "visible",
            "startFrames": shown_frames, "endFrames": later_frames,
            "delta": later_frames - shown_frames,
            "startReports": shown_reports, "endReports": later_reports,
        }))?;
        if later_frames <= shown_frames {
            return Err(format!("visible frame count did not grow: {shown_frames} -> {later_frames}"));
        }
        Ok(())
    });

    // B1-2·3: 최소화가 안정된 뒤(최소화 뒤 첫 보고를 지나) 1.5초 동안 rAF가 늘지 않고,
    // 그동안 같이 보기 보고(갱신)는 계속 온다.
    let mut hidden_start_frames = 0u64;
    let mut hidden_end_frames = 0u64;
    let mut hidden_start_reports = 0u64;
    let mut hidden_end_reports = 0u64;
    check!("frame-hidden-paused", {
        minimize(core, &window_id)?;
        let settle = wait_view(&window_id, true, "frame hidden")?;
        let (_, settle_reports) = view_counts(&settle)?;
        let start = wait_reports_above(&window_id, true, settle_reports, "frame hidden settle")?;
        (hidden_start_frames, hidden_start_reports) = view_counts(&start)?;
        let started = Instant::now();
        let measured: Option<VisibleView>;
        loop {
            if let Some(view) = ui::latest_share_view(&window_id) {
                if view.occluded {
                    if let Ok((_, reports)) = view_counts(&view) {
                        if reports > hidden_start_reports
                            && started.elapsed() >= HIDDEN_MEASURE
                        {
                            measured = Some(view);
                            break;
                        }
                    }
                }
            }
            if started.elapsed() >= REPORT_TIMEOUT {
                return Err(format!(
                    "minimized share report stopped: 갱신 {hidden_start_reports} did not advance"
                ));
            }
            thread::sleep(Duration::from_millis(50));
        }
        let end = measured.ok_or("minimized share measurement did not complete")?;
        (hidden_end_frames, hidden_end_reports) = view_counts(&end)?;
        record(log, "frame.sample", json!({
            "phase": "hidden",
            "startFrames": hidden_start_frames, "endFrames": hidden_end_frames,
            "delta": hidden_end_frames as i64 - hidden_start_frames as i64,
            "startReports": hidden_start_reports, "endReports": hidden_end_reports,
            "measuredMs": started.elapsed().as_millis() as u64,
        }))?;
        if hidden_end_frames != hidden_start_frames {
            return Err(format!(
                "frame count grew while minimized: {hidden_start_frames} -> {hidden_end_frames}"
            ));
        }
        Ok(())
    });
    check!("frame-share-continues", {
        if hidden_end_reports <= hidden_start_reports {
            return Err(format!(
                "share report stopped while minimized: 갱신 {hidden_start_reports} -> {hidden_end_reports}"
            ));
        }
        Ok(())
    });

    // B1-4: 복원하면 rAF가 다시 돈다.
    check!("frame-restored-runs", {
        restore(core, &window_id)?;
        let shown = wait_view(&window_id, false, "frame restored")?;
        let (shown_frames, _) = view_counts(&shown)?;
        let later = wait_frame_above(&window_id, false, shown_frames, "frame restored running")?;
        let (later_frames, later_reports) = view_counts(&later)?;
        record(log, "frame.sample", json!({
            "phase": "restored",
            "startFrames": shown_frames, "endFrames": later_frames,
            "delta": later_frames - shown_frames, "endReports": later_reports,
        }))?;
        if later_frames <= shown_frames {
            return Err(format!("restored frame count did not grow: {shown_frames} -> {later_frames}"));
        }
        Ok(())
    });

    call(
        core,
        CoreRequest::WindowClose {
            window_id: window_id.clone(),
        },
    )?;

    // B2: 캔버스 창을 열기 전에 문서에 관찰기를 심어, 준비 전 로딩 표시가 나타났다가
    // 사라지는지 기록한다. 관찰기는 캔버스 블록의 aria-busy 변화도 함께 본다.
    check!("canvas-loading-shown", {
        ui::evaluate(
            app,
            r#"
const seen = {loadingAdded: 0, loadingRemoved: 0, busySet: 0, busyCleared: 0};
window.__ksCanvasSeen = seen;
if (window.__ksCanvasObserver) window.__ksCanvasObserver.disconnect();
const hasLoading = (node) => node.nodeType === 1 && (node.classList?.contains('ks-canvas-loading') || node.querySelector?.('.ks-canvas-loading'));
const observer = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === 'childList') {
      for (const node of record.addedNodes) if (hasLoading(node)) seen.loadingAdded += 1;
      for (const node of record.removedNodes) if (hasLoading(node)) seen.loadingRemoved += 1;
    } else if (record.type === 'attributes' && record.attributeName === 'aria-busy' && record.target.classList?.contains('ks-canvas')) {
      if (record.target.getAttribute('aria-busy')) seen.busySet += 1; else seen.busyCleared += 1;
    }
  }
});
observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy']});
window.__ksCanvasObserver = observer;
return true;
"#,
        )?;
        super::realtime::fixture::mcp(
            app,
            "upload_asset",
            json!({
                "id": CLIENT_ASSET_ID, "version": 1, "format": "javascript",
                "sha256": format!("{:x}", Sha256::digest(CLIENT_JS.as_bytes())),
                "source": "ui/e2e/fixtures/frame-visibility-1136/client.js",
                "license": "MIT",
                "data_base64": STANDARD.encode(CLIENT_JS.as_bytes())
            }),
        )?;
        import_definition(core, canvas_definition())?;
        let canvas_window = open_window(
            core,
            &desktop_id,
            CANVAS_APP_ID,
            Rect {
                x: 96,
                y: 96,
                width: 560,
                height: 400,
            },
        )?;
        record(log, "canvas.window", json!({"window_id": canvas_window}))?;
        ui::wait_dom(
            app,
            &format!(
                "const w=document.querySelector('[data-testid=\\\"app-window-{CANVAS_APP_ID}\\\"]');return !!w && !!w.querySelector('.ks-canvas') && !w.querySelector('.ks-canvas-loading') && !w.querySelector('.ks-canvas[aria-busy]');"
            ),
            "canvas client ready",
        )?;
        let observed = ui::evaluate(
            app,
            &format!(
                r#"
const seen = window.__ksCanvasSeen || null;
const w = document.querySelector('[data-testid="app-window-{CANVAS_APP_ID}"]');
const canvas = w ? w.querySelector('.ks-canvas') : null;
return {{
  seen,
  loadingNow: !!(w && w.querySelector('.ks-canvas-loading')),
  busyNow: canvas ? canvas.getAttribute('aria-busy') : null,
  label: canvas ? canvas.getAttribute('aria-label') : null
}};
"#
            ),
        )?;
        record(log, "canvas.observe", observed.clone())?;
        let seen = &observed["seen"];
        let added = seen["loadingAdded"].as_u64().unwrap_or(0);
        let removed = seen["loadingRemoved"].as_u64().unwrap_or(0);
        if added == 0 {
            return Err("canvas loading overlay never appeared before client ready".into());
        }
        if removed == 0 {
            return Err("canvas loading overlay was not removed after client ready".into());
        }
        if observed["loadingNow"].as_bool() != Some(false) {
            return Err("canvas loading overlay is still visible after client ready".into());
        }
        if !observed["busyNow"].is_null() {
            return Err(format!(
                "canvas aria-busy remained after client ready: {}",
                observed["busyNow"]
            ));
        }
        Ok(())
    });

    record(
        log,
        "complete",
        json!({"scenario":"frame-visibility","passed":!failed}),
    )?;
    if failed {
        Err("one or more frame visibility checks failed".into())
    } else {
        Ok(())
    }
}
