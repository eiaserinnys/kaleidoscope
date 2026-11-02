use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Cursor;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use image::{imageops::FilterType, DynamicImage, ImageFormat, RgbaImage};
use kaleidoscope_contract::registry::ShareUpload;
use kaleidoscope_contract::{
    conversation::ConversationUpload, CoreError, CoreReply, ErrorCode, LinkStatus,
    SentShareContext, SharedState, VisibleView, AGENT_ATTACHMENTS_MAX,
    AGENT_ATTACHMENTS_TOTAL_MAX_BYTES, AGENT_ATTACHMENT_MAX_BYTES, SHARE_CAPTURE_MAX_EDGE,
    SHARE_CAPTURE_NAME_PREFIX, SHARE_TEXT_MAX_BYTES,
};
use sha2::{Digest, Sha256};

use crate::error;
use crate::storage::LinkFile;
use crate::{CoreState, Inner};
use kaleidoscope_contract::conversation::{ConversationItem, ConversationItemKind};

const SHARE_IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;
const SHARE_IMAGE_MAX_BASE64_BYTES: u64 = ((SHARE_IMAGE_MAX_BYTES + 2) / 3) * 4;

pub(crate) struct IsolatedCapture {
    bytes: Vec<u8>,
    crop: Option<(kaleidoscope_contract::Rect, f64)>,
}

#[derive(Clone, Default, PartialEq)]
pub(crate) struct ShareState {
    pub(crate) active_shares: HashSet<String>,
    views: HashMap<String, VisibleView>,
    uploaded: HashMap<String, ShareUpload>,
    pending_deletes: HashSet<String>,
}

pub(crate) fn shared_window_order(shared: &SharedState) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut order = Vec::new();
    for desktop in &shared.desktops {
        for id in &desktop.sharing {
            if shared
                .windows
                .iter()
                .any(|window| window.id == *id && window.desktop_id == desktop.id)
                && seen.insert(id.clone())
            {
                order.push(id.clone());
            }
        }
    }
    order
}

pub(crate) fn shared_window_ids(shared: &SharedState) -> HashSet<String> {
    shared_window_order(shared).into_iter().collect()
}

fn is_sharing(state: &CoreState, window_id: &str) -> bool {
    let Some(window) = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)
    else {
        return false;
    };
    state.shared.desktops.iter().any(|desktop| {
        desktop.id == window.desktop_id && desktop.sharing.iter().any(|id| id == window_id)
    })
}

fn persist_shared_change(
    inner: &Inner,
    before: &CoreState,
    state: &mut CoreState,
) -> Result<bool, CoreError> {
    if before.shared == state.shared {
        return Ok(false);
    }
    crate::sync_state::mark_local_changes(inner, &before.shared, state);
    inner.save_state_locked(state, true, false, before.sync != state.sync)?;
    Ok(true)
}

pub(crate) fn prepare_text(
    inner: &Inner,
    workspace: &str,
    conversation: &str,
) -> Option<(String, BTreeMap<String, kaleidoscope_data::share::SentView>)> {
    let state = inner.state.lock().unwrap();
    let mut sent = BTreeMap::new();
    for desktop in state
        .shared
        .desktops
        .iter()
        .filter(|desktop| desktop.workspace_id == workspace)
    {
        if let Some(contexts) = desktop.last_sent_context.get(conversation) {
            for (id, context) in contexts {
                if let (Some(app_name), Some(text)) = (&context.app_name, &context.text) {
                    sent.insert(
                        id.clone(),
                        kaleidoscope_data::share::SentView {
                            app_name: app_name.clone(),
                            text: text.clone(),
                        },
                    );
                }
            }
        }
    }
    let views = state
        .shared
        .desktops
        .iter()
        .filter(|desktop| desktop.workspace_id == workspace)
        .flat_map(|desktop| {
            desktop.sharing.iter().filter_map(|id| {
                let alive = state
                    .shared
                    .windows
                    .iter()
                    .any(|window| window.id == *id && window.desktop_id == desktop.id);
                if !alive {
                    return None;
                }
                if let Some(view) = state.share.views.get(id) {
                    let upload = share_upload(&state, id, view)?;
                    return Some(kaleidoscope_data::share::View {
                        window_id: id.clone(),
                        app_name: upload.app_name,
                        text: upload.text,
                    });
                }
                sent.get(id).map(|previous| kaleidoscope_data::share::View {
                    window_id: id.clone(),
                    app_name: previous.app_name.clone(),
                    text: previous.text.clone(),
                })
            })
        })
        .collect::<Vec<_>>();
    kaleidoscope_data::share::build_share_block(&views, &sent)
}

