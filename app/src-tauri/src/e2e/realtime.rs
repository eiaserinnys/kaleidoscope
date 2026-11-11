//! 실제 WebView2 → core_bytes → 코어 → 루프백 서버를 검증한다.
use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

mod checks;
pub(super) mod fixture;
mod server;

#[cfg(windows)]
pub(super) fn upload_file_drop_fixture(app: &AppHandle, source: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    fixture::mcp(
        app,
        "upload_asset",
        json!({
            "id": "file-drop-fixture-client", "version": 1, "format": "javascript",
            "sha256": format!("{:x}", Sha256::digest(source.as_bytes())),
            "source": "ui/e2e/fixtures/file-drop/client.js", "license": "MIT", "data_base64": STANDARD.encode(source.as_bytes())
        }),
    )
}

static SESSIONS: Mutex<Vec<String>> = Mutex::new(Vec::new());
static SENDS: AtomicUsize = AtomicUsize::new(0);
static READS: AtomicUsize = AtomicUsize::new(0);

pub(super) fn observe(request: &CoreRequest) {
    if let CoreRequest::RealtimeOpen { session, .. } = request {
        let mut sessions = SESSIONS.lock().unwrap();
        if sessions.last() != Some(session) {
            sessions.push(session.clone());
        }
    }
}

pub(super) fn observe_bytes(operation: &str) {
    match operation {
        "connection.realtime.send" => {
            SENDS.fetch_add(1, Ordering::SeqCst);
        }
        "connection.realtime.read" => {
            READS.fetch_add(1, Ordering::SeqCst);
        }
        _ => {}
    }
}

fn wait(label: &str, seconds: u64, condition: impl Fn() -> bool) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while !condition() {
        if Instant::now() >= deadline {
            return Err(format!("{label} 시간 초과"));
        }
        thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}

fn text(app: &AppHandle) -> Result<String, String> {
    ui::evaluate(app, "return document.querySelector('[data-testid=\"app-window-realtime-fixture\"]')?.innerText ?? '';")?
        .as_str().map(str::to_owned).ok_or("앱 글을 읽지 못함".into())
}

fn click(app: &AppHandle, label: &str) -> Result<(), String> {
    let label_json = serde_json::to_string(label).unwrap();
    let find = format!("const root=document.querySelector('[data-testid=\"app-window-realtime-fixture\"]');const b=[...(root?.querySelectorAll('button') ?? [])].find(b=>b.textContent.trim()==={label_json});");
    ui::wait_dom(app, &format!("{find}return !!b;"), label)?;
    ui::action(app, &format!("{find}if(!b)return false;b.click();return true;"), label)
}

