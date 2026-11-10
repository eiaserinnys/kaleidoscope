use super::StoreUrl;

#[test]
fn store_address_and_relative_paths_are_checked() {
    let url = StoreUrl::parse("https://EXAMPLE.com:443/appstore/").unwrap();
    assert_eq!(url.as_str(), "https://example.com/appstore");
    assert_eq!(
        StoreUrl::parse("https://example.com/한글/")
            .unwrap()
            .as_str(),
        url::Url::parse("https://example.com/한글/")
            .unwrap()
            .as_str()
            .trim_end_matches('/')
    );
    assert!(url.path("apps/example/1/app.json").is_ok());
    for bad in [
        "../secret",
        "/outside",
        "apps/%2e%2e/secret",
        "//other/file",
    ] {
        assert_eq!(
            url.path(bad).unwrap_err().id.as_deref(),
            Some("STORECLIENT_PATH_OUTSIDE_STORE")
        );
    }
    assert_eq!(StoreUrl::parse("http://EXAMPLE.com:80/appstore/").unwrap().as_str(), "http://example.com/appstore");
    assert_eq!(StoreUrl::parse("https://127.0.0.1:8443/").unwrap().as_str(), "https://127.0.0.1:8443");
    for bad in ["ftp://example.com", "https://user@example.com", "https://example.com/a/../b", "https://example.com/a%2fb", "https://example.com/?key=x", "https://example.com/#part", "https://example.com/has space"] {
        assert_eq!(StoreUrl::parse(bad).unwrap_err().id.as_deref(), Some("STORECLIENT_URL_COMPONENT_INVALID"));
    }
    assert_eq!(
        StoreUrl::parse("https://example.com\\appstore")
            .unwrap_err()
            .id
            .as_deref(),
        Some("STORECLIENT_URL_COMPONENT_INVALID")
    );
    let error = url
        .path("apps/example/file?token=secret#fragment")
        .unwrap_err();
    assert!(!error.message.contains("secret"));
    assert!(!error.message.contains("token"));
    assert!(!error.message.contains("fragment"));
    let error = url
        .path("https://user:secret@other.example/file")
        .unwrap_err();
    assert!(!error.message.contains("secret"));
}

#[test]
fn store_transport_permission_is_scoped_to_normalized_address() {
    for input in ["http://example.com", "https://example.com:8443", "https://localhost", "https://shop.localhost", "https://192.168.1.2", "https://[::1]"] {
        let url = StoreUrl::parse(input).unwrap();
        assert_eq!(super::authorize(&url, &[]).unwrap_err().id.as_deref(), Some("STORECLIENT_SERVER_PERMISSION_REQUIRED"));
        assert!(super::authorize(&url, &[url.as_str().to_owned()]).unwrap());
    }
    let public = StoreUrl::parse("https://EXAMPLE.com:443/shop/").unwrap();
    assert!(!super::authorize(&public, &[]).unwrap());
    assert!(super::authorize(&public, &["https://example.com/shop".into()]).unwrap());
    assert!(!super::authorize(&public, &["https://example.com/other".into()]).unwrap());
}

use super::{
    fetch::{StoreClient, Transport},
    media::{media_key, read_media},
};
use kaleidoscope_contract::data::ResourceMediaRef;
use kaleidoscope_data::public_http::{self, PublicHttpError, PublicResponse};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
    sync::{Arc, Mutex},
};

#[test]
fn transport_failure_reports_connection_advice_and_keeps_target_in_details() {
    struct Offline;
    impl Transport for Offline {
        fn get(&self, _: &str, _: &[String], _: &str, _: u64) -> Result<PublicResponse, PublicHttpError> {
            Err(PublicHttpError::Transport("연결 시간 초과".into()))
        }
    }
    let client = StoreClient::new(StoreUrl::parse("https://example.com/appstore").unwrap(), Offline);
    let failure = client.index("catalog").unwrap_err();
    assert_eq!(failure.error.message, "스토어에 연결하지 못했습니다. 네트워크 연결과 스토어 주소를 확인하세요.");
    assert!(failure.error.details.iter().any(|detail| detail.contains("index.json")));
}

