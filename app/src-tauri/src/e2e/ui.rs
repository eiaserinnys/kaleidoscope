use super::*;
use std::sync::Mutex;

pub(super) mod driver;
#[cfg_attr(not(windows), allow(dead_code))]
mod pc_access;
use driver::{
    action, editor_state, on_top, open, request_mark, require_request, snapshot, wait_place,
    wait_until, wait_web, WebEvents,
};
pub(super) use driver::{
    eval_timeouts, evaluate, try_evaluate, wait_dom, wait_web_hidden, wait_web_live, web_place_mark,
};

pub(super) fn track_web_events(core: &Core) -> WebEvents {
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_listener = events.clone();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::WebUpdate { window_id, page } = event {
            events_listener
                .lock()
                .unwrap()
                .push((window_id.clone(), page.clone()));
        }
    }));
    events
}

pub(super) fn wait_for_web_page(
    events: &WebEvents,
    window_id: &str,
    url: &str,
) -> Result<WebPage, String> {
    wait_web(events, window_id, url)
}

pub(super) fn observe(request: &CoreRequest) {
    driver::observe(request);
}

pub(super) fn requests_since(mark: usize) -> Vec<CoreRequest> {
    driver::requests_since(mark)
}

pub(super) fn latest_share_view(
    window_id: &str,
) -> Option<kaleidoscope_core::kaleidoscope_contract::VisibleView> {
    driver::latest_share_view(window_id)
}

pub(super) fn capture_duration_mark() -> usize {
    driver::capture_duration_mark()
}

pub(super) fn capture_durations_since(mark: usize) -> Vec<(String, u128)> {
    driver::capture_durations_since(mark)
}

pub(super) fn complete(request: &CoreRequest, elapsed_ms: u128) {
    driver::complete(request, elapsed_ms);
}

pub(super) fn mark_requests() -> usize {
    request_mark()
}

struct NotesFixture(PathBuf);

impl NotesFixture {
    fn create() -> Result<Self, String> {
        let documents = dirs::document_dir().ok_or("Documents folder unavailable")?;
        let root = documents.join("kaleidoscope-e2e");
        if root.exists() {
            return Err("kaleidoscope-e2e fixture already exists".into());
        }
        fs::create_dir_all(root.join("notes")).map_err(|e| e.to_string())?;
        let fixture = Self(root);
        fs::write(fixture.0.join("notes/a.md"), "# 첫 번째 노트").map_err(|e| e.to_string())?;
        fs::write(fixture.0.join("notes/b.md"), "# 두 번째 노트").map_err(|e| e.to_string())?;
        Ok(fixture)
    }
}

