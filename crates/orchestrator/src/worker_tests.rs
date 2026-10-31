use super::*;
use axum::{body::Body, http::Request};
use kaleidoscope_contract::worker::WorkerInvokeRequest;
use tower::ServiceExt;

fn definition(code: &str) -> String {
    json!({"id":"worker-test","name":"워커 시험","requires":{"blocks":6,"modules":{"worker":1,"storage":1}},
        "permissions":[],"state":{},"ui":{"type":"text","value":"시험"},
        "storage":{"entries":[
          {"id":"enabled","key":"enabled","kind":"json","schema":{"type":"boolean"},"default":false,"label":"사용","presentation":"hidden"},
          {"id":"counter","key":"counter","kind":"json","schema":{"type":"integer"},"default":0,"label":"횟수","presentation":"hidden"}]},
        "worker":{"runtime":"python3","code":code,"schedule":{"interval_secs":10,"enabled_entry":"enabled"},"watch_entries":["counter"],"actions":["run"],"secrets":[{"id":"token"}]}}).to_string()
}

pub(super) const CODE: &str = r#"import sys, json, os
v = json.load(sys.stdin)
print(json.dumps({'result': {'env': os.getenv('KALEIDOSCOPE_MCP_TOKEN'), 'secret': v['secrets'].get('token'), 'trigger': v['trigger']['kind']}, 'set_storage': {'counter': v['storage']['counter'] + 1}}))"#;

pub(super) fn setup(code: &str) -> (AppState, String) {
    let state = AppState::in_memory("server-token");
    let account = state.mcp_account_id().unwrap();
    state
        .publish_app(&definition(code), "test", false, None)
        .unwrap();
    (state, account)
}

