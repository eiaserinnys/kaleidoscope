use kaleidoscope_contract::{
    app_definition_schema, client::DeviceStorageScope, validate::parse_app_definition, CoreReply,
    CoreRequest,
};
use serde_json::{json, Value};

fn definition(blocks: u64, client_module: u64, storage: Value) -> Value {
    json!({
        "id": "window-storage-test",
        "name": "Window storage test",
        "requires": {"blocks": blocks, "modules": {"assets": 1, "client": client_module}},
        "permissions": [],
        "assets": [{"id": "entry", "version": 1}],
        "client": {
            "runtime": "javascript",
            "entry": {"id": "entry", "version": 1},
            "device_storage": storage
        },
        "state": {},
        "ui": {"type": "text", "value": "Storage"}
    })
}

#[test]
fn window_storage_requires_block_set_18_and_client_module_4() {
    let valid = definition(18, 4, json!({"prefixes": ["chat/"], "scope": "window"}));
    let parsed = parse_app_definition(&valid.to_string()).expect("window storage is supported");
    assert_eq!(
        parsed.client.unwrap().device_storage.unwrap().scope,
        DeviceStorageScope::Window
    );

    let old_blocks = parse_app_definition(
        &definition(17, 4, json!({"prefixes": ["chat/"], "scope": "window"})).to_string(),
    )
    .expect_err("window storage needs block set 18");
    assert!(old_blocks
        .details
        .iter()
        .any(|detail| detail.contains("18판")));

    let old_client = parse_app_definition(
        &definition(18, 3, json!({"prefixes": ["chat/"], "scope": "window"})).to_string(),
    )
    .expect_err("window storage needs client module 4");
    assert!(old_client
        .details
        .iter()
        .any(|detail| detail.contains("client") && detail.contains("4")));

    let explicit_app_scope = parse_app_definition(
        &definition(17, 3, json!({"prefixes": ["chat/"], "scope": "app"})).to_string(),
    )
    .expect_err("explicit scope field needs both new versions");
    assert!(explicit_app_scope
        .details
        .iter()
        .any(|detail| detail.contains("18판")));
    assert!(explicit_app_scope
        .details
        .iter()
        .any(|detail| detail.contains("client") && detail.contains("4")));
}

#[test]
fn omitted_scope_preserves_app_scope_and_schema_exports_the_new_field() {
    let parsed =
        parse_app_definition(&definition(14, 2, json!({"prefixes": ["cache/"]})).to_string())
            .expect("omitted scope remains app storage");
    assert_eq!(
        parsed.client.unwrap().device_storage.unwrap().scope,
        DeviceStorageScope::App
    );
    assert!(app_definition_schema().to_string().contains("scope"));
}

#[test]
fn process_file_uri_roundtrips_with_its_wire_name_and_uri() {
    let request = CoreRequest::ProcessFileUri {
        window_id: "window-1".into(),
        blob_key: "chat/한글 file.bin".into(),
    };
    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({
            "op": "process.file_uri",
            "window_id": "window-1",
            "blob_key": "chat/한글 file.bin"
        })
    );

    let reply = CoreReply::ProcessFileUri {
        uri: "file:///data/chat/%ED%95%9C%EA%B8%80%20file.bin".into(),
    };
    assert_eq!(
        serde_json::to_value(reply).unwrap(),
        json!({
            "op": "process.file_uri",
            "uri": "file:///data/chat/%ED%95%9C%EA%B8%80%20file.bin"
        })
    );
}
