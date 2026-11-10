//! MCP가 보낸 기기 갱신 요청을 코어가 처리하는 경로. 준비, 동의 정책, 확정을 확인한다.
use super::*;
use kaleidoscope_contract::store::StoreOrigin;
use kaleidoscope_contract::{
    InstallConsentOwner, StoreUpdateRequest, StoreUpdateResponse, StoreUpdateResult,
};

const STORE: &str = "https://example.com/appstore";
const OTHER_STORE: &str = "https://other.example/appstore";

struct Consent {
    owner: InstallConsentOwner,
    request_id: String,
    release: u32,
    store_url: String,
    from_origin: Option<StoreOrigin>,
    replacing: bool,
    modified: bool,
    digest: String,
}

fn setup() -> (TempDir, Arc<Core>, Arc<FakeRegistryClient>) {
    let (temp, core, registry, window) = store_runtime_tests::store_caller();
    core.handle(CoreRequest::WindowClose { window_id: window }).unwrap();
    (temp, core, registry)
}

fn request(app: &str, store_url: Option<&str>, replace: bool) -> StoreUpdateRequest {
    StoreUpdateRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        app_id: app.into(),
        store_url: store_url.map(Into::into),
        replace,
        expires_at: (chrono::Utc::now() + chrono::Duration::seconds(60)).to_rfc3339(),
    }
}

fn generation(core: &Core) -> u64 {
    core.inner.generation.load(Ordering::SeqCst)
}

/// 기기 이벤트를 처리하는 실제 경로로 요청을 넣고 request_id를 돌려준다.
fn deliver(core: &Arc<Core>, request: StoreUpdateRequest) -> String {
    let request_id = request.request_id.clone();
    crate::store_update::handle_device_event(&core.inner, generation(core), request);
    request_id
}

fn response(registry: &FakeRegistryClient, request_id: &str) -> StoreUpdateResponse {
    wait_until(|| {
        registry
            .store_update_responses
            .lock()
            .unwrap()
            .iter()
            .any(|response| response.request_id == request_id)
    });
    registry
        .store_update_responses
        .lock()
        .unwrap()
        .iter()
        .find(|response| response.request_id == request_id)
        .cloned()
        .unwrap()
}

fn consents(core: &Core) -> mpsc::Receiver<Consent> {
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::AppInstallPermission {
            owner,
            request_id,
            release,
            store_url,
            from_origin,
            replacing,
            modified,
            digest,
            ..
        } = event
        {
            let _ = tx.send(Consent {
                owner: owner.clone(),
                request_id: request_id.clone(),
                release: *release,
                store_url: store_url.clone(),
                from_origin: from_origin.clone(),
                replacing: *replacing,
                modified: *modified,
                digest: digest.clone(),
            });
        }
    }));
    rx
}

fn store_definition(core: &Core) -> String {
    crate::store::client(&core.inner, STORE)
        .unwrap()
        .prepare("example", 3, "apps/example/3/manifest.json")
        .unwrap()
        .definition_json
}

fn origin(store_url: &str, release: u32) -> StoreOrigin {
    StoreOrigin {
        store_url: store_url.into(),
        store_app_id: "example".into(),
        release,
        digest: "old-digest".into(),
    }
}

/// 기기에 이미 설치된 앱과 서버 쪽 같은 앱을 만든다. 정의가 다르면 새 판을 올린 것으로 본다.
fn install(
    core: &Core,
    registry: &FakeRegistryClient,
    current_version: u32,
    store_url: &str,
    release: u32,
    installed_version: Option<u32>,
    definition: &str,
) {
    let mut app = registry_app(current_version, definition);
    app.app.origin = Some(origin(store_url, release));
    app.app.installed_version = installed_version;
    registry
        .store_apps
        .lock()
        .unwrap()
        .insert(app.app.id.clone(), app.clone());
    crate::app_commands::import_registry(&mut core.inner.state.lock().unwrap(), app);
}

fn app(core: &Core) -> App {
    let state = core.inner.state.lock().unwrap();
    state
        .shared
        .apps
        .iter()
        .find(|app| app.id == "example")
        .cloned()
        .expect("설치된 앱")
}

