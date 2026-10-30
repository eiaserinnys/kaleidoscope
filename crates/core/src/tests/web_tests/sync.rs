use super::*;

#[test]
fn web_navigation_syncs_and_server_follow_redirect_does_not_echo() {
    use kaleidoscope_contract::registry::LayoutChanges;
    let data = TempDir::new().unwrap();
    let host = Arc::new(HostWithWeb::default());
    let client = registry_client();
    let core = Core::open_with_client(
        CoreConfig {
            data_dir: data.path().into(),
            seed_definitions: vec![test_definition(include_str!(
                "../../../../../apps/web-browser.json"
            ))],
            server_url: "https://registry.test".into(),
            device_name: "test".into(),
        },
        host,
        client,
    )
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-web-browser");
    core.handle(CoreRequest::WebAttach {
        window_id: window.clone(),
        url: "https://example.com".into(),
    })
    .unwrap();
    mark_connected(&core);
    let page = |url: &str| kaleidoscope_contract::WebPage {
        url: url.into(),
        title: String::new(),
        loading: false,
        can_go_back: false,
        can_go_forward: false,
    };
    core.web_update(&window, page("https://example.com/local"));
    assert!(core
        .inner
        .state
        .lock()
        .unwrap()
        .sync
        .pending
        .keys()
        .any(|k| k.id == window));
    core.inner.state.lock().unwrap().sync.pending.clear();
    let mut remote = snapshot(&core)
        .shared
        .windows
        .into_iter()
        .find(|w| w.id == window)
        .unwrap();
    remote
        .state
        .insert("url".into(), json!("https://example.com/remote"));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges {
                windows: vec![remote],
                ..Default::default()
            },
        },
    );
    core.web_update(&window, page("https://example.com/redirect"));
    assert!(core.inner.state.lock().unwrap().sync.pending.is_empty());
    assert_eq!(
        snapshot(&core).shared.windows[0].state["url"],
        json!("https://example.com/redirect")
    );
    thread::sleep(Duration::from_secs(11));
    core.web_update(&window, page("https://example.com/next"));
    assert!(core
        .inner
        .state
        .lock()
        .unwrap()
        .sync
        .pending
        .keys()
        .any(|k| k.id == window));
}
