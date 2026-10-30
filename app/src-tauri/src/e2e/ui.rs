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
      const button=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='이 PC의 파일 읽기 허용');
      if(!button)return false; button.click(); return true;
    "#,
        "allow PC access",
    )?;
    require_request(
        log,
        start,
        "UI PC access",
        |request| matches!(request, CoreRequest::FilesAllowPc { window_id, permission } if window_id == &explorer_id && permission == "pc"),
    )?;
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
    Ok(())
}
