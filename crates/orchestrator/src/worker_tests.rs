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
        "worker":{"runtime":"python3","code":code,"schedule":{"interval_secs":10,"enabled_entry":"enabled"},"watch_entries":["counter"],"actions":["run"],"secrets":[{"id":"token"},{"id":"short"}]}}).to_string()
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

fn assert_database_error(error: kaleidoscope_contract::CoreError, id: &str, detail: Option<&str>) {
    assert_eq!(error.id.as_deref(), Some(id));
    assert_eq!(error.code, kaleidoscope_contract::ErrorCode::Server);
    assert!(!error.details.is_empty());
    if let Some(detail) = detail {
        assert!(error.details.iter().any(|value| value.contains(detail)));
    }
}

async fn webhook_error(
    response: axum::response::Response,
) -> (axum::http::StatusCode, kaleidoscope_contract::CoreError) {
    use http_body_util::BodyExt;
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&body).unwrap())
}

#[tokio::test]
async fn webhook_pre_auth_database_failures_share_a_public_response() {
    let mut previous = None;
    for table in [
        "mcp_principal",
        "app_versions",
        "app_storage_items",
        "app_secrets",
    ] {
        let (state, account) = setup(CODE);
        let mut app: Value = serde_json::from_str(&definition(CODE)).unwrap();
        app["worker"]["webhook"] = json!({"enabled_entry":"enabled","token_secret":"token"});
        state
            .publish_app(&app.to_string(), "test", false, None)
            .unwrap();
        state
            .write_app_storage(&account, "worker-test", "enabled", None, json!(true), None)
            .unwrap();
        state
            .set_app_secret(&account, "worker-test", "token", "test-token")
            .unwrap();
        state
            .lock_db()
            .unwrap()
            .execute(&format!("DROP TABLE {table}"), [])
            .unwrap();
        let request = Request::builder()
            .method("POST")
            .uri("/api/webhooks/worker-test")
            .body(Body::from("{}"))
            .unwrap();
        let (status, error) = webhook_error(router(state).oneshot(request).await.unwrap()).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{table}");
        assert_eq!(
            error.id.as_deref(),
            Some("WORKER_WEBHOOK_REQUEST_UNAVAILABLE"),
            "{table}"
        );
        assert!(error.details.is_empty(), "{table}");
        if let Some(previous) = &previous {
            assert_eq!(&error, previous, "{table}");
        }
        previous = Some(error);
    }
}

#[tokio::test]
async fn webhook_requires_configured_token_and_enabled_entry() {
    let (state, account) = setup(CODE);
    let mut app: Value = serde_json::from_str(&definition(CODE)).unwrap();
    app["worker"]["webhook"] = json!({"enabled_entry":"enabled","token_secret":"token"});
    state
        .publish_app(&app.to_string(), "test", false, None)
        .unwrap();
    state
        .write_app_storage(&account, "worker-test", "enabled", None, json!(true), None)
        .unwrap();
    let request = || {
        Request::builder()
            .method("POST")
            .uri("/api/webhooks/worker-test")
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap()
    };
    let response = router(state.clone()).oneshot(request()).await.unwrap();
    let (status, missing_secret_error) = webhook_error(response).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(missing_secret_error.code, ErrorCode::Unauthorized);
    assert_eq!(
        missing_secret_error.id.as_deref(),
        Some("WORKER_WEBHOOK_TOKEN_INVALID")
    );
    assert!(!missing_secret_error.message.contains("시크릿"));
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO app_secrets(account_id,app_id,secret_id,value,updated_at) VALUES(?1,?2,'token','','now')",
            params![account, "worker-test"],
        )
        .unwrap();
    let response = router(state.clone()).oneshot(request()).await.unwrap();
    let (status, empty_secret_error) = webhook_error(response).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(empty_secret_error, missing_secret_error);
    state
        .set_app_secret(&account, "worker-test", "token", "test-token")
        .unwrap();
    let response = router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/webhooks/worker-test/wrong-token")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, invalid_token_error) = webhook_error(response).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(invalid_token_error, missing_secret_error);
    assert!(!invalid_token_error.message.contains("test-token"));
    assert!(!invalid_token_error.message.contains("wrong-token"));
    let response = router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/webhooks/worker-test/test-token")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[test]
