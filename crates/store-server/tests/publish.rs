use kaleidoscope_store_server::PublishDeclaration;
use reqwest::{
    multipart::{Form, Part},
    Client, StatusCode,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use tempfile::TempDir;

const SVG: &str =
    r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>"##;

fn app(name: &str) -> Vec<u8> {
    json!({"id":"example","name":name,"requires":{"blocks":26,"modules":{"assets":1}},
        "assets":[{"id":"icon","version":1}],"icon":{"asset":"icon","version":1},
        "permissions":[],"ui":{"type":"text","value":"보기"}})
    .to_string()
    .into_bytes()
}
fn store(summary: &str) -> Vec<u8> {
    json!({"summary":summary,"description":"설명","category":"도구","publisher":"author",
        "listed":true,"icon":"assets/icon.svg","assets":[{"id":"icon","version":1,
        "file":"assets/icon.svg","format":"svg","source":"제작","license":"MIT"}]})
    .to_string()
    .into_bytes()
}
fn form(app: Vec<u8>, store: Vec<u8>, extra: Option<(&str, Vec<u8>)>) -> Form {
    let part = |name: &str, data| Part::bytes(data).file_name(name.to_string());
    let mut f = Form::new()
        .part("file", part("app.json", app))
        .part("file", part("store.json", store))
        .part("file", part("assets/icon.svg", SVG.as_bytes().to_vec()));
    if let Some((name, data)) = extra {
        f = f.part("file", part(name, data));
    }
    f
}
async fn start(dir: &Path) -> (String, tokio::task::JoinHandle<()>) {
    start_with_invite(dir, None).await
}
async fn start_with_invite(
    dir: &Path,
    invite: Option<&str>,
) -> (String, tokio::task::JoinHandle<()>) {
    start_with_publish(dir, invite, PublishDeclaration::Direct).await
}
async fn start_with_publish(
    dir: &Path,
    invite: Option<&str>,
    publish: PublishDeclaration,
) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let router = kaleidoscope_store_server::router_with_publish(
        dir.to_owned(),
        invite.map(str::to_owned),
        publish,
    );
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (address, task)
}
async fn publish(client: &Client, base: &str, form: Form) -> (StatusCode, Value) {
    publish_with_header(client, base, form, None).await
}
async fn publish_with_header(
    client: &Client,
    base: &str,
    form: Form,
    invite: Option<&str>,
) -> (StatusCode, Value) {
    let mut request = client.post(format!("{base}/publish")).multipart(form);
    if let Some(invite) = invite {
        request = request.header("x-kaleidoscope-invite", invite);
    }
    let r = request.send().await.unwrap();
    let status = r.status();
    (status, r.json().await.unwrap())
}
async fn get(client: &Client, base: &str, path: &str) -> Value {
    client
        .get(format!("{base}/{path}"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap()
}
async fn get_with_invite(client: &Client, base: &str, path: &str, invite: &str) -> Value {
    client
        .get(format!("{base}/{path}"))
        .header("x-kaleidoscope-invite", invite)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap()
}

#[tokio::test]
async fn invite_header_guards_reads_and_direct_publish() {
    let dir = TempDir::new().unwrap();
    let invite = "8e307891-fd5a-4d75-be0f-a80ab5df0602";
    let (base, _task) = start_with_invite(dir.path(), Some(invite)).await;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap();
    let wrong = "00000000-0000-0000-0000-000000000000";
    for path in ["index.json", "apps/example/index.json"] {
        let missing = client.get(format!("{base}/{path}")).send().await.unwrap();
        assert_eq!(missing.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            missing.json::<Value>().await.unwrap()["id"],
            "STORESERVER_AUTH_INVITE_INVALID"
        );
        let rejected = client
            .get(format!("{base}/{path}"))
            .header("x-kaleidoscope-invite", wrong)
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            rejected.json::<Value>().await.unwrap()["id"],
            "STORESERVER_AUTH_INVITE_INVALID"
        );
    }
    for invite_header in [None, Some(wrong)] {
        let (status, error) = publish_with_header(
            &client,
            &base,
            form(app("보기"), store("요약"), None),
            invite_header,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(error["id"], "STORESERVER_AUTH_INVITE_INVALID");
    }
    let header = "  8E307891-FD5A-4D75-BE0F-A80AB5DF0602 ";
    let (status, result) = publish_with_header(
        &client,
        &base,
        form(app("보기"), store("요약"), None),
        Some(header),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(result["release"], 1);
    let index = client
        .get(format!("{base}/index.json"))
        .header("x-kaleidoscope-invite", header)
        .send()
        .await
        .unwrap();
    assert_eq!(index.status(), StatusCode::OK);
    let detail = client
        .get(format!("{base}/apps/example/index.json"))
        .header("x-kaleidoscope-invite", header)
        .send()
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);
}

#[tokio::test]
async fn publish_republish_update_and_restart() {
    let dir = TempDir::new().unwrap();
    let (base, task) = start(dir.path()).await;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap();
    assert_eq!(get(&client, &base, "index.json").await["items"], json!([]));
    let (status, first) = publish(&client, &base, form(app("보기"), store("요약"), None)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(first["release"], 1);
    let manifest_bytes = client
        .get(format!("{base}/{}", first["manifest"].as_str().unwrap()))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(
        first["digest"],
        format!("{:x}", Sha256::digest(&manifest_bytes))
    );
    let manifest: Value = serde_json::from_slice(&manifest_bytes).unwrap();
    assert_eq!(manifest["store_app_id"], "example");
    assert_eq!(manifest["icon"], "apps/example/1/assets/icon/1");
    assert_eq!(manifest["permissions"], json!([]));
    assert_eq!(manifest["screenshots"], json!([]));
    assert_eq!(
        manifest["files"]["apps/example/1/assets/icon/1"]["format"],
        "svg"
    );
    assert_eq!(
        manifest["files"]["apps/example/1/assets/icon/1"]["source"],
        "제작"
    );
    assert_eq!(
        manifest["files"]["apps/example/1/assets/icon/1"]["license"],
        "MIT"
    );
    assert_eq!(
        manifest["files"]["apps/example/1/app.json"]["bytes"],
        app("보기").len()
    );
    let index = get(&client, &base, "index.json").await;
    assert_eq!(
        index["publish"],
        json!({"method":"direct","path":"publish"})
    );
    assert_eq!(index["items"][0]["requires"], manifest["requires"]);
    let detail = get(&client, &base, "apps/example/index.json").await;
    assert_eq!(detail["releases"][0]["manifest"], first["manifest"]);
    for (path, meta) in manifest["files"].as_object().unwrap() {
        let response = client.get(format!("{base}/{path}")).send().await.unwrap();
        assert_eq!(
            response.headers()["cache-control"],
            "public, max-age=31536000, immutable"
        );
        let bytes = response.bytes().await.unwrap();
        assert_eq!(bytes.len() as u64, meta["bytes"].as_u64().unwrap());
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            meta["sha256"].as_str().unwrap()
        );
        if path.ends_with("app.json") {
            let parsed = kaleidoscope_contract::validate::parse_app_definition(
                std::str::from_utf8(&bytes).unwrap(),
            )
            .unwrap();
            assert_eq!(parsed.id, "example");
        }
    }
    let (status, same) = publish(&client, &base, form(app("보기"), store("요약"), None)).await;
    assert_eq!(
        (
            status,
            same["release"].as_u64(),
            same["unchanged"].as_bool()
        ),
        (StatusCode::OK, Some(1), Some(true))
    );
    let mut metadata: Value = serde_json::from_slice(&store("요약")).unwrap();
    metadata["release"] = json!(927);
    let (status, ignored_release) = publish(
        &client,
        &base,
        form(app("보기"), serde_json::to_vec(&metadata).unwrap(), None),
    )
    .await;
    assert_eq!(
        (
            status,
            ignored_release["release"].as_u64(),
            ignored_release["unchanged"].as_bool()
        ),
        (StatusCode::OK, Some(1), Some(true))
    );
    let (status, next) = publish(&client, &base, form(app("보기"), store("바뀜"), None)).await;
    assert_eq!(
        (status, next["release"].as_u64()),
        (StatusCode::CREATED, Some(2))
    );
    assert_eq!(
        client
            .get(format!("{base}/apps/example/1/manifest.json"))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap(),
        manifest_bytes
    );
    task.abort();
    let (base, _task) = start(dir.path()).await;
    let detail = get(&client, &base, "apps/example/index.json").await;
    assert_eq!(detail["releases"].as_array().unwrap().len(), 2);
    assert_eq!(detail["releases"][0]["release"], 2);
    assert_eq!(
        get(&client, &base, "index.json").await["items"][0]["release"],
        2
    );
    std::fs::create_dir(dir.path().join("apps/example/3")).unwrap();
    std::fs::write(dir.path().join("apps/example/3/residue"), b"preserve").unwrap();
    let (status, after_residue) =
        publish(&client, &base, form(app("보기"), store("다시 바뀜"), None)).await;
    assert_eq!(
        (status, after_residue["release"].as_u64()),
        (StatusCode::CREATED, Some(4))
    );
    assert_eq!(
        std::fs::read(dir.path().join("apps/example/3/residue")).unwrap(),
        b"preserve"
    );
}

#[tokio::test]
async fn reject_bad_input_without_changing_index() {
    let dir = TempDir::new().unwrap();
    let (base, _task) = start(dir.path()).await;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap();
    let initial = get(&client, &base, "index.json").await;
    let tests = [
        (
            form(
                app("보기"),
                store("요약"),
                Some(("extra.txt", b"no".to_vec())),
            ),
            "STORESERVER_PUBLISH_FILE_UNEXPECTED",
        ),
        (
            form(app("sk-ant-Secret"), store("요약"), None),
            "STORESERVER_PUBLISH_SECRET_DETECTED",
        ),
        (
            form(
                app("보기"),
                store("요약"),
                Some(("assets/icon.svg", b"duplicate".to_vec())),
            ),
            "STORESERVER_PUBLISH_FILE_DUPLICATE",
        ),
        (
            form(
                app("보기"),
                store("요약"),
                Some(("screenshots/1.png", vec![0; 2 * 1024 * 1024 + 1])),
            ),
            "STORESERVER_PUBLISH_SCREENSHOT_TOO_LARGE",
        ),
        (
            form(
                app("보기"),
                store("요약"),
                Some(("screenshots/1.png", b"not an image".to_vec())),
            ),
            "STORESERVER_PUBLISH_SCREENSHOT_FORMAT_INVALID",
        ),
        (
            form(vec![b' '; 1024 * 1024 + 1], store("요약"), None),
            "STORESERVER_PUBLISH_APP_TOO_LARGE",
        ),
        (
            form(app("보기"), vec![b' '; 256 * 1024 + 1], None),
            "STORESERVER_PUBLISH_METADATA_TOO_LARGE",
        ),
        (
            form(
                app("보기"),
                store("요약"),
                Some(("extra.txt", vec![b'x'; 22 * 1024 * 1024])),
            ),
            "STORESERVER_PUBLISH_BODY_TOO_LARGE",
        ),
        (
            form(
                app("보기"),
                store("요약"),
                Some(("screenshots/../secret", b"no".to_vec())),
            ),
            "STORESERVER_PUBLISH_PATH_INVALID",
        ),
    ];
    for (f, id) in tests {
        let (status, error) = publish(&client, &base, f).await;
        assert!(status.is_client_error());
        assert_eq!(error["id"], id);
    }
    assert_eq!(get(&client, &base, "index.json").await, initial);
    let oversized = Form::new()
        .part("file", Part::bytes(app("보기")).file_name("app.json"))
        .part("file", Part::bytes(store("요약")).file_name("store.json"))
        .part(
            "file",
            Part::bytes(vec![b'x'; 10 * 1024 * 1024 + 1]).file_name("assets/icon.svg"),
        );
    let (status, error) = publish(&client, &base, oversized).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(error["id"], "STORESERVER_PUBLISH_ASSETS_TOO_LARGE");
    let mismatch =
        json!({"summary":"요약","description":"설명","category":"도구","publisher":"author",
        "listed":true,"icon":null,"assets":[]})
        .to_string()
        .into_bytes();
    let (status, error) = publish(&client, &base, form(app("보기"), mismatch, None)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        error["id"],
        "STORESERVER_PUBLISH_ASSET_DECLARATION_MISMATCH"
    );
    let mut app_with_script: Value = serde_json::from_slice(&app("보기")).unwrap();
    app_with_script["assets"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"script","version":1}));
    let mut meta_with_script: Value = serde_json::from_slice(&store("요약")).unwrap();
    meta_with_script["assets"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"script","version":1,
        "file":"assets/script.js","format":"javascript","source":"제작","license":"MIT"}));
    let script_form = Form::new()
        .part(
            "file",
            Part::bytes(serde_json::to_vec(&app_with_script).unwrap()).file_name("app.json"),
        )
        .part(
            "file",
            Part::bytes(serde_json::to_vec(&meta_with_script).unwrap()).file_name("store.json"),
        )
        .part(
            "file",
            Part::bytes(SVG.as_bytes().to_vec()).file_name("assets/icon.svg"),
        )
        .part(
            "file",
            Part::bytes(b"const value = 'sk-ant-secret';".to_vec()).file_name("assets/script.js"),
        );
    let (status, error) = publish(&client, &base, script_form).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(error["id"], "STORESERVER_PUBLISH_SECRET_DETECTED");
    assert!(!error.to_string().contains("sk-ant-secret"));
    assert_eq!(get(&client, &base, "index.json").await, initial);
    assert_eq!(
        client
            .get(format!("{base}/.staging/anything"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let secret_path = client
        .get(format!("{base}/apps/sk-ant-sensitive/index.json"))
        .send()
        .await
        .unwrap();
    assert_eq!(secret_path.status(), StatusCode::BAD_REQUEST);
    assert!(!secret_path
        .text()
        .await
        .unwrap()
        .contains("sk-ant-sensitive"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_publications_have_distinct_releases() {
    let dir = TempDir::new().unwrap();
    let (base, _task) = start(dir.path()).await;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap();
    let (a, b) = tokio::join!(
        publish(&client, &base, form(app("첫째"), store("요약"), None)),
        publish(&client, &base, form(app("둘째"), store("요약"), None))
    );
    assert_eq!(a.0, StatusCode::CREATED);
    assert_eq!(b.0, StatusCode::CREATED);
    let mut versions = vec![
        a.1["release"].as_u64().unwrap(),
        b.1["release"].as_u64().unwrap(),
    ];
    versions.sort();
    assert_eq!(versions, vec![1, 2]);
}

#[tokio::test]
async fn screenshot_is_in_manifest_and_served_as_png() {
    let dir = TempDir::new().unwrap();
    let (base, _task) = start(dir.path()).await;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap();
    let png = include_bytes!("../../../app/src-tauri/icons/32x32.png").to_vec();
    let (status, result) = publish(
        &client,
        &base,
        form(
            app("보기"),
            store("요약"),
            Some(("screenshots/1.png", png.clone())),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let manifest = get(&client, &base, result["manifest"].as_str().unwrap()).await;
    let path = manifest["screenshots"][0].as_str().unwrap();
    let response = client.get(format!("{base}/{path}")).send().await.unwrap();
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(response.bytes().await.unwrap(), png);
}

#[test]
fn pull_request_declaration_requires_plain_https_url() {
    assert_eq!(
        PublishDeclaration::pull_request("https://github.com/example/apps")
            .unwrap()
            .value(),
        json!({"method":"pull_request","url":"https://github.com/example/apps"})
    );
    for url in [
        "",
        "github.com/example/apps",
        "http://github.com/example/apps",
        "https://example.com/apps?ref=main",
        "https://example.com/apps#top",
        "https://user@example.com/apps",
        "https://user:secret@example.com/apps",
    ] {
        let error = PublishDeclaration::pull_request(url).unwrap_err();
        assert_eq!(
            error.id.as_deref(),
            Some("STORESERVER_START_PUBLISH_URL_INVALID"),
            "{url}"
        );
    }
    assert_eq!(
        PublishDeclaration::Direct.value(),
        json!({"method":"direct","path":"publish"})
    );
}

#[tokio::test]
async fn pull_request_declaration_is_written_and_kept_after_publish() {
    let dir = TempDir::new().unwrap();
    let invite = "8e307891-fd5a-4d75-be0f-a80ab5df0602";
    let declaration = PublishDeclaration::pull_request("https://github.com/example/apps").unwrap();
    let expected = declaration.value();
    let (base, _task) = start_with_publish(dir.path(), Some(invite), declaration).await;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap();
    assert_eq!(
        get_with_invite(&client, &base, "index.json", invite).await["publish"],
        expected
    );
    let (status, result) = publish_with_header(
        &client,
        &base,
        form(app("보기"), store("요약"), None),
        Some(invite),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(result["release"], 1);
    let index = get_with_invite(&client, &base, "index.json", invite).await;
    assert_eq!(index["publish"], expected);
    assert_eq!(index["items"][0]["release"], 1);
}

#[test]
fn binary_refuses_invalid_publish_url() {
    let dir = TempDir::new().unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_kaleidoscope-store-server"))
        .args([
            "--bind",
            "127.0.0.1:0",
            "--data-dir",
            dir.path().to_str().unwrap(),
            "--publish-pull-request",
            "http://example.com/apps",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("STORESERVER_START_PUBLISH_URL_INVALID"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
async fn restart_with_pull_request_keeps_items_and_other_fields() {
    let dir = TempDir::new().unwrap();
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap();
    let (base, task) = start(dir.path()).await;
    let (status, _) = publish(&client, &base, form(app("보기"), store("요약"), None)).await;
    assert_eq!(status, StatusCode::CREATED);
    let before = get(&client, &base, "index.json").await;
    assert_eq!(
        before["publish"],
        json!({"method":"direct","path":"publish"})
    );
    task.abort();
    let declaration = PublishDeclaration::pull_request("https://github.com/example/apps").unwrap();
    let mut expected = before.clone();
    expected["publish"] = declaration.value();
    let (base, _task) = start_with_publish(dir.path(), None, declaration).await;
    assert_eq!(get(&client, &base, "index.json").await, expected);
}
