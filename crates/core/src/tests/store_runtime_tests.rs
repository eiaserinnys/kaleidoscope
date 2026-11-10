use super::*;
use sha2::{Digest, Sha256};

#[test]
fn latest_poll_groups_origins_and_obeys_schedule_without_windows() {
    struct Observed {
        calls: Arc<Mutex<Vec<String>>>,
        bytes: Vec<u8>,
    }
    impl crate::store::fetch::Transport for Observed {
        fn get(&self, origin: &str, _: &[String], _: &str, _: u64) -> Result<kaleidoscope_data::public_http::PublicResponse, kaleidoscope_data::public_http::PublicHttpError> {
            self.calls.lock().unwrap().push(origin.to_owned());
            Ok(kaleidoscope_data::public_http::PublicResponse {
                status: 200, headers: BTreeMap::new(), rate_limit: None, retry_after: None,
                mime: "application/json".into(), bytes: self.bytes.clone(),
            })
        }
    }
    let (_temp, core, _, window) = store_caller();
    core.handle(CoreRequest::WindowClose { window_id: window }).unwrap();
    let (fixture, _, _) = crate::store::tests::fixture();
    let bytes = fixture.files.lock().unwrap()["/appstore/index.json"].2.clone();
    let calls = Arc::new(Mutex::new(Vec::new()));
    *core.inner.store_transport.lock().unwrap() = Some(Arc::new(Observed { calls: calls.clone(), bytes }));
    let now = Instant::now() + Duration::from_secs(11);
    crate::store_latest::tick_at(&core.inner, now);
    assert!(calls.lock().unwrap().is_empty(), "출처 앱 없이는 호출하지 않는다");
    let add = |id: &str, url: &str| {
        let definition = json!({"id":id,"name":"시험","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"시험"}}).to_string();
        let mut app = registry_app(1, &definition);
        app.app.origin = Some(kaleidoscope_contract::store::StoreOrigin {
            store_url: url.into(), store_app_id: "example".into(), release: 1, digest: "digest".into(),
        });
        crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), app);
    };
    add("one", "https://example.com/appstore/");
    add("two", "https://EXAMPLE.com:443/appstore");
    crate::store_latest::tick_at(&core.inner, Instant::now());
    assert!(calls.lock().unwrap().is_empty(), "기동 후 10초를 기다린다");
    for _ in 0..3 { crate::store_latest::tick_at(&core.inner, now); }
    wait_until(|| core.inner.state.lock().unwrap().store_latest.len() == 1);
    assert_eq!(calls.lock().unwrap().len(), 1, "같은 주소는 한 번만 읽는다");
    crate::store_latest::tick_at(&core.inner, now);
    assert_eq!(calls.lock().unwrap().len(), 1, "1시간 안에는 다시 읽지 않는다");
    add("three", "https://second.example/appstore");
    crate::store_latest::tick_at(&core.inner, now);
    wait_until(|| core.inner.state.lock().unwrap().store_latest.len() == 2);
    assert_eq!(calls.lock().unwrap().len(), 2, "새 주소는 바로 읽는다");
}

#[test]
fn badge_zero_and_non_integer_are_omitted_and_index_source_records_latest() {
    let (_temp, core, _, window) = store_caller();
    for (id, badge) in [("zero", json!(0)), ("fraction", json!({"expr":"1.5"})), ("positive", json!(2))] {
        let definition = json!({"id":id,"name":"시험","badge":badge,"requires":{"blocks":39,"modules":{}},"permissions":[],"ui":{"type":"text","value":"시험"}}).to_string();
        crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), registry_app(1, &definition));
    }
    crate::app_badges::refresh(&core.inner);
    let badges = core.inner.state.lock().unwrap().app_badges.clone();
    assert!(!badges.contains_key("zero"));
    assert!(!badges.contains_key("fraction"));
    assert_eq!(badges.get("positive"), Some(&2));
    crate::data_sources::fetch(&core.inner, &window,
        &kaleidoscope_data::SourcePlan::StoreIndex { permission: "catalog".into(), server: "https://example.com/appstore".into() },
        kaleidoscope_contract::data::SourceFormat::Json).unwrap();
    assert_eq!(core.inner.state.lock().unwrap().store_latest["https://example.com/appstore"]["example"].release, 3);
}