fn worker_secret_database_operations_have_specific_ids_and_sql_details() {
    let (state, account) = setup(CODE);
    state
        .lock_db()
        .unwrap()
        .execute_batch("DROP TABLE app_secrets")
        .unwrap();

    assert_database_error(
        state
            .set_app_secret(&account, "worker-test", "token", "value")
            .unwrap_err(),
        "WORKER_SECRET_SAVE_DATABASE_FAILED",
        Some("app_secrets"),
    );
    assert_database_error(
        state.list_app_secrets(&account, "worker-test").unwrap_err(),
        "WORKER_SECRET_LIST_DATABASE_FAILED",
        Some("app_secrets"),
    );
    assert_database_error(
        state
            .delete_app_secret(&account, "worker-test", "token")
            .unwrap_err(),
        "WORKER_SECRET_DELETE_DATABASE_FAILED",
        Some("app_secrets"),
    );
}

#[tokio::test]
async fn worker_run_database_failures_have_specific_ids_and_sql_details() {
    let (state, account) = setup(CODE);
    state.lock_db().unwrap().execute_batch("BEGIN").unwrap();
    let workspace_error = state
        .invoke_worker(
            &account,
            "worker-test",
            WorkerInvokeRequest {
                action: "run".into(),
                workspace_id: Some("workspace".into()),
                args: None,
            },
        )
        .await
        .unwrap_err();
    assert_database_error(
        workspace_error,
        "WORKER_RUN_WORKSPACE_CHECK_DATABASE_FAILED",
        None,
    );
    let _ = state.lock_db().unwrap().execute_batch("ROLLBACK");

    let (state, account) = setup(CODE);
    state
        .lock_db()
        .unwrap()
        .execute_batch("DROP TABLE app_secrets")
        .unwrap();
    let secret_error = state
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
    assert_database_error(
        secret_error,
        "WORKER_RUN_SECRET_READ_DATABASE_FAILED",
        Some("app_secrets"),
    );
}

