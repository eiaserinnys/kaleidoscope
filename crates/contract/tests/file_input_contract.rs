use kaleidoscope_contract::{validate::parse_app_definition_with_supported, Supported};
use serde_json::{json, Value};

fn app() -> Value {
    json!({"id":"file-input-test","name":"파일 입력 시험",
        "requires":{"blocks":41,"modules":{"assets":1,"client":7}},
        "permissions":[],"state":{},"assets":[{"id":"entry","version":1}],
        "client":{"runtime":"javascript","entry":{"id":"entry","version":1},"actions":["load"]},
        "file_drop":{"accept":[{"mime":"image/*","extensions":["png"]}],"multiple":false,"client":"load"},
        "ui":{"type":"text","value":"시험"}})
}

fn parse(
    value: &Value,
) -> Result<kaleidoscope_contract::AppDefinition, kaleidoscope_contract::CoreError> {
    let mut supported = Supported::current();
    supported.blocks = 41;
    supported.modules.insert("client".into(), 7);
    parse_app_definition_with_supported(&value.to_string(), &supported)
}

#[test]
fn file_drop_validates_versions_and_client_action() {
    let original = app();
    let parsed = parse(&original).unwrap();
    assert_eq!(
        serde_json::to_value(parsed).unwrap()["file_drop"],
        original["file_drop"]
    );
    for (change, code) in [
        ("blocks", "APP_FILE_DROP_BLOCK_SET_VERSION_LOW"),
        ("version", "APP_FILE_DROP_CLIENT_VERSION_LOW"),
        ("client", "APP_FILE_DROP_CLIENT_REQUIRED"),
        ("action", "APP_FILE_DROP_ACTION_UNDECLARED"),
    ] {
        let mut value = original.clone();
        match change {
            "blocks" => value["requires"]["blocks"] = json!(40),
            "version" => value["requires"]["modules"]["client"] = json!(6),
            "client" => {
                value.as_object_mut().unwrap().remove("client");
            }
            _ => value["file_drop"]["client"] = json!("missing"),
        }
        assert_eq!(
            parse(&value).unwrap_err().id.as_deref(),
            Some(code),
            "{change}"
        );
    }
}

#[test]
fn legacy_and_accept_deserialization_keep_existing_contract() {
    let mut value = app();
    value.as_object_mut().unwrap().remove("file_drop");
    value["requires"] = json!({"blocks":12,"modules":{"assets":1,"client":1}});
    let encoded = serde_json::to_value(parse(&value).unwrap()).unwrap();
    assert!(encoded.get("file_drop").is_none());
    let mut value = app();
    value["file_drop"]["accept"] = json!([{"mime":"자유 문자열","extensions":["임의 값"]}]);
    assert!(parse(&value).is_ok());
    value["file_drop"]["accept"] = json!([{"mime":123}]);
    assert_eq!(
        parse(&value).unwrap_err().id.as_deref(),
        Some("APP_DEFINITION_FORMAT_INVALID")
    );
}

#[test]
fn file_drop_rejection_codes_are_registered_for_the_shell() {
    let codes: Vec<_> = kaleidoscope_contract::errors::all()
        .map(|entry| entry.id)
        .collect();
    for id in [
        "SHELL_FILE_DROP_TYPE_REJECTED",
        "SHELL_FILE_DROP_MULTIPLE_REJECTED",
        "SHELL_FILE_DROP_DIRECTORY_REJECTED",
        "SHELL_FILE_DROP_TOO_LARGE",
    ] {
        assert!(codes.contains(&id), "{id}");
    }
}

#[test]
fn file_open_request_and_reply_round_trip() {
    let request =
        json!({"op":"client.file_open","window_id":"창","permission":"docs","path":"그림.png"});
    let reply = json!({"op":"client.file_open","file":{"id":"file","name":"그림.png","size":3,"mime":"image/png"}});
    let parsed: kaleidoscope_contract::CoreRequest =
        serde_json::from_value(request.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), request);
    let parsed: kaleidoscope_contract::CoreReply = serde_json::from_value(reply.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), reply);
}
