use kaleidoscope_contract::{
    app_upgrade::{asset_version_conflicts, storage_upgrade_problems, AssetVersionBytes},
    AppDefinition,
};
use serde_json::{json, Value};

fn app(storage: Value) -> AppDefinition {
    serde_json::from_value(json!({
        "id": "sample",
        "name": "시험",
        "requires": {"blocks": 6, "modules": {"storage": 1}},
        "ui": {"type": "text", "value": "안녕"},
        "storage": storage,
    }))
    .unwrap()
}

fn entry(id: &str, value_type: Value) -> Value {
    json!({
        "id": id,
        "key": format!("settings/{id}"),
        "kind": "json",
        "schema": {"type": value_type},
        "default": null,
        "label": id,
        "presentation": "settings",
    })
}

fn asset(id: &str, version: u32, bytes: &[u8]) -> AssetVersionBytes {
    AssetVersionBytes {
        id: id.into(),
        version,
        bytes: bytes.to_vec(),
    }
}

#[test]
fn storage_check_allows_widening_to_sibling_types() {
    let previous = app(json!({"entries": [entry("collection", json!("string"))]}));
    let widened = app(json!({"entries": [entry("collection", json!(["string", "null"]))]}));
    assert!(storage_upgrade_problems(&previous, &widened).is_empty());
}

#[test]
fn storage_check_rejects_narrowing_and_replacement() {
    let previous = app(json!({"entries": [entry("collection", json!(["string", "null"]))]}));
    let narrowed = app(json!({"entries": [entry("collection", json!("string"))]}));
    let problems = storage_upgrade_problems(&previous, &narrowed);
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(problems[0].contains("collection"), "{problems:?}");

    let previous = app(json!({"entries": [entry("title", json!("string"))]}));
    let replaced = app(json!({"entries": [entry("title", json!("number"))]}));
    assert!(!storage_upgrade_problems(&previous, &replaced).is_empty());
}

#[test]
fn storage_check_treats_a_missing_declaration_as_empty() {
    let none = app(json!(null));
    let with_entry = app(json!({"entries": [entry("title", json!("string"))]}));
    assert!(storage_upgrade_problems(&none, &none).is_empty());
    assert!(storage_upgrade_problems(&none, &with_entry).is_empty());
    assert!(storage_upgrade_problems(&with_entry, &none).is_empty());
}

#[test]
fn asset_check_flags_same_version_with_different_bytes() {
    let previous = vec![asset("todo-client", 4, b"old"), asset("icon", 1, b"same")];
    let next = vec![asset("todo-client", 4, b"new"), asset("icon", 1, b"same")];
    let conflicts = asset_version_conflicts(&previous, &next);
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].id, "todo-client");
    assert_eq!(conflicts[0].version, 4);
}

#[test]
fn asset_check_ignores_new_versions_and_one_sided_assets() {
    let previous = vec![asset("todo-client", 4, b"old"), asset("gone", 1, b"gone")];
    let next = vec![asset("todo-client", 5, b"old"), asset("added", 1, b"new")];
    assert!(asset_version_conflicts(&previous, &next).is_empty());
}