#[test]
fn the_same_release_installs_without_consent_and_answers_unchanged() {
    let (_temp, core, registry) = setup();
    install(&core, &registry, 3, STORE, 3, Some(3), &store_definition(&core));
    registry
        .store_install_unchanged
        .store(true, Ordering::SeqCst);
    let consents = consents(&core);
    let request_id = deliver(&core, request("example", None, false));
    match response(&registry, &request_id).result {
        StoreUpdateResult::Unchanged { origin, version } => {
            assert_eq!(origin.store_url, STORE);
            assert_eq!(origin.release, 3);
            assert_eq!(version, 3);
        }
        other => panic!("같은 판인데 다른 결과: {other:?}"),
    }
    assert!(consents.recv_timeout(Duration::from_millis(200)).is_err());
    let requests = registry.store_requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(!requests[0].replace);
    assert_eq!(requests[0].origin.store_url, STORE);
    assert_eq!(requests[0].origin.release, 3);
    assert_eq!(
        requests[0].expected_current_version.map(|value| value.get()),
        Some(3)
    );
}

#[test]
fn a_new_release_with_the_same_definition_is_installed_without_consent() {
    let (_temp, core, registry) = setup();
    // 출처의 release만 2판이고 정의는 스토어의 3판과 같다. 설치 뒤 서버가 출처를 갱신한다.
    install(&core, &registry, 3, STORE, 2, Some(3), &store_definition(&core));
    let consents = consents(&core);
    let request_id = deliver(&core, request("example", None, false));
    match response(&registry, &request_id).result {
        StoreUpdateResult::Installed { origin, version } => {
            assert_eq!(origin.release, 3);
            assert_eq!(version, 3);
        }
        other => panic!("출처만 바뀐 설치인데 다른 결과: {other:?}"),
    }
    assert!(consents.recv_timeout(Duration::from_millis(200)).is_err());
    assert_eq!(registry.store_requests.lock().unwrap()[0].origin.release, 3);
    let app = app(&core);
    assert_eq!(app.origin.unwrap().release, 3);
    assert_eq!(app.installed_version, Some(app.current_version));
}

#[test]
fn a_different_store_without_replace_is_rejected() {
    let (_temp, core, registry) = setup();
    install(
        &core,
        &registry,
        3,
        OTHER_STORE,
        3,
        Some(3),
        &store_definition(&core),
    );
    let consents = consents(&core);
    let request_id = deliver(&core, request("example", Some(STORE), false));
    match response(&registry, &request_id).result {
        StoreUpdateResult::Error { error } => {
            assert_eq!(error.id.as_deref(), Some("REGISTRYINSTALL_ORIGIN_CONFLICT"));
        }
        other => panic!("다른 출처를 replace 없이 받아들였다: {other:?}"),
    }
    assert!(consents.recv_timeout(Duration::from_millis(200)).is_err());
    assert!(registry.store_requests.lock().unwrap().is_empty());
    assert_eq!(app(&core).origin.unwrap().store_url, OTHER_STORE);
}

#[test]
fn replace_with_the_same_review_scope_installs_without_consent() {
    let (_temp, core, registry) = setup();
    install(
        &core,
        &registry,
        3,
        OTHER_STORE,
        3,
        Some(3),
        &store_definition(&core),
    );
    let consents = consents(&core);
    let request_id = deliver(&core, request("example", Some(STORE), true));
    match response(&registry, &request_id).result {
        StoreUpdateResult::Installed { origin, .. } => assert_eq!(origin.store_url, STORE),
        other => panic!("같은 scope의 replace가 설치되지 않았다: {other:?}"),
    }
    assert!(consents.recv_timeout(Duration::from_millis(200)).is_err());
    let requests = registry.store_requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].replace);
    assert_eq!(requests[0].origin.store_url, STORE);
    drop(requests);
    assert_eq!(app(&core).origin.unwrap().store_url, STORE);
}

