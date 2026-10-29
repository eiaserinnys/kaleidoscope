
use super::*;
use kaleidoscope_contract::registry::DeviceLayout;

#[tokio::test]
async fn open_counts_connected_devices_with_the_requested_workspace() {
    use kaleidoscope_contract::Supported;
    let state = AppState::in_memory("secret");
    for id in ["a", "b"] {
        state
            .lock_db()
            .unwrap()
            .execute(
                "INSERT INTO devices(id,name,token_sha256,created_at) VALUES(?1,?1,?1,'now')",
                [id],
            )
            .unwrap();
    }
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
        serde_json::from_str(include_str!("../../../examples/md-editor.json")).unwrap();
    let value = |result: CallToolResult| {
        let json = serde_json::to_value(result).unwrap();
        serde_json::from_str::<Value>(json["content"][0]["text"].as_str().unwrap()).unwrap()
    };
    let uploaded = value(
        server
            .upload_app(Parameters(UploadArgs {
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
async fn upload_and_open_report_connected_shells_that_cannot_render_the_app() {
    use kaleidoscope_contract::Supported;

    let state = AppState::in_memory("secret");
    let _old = state.stream("AD02028236".into(), None).unwrap();
    let _current = state
        .stream("current".into(), Some(Supported::current()))
        .unwrap();
    let server = McpServer::new(state);
    let browser: Value =
        serde_json::from_str(include_str!("../../../examples/web-browser.json")).unwrap();
    let value = |result: CallToolResult| {
        let json = serde_json::to_value(result).unwrap();
        serde_json::from_str::<Value>(json["content"][0]["text"].as_str().unwrap()).unwrap()
    };

    let uploaded = value(
        server
            .upload_app(Parameters(UploadArgs {
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
                app_id: "web-browser".into(),
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
    let _current = state
        .stream("current".into(), Some(Supported::current()))
        .unwrap();
    let server = McpServer::new(state);
    let definition: Value =
        serde_json::from_str(include_str!("../../../examples/web-browser.json")).unwrap();
    let result = server
        .upload_app(Parameters(UploadArgs {
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
    let _old = state.stream("AD02028236".into(), None).unwrap();
    let server = McpServer::new(state);
    let definition: Value =
        serde_json::from_str(include_str!("../../../examples/web-browser.json")).unwrap();
    let result = server
        .upload_app(Parameters(UploadArgs {
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
