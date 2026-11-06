use super::*;
use kaleidoscope_contract::PcRootKind;

fn command(core: &Core, op: &str, window: &str) -> Value {
    let request =
        serde_json::from_value(json!({"op":op,"window_id":window,"permission":"docs"})).unwrap();
    serde_json::to_value(core.handle(request).unwrap()).unwrap()
}

fn enable_default(core: &Core, folder: &str, access: &str) {
    let mut state = core.inner.state.lock().unwrap();
    let version = state
        .shared
        .app_versions
        .iter_mut()
        .find(|v| v.app_id == "test-md-editor")
        .unwrap();
    let mut value = serde_json::to_value(&version.definition).unwrap();
    value["permissions"][0]["default_folder"] = json!(folder);
    value["permissions"][0]["access"] = json!(access);
    version.definition = serde_json::from_value(value).unwrap();
}

#[test]
fn default_folder_requires_consent_then_persists_for_new_windows() {
    let temp = TempDir::new().unwrap();
    let pictures = temp.path().join("pictures");
    fs::create_dir(&pictures).unwrap();
    fs::write(pictures.join("a.md"), "hello").unwrap();
    fs::create_dir(pictures.join("sub")).unwrap();
    fs::write(pictures.join("sub/b.md"), "nested").unwrap();
    let host = Arc::new(FakeHost::default());
    *host.roots.lock().unwrap() = vec![crate::PcRoot {
        id: "pictures".into(),
        kind: PcRootKind::Known,
        name: "사진".into(),
        path: pictures.clone(),
    }];
    let core = open_core(
        &temp.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "test-md-editor");
    enable_default(&core, "pictures", "read");
    let list = |window: &str| {
        core.handle(CoreRequest::FilesList {
            window_id: window.into(),
            permission: "docs".into(),
            dir: "".into(),
        })
    };
    expect_error(list(&window), ErrorCode::NotGranted);
    expect_error(
        core.handle(CoreRequest::FilesRead {
            window_id: window.clone(),
            permission: "docs".into(),
            path: "a.md".into(),
        }),
        ErrorCode::NotGranted,
    );
    assert_eq!(
        command(&core, "files.prepare_default_folder", &window)["result"]["status"],
        "consent_required"
    );
    assert_eq!(
        command(&core, "files.allow_default_folder", &window)["result"]["status"],
        "ready"
    );
    assert!(
        matches!(list(&window).unwrap(), CoreReply::FilesList { entries } if entries.iter().any(|e| e.name == "a.md"))
    );
    let second = open_window(&core, &desktop, "test-md-editor");
    assert_eq!(
        command(&core, "files.prepare_default_folder", &second)["result"]["status"],
        "ready"
    );
    assert!(list(&second).is_ok());
    assert!(
        matches!(core.handle(CoreRequest::FilesRead { window_id: second.clone(), permission: "docs".into(), path: "a.md".into() }).unwrap(), CoreReply::FilesRead { text, .. } if text == "hello")
    );
    let plan = kaleidoscope_data::SourcePlan::Folder {
        permission: "docs".into(),
        dir: "sub".into(),
        recursive: false,
        extensions: vec![],
    };
    let entries = crate::data_sources::fetch(
        &core.inner,
        &second,
        &plan,
        kaleidoscope_contract::data::SourceFormat::Json,
    )
    .unwrap();
    assert!(entries
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["path"] == "sub/b.md"));
    enable_default(&core, "pictures", "readwrite");
    let third = open_window(&core, &desktop, "test-md-editor");
    assert_eq!(
        command(&core, "files.prepare_default_folder", &third)["result"]["status"],
        "consent_required"
    );
    enable_default(&core, "documents", "read");
    let documents = temp.path().join("documents");
    fs::create_dir(&documents).unwrap();
    host.roots.lock().unwrap().push(crate::PcRoot {
        id: "documents".into(),
        kind: PcRootKind::Known,
        name: "문서".into(),
        path: documents.clone(),
    });
    assert_eq!(
        command(&core, "files.prepare_default_folder", &third)["result"]["status"],
        "consent_required"
    );
    fs::remove_dir(documents).unwrap();
    assert_eq!(
        command(&core, "files.prepare_default_folder", &third)["result"]["status"],
        "unavailable"
    );
    assert_eq!(
        serde_json::to_value(&core.inner.state.lock().unwrap().device).unwrap()
            ["default_folder_access"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn default_grant_survives_restart_and_allows_client_file_open() {
    let temp = TempDir::new().unwrap();
    let data = temp.path().join("data");
    let pictures = temp.path().join("pictures");
    fs::create_dir(&pictures).unwrap();
    fs::write(pictures.join("image.png"), b"image").unwrap();
    let host = Arc::new(FakeHost::default());
    *host.roots.lock().unwrap() = vec![crate::PcRoot {
        id: "pictures".into(),
        kind: PcRootKind::Known,
        name: "사진".into(),
        path: pictures,
    }];
    let definition = json!({"id":"client-folder","name":"파일 시험", "requires":{"blocks":12,"modules":{"assets":1,"client":7,"files":2}},
        "permissions":[{"module":"files","id":"docs","access":"read","label":"문서"}], "state":{},
        "assets":[{"id":"entry","version":1}], "client":{"runtime":"javascript","entry":{"id":"entry","version":1}},
        "ui":{"type":"text","value":"시험"}}).to_string();
    let core = open_core(&data, vec![definition.clone()], &host);
    let (_, desktop) = active_ids(&core);
    let first = open_window(&core, &desktop, "client-folder");
    {
        let mut state = core.inner.state.lock().unwrap();
        let version = state
            .shared
            .app_versions
            .iter_mut()
            .find(|v| v.app_id == "client-folder")
            .unwrap();
        let mut value = serde_json::to_value(&version.definition).unwrap();
        value["permissions"][0]["default_folder"] = json!("pictures");
        version.definition = serde_json::from_value(value).unwrap();
    }
    command(&core, "files.allow_default_folder", &first);
    drop(core);
    let core = open_core(&data, vec![definition], &host);
    let (_, desktop) = active_ids(&core);
    let next = open_window(&core, &desktop, "client-folder");
    {
        let mut state = core.inner.state.lock().unwrap();
        let version = state
            .shared
            .app_versions
            .iter_mut()
            .find(|v| v.app_id == "client-folder")
            .unwrap();
        let mut value = serde_json::to_value(&version.definition).unwrap();
        value["permissions"][0]["default_folder"] = json!("pictures");
        version.definition = serde_json::from_value(value).unwrap();
    }
    assert_eq!(
        command(&core, "files.prepare_default_folder", &next)["result"]["status"],
        "ready"
    );
    let request = serde_json::from_value(
        json!({"op":"client.file_open","window_id":next,"permission":"docs","path":"image.png"}),
    )
    .unwrap();
    let reply = serde_json::to_value(core.handle(request).unwrap()).unwrap();
    assert_eq!(reply["file"]["name"], "image.png");
}

#[test]
fn existing_picker_grant_wins_and_removing_app_clears_consent() {
    let temp = TempDir::new().unwrap();
    let pictures = temp.path().join("pictures");
    let picked = temp.path().join("picked");
    fs::create_dir(&pictures).unwrap();
    fs::create_dir(&picked).unwrap();
    let host = Arc::new(FakeHost::default());
    *host.roots.lock().unwrap() = vec![crate::PcRoot {
        id: "pictures".into(),
        kind: PcRootKind::Known,
        name: "사진".into(),
        path: pictures,
    }];
    host.choose(Some(picked.clone()));
    let core = open_core(
        &temp.path().join("data"),
        vec![test_definition(MD_EDITOR)],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let first = open_window(&core, &desktop, "test-md-editor");
    enable_default(&core, "pictures", "read");
    command(&core, "files.allow_default_folder", &first);
    let second = open_window(&core, &desktop, "test-md-editor");
    pick_folder(&core, &second);
    let ready = command(&core, "files.prepare_default_folder", &second);
    assert_eq!(
        ready["result"]["grant"]["root_path"],
        picked.canonicalize().unwrap().to_string_lossy().as_ref()
    );
    assert_eq!(
        command(&core, "files.allow_default_folder", &second)["result"]["grant"],
        ready["result"]["grant"]
    );
    let mut state = core.inner.state.lock().unwrap();
    crate::app_commands::remove_registry_app(&mut state, "test-md-editor");
    assert!(state.device.default_folder_access.is_empty());
}

#[cfg(unix)]
#[test]
fn default_folder_keeps_existing_path_protections() {
    use std::os::unix::fs::symlink;
    let temp = TempDir::new().unwrap();
    let pictures = temp.path().join("pictures");
    let outside = temp.path().join("outside");
    let data = temp.path().join("data");
    fs::create_dir(&pictures).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret.md"), "secret").unwrap();
    symlink(&outside, pictures.join("link")).unwrap();
    let host = Arc::new(FakeHost::default());
    *host.roots.lock().unwrap() = vec![crate::PcRoot {
        id: "pictures".into(),
        kind: PcRootKind::Known,
        name: "사진".into(),
        path: pictures,
    }];
    let core = open_core(&data, vec![test_definition(MD_EDITOR)], &host);
    let (_, desktop) = active_ids(&core);
    let first = open_window(&core, &desktop, "test-md-editor");
    enable_default(&core, "pictures", "read");
    command(&core, "files.allow_default_folder", &first);
    let error = core
        .handle(CoreRequest::FilesRead {
            window_id: first,
            permission: "docs".into(),
            path: "link/secret.md".into(),
        })
        .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("FILE_PATH_OUTSIDE_ROOT"));
    host.roots.lock().unwrap()[0].path = data;
    let second = open_window(&core, &desktop, "test-md-editor");
    let request = serde_json::from_value(
        json!({"op":"files.prepare_default_folder","window_id":second,"permission":"docs"}),
    )
    .unwrap();
    assert_eq!(
        core.handle(request).unwrap_err().id.as_deref(),
        Some("FILE_PATH_PROTECTED")
    );
}
