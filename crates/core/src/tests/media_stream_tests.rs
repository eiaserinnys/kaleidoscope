use super::*;
use kaleidoscope_contract::data::{BlobMediaRef, MediaPlayback, MediaRef, ResourceMediaRef};

const ORIGIN: &str = "http://localhost:1420";
fn media(path: &str) -> MediaRef {
    MediaRef::Resource(ResourceMediaRef {
        permission: "docs".into(),
        path: path.into(),
        query: BTreeMap::new(),
        crop: None,
    })
}
fn setup(data: &Path, folder: &Path) -> (Core, Arc<FakeHost>, String) {
    setup_with_origin(data, folder, Some(ORIGIN.into()))
}
fn setup_with_origin(
    data: &Path,
    folder: &Path,
    origin: Option<String>,
) -> (Core, Arc<FakeHost>, String) {
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.to_path_buf()));
    let definition = json!({"id":"media-test","name":"미디어 시험","requires":{"blocks":4,"modules":{"files":1}},
        "permissions":[{"module":"files","id":"docs","access":"read","label":"폴더"}],
        "state":{},"ui":{"type":"text","value":"시험"}}).to_string();
    let core = Core::open(
        CoreConfig {
            media_origin: origin,
            embedded_server: None,
            data_dir: data.to_path_buf(),
            seed_definitions: vec![definition],
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "시험".into(),
        },
        host.clone(),
    )
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "media-test");
    (core, host, window)
}
#[test]
fn stream_requires_a_configured_origin() {
    let data = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("file.wav"), b"test").unwrap();
    let (core, _, window) = setup_with_origin(data.path(), folder.path(), None);
    pick_folder(&core, &window);
    assert_eq!(
        open(&core, &window, "file.wav").unwrap_err().id.as_deref(),
        Some("MEDIA_STREAM_ORIGIN_NOT_CONFIGURED")
    );
    core.shutdown();
}
fn open(core: &Core, window: &str, path: &str) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::DataMediaOpen {
        window_id: window.into(),
        media: media(path),
    })
}
fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}
#[test]
fn loopback_ranges_origins_and_grant_changes() {
    let data = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let next = TempDir::new().unwrap();
    let bytes: Vec<u8> = (0..100).collect();
    fs::write(folder.path().join("sound.wav"), &bytes).unwrap();
    fs::write(next.path().join("sound.wav"), &bytes).unwrap();
    let (core, host, window) = setup(data.path(), folder.path());
    assert_eq!(
        open(&core, &window, "sound.wav").unwrap_err().id.as_deref(),
        Some("FILE_ACCESS_FOLDER_NOT_CHOSEN")
    );
    pick_folder(&core, &window);
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { handle, url, mime },
    } = open(&core, &window, "sound.wav").unwrap()
    else {
        panic!("stream")
    };
    assert_eq!(mime, "audio/wav");
    let client = client();
    let preflight = client
        .request(reqwest::Method::OPTIONS, &url)
        .header("Origin", ORIGIN)
        .header("Access-Control-Request-Method", "GET")
        .header("Access-Control-Request-Headers", "range")
        .send()
        .unwrap();
    assert_eq!(preflight.status(), 204);
    assert_eq!(preflight.headers()["access-control-allow-origin"], ORIGIN);
    let response = client.post(&url).header("Origin", ORIGIN).send().unwrap();
    assert_eq!(response.status(), 405);
    assert_eq!(
        response.json::<Value>().unwrap()["id"],
        "MEDIA_STREAM_METHOD_UNSUPPORTED"
    );
    for (requested_method, requested_header) in [("POST", "range"), ("GET", "x-other")] {
        let response = client
            .request(reqwest::Method::OPTIONS, &url)
            .header("Origin", ORIGIN)
            .header("Access-Control-Request-Method", requested_method)
            .header("Access-Control-Request-Headers", requested_header)
            .send()
            .unwrap();
        assert_eq!(response.status(), 403);
        assert_eq!(
            response.json::<Value>().unwrap()["id"],
            "MEDIA_STREAM_PREFLIGHT_REJECTED"
        );
    }
    let response = client
        .request(reqwest::Method::OPTIONS, &url)
        .header("Origin", "https://other.test")
        .header("Access-Control-Request-Method", "POST")
        .send()
        .unwrap();
    assert_eq!(response.status(), 403);
    assert_eq!(
        response.json::<Value>().unwrap()["id"],
        "MEDIA_STREAM_ORIGIN_REJECTED"
    );
    let get = |range: Option<&str>| {
        let request = client.get(&url).header("Origin", ORIGIN);
        if let Some(range) = range {
            request.header("Range", range).send().unwrap()
        } else {
            request.send().unwrap()
        }
    };
    let response = get(None);
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-length"], "100");
    assert_eq!(response.bytes().unwrap().as_ref(), bytes.as_slice());
    let response = client.head(&url).header("Origin", ORIGIN).send().unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-length"], "100");
    assert!(response.bytes().unwrap().is_empty());
    for (range, expected, content_range) in [
        ("bytes=20-29", &bytes[20..30], "bytes 20-29/100"),
        ("bytes=-10", &bytes[90..], "bytes 90-99/100"),
    ] {
        let response = get(Some(range));
        assert_eq!(response.status(), 206);
        assert_eq!(response.headers()["content-range"], content_range);
        assert_eq!(response.bytes().unwrap().as_ref(), expected);
    }
    let response = get(Some("bytes=100-"));
    assert_eq!(response.status(), 416);
    assert_eq!(response.headers()["content-range"], "bytes */100");
    assert_eq!(get(Some("bytes=9-2")).status(), 400);
    assert_eq!(
        get(Some("bytes=0-1,3-4")).bytes().unwrap().as_ref(),
        bytes.as_slice()
    );
    for origin in [None, Some("null"), Some("https://other.test")] {
        let mut request = client.get(&url);
        if let Some(origin) = origin {
            request = request.header("Origin", origin);
        }
        let response = request.send().unwrap();
        assert_eq!(response.status(), 403);
        assert!(response
            .headers()
            .get("access-control-allow-origin")
            .is_none());
    }
    let unknown = format!("{}/missing", url.rsplit_once('/').unwrap().0);
    assert_eq!(
        client
            .get(unknown)
            .header("Origin", ORIGIN)
            .send()
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        core.handle(CoreRequest::DataMediaStatus {
            window_id: "other".into(),
            handle: handle.clone()
        })
        .unwrap_err()
        .id
        .as_deref(),
        Some("MEDIA_STREAM_HANDLE_OWNER_MISMATCH")
    );
    host.choose(Some(next.path().to_path_buf()));
    pick_folder(&core, &window);
    assert_eq!(get(None).status(), 409);
    let CoreReply::DataMediaStatus { error: Some(error) } = core
        .handle(CoreRequest::DataMediaStatus {
            window_id: window.clone(),
            handle: handle.clone(),
        })
        .unwrap()
    else {
        panic!("status")
    };
    assert_eq!(error.id.as_deref(), Some("MEDIA_STREAM_AUTHORITY_CHANGED"));
    core.handle(CoreRequest::DataMediaClose {
        window_id: window.clone(),
        handle: handle.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::DataMediaClose {
        window_id: window,
        handle,
    })
    .unwrap();
    core.shutdown();
}