pub(crate) fn strip_legacy_share_from_item(item: &mut ConversationItem) {
    if item.kind == ConversationItemKind::User {
        item.text = kaleidoscope_data::share::strip_legacy_share_block(&item.text);
    }
}

pub(crate) fn mark_sent_text(
    inner: &Inner,
    conversation: &str,
    sent: BTreeMap<String, kaleidoscope_data::share::SentView>,
) {
    let mut state = inner.state.lock().unwrap();
    let before = state.clone();
    let window_desktops: HashMap<_, _> = state
        .shared
        .windows
        .iter()
        .map(|window| (window.id.clone(), window.desktop_id.clone()))
        .collect();
    for desktop in &mut state.shared.desktops {
        let sent_for_desktop: BTreeMap<_, _> = sent
            .iter()
            .filter(|(id, _)| {
                window_desktops.get(*id) == Some(&desktop.id)
                    || desktop.sharing.iter().any(|sharing| sharing == *id)
                    || desktop
                        .last_sent_context
                        .get(conversation)
                        .is_some_and(|contexts| contexts.contains_key(*id))
            })
            .map(|(id, value)| (id.clone(), value.clone()))
            .collect();
        let previous = desktop.last_sent_context.get(conversation).cloned();
        if sent_for_desktop.is_empty() && previous.is_none() {
            continue;
        }
        let contexts = desktop
            .last_sent_context
            .entry(conversation.to_owned())
            .or_default();
        let sent_ids: HashSet<_> = sent_for_desktop.keys().map(String::as_str).collect();
        for (id, context) in contexts.iter_mut() {
            if !sent_ids.contains(id.as_str()) {
                context.app_name = None;
                context.text = None;
            }
        }
        contexts.retain(|_, context| !empty_context(context));
        for (id, view) in sent_for_desktop {
            let context = contexts.entry(id).or_default();
            context.app_name = Some(view.app_name);
            context.text = Some(view.text);
        }
        if contexts.is_empty() {
            desktop.last_sent_context.remove(conversation);
        }
        if desktop.last_sent_context.get(conversation) != previous.as_ref() {
            desktop.updated_at = crate::state_commands::timestamp();
        }
    }
    match persist_shared_change(inner, &before, &mut state) {
        Ok(true) => inner.layout_signal.notify(),
        Ok(false) => {}
        Err(error) => {
            *state = before;
            eprintln!(
                "같이 보기 전송 기준을 저장하지 못했습니다: {}",
                error.message
            );
        }
    }
}

fn empty_context(context: &SentShareContext) -> bool {
    context.app_name.is_none() && context.text.is_none() && context.visual_hash.is_none()
}

pub(crate) fn set(
    inner: &std::sync::Arc<Inner>,
    window_id: &str,
    on: bool,
) -> Result<CoreReply, CoreError> {
    let (event, delete) = {
        let mut state = inner.state.lock().unwrap();
        let desktop_id = state
            .shared
            .windows
            .iter()
            .find(|window| window.id == window_id)
            .map(|window| window.desktop_id.clone())
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let desktop_index = state
            .shared
            .desktops
            .iter()
            .position(|desktop| desktop.id == desktop_id)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let was_on = state.shared.desktops[desktop_index]
            .sharing
            .iter()
            .any(|id| id == window_id);
        if was_on == on {
            return Ok(CoreReply::ShareSet {});
        }
        let before = state.clone();
        let desktop = &mut state.shared.desktops[desktop_index];
        if on {
            desktop.sharing.push(window_id.to_owned());
            desktop.updated_at = crate::state_commands::timestamp();
            state.share.active_shares.insert(window_id.to_owned());
        } else {
            desktop.sharing.retain(|id| id != window_id);
            for contexts in desktop.last_sent_context.values_mut() {
                if let Some(context) = contexts.get_mut(window_id) {
                    context.visual_hash = None;
                }
                contexts.retain(|_, context| !empty_context(context));
            }
            desktop
                .last_sent_context
                .retain(|_, contexts| !contexts.is_empty());
            desktop.updated_at = crate::state_commands::timestamp();
            state.share.active_shares.remove(window_id);
            state.share.views.remove(window_id);
            state.share.uploaded.remove(window_id);
            state.share.pending_deletes.insert(window_id.to_owned());
        }
        if let Err(error) = persist_shared_change(inner, &before, &mut state) {
            *state = before;
            return Err(error);
        }
        (Some(inner.state_event_locked(&state)), !on)
    };
    if delete {
        delete_pending(inner, window_id);
    }
    if let Some(event) = event {
        inner.emit_state(&event);
    }
    Ok(CoreReply::ShareSet {})
}