#[tokio::test]
async fn webhook_response_and_deferred_action_are_independent() {
    use http_body_util::BodyExt;
    let code = r#"import json, sys
v = json.load(sys.stdin)
if v['trigger']['kind'] == 'webhook':
    print(json.dumps({'http_response': {'status': 202, 'body': {'challenge': v['trigger']['body']['challenge']}}, 'defer': {'action': 'run'}}))
else:
    print(json.dumps({'set_storage': {'counter': 73}}))"#;
    let (state, account) = setup(code);
    let mut app: Value = serde_json::from_str(&definition(code)).unwrap();
    app["worker"]["webhook"] = json!({"token_secret":"token"});
    state
        .publish_app(&app.to_string(), "test", false, None)
        .unwrap();
    state
        .set_app_secret(&account, "worker-test", "token", "test-token")
        .unwrap();
    let response = router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/webhooks/worker-test/test-token")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"challenge":"hello"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap()["challenge"],
        "hello"
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        while state
            .read_app_storage(&account, "worker-test", "counter", None)
            .unwrap()
            .content
            != json!(73)
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn webhook_ack_is_not_blocked_by_running_action() {
    let code = r#"import json, sys, time
v = json.load(sys.stdin)
if v['trigger']['kind'] == 'webhook':
    print(json.dumps({'http_response': {'status': 200, 'body': {'ok': True}}}))
else:
    time.sleep(2)
    print(json.dumps({'result': 'done'}))"#;
    let (state, account) = setup(code);
    let mut app: Value = serde_json::from_str(&definition(code)).unwrap();
    app["worker"]["webhook"] = json!({"token_secret":"token"});
    state
        .publish_app(&app.to_string(), "test", false, None)
        .unwrap();
    state
        .set_app_secret(&account, "worker-test", "token", "test-token")
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
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while !state
            .app_worker_status(&account, "worker-test")
            .unwrap()
            .running
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let response = tokio::time::timeout(
        Duration::from_secs(1),
        router(state).oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/webhooks/worker-test/test-token")
                .body(Body::from("{}"))
                .unwrap(),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    running.await.unwrap().unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn worker_timeout_stops_spawned_children() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(dir.path().join("test.db"), "token".into()).unwrap();
    let account = state.mcp_account_id().unwrap();
    let code = r#"import subprocess,sys,time
subprocess.Popen([sys.executable, '-c', "import time,pathlib; time.sleep(2); pathlib.Path('orphan').write_text('x')"])
time.sleep(10)"#;
    let mut app: Value = serde_json::from_str(&definition(code)).unwrap();
    app["worker"]["timeout_secs"] = json!(1);
    state
        .publish_app(&app.to_string(), "test", false, None)
        .unwrap();
    assert!(state
        .invoke_worker(
            &account,
            "worker-test",
            WorkerInvokeRequest {
                action: "run".into(),
                workspace_id: None,
                args: None
            }
        )
        .await
        .is_err());
    tokio::time::sleep(Duration::from_secs(3)).await;
    let marker = dir
        .path()
        .join("worker-state")
        .join(super::app_storage::bucket_id(&account, "worker-test"))
        .join("worker-test/orphan");
    assert!(!marker.exists());
}

#[tokio::test]
async fn inter_app_calls_enforce_declarations_and_return_storage() {
    let state = AppState::in_memory("test");
    let account = state.mcp_account_id().unwrap();
    let mut b: Value = serde_json::from_str(&definition(
        "import json; print(json.dumps({'result': 'answer'}))",
    ))
    .unwrap();
    b["id"] = json!("app-b");
    state
        .publish_app(&b.to_string(), "test", false, None)
        .unwrap();
    let code = "import json\nfrom kaleidoscope_worker import call_app, read_app_storage\nprint(json.dumps({'result': [call_app('app-b', 'run'), read_app_storage('app-b', 'counter')]}))";
    let mut a: Value = serde_json::from_str(&definition(code)).unwrap();
    a["id"] = json!("app-a");
    a["worker"]["calls"] = json!(["app-b"]);
    state
        .publish_app(&a.to_string(), "test", false, None)
        .unwrap();
    let req = || WorkerInvokeRequest {
        action: "run".into(),
        workspace_id: None,
        args: None,
    };
    let result = state.invoke_worker(&account, "app-a", req()).await.unwrap();
    assert_eq!(result.result, json!(["answer", 0]));
    a["worker"]["calls"] = json!([]);
    state
        .publish_app(&a.to_string(), "test", false, None)
        .unwrap();
    assert!(state.invoke_worker(&account, "app-a", req()).await.is_err());
    a["worker"]["calls"] = json!(["app-b"]);
    b["worker"]["calls"] = json!(["app-a"]);
    b["worker"]["code"] =
        json!("from kaleidoscope_worker import call_app\ncall_app('app-a', 'run')");
    state
        .publish_app(&a.to_string(), "test", false, None)
        .unwrap();
    state
        .publish_app(&b.to_string(), "test", false, None)
        .unwrap();
    assert!(tokio::time::timeout(
        Duration::from_secs(5),
        state.invoke_worker(&account, "app-a", req())
    )
    .await
    .unwrap()
    .is_err());
}

#[tokio::test]
async fn worker_builtin_webhook_and_test_action_reach_agent_and_service() {
    use kaleidoscope_contract::worker::BuiltinRuntimeSpec;
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(dir.path().join("test.db"), "token".into()).unwrap();
    let account = state.mcp_account_id().unwrap();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/agent.json");
    let agent = parse_app_definition(&std::fs::read_to_string(path).unwrap()).unwrap();
    state
        .register_builtin_specs(&[BuiltinRuntimeSpec {
            app_id: agent.id,
            version: 5,
            storage: agent.storage,
            worker: agent.worker,
        }])
        .unwrap();
    state.write_app_storage(&account, "agent", "agents", None,
        json!([{"id":"mock","name":"시험","command":"python3","args":["-c","print('시험 답변')","{prompt}"],"env":{}}]), None).unwrap();
    let code = r#"import sys, json
from kaleidoscope_worker import call_app
v = json.load(sys.stdin)
if v['trigger']['kind'] == 'webhook':
    print(json.dumps({'http_response': {'status': 202, 'body': {'ok': True}}, 'defer': {'action': 'run', 'args': {'prompt': v['trigger']['body']['prompt']}}}))
else:
    answer = call_app('agent', 'ask', {'prompt': v['trigger']['args']['prompt']})
    print(json.dumps({'set_storage': {'reply': answer['reply']}}))"#;
    let mut app: Value = serde_json::from_str(&definition(code)).unwrap();
    app["storage"]["entries"].as_array_mut().unwrap().push(json!({"id":"reply", "key":"reply", "kind":"json", "schema":{"type":"string"}, "default":"", "label":"응답", "presentation":"hidden"}));
    app["worker"]["webhook"] = json!({"token_secret":"token"});
    app["worker"]["calls"] = json!(["agent"]);
    state
        .publish_app(&app.to_string(), "test", false, None)
        .unwrap();
    state
        .set_app_secret(&account, "worker-test", "token", "webhook-test")
        .unwrap();
    let response = router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/webhooks/worker-test/webhook-test")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"안녕"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let value = state
                .read_app_storage(&account, "worker-test", "reply", None)
                .unwrap()
                .content;
            if value == json!("시험 답변") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn worker_builtin_runtime_registration_requires_device_and_valid_declarations() {
    use kaleidoscope_contract::worker::BuiltinRuntimeSpec;
    let state = AppState::in_memory("test");
    let account = state.mcp_account_id().unwrap();
    state.lock_db().unwrap().execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,?2,?3,'now')", params!["d",account,sha256_hex(b"device-token")]).unwrap();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/agent.json");
    let app = parse_app_definition(&std::fs::read_to_string(path).unwrap()).unwrap();
    let spec = BuiltinRuntimeSpec {
        app_id: app.id,
        version: 5,
        storage: app.storage,
        worker: app.worker,
    };
    let request = |token: &str, value: Value| {
        Request::builder()
            .method("POST")
            .uri("/api/device/builtin-specs")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(value.to_string()))
            .unwrap()
    };
    let body = json!([spec]);
    assert_eq!(
        router(state.clone())
            .oneshot(request("wrong", body.clone()))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        router(state.clone())
            .oneshot(request("device-token", body.clone()))
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES('other','다른 계정','now')",
            [],
        )
        .unwrap();
        db.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('other-device','other','other',?1,'now')", [sha256_hex(b"other-token")]).unwrap();
    }
    let mut foreign = body.clone();
    foreign[0]["version"] = json!(99);
    assert_eq!(
        router(state.clone())
            .oneshot(request("other-token", foreign))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let mut invalid = body;
    invalid[0]["worker"]["calls"] = json!(["agent"]);
    assert_eq!(
        router(state.clone())
            .oneshot(request("device-token", invalid))
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert!(state.worker_definition("agent").is_ok());
}

#[tokio::test]
async fn worker_retired_builtin_registration_is_ignored() {
    let state = AppState::in_memory("test");
    let account = state.mcp_account_id().unwrap();
    state.lock_db().unwrap().execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,?2,?3,'now')", params!["d", account, sha256_hex(b"device-token")]).unwrap();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/agent.json");
    let agent = parse_app_definition(&std::fs::read_to_string(path).unwrap()).unwrap();
    let specs = json!([
        {"app_id":"agent","version":5,"storage":agent.storage,"worker":agent.worker},
        {"app_id":"slackbot","version":2,"worker":{"runtime":"python3","code":""}}
    ]);
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO builtin_app_specs(app_id,version,updated_at) VALUES('slackbot',2,'now')",
            [],
        )
        .unwrap();
    assert!(
        super::builtin_specs::load_definition(&state.lock_db().unwrap(), "slackbot")
            .unwrap()
            .is_none()
    );
    let response = router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/device/builtin-specs")
                .header("authorization", "Bearer device-token")
                .header("content-type", "application/json")
                .body(Body::from(specs.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let db = state.lock_db().unwrap();
    let ids: Vec<String> = db
        .prepare("SELECT app_id FROM builtin_app_specs ORDER BY app_id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(ids, ["agent"]);
    drop(db);
    let response = router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/device/builtin-specs")
                .header("authorization", "Bearer device-token")
                .header("content-type", "application/json")
                .body(Body::from(r#"[{"app_id":"unknown-app","version":1}]"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let (status, error) = webhook_error(response).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error.id.as_deref(), Some("APP_BUILTIN_SPEC_APP_ID_INVALID"));
}

#[tokio::test]
async fn builtin_agent_falls_back_after_early_adapter_exit() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(dir.path().join("test.db"), "token".into()).unwrap();
    let account = state.mcp_account_id().unwrap();
    let agents = json!([
        {"id":"first", "name":"첫 후보", "command":"python3", "args":["-c", "pass"], "env":{}},
        {"id":"second", "name":"다음 후보", "command":"python3", "args":["-c", "print('응답')", "{prompt}"], "env":{}}
    ]);
    state
        .write_app_storage(&account, "agent", "agents", None, agents, None)
        .unwrap();
    let reply = tokio::time::timeout(
        Duration::from_secs(5),
        state.invoke_worker(
            &account,
            "agent",
            WorkerInvokeRequest {
                action: "ask".into(),
                workspace_id: None,
                args: Some(json!({"prompt":"안녕"})),
            },
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(reply.result["agent_id"], "second");
    assert_eq!(reply.result["reply"], "응답");
}

#[tokio::test]
async fn worker_secrets_invocation_storage_event_and_masking() {
    let (state, account) = setup(CODE);
    let secret = "private-value-123";
    let short_secret = "pri";
    let set = state
        .set_app_secret(&account, "worker-test", "token", secret)
        .unwrap();
    state
        .set_app_secret(&account, "worker-test", "short", short_secret)
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
    let error_code = "import json,sys\nv=json.load(sys.stdin)\nprint(v['secrets']['token'], v['secrets']['short'], file=sys.stderr)\nsys.exit(1)";
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
    assert!(!error.message.contains(short_secret));
    assert!(error.message.contains("[REDACTED] [REDACTED]"));
    assert!(error.message.contains("[REDACTED]"));
    assert!(!state
        .app_worker_status(&account, "worker-test")
        .unwrap()
        .last_error
        .unwrap()
        .contains(secret));
}

#[tokio::test]
async fn worker_storage_write_conflicts_with_external_change_during_execution() {
    let code = r#"import json, pathlib, sys, time
v = json.load(sys.stdin)
pathlib.Path('ready').write_text('ready')
while not pathlib.Path('release').exists():
    time.sleep(0.01)
print(json.dumps({'set_storage': {'counter': v['storage']['counter'] + 1}}))"#;
    let (state, account) = setup(code);
    let state_dir = std::env::temp_dir()
        .join("kaleidoscope-worker-state")
        .join(super::app_storage::bucket_id(&account, "worker-test"))
        .join("worker-test");
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
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while !state_dir.join("ready").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    state
        .write_app_storage(&account, "worker-test", "counter", None, json!(42), None)
        .unwrap();
    std::fs::write(state_dir.join("release"), "release").unwrap();
    let error = running.await.unwrap().unwrap_err();
    assert_eq!(error.code, ErrorCode::Conflict);
    assert_eq!(
        state
            .read_app_storage(&account, "worker-test", "counter", None)
            .unwrap()
            .content,
        json!(42)
    );
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