#[test]
fn latest_index_updates_apps_and_badge_without_an_open_store_window() {
    let (_temp, core, _registry, window) = store_caller();
    let app = json!({"id":"example","name":"시험 앱","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"시험"}}).to_string();
    let mut installed = registry_app(1, &app);
    installed.app.origin = Some(kaleidoscope_contract::store::StoreOrigin { store_url:"https://example.com/appstore".into(), store_app_id:"example".into(), release:1, digest:"digest".into() });
    installed.app.installed_version = Some(1);
    crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), installed);
    let index = crate::store::client(&core.inner, "https://example.com/appstore").unwrap().index("catalog").unwrap();
    crate::store_latest::record(&core.inner, &index);
    let state = core.inner.state.lock().unwrap();
    let def = crate::app_commands::definition_for(&state.shared, "store-caller", 1).unwrap();
    let apps = crate::data_runtime::apps_for(&state, &def).unwrap();
    assert_eq!(apps.iter().find(|app| app.id == "example").unwrap().latest.as_ref().unwrap().release, 3);
    assert_eq!(state.app_badges.get("store"), Some(&1));
    drop(state);
    core.handle(CoreRequest::WindowClose { window_id: window }).unwrap();
}

pub(super) fn store_caller() -> (TempDir, Arc<Core>, Arc<FakeRegistryClient>, String) {
    let temp = TempDir::new().unwrap();
    let definition = json!({"id":"store-caller","name":"스토어 호출자","requires":{"blocks":4,"modules":{"store":1}},
        "permissions":[{"module":"store","id":"catalog","label":"스토어"}],"ui":{"type":"text","value":"시험"}}).to_string();
    let registry = registry_client();
    let core = Arc::new(open_core_with_client(temp.path(), vec![definition], &Arc::new(FakeHost::default()), registry.clone()));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "store-caller");
    mark_connected(&core);
    *core.inner.store_transport.lock().unwrap() = Some(Arc::new(crate::store::tests::fixture().0));
    (temp, core, registry, window)
}

fn install_example(core: Arc<Core>, window: String) -> thread::JoinHandle<Result<bool, CoreError>> {
    install_example_with(core, window, false)
}

fn install_example_with(core: Arc<Core>, window: String, replace: bool) -> thread::JoinHandle<Result<bool, CoreError>> {
    thread::spawn(move || crate::store::install::install(&core.inner, &window, "catalog", json!("https://EXAMPLE.com:443/appstore/"), json!("example"), json!(3), replace))
}

/// 창 설치 동의의 소유자. 동의를 시작한 창의 앱과 판을 상태에서 읽는다.
pub(super) fn window_owner(core: &Arc<Core>, window: &str) -> kaleidoscope_contract::InstallConsentOwner {
    let state = core.inner.state.lock().unwrap();
    let win = state.shared.windows.iter().find(|candidate| candidate.id == window).unwrap();
    let owner = owner_of(window, &win.app_id);
    drop(state);
    owner
}

pub(super) fn owner_of(window: &str, app: &str) -> kaleidoscope_contract::InstallConsentOwner {
    kaleidoscope_contract::InstallConsentOwner::Window {
        window_id: window.into(),
        app_id: app.into(),
        app_version: 1,
    }
}

/// 픽스처 스토어의 3판과 같은 정의를 `example` 앱으로 설치해 둔다. `installed_version`이 현재 판과 다르면 수정본이다.
fn import_store_example(core: &Core, installed_version: u32) {
    let prepared = crate::store::client(&core.inner, "https://example.com/appstore").unwrap()
        .prepare("example", 3, "apps/example/3/manifest.json").unwrap();
    let mut installed = registry_app(1, &prepared.definition_json);
    installed.app.origin = Some(kaleidoscope_contract::store::StoreOrigin {
        store_url: "https://example.com/appstore".into(), store_app_id: "example".into(), release: 2, digest: "old-digest".into(),
    });
    installed.app.installed_version = Some(installed_version);
    crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), installed);
}