pub(crate) fn view(
    inner: &Inner,
    window_id: &str,
    view: VisibleView,
) -> Result<CoreReply, CoreError> {
    let upload = {
        let mut state = inner.state.lock().unwrap();
        if !state
            .shared
            .windows
            .iter()
            .any(|window| window.id == window_id)
        {
            return Err(error::make(ErrorCode::NotFound));
        }
        if !is_sharing(&state, window_id) {
            return Ok(CoreReply::ShareView {});
        }
        if view.text.len() > SHARE_TEXT_MAX_BYTES
            || view
                .image_base64
                .as_ref()
                .is_some_and(|image| image.len() as u64 > SHARE_IMAGE_MAX_BASE64_BYTES)
        {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        state.share.views.insert(window_id.to_owned(), view.clone());
        if !connected(inner, &state)
            || state
                .share
                .uploaded
                .get(window_id)
                .is_some_and(|last| last.text == view.text && last.visual == view.visual)
        {
            None
        } else {
            share_upload(&state, window_id, &view).map(|upload| (upload, link_file(inner)))
        }
    };
    if let Some((upload, Some(link_file))) = upload {
        post_share(inner, window_id, upload, &link_file, false);
    }
    Ok(CoreReply::ShareView {})
}

pub(crate) fn freeze(inner: &Inner) -> CoreReply {
    inner.isolated_captures.lock().unwrap().clear();
    let frozen = match inner.host.web().map(|web| web.freeze()) {
        Some(Ok(frozen)) => frozen,
        Some(Err(error)) => {
            eprintln!("같이 보기 화면 고정 실패: {}", error.message);
            false
        }
        None => false,
    };
    CoreReply::ShareFreeze { frozen }
}

pub(crate) fn capture(inner: &Inner, window_id: &str) -> Result<CoreReply, CoreError> {
    let (bounds, has_web) = {
        let state = inner.state.lock().unwrap();
        let view = state.share.views.get(window_id);
        if !is_sharing(&state, window_id) || !view.is_some_and(|view| view.visual) {
            return Ok(CoreReply::ShareCapture { captured: false });
        }
        let view = view.unwrap();
        let Some(has_web) = window_has_web(&state, window_id) else {
            return Ok(CoreReply::ShareCapture { captured: false });
        };
        (view.bounds, has_web)
    };
    let Some(web) = inner.host.web() else {
        return Ok(CoreReply::ShareCapture { captured: false });
    };
    let (bytes, crop) = if has_web {
        let Some(bytes) = web.capture(window_id)? else {
            return Ok(CoreReply::ShareCapture { captured: false });
        };
        (bytes, None)
    } else {
        let Some((bytes, scale)) = web.capture_shell()? else {
            return Ok(CoreReply::ShareCapture { captured: false });
        };
        (bytes, Some((bounds, scale)))
    };
    inner
        .isolated_captures
        .lock()
        .unwrap()
        .insert(window_id.to_owned(), IsolatedCapture { bytes, crop });
    Ok(CoreReply::ShareCapture { captured: true })
}

pub(crate) fn unfreeze(inner: &Inner) -> CoreReply {
    if let Some(web) = inner.host.web() {
        if let Err(error) = web.unfreeze() {
            eprintln!("같이 보기 화면 고정 해제 실패: {}", error.message);
        }
    }
    CoreReply::ShareUnfreeze {}
}

fn window_has_web(state: &CoreState, window_id: &str) -> Option<bool> {
    let window = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)?;
    let app = state
        .shared
        .apps
        .iter()
        .find(|app| app.id == window.app_id)?;
    let definition =
        crate::app_commands::definition_for(&state.shared, &app.id, app.current_version)?;
    let mut has_web = false;
    kaleidoscope_contract::data::walk_blocks(&definition.ui, "", &mut |_, child| {
        if matches!(child, kaleidoscope_contract::Block::WebView { .. }) {
            has_web = true;
        }
    });
    Some(has_web)
}