#[test]
fn a_changed_review_scope_asks_the_shell_and_installs_after_approval() {
    let (_temp, core, registry) = setup();
    // 같은 스토어에서 설치했지만 권한 검토 범위(워커)가 다른 판이다. 로컬 수정본은 아니다.
    let mut changed: Value = serde_json::from_str(&store_definition(&core)).unwrap();
    changed["worker"]["code"] = json!("print(2)");
    install(
        &core,
        &registry,
        2,
        STORE,
        2,
        Some(2),
        &changed.to_string(),
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "example");
    core.handle(CoreRequest::WindowSetState {
        window_id: window.clone(),
        state: BTreeMap::from([("draft".into(), json!("남길 글"))]),
    })
    .unwrap();

    let consents = consents(&core);
    let request_id = deliver(&core, request("example", None, false));
    let consent = consents.recv_timeout(Duration::from_secs(5)).unwrap();
    match &consent.owner {
        InstallConsentOwner::Shell {
            generation: owner_generation,
            request_id: owner_request,
        } => {
            assert_eq!(*owner_generation, generation(&core));
            assert_eq!(owner_request, &consent.request_id);
        }
        other => panic!("쉘 전체 동의가 아닌 소유자: {other:?}"),
    }
    assert_eq!(consent.release, 3);
    assert_eq!(consent.store_url, STORE);
    assert_eq!(consent.from_origin, Some(origin(STORE, 2)));
    assert!(!consent.replacing);
    assert!(!consent.modified);
    match response(&registry, &request_id).result {
        StoreUpdateResult::ConsentRequired { consent_request_id } => {
            assert_eq!(consent_request_id, consent.request_id);
        }
        other => panic!("동의가 필요한데 다른 결과: {other:?}"),
    }
    assert!(
        registry.store_requests.lock().unwrap().is_empty(),
        "승인 전에는 설치를 보내지 않는다"
    );

    core.handle(CoreRequest::AppRespondInstallPermission {
        owner: consent.owner,
        request_id: consent.request_id.clone(),
        digest: consent.digest,
        allow: true,
    })
    .unwrap();
    wait_until(|| !registry.store_requests.lock().unwrap().is_empty());
    assert_eq!(
        registry.store_requests.lock().unwrap()[0].origin.store_url,
        STORE
    );
    assert_eq!(
        registry.store_requests.lock().unwrap()[0].origin.release,
        3
    );
    wait_until(|| {
        core.inner
            .state
            .lock()
            .unwrap()
            .shared
            .apps
            .iter()
            .any(|app| {
                app.id == "example"
                    && app
                        .origin
                        .as_ref()
                        .is_some_and(|origin| origin.release == 3)
            })
    });
    let state = core.inner.state.lock().unwrap();
    let win = state
        .shared
        .windows
        .iter()
        .find(|win| win.id == window)
        .expect("설치 뒤에도 창이 남아야 한다");
    assert_eq!(win.app_id, "example");
    assert_eq!(win.state.get("draft"), Some(&json!("남길 글")));
}

#[test]
fn a_window_cannot_answer_a_shell_consent() {
    let (_temp, core, registry) = setup();
    let mut changed: Value = serde_json::from_str(&store_definition(&core)).unwrap();
    changed["worker"]["code"] = json!("print(2)");
    install(&core, &registry, 2, STORE, 2, Some(2), &changed.to_string());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "example");
    let consents = consents(&core);
    let request_id = deliver(&core, request("example", None, false));
    let consent = consents.recv_timeout(Duration::from_secs(5)).unwrap();
    let error = core
        .handle(CoreRequest::AppRespondInstallPermission {
            owner: store_runtime_tests::window_owner(&core, &window),
            request_id: consent.request_id.clone(),
            digest: consent.digest.clone(),
            allow: true,
        })
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("STORECLIENT_INSTALL_OWNER_MISMATCH")
    );
    // 올바른 소유자로 취소하면 대기 중인 요청이 끝난다.
    core.handle(CoreRequest::AppRespondInstallPermission {
        owner: consent.owner,
        request_id: consent.request_id,
        digest: consent.digest,
        allow: false,
    })
    .unwrap();
    let _ = response(&registry, &request_id);
}

