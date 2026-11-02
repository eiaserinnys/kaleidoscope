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
    matches!(core.handle(CoreRequest::StateGet {}).unwrap(), CoreReply::StateGet { snapshot } if matches!(snapshot.link, LinkStatus::Connected { mode: actual, .. } if actual == mode))
}
fn open_agent(core: &Core) -> (String, String, String) {
    let state = call(core, json!({"op":"state.get"}));
    let workspace = state["snapshot"]["shared"]["workspaces"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let desktop = state["snapshot"]["shared"]["desktops"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let window = call(
        core,
        json!({"op":"window.open","desktop_id":desktop,"app_id":"agent"}),
    )["window"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    call(core, json!({"op":"data.attach","window_id":window}));
    let definition: Value = serde_json::from_str(include_str!("../../../apps/agent.json")).unwrap();
    let defaults = definition["storage"]["entries"][0]["default"]
        .as_array()
        .unwrap();
    wait_for(|| {
        let reply = call(core, json!({"op":"local_agent.attach","window_id":window}));
        let agents = reply["snapshot"]["agents"].as_array().unwrap();
        defaults
            .iter()
            .take(2)
            .all(|expected| agents.iter().any(|agent| agent["id"] == expected["id"]))
    });
    (workspace, desktop, window)
}
fn config(dir: &Path, info: &EmbeddedServer, remote: &str) -> CoreConfig {
    CoreConfig {
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
fn server_config(dir: &Path, prefix: &str) -> EmbeddedConfig {
    EmbeddedConfig {
        db_path: dir.join(format!("{prefix}.db")),
        token_path: dir.join(format!("{prefix}.token")),
        device_name: "시험".into(),
    }
}

fn agent_binary() -> PathBuf {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let target = std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| "target".into());
    let executable = root.join(target).join("debug").join(format!(
        "kaleidoscope-acp-test-agent{}",
        std::env::consts::EXE_SUFFIX
    ));
    if !executable.exists() {
        let result = std::process::Command::new(env!("CARGO"))
            .current_dir(root)
            .args(["build", "-p", "kaleidoscope-acp-test-agent"])
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    executable
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_embedded_agent_and_remote_switch() {
    let temp = tempfile::tempdir().unwrap();
    let fresh = EmbeddedServer::start(server_config(temp.path(), "fresh"))
        .await
        .unwrap();
    let local = EmbeddedServer::start(server_config(temp.path(), "local"))
        .await
        .unwrap();
    let remote = EmbeddedServer::start(server_config(temp.path(), "remote"))
        .await
        .unwrap();
    let root = temp.path().to_path_buf();
    tokio::task::spawn_blocking(move || {
        let host = Arc::new(TestHost(root.clone()));
        let new_dir = root.join("new-device");
        let new_core = Core::open(config(&new_dir, &fresh, &remote.server_url), host.clone()).unwrap();
        wait_for(|| connected(&new_core, ServerMode::Embedded));
        open_agent(&new_core);
        new_core.shutdown();

        let device = root.join("old-device");
        std::fs::create_dir_all(&device).unwrap();
        std::fs::write(device.join("link.json"), serde_json::to_vec(&json!({"format":1,"mode":"remote","server_url":remote.server_url,"device_id":remote.device_id,"device_name":"시험","token":remote.token})).unwrap()).unwrap();
        let core = Core::open(config(&device, &local, &remote.server_url), host).unwrap();
        wait_for(|| connected(&core, ServerMode::Remote));
        call(&core, json!({"op":"link.use_local"}));
        wait_for(|| connected(&core, ServerMode::Embedded));
        let (workspace, desktop, window) = open_agent(&core);
        let db_path = root.join("local.db");
        wait_for(|| {
            let db = rusqlite::Connection::open(&db_path).unwrap();
            let workspaces: i64 = db.query_row("SELECT count(*) FROM workspaces WHERE id=?1 AND account_id=(SELECT account_id FROM mcp_principal WHERE id=1)", [&workspace], |r| r.get(0)).unwrap();
            let desktops: i64 = db.query_row("SELECT count(*) FROM desktops WHERE id=?1 AND workspace_id=?2", [&desktop, &workspace], |r| r.get(0)).unwrap();
            workspaces == 1 && desktops == 1
        });
        let executable = agent_binary();
        call(&core, json!({"op":"storage.write","window_id":window,"entry":"agents","content":[{"id":"test","name":"시험 에이전트","command":executable,"args":[],"env":{}}],"expected_revision":null}));
        wait_for(|| call(&core, json!({"op":"local_agent.attach","window_id":window}))["snapshot"]["agents"].as_array().unwrap().iter().any(|agent| agent["id"] == "test"));
        call(&core, json!({"op":"window.set_state","window_id":window,"state":{"agent_id":"test"}}));
        call(&core, json!({"op":"files.pick_folder","window_id":window,"permission":"work"}));
        let mut hash = String::new();
        wait_for(|| {
            let snapshot = call(&core, json!({"op":"local_agent.attach","window_id":window}));
            if let Some(value) = snapshot["snapshot"]["execution"]["spec_hash"].as_str() { hash = value.into(); true } else { false }
        });
        call(&core, json!({"op":"local_agent.allow","window_id":window,"spec_hash":hash}));
        wait_for(|| call(&core, json!({"op":"local_agent.attach","window_id":window}))["snapshot"]["phase"] == "ready");
        call(&core, json!({"op":"link.start","server_url":remote.server_url}));
        wait_for(|| connected(&core, ServerMode::Remote));
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
        let offline_result = Arc::new(Mutex::new(None::<Value>));
        let weak = Arc::downgrade(&core);
        let updates_listener = updates.clone();
        let offline_listener = offline_result.clone();
        let armed_listener = armed.clone();
        let window_listener = window.clone();
        core.subscribe(Box::new(move |event| {
            match event {
                kaleidoscope_contract::CoreEvent::DataUpdate { window_id, view } if window_id == &window_listener => updates_listener.lock().unwrap().push(serde_json::to_value(view).unwrap()),
                kaleidoscope_contract::CoreEvent::StateChanged { snapshot } if matches!(snapshot.link, LinkStatus::Offline { mode: ServerMode::Remote, .. }) && armed_listener.swap(false, Ordering::SeqCst) => {
                    let core = weak.upgrade().unwrap();
                    call(&core, json!({"op":"data.attach","window_id":window_listener}));
                    let request: CoreRequest = serde_json::from_value(json!({"op":"data.media","window_id":window_listener,"media":{"asset":"test-script","version":1}})).unwrap();
                    let error = core.handle(request).unwrap_err();
                    wait_for(|| {
                        let values = updates_listener.lock().unwrap();
                        ["/ui/children/0/value", "/ui/children/1/value"].iter().all(|pointer| values.iter().any(|view| view["values"][pointer]["status"] == "failed"))
                    });
                    *offline_listener.lock().unwrap() = Some(json!({"message":error.message,"id":error.id}));
                }
                _ => {}
            }
        }));
        call(&core, json!({"op":"link.start","server_url":remote.server_url}));
        let offline = offline_result.lock().unwrap().clone().unwrap();
        assert_eq!(offline["message"], "kaleidoscope 서버에 연결되어 있지 않아 미디어를 불러올 수 없습니다. 서버를 연결한 뒤 다시 시도하세요.");
        assert_eq!(offline["id"], "MEDIA_LOAD_SERVER_NOT_CONNECTED");
        wait_for(|| connected(&core, ServerMode::Remote));
        wait_for(|| {
            let values = updates.lock().unwrap();
            values.iter().any(|view| view["values"]["/ui/children/0/value"]["value"] == "기본값") && values.iter().any(|view| view["values"]["/ui/children/1/value"]["value"] == true)
        });
        let media = call(&core, json!({"op":"data.media","window_id":window,"media":{"asset":"test-script","version":1}}));
        assert_eq!(media["media"]["data_base64"], "eA==");
        core.shutdown();
    }).await.unwrap();
}
