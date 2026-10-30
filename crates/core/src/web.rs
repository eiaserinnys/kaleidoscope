use crate::{app_commands, error, snapshot, storage, Core, CoreState, Inner};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use kaleidoscope_contract::{
    Block, CoreError, CoreEvent, CoreReply, CoreRequest, ErrorCode, WebPage,
};
use std::time::{Duration, Instant};

pub(crate) const WEB_FOLLOW_SECS: u64 = 10;

fn web_block(block: &Block) -> Option<Option<String>> {
    let mut result = None;
    kaleidoscope_contract::data::walk_blocks(block, "", &mut |_, child| {
        if result.is_none() {
            if let Block::WebView { on_navigate, .. } = child {
                result = Some(on_navigate.as_ref().map(|s| s.set_state.clone()));
            }
        }
    });
    result
}

pub(crate) fn window_web(state: &CoreState, id: &str) -> Result<Option<String>, CoreError> {
    let window = state
        .shared
        .windows
        .iter()
        .find(|w| w.id == id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let app = state
        .shared
        .apps
        .iter()
        .find(|a| a.id == window.app_id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let definition = app_commands::definition_for(&state.shared, &app.id, app.current_version)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    web_block(&definition.ui).ok_or_else(|| error::make(ErrorCode::InvalidRequest))
}

pub(crate) fn handle(inner: &Inner, request: CoreRequest) -> Result<CoreReply, CoreError> {
    if let CoreRequest::WebDetach { window_id } = request {
        let attached = inner.web_attached.lock().unwrap().remove(&window_id);
        if attached {
            if let Some(web) = inner.host.web() {
                if let Err(e) = web.detach(&window_id) {
                    eprintln!("웹 화면 닫기 실패: {}", e.message);
                }
            }
        }
        return Ok(CoreReply::WebDetach {});
    }
    let window_id = match &request {
        CoreRequest::WebAttach { window_id, .. }
        | CoreRequest::WebPlace { window_id, .. }
        | CoreRequest::WebNavigate { window_id, .. }
        | CoreRequest::WebHistory { window_id, .. }
        | CoreRequest::WebCapture { window_id } => window_id,
        _ => unreachable!(),
    };
    window_web(&inner.state.lock().unwrap(), window_id)?;
    if let CoreRequest::WebAttach { url, .. } | CoreRequest::WebNavigate { url, .. } = &request {
        if !kaleidoscope_contract::validate::valid_web_url(url) {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
    }
    let web = inner
        .host
        .web()
        .ok_or_else(|| error::make(ErrorCode::Unavailable))?;
    match request {
        CoreRequest::WebAttach { window_id, url } => {
            let inserted = inner.web_attached.lock().unwrap().insert(window_id.clone());
            match web.attach(&window_id, &url) {
                Ok(page) => Ok(CoreReply::WebAttach { page }),
                Err(e) => {
                    if inserted {
                        inner.web_attached.lock().unwrap().remove(&window_id);
                    }
                    Err(e)
                }
            }
        }
        CoreRequest::WebPlace { window_id, bounds } => {
            web.place(&window_id, bounds)?;
            Ok(CoreReply::WebPlace {})
        }
        CoreRequest::WebNavigate { window_id, url } => {
            web.navigate(&window_id, &url)?;
            Ok(CoreReply::WebNavigate {})
        }
        CoreRequest::WebHistory { window_id, action } => {
            web.history(&window_id, action)?;
            Ok(CoreReply::WebHistory {})
        }
        CoreRequest::WebCapture { window_id } => Ok(CoreReply::WebCapture {
            image: web
                .capture(&window_id)?
                .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes))),
        }),
        _ => unreachable!(),
    }
}

impl Core {
    pub fn web_update(&self, window_id: &str, page: WebPage) {
        if !self.inner.web_attached.lock().unwrap().contains(window_id) {
            return;
        }
        let mut state = self.inner.state.lock().unwrap();
        let Ok(key) = window_web(&state, window_id) else {
            return;
        };
        let mut changed = false;
        if let Some(key) = key {
            let before = state.clone();
            let window = state
                .shared
                .windows
                .iter_mut()
                .find(|w| w.id == window_id)
                .unwrap();
            let value = serde_json::Value::String(page.url.clone());
            if window.state.get(&key) != Some(&value) {
                window.state.insert(key, value);
                window.updated_at = crate::state_commands::timestamp();
                let following = self
                    .inner
                    .web_follow
                    .lock()
                    .unwrap()
                    .get(window_id)
                    .is_some_and(|time| time.elapsed() < Duration::from_secs(WEB_FOLLOW_SECS));
                if !following {
                    crate::sync_state::mark_local_changes(&self.inner, &before.shared, &mut state);
                }
                let saved = storage::save_changed_state(
                    &self.inner.data_dir,
                    &state.shared,
                    &state.device,
                    true,
                    false,
                )
                .and_then(|()| {
                    if state.sync != before.sync {
                        crate::sync_state::save(&self.inner.data_dir, &state.sync)
                    } else {
                        Ok(())
                    }
                });
                if let Err(e) = saved {
                    *state = before;
                    eprintln!("웹 주소 저장 실패: {}", e.message);
                } else {
                    changed = true;
                }
            }
        }
        let state_event = changed.then(|| CoreEvent::StateChanged {
            snapshot: snapshot(&state),
        });
        drop(state);
        self.inner.emit(&CoreEvent::WebUpdate {
            window_id: window_id.into(),
            page,
        });
        if let Some(event) = state_event {
            self.inner.emit(&event);
        }
    }
}

pub(crate) fn record_server_navigation(inner: &Inner, before: &CoreState, after: &CoreState) {
    let mut following = inner.web_follow.lock().unwrap();
    following.retain(|id, _| after.shared.windows.iter().any(|window| window.id == *id));
    for window in &after.shared.windows {
        let Ok(Some(key)) = window_web(after, &window.id) else {
            continue;
        };
        let old_value = before
            .shared
            .windows
            .iter()
            .find(|old| old.id == window.id)
            .and_then(|old| old.state.get(&key));
        if old_value != window.state.get(&key) {
            following.insert(window.id.clone(), Instant::now());
        }
    }
}

pub(crate) fn detach_removed(inner: &Inner) {
    let ids = {
        let state = inner.state.lock().unwrap();
        let mut attached = inner.web_attached.lock().unwrap();
        let removed = attached
            .iter()
            .filter(|id| window_web(&state, id).is_err())
            .cloned()
            .collect::<Vec<_>>();
        for id in &removed {
            attached.remove(id);
        }
        removed
    };
    if let Some(web) = inner.host.web() {
        for id in ids {
            if let Err(e) = web.detach(&id) {
                eprintln!("웹 화면 닫기 실패: {}", e.message);
            }
        }
    }
}