fn connected(inner: &Inner, state: &CoreState) -> bool {
    matches!(state.link, LinkStatus::Connected { .. }) && inner.link_file.lock().unwrap().is_some()
}

fn link_file(inner: &Inner) -> Option<LinkFile> {
    inner.link_file.lock().unwrap().clone()
}

fn share_upload(state: &CoreState, window_id: &str, view: &VisibleView) -> Option<ShareUpload> {
    let window = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == window_id)?;
    let desktop = state
        .shared
        .desktops
        .iter()
        .find(|desktop| desktop.id == window.desktop_id)?;
    let app = state
        .shared
        .apps
        .iter()
        .find(|app| app.id == window.app_id)?;
    let definition =
        crate::app_commands::definition_for(&state.shared, &app.id, app.current_version)?;
    Some(ShareUpload {
        workspace_id: desktop.workspace_id.clone(),
        app_name: definition.name,
        text: view.text.clone(),
        visual: view.visual,
    })
}

fn post_share(inner: &Inner, window_id: &str, upload: ShareUpload, file: &LinkFile, force: bool) {
    if !force {
        let unchanged = inner
            .state
            .lock()
            .unwrap()
            .share
            .uploaded
            .get(window_id)
            .is_some_and(|last| last.text == upload.text && last.visual == upload.visual);
        if unchanged {
            return;
        }
    }
    if inner
        .registry
        .put_share(&file.server_url, &file.token, window_id, &upload)
        .is_ok()
    {
        let mut state = inner.state.lock().unwrap();
        if is_sharing(&state, window_id)
            && state
                .share
                .views
                .get(window_id)
                .is_some_and(|view| view.text == upload.text && view.visual == upload.visual)
        {
            state.share.uploaded.insert(window_id.to_owned(), upload);
        }
    }
}

fn delete_pending(inner: &Inner, window_id: &str) {
    let file = {
        let state = inner.state.lock().unwrap();
        if !connected(inner, &state) {
            return;
        }
        link_file(inner)
    };
    let Some(file) = file else { return };
    if inner
        .registry
        .delete_share(&file.server_url, &file.token, window_id)
        .is_ok()
    {
        inner
            .state
            .lock()
            .unwrap()
            .share
            .pending_deletes
            .remove(window_id);
    }
}

pub(crate) fn state_changed(inner: &Inner) {
    let removed = {
        let mut state = inner.state.lock().unwrap();
        let live = shared_window_ids(&state.shared);
        let removed: Vec<_> = state
            .share
            .active_shares
            .difference(&live)
            .cloned()
            .collect();
        for id in &removed {
            state.share.views.remove(id);
            state.share.uploaded.remove(id);
            state.share.pending_deletes.insert(id.clone());
        }
        state.share.active_shares = live;
        removed
    };
    for id in removed {
        delete_pending(inner, &id);
    }
}

pub(crate) fn on_connected(inner: &Inner) {
    let (deletes, uploads, file) = {
        let state = inner.state.lock().unwrap();
        let file = if connected(inner, &state) {
            link_file(inner)
        } else {
            None
        };
        let uploads = shared_window_ids(&state.shared)
            .iter()
            .filter_map(|id| {
                state.share.views.get(id).and_then(|view| {
                    share_upload(&state, id, view).map(|upload| (id.clone(), upload))
                })
            })
            .collect::<Vec<_>>();
        (
            state
                .share
                .pending_deletes
                .iter()
                .cloned()
                .collect::<Vec<_>>(),
            uploads,
            file,
        )
    };
    let Some(file) = file else { return };
    for id in deletes {
        if inner
            .registry
            .delete_share(&file.server_url, &file.token, &id)
            .is_ok()
        {
            inner
                .state
                .lock()
                .unwrap()
                .share
                .pending_deletes
                .remove(&id);
        }
    }
    for (id, upload) in uploads {
        post_share(inner, &id, upload, &file, true);
    }
}

pub(crate) fn clear_server_before_unlink(inner: &Inner) {
    let (ids, file) = {
        let state = inner.state.lock().unwrap();
        (
            shared_window_ids(&state.shared)
                .into_iter()
                .collect::<Vec<_>>(),
            link_file(inner),
        )
    };
    if let Some(file) = file {
        for id in ids {
            let _ = inner
                .registry
                .delete_share(&file.server_url, &file.token, &id);
        }
    }
}