#[test]
fn aac_file_opens_as_audio_stream() {
    let data = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("sound.aac"), b"test").unwrap();
    let (core, _, window) = setup(data.path(), folder.path());
    pick_folder(&core, &window);
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { mime, .. },
    } = open(&core, &window, "sound.aac").unwrap()
    else {
        panic!("stream")
    };
    assert_eq!(mime, "audio/aac");
    core.shutdown();
}

#[test]
fn modified_file_invalidates_lease() {
    let data = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("file.wav"), b"original").unwrap();
    let (core, _, window) = setup(data.path(), folder.path());
    pick_folder(&core, &window);
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { url, handle, .. },
    } = open(&core, &window, "file.wav").unwrap()
    else {
        panic!("stream")
    };
    fs::write(folder.path().join("file.wav"), b"changed length").unwrap();
    assert_eq!(
        client()
            .get(&url)
            .header("Origin", ORIGIN)
            .send()
            .unwrap()
            .status(),
        409
    );
    let CoreReply::DataMediaStatus { error: Some(error) } = core
        .handle(CoreRequest::DataMediaStatus {
            window_id: window,
            handle,
        })
        .unwrap()
    else {
        panic!("status")
    };
    assert_eq!(error.id.as_deref(), Some("MEDIA_STREAM_FILE_CHANGED"));
    core.shutdown();
}
#[test]
fn large_folder_audio_and_video_stream_while_images_keep_limit() {
    let data = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    for file in ["large.wav", "large.mp4", "large.png"] {
        fs::File::create(folder.path().join(file))
            .unwrap()
            .set_len(20 * 1024 * 1024 + 1)
            .unwrap();
    }
    let (core, _, window) = setup(data.path(), folder.path());
    pick_folder(&core, &window);
    for file in ["large.wav", "large.mp4"] {
        assert!(matches!(
            open(&core, &window, file).unwrap(),
            CoreReply::DataMediaOpen {
                playback: MediaPlayback::Stream { .. }
            }
        ));
    }
    let error = open(&core, &window, "large.png").unwrap_err();
    assert_eq!(error.id.as_deref(), Some("MEDIA_LOAD_DATA_TOO_LARGE"));
    core.shutdown();
}
#[test]
fn folder_authorization_and_stream_lifetime() {
    let folder = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::write(folder.path().join("file.wav"), b"12345678").unwrap();
    fs::write(outside.path().join("secret.wav"), b"secret").unwrap();
    fs::create_dir(folder.path().join("directory.wav")).unwrap();
    let data = folder.path().join("core-data");
    let (core, _, window) = setup(&data, folder.path());
    fs::write(data.join("protected.wav"), b"protected").unwrap();
    pick_folder(&core, &window);
    let error = open(&core, "missing", "file.wav").unwrap_err();
    assert_eq!(error.id.as_deref(), Some("MEDIA_LOAD_WINDOW_NOT_FOUND"));
    let error = open(&core, &window, "directory.wav").unwrap_err();
    assert_eq!(error.id.as_deref(), Some("MEDIA_STREAM_FILE_NOT_REGULAR"));
    let error = open(&core, &window, "core-data/protected.wav").unwrap_err();
    assert_eq!(error.id.as_deref(), Some("FILE_PATH_PROTECTED"));
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(
            outside.path().join("secret.wav"),
            folder.path().join("escape.wav"),
        )
        .unwrap();
        let error = open(&core, &window, "escape.wav").unwrap_err();
        assert_eq!(error.id.as_deref(), Some("FILE_PATH_OUTSIDE_ROOT"));
    }
    let mut wrong = match media("file.wav") {
        MediaRef::Resource(value) => value,
        _ => unreachable!(),
    };
    wrong.permission = "wrong".into();
    let error = core
        .handle(CoreRequest::DataMediaOpen {
            window_id: window.clone(),
            media: MediaRef::Resource(wrong),
        })
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("MEDIA_LOAD_PERMISSION_NOT_DECLARED")
    );
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { handle, url, .. },
    } = open(&core, &window, "file.wav").unwrap()
    else {
        panic!("stream")
    };
    assert_eq!(
        core.handle(CoreRequest::DataMediaClose {
            window_id: "other".into(),
            handle: handle.clone()
        })
        .unwrap_err()
        .id
        .as_deref(),
        Some("MEDIA_STREAM_HANDLE_OWNER_MISMATCH")
    );
    core.handle(CoreRequest::DataDetach {
        window_id: window.clone(),
    })
    .unwrap();
    assert_eq!(
        client()
            .get(&url)
            .header("Origin", ORIGIN)
            .send()
            .unwrap()
            .status(),
        200
    );
    core.handle(CoreRequest::DataDetach {
        window_id: window.clone(),
    })
    .unwrap();
    assert_eq!(
        client()
            .get(&url)
            .header("Origin", ORIGIN)
            .header("Range", "bytes=2-5")
            .send()
            .unwrap()
            .status(),
        206
    );
    {
        let mut state = core.inner.state.lock().unwrap();
        let app = state
            .shared
            .app_versions
            .iter_mut()
            .find(|app| app.app_id == "media-test")
            .unwrap();
        app.definition.permissions[0] = kaleidoscope_contract::PermissionDecl::Profiler {
            id: "docs".into(),
            label: "프로파일러".into(),
        };
    }
    assert_eq!(
        open(&core, &window, "file.wav").unwrap_err().id.as_deref(),
        Some("MEDIA_LOAD_SOURCE_UNSUPPORTED")
    );
    core.shutdown();
}

