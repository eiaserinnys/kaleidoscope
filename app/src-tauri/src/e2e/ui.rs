use super::*;
use std::sync::Mutex;

mod driver;
use driver::{
    action, editor_state, on_top, open, request_mark, require_request, snapshot, wait_dom,
    wait_place, wait_until, wait_web, WebEvents,
};

pub(super) fn observe(request: &CoreRequest) {
    driver::observe(request);
}

pub(super) fn run(app: &AppHandle, core: &Core, out: &Path, log: &mut File) -> Result<(), String> {
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
        serde_json::from_str(include_str!("../../../../examples/web-browser.json"))
            .map_err(|error| error.to_string())?;
    browser["state"]["url"] = json!("https://example.com/");
    for definition in [
        browser.to_string(),
        include_str!("../../../../examples/explorer.json").into(),
        include_str!("../../../../examples/md-editor.json").into(),
    ] {
        call(
            core,
            CoreRequest::AppImport {
                definition_json: definition,
            },
        )?;
    }
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
        "web-browser",
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
    wait_dom(app, "return !!document.querySelector('[data-testid=\"app-window-web-browser\"] [data-ks-web-surface]') && !document.querySelector('.ks-web-frozen-image');", "live browser")?;
    screen(out, log, "04-ui-live")?;

    let start = request_mark();
    action(app, "const b=document.querySelector('.ks-workspace-control button'); if(!b)return false; b.click(); return true;", "open workspace menu")?;
    wait_dom(
        app,
        r#"
      const menu=document.querySelector('[role=menu]'); const surface=document.querySelector('[data-testid="app-window-web-browser"] [data-ks-web-surface]');
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
      const surface=document.querySelector('[data-testid="app-window-web-browser"] [data-ks-web-surface]');
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
      const surface=document.querySelector('[data-testid="app-window-web-browser"] [data-ks-web-surface]');
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
        "return !!document.querySelector('[data-testid=\"app-window-explorer\"]');",
        "explorer window",
    )?;
    let start = request_mark();
    action(
        app,
        r#"
      const root=document.querySelector('[data-testid="app-window-explorer"]');
      const button=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='볼 폴더 고르기');
      if(!button)return false; button.click(); return true;
    "#,
        "pick folder",
    )?;
    require_request(log, start, "UI folder selection", |request| {
        matches!(request,
            CoreRequest::FilesPickFolder { window_id, permission } if window_id == &explorer_id && permission == "folder"
        )
    })?;
    wait_until("explorer grant", || {
        Ok(snapshot(core)?
            .device
            .grants
            .iter()
            .any(|grant| grant.window_id == explorer_id && grant.permission == "folder"))
    })?;
    wait_dom(
        app,
        r#"
      const root=document.querySelector('[data-testid="app-window-explorer"]');
      const tree=root?.querySelector('[role="tree"][aria-label="폴더 목록"]');
      return !!tree && [...tree.querySelectorAll('button')].some(b=>b.textContent.trim()==='notes');
    "#,
        "notes directory",
    )?;
    action(
        app,
        r#"
      const root=document.querySelector('[data-testid="app-window-explorer"]');
      const tree=root.querySelector('[role="tree"][aria-label="폴더 목록"]');
      const button=[...tree.querySelectorAll('button')].find(b=>b.textContent.trim()==='notes');
      if(!button)return false; button.click(); return true;
    "#,
        "expand notes",
    )?;
    wait_dom(app, "return !!document.querySelector('[data-testid=\"app-window-explorer\"] [data-file-path=\"notes/a.md\"]') && !!document.querySelector('[data-testid=\"app-window-explorer\"] [data-file-path=\"notes/b.md\"]');", "notes files")?;

    let start = request_mark();
    action(
        app,
        r#"
      const b=document.querySelector('[data-testid="app-window-explorer"] [data-file-path="notes/a.md"]');
      if(!b)return false;
      b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));
      b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2})); return true;
    "#,
        "open a.md",
    )?;
    require_request(log, start, "open a.md", |request| {
        matches!(request,
            CoreRequest::FilesOpen { window_id, path, app_id, .. } if window_id == &explorer_id && path == "notes/a.md" && app_id == "md-editor"
        )
    })?;
    wait_until("a.md editor state", || {
        Ok(editor_state(core, "notes/a.md")?.is_some())
    })?;
    wait_dom(app, "const e=document.querySelector('[data-testid=\"app-window-md-editor\"] .ks-markdown-editor'); return !!e && e.textContent.includes('첫 번째 노트');", "a.md editor content")?;
    let (editor_id, count_a) = editor_state(core, "notes/a.md")?.ok_or("a.md editor missing")?;
    record(
        log,
        "ui.editor.a",
        json!({"window_id": editor_id, "count": count_a, "path": "notes/a.md"}),
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
      const b=document.querySelector('[data-testid="app-window-explorer"] [data-file-path="notes/b.md"]');
      if(!b)return false;
      b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));
      b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2})); return true;
    "#,
        "open b.md",
    )?;
    require_request(log, start, "open b.md", |request| {
        matches!(request,
            CoreRequest::FilesOpen { window_id, path, app_id, .. } if window_id == &explorer_id && path == "notes/b.md" && app_id == "md-editor"
        )
    })?;
    wait_until("b.md editor state", || {
        Ok(editor_state(core, "notes/b.md")?.is_some())
    })?;
    wait_dom(app, "const e=document.querySelector('[data-testid=\"app-window-md-editor\"] .ks-markdown-editor'); return !!e && e.textContent.includes('두 번째 노트');", "b.md editor content")?;
    let (editor_b, count_b) = editor_state(core, "notes/b.md")?.ok_or("b.md editor missing")?;
    if editor_b != editor_id || count_b != count_a {
        return Err(format!(
            "editor was not reused: {editor_id}/{count_a}, {editor_b}/{count_b}"
        ));
    }
    record(
        log,
        "ui.editor.b",
        json!({"window_id": editor_b, "count": count_b, "path": "notes/b.md"}),
    )?;
    screen(out, log, "10-b-md")?;

    let start = request_mark();
    action(
        app,
        r#"
      const w=document.querySelector('[data-testid="app-window-web-browser"]'); if(!w)return false;
      w.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'mouse',isPrimary:true})); return true;
    "#,
        "raise browser for address",
    )?;
    wait_until("browser raised for address", || on_top(core, &browser_id))?;
    wait_place(&browser_id, start, true, log)?;
    action(
        app,
        r#"
      const input=document.querySelector('[data-testid="app-window-web-browser"] input[aria-label="주소"]');
      if(!input)return false; input.click(); return true;
    "#,
        "edit address",
    )?;
    wait_dom(app, "const i=document.querySelector('[data-testid=\"app-window-web-browser\"] input[aria-label=\"주소\"]'); return !!i && !i.readOnly;", "editable address")?;
    action(
        app,
        r#"
      const input=document.querySelector('[data-testid="app-window-web-browser"] input[aria-label="주소"]');
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
      const input=document.querySelector('[data-testid="app-window-web-browser"] input[aria-label="주소"]');
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
    Ok(())
}