pub(crate) fn capture_for_send(
    inner: &Inner,
    workspace_id: &str,
    conversation: &str,
    existing: &[ConversationUpload],
) -> (Vec<ConversationUpload>, Vec<(String, String)>) {
    let candidates = {
        let state = inner.state.lock().unwrap();
        let active_workspace = state.device.active_workspace_id.clone();
        let active_desktop = state.device.active_desktop_ids.get(workspace_id).cloned();
        if active_workspace.as_deref() != Some(workspace_id) {
            Vec::new()
        } else {
            state
                .shared
                .desktops
                .iter()
                .find(|desktop| {
                    Some(desktop.id.as_str()) == active_desktop.as_deref()
                        && desktop.workspace_id == workspace_id
                })
                .into_iter()
                .flat_map(|desktop| desktop.sharing.iter())
                .filter_map(|id| {
                    let window = state.shared.windows.iter().find(|window| {
                        &window.id == id
                            && Some(window.desktop_id.as_str()) == active_desktop.as_deref()
                    })?;
                    let view = state.share.views.get(id)?;
                    if !view.visual {
                        return None;
                    }
                    let has_web = window_has_web(&state, id)?;
                    let upload = share_upload(&state, id, view)?;
                    Some((
                        id.clone(),
                        view.bounds,
                        upload.app_name,
                        has_web,
                        view.occluded,
                        view.image_base64.clone(),
                        state
                            .shared
                            .desktops
                            .iter()
                            .find(|desktop| desktop.id == window.desktop_id)?
                            .last_sent_context
                            .get(conversation)
                            .and_then(|contexts| contexts.get(id))
                            .and_then(|context| context.visual_hash.clone()),
                    ))
                })
                .collect::<Vec<_>>()
        }
    };
    let mut attachments = existing.to_vec();
    let mut total = 0u64;
    for attachment in existing {
        let Ok(bytes) = STANDARD.decode(&attachment.data_base64) else {
            return (attachments, Vec::new());
        };
        if bytes.len() as u64 > AGENT_ATTACHMENT_MAX_BYTES {
            return (attachments, Vec::new());
        }
        total = total.saturating_add(bytes.len() as u64);
    }
    if total > AGENT_ATTACHMENTS_TOTAL_MAX_BYTES {
        return (attachments, Vec::new());
    }
    let web = inner.host.web();
    let mut sent = Vec::new();
    for (id, bounds, app_name, has_web, occluded, image_base64, previous_hash) in candidates {
        if attachments.len() >= AGENT_ATTACHMENTS_MAX {
            break;
        }
        let isolated = inner.isolated_captures.lock().unwrap().remove(&id);
        let png = if let Some(capture) = isolated {
            prepare_png(&capture.bytes, capture.crop).or_else(|| {
                eprintln!("같이 보기 격리 PNG를 처리하지 못했습니다.");
                None
            })
        } else if !occluded {
            web.and_then(|web| {
                if has_web {
                    match web.capture(&id) {
                        Ok(Some(bytes)) => prepare_png(&bytes, None).or_else(|| {
                            eprintln!("같이 보기 웹 화면 PNG를 처리하지 못했습니다.");
                            None
                        }),
                        Ok(None) => {
                            eprintln!("같이 보기 웹 화면 캡처가 비었습니다.");
                            None
                        }
                        Err(error) => {
                            eprintln!("같이 보기 모습 캡처 실패: {}", error.message);
                            None
                        }
                    }
                } else {
                    match web.capture_shell() {
                        Ok(Some((bytes, scale))) => prepare_png(&bytes, Some((bounds, scale)))
                            .or_else(|| {
                                eprintln!("같이 보기 쉘 PNG를 처리하지 못했습니다.");
                                None
                            }),
                        Ok(None) => {
                            eprintln!("같이 보기 쉘 캡처가 비었습니다.");
                            None
                        }
                        Err(error) => {
                            eprintln!("같이 보기 쉘 캡처 실패: {}", error.message);
                            None
                        }
                    }
                }
            })
        } else {
            None
        }
        .or_else(|| {
            image_base64
                .as_deref()
                .filter(|image| {
                    !image.is_empty() && image.len() as u64 <= SHARE_IMAGE_MAX_BASE64_BYTES
                })
                .and_then(|image| STANDARD.decode(image.trim()).ok())
                .filter(|bytes| {
                    bytes.len() as u64 <= SHARE_IMAGE_MAX_BYTES
                        && bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                })
                .and_then(|bytes| prepare_png(&bytes, None))
        });
        let Some((bytes, hash)) = png else { continue };
        if previous_hash.as_deref() == Some(hash.as_str()) {
            continue;
        }
        if bytes.len() as u64 > AGENT_ATTACHMENT_MAX_BYTES
            || total.saturating_add(bytes.len() as u64) > AGENT_ATTACHMENTS_TOTAL_MAX_BYTES
        {
            continue;
        }
        let safe_name: String = app_name
            .chars()
            .map(|ch| if "<>:\"/\\|?*".contains(ch) { '_' } else { ch })
            .collect();
        attachments.push(ConversationUpload {
            name: format!("{SHARE_CAPTURE_NAME_PREFIX}{safe_name}.png"),
            mime: "image/png".into(),
            data_base64: STANDARD.encode(&bytes),
        });
        total += bytes.len() as u64;
        sent.push((id, hash));
    }
    (attachments, sent)
}

