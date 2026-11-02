use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::conversation::ConversationUpload;
use kaleidoscope_contract::AGENT_ATTACHMENTS_MAX;

#[test]
fn attachment_limit_discards_unused_isolated_capture_before_next_send() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(CaptureTestHost {
        png: Mutex::new(test_png_with_blue(8, 8, 29)),
        web_captures: AtomicUsize::new(0),
        shell_captures: AtomicUsize::new(0),
        freeze_calls: AtomicUsize::new(0),
        unfreeze_calls: AtomicUsize::new(0),
    });
    let core = Core::open_with_client(
        CoreConfig {
            embedded_server: None,
            data_dir: temp.path().join("data"),
            seed_definitions: vec![test_definition(MD_EDITOR)],
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "test-device".into(),
        },
        host.clone(),
        registry_client(),
    )
    .unwrap();
    let (workspace, desktop) = active_ids(&core);
    let window_id = open_window(&core, &desktop, "test-md-editor");
    core.handle(CoreRequest::ShareSet {
        window_id: window_id.clone(),
        on: true,
    })
    .unwrap();
    let mut view = kaleidoscope_contract::VisibleView {
        text: "가려진 창".into(),
        visual: true,
        occluded: true,
        image_base64: None,
        bounds: Rect {
            x: 0,
            y: 0,
            width: 4,
            height: 4,
        },
    };
    core.handle(CoreRequest::ShareView {
        window_id: window_id.clone(),
        view: view.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::ShareCapture {
        window_id: window_id.clone(),
    })
    .unwrap();
    let attachments = vec![
        ConversationUpload {
            name: "기존.png".into(),
            mime: "image/png".into(),
            data_base64: STANDARD.encode(test_png(1, 1))
        };
        AGENT_ATTACHMENTS_MAX
    ];
    let (first, _) = crate::share::capture_for_send(&core.inner, &workspace, "test", &attachments);
    assert_eq!(first.len(), AGENT_ATTACHMENTS_MAX);

    *host.png.lock().unwrap() = test_png_with_blue(8, 8, 41);
    view.occluded = false;
    core.handle(CoreRequest::ShareView { window_id, view })
        .unwrap();
    let (second, _) = crate::share::capture_for_send(&core.inner, &workspace, "test", &[]);
    assert_eq!(second.len(), 1);
    let image = image::load_from_memory(&STANDARD.decode(&second[0].data_base64).unwrap())
        .unwrap()
        .to_rgba8();
    assert_eq!(
        image.get_pixel(0, 0).0[2],
        41,
        "이전 격리 그림 대신 현재 화면을 보낸다"
    );
}
