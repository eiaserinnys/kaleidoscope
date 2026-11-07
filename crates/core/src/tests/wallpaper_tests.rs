use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use kaleidoscope_contract::assets::AssetFormat;
use kaleidoscope_contract::registry::LayoutChanges;

const PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

fn upload(core: &Core, desktop: &str) -> CoreReply {
    core.handle(CoreRequest::DesktopWallpaperUpload {
        desktop_id: desktop.into(),
        format: AssetFormat::Png,
        data_base64: PNG_BASE64.into(),
    })
    .unwrap()
}

#[test]
fn wallpaper_upload_media_cache_reset_and_restart() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .asset_bytes
        .lock()
        .unwrap()
        .replace(STANDARD.decode(PNG_BASE64).unwrap());
    let core = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        client.clone(),
    );
    mark_connected(&core);
    let (_, desktop) = active_ids(&core);
    let CoreReply::DesktopWallpaperUpload { wallpaper } = upload(&core, &desktop) else {
        unreachable!()
    };
    assert_eq!(wallpaper.desktop_id, desktop);
    assert_eq!(wallpaper.id, desktop);
    assert!(wallpaper.asset.id.starts_with("wallpaper-"));
    assert_eq!(snapshot(&core).shared.desktop_wallpapers.len(), 1);
    assert_eq!(client.asset_uploads.lock().unwrap().len(), 1);

    let media = |core: &Core| match core
        .handle(CoreRequest::DesktopWallpaperMedia {
            desktop_id: desktop.clone(),
        })
        .unwrap()
    {
        CoreReply::DesktopWallpaperMedia { media } => media,
        other => panic!("unexpected reply: {other:?}"),
    };
    assert_eq!(media(&core).unwrap().data_base64, PNG_BASE64);
    assert_eq!(client.asset_gets.load(Ordering::SeqCst), 1);
    // 같은 자산은 미디어 캐시에서 다시 쓰고 서버에 또 묻지 않는다.
    assert_eq!(media(&core).unwrap().data_base64, PNG_BASE64);
    assert_eq!(client.asset_gets.load(Ordering::SeqCst), 1);

    drop(core);
    let reopened = open_core_with_client(
        dir.path(),
        vec![test_definition(MD_EDITOR)],
        &host,
        client.clone(),
    );
    assert_eq!(snapshot(&reopened).shared.desktop_wallpapers.len(), 1);

    reopened
        .handle(CoreRequest::DesktopWallpaperReset {
            desktop_id: desktop.clone(),
        })
        .unwrap();
    assert!(snapshot(&reopened).shared.desktop_wallpapers.is_empty());
    assert!(media(&reopened).is_none());
}

#[test]
fn wallpaper_upload_needs_connected_server_and_reset_works_offline() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(dir.path(), vec![], &host, registry_client());
    let (_, desktop) = active_ids(&core);
    let error = core
        .handle(CoreRequest::DesktopWallpaperUpload {
            desktop_id: desktop.clone(),
            format: AssetFormat::Png,
            data_base64: PNG_BASE64.into(),
        })
        .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DESK_WALLPAPER_SERVER_REQUIRED"));
    assert!(snapshot(&core).shared.desktop_wallpapers.is_empty());

    mark_connected(&core);
    upload(&core, &desktop);
    core.inner.state.lock().unwrap().link = LinkStatus::Offline {
        mode: kaleidoscope_contract::ServerMode::Remote,
        server_url: "https://registry.test".into(),
        device_name: "test-device".into(),
        reason: None,
    };
    core.handle(CoreRequest::DesktopWallpaperReset {
        desktop_id: desktop,
    })
    .unwrap();
    assert!(snapshot(&core).shared.desktop_wallpapers.is_empty());
}

#[test]
fn wallpaper_follows_parent_delete_and_first_merge_pending() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client
        .asset_bytes
        .lock()
        .unwrap()
        .replace(STANDARD.decode(PNG_BASE64).unwrap());
    let core = open_core_with_client(dir.path(), vec![], &host, client);
    mark_connected(&core);
    let (local_workspace, local_desktop) = active_ids(&core);
    let CoreReply::DesktopWallpaperUpload { wallpaper } = upload(&core, &local_desktop) else {
        unreachable!()
    };

    let remote_workspace = crate::state_commands::new_workspace("서버 작업".into(), "now".into());
    let remote_desktop = crate::state_commands::new_desktop(
        remote_workspace.id.clone(),
        "서버 화면".into(),
        0,
        "now".into(),
    );
    {
        let mut state = core.inner.state.lock().unwrap();
        crate::layout_apply::apply_snapshot(
            &mut state,
            "device",
            LayoutChanges {
                workspaces: vec![remote_workspace],
                desktops: vec![remote_desktop],
                ..Default::default()
            },
        );
        assert!(state
            .shared
            .workspaces
            .iter()
            .any(|workspace| workspace.id == local_workspace));
        assert!(state.sync.contains(
            crate::sync_state::EntityKind::DesktopWallpaper,
            &wallpaper.id
        ));
        let mut stale = wallpaper.clone();
        stale.asset.version = 9;
        crate::layout_apply::apply_changes(
            &mut state,
            LayoutChanges {
                desktop_wallpapers: vec![stale],
                ..Default::default()
            },
        );
        assert_eq!(state.shared.desktop_wallpapers[0].asset.version, 1);
        crate::layout_apply::apply_changes(
            &mut state,
            LayoutChanges {
                deleted_desktops: vec![local_desktop.clone()],
                ..Default::default()
            },
        );
        // 최초 병합에서 부모가 미전송이면 배경도 지우지 않는다.
        assert_eq!(state.shared.desktop_wallpapers.len(), 1);
        state.sync.pending.clear();
        crate::layout_apply::apply_changes(
            &mut state,
            LayoutChanges {
                deleted_desktops: vec![local_desktop],
                ..Default::default()
            },
        );
        assert!(state.shared.desktop_wallpapers.is_empty());
    }
}
