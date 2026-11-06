//! 실제 WebView에서 빈 handle을 쓰는 HTTP 이진 요청을 확인한다.
use super::*;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicUsize, Ordering};

mod checks;

static REQUESTS: AtomicUsize = AtomicUsize::new(0);
static READS: AtomicUsize = AtomicUsize::new(0);

pub(super) fn observe_bytes(operation: &str) {
    match operation {
        "client.http_request" => { REQUESTS.fetch_add(1, Ordering::SeqCst); }
        "client.http_read" => { READS.fetch_add(1, Ordering::SeqCst); }
        _ => {}
    }
}

fn text(app: &AppHandle) -> Result<String, String> {
    ui::evaluate(app, "return document.querySelector('[data-testid=\"app-window-client-http-fixture\"] .ks-data-text')?.innerText ?? '';")?
        .as_str().map(str::to_owned).ok_or("HTTP 시험 글을 읽지 못함".into())
}

fn install(app: &AppHandle) -> Result<(), String> {
    let source = include_str!("client_http/client.js");
    realtime::fixture::mcp(app, "upload_asset", json!({
        "id":"client-http-fixture-client", "version":1, "format":"javascript",
        "sha256":format!("{:x}", Sha256::digest(source.as_bytes())),
        "source":"app/src-tauri/src/e2e/client_http/client.js", "license":"MIT",
        "data_base64":STANDARD.encode(source.as_bytes())
    }))?;
    let definition: Value = serde_json::from_str(include_str!("client_http/app.json")).map_err(|error| error.to_string())?;
    realtime::fixture::mcp(app, "upload_app", json!({"definition":definition, "open":false}))
}

pub(super) fn scenario(app: &AppHandle, core: &Core, _out: &Path, log: &mut File) -> Result<(), String> {
    record(log, "start", json!({"scenario":"client-http"}))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if matches!(core.handle(CoreRequest::StateGet {}), Ok(CoreReply::StateGet { snapshot, .. })
            if matches!(snapshot.link, kaleidoscope_core::kaleidoscope_contract::LinkStatus::Connected { .. })) { break; }
        if Instant::now() >= deadline { return Err("내장 서버 연결 시간 초과".into()); }
        thread::sleep(Duration::from_millis(50));
    }
    install(app)?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let desktop = loop {
        if let CoreReply::StateGet { snapshot, .. } = call(core, CoreRequest::StateGet {})? {
            if snapshot.shared.apps.iter().any(|item| item.id == "client-http-fixture") {
                let workspace = snapshot.device.active_workspace_id.ok_or("활성 작업 없음")?;
                break snapshot.device.active_desktop_ids.get(&workspace).ok_or("활성 화면 없음")?.clone();
            }
        }
        if Instant::now() >= deadline { return Err("HTTP 시험 앱 동기화 시간 초과".into()); }
        thread::sleep(Duration::from_millis(50));
    };
    let window = match call(core, CoreRequest::WindowOpen {
        desktop_id: desktop, app_id: "client-http-fixture".into(),
        rect: Some(Rect { x: 40, y: 40, width: 720, height: 500 }),
    })? {
        CoreReply::WindowOpen { window } => window.id,
        _ => return Err("창 열기 응답이 아님".into()),
    };
    let deadline = Instant::now() + Duration::from_secs(180);
    let body = loop {
        let body = text(app)?;
        if body.lines().count() >= 5 || Instant::now() >= deadline { break body; }
        thread::sleep(Duration::from_millis(50));
    };
    let requests = REQUESTS.load(Ordering::SeqCst);
    let reads = READS.load(Ordering::SeqCst);
    record(log, "client-http.result", json!({"text":body,"core_bytes_requests":requests,"core_bytes_reads":reads}))?;
    if !checks::result(&body, requests, reads) {
        return Err(format!("HTTP 시험 실패 (request={requests}, read={reads}): {body}"));
    }
    call(core, CoreRequest::WindowClose { window_id: window })?;
    record(log, "complete", json!({"ok":true}))
}
