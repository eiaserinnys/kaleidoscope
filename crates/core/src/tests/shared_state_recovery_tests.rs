use super::*;

const LEGACY_STATE: &str = include_str!("fixtures/legacy-agent-shared-state.json");

#[test]
fn startup_skips_only_the_unreadable_saved_app_version() {
    let temp = TempDir::new().unwrap();
    let state_path = temp.path().join("state.json");
    fs::write(&state_path, LEGACY_STATE).unwrap();

    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    let shared = snapshot(&core).shared;

    let agent = shared
        .windows
        .iter()
        .find(|window| window.id == "agent-window")
        .unwrap();
    let builtin_agent = crate::builtin::builtin_app("agent").unwrap();
    assert_eq!(agent.app_version, builtin_agent.version.version);

    let other = shared
        .windows
        .iter()
        .find(|window| window.id == "other-window")
        .unwrap();
    assert_eq!(other.app_id, "test-md-editor");
    assert_eq!(other.app_version, 1);
    let private = shared
        .windows
        .iter()
        .find(|window| window.id == "private-window")
        .unwrap();
    assert_eq!(private.app_id, "test-private");
    assert_eq!(private.app_version, 1);
    let private_app = shared
        .apps
        .iter()
        .find(|app| app.id == "test-private")
        .unwrap();
    assert_eq!(private_app.current_version, 1);
    assert_eq!(shared.workspaces[0].name, "보존할 작업");
    assert_eq!(shared.desktops[0].name, "보존할 화면");
    assert!(shared
        .app_versions
        .iter()
        .any(|version| version.app_id == "test-md-editor" && version.version == 1));

    assert!(state_path.exists());
    assert!(!fs::read_dir(temp.path()).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("state.json.broken-")
    }));
}

#[test]
fn startup_continues_when_legacy_agent_data_removal_fails() {
    let temp = TempDir::new().unwrap();
    let legacy = temp.path().join("local-agent");
    fs::write(&legacy, "a file prevents remove_dir_all").unwrap();

    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));

    assert!(matches!(
        core.handle(CoreRequest::StateGet {}),
        Ok(CoreReply::StateGet { .. })
    ));
    assert!(legacy.is_file());
}
