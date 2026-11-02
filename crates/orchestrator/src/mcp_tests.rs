use super::*;
use kaleidoscope_contract::registry::DeviceLayout;

const LEGACY_APP: &str = include_str!("fixtures/simple-app.json");

#[tokio::test]
async fn delete_app_closes_windows_and_resurrection_republishes() {
    let state = AppState::in_memory("secret");
    let (app, _) = state.publish_app(LEGACY_APP, "test", false, None).unwrap();
    let app_id = app.app.id.clone();
    let changes: registry::LayoutChanges = serde_json::from_value(json!({
        "workspaces":[{"id":"w","name":"작업","created_at":"t","updated_at":"t"}],
        "desktops":[{"id":"d","workspace_id":"w","name":"화면","position":0,"created_at":"t","updated_at":"t"}],
        "windows":[{"id":"win","desktop_id":"d","app_id":app_id,"app_version":1,"rect":{"x":0,"y":0,"width":100,"height":100},"z":1,"state":{},"created_at":"t","updated_at":"t"}]
    })).unwrap();
    state.apply_layout_changes(None, &changes).unwrap();
    let mut events = state.0.events.subscribe();
    let server = McpServer::new(state.clone());
    let result = server
        .delete_app(Parameters(DeleteAppArgs {
            app_id: app_id.clone(),
        }))
        .await
        .unwrap();
    let result = serde_json::to_value(result).unwrap();
    let value: Value =
        serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(value["closed_windows"], 1);
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::LayoutChanged { changes } if changes.deleted_windows == ["win"])
    );
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::AppDeleted { app_id: id } if id == app_id)
    );
    assert!(state.app(&app_id, None).unwrap().is_none());
    assert!(state.deleted_app_ids().unwrap().contains(&app_id));
    assert!(!state
        .current_apps()
        .unwrap()
        .iter()
        .any(|row| row.app.id == app_id));
    state.lock_db().unwrap().execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('offline','PC',(SELECT account_id FROM mcp_principal WHERE id=1),'token','now')", []).unwrap();
    use futures::StreamExt;
    let stream = state
        .stream_with_registry(
            "offline".into(),
            Some(Supported::current()),
            registry::REGISTRY_VERSION,
        )
        .unwrap();
    let response = axum::response::Sse::new(stream).into_response();
    let mut body = response.into_body().into_data_stream();
    let chunk = body.next().await.unwrap().unwrap();
    let line = std::str::from_utf8(&chunk)
        .unwrap()
        .trim()
        .strip_prefix("data: ")
        .unwrap();
    let event: DeviceEvent = serde_json::from_str(line).unwrap();
    assert!(
        matches!(event, DeviceEvent::AppsSnapshot { apps, deleted } if deleted.contains(&app_id) && !apps.iter().any(|app| app.app.id == app_id))
    );
    let (revived, unchanged) = state.publish_app(LEGACY_APP, "test", false, None).unwrap();
    assert!(unchanged);
    assert_eq!(revived.version.version, 1);
    assert!(
        matches!(events.try_recv().unwrap().event, DeviceEvent::AppPublished { app, .. } if app.app.id == app_id)
    );
    assert!(!state.deleted_app_ids().unwrap().contains(&app_id));
    let denied = server
        .delete_app(Parameters(DeleteAppArgs {
            app_id: "md-editor".into(),
        }))
        .await
        .unwrap();
    assert!(serde_json::to_value(denied).unwrap()["isError"]
        .as_bool()
        .unwrap_or(false));
}