#[test]
fn store_install_transmits_connections_from_the_approved_manifest() {
    let (_temp, core, registry, window) = store_caller();
    let (mock, _, _) = crate::store::tests::fixture();
    let expected = json!([{"name":"fixture","kind":"oauth","base_url":"https://example.com","paths":["/api/"],"writable":false,"description":"시험"}]);
    let path = "/appstore/apps/example/3/manifest.json";
    {
        let mut files = mock.files.lock().unwrap();
        let mut manifest: Value = serde_json::from_slice(&files[path].2).unwrap();
        manifest["connections"] = expected.clone();
        files.get_mut(path).unwrap().2 = manifest.to_string().into_bytes();
    }
    *core.inner.store_transport.lock().unwrap() = Some(Arc::new(mock));
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, .. } = event { tx.send((request_id.clone(), digest.clone())).unwrap(); }));
    let task = install_example(core.clone(), window.clone());
    let (request_id, digest) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id, digest: digest.clone(), allow:true }).unwrap();
    assert!(task.join().unwrap().unwrap());
    let requests = registry.store_requests.lock().unwrap();
    assert_eq!(requests[0].connections.as_ref(), Some(&expected));
    assert_eq!(format!("{:x}", Sha256::digest(base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &requests[0].manifest_base64).unwrap())), digest);
}

pub(super) fn switch_cache(core: &Core) {
    let definition = json!({"id":"example","name":"새 서버 앱","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"새 서버"}}).to_string();
    let mut state = core.inner.state.lock().unwrap();
    core.inner.generation.fetch_add(1, Ordering::SeqCst);
    crate::app_commands::import_registry(&mut state, registry_app(2, &definition));
}

#[test]
fn store_install_response_from_previous_server_does_not_change_current_cache() {
    let (_temp, core, registry, window) = store_caller();
    let (consent_tx, consent_rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, store_url, .. } = event { assert_eq!(store_url, "https://example.com/appstore"); consent_tx.send((request_id.clone(), digest.clone())).unwrap(); }));
    let (ready_tx, ready_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    *registry.store_install_pause.lock().unwrap() = Some((ready_tx, resume_rx));
    let task = install_example(core.clone(), window.clone());
    let (request_id, digest) = consent_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id, digest, allow:true }).unwrap();
    ready_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    switch_cache(&core);
    resume_tx.send(()).unwrap();
    assert_eq!(task.join().unwrap().unwrap_err().id.as_deref(), Some("STORECLIENT_INSTALL_CONTEXT_CHANGED"));
    let state = core.inner.state.lock().unwrap();
    assert_eq!(state.shared.apps.iter().find(|a| a.id == "example").unwrap().name, "새 서버 앱");
}

#[test]
fn store_install_does_not_send_after_server_changes_during_consent() {
    let (_temp, core, registry, window) = store_caller();
    let (consent_tx, consent_rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, .. } = event { consent_tx.send((request_id.clone(), digest.clone())).unwrap(); }));
    let task = install_example(core.clone(), window.clone());
    let (request_id, digest) = consent_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    switch_cache(&core);
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id, digest, allow:true }).unwrap();
    assert_eq!(task.join().unwrap().unwrap_err().id.as_deref(), Some("STORECLIENT_INSTALL_CONTEXT_CHANGED"));
    assert!(registry.store_requests.lock().unwrap().is_empty());
}