pub(crate) type Reply = (u16, &'static str, Vec<u8>);
#[derive(Clone)]
pub(crate) struct Loopback {
    pub(crate) files: Arc<Mutex<BTreeMap<String, Reply>>>,
    address: IpAddr,
}
impl Transport for Loopback {
    fn get(
        &self,
        origin: &str,
        paths: &[String],
        path: &str,
        limit: u64,
    ) -> Result<PublicResponse, PublicHttpError> {
        public_http::get_with(
            origin,
            paths,
            path,
            &BTreeMap::new(),
            limit,
            |_| Ok(vec![SocketAddr::new(self.address, 443)]),
            |_, _, _, _, limit| {
                let (status, mime, bytes) =
                    self.files.lock().unwrap().get(path).cloned().unwrap_or((
                        404,
                        "text/plain",
                        Vec::new(),
                    ));
                let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                let address = listener.local_addr().unwrap();
                let server = std::thread::spawn(move || {
                    let (mut stream, _) = listener.accept().unwrap();
                    let mut request = [0; 4096];
                    stream.read(&mut request).unwrap();
                    write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nRetry-After: 7\r\nConnection: close\r\n\r\n", bytes.len()).unwrap();
                    stream.write_all(&bytes).unwrap();
                });
                let mut response = reqwest::blocking::Client::builder()
                    .no_proxy()
                    .build()
                    .unwrap()
                    .get(format!("http://{address}/"))
                    .send()
                    .map_err(|e| PublicHttpError::Transport(e.to_string()))?;
                let mut bytes = Vec::new();
                response
                    .by_ref()
                    .take(limit + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| PublicHttpError::Transport(e.to_string()))?;
                server.join().unwrap();
                if bytes.len() as u64 > limit {
                    return Err(PublicHttpError::TooLarge);
                }
                Ok(PublicResponse {
                    status,
                    headers: BTreeMap::new(),
                    mime: mime.into(),
                    bytes,
                    retry_after: Some("7".into()),
                    rate_limit: if status == 429 {
                        Some(kaleidoscope_contract::registry::RateLimitHint {
                            retry_after_secs: Some(7),
                        })
                    } else {
                        None
                    },
                })
            },
        )
    }
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn entry(bytes: &[u8]) -> Value {
    json!({"sha256":sha(bytes),"bytes":bytes.len()})
}
pub(crate) fn fixture() -> (Loopback, Vec<u8>, Vec<u8>) {
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>"#.to_vec();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(1, 1)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let png = png.into_inner();
    let prefix = "apps/example/3/";
    let app = json!({
        "id":"example","name":"보기","requires":{"blocks":26,"modules":{"assets":1,"worker":1}},
        "assets":[{"id":"icon","version":1}],"icon":{"asset":"icon","version":1},
        "permissions":[],"worker":{"runtime":"python3","code":"print('{}')"},
        "state":{"draft":""},
        "ui":{"type":"text","value":"보기"}
    })
    .to_string()
    .into_bytes();
    let mut icon_entry = entry(&svg);
    icon_entry["format"] = json!("svg");
    icon_entry["source"] = json!("자체 제작");
    icon_entry["license"] = json!("MIT");
    let mut files = serde_json::Map::new();
    files.insert(format!("{prefix}app.json"), entry(&app));
    files.insert(format!("{prefix}assets/icon/1"), icon_entry);
    files.insert(format!("{prefix}screenshots/1.png"), entry(&png));
    let manifest = json!({
        "format":1,"store_app_id":"example","release":3,"name":"보기","summary":"요약","description":"설명",
        "category":"도구","publisher":"author","icon":format!("{prefix}assets/icon/1"),
        "screenshots":[format!("{prefix}screenshots/1.png")],
        "requires":{"blocks":26,"modules":{"assets":1,"worker":1}},"permissions":[],"badges":["worker"],
        "files":files,"published_at":"2026-11-05T00:00:00Z"
    });
    let index = json!({"format":1,"generated_at":"now","items":[{
        "id":"example","name":"보기","summary":"요약","category":"도구","publisher":"author",
        "release":3,"icon":format!("{prefix}assets/icon/1"),"badges":["worker"],
        "requires":{"blocks":26,"modules":{"assets":1,"worker":1}},"updated_at":"now"
    }]});
    let detail = json!({"format":1,"id":"example","name":"보기","summary":"요약","description":"설명",
        "category":"도구","publisher":"author","release":3,"icon":format!("{prefix}assets/icon/1"),
        "screenshots":[format!("{prefix}screenshots/1.png")],
        "releases":[{"release":3,"published_at":"now","manifest":format!("{prefix}manifest.json")}]});
    let mut responses = BTreeMap::new();
    for (path, mime, bytes) in [
        (
            "index.json",
            "application/json",
            index.to_string().into_bytes(),
        ),
        (
            "apps/example/index.json",
            "application/json",
            detail.to_string().into_bytes(),
        ),
        (
            "apps/example/3/manifest.json",
            "application/json",
            manifest.to_string().into_bytes(),
        ),
        ("apps/example/3/app.json", "application/json", app),
        ("apps/example/3/assets/icon/1", "image/svg+xml", svg.clone()),
        ("apps/example/3/screenshots/1.png", "image/png", png.clone()),
    ] {
        responses.insert(format!("/appstore/{path}"), (200, mime, bytes));
    }
    (
        Loopback {
            files: Arc::new(Mutex::new(responses)),
            address: IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
        },
        svg,
        png,
    )
}
fn client(mock: Loopback) -> StoreClient<Loopback> {
    StoreClient::with_transport("https://EXAMPLE.com:443/appstore/", mock).unwrap()
}
fn id(error: super::fetch::StoreFailure) -> String {
    error.error.id.unwrap()
}

#[test]
fn reads_index_detail_bundle_and_visible_media() {
    let (mock, svg, png) = fixture();
    let client = client(mock);
    let index = client.index("catalog").unwrap();
    assert_eq!(index.server, "https://example.com/appstore");
    assert!(index.items[0].compatible);
    let detail = client.app("example", "catalog").unwrap();
    assert!(detail.compatible);
    assert_eq!(detail.badges, vec!["worker"]);
    let bundle = client
        .prepare("example", 3, &detail.releases[0].manifest)
        .unwrap();
    assert_eq!(bundle.definition.id, "example");
    assert!(bundle.definition.worker.is_some());
    assert_eq!(bundle.assets.len(), 1);
    assert_eq!(bundle.digest, sha(&bundle.manifest));
    assert!(bundle.definition_json.contains("example"));
    let icon = index.items[0].icon.as_ref().unwrap();
    let screenshot = &detail.screenshots[0];
    assert_eq!(read_media(&client, &icon.path).unwrap().0, svg);
    assert_eq!(read_media(&client, &screenshot.path).unwrap().0, png);
    let other = ResourceMediaRef {
        query: BTreeMap::from([("server".into(), "https://other.example/appstore".into())]),
        ..icon.clone()
    };
    assert_ne!(media_key(icon).unwrap().1, media_key(&other).unwrap().1);
}

#[test]
fn listing_and_detail_return_media_references_without_downloading_images() {
    struct Observed { inner: Loopback, paths: Arc<Mutex<Vec<String>>> }
    impl Transport for Observed {
        fn get(&self, origin: &str, allowed: &[String], path: &str, limit: u64) -> Result<PublicResponse, PublicHttpError> {
            self.paths.lock().unwrap().push(path.into());
            self.inner.get(origin, allowed, path, limit)
        }
    }
    let (mock, _, _) = fixture();
    let paths = Arc::new(Mutex::new(Vec::new()));
    let client = StoreClient::with_transport("https://example.com/appstore", Observed { inner: mock, paths: paths.clone() }).unwrap();
    assert!(client.index("catalog").unwrap().items[0].icon.is_some());
    assert!(!client.app("example", "catalog").unwrap().screenshots.is_empty());
    assert_eq!(*paths.lock().unwrap(), vec!["/appstore/index.json", "/appstore/apps/example/index.json", "/appstore/apps/example/3/manifest.json"]);
}

#[test]
fn rejects_distinct_fetch_and_bundle_failures() {
    let (mock, _, _) = fixture();
    let client = client(mock.clone());
    let path = "/appstore/apps/example/3/assets/icon/1";
    mock.files.lock().unwrap().get_mut(path).unwrap().2[0] ^= 1;
    assert_eq!(
        id(client
            .prepare("example", 3, "apps/example/3/manifest.json")
            .err()
            .unwrap()),
        "STORECLIENT_BUNDLE_HASH_MISMATCH"
    );
    for (status, expected) in [
        (404, "STORECLIENT_FETCH_NOT_FOUND"),
        (302, "STORECLIENT_FETCH_REDIRECT_REJECTED"),
        (429, "STORECLIENT_FETCH_HTTP_REJECTED"),
    ] {
        mock.files.lock().unwrap().insert(
            "/appstore/index.json".into(),
            (status, "text/plain", Vec::new()),
        );
        let error = client.index("catalog").err().unwrap();
        assert_eq!(error.error.id.as_deref(), Some(expected));
        if status == 429 {
            assert_eq!(error.status, Some(429));
            assert_eq!(error.rate_limit.unwrap().retry_after_secs, Some(7));
            assert!(error
                .error
                .details
                .iter()
                .any(|d| d.contains("Retry-After") && d.contains('7')));
        }
    }
    let private = Loopback {
        address: IpAddr::V4(Ipv4Addr::LOCALHOST),
        ..mock
    };
    assert_eq!(
        id(super::tests::client(private)
            .index("catalog")
            .err()
            .unwrap()),
        "STORECLIENT_SERVER_PERMISSION_REQUIRED"
    );
}

#[test]
fn rejects_unsafe_manifest_and_images() {
    let (mock, _, _) = fixture();
    let client = client(mock.clone());
    assert_eq!(
        id(client
            .prepare("example", 3, "../manifest.json")
            .err()
            .unwrap()),
        "STORECLIENT_PATH_OUTSIDE_STORE"
    );
    mock.files.lock().unwrap().insert(
        "/appstore/apps/example/3/assets/icon/1".into(),
        (
            200,
            "image/svg+xml",
            br#"<svg><script>bad()</script></svg>"#.to_vec(),
        ),
    );
    assert_eq!(
        id(read_media(&client, "apps/example/3/assets/icon/1")
            .err()
            .unwrap()),
        "STORECLIENT_MEDIA_FORMAT_INVALID"
    );
}

#[test]
fn checks_format_declarations_and_declared_size() {
    let (mock, _, _) = fixture();
    let client = client(mock.clone());
    let manifest_path = "/appstore/apps/example/3/manifest.json";
    let original = mock
        .files
        .lock()
        .unwrap()
        .get(manifest_path)
        .unwrap()
        .2
        .clone();
    let mut manifest: Value = serde_json::from_slice(&original).unwrap();
    manifest["format"] = json!(2);
    mock.files.lock().unwrap().get_mut(manifest_path).unwrap().2 =
        manifest.to_string().into_bytes();
    assert_eq!(
        id(client.app("example", "catalog").err().unwrap()),
        "STORECLIENT_FORMAT_UNSUPPORTED"
    );

    manifest["format"] = json!(1);
    manifest["files"]["apps/example/3/app.json"]["bytes"] = json!(1);
    mock.files.lock().unwrap().get_mut(manifest_path).unwrap().2 =
        manifest.to_string().into_bytes();
    assert_eq!(
        id(client
            .prepare("example", 3, "apps/example/3/manifest.json")
            .err()
            .unwrap()),
        "STORECLIENT_BUNDLE_SIZE_MISMATCH"
    );

    manifest["files"]["apps/example/3/app.json"]["bytes"] =
        serde_json::from_slice::<Value>(&original).unwrap()["files"]["apps/example/3/app.json"]
            ["bytes"]
            .clone();
    manifest["requires"]["blocks"] = json!(99999);
    mock.files.lock().unwrap().get_mut(manifest_path).unwrap().2 =
        manifest.to_string().into_bytes();
    assert!(!client.app("example", "catalog").unwrap().compatible);
    assert_eq!(
        id(client
            .prepare("example", 3, "apps/example/3/manifest.json")
            .err()
            .unwrap()),
        "STORECLIENT_BUNDLE_DECLARATION_MISMATCH"
    );
}

#[test]
fn bundle_matches_install_endpoint_raw_declarations() {
    let (mock, _, _) = fixture();
    let manifest_path = "/appstore/apps/example/3/manifest.json";
    let app_path = "/appstore/apps/example/3/app.json";
    let mut files = mock.files.lock().unwrap();
    let mut app: Value = serde_json::from_slice(&files[app_path].2).unwrap();
    let mut manifest: Value = serde_json::from_slice(&files[manifest_path].2).unwrap();
    app["requires"]["modules"]["files"] = json!(1);
    app["permissions"] = json!([{"module":"files","id":"docs","access":"read","label":"폴더"}]);
    manifest["requires"] = app["requires"].clone();
    manifest["permissions"] =
        json!([{"module":"files","id":"docs","access":"read","label":"폴더","scope":"folder"}]);
    let app_bytes = app.to_string().into_bytes();
    manifest["files"]["apps/example/3/app.json"] = entry(&app_bytes);
    files.get_mut(app_path).unwrap().2 = app_bytes;
    files.get_mut(manifest_path).unwrap().2 = manifest.to_string().into_bytes();
    drop(files);
    let client = client(mock.clone());
    assert_eq!(
        id(client
            .prepare("example", 3, "apps/example/3/manifest.json")
            .err()
            .unwrap()),
        "STORECLIENT_BUNDLE_DECLARATION_MISMATCH"
    );
    manifest["name"] = Value::Null;
    mock.files.lock().unwrap().get_mut(manifest_path).unwrap().2 =
        manifest.to_string().into_bytes();
    assert_eq!(
        id(client.app("example", "catalog").err().unwrap()),
        "STORECLIENT_JSON_INVALID"
    );
}

#[test]
fn verifies_every_manifest_file_including_unlisted_screenshots() {
    let (mock, _, png) = fixture();
    let path = "/appstore/apps/example/3/manifest.json";
    let extra = "apps/example/3/screenshots/extra.png";
    let mut files = mock.files.lock().unwrap();
    let mut manifest: Value = serde_json::from_slice(&files[path].2).unwrap();
    manifest["files"][extra] = entry(&png);
    files.get_mut(path).unwrap().2 = manifest.to_string().into_bytes();
    files.insert(format!("/appstore/{extra}"), (200, "image/png", png));
    drop(files);
    let client = client(mock.clone());
    assert!(client
        .prepare("example", 3, "apps/example/3/manifest.json")
        .is_ok());
    mock.files
        .lock()
        .unwrap()
        .get_mut(&format!("/appstore/{extra}"))
        .unwrap()
        .2[0] ^= 1;
    assert_eq!(
        id(client
            .prepare("example", 3, "apps/example/3/manifest.json")
            .err()
            .unwrap()),
        "STORECLIENT_BUNDLE_HASH_MISMATCH"
    );
}

#[test]
fn invite_is_normalized_and_sent_through_the_shared_transport() {
    struct Observed {
        invites: Arc<Mutex<Vec<Option<String>>>>,
    }
    impl Transport for Observed {
        fn get(
            &self,
            _: &str,
            _: &[String],
            _: &str,
            _: u64,
        ) -> Result<PublicResponse, PublicHttpError> {
            self.invites.lock().unwrap().push(None);
            Err(PublicHttpError::Transport("멈춤".into()))
        }
        fn get_with_invite(
            &self,
            _: &str,
            _: &[String],
            _: &str,
            invite: &str,
            _: u64,
        ) -> Result<PublicResponse, PublicHttpError> {
            self.invites.lock().unwrap().push(Some(invite.into()));
            Err(PublicHttpError::Transport("멈춤".into()))
        }
    }
    let invites = Arc::new(Mutex::new(Vec::new()));
    let client = StoreClient::with_transport(
        "https://example.com/appstore",
        Arc::new(Observed { invites: invites.clone() }),
    )
    .unwrap()
    .with_invite(Some("  8E307891-FD5A-4D75-BE0F-A80AB5DF0602 ".into()));
    assert_eq!(id(client.index("catalog").unwrap_err()), "STORECLIENT_FETCH_TRANSPORT_FAILED");
    assert_eq!(
        *invites.lock().unwrap(),
        vec![Some("8e307891-fd5a-4d75-be0f-a80ab5df0602".into())]
    );
}

#[test]
fn rejected_invite_is_reported_as_an_invite_error() {
    let (mock, _, _) = fixture();
    let client = client(mock.clone()).with_invite(Some("code".into()));
    for status in [401, 403] {
        mock.files.lock().unwrap().insert(
            "/appstore/index.json".into(),
            (status, "text/plain", Vec::new()),
        );
        assert_eq!(
            id(client.index("catalog").unwrap_err()),
            "STORECLIENT_FETCH_INVITE_REJECTED"
        );
    }
}

#[test]
fn store_invites_accept_arrays_and_objects_with_normalized_keys_and_codes() {
    assert_eq!(
        super::parse_store_invites(&json!([
            {"server":"https://EXAMPLE.com/appstore/", "invite":"  AbC-123 "},
            {"server":"https://other.example/", "invite":"   "},
            {"server":"not a url", "invite":"x"},
            {"invite":"missing"}
        ])),
        BTreeMap::from([("https://example.com/appstore".into(), "abc-123".into())])
    );
    assert_eq!(
        super::parse_store_invites(&json!({
            "https://Example.com/shop/": " XyZ ",
            "https://skip.example": ""
        })),
        BTreeMap::from([("https://example.com/shop".into(), "xyz".into())])
    );
    assert!(super::parse_store_invites(&json!(null)).is_empty());
}
