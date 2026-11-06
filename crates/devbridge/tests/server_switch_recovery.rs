//! 실제 내장 서버와 HTTP 레지스트리로 서버 전환을 검증한다.
use kaleidoscope_contract::{CoreReply, CoreRequest, LinkStatus, ServerMode};
use kaleidoscope_core::{Core, CoreConfig, EmbeddedServerInfo, Host};
use kaleidoscope_orchestrator::{EmbeddedConfig, EmbeddedServer};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

struct TestHost(PathBuf);
impl Host for TestHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        Some(self.0.clone())
    }
}
fn call(core: &Core, value: Value) -> Value {
    let request: CoreRequest = serde_json::from_value(value).unwrap();
    serde_json::to_value(core.handle(request).unwrap()).unwrap()
}
#[track_caller]
fn wait_for(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if predicate() {
            return;
        }
        thread::sleep(Duration::from_millis(30));
    }
    panic!("실제 서버 동작을 기다리다 시간 초과");
}
fn connected(core: &Core, mode: ServerMode) -> bool {
    matches!(core.handle(CoreRequest::StateGet {}).unwrap(), CoreReply::StateGet { snapshot, .. } if matches!(snapshot.link, LinkStatus::Connected { mode: actual, .. } if actual == mode))
}
fn config(dir: &Path, info: &EmbeddedServer, remote: &str) -> CoreConfig {
    CoreConfig {
        media_origin: None,
        data_dir: dir.into(),
        seed_definitions: vec![],
        server_url: remote.into(),
        device_name: "시험".into(),
        embedded_server: Some(EmbeddedServerInfo {
            server_url: info.server_url.clone(),
            device_id: info.device_id.clone(),
            token: info.token.clone(),
        }),
    }
}
fn open_md_editor(core: &Core) -> String {
    let state = call(core, json!({"op":"state.get"}));
    let desktop = state["snapshot"]["shared"]["desktops"][0]["id"]
        .as_str()
        .unwrap();
    call(
        core,
        json!({"op":"window.open","desktop_id":desktop,"app_id":"md-editor"}),
    )["window"]["id"]
        .as_str()
        .unwrap()
        .to_owned()
}
fn server_config(dir: &Path, prefix: &str) -> EmbeddedConfig {
    EmbeddedConfig {
        db_path: dir.join(format!("{prefix}.db")),
        token_path: dir.join(format!("{prefix}.token")),
        device_name: "시험".into(),
    }
}

fn seed_provider_connection(dir: &Path, prefix: &str) {
    let db = rusqlite::Connection::open(dir.join(format!("{prefix}.db"))).unwrap();
    let account: String = db
        .query_row(
            "SELECT account_id FROM mcp_principal WHERE id=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    db.execute(
        "INSERT INTO connections(account_id,name,kind,base_url,writable,paths,headers,description,updated_at) VALUES(?1,'provider','oauth','https://example.test',1,'[]','{}','','now')",
        [account],
    )
    .unwrap();
}

