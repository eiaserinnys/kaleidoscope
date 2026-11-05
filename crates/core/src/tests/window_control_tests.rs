use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use kaleidoscope_contract::{WindowControlOperation, WindowControlRequest, WindowControlResult};

fn fixture() -> (
    TempDir,
    Core,
    Arc<FakeRegistryClient>,
    Arc<CaptureTestHost>,
    String,
) {
    let temp = TempDir::new().unwrap();
    let registry = registry_client();
    let host = Arc::new(CaptureTestHost {
        png: Mutex::new(test_png(2000, 120)),
        web_captures: AtomicUsize::new(0),
        shell_captures: AtomicUsize::new(0),
        freeze_calls: AtomicUsize::new(0),
        unfreeze_calls: AtomicUsize::new(0),
    });
    let core = Core::open_with_client(
        CoreConfig {
            media_origin: None,
            embedded_server: None,
            data_dir: temp.path().into(),
            seed_definitions: vec![test_definition(MD_EDITOR)],
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "시험".into(),
        },
        host.clone(),
        registry.clone(),
    )
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    *core.inner.link_file.lock().unwrap() = Some(LinkFile {
        revoked: false,
        mode: Default::default(),
        format: 1,
        server_url: "http://127.0.0.1:4219".into(),
        device_id: "device".into(),
        device_name: "시험".into(),
        token: "test".into(),
    });
    (temp, core, registry, host, window)
}

fn request(window: &str, id: &str, expires_at: &str) -> WindowControlRequest {
    WindowControlRequest {
        request_id: id.into(),
        window_id: window.into(),
        expires_at: expires_at.into(),
        operation: WindowControlOperation::Read { image: true },
    }
}

fn emit(core: &Core, request: WindowControlRequest) {
    crate::registry_events::apply_event(&core.inner, 0, DeviceEvent::WindowControl { request });
}