#[test]
fn closing_unattached_window_removes_stream_lease() {
    let data = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("file.wav"), b"test").unwrap();
    let (core, _, window) = setup(data.path(), folder.path());
    pick_folder(&core, &window);
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { url, handle, .. },
    } = open(&core, &window, "file.wav").unwrap()
    else {
        panic!("stream")
    };
    core.handle(CoreRequest::WindowClose {
        window_id: window.clone(),
    })
    .unwrap();
    assert_eq!(
        client()
            .get(&url)
            .header("Origin", ORIGIN)
            .send()
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        core.handle(CoreRequest::DataMediaStatus {
            window_id: window,
            handle
        })
        .unwrap_err()
        .id
        .as_deref(),
        Some("MEDIA_STREAM_HANDLE_INVALID")
    );
    core.shutdown();
}

#[test]
fn opening_a_stream_removes_closed_window_leases() {
    let data = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("file.wav"), b"test").unwrap();
    let (core, _, old_window) = setup(data.path(), folder.path());
    pick_folder(&core, &old_window);
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { handle, .. },
    } = open(&core, &old_window, "file.wav").unwrap()
    else {
        panic!("stream")
    };
    core.handle(CoreRequest::WindowClose {
        window_id: old_window.clone(),
    })
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let new_window = open_window(&core, &desktop, "media-test");
    pick_folder(&core, &new_window);
    assert!(matches!(
        open(&core, &new_window, "file.wav").unwrap(),
        CoreReply::DataMediaOpen {
            playback: MediaPlayback::Stream { .. }
        }
    ));
    assert_eq!(
        core.handle(CoreRequest::DataMediaStatus {
            window_id: old_window,
            handle
        })
        .unwrap_err()
        .id
        .as_deref(),
        Some("MEDIA_STREAM_HANDLE_INVALID")
    );
    core.shutdown();
}