impl Drop for NotesFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// PC 접근 허용 버튼을 네이티브 클릭으로 누르고, 그 입력이 주 웹뷰 DOM에
/// 실제로 도달했는지 관측기 기록으로 판정한다.
///
/// 다시 클릭하지 않는다. 관측기는 포커스 확보 전에 설치하고, 포커스 뒤
/// 좌표를 다시 계산해 대상이 주 웹뷰의 허용 버튼인지 재확인한다.
/// 모든 경로에서 `ui.pc_access.target`과 `ui.pc_access.trace`를 남긴다.
fn allow_pc_with_native_input(app: &AppHandle, log: &mut File) -> Result<(), String> {
    #[cfg(windows)]
    {
        const INSTALL: &str = r#"
            const root = document.querySelector('[data-testid="app-window-explorer"]');
            const button = root ? [...root.querySelectorAll('button')].find(b => b.textContent.trim() === '이 PC의 파일 읽기 허용') : null;
            if (!root || !button) return false;
            const summary = element => {
                if (!element) return null;
                const closest = typeof element.closest === 'function' ? element.closest('[data-testid]') : null;
                return {
                    tagName: element.tagName ?? null,
                    text: (element.textContent ?? '').trim().slice(0, 40),
                    testId: closest && typeof closest.getAttribute === 'function' ? closest.getAttribute('data-testid') : null,
                };
            };
            const trace = window.__ksE2ePc = {
                installed_at: performance.now(), point: null, button: button, types: [], events: [],
            };
            trace.snapshot = () => {
                const point = trace.point;
                const at = point ? document.elementFromPoint(point.x, point.y) : null;
                const rect = button.getBoundingClientRect();
                const style = getComputedStyle(root);
                return {
                    hasFocus: document.hasFocus(), visibilityState: document.visibilityState,
                    activeElement: summary(document.activeElement),
                    button: {rect: {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom}, isConnected: button.isConnected},
                    elementFromPoint: summary(at),
                    buttonAtPoint: !!at && (at === button || button.contains(at)),
                    explorer: {opacity: style.opacity, transform: style.transform, pointerEvents: style.pointerEvents},
                };
            };
            const listener = event => trace.events.push({
                type: event.type, isTrusted: event.isTrusted,
                x: event.clientX ?? null, y: event.clientY ?? null,
                t: performance.now(), hasFocus: document.hasFocus(),
                activeElement: summary(document.activeElement), target: summary(event.target),
                onAllowButton: !!event.target && typeof event.target.closest === 'function'
                    && event.target.closest('button') === button,
            });
            trace.listener = listener;
            trace.types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'pointercancel', 'focus', 'blur'];
            trace.types.forEach(type => window.addEventListener(type, listener, true));
            return !!window.__ksE2ePc && typeof window.__ksE2ePc.snapshot === 'function';
        "#;
        const BOUNDS: &str = r#"
            const root = document.querySelector('[data-testid="app-window-explorer"]');
            const button = root ? [...root.querySelectorAll('button')].find(b => b.textContent.trim() === '이 PC의 파일 읽기 허용') : null;
            if (!button) return null;
            const rect = button.getBoundingClientRect();
            return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
        "#;
        const BEFORE: &str = r#"
            const trace = window.__ksE2ePc;
            if (!trace) return null;
            trace.point = CSS_POINT;
            trace.before = trace.snapshot();
            return trace.before;
        "#;
        const PROBE: &str = r#"
            const trace = window.__ksE2ePc;
            if (!trace) return null;
            return {
                events: trace.events.length,
                trusted: trace.events.some(e => e.type === 'click' && e.isTrusted && e.onAllowButton),
            };
        "#;
        const COLLECT: &str = r#"
            const trace = window.__ksE2ePc;
            if (!trace) return null;
            trace.after = trace.snapshot();
            return {installed_at: trace.installed_at, point: trace.point, before: trace.before, after: trace.after, events: trace.events};
        "#;
        const CLEANUP: &str = r#"
            const trace = window.__ksE2ePc;
            if (trace) {
                trace.types.forEach(type => window.removeEventListener(type, trace.listener, true));
                delete window.__ksE2ePc;
            }
            delete window.__ksE2ePcObserver;
            return true;
        "#;

        let mut target = json!({});
        let mut installed = false;
        let mut clicked = false;
        let mut trusted_click = false;
        let mut files_allow_pc = false;
        let mut click_report = Value::Null;
        let mut poll = Value::Null;
        let mut collected = Value::Null;
        let mut failure: Option<String> = None;

        // 1. 관측기를 포커스 확보 전에 설치하고 살아 있는지 확인한다.
        match evaluate(app, INSTALL) {
            Ok(ready) if ready == json!(true) => installed = true,
            Ok(_) => {
                failure = Some(
                    "PC access trace observer missing or corrupted after install (allow button not found or observer not installed)"
                        .into(),
                )
            }
            Err(error) => {
                failure = Some(format!("PC access trace observer install failed: {error}"))
            }
        }

        // 2. 주 웹뷰 입력 포커스를 확보한다.
        if failure.is_none() {
            match super::native_target::focus_main_webview(app) {
                Ok(focus) => target["focus"] = focus,
                Err(error) => failure = Some(error),
            }
        }

        // 3. 포커스 뒤 좌표를 다시 계산하고 클릭 지점이 주 웹뷰의 허용 버튼인지 재확인한다.
        let mut point = None;
        if failure.is_none() {
            let resolved: Result<(i32, i32), String> = (|| {
                let window = app.get_window("main").ok_or("main window not found")?;
                let bounds = evaluate(app, BOUNDS)?;
                if bounds.is_null() {
                    return Err("PC consent button missing after focus".into());
                }
                let css_x = bounds["x"].as_f64().ok_or("PC consent x missing")?;
                let css_y = bounds["y"].as_f64().ok_or("PC consent y missing")?;
                let css = json!({"x": css_x, "y": css_y});
                let position = window.inner_position().map_err(|error| error.to_string())?;
                let scale = window.scale_factor().map_err(|error| error.to_string())?;
                let x = position.x + (css_x * scale).round() as i32;
                let y = position.y + (css_y * scale).round() as i32;
                let at = super::native_target::wait_main_webview_at(app, x, y)?;
                let before = evaluate(app, &BEFORE.replace("CSS_POINT", &css.to_string()))?;
                if before.is_null() {
                    return Err("PC access trace observer missing or corrupted before click".into());
                }
                if before["buttonAtPoint"] != json!(true) {
                    return Err(format!(
                        "PC access click point ({x},{y}) is not the allow button; dom: {before}"
                    ));
                }
                target["bounds"] = bounds;
                target["css_point"] = css;
                target["inner_position"] = json!({"x": position.x, "y": position.y});
                target["scale"] = json!(scale);
                target["x"] = json!(x);
                target["y"] = json!(y);
                target["wait"] = at;
                target["before"] = before;
                target["gui"] = super::native_target::gui_thread_snapshot(app, x, y);
                Ok((x, y))
            })();
            match resolved {
                Ok(resolved) => point = Some(resolved),
                Err(error) => failure = Some(error),
            }
        }

        // 4. 네이티브 클릭은 정확히 한 번 보낸다.
        if failure.is_none() {
            if let Some((x, y)) = point {
                let mark = request_mark();
                match super::share_isolate::native_input::click_with_report(x, y) {
                    Ok(report) => {
                        clicked = true;
                        click_report = report;
                        let started = Instant::now();
                        while started.elapsed() < Duration::from_secs(2) {
                            files_allow_pc = requests_since(mark)
                                .iter()
                                .any(|request| matches!(request, CoreRequest::FilesAllowPc { .. }));
                            if files_allow_pc {
                                break;
                            }
                            match evaluate(app, PROBE) {
                                Ok(probe) if probe["trusted"] == json!(true) => {
                                    trusted_click = true;
                                    break;
                                }
                                Ok(_) => {}
                                Err(_) => {}
                            }
                            thread::sleep(Duration::from_millis(50));
                        }
                        poll = json!({
                            "elapsed_ms": started.elapsed().as_millis(),
                            "trusted_click": trusted_click, "files_allow_pc": files_allow_pc,
                        });
                    }
                    Err(error) => failure = Some(error),
                }
            }
        }

        // 5. 기록을 모은다. 실패 경로에서도 남길 수 있게 수집 오류는 따로 둔다.
        if installed {
            match evaluate(app, COLLECT) {
                Ok(value) if !value.is_null() => collected = value,
                Ok(_) => {
                    let message = "PC access trace observer missing or corrupted at collection";
                    if failure.is_none() {
                        failure = Some(message.into());
                    }
                }
                Err(error) => {
                    if failure.is_none() {
                        failure = Some(format!("PC access trace collection failed: {error}"));
                    }
                }
            }
        }

        // 6. 기록만 보고 판정한다.
        let trace = json!({
            "installed": installed, "clicked": clicked, "click": click_report, "poll": poll,
            "point": collected["point"], "before": collected["before"],
            "after": collected["after"], "events": collected["events"],
        });
        let model = pc_access::Trace {
            installed,
            before: !collected["before"].is_null(),
            after: !collected["after"].is_null(),
            events: pc_access_events(&collected["events"]),
        };
        let outcome = pc_access::classify_pc_access_click(&model);
        target["outcome"] = json!(format!("{outcome:?}"));
        target["files_allow_pc"] = json!(files_allow_pc);
        let recorded = record(log, "ui.pc_access.target", target.clone())
            .and_then(|()| record(log, "ui.pc_access.trace", trace.clone()));
        // 기록을 남긴 뒤 리스너는 반드시 정리한다.
        if installed {
            let _ = evaluate(app, CLEANUP);
        }
        recorded?;

        // 코어가 FilesAllowPc를 받았으면 클릭은 실제로 전달된 것이다.
        // 관측기가 그 뒤에 사라졌더라도 성공으로 본다.
        if files_allow_pc {
            return Ok(());
        }
        if let Some(failure) = failure {
            return Err(failure);
        }
        match outcome {
            pc_access::Outcome::TrustedClick => Ok(()),
            pc_access::Outcome::ObserverMissing => Err(format!(
                "PC access trace observer missing or corrupted; trace: {trace}"
            )),
            pc_access::Outcome::NoEvents => Err(format!(
                "native click did not reach main webview DOM (events=0); target: {target}, trace: {trace}"
            )),
            pc_access::Outcome::PartialDelivery => Err(format!(
                "native click did not complete a trusted click on the allow button (partial delivery); trace: {trace}"
            )),
            pc_access::Outcome::WrongTarget => Err(format!(
                "native click did not complete a trusted click on the allow button (another element or untrusted input); trace: {trace}"
            )),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, log);
        Err("PC access E2E requires native Windows input".into())
    }
}

