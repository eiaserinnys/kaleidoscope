//! 정지 화면 아래 렌더링과 복원을 측정하는 전용 시나리오.
use super::*;
#[path = "freeze_native.rs"]
mod native;

fn ui(app: &AppHandle, body: &str) -> Result<Value, String> {
    let script=format!("(()=>{{try{{return JSON.stringify((()=>{{{body}}})());}}catch(e){{return JSON.stringify({{error:String(e)}});}}}})()");
    let (tx, rx) = mpsc::channel();
    app.get_webview("main")
        .ok_or("main 없음")?
        .eval_with_callback(script, move |v| {
            let _ = tx.send(v);
        })
        .map_err(|e| e.to_string())?;
    let raw = rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let text: String = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if v.get("error").is_some() {
        return Err(v.to_string());
    }
    Ok(v)
}
fn on_ui<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(isize) -> T + Send + 'static,
) -> Result<T, String> {
    let hwnd = app
        .get_window("main")
        .ok_or("main 없음")?
        .hwnd()
        .map_err(|e| e.to_string())?
        .0 as isize;
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f(hwnd));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())
}
fn frames(app: &AppHandle, n: u32) -> Result<Value, String> {
    ui(app,&format!("window.spikeDone=false; window.spikeStart=performance.now(); let n={n}; function step(){{if(--n<=0){{window.spikeMs=performance.now()-window.spikeStart;window.spikeDone=true;}}else requestAnimationFrame(step);}} requestAnimationFrame(step);return true;"))?;
    let end = Instant::now() + Duration::from_secs(5);
    while ui(app, "return window.spikeDone;")? != json!(true) {
        if Instant::now() > end {
            return Err("rAF 시간 초과".into());
        }
        thread::sleep(Duration::from_millis(2));
    }
    ui(app,"return {ms:window.spikeMs,raf:window.spikeRaf,focus:document.hasFocus(),active:document.activeElement?.id};")
}
fn capture(app: &AppHandle, out: &Path, name: &str) -> Result<u128, String> {
    use kaleidoscope_core::WebHost;
    let t = Instant::now();
    let host = super::super::web_host::TauriWebHost::new(app.clone());
    let (bytes, _) = host
        .capture_shell()
        .map_err(|e| format!("{e:?}"))?
        .ok_or("빈 캡처")?;
    fs::write(out.join(format!("{name}.png")), bytes).map_err(|e| e.to_string())?;
    Ok(t.elapsed().as_millis())
}
pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    log: &mut File,
) -> Result<(), String> {
    thread::sleep(Duration::from_secs(3));
    let snap = match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot } => snapshot,
        _ => return Err("snapshot 없음".into()),
    };
    let workspace = snap.device.active_workspace_id.ok_or("작업 없음")?;
    let desktop = snap
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("데스크톱 없음")?
        .clone();
    let code = (1..=200)
        .map(|i| format!("line {i}: const value = {i};\n"))
        .collect::<String>();
    let mut def = json!({"id":"spike-html","name":"정지 화면 시험","requires":{"blocks":10,"modules":{}},"permissions":[],"state":{},"ui":{"type":"split","direction":"row","sizes":[50,50],"children":[{"type":"html_view","value":"<html><body style='margin:0;background:rgb(17,153,51)'><div style='height:700px'>IFRAME TOP</div><div id='bottom' style='height:700px;background:rgb(51,119,170)'>IFRAME BOTTOM</div></body></html>"},{"type":"code","value":code}]}});
    call(
        core,
        CoreRequest::AppImport {
            definition_json: def.to_string(),
        },
    )?;
    call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop.clone(),
            app_id: "spike-html".into(),
            rect: Some(Rect {
                x: 40,
                y: 40,
                width: 600,
                height: 420,
            }),
        },
    )?;
    def["id"] = json!("spike-second");
    call(
        core,
        CoreRequest::AppImport {
            definition_json: def.to_string(),
        },
    )?;
    call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop.clone(),
            app_id: "spike-second".into(),
            rect: Some(Rect {
                x: 80,
                y: 80,
                width: 600,
                height: 420,
            }),
        },
    )?;
    thread::sleep(Duration::from_secs(2));
    ui(
        app,
        r#"window.spikeRaf=0;function tick(){window.spikeRaf++;requestAnimationFrame(tick);}requestAnimationFrame(tick);const a=document.querySelector('[data-testid="app-window-spike-html"]');window.spikeA=a;window.spikeC=document.querySelector('[data-testid="app-window-spike-second"]'); const b=document.createElement('div'); b.id='spikeB';b.style='position:fixed;left:20px;top:90px;width:680px;height:470px;background:rgb(221,34,102);z-index:999999'; const i=document.createElement('input');i.id='spikeInput';b.append(i); document.body.append(b);i.focus();return {iframe:!!a.querySelector('iframe'),focus:document.hasFocus(),raf:window.spikeRaf};"#,
    )?;
    frames(app, 2)?;
    ui(
        app,
        r#"const a=window.spikeA;const sc=a.querySelector('.cm-scroller');if(!sc)throw new Error('CodeMirror 없음');sc.scrollTop=450;window.spikeScroll=sc.scrollTop;const frame=a.querySelector('iframe');frame.contentWindow.postMessage({type:'ks-html-focus-comment',id:'bottom',comments:[{id:'bottom',selector:'#bottom'}]},'*');const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;canvas.style='position:absolute;left:180px;top:100px;width:100px;height:100px;z-index:5';a.append(canvas);window.spikeGL=canvas.getContext('webgl');if(window.spikeGL){const gl=window.spikeGL;function draw(){gl.clearColor(0.2,0.3333333,0.8666667,1);gl.clear(gl.COLOR_BUFFER_BIT);requestAnimationFrame(draw);}draw();}return {scroll:window.spikeScroll,webgl:!!window.spikeGL};"#,
    )?;
    thread::sleep(Duration::from_millis(1800));
    app.get_window("main")
        .ok_or("메인 창 없음")?
        .set_focus()
        .map_err(|e| e.to_string())?;
    app.get_webview("main")
        .ok_or("메인 웹뷰 없음")?
        .set_focus()
        .map_err(|e| e.to_string())?;
    record(log,"environment",ui(app,"const gl=window.spikeGL,ext=gl?.getExtension('WEBGL_debug_renderer_info');return {ua:navigator.userAgent,dpr:devicePixelRatio,width:innerWidth,height:innerHeight,webgl:!!gl,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};")?)?;
    ui(app,"const i=document.querySelector('#spikeInput');i.value='selection';i.focus();i.setSelectionRange(2,5);return true;")?;
    frames(app, 2)?;
    fs::write(out.join("record.phase"), b"setup").map_err(|e| e.to_string())?;
    fs::write(out.join("record.request"), b"").map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while !out.join("record.ready").exists() {
        if Instant::now() > deadline {
            return Err("기록기 대기 실패".into());
        }
        thread::sleep(Duration::from_millis(20));
    }
    ui(app,"window.spikeHide=(e,v)=>{e.style[window.spikeMode]=v?(window.spikeMode==='opacity'?'0':'hidden'):'';};return true;")?;
    for mode in ["visibility", "opacity"] {
        ui(app, &format!("window.spikeMode='{mode}';return true;"))?;
        for flushes in [0, 1] {
            for count in [1, 2] {
                for wait in [1, 2] {
                    let tag = format!("c{count}-f{wait}-d{flushes}-{mode}");
                    fs::write(out.join("record.phase"), tag.as_bytes())
                        .map_err(|e| e.to_string())?;
                    let total = Instant::now();
                    record(log,"focus.before",ui(app,"const i=document.querySelector('#spikeInput');i.focus();i.value='selection';i.setSelectionRange(2,5);window.spikeFocused=document.activeElement;return {active:document.activeElement?.id,selection:[i.selectionStart,i.selectionEnd]};")?)?;
                    let before = on_ui(app, |_| native::foreground())?;
                    let start = Instant::now();
                    on_ui(app, move |hwnd| {
                        native::begin_with_flush(hwnd, 5000, flushes)
                    })??;
                    let freeze = start.elapsed().as_millis();
                    let start = Instant::now();
                    let hidden=ui(app,"window.spikeHide(document.querySelector('#spikeB'),true);window.spikeA.hidden=false;return window.spikeRaf;")?;
                    let hide_ms = start.elapsed().as_millis();
                    let mut shots = Vec::new();
                    for index in 0..count {
                        ui(app, &format!("window.spikeHide(window.spikeA,{});window.spikeHide(window.spikeC,{});return true;",index!=0,index==0))?;
                        let state = frames(app, wait)?;
                        let ms = capture(app, out, &format!("{tag}-{index}"))?;
                        shots.push(json!({"state":state,"capture_ms":ms}));
                    }
                    let start = Instant::now();
                    ui(
                app,
                "window.spikeHide(document.querySelector('#spikeB'),false);window.spikeHide(window.spikeA,false);window.spikeHide(window.spikeC,false);return true;",
            )?;
                    let restored = frames(app, wait)?;
                    record(log,"focus.restored",ui(app,"const before=document.activeElement?.id;window.spikeFocused.focus({preventScroll:true});return {before,after:document.activeElement?.id,selection:[window.spikeFocused.selectionStart,window.spikeFocused.selectionEnd]};")?)?;
                    let restore_ms = start.elapsed().as_millis();
                    let start = Instant::now();
                    on_ui(app, move |_| {
                        for _ in 0..flushes {
                            native::flush();
                        }
                        native::end();
                        native::flush();
                    })?;
                    record(
                        log,
                        "freeze.measure",
                        json!({"tag":tag,"count":count,"wait":wait,"dwm_flushes":flushes,"hide_mode":mode,"wall_ms":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(),"native_parts_us":on_ui(app, |_| native::parts())?,"freeze_ms":freeze,"hide_ms":hide_ms,"raf_before":hidden,"captures":shots,"restore":restored,"restore_ms":restore_ms,"unfreeze_ms":start.elapsed().as_millis(),"total_ms":total.elapsed().as_millis(),"foreground_kept":before==on_ui(app,|_|native::foreground())?}),
                    )?;
                    thread::sleep(Duration::from_millis(300));
                }
            }
        }
    }
    fs::write(out.join("record.phase"), b"minimized").map_err(|e| e.to_string())?;
    on_ui(app, |h| native::begin(h, 5000))??;
    ui(
        app,
        "window.spikeHide(document.querySelector('#spikeB'),true);window.spikeHide(window.spikeC,true);return true;",
    )?;
    frames(app, 2)?;
    capture(app, out, "minimized-reference")?;
    record(log,"minimized.before",ui(app,"const s=window.spikeA.querySelector('.cm-scroller');return {scroll:s.scrollTop,width:s.clientWidth,height:s.clientHeight,lines:window.spikeA.querySelectorAll('.cm-line').length,webgl:!!window.spikeGL};")?)?;
    ui(
        app,
        "window.spikeHide(document.querySelector('#spikeB'),false);window.spikeHide(window.spikeA,false);window.spikeHide(window.spikeC,false);return true;",
    )?;
    frames(app, 2)?;
    on_ui(app, |_| {
        native::flush();
        native::end();
    })?;
    // DOM hidden 최소화 후 iframe 재등장을 프레임마다 측정한다.
    ui(app, "window.spikeA.hidden=true;return true;")?;
    frames(app, 2)?;
    on_ui(app, |h| native::begin(h, 5000))??;
    ui(app,"window.spikeHide(document.querySelector('#spikeB'),true);window.spikeA.hidden=false;window.spikeHide(window.spikeC,true);return true;")?;
    for n in 1..=3 {
        let state = frames(app, 1)?;
        let ms = capture(app, out, &format!("minimized-frame-{n}"))?;
        record(
            log,
            "minimized",
            json!({"frame":n,"state":state,"capture_ms":ms,"editor":ui(app,"const s=window.spikeA.querySelector('.cm-scroller');return {scroll:s.scrollTop,width:s.clientWidth,height:s.clientHeight,lines:window.spikeA.querySelectorAll('.cm-line').length};")?}),
        )?;
    }
    ui(app,"window.spikeA.hidden=true;window.spikeHide(document.querySelector('#spikeB'),false);window.spikeHide(window.spikeA,false);window.spikeHide(window.spikeC,false);return true;")?;
    frames(app, 2)?;
    on_ui(app, |_| {
        native::flush();
        native::end();
    })?;
    fs::write(out.join("record.phase"), b"retained").map_err(|e| e.to_string())?;
    // hidden의 display:none 대신 레이아웃을 유지한 최소화 대안을 같은 iframe에서 비교한다.
    on_ui(app, |h| native::begin(h, 5000))??;
    ui(app,"window.spikeHide(document.querySelector('#spikeB'),true);window.spikeA.hidden=false;window.spikeA.style.setProperty('display','flex','important');window.spikeA.style.visibility='';window.spikeA.style.opacity='1';window.spikeC.style.opacity='0';window.spikeA.querySelector('iframe').contentWindow.postMessage({type:'ks-html-focus-comment',id:'bottom',comments:[{id:'bottom',selector:'#bottom'}]},'*');return true;")?;
    thread::sleep(Duration::from_millis(1800));
    capture(app, out, "retained-reference")?;
    ui(
        app,
        "window.spikeA.hidden=true;window.spikeA.style.opacity='0';return true;",
    )?;
    frames(app, 2)?;
    ui(app,"window.spikeA.hidden=false;window.spikeA.style.opacity='1';window.spikeHide(document.querySelector('#spikeB'),true);return true;")?;
    for n in 1..=3 {
        frames(app, 1)?;
        capture(app, out, &format!("retained-frame-{n}"))?;
    }
    ui(app,"window.spikeA.hidden=true;window.spikeA.style.opacity='0';window.spikeHide(document.querySelector('#spikeB'),false);window.spikeHide(window.spikeC,false);return true;")?;
    frames(app, 2)?;
    on_ui(app, |_| {
        native::flush();
        native::end();
    })?;
    fs::write(out.join("record.phase"), b"timer").map_err(|e| e.to_string())?;
    let t = Instant::now();
    on_ui(app, |h| native::begin(h, 700))??;
    while on_ui(app, |_| native::active())? && t.elapsed() < Duration::from_secs(3) {
        thread::sleep(Duration::from_millis(10));
    }
    record(
        log,
        "timer",
        json!({"elapsed_ms":t.elapsed().as_millis(),"still_active":on_ui(app,|_|native::active())?}),
    )?;

    fs::write(out.join("record.phase"), b"input").map_err(|e| e.to_string())?;
    ui(app,"window.spikeClicks=0;document.querySelector('#spikeInput').addEventListener('pointerdown',()=>window.spikeClicks++);return true;")?;
    on_ui(app, |h| native::begin(h, 5000))??;
    let fg = on_ui(app, |_| native::foreground())?;
    on_ui(app, native::click)?;
    frames(app, 2)?;
    record(
        log,
        "input",
        json!({"ui":ui(app,"return {clicks:window.spikeClicks,focus:document.hasFocus(),active:document.activeElement?.id};")?,"foreground_kept":fg==on_ui(app, |_| native::foreground())?}),
    )?;
    on_ui(app, |_| native::end())?;

    fs::write(out.join("record.phase"), b"child").map_err(|e| e.to_string())?;
    // 화면 상태기계가 관리하지 않는 같은 호스트의 자식 웹뷰로 숨김 API 자체를 잰다.
    use kaleidoscope_core::WebHost;
    let host = super::super::web_host::TauriWebHost::new(app.clone());
    host.attach("spike-child", "https://example.com/")
        .map_err(|e| format!("{e:?}"))?;
    thread::sleep(Duration::from_secs(3));
    let child = app.get_webview("web-spike-child").ok_or("자식 없음")?;
    child.eval("document.body.style.background='rgb(17,153,51)';document.body.innerHTML='CHILD GREEN';").map_err(|e|e.to_string())?;
    thread::sleep(Duration::from_millis(200));
    for delay in [0, 16, 32, 64] {
        host.place("spike-child", None)
            .map_err(|e| format!("{e:?}"))?;
        let t = Instant::now();
        let hidden = host.capture("spike-child").map_err(|e| format!("{e:?}"))?;
        let hidden_ms = t.elapsed().as_millis();
        if let Some(bytes) = hidden.as_ref() {
            fs::write(out.join(format!("child-hidden-{delay}.png")), bytes)
                .map_err(|e| e.to_string())?;
        }
        on_ui(app, |h| native::begin(h, 5000))??;
        let t = Instant::now();
        host.place(
            "spike-child",
            Some(Rect {
                x: 50,
                y: 100,
                width: 500,
                height: 300,
            }),
        )
        .map_err(|e| format!("{e:?}"))?;
        let place_ms = t.elapsed().as_millis();
        thread::sleep(Duration::from_millis(delay));
        let t = Instant::now();
        let shown = host.capture("spike-child").map_err(|e| format!("{e:?}"))?;
        let capture_ms = t.elapsed().as_millis();
        if let Some(bytes) = shown.as_ref() {
            fs::write(out.join(format!("child-shown-{delay}.png")), bytes)
                .map_err(|e| e.to_string())?;
        }
        host.place("spike-child", None)
            .map_err(|e| format!("{e:?}"))?;
        frames(app, 2)?;
        on_ui(app, |_| {
            native::flush();
            native::end();
        })?;
        record(
            log,
            "child",
            json!({"delay_ms":delay,"hidden_ms":hidden_ms,"hidden_bytes":hidden.as_ref().map(Vec::len),"place_ms":place_ms,"capture_ms":capture_ms,"shown_bytes":shown.as_ref().map(Vec::len)}),
        )?;
    }
    host.detach("spike-child").map_err(|e| format!("{e:?}"))?;
    fs::write(out.join("record.stop"), b"").map_err(|e| e.to_string())?;
    record(log, "complete", json!({"ok":true}))
}
