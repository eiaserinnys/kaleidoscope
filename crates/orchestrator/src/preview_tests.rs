use super::*;
use axum::{routing::any, Router};
use kaleidoscope_contract::{
    data::HttpMethod,
    registry::{ConnectionAccept, ConnectionRequest},
    FileAccess,
};
use serde_json::{json, Value};
use tokio::task::JoinHandle;

fn definition() -> Value {
    json!({
        "id": "preview-test",
        "name": "미리보기 시험",
        "requires": {"blocks": 4, "modules": {"connection": 1, "files": 1}},
        "permissions": [
            {"module": "connection", "id": "relay", "connection": "board", "access": "read", "label": "게시판"},
            {"module": "files", "id": "files", "access": "read", "label": "문서 폴더"}
        ],
        "state": {"filter": "done"},
        "sources": {
            "cards": {"kind": "request", "permission": "relay", "path": "/items"},
            "files": {"kind": "folder", "permission": "files"}
        },
        "ui": {
            "type": "stack", "direction": "column", "children": [
                {"type": "text", "value": {"expr": "$data.cards[status = $state.filter]"}},
                {"type": "text", "value": {"expr": "$data.files"}}
            ]
        }
    })
}

fn result_value(result: CallToolResult) -> Value {
    let result = serde_json::to_value(result).unwrap();
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}

async fn fake_origin(status: u16, body: &'static str) -> (String, JoinHandle<()>) {
    let app = Router::new().fallback(any(move || async move {
        (axum::http::StatusCode::from_u16(status).unwrap(), body)
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), server)
}

fn add_relay(state: &AppState, base_url: &str) {
    state.lock_db().unwrap().execute(
        "INSERT INTO connections(account_id,name,kind,base_url,writable,paths,headers,description,updated_at) VALUES((SELECT account_id FROM mcp_principal WHERE id=1),'board','relay',?1,0,'[\"/items\"]','{}','','now')",
        [base_url],
    ).unwrap();
}

fn args(definition: Value) -> PreviewArgs {
    PreviewArgs {
        app_id: None,
        definition: Some(definition),
        state: None,
        window_id: None,
        workspace_id: None,
        data: None,
        max_chars: None,
    }
}

#[tokio::test]
async fn previews_definition_with_relay_data_using_definition_permissions() {
    let (url, server_task) = fake_origin(
        200,
        r#"[{"status":"running","title":"현재 항목"},{"status":"done","title":"완료 항목"}]"#,
    )
    .await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    let server = McpServer::new(state);

    let value = result_value(server.preview_app_result(args(definition())).await.unwrap());

    assert_eq!(value["sources"]["cards"]["state"], "ready");
    assert!(value["sources"]["cards"]["bytes"].as_u64().unwrap() > 0);
    assert_eq!(value["values"][0]["pointer"], "/ui/children/0/value");
    assert_eq!(value["values"][0]["status"], "ready");
    assert!(value["values"][0]["value"]
        .as_str()
        .unwrap()
        .contains("완료 항목"));
    server_task.abort();
}

#[tokio::test]
async fn preview_fetches_relay_sources_in_dependency_order() {
    let (url, server_task) = fake_origin(200, r#"[{"status":"done","title":"항목"}]"#).await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    let server = McpServer::new(state);
    let mut input = definition();
    input["sources"]["aaa"] = json!({"kind":"request","permission":"relay","path":{"expr":"'/items/' & $data.cards[0].status"}});
    input["ui"]["children"][0]["value"] = json!({"expr":"$data.aaa[0].title"});
    let result = result_value(server.preview_app_result(args(input)).await.unwrap());
    assert_eq!(result["sources"]["cards"]["state"], "ready");
    assert_eq!(result["sources"]["aaa"]["state"], "ready");
    assert_eq!(result["values"][0]["value"], "\"항목\"");
    server_task.abort();
}

#[tokio::test]
async fn preview_accepts_device_source_samples_and_marks_unsampled_sources_idle() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let mut sample_args = args(definition());
    sample_args.data = Some([("files".into(), json!([{"name":"notes.md"}]))].into());

    let sample = result_value(server.preview_app_result(sample_args).await.unwrap());
    assert_eq!(sample["sources"]["files"]["state"], "ready");
    assert_eq!(sample["values"][1]["status"], "ready");
    assert!(sample["values"][1]["value"]
        .as_str()
        .unwrap()
        .contains("notes.md"));

    let idle = result_value(server.preview_app_result(args(definition())).await.unwrap());
    assert_eq!(idle["sources"]["files"]["state"], "idle");
    assert!(idle["notes"].as_array().unwrap().iter().any(|note| {
        note.as_str()
            .unwrap()
            .contains("기기에서만 받는 원천: files")
    }));
}

#[tokio::test]
async fn preview_returns_evaluated_storage_choice_binding_values() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let mut definition = definition();
    definition["requires"] = json!({
        "blocks":6,
        "modules":{"connection":1,"files":1,"storage":2}
    });
    definition["storage"] = json!({"entries":[{
        "id":"model",
        "key":"settings/model",
        "kind":"json",
        "schema":{"type":"string"},
        "default":"argon",
        "label":"Model",
        "presentation":"settings",
        "choices":{"expr":"$data.cards"}
    }]});
    let mut preview_args = args(definition);
    preview_args.data = Some([("cards".into(), json!(["model-argon", "model-sol"]))].into());

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert!(value["values"].as_array().unwrap().iter().any(|item| {
        item["pointer"] == "/storage/entries/0/choices"
            && item["status"] == "ready"
            && item["value"] == r#"["model-argon","model-sol"]"#
    }));
}

