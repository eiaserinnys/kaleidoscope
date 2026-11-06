use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use tower::ServiceExt;

fn device(state: &AppState, id: &str, account: &str) -> String {
    let token = format!("token-{id}");
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?1,?2,?3,'now')",
        params![id, account, sha256_hex(token.as_bytes())],
    ).unwrap();
    token
}
async fn request(
    state: &AppState,
    token: &str,
    method: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = router(state.clone()).oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 32 * 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
fn create(id: &str) -> Value {
    json!({"id":id,"anchor":{"schema_version":1,"kind":"block","pointer":"/ui","normalized_type":"text"},
        "text":"고쳐 주세요","origin":{"kind":"personal"},"created_app_version":1,
        "created_definition_digest":"digest","created_shell_version":"1","source_window_id":"window"})
}
#[tokio::test]
async fn app_comments_device_contract_and_account_isolation() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES('other','other','now')",
            [],
        )
        .unwrap();
    let token = device(&state, "first", &account);
    let other = device(&state, "other", "other");
    let root = "/api/device/app-comments/unregistered";
    let (status, first) = request(&state, &token, "POST", root, create("one")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["thread"]["number"], 1);
    assert_eq!(first["meta"]["open_count"], 1);
    assert_eq!(first["meta"]["unsent_count"], 1);
    let (_, duplicate) = request(&state, &token, "POST", root, create("one")).await;
    assert_eq!(duplicate, first);
    let mut changed = create("one");
    changed["text"] = json!("다른 글");
    assert_eq!(
        request(&state, &token, "POST", root, changed).await.1["id"],
        "COMMENT_CREATE_ID_CONFLICT"
    );
    assert_eq!(
        request(&state, &other, "GET", &format!("{root}/one"), json!(null))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &state,
            &other,
            "POST",
            &format!("{root}/one/replies"),
            json!({"id":"r","text":"답"})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    for id in ["r1", "r2"] {
        let (status, reply) = request(
            &state,
            &token,
            "POST",
            &format!("{root}/one/replies"),
            json!({"id":id,"text":id}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(reply["reply"]["author"], "user");
    }
    let (_, thread) = request(&state, &token, "GET", &format!("{root}/one"), json!(null)).await;
    assert_eq!(thread["thread"]["replies"].as_array().unwrap().len(), 2);
    let (_, sent) = request(
        &state,
        &token,
        "POST",
        &format!("{root}/sent"),
        json!({"ids":["one","missing"]}),
    )
    .await;
    assert_eq!(sent["meta"]["unsent_count"], 0);
    let (_, resolved) = request(
        &state,
        &token,
        "PUT",
        &format!("{root}/one/resolved"),
        json!({"resolved":true,"fixed_app_version":2}),
    )
    .await;
    assert_eq!(resolved["meta"]["open_count"], 0);
    assert_eq!(resolved["thread"]["resolved_app_version"], 2);
    let (_, reopened) = request(
        &state,
        &token,
        "PUT",
        &format!("{root}/one/resolved"),
        json!({"resolved":false}),
    )
    .await;
    assert_eq!(reopened["meta"]["open_count"], 1);
    assert!(reopened["thread"].get("resolved_app_version").is_none());
    let (_, list) = request(&state, &token, "GET", root, json!(null)).await;
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    assert!(list.to_string().find("image_base64").is_none());
    let (_, _) = request(
        &state,
        &token,
        "DELETE",
        &format!("{root}/one"),
        json!(null),
    )
    .await;
    let (_, second) = request(&state, &token, "POST", root, create("two")).await;
    assert_eq!(second["thread"]["number"], 2);
    assert_eq!(
        request(&state, &token, "GET", &format!("{root}/one"), json!(null))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &state,
            &token,
            "GET",
            &format!("{root}?cursor=bad"),
            json!(null)
        )
        .await
        .1["id"],
        "COMMENT_LIST_CURSOR_INVALID"
    );
}

async fn stream(state: &AppState, token: &str, version: u32) -> axum::body::BodyDataStream {
    let req = Request::builder()
        .uri("/api/device/events")
        .header("authorization", format!("Bearer {token}"))
        .header(registry::REGISTRY_HEADER, version.to_string())
        .body(Body::empty())
        .unwrap();
    router(state.clone())
        .oneshot(req)
        .await
        .unwrap()
        .into_body()
        .into_data_stream()
}
async fn event(stream: &mut axum::body::BodyDataStream) -> Value {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let bytes = stream.next().await.unwrap().unwrap();
            if let Some(line) = std::str::from_utf8(&bytes)
                .unwrap()
                .lines()
                .find_map(|line| line.strip_prefix("data: "))
            {
                return serde_json::from_str(line).unwrap();
            }
        }
    })
    .await
    .unwrap()
}
#[tokio::test]
async fn app_comments_events_and_persistence() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("state.sqlite");
    let state = AppState::open(&path, "secret".into()).unwrap();
    let account = state.mcp_account_id().unwrap();
    let token = device(&state, "first", &account);
    let legacy = device(&state, "old", &account);
    let mut new_stream = stream(&state, &token, 14).await;
    let mut old_stream = stream(&state, &legacy, 13).await;
    assert_eq!(event(&mut new_stream).await["event"], "apps.snapshot");
    assert_eq!(
        event(&mut new_stream).await["event"],
        "preferences.snapshot"
    );
    let snapshot = event(&mut new_stream).await;
    assert_eq!(snapshot["event"], "app_comments.snapshot");
    assert_eq!(snapshot["apps"], json!([]));
    assert_eq!(event(&mut new_stream).await["event"], "layout.snapshot");
    assert_eq!(event(&mut old_stream).await["event"], "apps.snapshot");
    assert_eq!(
        event(&mut old_stream).await["event"],
        "preferences.snapshot"
    );
    assert_eq!(event(&mut old_stream).await["event"], "layout.snapshot");
    assert_eq!(
        request(
            &state,
            &token,
            "POST",
            "/api/device/app-comments/app",
            create("one")
        )
        .await
        .0,
        StatusCode::OK
    );
    let changed = event(&mut new_stream).await;
    assert_eq!(changed["event"], "app_comments.changed");
    assert_eq!(changed["open_count"], 1);
    assert!(
        tokio::time::timeout(Duration::from_millis(200), event(&mut old_stream))
            .await
            .is_err()
    );
    drop(new_stream);
    drop(old_stream);
    drop(state);
    let reopened = AppState::open(&path, "secret".into()).unwrap();
    let (_, thread) = request(
        &reopened,
        &token,
        "GET",
        "/api/device/app-comments/app/one",
        json!(null),
    )
    .await;
    assert_eq!(thread["thread"]["text"], "고쳐 주세요");
    let mut new_stream = stream(&reopened, &token, 14).await;
    event(&mut new_stream).await;
    event(&mut new_stream).await;
    let snapshot = event(&mut new_stream).await;
    assert_eq!(snapshot["apps"][0]["open_count"], 1);
}