#[tokio::test]
async fn open_counts_connected_devices_with_the_requested_workspace() {
    use kaleidoscope_contract::Supported;
    let state = AppState::in_memory("secret");
    for id in ["a", "b"] {
        state
            .lock_db()
            .unwrap()
            .execute(
                "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,(SELECT account_id FROM mcp_principal WHERE id=1),?1,'now')",
                [id],
            )
            .unwrap();
    }
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: vec![kaleidoscope_contract::Workspace {
                    id: "w".into(),
                    name: "작업".into(),
                    created_at: "t".into(),
                    updated_at: "t".into(),
                }],
                ..Default::default()
            },
        )
        .unwrap();
    let layout: DeviceLayout = serde_json::from_value(json!({"workspaces":[{"id":"w","name":"작업","created_at":"t","updated_at":"t"}],"desktops":[],"windows":[],"folders":[],"active_workspace_id":null,"active_desktop_ids":{}})).unwrap();
    state.save_layout("a", &layout).unwrap();
    let _a = state
        .stream("a".into(), Some(Supported::current()))
        .unwrap();
    let _a_second = state
        .stream("a".into(), Some(Supported::current()))
        .unwrap();
    let _b = state
        .stream("b".into(), Some(Supported::current()))
        .unwrap();
    let server = McpServer::new(state);
    let app: Value =
        serde_json::from_str(&test_definition(include_str!("fixtures/editor-app.json"))).unwrap();
    let value = |result: CallToolResult| {
        let json = serde_json::to_value(result).unwrap();
        serde_json::from_str::<Value>(json["content"][0]["text"].as_str().unwrap()).unwrap()
    };
    let uploaded = value(
        server
            .upload_app(Parameters(UploadArgs {
                asset_uploads: None,
                definition: app,
                open: true,
                workspace_id: Some("w".into()),
            }))
            .await
            .unwrap(),
    );
    assert_eq!(uploaded["open_sent_to"], 1);
    let app_id = uploaded["app_id"].as_str().unwrap().to_string();
    let missing = value(
        server
            .open_app(Parameters(AppIdArgs {
                app_id: app_id.clone(),
                workspace_id: Some("없음".into()),
            }))
            .await
            .unwrap(),
    );
    assert_eq!(missing["open_sent_to"], 0);
    assert_eq!(
        missing["note"],
        "그 작업을 가진 쉘이 연결돼 있지 않아 창은 열리지 않았습니다"
    );
    let targeted = value(
        server
            .open_app(Parameters(AppIdArgs {
                app_id,
                workspace_id: Some("w".into()),
            }))
            .await
            .unwrap(),
    );
    assert_eq!(targeted["open_sent_to"], 1);
}

#[tokio::test]
async fn app_open_and_opening_upload_are_scoped_away_from_other_accounts_legacy_shells() {
    let state = AppState::in_memory("secret");
    let owner_account = state.mcp_account_id().unwrap();
    let second_account = Uuid::new_v4().to_string();
    {
        let db = state.lock_db().unwrap();
        db.execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES(?1,'Second','now')",
            [&second_account],
        )
        .unwrap();
        db.execute(
            "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('owner-old','Owner PC',?1,'owner','now'),('second-old','Second PC',?2,'second','now')",
            params![owner_account, second_account],
        )
        .unwrap();
    }
    let _owner = state
        .stream_with_registry("owner-old".into(), None, 0)
        .unwrap();
    let _second = state
        .stream_with_registry("second-old".into(), None, 0)
        .unwrap();
    let mut events = state.0.events.subscribe();
    let server = McpServer::new(state.clone());

    server
        .upload_app(Parameters(UploadArgs {
            asset_uploads: None,
            definition: serde_json::from_str(LEGACY_APP).unwrap(),
            open: true,
            workspace_id: None,
        }))
        .await
        .unwrap();
    let app = state.app("workspace-pas", None).unwrap().unwrap();
    let published = events.try_recv().unwrap();
    assert!(matches!(
        state.event_for_broadcast("owner-old", published.clone()),
        Some(DeviceEvent::AppPublished { app: row, open: true, .. }) if row.app.id == app.app.id
    ));
    assert!(matches!(
        state.event_for_broadcast("second-old", published),
        Some(DeviceEvent::AppPublished { app: row, open: false, workspace_id: None }) if row.app.id == app.app.id
    ));

    server
        .open_app(Parameters(AppIdArgs {
            app_id: app.app.id.clone(),
            workspace_id: None,
        }))
        .await
        .unwrap();
    let opened = events.try_recv().unwrap();
    assert!(matches!(
        state.event_for_broadcast("owner-old", opened.clone()),
        Some(DeviceEvent::AppOpen { app_id, workspace_id: None }) if app_id == app.app.id
    ));
    assert!(state.event_for_broadcast("second-old", opened).is_none());
}

#[tokio::test]
async fn get_shared_view_returns_latest_window_and_empty_note() {
    use kaleidoscope_contract::registry::ShareUpload;
    let state = AppState::in_memory("secret");
    {
        let db = state.lock_db().unwrap();
        db.execute_batch("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('device-a','PC A',(SELECT account_id FROM mcp_principal WHERE id=1),'a','now'),('device-b','PC B',(SELECT account_id FROM mcp_principal WHERE id=1),'b','now');").unwrap();
        db.execute(
            "INSERT INTO workspaces(id,account_id,data,created_at) VALUES('w',(SELECT account_id FROM mcp_principal WHERE id=1),'{\"id\":\"w\",\"name\":\"작업\",\"created_at\":\"t\",\"updated_at\":\"t\"}','t')",
            [],
        ).unwrap();
    }
    state
        .put_shared_view(
            "device-a",
            "PC A",
            "window-1",
            ShareUpload {
                workspace_id: "w".into(),
                app_name: "편집기".into(),
                text: "오래된 글".into(),
                visual: false,
            },
        )
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(3));
    state
        .put_shared_view(
            "device-b",
            "PC B",
            "window-1",
            ShareUpload {
                workspace_id: "w".into(),
                app_name: "편집기".into(),
                text: "새 글".into(),
                visual: true,
            },
        )
        .unwrap();
    let server = McpServer::new(state);
    let value = |result: CallToolResult| {
        let json = serde_json::to_value(result).unwrap();
        serde_json::from_str::<Value>(json["content"][0]["text"].as_str().unwrap()).unwrap()
    };
    let shared = value(
        server
            .get_shared_view(Parameters(WorkspaceArgs {
                workspace_id: Some("w".into()),
            }))
            .await
            .unwrap(),
    );
    assert_eq!(shared["views"].as_array().unwrap().len(), 1);
    assert_eq!(shared["views"][0]["text"], "새 글");
    assert_eq!(shared["views"][0]["device_name"], "PC B");
    assert_eq!(shared["views"][0]["visual"], true);
    let empty = value(
        server
            .get_shared_view(Parameters(WorkspaceArgs {
                workspace_id: Some("missing".into()),
            }))
            .await
            .unwrap(),
    );
    assert_eq!(empty["views"], json!([]));
    assert_eq!(empty["note"], "같이 보기로 켠 창이 없습니다");
}