fn blob_definition(id: &str, scope: Option<&str>, blocks: u32, storage: bool) -> String {
    let mut client = json!({"runtime":"javascript","entry":{"id":"entry","version":1}});
    if storage {
        client["device_storage"] = json!({"prefixes":["media/"]});
        if let Some(scope) = scope {
            client["device_storage"]["scope"] = json!(scope);
        }
    }
    json!({"id":id,"name":"기기 미디어 시험","requires":{"blocks":blocks,"modules":{"assets":1,"client":4}},
        "assets":[{"id":"entry","version":1}],"client":client,"state":{},
        "ui":{"type":"text","value":"시험"}})
    .to_string()
}
fn blob_setup(data: &Path, definitions: Vec<String>) -> Core {
    Core::open(
        CoreConfig {
            media_origin: Some(ORIGIN.into()),
            embedded_server: None,
            data_dir: data.to_path_buf(),
            seed_definitions: definitions,
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "시험".into(),
        },
        Arc::new(FakeHost::default()),
    )
    .unwrap()
}
fn blob_put(core: &Core, window: &str, key: &str, bytes: Vec<u8>) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::ClientBlobPut {
        window_id: window.into(),
        key: key.into(),
        file_id: None,
        bytes: Some(bytes),
    })
}
fn blob_media(key: &str) -> MediaRef {
    MediaRef::Blob(BlobMediaRef {
        blob: key.into(),
        crop: None,
    })
}
fn blob_open(core: &Core, window: &str, key: &str) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::DataMediaOpen {
        window_id: window.into(),
        media: blob_media(key),
    })
}
fn blob_data(
    core: &Core,
    window: &str,
    key: &str,
    max_px: Option<u32>,
) -> Result<CoreReply, CoreError> {
    core.handle(CoreRequest::DataMedia {
        window_id: window.into(),
        media: blob_media(key),
        max_px,
    })
}
fn blob_status(core: &Core, window: &str, handle: &str) -> Option<CoreError> {
    match core
        .handle(CoreRequest::DataMediaStatus {
            window_id: window.into(),
            handle: handle.into(),
        })
        .unwrap()
    {
        CoreReply::DataMediaStatus { error } => error,
        other => panic!("unexpected: {other:?}"),
    }
}

