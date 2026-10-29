use super::*;
use axum::{routing::any, Router};
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
        "INSERT INTO connections(name,kind,base_url,writable,paths,headers,description,updated_at) VALUES('board','relay',?1,0,'[\"/items\"]','{}','','now')",
        [base_url],
    ).unwrap();
}

fn args(definition: Value) -> PreviewArgs {
    PreviewArgs {
        app_id: None,
        definition: Some(definition),
        state: None,
        window_id: None,
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
async fn preview_uses_the_reported_window_state() {
    let (url, server_task) = fake_origin(
        200,
        r#"[{"status":"running","title":"현재 항목"},{"status":"done","title":"완료 항목"}]"#,
    )
    .await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,token_sha256,created_at) VALUES('device','기기','hash','now')",
        [],
    ).unwrap();
    let layout: kaleidoscope_contract::registry::DeviceLayout = serde_json::from_value(json!({
        "workspaces": [], "desktops": [],
        "windows": [{"id":"window-1","desktop_id":"desktop","app_id":"preview-test","app_version":1,"rect":{"x":0,"y":0,"width":800,"height":600},"z":0,"state":{"filter":"running"},"created_at":"now","updated_at":"now"}],
        "folders": [], "active_workspace_id": null, "active_desktop_ids": {}
    })).unwrap();
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
