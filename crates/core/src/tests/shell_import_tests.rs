use super::*;
use std::sync::atomic::AtomicBool;
use kaleidoscope_contract::data::FileAccept;

#[derive(Default)]
struct ImportHost {
    files: Mutex<Option<Vec<PathBuf>>>,
    supported: AtomicBool,
    picks: AtomicUsize,
    accepts: Mutex<Vec<(Vec<String>, bool)>>,
}

impl Host for ImportHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }
    fn supports_pick_files(&self) -> bool {
        self.supported.load(Ordering::SeqCst)
    }
    fn pick_files(&self, accept: &[FileAccept], multiple: bool) -> Option<Vec<PathBuf>> {
        self.picks.fetch_add(1, Ordering::SeqCst);
        self.accepts
            .lock()
            .unwrap()
            .push((accept.iter().flat_map(|accept| accept.extensions.clone()).collect(), multiple));
        self.files.lock().unwrap().clone()
    }
}

fn caller(actions: Value) -> String {
    json!({
        "id":"import-caller", "name":"가져오기 시험",
        "requires":{"blocks":4,"modules":{"shell":2}},
        "ui":{"type":"button","label":"가져오기","on_click":actions}
    })
    .to_string()
}

fn target() -> String {
    json!({"id":"target","name":"대상","requires":{"blocks":4,"modules":{}},"ui":{"type":"text","value":"대상"}})
        .to_string()
}

fn open(core: &Core) -> String {
    let (_, desktop) = active_ids(core);
    let window = open_window(core, &desktop, "import-caller");
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    window
}

fn press(core: &Core, window: &str) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::DataAct {
        window_id: window.into(),
        pointer: "/ui/on_click".into(),
        event: Value::Null,
        item: Value::Null,
        modifiers: None,
    })
}

fn core_with(host: Arc<dyn Host>, definitions: Vec<String>) -> (TempDir, Arc<Core>) {
    let temp = TempDir::new().unwrap();
    let core = Arc::new(
        Core::open(
            CoreConfig {
                media_origin: None,
                embedded_server: None,
                data_dir: temp.path().to_path_buf(),
                seed_definitions: definitions,
                server_url: "http://127.0.0.1:4219".into(),
                device_name: "test-device".into(),
            },
            host,
        )
        .unwrap(),
    );
    (temp, core)
}

fn definition_file(dir: &TempDir, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.path().join(name);
    fs::write(&path, bytes).unwrap();
    path
}

fn imported_definition() -> String {
    json!({"id":"imported","name":"가져온 앱","requires":{"blocks":4,"modules":{}},"permissions":[],"ui":{"type":"text","value":"가져온 앱"}})
        .to_string()
}

fn windows_of(core: &Core, app_id: &str) -> usize {
    core.inner
        .state
        .lock()
        .unwrap()
        .shared
        .windows
        .iter()
        .filter(|window| window.app_id == app_id)
        .count()
}

#[test]
fn import_cancel_stops_later_actions_and_changes_nothing() {
    let host = Arc::new(ImportHost::default());
    host.supported.store(true, Ordering::SeqCst);
    let actions = json!([{"shell.import_app":{}}, {"shell.open":{"app_id":"target"}}]);
    let (_temp, core) = core_with(host.clone(), vec![caller(actions), target()]);
    let window = open(&core);
    press(&core, &window).unwrap();
    assert_eq!(host.picks.load(Ordering::SeqCst), 1);
    assert_eq!(host.accepts.lock().unwrap().as_slice(), &[(vec!["json".to_string()], false)]);
    assert_eq!(windows_of(&core, "target"), 0, "가져오기를 취소하면 뒤 동작을 실행하지 않는다");
    let imported = core.inner.state.lock().unwrap().shared.apps.iter().any(|app| app.id == "imported");
    assert!(!imported);
}

#[test]
fn import_success_adds_the_app_without_opening_a_window() {
    let files = TempDir::new().unwrap();
    let path = definition_file(&files, "imported.json", imported_definition().as_bytes());
    let host = Arc::new(ImportHost::default());
    host.supported.store(true, Ordering::SeqCst);
    *host.files.lock().unwrap() = Some(vec![path]);
    let (_temp, core) = core_with(host.clone(), vec![caller(json!([{"shell.import_app":{}}]))]);
    let window = open(&core);
    press(&core, &window).unwrap();
    let imported = core.inner.state.lock().unwrap().shared.apps.iter()
        .find(|app| app.id == "imported").map(|app| app.origin.clone());
    assert_eq!(imported, Some(None), "출처 없는 앱이 레지스트리에 들어간다");
    assert_eq!(windows_of(&core, "imported"), 0, "가져오기만으로는 창을 열지 않는다");
}

#[test]
fn import_rejects_non_json_text_with_the_definition_parse_error() {
    let files = TempDir::new().unwrap();
    let path = definition_file(&files, "broken.json", b"{not json");
    let host = Arc::new(ImportHost::default());
    host.supported.store(true, Ordering::SeqCst);
    *host.files.lock().unwrap() = Some(vec![path]);
    let (_temp, core) = core_with(host, vec![caller(json!([{"shell.import_app":{}}]))]);
    let window = open(&core);
    let error = press(&core, &window).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("APP_DEFINITION_JSON_INVALID"));
}

#[test]
fn import_rejects_bytes_that_are_not_utf8() {
    let files = TempDir::new().unwrap();
    let path = definition_file(&files, "binary.json", &[0xff, 0xfe]);
    let host = Arc::new(ImportHost::default());
    host.supported.store(true, Ordering::SeqCst);
    *host.files.lock().unwrap() = Some(vec![path]);
    let (_temp, core) = core_with(host, vec![caller(json!([{"shell.import_app":{}}]))]);
    let window = open(&core);
    let error = press(&core, &window).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DESK_APP_IMPORT_FILE_ENCODING_INVALID"));
    assert!(error.message.contains("binary.json"));
}

#[test]
fn import_rejects_files_over_the_definition_size_limit() {
    let files = TempDir::new().unwrap();
    let path = definition_file(
        &files,
        "huge.json",
        &vec![b' '; kaleidoscope_contract::store::STORE_APP_JSON_MAX_BYTES as usize + 1],
    );
    let host = Arc::new(ImportHost::default());
    host.supported.store(true, Ordering::SeqCst);
    *host.files.lock().unwrap() = Some(vec![path]);
    let (_temp, core) = core_with(host, vec![caller(json!([{"shell.import_app":{}}]))]);
    let window = open(&core);
    let error = press(&core, &window).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DESK_APP_IMPORT_FILE_TOO_LARGE"));
    assert!(error.message.contains("huge.json"));
}

#[test]
fn import_reports_hosts_without_a_file_picker() {
    let host = Arc::new(ImportHost::default());
    let (_temp, core) = core_with(host.clone(), vec![caller(json!([{"shell.import_app":{}}]))]);
    let window = open(&core);
    let error = press(&core, &window).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DESK_APP_IMPORT_PICKER_UNAVAILABLE"));
    assert_eq!(host.picks.load(Ordering::SeqCst), 0);
}