#[test]
fn store_remove_response_from_previous_server_does_not_change_current_cache() {
    let (_temp, core, registry, window) = store_caller();
    let old = json!({"id":"example","name":"이전 서버 앱","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"이전"}}).to_string();
    crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), registry_app(1, &old));
    let (ready_tx, ready_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    *registry.store_remove_pause.lock().unwrap() = Some((ready_tx, resume_rx));
    let target = core.clone();
    let task = thread::spawn(move || crate::store::install::remove(&target.inner, &window, "catalog", json!("example")));
    ready_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    switch_cache(&core);
    resume_tx.send(()).unwrap();
    assert_eq!(task.join().unwrap().unwrap_err().id.as_deref(), Some("STORECLIENT_INSTALL_CONTEXT_CHANGED"));
    let state = core.inner.state.lock().unwrap();
    assert_eq!(state.shared.apps.iter().find(|a| a.id == "example").unwrap().name, "새 서버 앱");
}

#[test]
fn store_consent_registration_after_shutdown_cancels_immediately() {
    let (_temp, core, _registry, window) = store_caller();
    let definition = core.inner.state.lock().unwrap().shared.app_versions.iter().find(|a| a.app_id == "store-caller").unwrap().definition.clone();
    core.shutdown();
    let (tx, rx) = mpsc::channel();
    let waiter = core.clone();
    thread::spawn(move || { let _ = tx.send(crate::installation_consent::wait(&waiter.inner, &window, "store-caller", 1, 3, "https://example.com/appstore", "digest", &definition, None, false, false)); });
    assert!(!rx.recv_timeout(Duration::from_secs(2)).expect("종료 후 동의 등록이 대기했습니다").unwrap());
}

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
    let directory = directory.canonicalize().unwrap();
    let path = directory.join("store_test_db.sqlite");
    std::env::set_var("TEST_DATABASE_URL", &path);
    let path = PathBuf::from(std::env::var_os("TEST_DATABASE_URL").unwrap());
    assert_eq!(path.parent(), Some(directory.as_path()));
    assert_eq!(path.file_name().and_then(|name| name.to_str()), Some("store_test_db.sqlite"));
    let server = kaleidoscope_orchestrator::AppState::open(&path, "test-mcp-token".into()).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    for table in ["devices", "apps", "asset_versions"] {
        let count: i64 = db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).unwrap();
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
    let task = thread::spawn(move || crate::installation_consent::wait(&waiter.inner, &wait_window, "consent-fixture", 1, 1, "https://example.com/appstore", "digest", &app, None, false, false));
    let id = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let error = core.handle(CoreRequest::AppRespondInstallPermission { owner: owner_of("other", "consent-fixture"), request_id: id.clone(), digest:"digest".into(), allow:true }).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("STORECLIENT_INSTALL_WINDOW_MISMATCH"));
    let error = core.handle(CoreRequest::AppRespondInstallPermission { owner: owner_of(&window, "consent-fixture"), request_id: id, digest:"other".into(), allow:true }).unwrap_err();
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
        "id":"store-tester", "name":"스토어 시험", "requires":{"blocks":4,"modules":{"store":4}},
        "permissions":[{"module":"store","id":"catalog","label":"스토어"}],
        "state":{"release":3,"success":false},
        "sources":{"catalog":{"kind":"store","store":"index","permission":"catalog","server":"https://example.com/appstore"}},
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"text","value":{"expr":"$data.catalog.items[0].name"}},
            {"type":"text","value":{"expr":"$count($apps[id = 'example'])"}},
            {"type":"button","label":"설치","on_click":[{"store.install":{"permission":"catalog","server":"https://example.com/appstore","id":"example","release":{"state":"release"}}},{"set_state":"success","value":true}]},
            {"type":"button","label":"삭제","on_click":[{"store.remove":{"permission":"catalog","id":"example"}}]},
            {"type":"button","label":"스토어 판으로 바꾸기","on_click":[{"store.install":{"permission":"catalog","server":"https://example.com/appstore","id":"example","release":{"state":"release"},"replace":true}}]}
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
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: false }).unwrap();
    first.join().unwrap().unwrap();
    assert!(registry.store_requests.lock().unwrap().is_empty());
    let db = rusqlite::Connection::open(&database).unwrap();
    for table in ["apps", "asset_versions"] {
        let count: i64 = db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
    assert_eq!(core.inner.state.lock().unwrap().shared.windows.iter().find(|w| w.id == window).unwrap().state["success"], json!(false));

    let raced = act(core.clone(), window.clone());
    let (request, digest) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let prepared = crate::store::client(&core.inner, "https://example.com/appstore").unwrap()
        .prepare("example", 3, "apps/example/3/manifest.json").unwrap();
    let concurrent = kaleidoscope_contract::store::DeviceInstallRequest {
        definition_json: prepared.definition_json,
        asset_uploads: prepared.assets,
        connections: prepared.connections,
        manifest_base64: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, prepared.manifest),
        approved_digest: prepared.digest.clone(),
        origin: kaleidoscope_contract::store::StoreOrigin { store_url: "https://example.com/appstore".into(), store_app_id: "example".into(), release: 3, digest: prepared.digest },
        expected_current_version: None,
        replace: false,
    };
    let _: kaleidoscope_contract::store::DeviceInstallReply = server_request(&server, "POST", "/api/device/app-installs", &concurrent).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: true }).unwrap();
    let error = raced.join().unwrap().unwrap_err();
    assert_eq!(error.id.as_deref(), Some("REGISTRYINSTALL_EXPECTED_VERSION_CONFLICT"));
    let _: Value = server_request(&server, "DELETE", "/api/device/apps/example", &kaleidoscope_contract::store::DeviceRemoveRequest { expected_current_version: std::num::NonZeroU32::new(1).unwrap(), allow_custom: false }).unwrap();
    registry.store_requests.lock().unwrap().clear();

    let second = act(core.clone(), window.clone());
    let (request, digest) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: true }).unwrap();
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
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: true }).unwrap();
    third.join().unwrap().unwrap();

    let mut modified_definition = registry.store_apps.lock().unwrap()["example"].version.definition.clone();
    modified_definition.name = "직접 수정".into();
    let (modified, _) = server.publish_app(&serde_json::to_string(&modified_definition).unwrap(), "agent", false, None).unwrap();
    crate::registry_events::apply_event(&core.inner, core.inner.generation.load(Ordering::SeqCst), DeviceEvent::AppPublished { app: modified, open: false, workspace_id: None });
    let error = act(core.clone(), window.clone()).join().unwrap().unwrap_err();
    assert_eq!(error.id.as_deref(), Some("STORECLIENT_INSTALL_LOCAL_MODIFIED"));
    core.handle(CoreRequest::DataAct { window_id: window.clone(), pointer: "/ui/children/3/on_click".into(), event: Value::Null, item: Value::Null, modifiers: None }).unwrap();
    assert!(!core.inner.state.lock().unwrap().shared.apps.iter().any(|app| app.id == "example"));
    let active: i64 = db.query_row("SELECT COUNT(*) FROM apps WHERE id='example' AND deleted_at IS NULL", [], |row| row.get(0)).unwrap();
    assert_eq!(active, 0);

    // 커스텀 앱을 스토어 판으로 바꿔도 창과 저장값은 그대로 남는다.
    let custom = json!({"id":"example","name":"손수 만든 앱","requires":{"blocks":4,"modules":{}},"permissions":[],
        "state":{"draft":""},"ui":{"type":"text","value":"손수"}}).to_string();
    let (custom, _) = server.publish_app(&custom, "agent", false, None).unwrap();
    crate::registry_events::apply_event(&core.inner, core.inner.generation.load(Ordering::SeqCst), DeviceEvent::AppPublished { app: custom, open: false, workspace_id: None });
    let custom_window = open_window(&core, &desktop, "example");
    core.handle(CoreRequest::WindowSetState { window_id: custom_window.clone(), state: BTreeMap::from([("draft".into(), json!("남긴 글"))]) }).unwrap();
    let replaced = thread::spawn({ let core = core.clone(); let window = window.clone(); move || core.handle(CoreRequest::DataAct {
        window_id: window, pointer: "/ui/children/4/on_click".into(), event: Value::Null, item: Value::Null, modifiers: None
    }) });
    let (request, digest) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: true }).unwrap();
    replaced.join().unwrap().unwrap();
    assert!(registry.store_requests.lock().unwrap().last().unwrap().replace);
    let state = core.inner.state.lock().unwrap();
    let kept = state.shared.windows.iter().find(|candidate| candidate.id == custom_window).unwrap();
    assert_eq!(kept.app_id, "example");
    assert_eq!(kept.state["draft"], json!("남긴 글"));
    assert_eq!(state.shared.apps.iter().find(|app| app.id == "example").unwrap().origin.as_ref().unwrap().store_url, "https://example.com/appstore");
}