#[test]
fn an_app_that_is_not_installed_always_asks_the_shell_even_from_the_store() {
    let (_temp, core, registry) = setup();
    let consents = consents(&core);
    let request_id = deliver(&core, request("example", Some(STORE), false));
    let consent = consents.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(matches!(
        consent.owner,
        InstallConsentOwner::Shell { .. }
    ));
    assert_eq!(consent.release, 3);
    assert_eq!(consent.store_url, STORE);
    assert_eq!(consent.from_origin, None);
    assert!(!consent.replacing);
    assert!(!consent.modified);
    match response(&registry, &request_id).result {
        StoreUpdateResult::ConsentRequired { consent_request_id } => {
            assert_eq!(consent_request_id, consent.request_id);
        }
        other => panic!("새 설치인데 동의를 묻지 않았다: {other:?}"),
    }
    assert!(registry.store_requests.lock().unwrap().is_empty());

    core.handle(CoreRequest::AppRespondInstallPermission {
        owner: consent.owner,
        request_id: consent.request_id.clone(),
        digest: consent.digest,
        allow: true,
    })
    .unwrap();
    wait_until(|| {
        core.inner
            .state
            .lock()
            .unwrap()
            .shared
            .apps
            .iter()
            .any(|app| app.id == "example")
    });
    assert_eq!(registry.store_requests.lock().unwrap().len(), 1);
}