fn wait_response(
    registry: &FakeRegistryClient,
    count: usize,
) -> kaleidoscope_contract::WindowControlResponse {
    let start = Instant::now();
    loop {
        if let Some(response) = registry
            .control_responses
            .lock()
            .unwrap()
            .get(count - 1)
            .cloned()
        {
            return response;
        }
        assert!(
            start.elapsed() < Duration::from_secs(3),
            "응답을 받지 못했습니다"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn window_control_rejects_expired_missing_unshared_and_inactive() {
    let (_temp, core, registry, _, window) = fixture();
    let events = Arc::new(AtomicUsize::new(0));
    let seen = events.clone();
    core.subscribe(Box::new(move |event| {
        if matches!(event, CoreEvent::WindowControl { .. }) {
            seen.fetch_add(1, Ordering::SeqCst);
        }
    }));
    let future = "2099-01-01T00:00:00Z";
    emit(&core, request(&window, "expired", "2000-01-01T00:00:00Z"));
    emit(&core, request("missing", "missing", future));
    emit(&core, request(&window, "unshared", future));
    for (index, code) in [
        "SHARE_CONTROL_REQUEST_EXPIRED",
        "SHARE_CONTROL_WINDOW_NOT_FOUND",
        "SHARE_CONTROL_NOT_SHARED",
    ]
    .iter()
    .enumerate()
    {
        let start = Instant::now();
        loop {
            let responses = registry.control_responses.lock().unwrap();
            if responses.iter().any(|response| matches!(&response.result, WindowControlResult::Error { error, applied: false } if error.id.as_deref() == Some(*code))) { break; }
            drop(responses);
            assert!(
                start.elapsed() < Duration::from_secs(3),
                "missing response {index}: {code}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
    core.handle(CoreRequest::ShareSet {
        window_id: window.clone(),
        on: true,
    })
    .unwrap();
    let (workspace, _) = active_ids(&core);
    core.inner
        .state
        .lock()
        .unwrap()
        .device
        .active_desktop_ids
        .insert(workspace, "other".into());
    emit(&core, request(&window, "inactive", future));
    let response = wait_response(&registry, 4);
    assert!(
        matches!(response.result, WindowControlResult::Error { error, applied: false } if error.id.as_deref() == Some("SHARE_CONTROL_DESKTOP_INACTIVE"))
    );
    assert_eq!(events.load(Ordering::SeqCst), 0);
}

#[test]
fn window_control_capture_and_response_keep_pas_cache_and_metadata() {
    let (_temp, core, registry, _, window) = fixture();
    core.handle(CoreRequest::ShareSet {
        window_id: window.clone(),
        on: true,
    })
    .unwrap();
    let bounds = Rect {
        x: 5,
        y: 8,
        width: 1800,
        height: 100,
    };
    core.handle(CoreRequest::ShareView {
        window_id: window.clone(),
        view: kaleidoscope_contract::VisibleView {
            text: "text".into(),
            visual: true,
            occluded: true,
            image_base64: None,
            bounds,
        },
    })
    .unwrap();
    core.handle(CoreRequest::ShareCapture {
        window_id: window.clone(),
    })
    .unwrap();
    assert_eq!(core.inner.isolated_captures.lock().unwrap().len(), 1);
    emit(&core, request(&window, "capture", "2099-01-01T00:00:00Z"));
    assert!(matches!(
        core.handle(CoreRequest::ShareFreeze {}).unwrap(),
        CoreReply::ShareFreeze { frozen: true }
    ));
    assert!(core.inner.isolated_captures.lock().unwrap().is_empty());
    let capture = core
        .handle(CoreRequest::WindowControlCapture {
            request_id: "capture".into(),
            window_id: window.clone(),
            bounds,
        })
        .unwrap();
    let CoreReply::WindowControlCapture {
        image_base64,
        geometry,
    } = capture
    else {
        panic!("capture reply");
    };
    assert_eq!(
        (
            geometry.css_width,
            geometry.css_height,
            geometry.pixel_width,
            geometry.pixel_height
        ),
        (1800.0, 100.0, 1600, 89)
    );
    assert_eq!(
        image::load_from_memory(&STANDARD.decode(&image_base64).unwrap())
            .unwrap()
            .width(),
        1600
    );
    assert_eq!(core.inner.isolated_captures.lock().unwrap().len(), 1);
    core.handle(CoreRequest::ShareUnfreeze {}).unwrap();
    assert_eq!(core.inner.isolated_captures.lock().unwrap().len(), 1);
    let response = serde_json::from_value(json!({"request_id":"capture", "window_id":window, "result":{"status":"ok", "value":{"after":{
        "view_id":"v", "app_name":"", "window_title":"", "text":"내용", "settled":true, "image_base64":image_base64, "geometry":geometry
    }}}})).unwrap();
    core.handle(CoreRequest::WindowControlRespond { response })
        .unwrap();
    let response = wait_response(&registry, 1);
    let WindowControlResult::Ok { value } = response.result else {
        panic!("success reply");
    };
    assert!(!value.after.app_name.is_empty());
    assert!(!value.after.window_title.is_empty());
    assert_eq!(
        value.after.image_base64.as_deref(),
        Some(image_base64.as_str())
    );
    assert_eq!(value.after.geometry, Some(geometry));

    core.handle(CoreRequest::ShareFreeze {}).unwrap();
    core.handle(CoreRequest::ShareCapture {
        window_id: window.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::ShareUnfreeze {}).unwrap();
    assert!(core
        .inner
        .window_control
        .saved_isolated
        .lock()
        .unwrap()
        .is_empty());
    assert_eq!(core.inner.isolated_captures.lock().unwrap().len(), 1);

    core.handle(CoreRequest::ShareFreeze {}).unwrap();
    let (workspace, _) = active_ids(&core);
    crate::share::capture_for_send(&core.inner, &workspace, "test", 0, 0);
    core.handle(CoreRequest::ShareUnfreeze {}).unwrap();
    assert!(core
        .inner
        .window_control
        .saved_isolated
        .lock()
        .unwrap()
        .is_empty());
    assert!(core.inner.isolated_captures.lock().unwrap().is_empty());
}

#[test]
fn window_control_share_off_discards_result_and_preserves_applied() {
    let (_temp, core, registry, _, window) = fixture();
    core.handle(CoreRequest::ShareSet {
        window_id: window.clone(),
        on: true,
    })
    .unwrap();
    let mut req = request(&window, "action", "2099-01-01T00:00:00Z");
    req.operation = serde_json::from_value(
        json!({"kind":"act", "view_id":"v", "action":{"kind":"click", "target":1}, "image":true}),
    )
    .unwrap();
    emit(&core, req);
    core.handle(CoreRequest::ShareSet {
        window_id: window.clone(),
        on: false,
    })
    .unwrap();
    let response = serde_json::from_value(json!({"request_id":"action", "window_id":window, "result":{"status":"ok", "value":{"after":{
        "view_id":"v", "app_name":"secret", "window_title":"secret", "text":"secret", "settled":true, "image_base64":"secret"
    }}}})).unwrap();
    core.handle(CoreRequest::WindowControlRespond { response })
        .unwrap();
    let response = wait_response(&registry, 1);
    assert!(
        matches!(&response.result, WindowControlResult::Error { error, applied: true } if error.id.as_deref() == Some("SHARE_CONTROL_NOT_SHARED"))
    );
    assert!(!serde_json::to_string(&response).unwrap().contains("secret"));
}

#[test]
fn window_control_shared_window_emits_request_to_ui() {
    let temp = TempDir::new().unwrap();
    let core = open_core(
        temp.path(),
        vec![test_definition(MD_EDITOR)],
        &Arc::new(FakeHost::default()),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    core.handle(CoreRequest::ShareSet {
        window_id: window.clone(),
        on: true,
    })
    .unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = events.clone();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::WindowControl { request } = event {
            observed.lock().unwrap().push(request.clone());
        }
    }));
    let request = serde_json::from_value(json!({"request_id":"r", "window_id":window, "expires_at":"2099-01-01T00:00:00Z", "operation":{"kind":"read", "image":false}})).unwrap();
    crate::registry_events::apply_event(&core.inner, 0, DeviceEvent::WindowControl { request });
    assert_eq!(events.lock().unwrap().len(), 1);
}

#[test]
fn control_requests_without_pending_request_return_registered_error() {
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    let error = kaleidoscope_contract::errors::SHARE_CONTEXT_ID_EMPTY();
    let commands = [
        json!({"op":"window.control.respond","response":{"request_id":"r","window_id":"w","result":{"status":"error","error":error,"applied":false}}}),
        json!({"op":"window.control.capture","request_id":"r","window_id":"w","bounds":{"x":0,"y":0,"width":100,"height":100}}),
        json!({"op":"web.control","request_id":"r","window_id":"w","operation":{"kind":"read","image":false}}),
    ];
    for command in commands {
        let request = serde_json::from_value(command).unwrap();
        let err = core.handle(request).unwrap_err();
        assert_eq!(err.id.as_deref(), Some("SHARE_CONTROL_RESPONSE_UNEXPECTED"));
        assert!(err.message.contains("대기 요청이 없습니다"));
    }
}
