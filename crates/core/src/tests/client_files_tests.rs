use super::*;
use kaleidoscope_contract::data::FileAccept;
use std::sync::Mutex;

struct FileHost {
    input: PathBuf,
    output: Arc<Mutex<Option<PathBuf>>>,
}

#[test]
fn open_granted_folder_file_as_window_owned_client_file() {
    let data = TempDir::new().unwrap();
    let docs = TempDir::new().unwrap();
    fs::write(docs.path().join("그림.png"), b"sample image bytes").unwrap();
    let definition = json!({"id":"open-test","name":"파일 열기 시험",
        "requires":{"blocks":12,"modules":{"assets":1,"client":7,"files":2}},
        "permissions":[{"module":"files","id":"docs","access":"read","label":"문서"},
            {"module":"files","id":"write","access":"readwrite","label":"쓰기"},
            {"module":"files","id":"pc","access":"read","label":"PC","scope":"pc"}],
        "state":{},"assets":[{"id":"entry","version":1}],
        "client":{"runtime":"javascript","entry":{"id":"entry","version":1}},
        "ui":{"type":"text","value":"시험"}});
    let mut older = definition.clone();
    older["id"] = json!("old-client");
    older["requires"]["modules"]["client"] = json!(6);
    let mut no_client = definition.clone();
    no_client["id"] = json!("no-client");
    no_client.as_object_mut().unwrap().remove("client");
    let host = Arc::new(FakeHost::default());
    let core = open_core(
        data.path(),
        vec![
            definition.to_string(),
            older.to_string(),
            no_client.to_string(),
        ],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "open-test");
    let other = open_window(&core, &desktop, "open-test");
    let old_window = open_window(&core, &desktop, "old-client");
    let no_client_window = open_window(&core, &desktop, "no-client");
    let request = |window: &str, permission: &str, path: &str| -> CoreRequest {
        serde_json::from_value(
            json!({"op":"client.file_open","window_id":window,"permission":permission,"path":path}),
        )
        .unwrap()
    };
    assert_eq!(
        core.handle(request(&old_window, "docs", "그림.png"))
            .unwrap_err()
            .id
            .as_deref(),
        Some("FILE_CLIENT_OPEN_VERSION_LOW")
    );
    assert_eq!(
        core.handle(request(&no_client_window, "docs", "그림.png"))
            .unwrap_err()
            .id
            .as_deref(),
        Some("FILE_CLIENT_NOT_DECLARED")
    );
    assert!(core.handle(request(&window, "docs", "그림.png")).is_err());
    host.choose(Some(docs.path().into()));
    for permission in ["docs", "write"] {
        core.handle(CoreRequest::FilesPickFolder {
            window_id: window.clone(),
            permission: permission.into(),
        })
        .unwrap();
        let reply = serde_json::to_value(
            core.handle(request(&window, permission, "그림.png"))
                .unwrap(),
        )
        .unwrap();
        let id = reply["file"]["id"].as_str().unwrap();
        assert_eq!(reply["file"]["name"], "그림.png");
        assert_eq!(
            core.client_read_file(&window, id).unwrap(),
            b"sample image bytes"
        );
        assert!(core.client_read_file(&other, id).is_err());
    }
    for (owner, permission, path) in [
        (&other[..], "docs", "그림.png"),
        (&window[..], "pc", "그림.png"),
        (&window[..], "missing", "그림.png"),
        (&window[..], "docs", "../그림.png"),
        (&window[..], "docs", "/tmp/그림.png"),
    ] {
        assert!(core.handle(request(owner, permission, path)).is_err());
    }
    #[cfg(unix)]
    {
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("다른.png"), b"outside").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("다른.png"),
            docs.path().join("링크.png"),
        )
        .unwrap();
        assert!(core.handle(request(&window, "docs", "링크.png")).is_err());
    }
}
impl Host for FileHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }
    fn pick_files(&self, _: &[FileAccept], _: bool) -> Option<Vec<PathBuf>> {
        Some(vec![self.input.clone()])
    }
    fn pick_save_file(&self, _: &str, _: &str) -> Option<PathBuf> {
        self.output.lock().unwrap().clone()
    }
}

