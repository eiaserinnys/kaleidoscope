use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::conversation::ConversationUpload;
use kaleidoscope_contract::AGENT_ATTACHMENTS_MAX;

#[test]
fn instructions_require_capability_and_return_the_canonical_guide() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = json!({
        "id":"instructions-fixture", "name":"지침 시험", "requires":{"blocks":18,"modules":{"assets":1,"client":4}},
        "assets":[{"id":"client-code","version":1}],
        "client":{"runtime":"javascript","entry":{"id":"client-code","version":1},"capabilities":["instructions"]},
        "ui":{"type":"text","value":"시험"}
    });
    let core = open_core(temp.path(), vec![client.to_string(), test_definition(MD_EDITOR)], &host);
    let (_, desktop) = active_ids(&core);
    let allowed = open_window(&core, &desktop, "instructions-fixture");
    let denied = open_window(&core, &desktop, "test-md-editor");
    let request = |window: &str| serde_json::from_value(json!({
        "op":"host.instructions", "window_id":window, "kind":"app_authoring"
    })).unwrap();
    let reply = serde_json::to_value(core.handle(request(&allowed)).unwrap()).unwrap();
    assert_eq!(reply["text"], kaleidoscope_contract::APP_AUTHORING_GUIDE);
    assert!(!reply["hash"].as_str().unwrap().is_empty());
    assert_eq!(core.handle(request(&denied)).unwrap_err().id.as_deref(), Some("APP_INSTRUCTIONS_CAPABILITY_UNDECLARED"));
}

#[test]
fn client_context_preserves_skipped_capture_and_request_identity() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(CaptureTestHost {
        png: Mutex::new(test_png(8, 8)),
        web_captures: AtomicUsize::new(0),
        shell_captures: AtomicUsize::new(0),
        freeze_calls: AtomicUsize::new(0),
        unfreeze_calls: AtomicUsize::new(0),
    });
    let client = json!({
        "id":"context-fixture", "name":"맥락 시험", "requires":{"blocks":18,"modules":{"assets":1,"client":4}},
        "assets":[{"id":"client-code","version":1}],
        "client":{"runtime":"javascript","entry":{"id":"client-code","version":1},"capabilities":["context_capture","instructions"]},
        "ui":{"type":"text","value":"시험"}
    });
    let core = Core::open_with_client(CoreConfig {
        embedded_server: None, data_dir: temp.path().into(),
        seed_definitions: vec![client.to_string(), test_definition(MD_EDITOR)],
        server_url: "http://127.0.0.1:4219".into(), device_name: "시험".into(),
    }, host, registry_client()).unwrap();
    let (_, desktop) = active_ids(&core);
    let source = open_window(&core, &desktop, "test-md-editor");
    let target = open_window(&core, &desktop, "context-fixture");
    core.handle(CoreRequest::ShareSet { window_id: source.clone(), on: true }).unwrap();
    core.handle(CoreRequest::ShareView { window_id: source, view: kaleidoscope_contract::VisibleView {
        text: "현재 내용".into(), visual: true, occluded: false, image_base64: None,
        bounds: Rect { x: 0, y: 0, width: 4, height: 4 },
    }}).unwrap();
    let prepare = |request: &str, count: usize| -> Value {
        let command = serde_json::from_value(json!({"op":"context.prepare", "window_id":target,
            "request_id":request, "channel":"chat", "attachments":{"count":count,"bytes":0}})).unwrap();
        serde_json::to_value(core.handle(command).unwrap()).unwrap()
    };
    let first = prepare("first", 10);
    assert_eq!(first["images"].as_array().unwrap().len(), 0);
    assert!(first["text"].as_str().unwrap().contains("현재 내용"));
    assert_eq!(prepare("first", 10), first);
    let changed = serde_json::from_value(json!({"op":"context.prepare", "window_id":target,
        "request_id":"first", "channel":"chat", "attachments":{"count":9,"bytes":0}})).unwrap();
    assert_eq!(core.handle(changed).unwrap_err().id.as_deref(), Some("SHARE_CONTEXT_REQUEST_CHANGED"));
    let commit = serde_json::from_value(json!({"op":"context.commit", "window_id":target, "ticket":first["ticket"]})).unwrap();
    core.handle(commit).unwrap();
    let second = prepare("second", 0);
    assert_eq!(second["images"].as_array().unwrap().len(), 1);
    let commit = serde_json::from_value(json!({"op":"context.commit", "window_id":target, "ticket":second["ticket"]})).unwrap();
    core.handle(commit).unwrap();
    let third = prepare("third", 0);
    assert_eq!(third["images"].as_array().unwrap().len(), 0);
    assert!(third["text"].as_str().unwrap().contains("그대로"));
    let other = open_window(&core, &desktop, "context-fixture");
    let command = serde_json::from_value(json!({"op":"context.prepare", "window_id":other,
        "request_id":"first", "channel":"chat", "attachments":{"count":0,"bytes":0}})).unwrap();
    let other = serde_json::to_value(core.handle(command).unwrap()).unwrap();
    assert_eq!(other["images"].as_array().unwrap().len(), 1);
}

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
    let (first, _) = crate::share::capture_for_send(&core.inner, &workspace, "test", attachments.len(), 0);
    assert_eq!(first.len(), 0);

    *host.png.lock().unwrap() = test_png_with_blue(8, 8, 41);
    view.occluded = false;
    core.handle(CoreRequest::ShareView { window_id, view })
        .unwrap();
    let (second, _) = crate::share::capture_for_send(&core.inner, &workspace, "test", 0, 0);
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
