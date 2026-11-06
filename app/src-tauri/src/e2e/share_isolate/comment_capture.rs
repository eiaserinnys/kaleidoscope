//! 공유하지 않는 창의 커멘트 캡처와 웹 표면 정지를 실제 쉘에서 확인한다.
use super::*;
mod pixels;

pub(in crate::e2e) fn scenario(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    log: &mut File,
) -> Result<(), String> {
    let shell = snapshot(core)?;
    let workspace = shell
        .device
        .active_workspace_id
        .ok_or("workspace missing")?;
    let desktop = shell
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("desktop missing")?
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
    let layout = query_layout(app)?;
    import_definition(
        core,
        surface_definition(A_ID, "Comment target", "#14d246", "TARGET", false),
    )?;
    import_definition(
        core,
        surface_definition(B_ID, "Comment cover", "rgb(25,65,225)", "COVER", false),
    )?;
    let target = open_window(core, &desktop, A_ID, layout.a)?;
    let cover = open_window(core, &desktop, B_ID, layout.b)?;
    let target_id = serde_json::to_string(&target).map_err(|error| error.to_string())?;
    ui::wait_dom(app, &format!("return !!window.__ksCommentCapture && !!document.querySelector('[data-testid=\\\"app-window-{A_ID}\\\"] .ks-window-content iframe');"), "comment fixture")?;
    raise(core, &cover)?;
    ui::wait_dom(app, &format!("const a=document.querySelector('[data-testid=\\\"app-window-{A_ID}\\\"]');const b=document.querySelector('[data-testid=\\\"app-window-{B_ID}\\\"]');return !!a&&!!b&&parseFloat(getComputedStyle(b).zIndex)>parseFloat(getComputedStyle(a).zIndex);"), "cover above target")?;
    if snapshot(core)?.sharing.contains(&target) {
        return Err("target unexpectedly shared".into());
    }
    thread::sleep(Duration::from_millis(500));

    let window = app.get_window("main").ok_or("main window missing")?;
    let position = window.inner_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    // 상단 글자의 LCD→회색 재래스터는 창 격리나 덮개 변화가 아니다.
    let bar = ui::evaluate(app, "const e=document.querySelector('.ks-shell-bar');if(!e)throw new Error('shell bar missing');const r=e.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height};")?;
    let bar_x = position.x + (bar["x"].as_f64().ok_or("bar x missing")? * scale).round() as i32;
    let bar_y = position.y + (bar["y"].as_f64().ok_or("bar y missing")? * scale).round() as i32;
    let bar_width = (bar["width"].as_f64().ok_or("bar width missing")? * scale).round() as i32;
    let bar_height = (bar["height"].as_f64().ok_or("bar height missing")? * scale).round() as i32;
    fs::write(out.join("protected.json"), json!({
        "client_x":position.x,"client_y":position.y,"client_width":size.width,"client_height":size.height,
        "exclude_x":bar_x,"exclude_y":bar_y,"exclude_width":bar_width,"exclude_height":bar_height
    }).to_string()).map_err(|error| error.to_string())?;
    fs::write(out.join("record.phase"), "comment-capture\n").map_err(|error| error.to_string())?;
    fs::write(out.join("record.request"), "").map_err(|error| error.to_string())?;
    wait_file(
        &out.join("record.ready"),
        "recorder ready",
        Duration::from_secs(30),
    )?;
    wait_file(
        &out.join("phase-comment-capture.ready"),
        "recorder phase",
        Duration::from_secs(30),
    )?;

    let result = (|| -> Result<(), String> {
        ui::evaluate(app, &format!("window.__ksCommentResult=null;window.__ksCommentCapture.capture({target_id},'[data-testid=\\\"app-window-{A_ID}\\\"] .ks-window-content',{{x:50,y:50,width:30,height:30}}).then(image=>window.__ksCommentResult={{image}},error=>window.__ksCommentResult={{error:String(error?.message ?? error)}});return true;"))?;
        ui::wait_dom(
            app,
            "return !!window.__ksCommentResult;",
            "comment capture result",
        )?;
        let value = ui::evaluate(app, "return window.__ksCommentResult;")?;
        if !value["error"].is_null() {
            return Err(format!("comment capture: {}", value["error"]));
        }
        let image = &value["image"];
        let bytes = STANDARD
            .decode(image["image_base64"].as_str().ok_or("image missing")?)
            .map_err(|error| error.to_string())?;
        fs::write(out.join("comment.png"), &bytes).map_err(|error| error.to_string())?;
        let rgba = image::load_from_memory(&bytes)
            .map_err(|error| error.to_string())?
            .to_rgba8();
        let green = rgba.pixels().filter(|p| p.0 == [20, 210, 70, 255]).count();
        let blue = rgba.pixels().filter(|p| p.0 == [25, 65, 225, 255]).count();
        let marker = rgba.pixels().filter(|p| p.0 == [111, 86, 154, 255]).count();
        pixels::validate(green, blue, marker)?;
        if snapshot(core)?.sharing.contains(&target) {
            return Err("capture enabled sharing".into());
        }
        if !matches!(
            call(
                core,
                CoreRequest::ShareCapture {
                    window_id: target.clone()
                }
            )?,
            CoreReply::ShareCapture { captured: false }
        ) {
            return Err("unshared capture unexpectedly allowed".into());
        }
        record(
            log,
            "check.result",
            json!({"id":"comment-capture","ok":true,"green":green,"blue":blue,"marker":marker}),
        )?;
        Ok(())
    })();
    fs::write(out.join("record.stop"), "").map_err(|error| error.to_string())?;
    result?;
    wait_file(
        &out.join("screen-frames.csv"),
        "screen frames",
        Duration::from_secs(15),
    )?;
    let frames =
        fs::read_to_string(out.join("screen-frames.csv")).map_err(|error| error.to_string())?;
    let rows: Vec<_> = frames
        .lines()
        .skip(1)
        .map(|line| line.split(',').collect::<Vec<_>>())
        .filter(|row| row.get(6) == Some(&"comment-capture"))
        .collect();
    pixels::validate_frames(&rows)?;
    record(
        log,
        "check.result",
        json!({"id":"comment-flicker","ok":true,"frames":rows.len()}),
    )?;

    let mut web: Value = serde_json::from_str(include_str!("../../../../../apps/web-browser.json"))
        .map_err(|error| error.to_string())?;
    web["id"] = json!(WEB_APP_ID);
    web["state"]["url"] = json!("https://example.com/");
    import_definition(core, web)?;
    let events = ui::track_web_events(core);
    let web_id = open_window(core, &desktop, WEB_APP_ID, layout.web)?;
    ui::wait_for_web_page(&events, &web_id, "https://example.com/")?;
    ui::wait_web_live(&web_id)?;
    let mark = ui::web_place_mark();
    let web_json = serde_json::to_string(&web_id).map_err(|error| error.to_string())?;
    ui::evaluate(app, &format!("window.__ksLeaseResult=null;window.__ksCommentCapture.suspend({web_json}).then(()=>window.__ksLeaseResult='ok',e=>window.__ksLeaseResult=String(e));return true;"))?;
    ui::wait_dom(
        app,
        "return window.__ksLeaseResult!==null;",
        "web surface lease",
    )?;
    if ui::evaluate(app, "return window.__ksLeaseResult;")? != json!("ok") {
        return Err("web surface lease failed".into());
    }
    ui::wait_web_hidden(&web_id, mark)?;
    ui::evaluate(app, "window.__ksCommentCapture.release();return true;")?;
    ui::wait_web_live(&web_id)?;
    record(
        log,
        "check.result",
        json!({"id":"comment-web-lease","ok":true}),
    )?;
    Ok(())
}