#[test]
fn store_consent_reports_the_installed_release_only_when_updating() {
    let (_temp, core, _, window) = store_caller();
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, installed_release, .. } = event {
        tx.send((request_id.clone(), digest.clone(), *installed_release)).unwrap();
    }));
    let fresh = install_example(core.clone(), window.clone());
    let (request, digest, installed_release) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(installed_release, None, "새 설치는 업데이트로 묻지 않는다");
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: false }).unwrap();
    assert!(!fresh.join().unwrap().unwrap());

    let prepared = crate::store::client(&core.inner, "https://example.com/appstore").unwrap()
        .prepare("example", 3, "apps/example/3/manifest.json").unwrap();
    let mut previous: Value = serde_json::from_str(&prepared.definition_json).unwrap();
    previous["permissions"] = json!([{"module":"process","id":"run","label":"실행"}]);
    previous["requires"]["modules"]["process"] = json!(1);
    let mut installed = registry_app(1, &previous.to_string());
    installed.app.origin = Some(kaleidoscope_contract::store::StoreOrigin {
        store_url: "https://example.com/appstore".into(), store_app_id: "example".into(), release: 2, digest: "old-digest".into(),
    });
    installed.app.installed_version = Some(1);
    crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), installed);

    let update = install_example(core.clone(), window.clone());
    let (request, digest, installed_release) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(installed_release, Some(2), "깔린 판의 스토어 판을 알린다");
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: false }).unwrap();
    assert!(!update.join().unwrap().unwrap());
}