#[tokio::test]
async fn upload_and_open_report_connected_shells_that_cannot_render_the_app() {
    use kaleidoscope_contract::Supported;

    let state = AppState::in_memory("secret");
    for id in ["AD02028236", "current"] {
        state.lock_db().unwrap().execute(
            "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,(SELECT account_id FROM mcp_principal WHERE id=1),?1,'now')",
            [id],
        ).unwrap();
    }
    state
        .lock_db()
        .unwrap()
        .execute(
            "UPDATE devices SET last_active_at='2026-01-02' WHERE id='current'",
            [],
        )
        .unwrap();
    let _old = state.stream("AD02028236".into(), None).unwrap();
    let _current = state
        .stream("current".into(), Some(Supported::current()))
        .unwrap();
    let server = McpServer::new(state);
    let browser: Value =
        serde_json::from_str(&test_definition(include_str!("fixtures/browser-app.json"))).unwrap();
    let value = |result: CallToolResult| {
        let json = serde_json::to_value(result).unwrap();
        serde_json::from_str::<Value>(json["content"][0]["text"].as_str().unwrap()).unwrap()
    };

    let uploaded = value(
        server
            .upload_app(Parameters(UploadArgs {
                asset_uploads: None,
                definition: browser,
                open: false,
                workspace_id: None,
            }))
            .await
            .unwrap(),
    );
    assert_eq!(
        uploaded["note"],
        "이 앱을 그릴 수 없는 옛 쉘이라 받지 못한 기기: AD02028236 (쉘을 새로 깔아야 합니다)"
    );

    let opened = value(
        server
            .open_app(Parameters(AppIdArgs {
                app_id: "test-web-browser".into(),
                workspace_id: None,
            }))
            .await
            .unwrap(),
    );
    assert_eq!(opened["open_sent_to"], 1);
    assert_eq!(opened["note"], uploaded["note"]);
}

#[tokio::test]
async fn compatible_upload_result_has_no_unsupported_shell_note() {
    use kaleidoscope_contract::Supported;

    let state = AppState::in_memory("secret");
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('current','current',(SELECT account_id FROM mcp_principal WHERE id=1),'current','now')",
        [],
    ).unwrap();
    let _current = state
        .stream("current".into(), Some(Supported::current()))
        .unwrap();
    let server = McpServer::new(state);
    let definition: Value =
        serde_json::from_str(&test_definition(include_str!("fixtures/browser-app.json"))).unwrap();
    let result = server
        .upload_app(Parameters(UploadArgs {
            asset_uploads: None,
            definition,
            open: false,
            workspace_id: None,
        }))
        .await
        .unwrap();
    let json = serde_json::to_value(result).unwrap();
    let value: Value = serde_json::from_str(json["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(value.get("note").is_none());
}

#[tokio::test]
async fn upload_with_only_an_old_shell_does_not_claim_no_shell_is_connected() {
    let state = AppState::in_memory("secret");
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('AD02028236','AD02028236',(SELECT account_id FROM mcp_principal WHERE id=1),'old','now')",
        [],
    ).unwrap();
    let _old = state.stream("AD02028236".into(), None).unwrap();
    let server = McpServer::new(state);
    let definition: Value =
        serde_json::from_str(&test_definition(include_str!("fixtures/browser-app.json"))).unwrap();
    let result = server
        .upload_app(Parameters(UploadArgs {
            asset_uploads: None,
            definition,
            open: true,
            workspace_id: None,
        }))
        .await
        .unwrap();
    let json = serde_json::to_value(result).unwrap();
    let value: Value = serde_json::from_str(json["content"][0]["text"].as_str().unwrap()).unwrap();

    assert_eq!(value["open_sent_to"], 0);
    assert!(value["note"]
        .as_str()
        .unwrap()
        .contains("그릴 수 없는 옛 쉘"));
    assert!(!value["note"].as_str().unwrap().contains("연결된 쉘이 없어"));
}

