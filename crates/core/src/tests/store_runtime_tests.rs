use super::*;
use sha2::{Digest, Sha256};

fn add_release(mock: &crate::store::tests::Loopback, release: u32, change_worker: bool) {
    let mut files = mock.files.lock().unwrap();
    let prefix = format!("apps/example/{release}/");
    let mut app: Value = serde_json::from_slice(&files["/appstore/apps/example/3/app.json"].2).unwrap();
    if change_worker { app["worker"]["code"] = json!("print('changed')"); }
    else { app["ui"]["value"] = json!("새 화면"); }
    let app = app.to_string().into_bytes();
    let original: Value = serde_json::from_slice(&files["/appstore/apps/example/3/manifest.json"].2).unwrap();
    let text = original.to_string().replace("apps/example/3/", &prefix);
    let mut manifest: Value = serde_json::from_str(&text).unwrap();
    manifest["release"] = json!(release);
    manifest["files"][format!("{prefix}app.json")]["sha256"] = json!(format!("{:x}", Sha256::digest(&app)));
    manifest["files"][format!("{prefix}app.json")]["bytes"] = json!(app.len());
    for suffix in ["assets/icon/1", "screenshots/1.png"] {
        let old = files[&format!("/appstore/apps/example/3/{suffix}")].clone();
        files.insert(format!("/appstore/{prefix}{suffix}"), old);
    }
    files.insert(format!("/appstore/{prefix}app.json"), (200, "application/json", app));
    files.insert(format!("/appstore/{prefix}manifest.json"), (200, "application/json", manifest.to_string().into_bytes()));
}

#[test]
fn store_source_and_consent_install_update_modified_and_remove() {
    let temp = TempDir::new().unwrap();
    let definition = json!({
        "id":"store-tester", "name":"스토어 시험", "requires":{"blocks":4,"modules":{"store":1}},
        "permissions":[{"module":"store","id":"catalog","label":"스토어"}],
        "state":{"release":3,"success":false},
        "sources":{"catalog":{"kind":"store","store":"index","permission":"catalog","server":"https://example.com/appstore"}},
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"text","value":{"expr":"$data.catalog.items[0].name"}},
            {"type":"text","value":{"expr":"$count($apps[id = 'example'])"}},
            {"type":"button","label":"설치","on_click":[{"store.install":{"permission":"catalog","server":"https://example.com/appstore","id":"example","release":{"state":"release"}}},{"set_state":"success","value":true}]},
            {"type":"button","label":"삭제","on_click":[{"store.remove":{"permission":"catalog","id":"example"}}]}
        ]}
    });
    let registry = registry_client();
    let core = Arc::new(open_core_with_client(temp.path(), vec![definition.to_string()], &Arc::new(FakeHost::default()), registry.clone()));
    let (mock, _, _) = crate::store::tests::fixture();
    add_release(&mock, 4, false);
    add_release(&mock, 5, true);
    *core.inner.store_transport.lock().unwrap() = Some(Arc::new(mock));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "store-tester");
    mark_connected(&core);
    core.handle(CoreRequest::DataAttach { window_id: window.clone(), dormant: vec![] }).unwrap();
    core.handle(CoreRequest::DataRefresh { window_id: window.clone(), sources: vec!["catalog".into()] }).unwrap();
    wait_until(|| matches!(crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/0/value"), Some(kaleidoscope_contract::data::BindingValue::Ready { value, .. }) if value == json!("보기")));
    let index = crate::store::client(&core.inner, "https://example.com/appstore").unwrap().index("catalog").unwrap();
    let icon = index.items[0].icon.clone().unwrap();
    assert!(matches!(core.handle(CoreRequest::DataMedia { window_id: window.clone(), media: kaleidoscope_contract::data::MediaRef::Resource(icon), max_px: None }).unwrap(), CoreReply::DataMedia { .. }));

    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, .. } = event { tx.send((request_id.clone(), digest.clone())).unwrap(); }));
    let act = |core: Arc<Core>, window: String| thread::spawn(move || core.handle(CoreRequest::DataAct { window_id: window, pointer: "/ui/children/2/on_click".into(), event: Value::Null, item: Value::Null, modifiers: None }));
    let first = act(core.clone(), window.clone());
    let (request, digest) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { window_id: window.clone(), request_id: request, digest, allow: false }).unwrap();
    first.join().unwrap().unwrap();
    assert!(registry.store_requests.lock().unwrap().is_empty());
    assert_eq!(core.inner.state.lock().unwrap().shared.windows.iter().find(|w| w.id == window).unwrap().state["success"], json!(false));

    let second = act(core.clone(), window.clone());
    let (request, digest) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { window_id: window.clone(), request_id: request, digest, allow: true }).unwrap();
    second.join().unwrap().unwrap();
    let installed = core.inner.state.lock().unwrap().shared.apps.iter().find(|app| app.id == "example").cloned().unwrap();
    assert_eq!(installed.origin.unwrap().release, 3);
    assert_eq!(installed.installed_version, Some(installed.current_version));
    assert!(matches!(crate::data_runtime::binding_value(&core.inner, &window, "/ui/children/1/value"), Some(kaleidoscope_contract::data::BindingValue::Ready { value, .. }) if value.as_f64() == Some(1.0)));

    core.handle(CoreRequest::WindowSetState { window_id: window.clone(), state: BTreeMap::from([("release".into(), json!(4)), ("success".into(), json!(false))]) }).unwrap();
    act(core.clone(), window.clone()).join().unwrap().unwrap();
    assert!(rx.try_recv().is_err());
    assert_eq!(registry.store_requests.lock().unwrap().len(), 2);
    core.handle(CoreRequest::WindowSetState { window_id: window.clone(), state: BTreeMap::from([("release".into(), json!(5)), ("success".into(), json!(false))]) }).unwrap();
    let third = act(core.clone(), window.clone());
    let (request, digest) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { window_id: window.clone(), request_id: request, digest, allow: true }).unwrap();
    third.join().unwrap().unwrap();

    let mut modified = registry.store_apps.lock().unwrap()["example"].clone();
    modified.app.current_version += 1;
    modified.version.version += 1;
    modified.version.definition.name = "직접 수정".into();
    modified.app.name = "직접 수정".into();
    crate::registry_events::apply_event(&core.inner, core.inner.generation.load(Ordering::SeqCst), DeviceEvent::AppPublished { app: modified, open: false, workspace_id: None });
    let error = act(core.clone(), window.clone()).join().unwrap().unwrap_err();
    assert_eq!(error.id.as_deref(), Some("STORECLIENT_INSTALL_LOCAL_MODIFIED"));
    core.handle(CoreRequest::DataAct { window_id: window.clone(), pointer: "/ui/children/3/on_click".into(), event: Value::Null, item: Value::Null, modifiers: None }).unwrap();
    assert!(!core.inner.state.lock().unwrap().shared.apps.iter().any(|app| app.id == "example"));
}
