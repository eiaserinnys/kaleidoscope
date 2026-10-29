use super::*;

fn browser_definition() -> Value {
    serde_json::from_str(include_str!("../../../../../examples/web-browser.json")).unwrap()
}

fn nested_browser() -> Value {
    let mut definition = browser_definition();
    definition["requires"]["blocks"] = json!(4);
    let web = definition["ui"].take();
    definition["ui"] = json!({
        "type": "stack",
        "direction": "column",
        "children": [{"type": "section", "title": "웹", "child": web}]
    });
    definition
}

fn web_core(data: &Path, definition: Value, host: &Arc<HostWithWeb>) -> Core {
    Core::open(
        CoreConfig {
            data_dir: data.into(),
            seed_definitions: vec![definition.to_string()],
            server_url: "http://localhost".into(),
            device_name: "test".into(),
        },
        host.clone(),
    )
    .unwrap()
}

fn attach(core: &Core, window: &str) {
    assert!(matches!(
        core.handle(CoreRequest::WebAttach {
            window_id: window.into(),
            url: "https://example.com/".into(),
        }),
        Ok(CoreReply::WebAttach { .. })
    ));
}

fn assert_navigation_state(core: &Core, window: &str) {
    core.web_update(
        window,
        kaleidoscope_contract::WebPage {
            url: "https://example.org/".into(),
            title: "Example".into(),
            loading: false,
            can_go_back: true,
            can_go_forward: false,
        },
    );
    let snapshot = snapshot(core);
    let state = &snapshot
        .shared
        .windows
        .iter()
        .find(|candidate| candidate.id == window)
        .unwrap()
        .state;
    assert_eq!(state["url"], json!("https://example.org/"));
}

#[test]
fn web_view_nested_in_stack_and_section_attaches_and_saves_navigation() {
    let data = TempDir::new().unwrap();
    let host = Arc::new(HostWithWeb::default());
    let core = web_core(data.path(), nested_browser(), &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "web-browser");
    attach(&core, &window);
    assert_navigation_state(&core, &window);
}

#[test]
fn moving_attached_web_view_into_containers_keeps_it_attached() {
    let data = TempDir::new().unwrap();
    let host = Arc::new(HostWithWeb::default());
    let core = web_core(data.path(), browser_definition(), &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "web-browser");
    attach(&core, &window);
    import(&core, &nested_browser().to_string());
    assert!(!host
        .web
        .calls
        .lock()
        .unwrap()
        .contains(&format!("detach {window}")));
    assert_navigation_state(&core, &window);
}
