use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id":"process-fixture", "name":"프로세스 시험",
        "requires":{"blocks":16,"modules":{"assets":1,"client":3,"process":1}},
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
            value["permissions"][0]["module"] = json!("local_agent");
            value["requires"]["modules"]["local_agent"] = json!(1);
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
            value["requires"]["blocks"] = json!(15);
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
fn process_hash_preserves_existing_agent_hash() {
    use kaleidoscope_contract::{
        local_agent::{agent_spec_hash, AgentSpec},
        process::{spec_hash, ProcessSpec},
    };
    let execution = ProcessSpec {
        name: "이름".into(),
        command: "tool".into(),
        args: vec!["one".into(), "two".into()],
        env: [("B".into(), "2".into()), ("A".into(), "1".into())]
            .into_iter()
            .collect(),
    };
    let agent = AgentSpec {
        id: "old".into(),
        name: execution.name.clone(),
        command: execution.command.clone(),
        args: execution.args.clone(),
        env: execution.env.clone(),
        auth_methods: Some(vec!["ignored".into()]),
    };
    assert_eq!(
        agent_spec_hash(&agent),
        "3a28a5f291ad35656879ede03b191574fef6d577e32c1e43921ea6885275559a"
    );
    assert_eq!(spec_hash(&execution), agent_spec_hash(&agent));
}