#[test]
fn blob_audio_streams_with_range_in_app_and_window_scope() {
    for scope in [None, Some("window")] {
        let data = TempDir::new().unwrap();
        let core = blob_setup(data.path(), vec![blob_definition("blob-app", scope, 52, true)]);
        let (_, desktop) = active_ids(&core);
        let window = open_window(&core, &desktop, "blob-app");
        let bytes: Vec<u8> = (0..100).collect();
        blob_put(&core, &window, "media/sound.wav", bytes.clone()).unwrap();
        let CoreReply::DataMediaOpen {
            playback: MediaPlayback::Stream { url, mime, .. },
        } = blob_open(&core, &window, "media/sound.wav").unwrap()
        else {
            panic!("stream")
        };
        assert_eq!(mime, "audio/wav");
        let response = client()
            .get(&url)
            .header("Origin", ORIGIN)
            .header("Range", "bytes=20-29")
            .send()
            .unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.headers()["content-range"], "bytes 20-29/100");
        assert_eq!(response.bytes().unwrap().as_ref(), &bytes[20..30]);
        core.shutdown();
    }
}

#[test]
fn large_blob_audio_streams_while_images_keep_the_inline_limit() {
    let data = TempDir::new().unwrap();
    let core = blob_setup(data.path(), vec![blob_definition("blob-app", None, 52, true)]);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "blob-app");
    let size = 20 * 1024 * 1024 + 1;
    blob_put(&core, &window, "media/large.wav", vec![7; size]).unwrap();
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { url, .. },
    } = blob_open(&core, &window, "media/large.wav").unwrap()
    else {
        panic!("stream")
    };
    let response = client()
        .get(&url)
        .header("Origin", ORIGIN)
        .header("Range", format!("bytes={}-{}", size - 2, size - 1))
        .send()
        .unwrap();
    assert_eq!(response.status(), 206);
    assert_eq!(response.bytes().unwrap().len(), 2);
    blob_put(&core, &window, "media/large.png", vec![7; size]).unwrap();
    assert_eq!(
        blob_data(&core, &window, "media/large.png", None)
            .unwrap_err()
            .id
            .as_deref(),
        Some("MEDIA_LOAD_DATA_TOO_LARGE")
    );
    core.shutdown();
}

#[test]
fn blob_png_shrinks_through_data_media() {
    let data = TempDir::new().unwrap();
    let core = blob_setup(data.path(), vec![blob_definition("blob-app", None, 52, true)]);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "blob-app");
    let mut bytes = Vec::new();
    image::RgbaImage::from_pixel(80, 40, image::Rgba([255, 0, 0, 128]))
        .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
        .unwrap();
    blob_put(&core, &window, "media/photo.png", bytes).unwrap();
    let CoreReply::DataMedia { media } = blob_data(&core, &window, "media/photo.png", Some(20)).unwrap()
    else {
        panic!("data.media")
    };
    assert_eq!(media.mime, "image/png");
    assert_eq!(media.width, Some(20));
    assert_eq!(media.height, Some(10));
    assert!(!media.data_base64.is_empty());
    core.shutdown();
}