#[test]
fn an_app_that_is_not_installed_needs_a_store_url() {
    let (_temp, core, registry) = setup();
    let consents = consents(&core);
    let request_id = deliver(&core, request("example", None, false));
    match response(&registry, &request_id).result {
        StoreUpdateResult::Error { error } => {
            assert_eq!(error.id.as_deref(), Some("STORECLIENT_UPDATE_APP_MISSING"));
            assert_eq!(
                error.message,
                "'example' 앱이 이 기기에 설치되어 있지 않습니다. 앱을 올린 스토어 주소를 store_url에 지정해 주세요."
            );
        }
        other => panic!("설치되지 않은 앱을 찾았다: {other:?}"),
    }
    assert!(consents.recv_timeout(Duration::from_millis(200)).is_err());
    assert!(registry.store_requests.lock().unwrap().is_empty());

    // 출처가 없는 커스텀 앱은 설치되어 있어도 스토어 주소를 받아야 한다.
    let definition = json!({"id":"custom","name":"커스텀","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"시험"}}).to_string();
    crate::app_commands::import_registry(
        &mut core.inner.state.lock().unwrap(),
        registry_app(1, &definition),
    );
    let request_id = deliver(&core, request("custom", None, false));
    match response(&registry, &request_id).result {
        StoreUpdateResult::Error { error } => {
            assert_eq!(
                error.id.as_deref(),
                Some("STORECLIENT_UPDATE_STORE_REQUIRED")
            );
        }
        other => panic!("출처 없는 앱의 갱신을 받아들였다: {other:?}"),
    }
    assert!(consents.recv_timeout(Duration::from_millis(200)).is_err());
    assert!(registry.store_requests.lock().unwrap().is_empty());
}

#[test]
fn a_builtin_app_id_is_rejected() {
    let (_temp, core, registry) = setup();
    let consents = consents(&core);
    let request_id = deliver(&core, request("profiler", Some(STORE), false));
    match response(&registry, &request_id).result {
        StoreUpdateResult::Error { error } => {
            assert_eq!(error.id.as_deref(), Some("STORECLIENT_UPDATE_BUILTIN"));
            assert!(error.message.contains("쉘을 업데이트"));
        }
        other => panic!("기본 앱을 스토어 판으로 바꾸려 했다: {other:?}"),
    }
    assert!(consents.recv_timeout(Duration::from_millis(200)).is_err());
    assert!(registry.store_requests.lock().unwrap().is_empty());
}

#[test]
fn an_expired_request_does_not_open_a_consent_dialog() {
    let (_temp, core, registry) = setup();
    let mut changed: Value = serde_json::from_str(&store_definition(&core)).unwrap();
    changed["worker"]["code"] = json!("print(2)");
    install(
        &core,
        &registry,
        2,
        STORE,
        2,
        Some(2),
        &changed.to_string(),
    );
    let consents = consents(&core);
    let mut expired = request("example", None, false);
    expired.expires_at = (chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339();
    let request_id = deliver(&core, expired);
    match response(&registry, &request_id).result {
        StoreUpdateResult::Error { error } => {
            assert_eq!(
                error.id.as_deref(),
                Some("STORECLIENT_UPDATE_REQUEST_EXPIRED")
            );
        }
        other => panic!("만료된 요청을 처리했다: {other:?}"),
    }
    assert!(consents.recv_timeout(Duration::from_millis(200)).is_err());
    assert!(registry.store_requests.lock().unwrap().is_empty());
    assert_eq!(app(&core).origin.unwrap().release, 2);
}

/// 색인 읽기를 붙잡아 두는 전송. 준비 도중 만료를 재현한다.
struct Pausing {
    inner: crate::store::tests::Loopback,
    gate: Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>,
}

impl crate::store::fetch::Transport for Pausing {
    fn get(
        &self,
        origin: &str,
        paths: &[String],
        path: &str,
        limit: u64,
    ) -> Result<
        kaleidoscope_data::public_http::PublicResponse,
        kaleidoscope_data::public_http::PublicHttpError,
    > {
        if let Some((ready, resume)) = self.gate.lock().unwrap().take() {
            let _ = ready.send(());
            let _ = resume.recv_timeout(Duration::from_secs(10));
        }
        self.inner.get(origin, paths, path, limit)
    }
}

#[test]
fn a_request_that_expires_during_preparation_does_not_install() {
    let (_temp, core, registry) = setup();
    install(&core, &registry, 3, STORE, 2, Some(3), &store_definition(&core));
    let (fixture, _, _) = crate::store::tests::fixture();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    *core.inner.store_transport.lock().unwrap() = Some(Arc::new(Pausing {
        inner: fixture,
        gate: Mutex::new(Some((ready_tx, resume_rx))),
    }));
    let consents = consents(&core);
    let mut request = request("example", None, false);
    request.expires_at =
        (chrono::Utc::now() + chrono::Duration::milliseconds(300)).to_rfc3339();
    let request_id = deliver(&core, request);
    ready_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("색인 읽기가 시작되지 않았다");
    thread::sleep(Duration::from_millis(400));
    resume_tx.send(()).unwrap();
    match response(&registry, &request_id).result {
        StoreUpdateResult::Error { error } => {
            assert_eq!(
                error.id.as_deref(),
                Some("STORECLIENT_UPDATE_REQUEST_EXPIRED")
            );
        }
        other => panic!("준비 도중 만료된 요청을 확정했다: {other:?}"),
    }
    assert!(consents.recv_timeout(Duration::from_millis(200)).is_err());
    assert!(registry.store_requests.lock().unwrap().is_empty());
    assert_eq!(app(&core).origin.unwrap().release, 2);
}

#[test]
fn a_link_change_cancels_the_shell_consent() {
    let (_temp, core, registry) = setup();
    let mut changed: Value = serde_json::from_str(&store_definition(&core)).unwrap();
    changed["worker"]["code"] = json!("print(2)");
    install(
        &core,
        &registry,
        2,
        STORE,
        2,
        Some(2),
        &changed.to_string(),
    );
    let consents = consents(&core);
    let request_id = deliver(&core, request("example", None, false));
    let consent = consents.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(matches!(
        response(&registry, &request_id).result,
        StoreUpdateResult::ConsentRequired { .. }
    ));

    core.handle(CoreRequest::LinkUnlink {}).unwrap();
    let error = core
        .handle(CoreRequest::AppRespondInstallPermission {
            owner: consent.owner,
            request_id: consent.request_id.clone(),
            digest: consent.digest,
            allow: true,
        })
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("STORECLIENT_INSTALL_REQUEST_EXPIRED")
    );
    thread::sleep(Duration::from_millis(200));
    assert!(
        registry.store_requests.lock().unwrap().is_empty(),
        "링크가 바뀐 뒤에는 설치를 보내지 않는다"
    );
    assert_eq!(app(&core).origin.unwrap().release, 2);
}