#[test]
fn picked_files_and_offset_exports_are_scoped_and_abort_preserves_destination() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("input.wav");
    let output = temp.path().join("output.bin");
    fs::write(&input, "음원".as_bytes()).unwrap();
    fs::write(&output, "이전".as_bytes()).unwrap();
    let definition = json!({"id":"files-client","name":"파일 시험","requires":{"blocks":12,"modules":{"assets":1,"client":1}},"permissions":[],"state":{},
        "assets":[{"id":"entry","version":1}],"client":{"runtime":"javascript","entry":{"id":"entry","version":1}},"ui":{"type":"text","value":"시험"}}).to_string();
    let save_path = Arc::new(Mutex::new(Some(output.clone())));
    let host = Arc::new(FileHost {
        input,
        output: save_path.clone(),
    });
    let core = Core::open(
        CoreConfig {
            media_origin: None,
            embedded_server: None,
            data_dir: temp.path().join("data"),
            seed_definitions: vec![definition],
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "시험".into(),
        },
        host,
    )
    .unwrap();
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "files-client");
    let CoreReply::FilesPick { cancelled, files } = core
        .handle(CoreRequest::FilesPick {
            window_id: window.clone(),
            accept: vec![FileAccept {
                mime: "audio/*".into(),
                extensions: vec!["wav".into()],
            }],
            multiple: false,
        })
        .unwrap()
    else {
        panic!("files.pick");
    };
    assert!(!cancelled);
    assert!(files[0].mime.starts_with("audio/") && files[0].mime != "audio/*");
    assert_eq!(
        core.client_read_file(&window, &files[0].id).unwrap(),
        "음원".as_bytes()
    );
    let error = core.client_read_file("other", &files[0].id).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("FILE_CLIENT_INPUT_NOT_OWNED"));
    assert_eq!(
        error.code,
        kaleidoscope_contract::ErrorCode::PermissionDenied
    );
    assert!(error
        .details
        .iter()
        .any(|detail| detail.contains(&files[0].id)));
    let CoreReply::ExportBegin {
        sink_id: Some(sink),
        ..
    } = core
        .handle(CoreRequest::ExportBegin {
            window_id: window.clone(),
            suggested_name: "output.bin".into(),
            mime: "application/octet-stream".into(),
        })
        .unwrap()
    else {
        panic!("export.begin");
    };
    core.client_write_export(&window, &sink, 2, b"cd").unwrap();
    core.client_write_export(&window, &sink, 0, b"ab").unwrap();
    let error = core
        .handle(CoreRequest::ExportTruncate {
            window_id: "other".into(),
            sink_id: sink.clone(),
            size: 0,
        })
        .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("FILE_CLIENT_EXPORT_ID_NOT_OWNED"));
    assert_eq!(
        error.code,
        kaleidoscope_contract::ErrorCode::PermissionDenied
    );
    assert!(error.details.iter().any(|detail| detail.contains(&sink)));
    core.handle(CoreRequest::ExportTruncate {
        window_id: window.clone(),
        sink_id: sink.clone(),
        size: 0,
    })
    .unwrap();
    core.client_write_export(&window, &sink, 0, b"xy").unwrap();
    assert_eq!(fs::read(&output).unwrap(), "이전".as_bytes());
    core.handle(CoreRequest::ExportClose {
        window_id: window.clone(),
        sink_id: sink,
    })
    .unwrap();
    assert_eq!(fs::read(&output).unwrap(), b"xy");
    let CoreReply::ExportBegin {
        sink_id: Some(sink),
        ..
    } = core
        .handle(CoreRequest::ExportBegin {
            window_id: window.clone(),
            suggested_name: "output.bin".into(),
            mime: "application/octet-stream".into(),
        })
        .unwrap()
    else {
        panic!("export.begin");
    };
    core.client_write_export(&window, &sink, 0, b"discard")
        .unwrap();
    core.handle(CoreRequest::ExportAbort {
        window_id: window.clone(),
        sink_id: sink,
    })
    .unwrap();
    assert_eq!(fs::read(&output).unwrap(), b"xy");
    assert_eq!(
        fs::read_dir(temp.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count(),
        0
    );

    let CoreReply::FilesSavePrompt {
        file_id: Some(file_id),
    } = core
        .handle(CoreRequest::FilesSavePrompt {
            window_id: window.clone(),
            suggested_name: "share.bin".into(),
            mime: "application/octet-stream".into(),
        })
        .unwrap()
    else {
        panic!("files.save_prompt");
    };
    core.client_write_export(&window, &file_id, 0, b"shared output")
        .unwrap();
    assert_eq!(fs::read(&output).unwrap(), b"xy");
    core.handle(CoreRequest::ExportClose {
        window_id: window.clone(),
        sink_id: file_id.clone(),
    })
    .unwrap();
    assert_eq!(fs::read(&output).unwrap(), b"shared output");
    assert_eq!(
        core.client_read_file(&window, &file_id).unwrap(),
        b"shared output"
    );
    assert!(core.client_read_file("other", &file_id).is_err());

    *save_path.lock().unwrap() = None;
    let CoreReply::FilesSavePrompt { file_id } = core
        .handle(CoreRequest::FilesSavePrompt {
            window_id: window,
            suggested_name: "cancelled.bin".into(),
            mime: "application/octet-stream".into(),
        })
        .unwrap()
    else {
        panic!("files.save_prompt cancellation");
    };
    assert_eq!(file_id, None);
    assert_eq!(fs::read(&output).unwrap(), b"shared output");
}
