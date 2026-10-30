use super::*;

#[tokio::test]
async fn connection_snapshots_follow_apps_and_only_reach_supported_devices() {
    use kaleidoscope_contract::{registry::SUPPORTED_HEADER, Supported};

    let state = AppState::in_memory("secret");
    let (_, token) = make_device(&state);
    let supported_request = Request::builder()
        .method("GET")
        .uri("/api/device/events")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(
            SUPPORTED_HEADER,
            serde_json::to_string(&Supported::current()).unwrap(),
        )
        .body(Body::empty())
        .unwrap();
    let response = router(state.clone())
        .oneshot(supported_request)
        .await
        .unwrap();
    let mut stream = response.into_body().into_data_stream();
    assert_eq!(
        next_device_event(&mut stream).await["event"],
        "apps.snapshot"
    );
    assert_eq!(
        next_device_event(&mut stream).await["event"],
        "connections.snapshot"
    );

    state
        .set_connection(super::connections::ConnectionRegistration {
            name: "board".into(),
            kind: kaleidoscope_contract::registry::ConnectionKind::Relay,
            base_url: "https://example.com".into(),
            description: None,
            writable: None,
            paths: None,
            headers: Some(std::collections::BTreeMap::from([(
                "Authorization".into(),
                "private".into(),
            )])),
            issuer: None,
            scopes: None,
            resource: None,
        })
        .unwrap();
    let event = next_device_event(&mut stream).await;
    assert_eq!(event["event"], "connections.snapshot");
    assert_eq!(event["connections"][0]["name"], "board");
    assert!(!event.to_string().contains("private"));

    let (_, legacy_token) = make_device(&state);
    let legacy = router(state.clone())
        .oneshot(request(
            "GET",
            "/api/device/events",
            Some(&legacy_token),
            Body::empty(),
        ))
        .await
        .unwrap();
    let mut legacy_stream = legacy.into_body().into_data_stream();
    assert_eq!(
        next_device_event(&mut legacy_stream).await["event"],
        "apps.snapshot"
    );
    assert!(state
        .event_for_device(
            "legacy",
            DeviceEvent::ConnectionsSnapshot {
                connections: vec![]
            }
        )
        .is_none());
}

#[tokio::test]
async fn targeted_events_follow_each_devices_last_report_and_survive_restart() {
    use kaleidoscope_contract::{registry::DeviceLayout, AgentUpdate, Workspace};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.db");
    let state = AppState::open(&path, "secret".into()).unwrap();
    let (a, token_a) = make_device(&state);
    let (_, token_b) = make_device(&state);
    let layout = DeviceLayout {
        workspaces: vec![Workspace {
            id: "w".into(),
            name: "작업".into(),
            created_at: "t".into(),
            updated_at: "t".into(),
        }],
        ..Default::default()
    };
    state
        .apply_layout_changes(
            Some(&a),
            &registry::LayoutChanges {
                workspaces: layout.workspaces.clone(),
                ..Default::default()
            },
        )
        .unwrap();
    let req = Request::builder()
        .method("PUT")
        .uri("/api/device/layout")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .body(Body::from(serde_json::to_string(&layout).unwrap()))
        .unwrap();
    assert_eq!(
        router(state.clone()).oneshot(req).await.unwrap().status(),
        StatusCode::OK
    );
    drop(state);
    let state = AppState::open(&path, "secret".into()).unwrap();
    let app = router(state.clone());
    let mut stream_a = app
        .clone()
        .oneshot(current_shell_request(
            "GET",
            "/api/device/events",
            &token_a,
            Body::empty(),
        ))
        .await
        .unwrap()
        .into_body()
        .into_data_stream();
    let mut stream_b = app
        .oneshot(current_shell_request(
            "GET",
            "/api/device/events",
            &token_b,
            Body::empty(),
        ))
        .await
        .unwrap()
        .into_body()
        .into_data_stream();
    assert_eq!(
        next_device_event(&mut stream_a).await["event"],
        "apps.snapshot"
    );
    assert_eq!(
        next_device_event(&mut stream_a).await["event"],
        "connections.snapshot"
    );
    assert_eq!(
        next_device_event(&mut stream_b).await["event"],
        "apps.snapshot"
    );
    assert_eq!(
        next_device_event(&mut stream_b).await["event"],
        "connections.snapshot"
    );
    assert_eq!(state.connected_count_for(Some("w")), 1);
    state
        .publish_app(EDITOR, "agent", true, Some("w".into()))
        .unwrap();
    let event_a = next_device_event(&mut stream_a).await;
    let event_b = next_device_event(&mut stream_b).await;
    assert_eq!(event_a["open"], true);
    assert_eq!(event_a["workspace_id"], "w");
    assert_eq!(event_b["open"], false);
    assert!(event_b.get("workspace_id").is_none());
    state.send_event(DeviceEvent::AgentUpdate {
        workspace_id: "w".into(),
        update: AgentUpdate::Delta { text: "답".into() },
    });
    state.send_event(DeviceEvent::AppOpen {
        app_id: "target".into(),
        workspace_id: Some("w".into()),
    });
    state.send_event(DeviceEvent::AppOpen {
        app_id: "marker".into(),
        workspace_id: None,
    });
    assert_eq!(
        next_device_event(&mut stream_a).await["event"],
        "agent.update"
    );
    assert_eq!(next_device_event(&mut stream_a).await["app_id"], "target");
    assert_eq!(next_device_event(&mut stream_b).await["app_id"], "marker");
    assert_eq!(next_device_event(&mut stream_a).await["app_id"], "marker");
    state.save_layout(&a, &DeviceLayout::default()).unwrap();
    assert_eq!(state.connected_count_for(Some("w")), 0);
}
