use super::*;

#[test]
fn server_binary_has_no_builtin_definition_or_asset_content() {
    if std::env::var_os("KALEIDOSCOPE_EXCLUSION_CHILD").is_some() {
        let state = AppState::open(
            &std::env::current_dir().unwrap().join("registry.db"),
            "test".into(),
        )
        .unwrap();
        assert!(state.current_apps().unwrap().is_empty());
        return;
    }

    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let read_json = |path: &str| -> Value {
        serde_json::from_slice(&std::fs::read(root.join(path)).unwrap()).unwrap()
    };
    let weather = read_json("apps/weather.json");
    let calculator = read_json("apps/calculator.json");
    let agent = read_json("apps/agent.json");
    let market = read_json("apps/market.json");
    let icon = std::fs::read(root.join("apps/assets/weather/clear.svg")).unwrap();
    let sentinels = [
        market["permissions"][1]["base_url"]
            .as_str()
            .unwrap()
            .as_bytes(),
        weather["permissions"][1]["base_url"]
            .as_str()
            .unwrap()
            .as_bytes(),
        weather["sources"]["forecast"]["query"]["current"]
            .as_str()
            .unwrap()
            .as_bytes(),
        calculator["ui"]["children"][0]["items"]["expr"]
            .as_str()
            .unwrap()
            .as_bytes(),
        agent["storage"]["entries"][0]["default"][0]["args"][1]
            .as_str()
            .unwrap()
            .as_bytes(),
        icon.as_slice(),
    ];
    let bytes = std::fs::read(std::env::current_exe().unwrap()).unwrap();
    for sentinel in sentinels {
        assert!(sentinel.len() > 20);
        assert!(!bytes.windows(sentinel.len()).any(|part| part == sentinel));
        for directory in ["crates/orchestrator/src", "crates/contract/src"] {
            for source in std::fs::read_dir(root.join(directory)).unwrap() {
                let path = source.unwrap().path();
                if path.extension().is_some_and(|extension| extension == "rs") {
                    let source = std::fs::read(path).unwrap();
                    assert!(!source.windows(sentinel.len()).any(|part| part == sentinel));
                }
            }
        }
    }

    let dir = tempfile::tempdir().unwrap();
    let executable = dir.path().join("server-test");
    std::fs::copy(std::env::current_exe().unwrap(), &executable).unwrap();
    let status = std::process::Command::new(executable)
        .current_dir(dir.path())
        .env("KALEIDOSCOPE_EXCLUSION_CHILD", "1")
        .args([
            "--exact",
            "server_exclusion_tests::server_binary_has_no_builtin_definition_or_asset_content",
        ])
        .status()
        .unwrap();
    assert!(status.success());
}