#[cfg(windows)]
fn pc_access_events(value: &Value) -> Vec<pc_access::Event> {
    value
        .as_array()
        .map(|events| {
            events
                .iter()
                .map(|event| pc_access::Event {
                    kind: event["type"].as_str().unwrap_or_default().to_owned(),
                    trusted: event["isTrusted"] == json!(true),
                    on_allow_button: event["onAllowButton"] == json!(true),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 주 웹뷰 DOM 안 요소의 중심을 물리 화면 좌표로 바꾼다. 그 자리에 실제로 그 요소가
/// 맨 위에 있어야 한다. 다른 창이나 요소가 덮고 있으면 엉뚱한 곳을 누르게 되므로 실패로 남긴다.
#[cfg(windows)]
fn native_webview_point(
    app: &AppHandle,
    selector: &str,
    label: &str,
) -> Result<(i32, i32, Value), String> {
    let selector = serde_json::to_string(selector).map_err(|error| error.to_string())?;
    let resolved = evaluate(
        app,
        &format!(
            r#"
      const element = document.querySelector({selector});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const at = document.elementFromPoint(x, y);
      return {{ x, y, width: rect.width, height: rect.height,
        covers: !!at && (at === element || element.contains(at)) }};
    "#
        ),
    )?;
    if resolved.is_null() {
        return Err(format!("{label} missing"));
    }
    if resolved["covers"] != json!(true) {
        return Err(format!("{label} is covered at its center: {resolved}"));
    }
    let css_x = resolved["x"]
        .as_f64()
        .ok_or_else(|| format!("{label} x missing"))?;
    let css_y = resolved["y"]
        .as_f64()
        .ok_or_else(|| format!("{label} y missing"))?;
    let window = app.get_window("main").ok_or("main window not found")?;
    let position = window.inner_position().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    Ok((
        position.x + (css_x * scale).round() as i32,
        position.y + (css_y * scale).round() as i32,
        resolved,
    ))
}

#[cfg(windows)]
fn window_dom_rect(app: &AppHandle, window_id: &str) -> Result<Value, String> {
    evaluate(
        app,
        &format!(
            r#"
      const root = document.querySelector('[data-window-id="{window_id}"]');
      if (!root) return null;
      const rect = root.getBoundingClientRect();
      return {{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }};
    "#
        ),
    )
}

#[cfg(windows)]
fn window_rect(core: &Core, window_id: &str) -> Result<Rect, String> {
    snapshot(core)?
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)
        .map(|window| window.rect)
        .ok_or_else(|| format!("window {window_id} missing"))
}

pub(super) fn run(app: &AppHandle, core: &Core, out: &Path, log: &mut File) -> Result<(), String> {
    let fixture = NotesFixture::create()?;
    let snap = snapshot(core)?;
    let workspace = snap
        .device
        .active_workspace_id
        .ok_or("no active workspace")?;
    let desktop = snap
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("no active desktop")?
        .clone();
    for window in snap
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
    wait_dom(
        app,
        "return !document.querySelector('.ks-window');",
        "previous windows closed",
    )?;

    let mut browser: Value =
        serde_json::from_str(include_str!("../../../../apps/web-browser.json"))
            .map_err(|error| error.to_string())?;
    browser["id"] = json!("e2e-web-browser");
    browser["state"]["url"] = json!("https://example.com/");
    call(
        core,
        CoreRequest::AppImport {
            definition_json: browser.to_string(),
        },
    )?;

    let events: WebEvents = Arc::new(Mutex::new(Vec::new()));
    let events_listener = events.clone();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::WebUpdate { window_id, page } = event {
            events_listener
                .lock()
                .unwrap()
                .push((window_id.clone(), page.clone()));
        }
    }));

    let start = request_mark();
    let browser_id = open(
        core,
        &desktop,
        "e2e-web-browser",
        Rect {
            x: 12,
            y: 12,
            width: 880,
            height: 600,
        },
    )?;
    require_request(log, start, "browser UI attach", |request| {
        matches!(request,
            CoreRequest::WebAttach { window_id, url } if window_id == &browser_id && url.starts_with("https://example.com/")
        )
    })?;
    let page = wait_web(&events, &browser_id, "https://example.com/")?;
    record(
        log,
        "ui.web.update",
        json!({"window_id": browser_id, "page": page}),
    )?;
    wait_place(&browser_id, start, true, log)?;
    wait_dom(app, "return !!document.querySelector('[data-testid=\"app-window-e2e-web-browser\"] [data-ks-web-surface]') && !document.querySelector('.ks-web-frozen-image');", "live browser")?;
    screen(out, log, "04-ui-live")?;

    let start = request_mark();
    action(app, "const b=document.querySelector('.ks-workspace-control button'); if(!b)return false; b.click(); return true;", "open workspace menu")?;
    wait_dom(
        app,
        r#"
      const menu=document.querySelector('[role=menu]'); const surface=document.querySelector('[data-testid="app-window-e2e-web-browser"] [data-ks-web-surface]');
      const image=surface?.querySelector('.ks-web-frozen-image'); if(!menu||!surface||!image?.src.startsWith('data:image/png;base64,')) return false;
      const m=menu.getBoundingClientRect(), s=surface.getBoundingClientRect();
      const overlap=Math.min(m.right,s.right)>Math.max(m.left,s.left) && Math.min(m.bottom,s.bottom)>Math.max(m.top,s.top);
      const within=m.left>=0 && m.top>=0 && m.right<=innerWidth && m.bottom<=innerHeight;
      const target=document.elementFromPoint((m.left+m.right)/2,(m.top+m.bottom)/2);
      return overlap && within && !!target?.closest('[role=menu]');
    "#,
        "menu overlaps frozen web view",
    )?;
    wait_place(&browser_id, start, false, log)?;
    record(
        log,
        "ui.menu",
        json!({"overlap": true, "within_viewport": true, "frozen_png": true}),
    )?;
    screen(out, log, "05-menu-frozen")?;

    let start = request_mark();
    action(app, "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true})); return true;", "close menu")?;
    wait_dom(app, "return !document.querySelector('[role=menu]') && !document.querySelector('.ks-web-frozen-image');", "menu closed and web live")?;
    wait_place(&browser_id, start, true, log)?;
    screen(out, log, "06-menu-closed")?;

    let start = request_mark();
    let overlay_id = open(
        core,
        &desktop,
        "md-editor",
        Rect {
            x: 220,
            y: 140,
            width: 600,
            height: 420,
        },
    )?;
    wait_dom(
        app,
        r#"
      const editor=document.querySelector('[data-testid="app-window-md-editor"]');
      const surface=document.querySelector('[data-testid="app-window-e2e-web-browser"] [data-ks-web-surface]');
      if(!editor||!surface||!surface.querySelector('.ks-web-frozen-image')) return false;
      const e=editor.getBoundingClientRect(), s=surface.getBoundingClientRect();
      return Math.min(e.right,s.right)>Math.max(e.left,s.left) && Math.min(e.bottom,s.bottom)>Math.max(e.top,s.top);
    "#,
        "editor overlaps frozen web view",
    )?;
    wait_place(&browser_id, start, false, log)?;
    record(
        log,
        "ui.editor.overlap",
        json!({"window_id": overlay_id, "frozen": true}),
    )?;
    screen(out, log, "07-editor-overlap")?;

    let start = request_mark();
    action(
        app,
        r#"
      const surface=document.querySelector('[data-testid="app-window-e2e-web-browser"] [data-ks-web-surface]');
      if(!surface?.querySelector('.ks-web-frozen-image')) return false;
      const r=surface.getBoundingClientRect(), x=r.left+20, y=r.top+20;
      const target=document.elementFromPoint(x,y); if(!target||!surface.contains(target)) return false;
      target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'mouse',clientX:x,clientY:y,isPrimary:true}));
      return true;
    "#,
        "raise frozen web view",
    )?;
    wait_until("browser raised", || on_top(core, &browser_id))?;
    require_request(log, start, "UI window.raise", |request| {
        matches!(request,
            CoreRequest::WindowRaise { window_id } if window_id == &browser_id
        )
    })?;
    wait_place(&browser_id, start, true, log)?;
    wait_dom(
        app,
        "return !document.querySelector('.ks-web-frozen-image');",
        "web view live after raise",
    )?;
    screen(out, log, "08-web-raised")?;
    call(
        core,
        CoreRequest::WindowClose {
            window_id: overlay_id,
        },
    )?;

    let browser_place = web_place_mark();
    let explorer_id = open(
        core,
        &desktop,
        "explorer",
        Rect {
            x: 160,
            y: 120,
            width: 620,
            height: 480,
        },
    )?;
    wait_dom(
        app,
        "return !![...(document.querySelector('[data-testid=\"app-window-explorer\"]')?.querySelectorAll('button') ?? [])].find(b=>b.textContent.trim()==='이 PC의 파일 읽기 허용');",
        "explorer window",
    )?;
    wait_web_hidden(&browser_id, browser_place)?;
    let start = request_mark();
    allow_pc_with_native_input(app, log)?;
    let request_result = require_request(
        log,
        start,
        "UI PC access",
        |request| matches!(request, CoreRequest::FilesAllowPc { window_id, permission } if window_id == &explorer_id && permission == "pc"),
    )
    .map_err(|error| {
        format!("trusted DOM click reached the allow button but the UI did not send FilesAllowPc: {error}")
    });
    request_result?;
    wait_until("PC access", || {
        Ok(snapshot(core)?
            .device
            .pc_access
            .iter()
            .any(|access| access.app_id == "explorer" && access.permission == "pc"))
    })?;
    wait_dom(
        app,
        r#"
      const root=document.querySelector('[data-testid="app-window-explorer"]');
      return !!root?.querySelector('[role="tree"][aria-label="폴더 목록"]') &&
        !!root.querySelector('[role="listbox"] [data-folder-path="documents"]') &&
        !!root.querySelector('[role="listbox"] [data-folder-path="C"]');
    "#,
        "PC roots and C drive",
    )?;
    screen(out, log, "08-pc-icons")?;
    for path in [
        "documents",
        "documents/kaleidoscope-e2e",
        "documents/kaleidoscope-e2e/notes",
    ] {
        let selector = format!("return !!document.querySelector('[data-testid=\"app-window-explorer\"] [role=\"listbox\"] [data-folder-path=\"{path}\"]');");
        wait_dom(app, &selector, path)?;
        let script = format!(
            r#"
          const b=document.querySelector('[data-testid="app-window-explorer"] [role="listbox"] [data-folder-path="{path}"]');
          if(!b)return false;
          b.dispatchEvent(new MouseEvent('click',{{bubbles:true,detail:1}}));
          b.dispatchEvent(new MouseEvent('click',{{bubbles:true,detail:2}}));
          b.dispatchEvent(new MouseEvent('dblclick',{{bubbles:true,detail:2}})); return true;
        "#
        );
        action(app, &script, path)?;
    }
    wait_dom(app, "return !!document.querySelector('[data-testid=\"app-window-explorer\"] [data-file-path=\"documents/kaleidoscope-e2e/notes/a.md\"]') && !!document.querySelector('[data-testid=\"app-window-explorer\"] [data-file-path=\"documents/kaleidoscope-e2e/notes/b.md\"]');", "notes files")?;

    let start = request_mark();
    action(
        app,
        r#"
      const b=document.querySelector('[data-testid="app-window-explorer"] [data-file-path="documents/kaleidoscope-e2e/notes/a.md"]');
      if(!b)return false;
      b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));
      b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2})); return true;
    "#,
        "open a.md",
    )?;
    require_request(log, start, "open a.md", |request| {
        matches!(request,
            CoreRequest::FilesOpen { window_id, path, app_id, .. } if window_id == &explorer_id && path == "documents/kaleidoscope-e2e/notes/a.md" && app_id == "md-editor"
        )
    })?;
    wait_until("a.md editor state", || {
        Ok(editor_state(core, "a.md")?.is_some())
    })?;
    wait_dom(app, "const e=document.querySelector('[data-testid=\"app-window-md-editor\"] .ks-markdown-editor'); return !!e && e.textContent.includes('첫 번째 노트');", "a.md editor content")?;
    let (editor_id, count_a) = editor_state(core, "a.md")?.ok_or("a.md editor missing")?;
    let expected_parent = fs::canonicalize(fixture.0.join("notes")).map_err(|e| e.to_string())?;
    let snap = snapshot(core)?;
    let grant = snap
        .device
        .grants
        .iter()
        .find(|grant| grant.window_id == editor_id && grant.permission == "docs")
        .ok_or("editor folder grant missing")?;
    if Path::new(&grant.root_path) != expected_parent {
        return Err("editor grant is not the file parent".into());
    }
    record(
        log,
        "ui.editor.a",
        json!({"window_id": editor_id, "count": count_a, "path": "documents/kaleidoscope-e2e/notes/a.md"}),
    )?;
    screen(out, log, "09-a-md")?;

    action(
        app,
        r#"
      const w=document.querySelector('[data-testid="app-window-explorer"]'); if(!w)return false;
      w.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'mouse',isPrimary:true})); return true;
    "#,
        "raise explorer",
    )?;
    wait_until("explorer raised", || on_top(core, &explorer_id))?;
    let start = request_mark();
    action(
        app,
        r#"
      const b=document.querySelector('[data-testid="app-window-explorer"] [data-file-path="documents/kaleidoscope-e2e/notes/b.md"]');
      if(!b)return false;
      b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));
      b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2})); return true;
    "#,
        "open b.md",
    )?;
    require_request(log, start, "open b.md", |request| {
        matches!(request,
            CoreRequest::FilesOpen { window_id, path, app_id, .. } if window_id == &explorer_id && path == "documents/kaleidoscope-e2e/notes/b.md" && app_id == "md-editor"
        )
    })?;
    wait_until("b.md editor state", || {
        Ok(editor_state(core, "b.md")?.is_some())
    })?;
    wait_dom(app, "const e=document.querySelector('[data-testid=\"app-window-md-editor\"] .ks-markdown-editor'); return !!e && e.textContent.includes('두 번째 노트');", "b.md editor content")?;
    let (editor_b, count_b) = editor_state(core, "b.md")?.ok_or("b.md editor missing")?;
    if editor_b != editor_id || count_b != count_a {
        return Err(format!(
            "editor was not reused: {editor_id}/{count_a}, {editor_b}/{count_b}"
        ));
    }
    record(
        log,
        "ui.editor.b",
        json!({"window_id": editor_b, "count": count_b, "path": "documents/kaleidoscope-e2e/notes/b.md"}),
    )?;
    screen(out, log, "10-b-md")?;

    let start = request_mark();
    action(
        app,
        r#"
      const w=document.querySelector('[data-testid="app-window-e2e-web-browser"]'); if(!w)return false;
      w.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'mouse',isPrimary:true})); return true;
    "#,
        "raise browser for address",
    )?;
    wait_until("browser raised for address", || on_top(core, &browser_id))?;
    wait_place(&browser_id, start, true, log)?;
    action(
        app,
        r#"
      const input=document.querySelector('[data-testid="app-window-e2e-web-browser"] input[aria-label="주소"]');
      if(!input)return false; input.click(); return true;
    "#,
        "edit address",
    )?;
    wait_dom(app, "const i=document.querySelector('[data-testid=\"app-window-e2e-web-browser\"] input[aria-label=\"주소\"]'); return !!i && !i.readOnly;", "editable address")?;
    action(
        app,
        r#"
      const input=document.querySelector('[data-testid="app-window-e2e-web-browser"] input[aria-label="주소"]');
      if(!input||input.readOnly)return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://example.org/');
      input.dispatchEvent(new Event('input',{bubbles:true})); return true;
    "#,
        "enter address",
    )?;
    thread::sleep(Duration::from_millis(300));
    let start = request_mark();
    action(
        app,
        r#"
      const input=document.querySelector('[data-testid="app-window-e2e-web-browser"] input[aria-label="주소"]');
      if(!input)return false; input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true})); return true;
    "#,
        "submit address",
    )?;
    require_request(log, start, "UI address navigation", |request| {
        matches!(request,
            CoreRequest::WebNavigate { window_id, url } if window_id == &browser_id && url.starts_with("https://example.org")
        )
    })?;
    let page = wait_web(&events, &browser_id, "https://example.org/")?;
    wait_until("saved browser URL", || {
        Ok(snapshot(core)?.shared.windows.iter().any(|window| {
            window.id == browser_id && window.state.get("url") == Some(&json!(page.url))
        }))
    })?;
    record(
        log,
        "ui.address",
        json!({"window_id": browser_id, "web_update": page.url, "state_url": page.url}),
    )?;
    screen(out, log, "11-address")?;

    // ── 창 조작: 맨 위가 아닌 창의 최소화와 왼쪽·위쪽 가장자리 크기 조절 (실제 입력) ──
    #[cfg(windows)]
    {
        const SETTLE: &str = r#"
          const target = document.querySelector('[data-window-id="TARGET"]');
          const cover = document.querySelector('[data-window-id="COVER"]');
          if (!target || !cover) return false;
          if (target.getAttribute('data-minimized') !== 'false') return false;
          const targetFrame = target.querySelector('.ks-window-frame');
          const coverFrame = cover.querySelector('.ks-window-frame');
          return !!targetFrame && !!coverFrame
            && !targetFrame.classList.contains('ks-window-frame-active')
            && coverFrame.classList.contains('ks-window-frame-active');
        "#;

        let target_id = open(
            core,
            &desktop,
            "calculator",
            Rect {
                x: 120,
                y: 120,
                width: 480,
                height: 360,
            },
        )?;
        let cover_id = open(
            core,
            &desktop,
            "calculator",
            Rect {
                x: 760,
                y: 320,
                width: 480,
                height: 360,
            },
        )?;
        let settle = SETTLE
            .replace("TARGET", &target_id)
            .replace("COVER", &cover_id);
        wait_dom(app, &settle, "window control targets")?;
        let focus = super::native_target::focus_main_webview(app)?;
        record(log, "ui.window_controls.focus", focus)?;

        // 맨 위가 아닌 창의 최소화 단추를 실제 입력으로 10회 누른다. 회차마다 core로
        // 복원하고 다른 창을 다시 올려 대상이 늘 맨 위가 아니게 만든다. 누른 그 입력에서
        // window.raise가 나가면 안 된다.
        let mut rounds = Vec::new();
        for round in 1..=10 {
            if round > 1 {
                call(
                    core,
                    CoreRequest::WindowRestore {
                        window_id: target_id.clone(),
                    },
                )?;
                call(
                    core,
                    CoreRequest::WindowRaise {
                        window_id: cover_id.clone(),
                    },
                )?;
            }
            wait_dom(app, &settle, "minimize target restored and not top")?;
            let selector =
                format!("[data-window-id=\"{target_id}\"] [data-window-control=\"minimize\"]");
            let (x, y, bounds) = native_webview_point(
                app,
                &selector,
                &format!("minimize button round {round}"),
            )?;
            let wait = super::native_target::wait_main_webview_at(app, x, y)?;
            let mark = request_mark();
            let click = super::share_isolate::native_input::click_with_report(x, y)?;
            wait_until("minimize applied", || {
                Ok(snapshot(core)?
                    .shared
                    .windows
                    .iter()
                    .any(|window| window.id == target_id && window.minimized))
            })?;
            // 올리기 요청이 뒤늦게 도착해 창이 다시 펼쳐지는지 잠깐 더 본다.
            thread::sleep(Duration::from_millis(400));
            let snap = snapshot(core)?;
            let minimized = snap
                .shared
                .windows
                .iter()
                .find(|window| window.id == target_id)
                .map(|window| window.minimized)
                .unwrap_or(false);
            let raised: Vec<String> = requests_since(mark)
                .into_iter()
                .filter_map(|request| match request {
                    CoreRequest::WindowRaise { window_id } if window_id == target_id => {
                        Some(window_id)
                    }
                    _ => None,
                })
                .collect();
            record(
                log,
                "ui.minimize_race",
                json!({
                    "round": round, "point": {"x": x, "y": y}, "bounds": bounds, "wait": wait,
                    "click": click, "minimized": minimized, "raised": raised,
                }),
            )?;
            if !minimized {
                return Err(format!(
                    "non-top minimize click did not leave the window minimized (round {round})"
                ));
            }
            if !raised.is_empty() {
                return Err(format!(
                    "non-top minimize click raised the window (round {round}): {raised:?}"
                ));
            }
            rounds.push(json!({"round": round, "minimized": true, "raised": 0}));
        }
        record(
            log,
            "ui.minimize_race.summary",
            json!({"rounds": rounds.len(), "minimize_failures": 0, "raised": 0}),
        )?;

        // 왼쪽과 위쪽 가장자리 손잡이를 실제 입력으로 끈다. 서쪽은 오른쪽 끝, 북쪽은 아래 끝이
        // 고정되어야 한다. 드래그가 preview를 그리는 것까지 기록에 남긴다.
        call(
            core,
            CoreRequest::WindowRestore {
                window_id: target_id.clone(),
            },
        )?;
        call(
            core,
            CoreRequest::WindowRaise {
                window_id: cover_id.clone(),
            },
        )?;
        wait_dom(app, &settle, "resize target non-top")?;
        let before = window_rect(core, &target_id)?;

        let west_selector = format!("[data-window-id=\"{target_id}\"] .ks-window-resize-west");
        let (west_x, west_y, west_bounds) =
            native_webview_point(app, &west_selector, "west handle")?;
        let west_to = (west_x - 40, west_y);
        let _ = super::native_target::wait_main_webview_at(app, west_x, west_y)?;
        let mut west_preview = Value::Null;
        super::share_isolate::native_input::drag((west_x, west_y), west_to, || {
            west_preview = window_dom_rect(app, &target_id)?;
            if west_preview.is_null() {
                return Err("west resize target missing during drag".into());
            }
            Ok(())
        })?;
        wait_until("west resize committed", || {
            let rect = window_rect(core, &target_id)?;
            Ok(rect.x < before.x
                && rect.width > before.width
                && rect.x + rect.width as i32 == before.x + before.width as i32)
        })?;
        let after_west = window_rect(core, &target_id)?;
        wait_until("west resize rendered", || {
            let dom = window_dom_rect(app, &target_id)?;
            Ok((dom["x"].as_f64().unwrap_or(-1.0) - f64::from(after_west.x)).abs() <= 2.0
                && (dom["width"].as_f64().unwrap_or(-1.0) - f64::from(after_west.width)).abs()
                    <= 2.0)
        })?;

        let north_selector = format!("[data-window-id=\"{target_id}\"] .ks-window-resize-north");
        let (north_x, north_y, north_bounds) =
            native_webview_point(app, &north_selector, "north handle")?;
        let north_to = (north_x, north_y - 30);
        let _ = super::native_target::wait_main_webview_at(app, north_x, north_y)?;
        let mut north_preview = Value::Null;
        super::share_isolate::native_input::drag((north_x, north_y), north_to, || {
            north_preview = window_dom_rect(app, &target_id)?;
            if north_preview.is_null() {
                return Err("north resize target missing during drag".into());
            }
            Ok(())
        })?;
        wait_until("north resize committed", || {
            let rect = window_rect(core, &target_id)?;
            Ok(rect.y < after_west.y
                && rect.height > after_west.height
                && rect.x == after_west.x
                && rect.width == after_west.width
                && rect.y + rect.height as i32 == after_west.y + after_west.height as i32)
        })?;
        let after_north = window_rect(core, &target_id)?;
        record(
            log,
            "ui.resize_edges",
            json!({
                "window_id": target_id,
                "before": before,
                "west": {
                    "from": {"x": west_x, "y": west_y}, "to": {"x": west_to.0, "y": west_to.1},
                    "bounds": west_bounds, "preview": west_preview, "after": after_west,
                },
                "north": {
                    "from": {"x": north_x, "y": north_y}, "to": {"x": north_to.0, "y": north_to.1},
                    "bounds": north_bounds, "preview": north_preview, "after": after_north,
                },
                "opposite_ends_fixed": true,
            }),
        )?;
    }
    Ok(())
}
