use super::*;
use kaleidoscope_contract::data::FileAccept;

struct FileHost {
    input: PathBuf,
    output: PathBuf,
}
impl Host for FileHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }
    fn pick_files(&self, _: &[FileAccept], _: bool) -> Option<Vec<PathBuf>> {
        Some(vec![self.input.clone()])
    }
    fn pick_save_file(&self, _: &str, _: &str) -> Option<PathBuf> {
        Some(self.output.clone())
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
    let host = Arc::new(FileHost {
        input,
        output: output.clone(),
    });
    let core = Core::open(
        CoreConfig {
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
    assert!(core.client_read_file("other", &files[0].id).is_err());
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
    assert_eq!(fs::read(&output).unwrap(), "이전".as_bytes());
    core.handle(CoreRequest::ExportClose {
        window_id: window.clone(),
        sink_id: sink,
    })
    .unwrap();
    assert_eq!(fs::read(&output).unwrap(), b"abcd");
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
        window_id: window,
        sink_id: sink,
    })
    .unwrap();
    assert_eq!(fs::read(&output).unwrap(), b"abcd");
    assert_eq!(
        fs::read_dir(temp.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count(),
        0
    );
}