#[tokio::test]
async fn app_comments_image_validation_and_retrieval() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let token = device(&state, "first", &account);
    let png = include_bytes!("../../../ui/harness/assets/shapes.png");
    let width = u32::from_be_bytes(png[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(png[20..24].try_into().unwrap());
    let meta = json!({"width":width,"height":height,"byte_size":png.len(),"capture_surface":"window_body","target_rect":{"x":1,"y":1,"width":1,"height":1}});
    let mut body = create("image");
    body["image"] = json!({"meta":meta,"image_base64":STANDARD.encode(png)});
    let root = "/api/device/app-comments/app";
    assert_eq!(
        request(&state, &token, "POST", root, body.clone()).await.0,
        StatusCode::OK
    );
    let req = Request::builder()
        .uri(format!("{root}/image/image"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = router(state.clone()).oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(
        &to_bytes(response.into_body(), 20 * 1024 * 1024)
            .await
            .unwrap()[..],
        png
    );
    let (_, list) = request(&state, &token, "GET", root, json!(null)).await;
    assert!(!list.to_string().contains("image_base64"));
    body["id"] = json!("invalid");
    body["image"]["image_base64"] = json!(STANDARD.encode(b"bad png"));
    assert_eq!(
        request(&state, &token, "POST", root, body.clone()).await.1["id"],
        "COMMENT_CREATE_IMAGE_INVALID"
    );
    body["image"]["image_base64"] = json!(STANDARD.encode(vec![0; 20 * 1024 * 1024 + 1]));
    assert_eq!(
        request(&state, &token, "POST", root, body).await.1["id"],
        "COMMENT_CREATE_IMAGE_TOO_LARGE"
    );
    request(
        &state,
        &token,
        "DELETE",
        &format!("{root}/image"),
        json!(null),
    )
    .await;
    let req = Request::builder()
        .uri(format!("{root}/image/image"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router(state.clone()).oneshot(req).await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
}

async fn mcp_request(
    app: &Router,
    token: &str,
    session: Option<&str>,
    body: Value,
) -> axum::response::Response {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("host", "localhost");
    if let Some(session) = session {
        builder = builder
            .header("mcp-session-id", session)
            .header("mcp-protocol-version", "2025-03-26");
    }
    app.clone()
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}
async fn mcp_session(app: &Router, token: &str) -> String {
    let response = mcp_request(app,token,None,json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}})).await;
    assert_eq!(response.status(), StatusCode::OK);
    let session = response.headers()["mcp-session-id"]
        .to_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        mcp_request(
            app,
            token,
            Some(&session),
            json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        )
        .await
        .status(),
        StatusCode::ACCEPTED
    );
    session
}
async fn mcp_call(app: &Router, token: &str, session: &str, name: &str, arguments: Value) -> Value {
    let response = mcp_request(app,token,Some(session),json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":name,"arguments":arguments}})).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 32 * 1024 * 1024)
        .await
        .unwrap();
    let body = std::str::from_utf8(&bytes).unwrap();
    let data = body
        .lines()
        .find_map(|line| line.strip_prefix("data: ").filter(|data| !data.is_empty()))
        .unwrap_or(body);
    serde_json::from_str(data).unwrap()
}
#[tokio::test]
async fn app_comments_mcp_image_reply_and_read() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let token = device(&state, "first", &account);
    let png = include_bytes!("../../../ui/harness/assets/shapes.png");
    let mut body = create("one");
    body["image"] = json!({"meta":{"width":u32::from_be_bytes(png[16..20].try_into().unwrap()),"height":u32::from_be_bytes(png[20..24].try_into().unwrap()),"byte_size":png.len(),"capture_surface":"window_body","target_rect":{"x":0,"y":0,"width":1,"height":1}},"image_base64":STANDARD.encode(png)});
    assert_eq!(
        request(&state, &token, "POST", "/api/device/app-comments/app", body)
            .await
            .0,
        StatusCode::OK
    );
    let app = router(state.clone());
    let session = mcp_session(&app, &token).await;
    let response = mcp_call(
        &app,
        &token,
        &session,
        "get_app_comment",
        json!({"comment_id":"one","image":true}),
    )
    .await;
    assert_eq!(response["result"]["content"][1]["mimeType"], "image/png");
    assert_eq!(
        STANDARD
            .decode(response["result"]["content"][1]["data"].as_str().unwrap())
            .unwrap(),
        png
    );
    let response = mcp_call(
        &app,
        &token,
        &session,
        "reply_app_comment",
        json!({"comment_id":"one","reply_id":"r","text":"수정했습니다"}),
    )
    .await;
    let reply: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(reply["reply"]["author"], "agent");
    assert_eq!(reply["meta"]["unread_reply_count"], 1);
    let (_, read) = request(
        &state,
        &token,
        "POST",
        "/api/device/app-comments/app/one/read",
        json!(null),
    )
    .await;
    assert_eq!(read["meta"]["unread_reply_count"], 0);
    let response = mcp_call(&app, &token, &session, "list_app_comments", json!({})).await;
    let list: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(list["apps"][0]["app_id"], "app");
    let response = mcp_call(
        &app,
        &token,
        &session,
        "resolve_app_comment",
        json!({"comment_id":"one","resolved":true,"fixed_app_version":3}),
    )
    .await;
    let resolved: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(resolved["thread"]["resolved_app_version"], 3);
}

#[tokio::test]
async fn app_comments_pages_fit_json_budget() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    let token = device(&state, "first", &account);
    let root = "/api/device/app-comments/app";
    for i in 0..60 {
        let mut body = create(&format!("{i:03}"));
        body["text"] = json!("a".repeat(20_000));
        assert_eq!(
            request(&state, &token, "POST", root, body).await.0,
            StatusCode::OK
        );
    }
    let (_, first) = request(&state, &token, "GET", root, json!(null)).await;
    assert!(
        serde_json::to_vec(&first).unwrap().len()
            <= kaleidoscope_contract::app_storage::STORAGE_JSON_MAX_BYTES
    );
    let cursor = first["next_cursor"].as_str().unwrap();
    let (_, second) = request(
        &state,
        &token,
        "GET",
        &format!("{root}?cursor={cursor}"),
        json!(null),
    )
    .await;
    assert_eq!(
        first["items"].as_array().unwrap().len() + second["items"].as_array().unwrap().len(),
        60
    );
    assert!(second.get("next_cursor").is_none());
}

#[path = "app_comments_extra_tests.rs"]
mod extra;
