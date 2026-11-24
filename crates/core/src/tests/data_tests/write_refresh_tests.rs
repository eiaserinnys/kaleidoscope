use super::*;
use kaleidoscope_contract::registry::ConnectionKind;

/// 쓰기 뒤 되살린 낡은 값과 refresh 단계의 wait를 가르는 시험 앱.
fn definition() -> String {
    json!({
        "id":"write-refresh-app","name":"쓰기 뒤 받기","requires":{"blocks":kaleidoscope_contract::REFRESH_WAIT_BLOCK_SET_VERSION,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"readwrite","label":"API"}],
        "state":{"path":"/old","done":false},
        "sources":{"items":{"kind":"request","permission":"api","path":{"state":"path"}}},
        "ui":{"type":"stack","direction":"column","children":[
            {"type":"list","items":{"expr":"$data.items"}},
            {"type":"button","label":"write","on_click":[{"call":{"permission":"api","method":"POST","path":"/save"}}]},
            {"type":"button","label":"refresh","on_click":[{"refresh":["items"]},{"set_state":"done","value":true}]},
            {"type":"button","label":"refresh-nowait","on_click":[{"refresh":["items"],"wait":false},{"set_state":"done","value":true}]}
        ]}
    }).to_string()
}

struct Fixture {
    _temp: TempDir,
    core: Core,
    client: Arc<FakeRegistryClient>,
    window: String,
}

fn start() -> Fixture {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    client.connection_replies.lock().unwrap().extend([
        ("/old".into(), response(200, json!([{"key":"old-1"}]))),
        ("/other".into(), response(200, json!([{"key":"other"}]))),
        ("/save".into(), response(200, json!({}))),
    ]);
    let core = open_core_with_client(temp.path(), vec![definition()], &host, client.clone());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "write-refresh-app");
    mark_connected(&core);
    *core.inner.connections.lock().unwrap() = vec![info(ConnectionKind::Relay)];
    core.handle(CoreRequest::DataAttach { window_id: window.clone(), dormant: vec![] }).unwrap();
    let fixture = Fixture { _temp: temp, core, client, window };
    fixture.wait_items("old-1");
    fixture
}

impl Fixture {
    fn requests(&self, path: &str) -> usize {
        self.client.connection_requests.lock().unwrap().iter().filter(|r| r.path == path).count()
    }
    fn items(&self) -> Option<Value> {
        match crate::data_runtime::binding_value(&self.core.inner, &self.window, "/ui/children/0/items")? {
            BindingValue::Ready { value, .. } => Some(value),
            _ => None,
        }
    }
    fn wait_items(&self, key: &str) {
        wait_until(|| self.items().is_some_and(|items| items[0]["key"] == key));
    }
    fn set_path(&self, path: &str) {
        self.core.handle(CoreRequest::WindowSetState {
            window_id: self.window.clone(),
            state: BTreeMap::from([("path".into(), json!(path))]),
        }).unwrap();
    }
    fn act(&self, index: usize) -> Result<CoreReply, kaleidoscope_contract::CoreError> {
        self.core.handle(CoreRequest::DataAct {
            window_id: self.window.clone(),
            pointer: format!("/ui/children/{index}/on_click"),
            event: Value::Null, item: Value::Null, modifiers: None,
        })
    }
    fn done(&self) -> bool {
        snapshot(&self.core).shared.windows.iter().find(|w| w.id == self.window).unwrap().state["done"] == json!(true)
    }
}

#[test]
fn restored_stale_value_shows_at_once_and_is_fetched_once_after_a_write() {
    let f = start();
    f.set_path("/other");
    f.wait_items("other");
    f.act(1).unwrap();
    // 서버 쪽 값이 바뀌었다. 되살린 낡은 값은 이 새 값을 받기 전까지 보인다.
    f.client.connection_replies.lock().unwrap().insert("/old".into(), response(200, json!([{"key":"old-2"}])));
    let (release, wait) = mpsc::channel();
    *f.client.connection_pause.lock().unwrap() = Some(wait);
    assert_eq!(f.requests("/old"), 1);

    f.set_path("/old");
    wait_until(|| f.requests("/old") == 2);
    assert_eq!(f.items().expect("되살린 값이 보여야 한다")[0]["key"], "old-1", "새 값을 받는 동안 낡은 값을 보인다");
    release.send(()).unwrap();
    f.wait_items("old-2");
    thread::sleep(Duration::from_millis(1500));
    assert_eq!(f.requests("/old"), 2, "새로 받기는 한 번이다");
}

#[test]
fn write_does_not_delete_cache_but_a_login_does() {
    let f = start();
    f.set_path("/other");
    f.wait_items("other");
    // 로그인 성공(connection_changed)은 캐시를 지우니 /old는 처음부터 다시 받는다.
    crate::data_runtime::connection_changed(&f.core.inner, "api");
    let (release, wait) = mpsc::channel();
    *f.client.connection_pause.lock().unwrap() = Some(wait);
    f.set_path("/old");
    wait_until(|| f.requests("/old") == 2);
    assert!(f.items().is_none(), "지운 캐시는 되살아나지 않는다");
    release.send(()).unwrap();
    f.wait_items("old-1");
}

#[test]
fn refresh_wait_false_does_not_hold_the_action_but_the_default_does() {
    let f = start();
    let (release, wait) = mpsc::channel();
    *f.client.connection_pause.lock().unwrap() = Some(wait);
    f.act(3).unwrap();
    assert!(f.done(), "wait가 거짓이면 받기가 끝나기 전에 다음 단계까지 마친다");
    wait_until(|| f.requests("/old") == 2);
    release.send(()).unwrap();
    f.wait_items("old-1");

    f.core.handle(CoreRequest::WindowSetState {
        window_id: f.window.clone(),
        state: BTreeMap::from([("path".into(), json!("/old")), ("done".into(), json!(false))]),
    }).unwrap();
    let f = Arc::new(f);
    let (release, wait) = mpsc::channel();
    *f.client.connection_pause.lock().unwrap() = Some(wait);
    let (finished, done) = mpsc::channel();
    let running = Arc::clone(&f);
    thread::spawn(move || {
        let _ = finished.send(running.act(2).is_ok());
    });
    wait_until(|| f.requests("/old") == 3);
    assert!(done.recv_timeout(Duration::from_millis(300)).is_err(), "기본은 원천이 끝날 때까지 기다린다");
    assert!(!f.done());
    release.send(()).unwrap();
    assert!(done.recv_timeout(Duration::from_secs(5)).unwrap());
    assert!(f.done());
}
