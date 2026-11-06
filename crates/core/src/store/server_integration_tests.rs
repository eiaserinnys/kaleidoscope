//! 실제 스토어 서버가 내보낸 판을 코어가 설치 준비까지 읽는다.
use super::{fetch::StoreClient, media::read_media, transport::AllowedServerTransport};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::blocking::{
    multipart::{Form, Part},
    Client,
};
use serde_json::{json, Value};
use std::{net::TcpListener, thread, time::Duration};
use tempfile::TempDir;

const ICON: &[u8] =
    br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>"##;

fn fixture_app() -> Vec<u8> {
    json!({
        "id":"store-fixture", "name":"스토어 시험",
        "requires":{"blocks":26,"modules":{"assets":1,"connection":1}},
        "assets":[{"id":"icon","version":1}],
        "icon":{"asset":"icon","version":1},
        "permissions":[{"module":"connection","id":"api","connection":"example","access":"read","label":"API"}],
        "ui":{"type":"text","value":"보기"}
    }).to_string().into_bytes()
}

fn connections() -> Value {
    json!([{"name":"example","kind":"oauth","base_url":"https://example.test",
        "issuer":"https://example.test","resource":null,"scopes":"read",
        "paths":["/api"],"writable":false,"description":"시험 연결"}])
}

fn publish(client: &Client, base: &str, summary: &str, screenshot: &[u8]) -> Value {
    let metadata = json!({"summary":summary,"description":"설명","category":"도구","publisher":"author",
        "listed":true,"icon":"assets/icon.svg","assets":[{"id":"icon","version":1,"file":"assets/icon.svg",
        "format":"svg","source":"자체 제작","license":"MIT"}],"connections":connections()});
    let form = Form::new()
        .part("file", Part::bytes(fixture_app()).file_name("app.json"))
        .part(
            "file",
            Part::bytes(metadata.to_string().into_bytes()).file_name("store.json"),
        )
        .part(
            "file",
            Part::bytes(ICON.to_vec()).file_name("assets/icon.svg"),
        )
        .part(
            "file",
            Part::bytes(screenshot.to_vec()).file_name("screenshots/1.png"),
        );
    let response = client
        .post(format!("{base}/publish"))
        .multipart(form)
        .send()
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::CREATED);
    response.json().unwrap()
}

#[test]
fn direct_store_server_index_detail_and_prepare_across_releases() {
    let dir = TempDir::new().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = kaleidoscope_store_server::router(dir.path().to_owned());
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = stop_rx.await;
                })
                .await
                .unwrap();
        });
    });
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap();
    let mut image = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(1, 1)
        .write_to(&mut image, image::ImageFormat::Png)
        .unwrap();
    let png = image.into_inner();

    let first = publish(&client, &base, "첫 판", &png);
    assert_eq!(first["release"], 1);
    let store = StoreClient::with_transport(&base, AllowedServerTransport).unwrap();
    let index = store.index("catalog").unwrap();
    assert_eq!(index.items.len(), 1);
    assert_eq!(index.items[0].release, 1);
    let detail = store.app("store-fixture", "catalog").unwrap();
    assert_eq!(detail.release, 1);
    let bundle = store
        .prepare("store-fixture", 1, &detail.releases[0].manifest)
        .unwrap();
    assert_eq!(bundle.definition.id, "store-fixture");
    assert_eq!(bundle.connections, Some(connections()));
    assert_eq!(
        STANDARD.decode(&bundle.assets[0].data_base64).unwrap(),
        ICON
    );
    assert_eq!(bundle.digest, first["digest"].as_str().unwrap());
    assert_eq!(
        read_media(&store, &detail.screenshots[0].path).unwrap().0,
        png
    );

    let second = publish(&client, &base, "둘째 판", &png);
    assert_eq!(second["release"], 2);
    assert_eq!(store.index("catalog").unwrap().items[0].release, 2);
    let detail = store.app("store-fixture", "catalog").unwrap();
    assert_eq!(
        detail
            .releases
            .iter()
            .map(|r| r.release)
            .collect::<Vec<_>>(),
        vec![2, 1]
    );
    let updated = store
        .prepare("store-fixture", 2, &detail.releases[0].manifest)
        .unwrap();
    assert_eq!(updated.connections, Some(connections()));
    assert_eq!(updated.digest, second["digest"].as_str().unwrap());
    stop_tx.send(()).unwrap();
    server.join().unwrap();
}