#[tokio::test]
async fn preview_notes_missing_connection_even_when_request_source_uses_sample_data() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let mut preview_args = args(definition());
    preview_args.data = Some([("cards".into(), json!([{"status":"done"}]))].into());

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert!(value["notes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|note| { note.as_str().unwrap().contains("서버에 없는 연결: board") }));
}

#[tokio::test]
async fn preview_notes_missing_connection_used_only_by_action() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let mut definition = definition();
    definition["permissions"][0]["access"] = json!("readwrite");
    definition["sources"] = json!({});
    definition["ui"] = json!({
        "type": "button",
        "label": "호출",
        "on_click": [{"call": {"permission": "relay", "method": "POST", "path": "/items"}}]
    });

    let value = result_value(server.preview_app_result(args(definition)).await.unwrap());

    assert!(value["notes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|note| { note.as_str().unwrap().contains("서버에 없는 연결: board") }));
}

#[tokio::test]
async fn preview_uses_the_reported_window_state() {
    let (url, server_task) = fake_origin(
        200,
        r#"[{"status":"running","title":"현재 항목"},{"status":"done","title":"완료 항목"}]"#,
    )
    .await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('device','기기',(SELECT account_id FROM mcp_principal WHERE id=1),'hash','now')",
        [],
    ).unwrap();
    let layout: kaleidoscope_contract::registry::DeviceLayout = serde_json::from_value(json!({
        "workspaces": [{"id":"workspace","name":"작업","created_at":"now","updated_at":"now"}],
        "desktops": [{"id":"desktop","workspace_id":"workspace","name":"Desktop","position":0,"created_at":"now","updated_at":"now"}],
        "windows": [{"id":"window-1","desktop_id":"desktop","app_id":"preview-test","app_version":1,"rect":{"x":0,"y":0,"width":800,"height":600},"z":0,"state":{"filter":"running"},"created_at":"now","updated_at":"now"}],
        "folders": [], "active_workspace_id": null, "active_desktop_ids": {}
    })).unwrap();
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: layout.workspaces.clone(),
                desktops: layout.desktops.clone(),
                windows: layout.windows.clone(),
                ..Default::default()
            },
        )
        .unwrap();
    state.save_layout("device", &layout).unwrap();
    let server = McpServer::new(state);
    let mut preview_args = args(definition());
    preview_args.window_id = Some("window-1".into());

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert!(value["values"][0]["value"]
        .as_str()
        .unwrap()
        .contains("현재 항목"));
    assert!(!value["values"][0]["value"]
        .as_str()
        .unwrap()
        .contains("완료 항목"));
    server_task.abort();
}