fn roundtrip(app: &AppHandle) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let body = text(app)?;
        if checks::roundtrip(
            body.contains("문자 왕복"),
            body.contains("0,1,255"),
            SENDS.load(Ordering::SeqCst),
            READS.load(Ordering::SeqCst),
        ) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("실제 바이트 왕복 실패: {body}"));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    log: &mut File,
) -> Result<(), String> {
    record(log, "start", json!({"scenario":"realtime"}))?;
    let echo = server::Echo::start()?;
    let counts = &echo.counts;
    let mut run = || -> Result<(), String> {
        wait("내장 서버 연결", 20, || {
            matches!(core.handle(CoreRequest::StateGet {}), Ok(CoreReply::StateGet { snapshot, .. })
                if matches!(snapshot.link, kaleidoscope_core::kaleidoscope_contract::LinkStatus::Connected { .. }))
        })?;
        fixture::install(app, core, &echo.origin)?;
        let snapshot = match call(core, CoreRequest::StateGet {})? {
            CoreReply::StateGet { snapshot, .. } => snapshot,
            _ => return Err("상태 응답이 아님".into()),
        };
        let workspace = snapshot
            .device
            .active_workspace_id
            .ok_or("활성 작업 없음")?;
        let desktop = snapshot
            .device
            .active_desktop_ids
            .get(&workspace)
            .ok_or("활성 화면 없음")?
            .clone();
        let window = match call(
            core,
            CoreRequest::WindowOpen {
                desktop_id: desktop,
                app_id: "realtime-fixture".into(),
                rect: Some(Rect {
                    x: 40,
                    y: 40,
                    width: 720,
                    height: 500,
                }),
            },
        )? {
            CoreReply::WindowOpen { window } => window.id,
            _ => return Err("창 열기 응답이 아님".into()),
        };
        roundtrip(app)?;
        record(
            log,
            "realtime.roundtrip",
            json!({"text":true,"binary":true,"core_bytes_sends":SENDS.load(Ordering::SeqCst),"core_bytes_reads":READS.load(Ordering::SeqCst)}),
        )?;
        ui::wait_dom(app, "return document.querySelector('[data-testid=\"app-window-realtime-fixture\"]')?.innerText.includes('차단됨') === true;", "직접 WebSocket CSP 차단")?;
        if counts.rejected.load(Ordering::SeqCst) != 0 {
            return Err("프레임 직접 접속이 서버에 도착함".into());
        }
        record(log, "realtime.csp", json!({"blocked":true,"rejected":0}))?;
        let opened = counts.opened.load(Ordering::SeqCst);
        let closed = counts.closed.load(Ordering::SeqCst);
        call(
            core,
            CoreRequest::WindowMinimize {
                window_id: window.clone(),
            },
        )?;
        wait("최소화 뒤 TCP 종료", 5, || {
            counts.closed.load(Ordering::SeqCst) > closed
        })?;
        record(
            log,
            "realtime.minimized",
            json!({"closed":counts.closed.load(Ordering::SeqCst)}),
        )?;
        let started = Instant::now();
        call(
            core,
            CoreRequest::WindowRestore {
                window_id: window.clone(),
            },
        )?;
        wait("복원 뒤 새 접속", 2, || {
            counts.opened.load(Ordering::SeqCst) > opened
        })?;
        record(
            log,
            "realtime.restored",
            json!({"milliseconds":started.elapsed().as_millis(),"opened":counts.opened.load(Ordering::SeqCst)}),
        )?;
        let before = SESSIONS.lock().unwrap().clone();
        let opened = counts.opened.load(Ordering::SeqCst);
        let closed = counts.closed.load(Ordering::SeqCst);
        click(app, "프레임 리로드")?;
        click(app, "다시 시작")?;
        wait("리로드 뒤 새 세션과 TCP 교체", 20, || {
            checks::fresh_session(&before, &SESSIONS.lock().unwrap())
                && counts.opened.load(Ordering::SeqCst) > opened
                && counts.closed.load(Ordering::SeqCst) > closed
        })?;
        roundtrip(app)?;
        record(
            log,
            "realtime.reload",
            json!({"before":before,"after":SESSIONS.lock().unwrap().clone(),"opened":counts.opened.load(Ordering::SeqCst),"closed":counts.closed.load(Ordering::SeqCst)}),
        )?;
        fs::write(out.join("app-text.txt"), text(app)?).map_err(|e| e.to_string())?;
        screen(out, log, "01-realtime")?;
        call(core, CoreRequest::WindowClose { window_id: window })?;
        Ok(())
    };
    if let Err(error) = run() {
        let _ = fs::write(out.join("app-text.txt"), text(app).unwrap_or_default());
        record(
            log,
            "realtime.failure",
            json!({"message":error,"opened":counts.opened.load(Ordering::SeqCst),"closed":counts.closed.load(Ordering::SeqCst),"rejected":counts.rejected.load(Ordering::SeqCst),"sessions":SESSIONS.lock().unwrap().clone(),"sends":SENDS.load(Ordering::SeqCst),"reads":READS.load(Ordering::SeqCst)}),
        )?;
        let _ = screen(out, log, "99-realtime-failure");
        return Err(error);
    }
    record(log, "complete", json!({"ok":true}))
}