#[test]
fn replace_consents_even_with_the_same_scope_and_sends_replace_with_the_prepared_bytes() {
    let (_temp, core, registry, window) = store_caller();
    import_store_example(&core, 1);
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, from_origin, replacing, modified, .. } = event {
        tx.send((request_id.clone(), digest.clone(), from_origin.clone(), *replacing, *modified)).unwrap();
    }));

    let first = install_example_with(core.clone(), window.clone(), true);
    let (request, digest, from_origin, replacing, modified) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(from_origin.map(|origin| origin.release), Some(2), "현재 스토어 출처를 알린다");
    assert!(!replacing, "같은 출처의 보통 갱신은 대체가 아니다");
    assert!(!modified);
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: false }).unwrap();
    assert!(!first.join().unwrap().unwrap());
    assert!(registry.store_requests.lock().unwrap().is_empty(), "취소하면 서버에 보내지 않는다");

    let second = install_example_with(core.clone(), window.clone(), true);
    let (request, digest, _, _, _) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest: digest.clone(), allow: true }).unwrap();
    assert!(second.join().unwrap().unwrap());
    let requests = registry.store_requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].replace, "승인한 요청은 replace를 실어 보낸다");
    assert_eq!(requests[0].expected_current_version.and_then(|version| Some(version.get())), Some(1));
    assert_eq!(format!("{:x}", Sha256::digest(base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &requests[0].manifest_base64).unwrap())), digest, "동의한 묶음과 같은 바이트를 보낸다");
}

#[test]
fn replace_bypasses_the_local_modified_precheck_and_warns() {
    let (_temp, core, registry, window) = store_caller();
    import_store_example(&core, 2);
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, from_origin, replacing, modified, .. } = event {
        tx.send((request_id.clone(), digest.clone(), from_origin.is_some(), *replacing, *modified)).unwrap();
    }));
    let task = install_example_with(core.clone(), window.clone(), true);
    let (request, digest, from_origin, replacing, modified) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(from_origin);
    assert!(replacing, "고친 앱을 되돌리는 것은 대체다");
    assert!(modified, "고친 내용을 대체한다고 알린다");
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: false }).unwrap();
    assert!(!task.join().unwrap().unwrap());
    assert!(registry.store_requests.lock().unwrap().is_empty());
}

#[test]
fn replace_of_a_custom_app_consents_without_an_origin() {
    let (_temp, core, registry, window) = store_caller();
    let custom = json!({"id":"example","name":"손수 만든 앱","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"손수"}}).to_string();
    crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), registry_app(1, &custom));
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, from_origin, replacing, modified, .. } = event {
        tx.send((request_id.clone(), digest.clone(), from_origin.is_some(), *replacing, *modified)).unwrap();
    }));
    let task = install_example_with(core.clone(), window.clone(), true);
    let (request, digest, from_origin, replacing, modified) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(!from_origin, "커스텀 앱에는 스토어 출처가 없다");
    assert!(replacing);
    assert!(!modified);
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: true }).unwrap();
    assert!(task.join().unwrap().unwrap());
    assert!(registry.store_requests.lock().unwrap()[0].replace);
}