#[test]
fn blob_media_respects_window_app_and_prefix_boundaries() {
    let data = TempDir::new().unwrap();
    let core = blob_setup(
        data.path(),
        vec![
            blob_definition("blob-app", None, 52, true),
            blob_definition("blob-other", None, 52, true),
            blob_definition("blob-plain", None, 52, false),
        ],
    );
    let (_, desktop) = active_ids(&core);
    let one = open_window(&core, &desktop, "blob-app");
    let two = open_window(&core, &desktop, "blob-app");
    let other = open_window(&core, &desktop, "blob-other");
    let plain = open_window(&core, &desktop, "blob-plain");
    blob_put(&core, &one, "media/share.wav", vec![1; 8]).unwrap();
    assert!(matches!(
        blob_open(&core, &two, "media/share.wav").unwrap(),
        CoreReply::DataMediaOpen {
            playback: MediaPlayback::Stream { .. }
        }
    ));
    assert_eq!(
        blob_open(&core, &other, "media/share.wav").unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(
        blob_open(&core, &plain, "media/share.wav")
            .unwrap_err()
            .id
            .as_deref(),
        Some("DATA_CLIENT_BLOB_STORAGE_NOT_DECLARED")
    );
    assert_eq!(
        blob_put(&core, &one, "other/key.wav", vec![1])
            .unwrap_err()
            .id
            .as_deref(),
        Some("DATA_CLIENT_BLOB_PREFIX_DENIED")
    );
    assert_eq!(
        blob_open(&core, &one, "other/key.wav")
            .unwrap_err()
            .id
            .as_deref(),
        Some("DATA_CLIENT_BLOB_PREFIX_DENIED")
    );
    assert_eq!(
        blob_put(&core, &one, "media/../escape.wav", vec![1])
            .unwrap_err()
            .id
            .as_deref(),
        Some("DATA_CLIENT_BLOB_KEY_INVALID")
    );
    core.shutdown();

    let data = TempDir::new().unwrap();
    let core = blob_setup(
        data.path(),
        vec![blob_definition("blob-app", Some("window"), 52, true)],
    );
    let (_, desktop) = active_ids(&core);
    let one = open_window(&core, &desktop, "blob-app");
    let two = open_window(&core, &desktop, "blob-app");
    blob_put(&core, &one, "media/window.wav", vec![1; 8]).unwrap();
    assert!(matches!(
        blob_open(&core, &one, "media/window.wav").unwrap(),
        CoreReply::DataMediaOpen {
            playback: MediaPlayback::Stream { .. }
        }
    ));
    assert_eq!(
        blob_open(&core, &two, "media/window.wav").unwrap_err().code,
        ErrorCode::NotFound
    );
    core.shutdown();
}

#[test]
fn blob_stream_rejects_foreign_origins_and_expires_on_remove_or_replace() {
    let data = TempDir::new().unwrap();
    let core = blob_setup(data.path(), vec![blob_definition("blob-app", None, 52, true)]);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "blob-app");
    blob_put(&core, &window, "media/clip.wav", vec![9; 64]).unwrap();
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { url, handle, .. },
    } = blob_open(&core, &window, "media/clip.wav").unwrap()
    else {
        panic!("stream")
    };
    for origin in [None, Some("null"), Some("https://other.test")] {
        let mut request = client().get(&url);
        if let Some(origin) = origin {
            request = request.header("Origin", origin);
        }
        assert_eq!(request.send().unwrap().status(), 403);
    }
    assert_eq!(
        client()
            .get(&url)
            .header("Origin", ORIGIN)
            .send()
            .unwrap()
            .status(),
        200
    );
    core.handle(CoreRequest::ClientBlobRemove {
        window_id: window.clone(),
        key: "media/clip.wav".into(),
    })
    .unwrap();
    let response = client().get(&url).header("Origin", ORIGIN).send().unwrap();
    assert_eq!(response.status(), 404);
    assert_eq!(
        response.json::<Value>().unwrap()["id"],
        "MEDIA_BLOB_PATH_NOT_FOUND"
    );
    assert_eq!(
        blob_status(&core, &window, &handle).unwrap().id.as_deref(),
        Some("MEDIA_BLOB_PATH_NOT_FOUND")
    );
    blob_put(&core, &window, "media/clip.wav", vec![1; 32]).unwrap();
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream {
            url: replaced,
            handle: replaced_handle,
            ..
        },
    } = blob_open(&core, &window, "media/clip.wav").unwrap()
    else {
        panic!("stream")
    };
    blob_put(&core, &window, "media/clip.wav", vec![2; 128]).unwrap();
    assert_eq!(
        client()
            .get(&replaced)
            .header("Origin", ORIGIN)
            .send()
            .unwrap()
            .status(),
        409
    );
    assert_eq!(
        blob_status(&core, &window, &replaced_handle)
            .unwrap()
            .id
            .as_deref(),
        Some("MEDIA_STREAM_FILE_CHANGED")
    );
    core.shutdown();
}

