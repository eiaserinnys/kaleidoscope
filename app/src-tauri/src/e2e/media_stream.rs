//! 실제 최상위 WebView2에서 폴더 오디오를 재생하고 버퍼 밖으로 이동한다.
use super::*;
use kaleidoscope_core::kaleidoscope_contract::data::{MediaPlayback, MediaRef, ResourceMediaRef};
use std::collections::BTreeMap;

mod checks;

fn write_wav(path: &Path) -> Result<(), String> {
    const BYTES: u32 = 30 * 1024 * 1024;
    const RATE: u32 = 44_100;
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    file.write_all(b"RIFF").map_err(|e| e.to_string())?;
    file.write_all(&(BYTES + 36).to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(b"WAVEfmt ").map_err(|e| e.to_string())?;
    file.write_all(&16_u32.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&1_u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&2_u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&RATE.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&(RATE * 4).to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&4_u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&16_u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(b"data").map_err(|e| e.to_string())?;
    file.write_all(&BYTES.to_le_bytes())
        .map_err(|e| e.to_string())?;
    let silence = [0_u8; 64 * 1024];
    for _ in 0..BYTES as usize / silence.len() {
        file.write_all(&silence).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    folder: &Path,
    out: &Path,
    log: &mut File,
) -> Result<(), String> {
    write_wav(&folder.join("test.wav"))?;
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
            app_id: "md-editor".into(),
            rect: None,
        },
    )? {
        CoreReply::WindowOpen { window } => window.id,
        _ => return Err("창 열기 응답이 아님".into()),
    };
    match call(
        core,
        CoreRequest::FilesPickFolder {
            window_id: window.clone(),
            permission: "docs".into(),
        },
    )? {
        CoreReply::FilesPickFolder { grant: Some(_) } => {}
        _ => return Err("시험 폴더를 선택하지 못함".into()),
    }
    let media = MediaRef::Resource(ResourceMediaRef {
        permission: "docs".into(),
        path: "test.wav".into(),
        query: BTreeMap::new(),
        crop: None,
    });
    let url = match call(
        core,
        CoreRequest::DataMediaOpen {
            window_id: window,
            media,
        },
    )? {
        CoreReply::DataMediaOpen {
            playback: MediaPlayback::Stream { url, .. },
        } => url,
        _ => return Err("오디오 스트림 응답이 아님".into()),
    };
    ui::wait_dom(
        app,
        "return location.origin === 'http://tauri.localhost' && !!document.body;",
        "최상위 쉘 로드",
    )?;
    record(log, "media-stream.shell_ready", json!({}))?;
    let script = r#"
      const url = MEDIA_URL;
      const state = window.__ksMediaStream = {seeked:false, started:false, progress:false, errors:[], console:[], bufferedBeforeSeek:0, target:0, time:0, origin:location.origin};
      const clean = value => String(value).replaceAll(url, '[미디어 주소]');
      const previousError = console.error;
      console.error = (...args) => { state.console.push(args.map(clean).join(' ')); previousError.apply(console, args); };
      window.addEventListener('error', event => state.errors.push(clean(event.message)));
      window.addEventListener('unhandledrejection', event => state.errors.push(clean(event.reason)));
      window.addEventListener('securitypolicyviolation', event => state.errors.push('CSP ' + event.violatedDirective + ' ' + clean(event.blockedURI)));
      const audio = document.createElement('audio');
      audio.crossOrigin = 'anonymous';
      audio.preload = 'metadata';
      audio.addEventListener('error', () => state.errors.push('media error ' + (audio.error?.code ?? 'unknown')));
      audio.addEventListener('loadedmetadata', () => {
        audio.play().catch(error => state.errors.push(clean(error)));
      }, {once:true});
      audio.addEventListener('timeupdate', () => {
        state.time = audio.currentTime;
        if (!state.started && audio.currentTime > 0) {
          state.started = true;
          state.bufferedBeforeSeek = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
          state.target = Math.max(0, audio.duration - 4);
          state.unbuffered = state.bufferedBeforeSeek < state.target;
          audio.currentTime = state.target;
        } else if (state.seeked && audio.currentTime > state.target + 0.1) {
          state.progress = true;
        }
      });
      audio.addEventListener('seeked', () => { state.seeked = true; });
      audio.src = url;
      document.body.append(audio);
      return true;
    "#.replace("MEDIA_URL", &serde_json::to_string(&url).map_err(|e| e.to_string())?);
    ui::evaluate(app, &script)?;
    record(log, "media-stream.script_installed", json!({}))?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let result = loop {
        let Some(state) = ui::try_evaluate(app, "return window.__ksMediaStream ?? null;")? else {
            if Instant::now() >= deadline {
                break json!({"passed":false,"webview":Value::Null,"requests":core.media_stream_observations()});
            }
            thread::sleep(Duration::from_millis(100));
            continue;
        };
        let observations = core.media_stream_observations();
        let done = checks::passed(
            state["seeked"] == true,
            state["progress"] == true,
            state["unbuffered"] == true,
            &observations,
        );
        let failed = state["errors"]
            .as_array()
            .is_some_and(|errors| !errors.is_empty());
        if done || failed || Instant::now() >= deadline {
            break json!({"passed":done,"webview":state,"requests":observations});
        }
        thread::sleep(Duration::from_millis(100));
    };
    fs::write(
        out.join("media-stream-results.json"),
        serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    record(log, "media-stream.result", result.clone())?;
    if result["passed"] != true {
        return Err("WebView2 미디어 재생 또는 범위 이동에 실패했습니다. media-stream-results.json을 확인하세요.".into());
    }
    record(
        log,
        "complete",
        json!({"scenario":"media-stream", "passed":true, "eval_timeouts": ui::eval_timeouts()}),
    )
}
