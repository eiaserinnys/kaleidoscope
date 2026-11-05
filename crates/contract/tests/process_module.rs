use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id":"process-fixture", "name":"프로세스 시험",
        "requires":{"blocks":17,"modules":{"assets":1,"client":3,"process":1}},
        "permissions":[{"module":"process","id":"run","label":"실행"}],
        "assets":[{"id":"client-code","version":1}],
        "client":{"runtime":"javascript","entry":{"id":"client-code","version":1},"process_permissions":["run"]},
        "ui":{"type":"text","value":"시험"}
    })
}

#[test]
fn process_permission_requires_declared_permission_and_versions() {
    let app = definition();
    parse_app_definition(&app.to_string()).expect("선언된 실행 권한은 유효해야 합니다");

    for invalid in [
        {
            let mut value = app.clone();
            value["client"]["process_permissions"] = json!(["missing"]);
            value
        },
        {
            let mut value = app.clone();
            value["requires"]["modules"]["process"] = json!(0);
            value
        },
        {
            let mut value = app.clone();
            value["requires"]["modules"]["client"] = json!(2);
            value
        },
        {
            let mut value = app.clone();
            value["requires"]["blocks"] = json!(16);
            value
        },
    ] {
        assert!(
            parse_app_definition(&invalid.to_string()).is_err(),
            "잘못된 정의: {invalid}"
        );
    }
}

#[test]
fn process_hash_is_stable() {
    use kaleidoscope_contract::process::{spec_hash, ProcessSpec};
    let execution = ProcessSpec {
        name: "이름".into(),
        command: "tool".into(),
        args: vec!["one".into(), "two".into()],
        env: [("B".into(), "2".into()), ("A".into(), "1".into())]
            .into_iter()
            .collect(),
    };
    assert_eq!(
        spec_hash(&execution),
        "3a28a5f291ad35656879ede03b191574fef6d577e32c1e43921ea6885275559a"
    );
}

#[test]
fn command_permission_requires_process_two_and_valid_command() {
    let mut app = definition();
    app["permissions"][0]["command"] = json!("python3");
    assert!(parse_app_definition(&app.to_string()).is_err());
    app["requires"]["modules"]["process"] = json!(2);
    assert!(parse_app_definition(&app.to_string()).is_ok());
    for invalid in ["", " python3", "python3 ", "py\nthon"] {
        app["permissions"][0]["command"] = json!(invalid);
        assert!(parse_app_definition(&app.to_string()).is_err(), "{invalid:?}");
    }
    app["permissions"][0]["command"] = json!("x".repeat(261));
    assert!(parse_app_definition(&app.to_string()).is_err());
}

#[test]
fn command_hash_ignores_name_and_args_but_keeps_environment_and_scope() {
    use kaleidoscope_contract::process::{command_grant_hash, spec_hash, ProcessSpec};
    let spec = ProcessSpec { name: "첫 이름".into(), command: "tool".into(), args: vec!["one".into()], env: Default::default() };
    let hash = command_grant_hash(&spec);
    assert_ne!(hash, spec_hash(&spec));
    let mut changed = spec.clone();
    changed.name = "둘째 이름".into();
    changed.args = vec!["two".into()];
    assert_eq!(hash, command_grant_hash(&changed));
    changed.env.insert("PATH".into(), "/other".into());
    assert_ne!(hash, command_grant_hash(&changed));
}