#[test]
fn blob_stream_lifetime_follows_window_and_owner() {
    let data = TempDir::new().unwrap();
    let core = blob_setup(data.path(), vec![blob_definition("blob-app", None, 52, true)]);
    let (_, desktop) = active_ids(&core);
    let one = open_window(&core, &desktop, "blob-app");
    let two = open_window(&core, &desktop, "blob-app");
    blob_put(&core, &one, "media/lifetime.wav", vec![3; 16]).unwrap();
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { handle, .. },
    } = blob_open(&core, &one, "media/lifetime.wav").unwrap()
    else {
        panic!("stream")
    };
    for request in [
        CoreRequest::DataMediaStatus {
            window_id: two.clone(),
            handle: handle.clone(),
        },
        CoreRequest::DataMediaClose {
            window_id: two.clone(),
            handle: handle.clone(),
        },
    ] {
        assert_eq!(
            core.handle(request).unwrap_err().id.as_deref(),
            Some("MEDIA_STREAM_HANDLE_OWNER_MISMATCH")
        );
    }
    for _ in 0..2 {
        core.handle(CoreRequest::DataMediaClose {
            window_id: one.clone(),
            handle: handle.clone(),
        })
        .unwrap();
    }
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { url, handle, .. },
    } = blob_open(&core, &two, "media/lifetime.wav").unwrap()
    else {
        panic!("stream")
    };
    core.handle(CoreRequest::WindowClose {
        window_id: two.clone(),
    })
    .unwrap();
    assert_eq!(
        client()
            .get(&url)
            .header("Origin", ORIGIN)
            .send()
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        core.handle(CoreRequest::DataMediaStatus {
            window_id: two,
            handle
        })
        .unwrap_err()
        .id
        .as_deref(),
        Some("MEDIA_STREAM_HANDLE_INVALID")
    );
    core.shutdown();
}

#[test]
fn blob_media_rejects_old_block_sets_symlinks_and_stale_grants() {
    let data = TempDir::new().unwrap();
    let core = blob_setup(data.path(), vec![blob_definition("blob-app", None, 51, true)]);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "blob-app");
    blob_put(&core, &window, "media/old.wav", vec![1; 8]).unwrap();
    assert_eq!(
        blob_open(&core, &window, "media/old.wav")
            .unwrap_err()
            .id
            .as_deref(),
        Some("MEDIA_BLOB_VERSION_LOW")
    );
    core.shutdown();

    #[cfg(unix)]
    {
        let data = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let core = blob_setup(data.path(), vec![blob_definition("blob-app", None, 52, true)]);
        let (_, desktop) = active_ids(&core);
        let window = open_window(&core, &desktop, "blob-app");
        let root = crate::client_blobs::location(&core.inner, &window, "media/")
            .unwrap()
            .root;
        fs::create_dir_all(root.join("media")).unwrap();
        fs::write(outside.path().join("secret.wav"), b"secret").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.wav"),
            root.join("media/escape.wav"),
        )
        .unwrap();
        assert_eq!(
            blob_open(&core, &window, "media/escape.wav")
                .unwrap_err()
                .id
                .as_deref(),
            Some("MEDIA_BLOB_PATH_OUTSIDE_ROOT")
        );
        core.shutdown();
    }

    let data = TempDir::new().unwrap();
    let core = blob_setup(data.path(), vec![blob_definition("blob-app", None, 52, true)]);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "blob-app");
    blob_put(&core, &window, "media/stale.wav", vec![5; 32]).unwrap();
    let CoreReply::DataMediaOpen {
        playback: MediaPlayback::Stream { url, handle, .. },
    } = blob_open(&core, &window, "media/stale.wav").unwrap()
    else {
        panic!("stream")
    };
    core.inner.generation.fetch_add(1, Ordering::SeqCst);
    assert_eq!(
        client()
            .get(&url)
            .header("Origin", ORIGIN)
            .send()
            .unwrap()
            .status(),
        409
    );
    assert_eq!(
        blob_status(&core, &window, &handle).unwrap().id.as_deref(),
        Some("MEDIA_BLOB_AUTHORITY_CHANGED")
    );
    core.shutdown();
}