#[test]
fn replace_install_does_not_send_after_the_origin_changes_with_the_same_version_during_consent() {
    let (_temp, core, registry, window) = store_caller();
    import_store_example(&core, 1);
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, replacing, .. } = event {
        tx.send((request_id.clone(), digest.clone(), *replacing)).unwrap();
    }));
    let task = install_example_with(core.clone(), window.clone(), true);
    let (request, digest, replacing) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(!replacing, "같은 출처의 보통 갱신으로 동의를 받는다");
    // 동의를 기다리는 사이 다른 요청이 같은 정의를 다른 스토어에서 설치해 판 번호는 그대로이고 출처만 바뀐다.
    {
        let mut state = core.inner.state.lock().unwrap();
        let app = state.shared.apps.iter_mut().find(|app| app.id == "example").unwrap();
        app.origin = Some(kaleidoscope_contract::store::StoreOrigin {
            store_url: "https://other.example.com/appstore".into(), store_app_id: "example".into(), release: 7, digest: "other-digest".into(),
        });
    }
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: true }).unwrap();
    assert_eq!(task.join().unwrap().unwrap_err().id.as_deref(), Some("STORECLIENT_INSTALL_CONTEXT_CHANGED"));
    assert!(registry.store_requests.lock().unwrap().is_empty(), "보통 갱신에 동의한 요청으로 다른 출처를 대체하지 않는다");
}

#[test]
fn replace_install_maps_a_link_change_during_consent_to_context_changed() {
    let (_temp, core, registry, window) = store_caller();
    import_store_example(&core, 1);
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::AppInstallPermission { request_id, digest, .. } = event {
        tx.send((request_id.clone(), digest.clone())).unwrap();
    }));
    let task = install_example_with(core.clone(), window.clone(), true);
    let (request, digest) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::LinkUnlink {}).unwrap();
    core.handle(CoreRequest::AppRespondInstallPermission { owner: window_owner(&core, &window), request_id: request, digest, allow: true }).unwrap();
    assert_eq!(task.join().unwrap().unwrap_err().id.as_deref(), Some("STORECLIENT_INSTALL_CONTEXT_CHANGED"));
    assert!(registry.store_requests.lock().unwrap().is_empty(), "바뀐 링크로 서버에 보내지 않는다");
}

#[test]
fn server_consent_persists_only_after_approval_and_cancels_on_close() {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let (temp, core, _, window) = store_caller();
    *core.inner.store_transport.lock().unwrap() = None;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let server = format!("http://{}/appstore", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::StoreServerPermission { request_id, server, .. } = event {
        tx.send((request_id.clone(), server.clone())).unwrap();
    }));
    let start = |core: Arc<Core>, window: String, server: String| thread::spawn(move ||
        crate::store_server_consent::allow(&core.inner, &window, "catalog", json!(format!("{server}/"))));
    let first = start(core.clone(), window.clone(), server.clone());
    let (id, requested) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(requested, server);
    assert!(core.inner.state.lock().unwrap().device.store_servers.is_empty());
    assert_eq!(crate::store::client(&core.inner, &server).err().unwrap().id.as_deref(), Some("STORECLIENT_SERVER_PERMISSION_REQUIRED"));
    assert_eq!(listener.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
    core.handle(CoreRequest::StoreRespondServerPermission { window_id: window.clone(), request_id: id, server: server.clone(), allow: false }).unwrap();
    assert!(!first.join().unwrap().unwrap());
    assert!(core.inner.state.lock().unwrap().device.store_servers.is_empty());

    let second = start(core.clone(), window.clone(), server.clone());
    let (id, requested) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(requested, server);
    assert_eq!(listener.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
    core.handle(CoreRequest::StoreRespondServerPermission { window_id: window.clone(), request_id: id, server: server.clone(), allow: true }).unwrap();
    assert!(second.join().unwrap().unwrap());
    assert_eq!(core.inner.state.lock().unwrap().device.store_servers, [server.clone()]);
    assert_eq!(crate::storage::load_device(temp.path()).unwrap().store_servers, [server.clone()]);

    let (fixture, _, _) = crate::store::tests::fixture();
    let body = fixture.files.lock().unwrap()["/appstore/index.json"].2.clone();
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match listener.accept() {
                Ok((mut socket, _)) => {
                    socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                    let mut request = [0; 8192];
                    let count = socket.read(&mut request).unwrap();
                    assert!(String::from_utf8_lossy(&request[..count]).starts_with("GET /appstore/index.json "));
                    write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                    socket.write_all(&body).unwrap();
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
                Err(e) => panic!("{e}"),
            }
        }
    });
    let index = crate::store::client(&core.inner, &server).unwrap().index("catalog").unwrap();
    assert_eq!(index.items[0].id, "example");
    worker.join().unwrap();
    assert!(crate::store_server_consent::allow(&core.inner, &window, "catalog", json!(server)).unwrap());
    assert!(rx.try_recv().is_err());

    let pending = thread::spawn({ let core = core.clone(); let window = window.clone(); move ||
        crate::store_server_consent::allow(&core.inner, &window, "catalog", json!("http://127.0.0.1:8080")) });
    rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::WindowClose { window_id: window }).unwrap();
    assert!(!pending.join().unwrap().unwrap());
}

