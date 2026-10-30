use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Cursor;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use image::{imageops::FilterType, DynamicImage, ImageFormat, RgbaImage};
use kaleidoscope_contract::registry::ShareUpload;
use kaleidoscope_contract::{
    conversation::ConversationUpload, CoreError, CoreEvent, CoreReply, ErrorCode, LinkStatus,
    VisibleView, AGENT_ATTACHMENTS_MAX, AGENT_ATTACHMENTS_TOTAL_MAX_BYTES,
    AGENT_ATTACHMENT_MAX_BYTES, SHARE_CAPTURE_MAX_EDGE, SHARE_CAPTURE_NAME_PREFIX,
    SHARE_TEXT_MAX_BYTES,
};
use sha2::{Digest, Sha256};

use crate::error;
use crate::storage::LinkFile;
use crate::{snapshot, CoreState, Inner};
use kaleidoscope_contract::conversation::{ConversationItem, ConversationItemKind};

#[derive(Clone, Default, PartialEq)]
pub(crate) struct ShareState {
    pub(crate) sharing: Vec<String>,
    views: HashMap<String, VisibleView>,
    uploaded: HashMap<String, ShareUpload>,
    pending_deletes: HashSet<String>,
    visual_hashes: HashMap<String, String>,
    sent: HashMap<String, BTreeMap<String, kaleidoscope_data::share::SentView>>,
}

pub(crate) fn prepare_text(
    inner: &Inner,
    workspace: &str,
    conversation: &str,
) -> Option<(String, BTreeMap<String, kaleidoscope_data::share::SentView>)> {
    let state = inner.state.lock().unwrap();
    let views: Vec<_> = state
        .share
        .sharing
        .iter()
        .filter_map(|id| {
            let upload = share_upload(&state, id, state.share.views.get(id)?)?;
            (upload.workspace_id == workspace).then(|| kaleidoscope_data::share::View {
                window_id: id.clone(),
                app_name: upload.app_name,
                text: upload.text,
            })
        })
        .collect();
    kaleidoscope_data::share::build_share_block(
        &views,
        &state
            .share
            .sent
            .get(conversation)
            .cloned()
            .unwrap_or_default(),
    )
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
    inner
        .state
        .lock()
        .unwrap()
        .share
        .sent
        .insert(conversation.to_string(), sent);
}

pub(crate) fn set(
    inner: &std::sync::Arc<Inner>,
    window_id: &str,
    on: bool,
) -> Result<CoreReply, CoreError> {
    let (event, delete) = {
        let mut state = inner.state.lock().unwrap();
        if !state
            .shared
            .windows
            .iter()
            .any(|window| window.id == window_id)
        {
            return Err(error::make(ErrorCode::NotFound));
        }
        let was_on = state.share.sharing.iter().any(|id| id == window_id);
        if was_on == on {
            return Ok(CoreReply::ShareSet {});
        }
        if on {
            state.share.sharing.push(window_id.to_owned());
            (
                Some(CoreEvent::StateChanged {
                    snapshot: snapshot(&state),
                }),
                false,
            )
        } else {
            state.share.sharing.retain(|id| id != window_id);
            state.share.views.remove(window_id);
            state.share.uploaded.remove(window_id);
            state.share.visual_hashes.remove(window_id);
            state.share.pending_deletes.insert(window_id.to_owned());
            (
                Some(CoreEvent::StateChanged {
                    snapshot: snapshot(&state),
                }),
                true,
            )
        }
    };
    if delete {
        delete_pending(inner, window_id);
    }
    if let Some(event) = event {
        inner.emit(&event);
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
        if !state.share.sharing.iter().any(|id| id == window_id) {
            return Ok(CoreReply::ShareView {});
        }
        if view.text.len() > SHARE_TEXT_MAX_BYTES {
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
        if state.share.sharing.iter().any(|id| id == window_id)
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
        let live: HashSet<_> = state
            .shared
            .windows
            .iter()
            .map(|window| window.id.as_str())
            .collect();
        let removed: Vec<_> = state
            .share
            .sharing
            .iter()
            .filter(|id| !live.contains(id.as_str()))
            .cloned()
            .collect();
        for id in &removed {
            state.share.sharing.retain(|sharing| sharing != id);
            state.share.views.remove(id);
            state.share.uploaded.remove(id);
            state.share.visual_hashes.remove(id);
            state.share.pending_deletes.insert(id.clone());
        }
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
        let uploads = state
            .share
            .sharing
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
        (state.share.sharing.clone(), link_file(inner))
    };
    if let Some(file) = file {
        for id in ids {
            let _ = inner
                .registry
                .delete_share(&file.server_url, &file.token, &id);
        }
    }
}

pub(crate) fn capture_for_conversation_send(
    inner: &Inner,
    workspace_id: &str,
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
                .share
                .sharing
                .iter()
                .filter_map(|id| {
                    let window = state
                        .shared
                        .windows
                        .iter()
                        .find(|window| &window.id == id)?;
                    if Some(window.desktop_id.as_str()) != active_desktop.as_deref() {
                        return None;
                    }
                    let view = state.share.views.get(id)?;
                    if !view.visual {
                        return None;
                    }
                    let app = state
                        .shared
                        .apps
                        .iter()
                        .find(|app| app.id == window.app_id)?;
                    let definition = crate::app_commands::definition_for(
                        &state.shared,
                        &app.id,
                        app.current_version,
                    )?;
                    let mut has_web = false;
                    kaleidoscope_contract::data::walk_blocks(
                        &definition.ui,
                        "",
                        &mut |_, child| {
                            if matches!(child, kaleidoscope_contract::Block::WebView { .. }) {
                                has_web = true;
                            }
                        },
                    );
                    let upload = share_upload(&state, id, view)?;
                    Some((
                        id.clone(),
                        view.bounds,
                        upload.app_name,
                        has_web,
                        state.share.visual_hashes.get(id).cloned(),
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
    let Some(web) = inner.host.web() else {
        return (attachments, Vec::new());
    };
    let mut sent = Vec::new();
    for (id, bounds, app_name, has_web, previous_hash) in candidates {
        if attachments.len() >= AGENT_ATTACHMENTS_MAX {
            break;
        }
        let png = if has_web {
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
                Ok(Some((bytes, scale))) => {
                    prepare_png(&bytes, Some((bounds, scale))).or_else(|| {
                        eprintln!("같이 보기 쉘 PNG를 처리하지 못했습니다.");
                        None
                    })
                }
                Ok(None) => {
                    eprintln!("같이 보기 쉘 캡처가 비었습니다.");
                    None
                }
                Err(error) => {
                    eprintln!("같이 보기 쉘 캡처 실패: {}", error.message);
                    None
                }
            }
        };
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

pub(crate) fn mark_sent_visuals(inner: &Inner, sent: Vec<(String, String)>) {
    let mut state = inner.state.lock().unwrap();
    for (id, hash) in sent {
        if state.share.sharing.iter().any(|sharing| sharing == &id) {
            state.share.visual_hashes.insert(id, hash);
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
