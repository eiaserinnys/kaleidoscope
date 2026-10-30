use super::*;

#[tokio::test]
async fn old_shell_layout_report_owns_unknown_workspace_for_agent_api_only() {
    use http_body_util::BodyExt;

    let mut state = legacy_v5_state();
    let mock = Router::new()
        .route("/api/persistent-sessions", post(legacy_pas_create))
        .route(
            "/api/persistent-sessions/{id}",
            axum::routing::put(legacy_pas_ok),
        )
        .route(
            "/api/persistent-sessions/{id}/instructions",
            post(legacy_pas_ok),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    state.configure_soulstream(
        Some(format!("http://{address}")),
        Some("token".into()),
        "seosoyoung".into(),
        None,
    );

    let workspace_id = "legacy-shell-only";
    let layout = DeviceLayout {
        workspaces: vec![Workspace {
            id: workspace_id.into(),
            name: "옛 쉘 작업".into(),
            created_at: "created".into(),
            updated_at: "updated".into(),
        }],
        ..Default::default()
    };
    let response = crate::router(state.clone())
        .oneshot(
            axum::http::Request::builder()
                .method("PUT")
                .uri("/api/device/layout")
                .header(axum::http::header::AUTHORIZATION, "Bearer legacy-token")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(serde_json::to_vec(&layout).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(state.get_workspace(workspace_id).unwrap().is_none());
    assert!(state
        .device_owns_workspace("old-device", workspace_id)
        .unwrap());

    let response = crate::router(state.clone())
        .oneshot(
            axum::http::Request::builder()
                .uri(format!("/api/device/workspaces/{workspace_id}/agent"))
                .header(axum::http::header::AUTHORIZATION, "Bearer legacy-token")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reply: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(reply["agent"], Value::Null);

    let response = crate::router(state.clone())
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri(format!("/api/device/workspaces/{workspace_id}/agent"))
                .header(axum::http::header::AUTHORIZATION, "Bearer legacy-token")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::to_vec(&json!({
                        "workspace_name":"옛 쉘 작업",
                        "model_preset":"codex-6.1-sol"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let created: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(created["workspace_id"], workspace_id);
    assert_eq!(created["model_preset"], "codex-6.1-sol");

    let second_account = Uuid::new_v4().to_string();
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES(?1,'Second','now')",
            [&second_account],
        )
        .unwrap();
        db.execute(
            "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('second-old-device','Second PC',?1,?2,'now')",
            params![second_account, sha256_hex(b"second-token")],
        )
        .unwrap();
    }
    let response = crate::router(state.clone())
        .oneshot(
            axum::http::Request::builder()
                .method("PUT")
                .uri("/api/device/layout")
                .header(axum::http::header::AUTHORIZATION, "Bearer second-token")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(serde_json::to_vec(&layout).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!state
        .device_owns_workspace("second-old-device", workspace_id)
        .unwrap());
    let second_layout: DeviceLayout = serde_json::from_str(
        &state
            .lock_db()
            .unwrap()
            .query_row(
                "SELECT layout FROM device_layouts WHERE device_id='second-old-device'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
    )
    .unwrap();
    assert!(second_layout.workspaces.is_empty());
    let response = crate::router(state.clone())
        .oneshot(
            axum::http::Request::builder()
                .uri(format!("/api/device/workspaces/{workspace_id}/agent"))
                .header(axum::http::header::AUTHORIZATION, "Bearer second-token")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let changes = registry::LayoutChanges {
        workspaces: layout.workspaces.clone(),
        ..Default::default()
    };
    let post_changes = |token: &str| {
        axum::http::Request::builder()
            .method("POST")
            .uri(registry::DEVICE_LAYOUT_CHANGES_PATH)
            .header(axum::http::header::AUTHORIZATION, format!("Bearer {token}"))
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::to_vec(&changes).unwrap(),
            ))
            .unwrap()
    };
    let response = crate::router(state.clone())
        .oneshot(post_changes("second-token"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reply: registry::LayoutChanges =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert!(reply.workspaces.is_empty());
    assert_eq!(reply.deleted_workspaces, vec![workspace_id]);

    let response = crate::router(state.clone())
        .oneshot(
            axum::http::Request::builder()
                .uri(format!("/api/device/workspaces/{workspace_id}/agent"))
                .header(axum::http::header::AUTHORIZATION, "Bearer legacy-token")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reply: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(reply["agent"]["workspace_id"], workspace_id);
    assert!(!state
        .device_owns_workspace("second-old-device", workspace_id)
        .unwrap());

    let response = crate::router(state.clone())
        .oneshot(post_changes("legacy-token"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reply: registry::LayoutChanges =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(reply.workspaces.len(), 1);
    assert_eq!(reply.workspaces[0].id, workspace_id);
    assert!(state.get_workspace(workspace_id).unwrap().is_some());
    assert!(state
        .device_owns_workspace("old-device", workspace_id)
        .unwrap());
    assert!(!state
        .device_owns_workspace("second-old-device", workspace_id)
        .unwrap());
    for (token, expected) in [
        ("legacy-token", StatusCode::OK),
        ("second-token", StatusCode::NOT_FOUND),
    ] {
        let response = crate::router(state.clone())
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!("/api/device/workspaces/{workspace_id}/agent"))
                    .header(axum::http::header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    let db = state.lock_db().unwrap();
    let owner_account: String = db
        .query_row(
            "SELECT account_id FROM legacy_workspace_owners WHERE workspace_id=?1",
            [workspace_id],
            |row| row.get(0),
        )
        .unwrap();
    let reporter_account: String = db
        .query_row(
            "SELECT account_id FROM devices WHERE id='old-device'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(owner_account, reporter_account);
    task.abort();
}
