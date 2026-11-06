use kaleidoscope_contract::{validate::parse_app_definition_with_supported, Supported};
use serde_json::{json, Value};

fn app() -> Value {
    json!({"id":"folder-test", "name":"폴더 시험",
        "requires":{"blocks":46,"modules":{"files":4}},
        "permissions":[{"module":"files","id":"docs","access":"read","label":"폴더","default_folder":"pictures"}],
        "state":{}, "ui":{"type":"text","value":"시험"}})
}

fn parse(
    value: &Value,
) -> Result<kaleidoscope_contract::AppDefinition, kaleidoscope_contract::CoreError> {
    let mut supported = Supported::current();
    supported.blocks = 46;
    supported.modules.insert("files".into(), 4);
    parse_app_definition_with_supported(&value.to_string(), &supported)
}

#[test]
fn default_folder_contract_and_version_gates() {
    let original = app();
    assert_eq!(
        serde_json::to_value(parse(&original).unwrap()).unwrap()["permissions"],
        original["permissions"]
    );
    for (field, value, code) in [
        ("scope", json!("pc"), "APP_FILES_DEFAULT_SCOPE_INVALID"),
        ("blocks", json!(45), "APP_FILES_DEFAULT_VERSION_LOW"),
        ("files", json!(3), "APP_FILES_DEFAULT_VERSION_LOW"),
        (
            "default_folder",
            json!("unknown"),
            "APP_DEFINITION_FORMAT_INVALID",
        ),
    ] {
        let mut changed = original.clone();
        match field {
            "blocks" => changed["requires"]["blocks"] = value,
            "files" => changed["requires"]["modules"]["files"] = value,
            _ => changed["permissions"][0][field] = value,
        }
        assert_eq!(
            parse(&changed).unwrap_err().id.as_deref(),
            Some(code),
            "{field}"
        );
    }
    let mut legacy = original;
    legacy["permissions"][0]
        .as_object_mut()
        .unwrap()
        .remove("default_folder");
    legacy["requires"] = json!({"blocks":4,"modules":{"files":1}});
    assert_eq!(
        serde_json::to_value(parse(&legacy).unwrap()).unwrap()["permissions"],
        legacy["permissions"]
    );
}

#[test]
fn known_folder_ids_match_pc_roots() {
    let enum_ids: Vec<_> = kaleidoscope_contract::KnownFolder::ALL
        .iter()
        .map(|folder| folder.as_str())
        .collect();
    let root_ids: Vec<_> = kaleidoscope_contract::PC_KNOWN_FOLDERS
        .iter()
        .map(|(id, _)| *id)
        .collect();
    assert_eq!(enum_ids, root_ids);
    for (id, _) in kaleidoscope_contract::PC_KNOWN_FOLDERS {
        let mut value = app();
        value["permissions"][0]["default_folder"] = json!(id);
        assert!(parse(&value).is_ok(), "{id}");
    }
    assert_eq!(kaleidoscope_contract::PC_KNOWN_FOLDERS.len(), 6);
}