#[tokio::test]
async fn worker_secrets_invocation_storage_event_and_masking() {
    let (state, account) = setup(CODE);
    let secret = "private-value-123";
    let set = state
        .set_app_secret(&account, "worker-test", "token", secret)
        .unwrap();
    assert!(!set.to_string().contains(secret));
    assert!(!state
        .list_app_secrets(&account, "worker-test")
        .unwrap()
        .to_string()
        .contains(secret));
    let mut events = state.0.events.subscribe();
    let reply = state
        .invoke_worker(
            &account,
            "worker-test",
            WorkerInvokeRequest {
                action: "run".into(),
                workspace_id: None,
                args: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(reply.result["env"], Value::Null);
    assert_eq!(reply.result["secret"], secret);
    assert_eq!(reply.updated_entries, vec!["counter"]);
    assert_eq!(
        state
            .read_app_storage(&account, "worker-test", "counter", None)
            .unwrap()
            .content,
        json!(1)
    );
    assert!(matches!(
        events.try_recv().unwrap().event,
        DeviceEvent::StorageChanged { .. }
    ));
    assert!(events.try_recv().is_err());
    let error_code = "import json,sys\nv=json.load(sys.stdin)\nprint(v['secrets']['token'], file=sys.stderr)\nsys.exit(1)";
    state
        .publish_app(&definition(error_code), "test", false, None)
        .unwrap();
    let error = state
        .invoke_worker(
            &account,
            "worker-test",
            WorkerInvokeRequest {
                action: "run".into(),
                workspace_id: None,
                args: None,
            },
        )
        .await
        .unwrap_err();
    assert!(!error.message.contains(secret));
    assert!(error.message.contains("[REDACTED]"));
    assert!(!state
        .app_worker_status(&account, "worker-test")
        .unwrap()
        .last_error
        .unwrap()
        .contains(secret));
}

#[tokio::test]
async fn worker_watch_and_schedule() {
    let (state, account) = setup(CODE);
    state.lock_db().unwrap().execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,?2,?3,'now')", params!["device-a",account,sha256_hex(b"device-token")]).unwrap();
    let response = router(state.clone())
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/device/app-storage/worker-test/items/counter")
                .header("authorization", "Bearer device-token")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"content":5,"expected_revision":null}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if state
                .read_app_storage(&account, "worker-test", "counter", None)
                .unwrap()
                .content
                == json!(6)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    worker::worker_schedule_tick(&state).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        state
            .read_app_storage(&account, "worker-test", "counter", None)
            .unwrap()
            .content,
        json!(6)
    );
    state
        .write_app_storage(&account, "worker-test", "enabled", None, json!(true), None)
        .unwrap();
    worker::worker_schedule_tick(&state).await;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if state
                .read_app_storage(&account, "worker-test", "counter", None)
                .unwrap()
                .content
                == json!(7)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        state
            .app_worker_status(&account, "worker-test")
            .unwrap()
            .last_trigger
            .as_deref(),
        Some("schedule")
    );
    let response = router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/device/apps/worker-test/worker")
                .header("authorization", "Bearer device-token")
                .header("content-type", "application/json")
                .body(Body::from(json!({"action":"run"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        state
            .read_app_storage(&account, "worker-test", "counter", None)
            .unwrap()
            .content,
        json!(8)
    );
}

#[tokio::test]
async fn disabling_schedule_skips_a_waiting_execution() {
    let code = format!("import time\ntime.sleep(0.3)\n{CODE}");
    let (state, account) = setup(&code);
    let (written, _, _) = state
        .write_app_storage(&account, "worker-test", "enabled", None, json!(true), None)
        .unwrap();
    let running_state = state.clone();
    let running_account = account.clone();
    let running = tokio::spawn(async move {
        running_state
            .invoke_worker(
                &running_account,
                "worker-test",
                WorkerInvokeRequest {
                    action: "run".into(),
                    workspace_id: None,
                    args: None,
                },
            )
            .await
            .unwrap()
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if state
                .app_worker_status(&account, "worker-test")
                .unwrap()
                .running
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    worker::worker_schedule_tick(&state).await;
    state
        .write_app_storage(
            &account,
            "worker-test",
            "enabled",
            None,
            json!(false),
            Some(written.revision),
        )
        .unwrap();
    running.await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        state
            .read_app_storage(&account, "worker-test", "counter", None)
            .unwrap()
            .content,
        json!(1)
    );
    assert_eq!(
        state
            .app_worker_status(&account, "worker-test")
            .unwrap()
            .last_trigger
            .as_deref(),
        Some("action")
    );
}

#[tokio::test]
async fn legacy_client_receives_sanitized_app_and_original_is_preserved() {
    let (state, account) = setup(CODE);
    state.lock_db().unwrap().execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,?2,?3,'now')", params!["device-a",account,sha256_hex(b"token")]).unwrap();
    let mut supported = Supported::current();
    supported.modules.remove("worker");
    state
        .0
        .device_support
        .lock()
        .unwrap()
        .insert("device-a".into(), Some(supported.clone()));
    let original = state.app("worker-test", None).unwrap().unwrap();
    assert!(renders_definition_on(
        Some(&supported),
        &original.version.definition
    ));
    let snapshot = app_for_client(original.clone(), Some(&supported));
    assert!(snapshot.version.definition.worker.is_none());
    assert!(!snapshot
        .version
        .definition
        .requires
        .modules
        .contains_key("worker"));
    let mut interactive = serde_json::to_value(&original.version.definition).unwrap();
    interactive["ui"] =
        json!({"type":"button","label":"실행","on_click":[{"worker":{"action":"run"}}]});
    let interactive = serde_json::from_value(interactive).unwrap();
    assert!(!renders_definition_on(Some(&supported), &interactive));
    let response = router(state.clone())
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/device/events")
                .header("authorization", "Bearer token")
                .header(
                    registry::SUPPORTED_HEADER,
                    serde_json::to_string(&supported).unwrap(),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let mut body = response.into_body().into_data_stream();
    let chunk = tokio::time::timeout(Duration::from_secs(5), body.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let text = String::from_utf8(chunk.to_vec()).unwrap();
    let json = text
        .lines()
        .find_map(|line| line.strip_prefix("data:"))
        .unwrap()
        .trim();
    let event: Value = serde_json::from_str(json).unwrap();
    let app = event["apps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|app| app["app"]["id"] == "worker-test")
        .unwrap();
    assert!(app["version"]["definition"].get("worker").is_none());
    let event = state
        .event_for_device(
            "device-a",
            DeviceEvent::AppPublished {
                app: original,
                open: false,
                workspace_id: None,
            },
        )
        .unwrap();
    assert!(
        matches!(event, DeviceEvent::AppPublished { app, .. } if app.version.definition.worker.is_none())
    );
    assert!(state
        .app("worker-test", None)
        .unwrap()
        .unwrap()
        .version
        .definition
        .worker
        .is_some());
}