pub(crate) fn mark_sent_visuals(inner: &Inner, conversation: &str, sent: Vec<(String, String)>) {
    let mut state = inner.state.lock().unwrap();
    let before = state.clone();
    for (id, hash) in sent {
        let desktop_id = state
            .shared
            .windows
            .iter()
            .find(|window| window.id == id)
            .map(|window| window.desktop_id.clone());
        let Some(desktop_id) = desktop_id else {
            continue;
        };
        let Some(desktop) = state
            .shared
            .desktops
            .iter_mut()
            .find(|desktop| desktop.id == desktop_id)
        else {
            continue;
        };
        if !desktop.sharing.iter().any(|sharing| sharing == &id) {
            continue;
        }
        let context = desktop
            .last_sent_context
            .entry(conversation.to_owned())
            .or_default()
            .entry(id)
            .or_default();
        if context.visual_hash.as_deref() != Some(hash.as_str()) {
            context.visual_hash = Some(hash);
            desktop.updated_at = crate::state_commands::timestamp();
        }
    }
    match persist_shared_change(inner, &before, &mut state) {
        Ok(true) => inner.layout_signal.notify(),
        Ok(false) => {}
        Err(error) => {
            *state = before;
            eprintln!(
                "같이 보기 이미지 전송 기준을 저장하지 못했습니다: {}",
                error.message
            );
        }
    }
}

pub(crate) fn prepare_png(
    bytes: &[u8],
    crop: Option<(kaleidoscope_contract::Rect, f64)>,
) -> Option<(Vec<u8>, String)> {
    let mut image = image::load_from_memory(bytes).ok()?.to_rgba8();
    if let Some((bounds, scale)) = crop {
        if !scale.is_finite() || scale <= 0.0 {
            return None;
        }
        let left = ((bounds.x as f64) * scale).floor().max(0.0) as u32;
        let top = ((bounds.y as f64) * scale).floor().max(0.0) as u32;
        let right = ((bounds.x as f64 + bounds.width as f64) * scale)
            .ceil()
            .max(0.0)
            .min(image.width() as f64) as u32;
        let bottom = ((bounds.y as f64 + bounds.height as f64) * scale)
            .ceil()
            .max(0.0)
            .min(image.height() as f64) as u32;
        if left >= right || top >= bottom {
            return None;
        }
        image = image::imageops::crop_imm(&image, left, top, right - left, bottom - top).to_image();
    }
    let longest = image.width().max(image.height());
    if longest > SHARE_CAPTURE_MAX_EDGE {
        let ratio = SHARE_CAPTURE_MAX_EDGE as f64 / longest as f64;
        image = image::imageops::resize(
            &image,
            ((image.width() as f64 * ratio).round() as u32).max(1),
            ((image.height() as f64 * ratio).round() as u32).max(1),
            FilterType::Lanczos3,
        );
    }
    png_with_hash(image)
}

fn png_with_hash(image: RgbaImage) -> Option<(Vec<u8>, String)> {
    let hash = format!("{:x}", Sha256::digest(image.as_raw()));
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut output, ImageFormat::Png)
        .ok()?;
    Some((output.into_inner(), hash))
}
