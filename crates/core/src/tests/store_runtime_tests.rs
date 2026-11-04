use super::*;
use sha2::{Digest, Sha256};

pub(super) fn server_request<T: serde::de::DeserializeOwned>(server: &kaleidoscope_orchestrator::AppState, method: &str, path: &str, body: &impl serde::Serialize) -> Result<T, RegistryError> {
    use tower::ServiceExt;
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    runtime.block_on(async {
        let request = axum::http::Request::builder().method(method).uri(path)
            .header("authorization", "Bearer test-token").header("content-type", "application/json")
            .body(axum::body::Body::from(serde_json::to_vec(body).unwrap())).unwrap();
        let response = kaleidoscope_orchestrator::router(server.clone()).oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        if !status.is_success() {
            return Err(RegistryError::Validation(serde_json::from_slice(&bytes).unwrap()));
        }
        Ok(serde_json::from_slice(&bytes).unwrap())
    })
}

fn test_server(directory: &Path) -> (kaleidoscope_orchestrator::AppState, PathBuf) {
    let path = directory.join("store_test_db.sqlite");
    std::env::set_var("TEST_DATABASE_URL", &path);
    let path = PathBuf::from(std::env::var_os("TEST_DATABASE_URL").unwrap());
    let name = path.to_string_lossy();
    assert!(name.contains("test") && !["atom_db", "reverie", "soulstream", "serendipity"].iter().any(|production| name.contains(production)));
    let server = kaleidoscope_orchestrator::AppState::open(&path, "test-mcp-token".into()).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    for table in ["devices", "apps", "asset_versions"] {
        let count: u64 = db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0, "시험 DB {table}에 기존 자료가 있습니다");
    }
    let token_hash = format!("{:x}", Sha256::digest(b"test-token"));
    db.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('test-device','시험', (SELECT account_id FROM mcp_principal WHERE id=1), ?1, 'now')", [&token_hash]).unwrap();
    (server, path)
}

#[test]
fn closing_the_window_cancels_pending_consent() {
    let temp = TempDir::new().unwrap();
    let definition = json!({"id":"consent-fixture","name":"동의 시험","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"시험"}}).to_string();
    let core = Arc::new(open_core(temp.path(), vec![definition.clone()], &Arc::new(FakeHost::default())));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "consent-fixture");
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, .. } = event { tx.send(request_id.clone()).unwrap(); }));
    let waiter = core.clone();
    let wait_window = window.clone();
    let app: kaleidoscope_contract::AppDefinition = serde_json::from_str(&definition).unwrap();
    let task = thread::spawn(move || crate::installation_consent::wait(&waiter.inner, &wait_window, "consent-fixture", 1, 1, "digest", &app));
    let id = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let error = core.handle(CoreRequest::AppRespondInstallPermission { window_id: "other".into(), request_id: id.clone(), digest:"digest".into(), allow:true }).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("STORECLIENT_INSTALL_WINDOW_MISMATCH"));
    let error = core.handle(CoreRequest::AppRespondInstallPermission { window_id: window.clone(), request_id: id, digest:"other".into(), allow:true }).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("STORECLIENT_INSTALL_DIGEST_MISMATCH"));
    core.handle(CoreRequest::WindowClose { window_id: window }).unwrap();
    assert!(!task.join().unwrap().unwrap());
}

#[test]
fn same_definition_and_version_still_updates_the_store_origin() {
    let temp = TempDir::new().unwrap();
    let core = open_core_with_client(temp.path(), vec![], &Arc::new(FakeHost::default()), registry_client());
    mark_connected(&core);
    let definition = json!({"id":"origin-fixture","name":"출처 시험","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"시험"}}).to_string();
    let mut app = registry_app(1, &definition);
    let origin = kaleidoscope_contract::store::StoreOrigin { store_url:"https://store.example".into(), store_app_id:"origin-fixture".into(), release:1, digest:"old".into() };
    app.app.origin = Some(origin);
    app.app.installed_version = Some(1);
    let generation = core.inner.generation.load(Ordering::SeqCst);
    crate::registry_events::apply_event(&core.inner, generation, DeviceEvent::AppPublished { app: app.clone(), open:false, workspace_id:None });
    app.app.origin.as_mut().unwrap().release = 2;
    app.app.origin.as_mut().unwrap().digest = "new".into();
    crate::registry_events::apply_event(&core.inner, generation, DeviceEvent::AppPublished { app, open:false, workspace_id:None });
    let state = core.inner.state.lock().unwrap();
    let installed = state.shared.apps.iter().find(|a| a.id == "origin-fixture").unwrap();
    assert_eq!(installed.current_version, 1);
    assert_eq!(installed.origin.as_ref().unwrap().release, 2);
}

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
    let (server, database) = test_server(temp.path());
    *registry.store_server.lock().unwrap() = Some(server.clone());
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
    let db = rusqlite::Connection::open(&database).unwrap();
    for table in ["apps", "asset_versions"] {
        let count: u64 = db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
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

    let mut modified_definition = registry.store_apps.lock().unwrap()["example"].version.definition.clone();
    modified_definition.name = "직접 수정".into();
    let (modified, _) = server.publish_app(&serde_json::to_string(&modified_definition).unwrap(), "agent", false, None).unwrap();
    crate::registry_events::apply_event(&core.inner, core.inner.generation.load(Ordering::SeqCst), DeviceEvent::AppPublished { app: modified, open: false, workspace_id: None });
    let error = act(core.clone(), window.clone()).join().unwrap().unwrap_err();
    assert_eq!(error.id.as_deref(), Some("STORECLIENT_INSTALL_LOCAL_MODIFIED"));
    core.handle(CoreRequest::DataAct { window_id: window.clone(), pointer: "/ui/children/3/on_click".into(), event: Value::Null, item: Value::Null, modifiers: None }).unwrap();
    assert!(!core.inner.state.lock().unwrap().shared.apps.iter().any(|app| app.id == "example"));
    let active: u64 = db.query_row("SELECT COUNT(*) FROM apps WHERE id='example' AND deleted_at IS NULL", [], |row| row.get(0)).unwrap();
    assert_eq!(active, 0);
}