fn import_pas(core: &Core) -> String {
    let mut definition: Value =
        serde_json::from_str(include_str!("../../../examples/workspace-pas-v2.json")).unwrap();
    definition["permissions"][0]["connection"] = json!("provider");
    call(
        core,
        json!({"op":"app.import","definition_json":definition.to_string()}),
    );
    let state = call(core, json!({"op":"state.get"}));
    let desktop = state["snapshot"]["device"]["active_desktop_ids"]
        .as_object()
        .unwrap()
        .values()
        .next()
        .unwrap()
        .as_str()
        .unwrap();
    call(
        core,
        json!({"op":"window.open","desktop_id":desktop,"app_id":"workspace-pas-v2"}),
    )["window"]["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn watch_pas_on_next_connected(
    core: &Arc<Core>,
    window_id: String,
    mode: ServerMode,
) -> std::sync::mpsc::Receiver<Result<Value, (Option<String>, String)>> {
    use std::sync::atomic::{AtomicBool, Ordering};
    let (sender, receiver) = std::sync::mpsc::channel();
    let triggered = Arc::new(AtomicBool::new(false));
    let weak = Arc::downgrade(core);
    let callback_window = window_id;
    core.subscribe(Box::new(move |event| {
        let kaleidoscope_contract::CoreEvent::StateChanged { snapshot, .. } = event else {
            return;
        };
        if !matches!(&snapshot.link, LinkStatus::Connected { mode: actual, .. } if *actual == mode)
            || triggered.swap(true, Ordering::SeqCst)
        {
            return;
        }
        let Some(core) = weak.upgrade() else {
            return;
        };
        let sender = sender.clone();
        let window_id = callback_window.clone();
        thread::spawn(move || {
            let request = CoreRequest::ConversationGet {
                window_id,
                profile: None,
            };
            let result = core
                .handle(request)
                .map(serde_json::to_value)
                .map_err(|error| (error.id, error.message))
                .and_then(|result| result.map_err(|error| (None, error.to_string())));
            sender.send(result).unwrap();
        });
    }));
    receiver
}

fn assert_provider_connection_was_found(result: Result<Value, (Option<String>, String)>) {
    let (id, message) = result.unwrap_err();
    assert_eq!(
        id.as_deref(),
        Some("CONV_HTTP_LOGIN_INFO_MISSING"),
        "{message}"
    );
    assert!(message.contains("provider"), "{message}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pas_connection_is_available_during_both_server_switch_directions() {
    let temp = tempfile::tempdir().unwrap();
    let local = EmbeddedServer::start(server_config(temp.path(), "pas-local"))
        .await
        .unwrap();
    let remote = EmbeddedServer::start(server_config(temp.path(), "pas-remote"))
        .await
        .unwrap();
    let root = temp.path().to_path_buf();
    tokio::task::spawn_blocking(move || {
        seed_provider_connection(&root, "pas-local");
        seed_provider_connection(&root, "pas-remote");

        let device = root.join("pas-device");
        std::fs::create_dir_all(&device).unwrap();
        std::fs::write(
            device.join("link.json"),
            serde_json::to_vec(&json!({
                "format":1,
                "mode":"remote",
                "server_url":remote.server_url,
                "device_id":remote.device_id,
                "device_name":"시험",
                "token":remote.token
            }))
            .unwrap(),
        )
        .unwrap();
        let core = Arc::new(
            Core::open(
                config(&device, &local, &remote.server_url),
                Arc::new(TestHost(root.clone())),
            )
            .unwrap(),
        );
        wait_for(|| connected(&core, ServerMode::Remote));

        let remote_window = import_pas(&core);
        let initial = core
            .handle(CoreRequest::ConversationGet {
                window_id: remote_window.clone(),
                profile: None,
            })
            .unwrap_err();
        assert_eq!(initial.id.as_deref(), Some("CONV_HTTP_LOGIN_INFO_MISSING"));

        call(&core, json!({"op":"link.use_local"}));
        wait_for(|| connected(&core, ServerMode::Embedded));
        let local_window = import_pas(&core);

        let remote_recovery = watch_pas_on_next_connected(&core, remote_window, ServerMode::Remote);
        call(
            &core,
            json!({"op":"link.start","server_url":remote.server_url}),
        );
        wait_for(|| connected(&core, ServerMode::Remote));
        assert_provider_connection_was_found(
            remote_recovery
                .recv_timeout(Duration::from_secs(5))
                .unwrap(),
        );

        let local_recovery = watch_pas_on_next_connected(&core, local_window, ServerMode::Embedded);
        call(&core, json!({"op":"link.use_local"}));
        wait_for(|| connected(&core, ServerMode::Embedded));
        assert_provider_connection_was_found(
            local_recovery.recv_timeout(Duration::from_secs(5)).unwrap(),
        );
        core.shutdown();
    })
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn storage_list_and_get_recover_during_startup_and_both_server_switches() {
    let temp = tempfile::tempdir().unwrap();
    let local = EmbeddedServer::start(server_config(temp.path(), "storage-race-local"))
        .await
        .unwrap();
    let remote = EmbeddedServer::start(server_config(temp.path(), "storage-race-remote"))
        .await
        .unwrap();
    let root = temp.path().to_path_buf();
    tokio::task::spawn_blocking(move || {
        let device = root.join("storage-race-device");
        std::fs::create_dir_all(&device).unwrap();
        std::fs::write(
            device.join("link.json"),
            serde_json::to_vec(&json!({
                "format": 1,
                "mode": "remote",
                "server_url": remote.server_url,
                "device_id": remote.device_id,
                "device_name": "시험",
                "token": remote.token
            }))
            .unwrap(),
        )
        .unwrap();
        let host = Arc::new(TestHost(root.clone()));
        let core = Arc::new(Core::open(config(&device, &local, &remote.server_url), host.clone()).unwrap());
        wait_for(|| connected(&core, ServerMode::Remote));
        let remote_window = open_md_editor(&core);
        call(&core, json!({"op":"storage.write","window_id":remote_window,"entry":"documents","doc":"race.md","content":"remote","expected_revision":null}));
        call(&core, json!({"op":"link.use_local"}));
        wait_for(|| connected(&core, ServerMode::Embedded));
        let local_window = open_md_editor(&core);
        call(&core, json!({"op":"storage.write","window_id":local_window,"entry":"documents","doc":"race.md","content":"local","expected_revision":null}));
        core.shutdown();
        drop(core);

        // 저장 링크가 있는 상태로 다시 연 직후, AppsSnapshot 대기 없이 목록과 본문을 요청한다.
        let core = Arc::new(Core::open(config(&device, &local, &remote.server_url), host).unwrap());
        let list_core = Arc::clone(&core);
        let list_window = local_window.clone();
        let list = thread::spawn(move || {
            list_core.handle(CoreRequest::StorageList { window_id: list_window, entry: "documents".into() })
        });
        let get_core = Arc::clone(&core);
        let get_window = local_window.clone();
        let document = thread::spawn(move || {
            get_core.handle(CoreRequest::StorageGet { window_id: get_window, entry: "documents".into(), doc: Some("race.md".into()) })
        });
        assert!(matches!(list.join().unwrap().unwrap(), CoreReply::StorageList { result } if result.items.iter().any(|item| item.doc == "race.md")));
        assert!(matches!(document.join().unwrap().unwrap(), CoreReply::StorageGet { result } if result.content == json!("local")));

        let weak = Arc::downgrade(&core);
        let event_remote_window = remote_window.clone();
        let event_local_window = local_window.clone();
        let (switch_tx, switch_rx) = std::sync::mpsc::channel();
        core.subscribe(Box::new(move |event| {
            let kaleidoscope_contract::CoreEvent::StateChanged { snapshot, .. } = event else { return; };
            let LinkStatus::Offline { mode, reason: None, .. } = &snapshot.link else { return; };
            let mode = *mode;
            let Some(core) = weak.upgrade() else { return; };
            let tx = switch_tx.clone();
            let window = match mode {
                ServerMode::Remote => event_remote_window.clone(),
                ServerMode::Embedded => event_local_window.clone(),
            };
            thread::spawn(move || {
                let list = core.handle(CoreRequest::StorageList { window_id: window.clone(), entry: "documents".into() });
                let document = core.handle(CoreRequest::StorageGet { window_id: window, entry: "documents".into(), doc: Some("race.md".into()) });
                let _ = tx.send((mode, list, document));
            });
        }));

        call(&core, json!({"op":"link.start","server_url":remote.server_url}));
        wait_for(|| connected(&core, ServerMode::Remote));
        let (mode, list, document) = switch_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(mode, ServerMode::Remote);
        assert!(matches!(list.unwrap(), CoreReply::StorageList { result } if result.items.iter().any(|item| item.doc == "race.md")));
        assert!(matches!(document.unwrap(), CoreReply::StorageGet { result } if result.content == json!("remote")));

        call(&core, json!({"op":"link.use_local"}));
        wait_for(|| connected(&core, ServerMode::Embedded));
        let (mode, list, document) = switch_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(mode, ServerMode::Embedded);
        assert!(matches!(list.unwrap(), CoreReply::StorageList { result } if result.items.iter().any(|item| item.doc == "race.md")));
        assert!(matches!(document.unwrap(), CoreReply::StorageGet { result } if result.content == json!("local")));
        core.shutdown();
    }).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_remote_reconnect_recovers_storage_source_and_asset() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    };
    let temp = tempfile::tempdir().unwrap();
    let local = EmbeddedServer::start(server_config(temp.path(), "local-recovery"))
        .await
        .unwrap();
    let remote = EmbeddedServer::start(server_config(temp.path(), "remote-recovery"))
        .await
        .unwrap();
    let root = temp.path().to_path_buf();
    tokio::task::spawn_blocking(move || {
        let db = rusqlite::Connection::open(root.join("remote-recovery.db")).unwrap();
        let account: String = db.query_row("SELECT account_id FROM mcp_principal WHERE id=1", [], |row| row.get(0)).unwrap();
        db.execute("INSERT INTO asset_versions(account_id,id,version,format,sha256,source,license,byte_size,created_at,bytes) VALUES(?1,'test-script',1,'javascript','2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881','test','MIT',1,'now',?2)", rusqlite::params![account, b"x".as_slice()]).unwrap();
        db.execute("INSERT INTO connections(account_id,name,kind,base_url,writable,paths,headers,description,updated_at) VALUES(?1,'test-connection','relay',?2,0,'[]','{}','','now')", rusqlite::params![account, remote.server_url]).unwrap();
        drop(db);
        let device = root.join("remote-device");
        std::fs::create_dir_all(&device).unwrap();
        std::fs::write(device.join("link.json"), serde_json::to_vec(&json!({"format":1,"mode":"remote","server_url":remote.server_url,"device_id":remote.device_id,"device_name":"시험","token":remote.token})).unwrap()).unwrap();
        let core = Arc::new(Core::open(config(&device, &local, &remote.server_url), Arc::new(TestHost(root.clone()))).unwrap());
        wait_for(|| connected(&core, ServerMode::Remote));
        let definition = json!({
            "id":"recovery-test","name":"복구 시험","requires":{"blocks":12,"modules":{"storage":1,"connection":1,"assets":1}},
            "permissions":[{"module":"connection","id":"api","connection":"test-connection","access":"read","label":"시험"}],
            "state":{}, "assets":[{"id":"test-script","version":1}],
            "storage":{"entries":[{"id":"choice","key":"settings/choice","kind":"json","schema":{"type":"string"},"default":"기본값","label":"선택","presentation":"hidden"}]},
            "sources":{"health":{"kind":"request","permission":"api","path":"/api/health"}},
            "ui":{"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$storage.choice"}},{"type":"text","value":{"expr":"$data.health.ok"}}]}
        });
        call(&core, json!({"op":"app.import","definition_json":definition.to_string()}));
        let state = call(&core, json!({"op":"state.get"}));
        let desktop = state["snapshot"]["shared"]["desktops"][0]["id"].as_str().unwrap();
        let window = call(&core, json!({"op":"window.open","desktop_id":desktop,"app_id":"recovery-test"}))["window"]["id"].as_str().unwrap().to_owned();
        call(&core, json!({"op":"link.use_local"}));
        wait_for(|| connected(&core, ServerMode::Embedded));
        let armed = Arc::new(AtomicBool::new(true));
        let updates = Arc::new(Mutex::new(Vec::<Value>::new()));
        let (media_tx, media_rx) = std::sync::mpsc::channel();
        let weak = Arc::downgrade(&core);
        let updates_listener = updates.clone();
        let armed_listener = armed.clone();
        let window_listener = window.clone();
        core.subscribe(Box::new(move |event| {
            match event {
                kaleidoscope_contract::CoreEvent::DataUpdate { window_id, view } if window_id == &window_listener => updates_listener.lock().unwrap().push(serde_json::to_value(view).unwrap()),
                kaleidoscope_contract::CoreEvent::StateChanged { snapshot, .. } if matches!(snapshot.link, LinkStatus::Offline { mode: ServerMode::Remote, reason: None, .. }) && armed_listener.swap(false, Ordering::SeqCst) => {
                    let core = weak.upgrade().unwrap();
                    let attached = call(&core, json!({"op":"data.attach","window_id":window_listener}));
                    for pointer in ["/ui/children/0/value", "/ui/children/1/value"] {
                        assert_eq!(attached["view"]["values"][pointer]["status"], "loading");
                    }
                    let request: CoreRequest = serde_json::from_value(json!({"op":"data.media","window_id":window_listener,"media":{"asset":"test-script","version":1}})).unwrap();
                    // 콜백 반환 뒤 스트림이 시작되므로 준비를 기다리는 명령은 별도 스레드로 보낸다.
                    let tx = media_tx.clone();
                    let (started_tx, started_rx) = std::sync::mpsc::channel();
                    let (finished_tx, finished_rx) = std::sync::mpsc::channel();
                    thread::spawn(move || {
                        started_tx.send(()).unwrap();
                        tx.send(core.handle(request)).unwrap();
                        let _ = finished_tx.send(());
                    });
                    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    assert_eq!(finished_rx.recv_timeout(Duration::from_millis(100)), Err(std::sync::mpsc::RecvTimeoutError::Timeout), "연결 전 자산 요청은 준비를 기다려야 한다");
                }
                _ => {}
            }
        }));
        call(&core, json!({"op":"link.start","server_url":remote.server_url}));
        assert!(!armed.load(Ordering::SeqCst), "원격 전환 중 상태를 관찰해야 한다");
        wait_for(|| connected(&core, ServerMode::Remote));
        wait_for(|| {
            let values = updates.lock().unwrap();
            values.iter().any(|view| view["values"]["/ui/children/0/value"]["value"] == "기본값") && values.iter().any(|view| view["values"]["/ui/children/1/value"]["value"] == true)
        });
        let media = media_rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
        assert!(matches!(media, CoreReply::DataMedia { media } if media.data_base64 == "eA=="));
        let values = updates.lock().unwrap();
        for pointer in ["/ui/children/0/value", "/ui/children/1/value"] {
            assert!(values.iter().all(|view| view["values"][pointer]["status"] != "failed"), "{pointer}: {values:?}");
        }
        drop(values);
        core.shutdown();
    }).await.unwrap();
}