#[test]
fn server_consent_rejects_mismatched_response_and_cancels_on_context_changes() {
    let (_temp, core, _, window) = store_caller();
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::StoreServerPermission { request_id, server, .. } = event {
        tx.send((request_id.clone(), server.clone())).unwrap();
    }));
    let start = |core: Arc<Core>, window: String| thread::spawn(move ||
        crate::store_server_consent::allow(&core.inner, &window, "catalog", json!("http://127.0.0.1:8080")));
    let pending = start(core.clone(), window.clone());
    let (id, server) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let answer = |window_id: String, request_id: String, server: String| core.handle(CoreRequest::StoreRespondServerPermission { window_id, request_id, server, allow: true });
    assert_eq!(answer("other".into(), id.clone(), server.clone()).unwrap_err().id.as_deref(), Some("STORECLIENT_SERVER_ALLOW_WINDOW_MISMATCH"));
    assert_eq!(answer(window.clone(), id.clone(), "http://other".into()).unwrap_err().id.as_deref(), Some("STORECLIENT_SERVER_ALLOW_TARGET_MISMATCH"));
    {
        let mut state = core.inner.state.lock().unwrap();
        state.shared.windows.iter_mut().find(|w| w.id == window).unwrap().app_version += 1;
    }
    crate::store_server_consent::state_changed(&core.inner);
    assert!(!pending.join().unwrap().unwrap());
    assert_eq!(answer(window.clone(), id, server).unwrap_err().id.as_deref(), Some("STORECLIENT_SERVER_ALLOW_REQUEST_EXPIRED"));
    {
        let mut state = core.inner.state.lock().unwrap();
        state.shared.windows.iter_mut().find(|w| w.id == window).unwrap().app_version -= 1;
    }
    let pending = start(core.clone(), window.clone());
    rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::LinkUnlink {}).unwrap();
    assert!(!pending.join().unwrap().unwrap());
    let pending = start(core.clone(), window);
    rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.shutdown();
    assert!(!pending.join().unwrap().unwrap());
}

#[test]
fn server_consent_cancel_stops_following_action() {
    let temp = TempDir::new().unwrap();
    let definition = json!({"id":"allow-tester","name":"스토어 시험","requires":{"blocks":4,"modules":{"store":3}},
        "permissions":[{"module":"store","id":"catalog","label":"스토어"}],"state":{"success":false},
        "ui":{"type":"button","label":"연결","on_click":[
            {"store.allow_server":{"permission":"catalog","server":"http://127.0.0.1:8080"}},
            {"set_state":"success","value":true}
        ]}
    }).to_string();
    let core = Arc::new(open_core_with_client(temp.path(), vec![definition], &Arc::new(FakeHost::default()), registry_client()));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "allow-tester");
    mark_connected(&core);
    core.handle(CoreRequest::DataAttach { window_id:window.clone(), dormant:vec![] }).unwrap();
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| if let CoreEvent::StoreServerPermission { request_id, server, .. } = event {
        tx.send((request_id.clone(), server.clone())).unwrap();
    }));
    let task = thread::spawn({ let core=core.clone(); let window=window.clone(); move || core.handle(CoreRequest::DataAct {
        window_id:window, pointer:"/ui/on_click".into(), event:Value::Null, item:Value::Null, modifiers:None
    }) });
    let (request_id, server) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    core.handle(CoreRequest::StoreRespondServerPermission { window_id:window.clone(), request_id, server, allow:false }).unwrap();
    task.join().unwrap().unwrap();
    assert_eq!(core.inner.state.lock().unwrap().shared.windows.iter().find(|w| w.id == window).unwrap().state["success"], json!(false));
}