#[tokio::test]
async fn preview_clips_each_binding_value_to_max_chars() {
    let (url, server_task) = fake_origin(200, r#"[{"title":"a long value"}]"#).await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    let server = McpServer::new(state);
    let mut definition = definition();
    definition["ui"]["children"][0]["value"]["expr"] = json!("$data.cards");
    let mut preview_args = args(definition);
    preview_args.max_chars = Some(5);

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert_eq!(
        value["values"][0]["value"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        5
    );
    assert_eq!(value["values"][0]["truncated"], true);
    server_task.abort();
}

#[tokio::test]
async fn preview_reports_failed_source_and_binding_retry_for_non_2xx() {
    let (url, server_task) = fake_origin(500, r#"{"error":"temporarily unavailable"}"#).await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    let server = McpServer::new(state);

    let value = result_value(server.preview_app_result(args(definition())).await.unwrap());

    assert_eq!(value["sources"]["cards"]["state"], "failed");
    assert!(value["sources"]["cards"]["message"]
        .as_str()
        .unwrap()
        .contains("500"));
    assert_eq!(value["values"][0]["status"], "failed");
    assert_eq!(value["values"][0]["retry"], json!(["cards"]));
    server_task.abort();
}

#[tokio::test]
async fn preview_uses_the_current_registry_definition_by_app_id() {
    let state = AppState::in_memory("secret");
    let definition = definition();
    state
        .publish_app(&definition.to_string(), "agent", false, None)
        .unwrap();
    let server = McpServer::new(state);
    let preview_args = PreviewArgs {
        app_id: Some("preview-test".into()),
        definition: None,
        state: None,
        window_id: None,
        workspace_id: None,
        data: Some(
            [(
                "cards".into(),
                json!([{"status":"done","title":"저장된 앱"}]),
            )]
            .into(),
        ),
        max_chars: None,
    };

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert_eq!(value["sources"]["cards"]["state"], "ready");
    assert!(value["values"][0]["value"]
        .as_str()
        .unwrap()
        .contains("저장된 앱"));
}

#[tokio::test]
async fn preview_does_not_fetch_oauth_sources_on_the_server() {
    let state = AppState::in_memory("secret");
    add_relay(&state, "https://example.invalid");
    state
        .lock_db()
        .unwrap()
        .execute("UPDATE connections SET kind='oauth' WHERE name='board'", [])
        .unwrap();
    let server = McpServer::new(state);

    let value = result_value(server.preview_app_result(args(definition())).await.unwrap());

    assert_eq!(value["sources"]["cards"]["state"], "idle");
    assert!(value["notes"].as_array().unwrap().iter().any(|note| {
        note.as_str()
            .unwrap()
            .contains("기기에서만 받는 원천: cards")
    }));
}

#[tokio::test]
async fn preview_reads_saved_storage_values_and_bucket_id() {
    let state = AppState::in_memory("secret");
    let mut definition = definition();
    definition["requires"]["blocks"] = json!(6);
    definition["requires"]["modules"]["storage"] = json!(1);
    definition["storage"] = json!({"entries":[{"id":"title","key":"settings/title","kind":"json","schema":{"type":"string"},"default":"default","label":"제목","presentation":"hidden"}]});
    definition["sources"] = json!({});
    definition["ui"] = json!({"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$storage.title"}},{"type":"text","value":{"expr":"$storage_meta.bucket_id"}}]});
    state
        .publish_app(&definition.to_string(), "agent", false, None)
        .unwrap();
    let account = state.mcp_account_id().unwrap();
    state
        .write_app_storage(
            &account,
            "preview-test",
            "title",
            None,
            json!("저장됨"),
            None,
        )
        .unwrap();
    let bucket = state
        .list_app_storage(&account, "preview-test", None)
        .unwrap()
        .bucket_id;
    let server = McpServer::new(state);
    let mut input = args(definition);
    input.definition = None;
    input.app_id = Some("preview-test".into());
    let value = result_value(server.preview_app_result(input).await.unwrap());
    assert_eq!(value["values"][0]["value"], "\"저장됨\"");
    assert_eq!(value["values"][1]["value"], format!("\"{bucket}\""));
}

#[tokio::test]
async fn preview_uses_window_or_explicit_workspace_storage() {
    let state = AppState::in_memory("secret");
    let mut definition = definition();
    definition["requires"]["blocks"] = json!(6);
    definition["requires"]["modules"]["storage"] = json!(1);
    definition["storage"] = json!({"entries":[{"id":"selection","key":"workspaces/{workspace_id}/selection","kind":"json","schema":{"type":"string"},"default":"기본","label":"선택","presentation":"hidden"}]});
    definition["sources"] = json!({});
    definition["ui"] = json!({"type":"text","value":{"expr":"$storage.selection"}});
    state
        .publish_app(&definition.to_string(), "agent", false, None)
        .unwrap();
    let layout: kaleidoscope_contract::registry::LayoutChanges = serde_json::from_value(json!({
        "workspaces":[{"id":"w1","name":"작업","created_at":"now","updated_at":"now"}],
        "desktops":[{"id":"d1","workspace_id":"w1","name":"Desktop","position":0,"created_at":"now","updated_at":"now"}],
        "windows":[{"id":"win1","desktop_id":"d1","app_id":"preview-test","app_version":1,"rect":{"x":0,"y":0,"width":800,"height":600},"z":0,"state":{},"created_at":"now","updated_at":"now"}]
    })).unwrap();
    state.apply_layout_changes(None, &layout).unwrap();
    let account = state.mcp_account_id().unwrap();
    state
        .write_app_storage(
            &account,
            "preview-test",
            "selection",
            Some("w1"),
            json!("저장값"),
            None,
        )
        .unwrap();
    let server = McpServer::new(state);
    let mut input = args(definition.clone());
    input.workspace_id = Some("w1".into());
    let value = result_value(server.preview_app_result(input).await.unwrap());
    assert_eq!(value["values"][0]["value"], "\"저장값\"");
    let mut input = args(definition);
    input.window_id = Some("win1".into());
    let value = result_value(server.preview_app_result(input).await.unwrap());
    assert_eq!(value["values"][0]["value"], "\"저장값\"");
}

#[tokio::test]
async fn stored_environment_reference_is_not_sent_to_the_origin() {
    let state = AppState::in_memory("secret");
    add_relay(&state, "http://127.0.0.1:1");
    state
        .lock_db()
        .unwrap()
        .execute(
            "UPDATE connections SET headers=?1 WHERE name='board'",
            [r#"{"Authorization":"Bearer ${env:KEY}"}"#],
        )
        .unwrap();
    let request = ConnectionRequest {
        app_id: "test".into(),
        method: HttpMethod::Get,
        path: "/items".into(),
        query: Default::default(),
        body: None,
        accept: ConnectionAccept::Json,
    };
    let error = state
        .relay_preview_request("board", request, FileAccess::Read)
        .await
        .unwrap_err();
    assert_eq!(error.0, StatusCode::BAD_GATEWAY);
    assert!(error.1.message.contains("환경변수 참조"));
}
