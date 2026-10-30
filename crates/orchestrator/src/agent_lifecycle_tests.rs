use super::*;
use axum::extract::State as MockState;

#[derive(Clone, Default)]
struct LifecycleMock(Arc<Mutex<Vec<(String, Value)>>>);

async fn lifecycle_update(
    MockState(mock): MockState<LifecycleMock>,
    Path(session): Path<String>,
    Json(body): Json<Value>,
) -> StatusCode {
    mock.0.lock().unwrap().push((session, body));
    StatusCode::NO_CONTENT
}

async fn lifecycle_update_failure(
    MockState(mock): MockState<LifecycleMock>,
    Path(session): Path<String>,
    Json(body): Json<Value>,
) -> StatusCode {
    mock.0.lock().unwrap().push((session, body));
    StatusCode::SERVICE_UNAVAILABLE
}

async fn lifecycle_events() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/event-stream")], "")
}

fn insert_agent(state: &AppState, workspace_id: &str, session_id: &str, name: &str) {
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO agents(workspace_id,device_id,session_id,model_preset,workspace_name,created_at) VALUES(?1,'device',?2,'codex-6.1-sol',?3,'now')",
            params![workspace_id, session_id, name],
        )
        .unwrap();
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO agent_items(workspace_id,kind,text,at) VALUES(?1,'user','기록','now')",
            [workspace_id],
        )
        .unwrap();
}

async fn wait_until(mut predicate: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if predicate() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("비동기 소울스트림 처리가 끝나지 않았습니다");
}

#[tokio::test]
async fn workspace_name_change_and_delete_update_pas_without_blocking() {
    let mock = LifecycleMock::default();
    let app = Router::new()
        .route(
            "/api/persistent-sessions/{session}",
            axum::routing::put(lifecycle_update),
        )
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut state = AppState::in_memory("secret");
    state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        None,
    );
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![
                    Workspace {
                        id: "w".into(),
                        name: "처음 이름".into(),
                        created_at: "created".into(),
                        updated_at: "updated".into(),
                    },
                    Workspace {
                        id: "other".into(),
                        name: "다른 작업".into(),
                        created_at: "other".into(),
                        updated_at: "other".into(),
                    },
                ],
                ..Default::default()
            },
        )
        .unwrap();
    insert_agent(&state, "w", "pas-w", "처음 이름");
    state
        .0
        .activity
        .lock()
        .unwrap()
        .insert("w".into(), (true, Some("도구".into())));

    state.rename_agent("w", "바뀐 이름");
    wait_until(|| {
        state
            .agent_row("w")
            .unwrap()
            .is_some_and(|row| row.workspace_name == "바뀐 이름")
    })
    .await;
    assert!(mock.0.lock().unwrap().iter().any(|(session, body)| {
        session == "pas-w" && body["display_name"] == "kaleidoscope · 바뀐 이름"
    }));

    let relay = tokio::spawn(std::future::pending::<()>());
    state
        .0
        .relays
        .lock()
        .unwrap()
        .insert("w".into(), relay.abort_handle());
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                deleted_workspaces: vec!["w".into()],
                ..Default::default()
            },
        )
        .unwrap();
    assert!(relay.await.unwrap_err().is_cancelled());
    wait_until(|| state.agent_row("w").unwrap().is_none()).await;
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM agent_items WHERE workspace_id='w'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
    assert!(!state.0.activity.lock().unwrap().contains_key("w"));
    assert!(mock
        .0
        .lock()
        .unwrap()
        .iter()
        .any(|(session, body)| { session == "pas-w" && body["enabled"] == false }));
    server.abort();
}

#[tokio::test]
async fn failed_pas_retirement_keeps_the_relay_and_local_history() {
    let mock = LifecycleMock::default();
    let app = Router::new()
        .route(
            "/api/persistent-sessions/{session}",
            axum::routing::put(lifecycle_update_failure),
        )
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut state = AppState::in_memory("secret");
    state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        None,
    );
    insert_agent(&state, "w", "pas-w", "작업");
    let mut relay = tokio::spawn(std::future::pending::<()>());
    state
        .0
        .relays
        .lock()
        .unwrap()
        .insert("w".into(), relay.abort_handle());

    assert!(state.retire_agent("w"));
    wait_until(|| !mock.0.lock().unwrap().is_empty()).await;
    assert!(tokio::time::timeout(Duration::from_millis(50), &mut relay)
        .await
        .is_err());
    assert!(state.agent_row("w").unwrap().is_some());
    assert_eq!(
        state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM agent_items WHERE workspace_id='w'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );

    relay.abort();
    server.abort();
}

#[tokio::test]
async fn startup_retires_pas_without_canonical_workspace_and_starts_valid_relay() {
    let mock = LifecycleMock::default();
    let app = Router::new()
        .route(
            "/api/persistent-sessions/{session}",
            axum::routing::put(lifecycle_update),
        )
        .route("/api/sessions/{session}/events", get(lifecycle_events))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut state = AppState::in_memory("secret");
    state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        None,
    );
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![Workspace {
                    id: "valid".into(),
                    name: "작업".into(),
                    created_at: "created".into(),
                    updated_at: "updated".into(),
                }],
                ..Default::default()
            },
        )
        .unwrap();
    insert_agent(&state, "valid", "valid-pas", "작업");
    insert_agent(&state, "orphan", "orphan-pas", "옛 작업");

    state.start_relays().unwrap();
    assert!(state.0.relays.lock().unwrap().contains_key("valid"));
    wait_until(|| state.agent_row("orphan").unwrap().is_none()).await;
    assert!(mock
        .0
        .lock()
        .unwrap()
        .iter()
        .any(|(session, body)| { session == "orphan-pas" && body["enabled"] == false }));
    let relay = state.0.relays.lock().unwrap().remove("valid").unwrap();
    relay.abort();
    server.abort();
}
