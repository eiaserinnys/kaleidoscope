//! 실제 Windows 포인터로 WebView2 내부 끌기를 검증한다.
use super::share_isolate::native_input;
use super::*;

pub(super) fn external_drop_guard(app: &AppHandle, log: &mut File) -> Result<(), String> {
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
        CoreReply::StateGet { snapshot } => snapshot,
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
    let bounds = ui::evaluate(app, &format!("{query} const point=e=>{{const r=e.getBoundingClientRect();return {{x:r.left+r.width/2,y:r.top+r.height/2}}}};return {{from:point(a),to:point(b)}};"))?;
    let window = app.get_window("main").ok_or("main window missing")?;
    window.set_focus().map_err(|error| error.to_string())?;
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
    native_input::drag(point("from")?, point("to")?)?;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && !folder.join("drag-destination/drag-me.md").exists() {
        thread::sleep(Duration::from_millis(100));
    }
    if folder.join("drag-me.md").exists() || !folder.join("drag-destination/drag-me.md").is_file() {
        return Err(format!("native drag did not move the file: {bounds}"));
    }
    record(
        log,
        "files-write.drag",
        json!({"passed": true, "source_absent": true, "destination_exists": true}),
    )
}
