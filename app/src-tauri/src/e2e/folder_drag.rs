//! 실제 Windows 포인터로 WebView2 내부 끌기를 검증한다.
use super::share_isolate::native_input;
use super::*;

mod native_windows;
mod retry;

pub(super) fn external_drop_guard(
    app: &AppHandle,
    core: &Core,
    log: &mut File,
) -> Result<(), String> {
    ui::wait_dom(
        app,
        "return !!document.querySelector('[data-testid=\\\"app-window-e2e-folder-drag\\\"]');",
        "folder drag window",
    )?;
    let result = ui::evaluate(
        app,
        r#"
        const check = (type, files) => {
            const data = new DataTransfer();
            if (files) data.items.add(new File(['test'], 'test.txt'));
            else data.setData('application/x-kaleidoscope-folder', '{}');
            const event = new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer: data});
            document.dispatchEvent(event);
            return {prevented: event.defaultPrevented, effect: data.dropEffect};
        };
        return {over: check('dragover', true), drop: check('drop', true), internal: check('dragover', false)};
    "#,
    )?;
    let passed = result["over"]["prevented"] == true
        && result["over"]["effect"] == "none"
        && result["drop"]["prevented"] == true
        && result["drop"]["effect"] == "none"
        && result["internal"]["prevented"] == false;
    if !passed {
        return Err(format!("external drop guard failed: {result}"));
    }
    record(
        log,
        "files-write.external-drop-guard",
        json!({"passed": true, "synthetic": true}),
    )?;
    let source = include_str!("../../../../ui/e2e/fixtures/file-drop/client.js");
    super::realtime::upload_file_drop_fixture(app, source)?;
    call(
        core,
        CoreRequest::AppImport {
            definition_json: include_str!("../../../../ui/e2e/fixtures/file-drop/app.json").into(),
        },
    )?;
    let snapshot = match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot, .. } => snapshot,
        reply => return Err(format!("unexpected state response: {reply:?}")),
    };
    let workspace = snapshot
        .device
        .active_workspace_id
        .ok_or("no active workspace")?;
    let desktop = snapshot
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("no active desktop")?
        .clone();
    call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop,
            app_id: "file-drop-fixture".into(),
            rect: None,
        },
    )?;
    let root = "document.querySelector('[data-testid=\\\"app-window-file-drop-fixture\\\"]')";
    ui::wait_dom(
        app,
        &format!("return {root}?.textContent.includes('준비됨');"),
        "file drop client ready",
    )?;
    let result = ui::evaluate(
        app,
        &format!(
            r#"
        const content = {root}.querySelector('.ks-window-content');
        const data = new DataTransfer(); data.items.add(new File(['abc'], 'test.txt', {{type:'text/plain'}}));
        const over = new DragEvent('dragover', {{bubbles:true, cancelable:true, dataTransfer:data}});
        content.dispatchEvent(over);
        const event = new DragEvent('drop', {{bubbles:true, cancelable:true, dataTransfer:data}});
        content.dispatchEvent(event);
        return {{prevented: event.defaultPrevented, effect: data.dropEffect, over: over.defaultPrevented}};
    "#
        ),
    )?;
    if result["prevented"] != true || result["effect"] != "copy" || result["over"] != true {
        return Err(format!("allowed synthetic drop failed: {result}"));
    }
    ui::wait_dom(
        app,
        &format!("return {root}?.textContent.includes('test.txt:97,98,99');"),
        "file drop bytes",
    )?;
    record(
        log,
        "files-write.external-drop-allowed",
        json!({"passed": true, "synthetic": true}),
    )
}

pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    folder: &Path,
    log: &mut File,
) -> Result<(), String> {
    fs::create_dir_all(folder.join("drag-destination")).map_err(|error| error.to_string())?;
    fs::write(folder.join("drag-me.md"), "drag fixture").map_err(|error| error.to_string())?;
    let definition = json!({
        "id": "e2e-folder-drag", "name": "폴더 끌기 시험",
        "requires": {"blocks": 13, "modules": {"files": 3}},
        "permissions": [{"module": "files", "id": "docs", "access": "readwrite", "label": "문서"}],
        "state": {"selected": null},
        "ui": {"type": "folder", "root": {"permission": "docs"}, "selected": {"state": "selected"}, "on_select": {"set_state": "selected"}}
    });
    call(
        core,
        CoreRequest::AppImport {
            definition_json: definition.to_string(),
        },
    )?;
    let snapshot = match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot, .. } => snapshot,
        reply => return Err(format!("unexpected state response: {reply:?}")),
    };
    let workspace = snapshot
        .device
        .active_workspace_id
        .ok_or("no active workspace")?;
    let desktop = snapshot
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("no active desktop")?
        .clone();
    let window_id = match call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop,
            app_id: "e2e-folder-drag".into(),
            rect: None,
        },
    )? {
        CoreReply::WindowOpen { window } => window.id,
        reply => return Err(format!("unexpected window response: {reply:?}")),
    };
    match call(
        core,
        CoreRequest::FilesPickFolder {
            window_id,
            permission: "docs".into(),
        },
    )? {
        CoreReply::FilesPickFolder { grant: Some(_) } => {}
        reply => return Err(format!("folder grant missing: {reply:?}")),
    }
    let query = "const root=document.querySelector('[data-testid=\\\"app-window-e2e-folder-drag\\\"]'); const rows=Array.from(root?.querySelectorAll('[role=treeitem]')??[]); const a=rows.find(e=>e.dataset.treeId==='drag-me.md'), b=rows.find(e=>e.dataset.treeId==='drag-destination');";
    ui::wait_dom(
        app,
        &format!("{query} return !!a && !!b;"),
        "folder drag rows",
    )?;
    let mut first_attempt: Option<Value> = None;
    for attempt in 0..=1 {
        ui::evaluate(app, include_str!("drag-events.js"))?;
        let bounds = ui::evaluate(app, &format!("{query} const point=e=>{{const r=e.getBoundingClientRect();return {{x:r.left+r.width/2,y:r.top+r.height/2}}}};return {{from:point(a),to:point(b)}};"))?;
        let window = app.get_window("main").ok_or("main window missing")?;
        focus_for_drag(app, log).map_err(|e| format!("{e}; first_attempt: {first_attempt:?}"))?;
        let origin = window.inner_position().map_err(|error| error.to_string())?;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let point = |name: &str| -> Result<(i32, i32), String> {
            let x = bounds[name]["x"].as_f64().ok_or("row x missing")?;
            let y = bounds[name]["y"].as_f64().ok_or("row y missing")?;
            Ok((
                origin.x + (x * scale).round() as i32,
                origin.y + (y * scale).round() as i32,
            ))
        };
        let from = point("from")?;
        let to = point("to")?;
        probe(app, core, "before_press", &bounds, from, to)?;
        native_target::wait_main_webview_at(app, from.0, from.1)?;
        let input = native_input::drag(from, to, || {
            probe(app, core, "before_release", &bounds, from, to)
        });
        let after = probe(app, core, "after_release", &bounds, from, to);
        let input = input.and(after);
        let deadline = Instant::now() + Duration::from_secs(10);
        while input.is_ok()
            && Instant::now() < deadline
            && !folder.join("drag-destination/drag-me.md").exists()
        {
            thread::sleep(Duration::from_millis(100));
        }
        let trace = ui::evaluate(app, "const t=window.__ksE2eDrag;t?.dispose();return t;")?;
        let source_exists = folder.join("drag-me.md").exists();
        let destination = folder.join("drag-destination/drag-me.md");
        let moved = !source_exists && destination.is_file();
        // 관측기가 없거나 손상된 경우를 이벤트 0개로 바꾸어 읽지 않는다.
        let no_events = trace["events"].as_array().is_some_and(Vec::is_empty)
            && trace["counts"]
                .as_object()
                .is_some_and(serde_json::Map::is_empty);
        let diagnostics = json!({"attempt": attempt + 1, "retried": attempt > 0,
            "bounds": bounds, "trace": trace, "first_attempt": first_attempt.clone()});
        record(log, "files-write.drag.trace", diagnostics.clone())?;
        if let Err(error) = input {
            return Err(format!(
                "native drag input failed: {error}; diagnostics: {diagnostics}"
            ));
        }
        if moved {
            return record(
                log,
                "files-write.drag",
                json!({"passed": true,
                "source_absent": true, "destination_exists": true,
                "retried": attempt > 0, "first_attempt": first_attempt}),
            );
        }
        if retry::allow_retry(attempt, no_events, source_exists, destination.exists()) {
            first_attempt = Some(diagnostics);
            continue;
        }
        return Err(format!(
            "native drag did not move the file; diagnostics: {diagnostics}"
        ));
    }
    Err("native drag exhausted its two attempts".into())
}

// DOM에 창 UUID가 없으므로 코어의 app_id와 z를 대조해 실제 id를 함께 남긴다.
fn probe(
    app: &AppHandle,
    core: &Core,
    stage: &str,
    bounds: &Value,
    from: (i32, i32),
    to: (i32, i32),
) -> Result<(), String> {
    let native = native_windows::capture(from, to);
    let snapshot = match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot, .. } => snapshot,
        reply => return Err(format!("unexpected probe state: {reply:?}")),
    };
    let windows = serde_json::to_string(&snapshot.shared.windows).map_err(|e| e.to_string())?;
    let stage = serde_json::to_string(stage).map_err(|e| e.to_string())?;
    ui::evaluate(
        app,
        &format!("window.__ksE2eDrag.sample({stage}, {bounds}, {windows}); window.__ksE2eDrag.samples.at(-1).native = {native}; return true;"),
    )?;
    Ok(())
}

// 최상위 창 활성화만으로는 WebView2 입력 포커스가 옮겨지지 않는다.
// 포커스 요청은 한 번만 보내고 상태를 관찰한다. 실패하면 LEFTDOWN을 보내지 않는다.
fn focus_for_drag(app: &AppHandle, log: &mut File) -> Result<(), String> {
    let started = Instant::now();
    let mut checks = 0;
    let mut unfocused_checks = 0;
    let result: Result<(), String> = (|| {
        app.get_window("main")
            .ok_or("main window missing")?
            .set_focus()
            .map_err(|e| e.to_string())?;
        app.get_webview("main")
            .ok_or("main webview missing")?
            .set_focus()
            .map_err(|e| e.to_string())?;
        loop {
            checks += 1;
            if ui::evaluate(app, "return document.hasFocus();")? == json!(true) {
                return Ok(());
            }
            unfocused_checks += 1;
            if started.elapsed() >= Duration::from_secs(10) {
                return Err("main webview did not acquire input focus within 10 seconds; drag was not attempted".into());
            }
            thread::sleep(Duration::from_millis(50));
        }
    })();
    record(
        log,
        "files-write.drag.focus",
        json!({
            "passed": result.is_ok(), "elapsed_ms": started.elapsed().as_millis(),
            "checks": checks, "unfocused_checks": unfocused_checks,
            "wait_needed": unfocused_checks > 0, "focus_requests": 1,
            "error": result.as_ref().err(),
        }),
    )?;
    result
}