#[tokio::test]
async fn connection_tools_hide_header_values_and_keep_them_on_omitted_update() {
    let state = AppState::in_memory("secret");
    let server = McpServer::new(state);
    let headers = std::collections::BTreeMap::from([(
        "Authorization".to_string(),
        "Bearer private-value".to_string(),
    )]);
    let value = |result: CallToolResult| {
        let json = serde_json::to_value(result).unwrap();
        serde_json::from_str::<Value>(json["content"][0]["text"].as_str().unwrap()).unwrap()
    };
    let set = value(
        server
            .set_connection(Parameters(SetConnectionArgs {
                name: "board".into(),
                kind: ConnectionKindArg::Relay,
                base_url: "https://example.com/".into(),
                description: None,
                writable: None,
                paths: None,
                headers: Some(headers),
                issuer: None,
                scopes: None,
                resource: None,
            }))
            .await
            .unwrap(),
    );
    assert_eq!(set["name"], "board");

    let listed = value(server.list_connections().await.unwrap());
    assert_eq!(listed[0]["header_names"], json!(["Authorization"]));
    assert!(!listed.to_string().contains("private-value"));

    server
        .set_connection(Parameters(SetConnectionArgs {
            name: "board".into(),
            kind: ConnectionKindArg::Relay,
            base_url: "https://example.com".into(),
            description: None,
            writable: None,
            paths: None,
            headers: None,
            issuer: None,
            scopes: None,
            resource: None,
        }))
        .await
        .unwrap();
    let listed = value(server.list_connections().await.unwrap());
    assert_eq!(listed[0]["header_names"], json!(["Authorization"]));
    assert!(!listed.to_string().contains("private-value"));
}

#[tokio::test]
async fn upload_warns_about_connection_names_missing_from_the_server() {
    let state = AppState::in_memory("secret");
    let server = McpServer::new(state);
    let definition =
        serde_json::from_str(include_str!("../../../examples/card-board.json")).unwrap();
    let result = server
        .upload_app(Parameters(UploadArgs {
            asset_uploads: None,
            definition,
            open: false,
            workspace_id: None,
        }))
        .await
        .unwrap();
    let json = serde_json::to_value(result).unwrap();
    let value: Value = serde_json::from_str(json["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(
        value["warnings"][0],
        "서버에 없는 연결: board. set_connection으로 등록하세요"
    );
}

#[tokio::test]
async fn upload_warns_when_a_host_exceeds_the_default_screen_call_budget() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let definition = json!({
        "id": "over-budget-upload",
        "name": "예산 초과 시험",
        "requires": {"blocks": 4, "modules": {"http": 1}},
        "permissions": [{"module":"http", "id":"public", "label":"공개 API", "base_url":"https://api.example.test", "paths":["/first", "/second"]}],
        "state": {},
        "sources": {
            "first": {"kind":"request", "permission":"public", "path":"/first", "refresh_secs":10},
            "second": {"kind":"request", "permission":"public", "path":"/second", "refresh_secs":10}
        },
        "ui": {"type":"stack", "direction":"column", "children":[
            {"type":"text", "value":{"expr":"$data.first"}},
            {"type":"text", "value":{"expr":"$data.second"}}
        ]}
    });
    let result = server
        .upload_app(Parameters(UploadArgs {
            asset_uploads: None,
            definition,
            open: false,
            workspace_id: None,
        }))
        .await
        .unwrap();
    let result_json = serde_json::to_value(result).unwrap();
    let value: Value =
        serde_json::from_str(result_json["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(value["app_id"], "over-budget-upload");
    assert!(value["warnings"].as_array().unwrap().iter().any(|warning| {
        warning.as_str().unwrap()
            == "api.example.test: 기본 화면에서 분당 12.0회 호출합니다. 묶음 요청을 찾거나 refresh_secs를 늘리십시오(기준 분당 6회)."
    }));
}

#[tokio::test]
async fn connection_rejects_environment_references() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let result = server
        .set_connection(Parameters(SetConnectionArgs {
            name: "board".into(),
            kind: ConnectionKindArg::Relay,
            base_url: "https://example.test".into(),
            description: None,
            writable: None,
            paths: None,
            headers: Some(std::collections::BTreeMap::from([(
                "Authorization".into(),
                "Bearer ${env:KEY}".into(),
            )])),
            issuer: None,
            scopes: None,
            resource: None,
        }))
        .await
        .unwrap();
    assert!(result.is_error.unwrap_or_default());
    let content = serde_json::to_value(&result).unwrap();
    let error: Value =
        serde_json::from_str(content["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(error["code"], "invalid_request");
    assert!(server.state.connection("board").unwrap().is_none());
}
