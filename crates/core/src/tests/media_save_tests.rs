use super::*;
use crate::SaveFileTarget;
use kaleidoscope_contract::data::{MediaRef, MediaSaveSource, ResourceMediaRef};
use std::sync::Mutex;

struct SaveHost {
    folder: PathBuf,
    target: Arc<Mutex<Option<SaveFileTarget>>>,
    suggested: Arc<Mutex<Option<String>>>,
}

impl Host for SaveHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        Some(self.folder.clone())
    }
    fn pick_save_file(&self, name: &str, _mime: &str) -> Option<SaveFileTarget> {
        *self.suggested.lock().unwrap() = Some(name.to_string());
        self.target.lock().unwrap().clone()
    }
}

fn save_core(
    temp: &TempDir,
    folder: &TempDir,
) -> (
    Core,
    String,
    Arc<Mutex<Option<SaveFileTarget>>>,
    Arc<Mutex<Option<String>>>,
) {
    let definition = json!({
        "id":"save-test","name":"저장 시험",
        "requires":{"blocks":12,"modules":{"assets":1,"files":2}},
        "permissions":[{"module":"files","id":"docs","access":"read","label":"문서"}],
        "state":{},"ui":{"type":"text","value":"시험"}
    })
    .to_string();
    let target = Arc::new(Mutex::new(None));
    let suggested = Arc::new(Mutex::new(None));
    let host = Arc::new(SaveHost {
        folder: folder.path().to_path_buf(),
        target: target.clone(),
        suggested: suggested.clone(),
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
    let window = open_window(&core, &desktop, "save-test");
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "docs".into(),
    })
    .unwrap();
    (core, window, target, suggested)
}

fn media_ref(permission: &str, path: &str) -> MediaRef {
    MediaRef::Resource(ResourceMediaRef {
        permission: permission.into(),
        path: path.into(),
        query: BTreeMap::new(),
        crop: None,
    })
}

#[test]
fn media_source_writes_original_to_the_picked_path() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("그림.png"), b"sample image bytes").unwrap();
    let output = temp.path().join("saved.png");
    let (core, window, target, suggested) = save_core(&temp, &folder);
    *target.lock().unwrap() = Some(SaveFileTarget {
        path: output.clone(),
        location: None,
    });
    let reply = core
        .handle(CoreRequest::DataMediaSave {
            window_id: window.clone(),
            source: MediaSaveSource::Media {
                media: media_ref("docs", "그림.png"),
            },
            suggested_name: "그림.png".into(),
        })
        .unwrap();
    assert!(matches!(
        reply,
        CoreReply::DataMediaSave {
            cancelled: false,
            saved_to: None
        }
    ));
    assert_eq!(fs::read(&output).unwrap(), b"sample image bytes");
    assert_eq!(suggested.lock().unwrap().as_deref(), Some("그림.png"));
}

#[test]
fn a_host_picked_location_is_reported_with_the_written_file() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("회의록.md"), "# 회의록".as_bytes()).unwrap();
    let output = temp.path().join("회의록.md");
    let (core, window, target, _) = save_core(&temp, &folder);
    *target.lock().unwrap() = Some(SaveFileTarget {
        path: output.clone(),
        location: Some("파일 앱 › 나의 iPad › kaleidoscope › 회의록.md".into()),
    });
    let reply = core
        .handle(CoreRequest::DataMediaSave {
            window_id: window,
            source: MediaSaveSource::Media {
                media: media_ref("docs", "회의록.md"),
            },
            suggested_name: "회의록.md".into(),
        })
        .unwrap();
    assert!(matches!(
        reply,
        CoreReply::DataMediaSave {
            cancelled: false,
            saved_to: Some(ref location)
        } if location == "파일 앱 › 나의 iPad › kaleidoscope › 회의록.md"
    ));
    assert_eq!(fs::read(&output).unwrap(), "# 회의록".as_bytes());
}

#[test]
fn cancelling_the_dialog_ends_without_an_error_or_a_file() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("메모.txt"), b"hello").unwrap();
    let (core, window, target, _) = save_core(&temp, &folder);
    *target.lock().unwrap() = None;
    let reply = core
        .handle(CoreRequest::DataMediaSave {
            window_id: window,
            source: MediaSaveSource::Media {
                media: media_ref("docs", "메모.txt"),
            },
            suggested_name: "메모.txt".into(),
        })
        .unwrap();
    assert!(matches!(
        reply,
        CoreReply::DataMediaSave {
            cancelled: true,
            saved_to: None
        }
    ));
}

#[test]
fn unreadable_media_is_rejected_like_data_media() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    fs::write(folder.path().join("메모.txt"), b"hello").unwrap();
    let output = temp.path().join("saved.txt");
    let (core, window, target, _) = save_core(&temp, &folder);
    *target.lock().unwrap() = Some(SaveFileTarget {
        path: output.clone(),
        location: None,
    });
    let error = core
        .handle(CoreRequest::DataMediaSave {
            window_id: window,
            source: MediaSaveSource::Media {
                media: media_ref("missing", "메모.txt"),
            },
            suggested_name: "메모.txt".into(),
        })
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(!output.exists());
}

#[test]
fn bytes_source_writes_the_received_content() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let output = temp.path().join("메모.txt");
    let (core, window, target, _) = save_core(&temp, &folder);
    *target.lock().unwrap() = Some(SaveFileTarget {
        path: output.clone(),
        location: None,
    });
    let reply = core
        .handle(CoreRequest::DataMediaSave {
            window_id: window,
            source: MediaSaveSource::Bytes {
                mime: "text/plain".into(),
                data_base64: "aGVsbG8=".into(),
            },
            suggested_name: "메모.txt".into(),
        })
        .unwrap();
    assert!(matches!(
        reply,
        CoreReply::DataMediaSave {
            cancelled: false,
            saved_to: None
        }
    ));
    assert_eq!(fs::read(&output).unwrap(), b"hello");
}
