use kaleidoscope_contract::{app_definition_schema, data, validate::parse_app_definition};
use serde_json::{json, Value};

fn definition(blocks: u64) -> Value {
    json!({
        "id": "settings-window-title-test",
        "name": "Settings window title test",
        "requires": {"blocks": blocks, "modules": {"assets": 1, "client": 4}},
        "permissions": [],
        "state": {},
        "assets": [{"id": "settings-window-title-test", "version": 1}],
        "client": {
            "runtime": "javascript",
            "entry": {"id": "settings-window-title-test", "version": 1},
            "inputs": {},
            "outputs": {
                "available": {"default": true},
                "title": {"default": "Window title"},
                "meta": {"default": "Window meta"},
                "settings": {"default": "Settings body"}
            },
            "channels": [],
            "actions": ["choose"],
            "commands": {},
            "state_keys": [],
            "storage_entries": []
        },
        "settings": {
            "available": {"client": "available"},
            "ui": {
                "type": "stack",
                "direction": "column",
                "children": [
                    {"type": "text", "value": {"client": "settings"}},
                    {"type": "button", "label": "Choose", "on_click": {"client": "choose"}}
                ]
            }
        },
        "window_title": {
            "title": {"client": "title"},
            "meta": {"client": "meta"}
        },
        "ui": {"type": "text", "value": "Body"}
    })
}

#[test]
fn settings_ui_and_window_title_bindings_and_actions_are_collected_at_their_definition_pointers() {
    let app =
        parse_app_definition(&definition(19).to_string()).expect("settings and title bindings");
    let bindings = data::all_ui_bindings(&app);
    for pointer in [
        "/settings/available",
        "/settings/ui/children/0/value",
        "/window_title/title",
        "/window_title/meta",
    ] {
        assert!(
            bindings.iter().any(|(candidate, _)| candidate == pointer),
            "missing {pointer}"
        );
    }
    let actions = data::all_ui_actions(&app);
    assert!(actions
        .iter()
        .any(|(pointer, _)| pointer == "/settings/ui/children/1/on_click"));
}

#[test]
fn settings_and_window_title_fields_require_block_set_19() {
    for field in ["settings", "window_title"] {
        let mut value = definition(18);
        value.as_object_mut().unwrap().remove(field);
        let error = match parse_app_definition(&value.to_string()) {
            Err(error) => error,
            Ok(_) => panic!("{field} must require block set 19"),
        };
        assert!(
            error.details.iter().any(|detail| detail.contains("19판")),
            "{field}: {error:?}"
        );
    }
    parse_app_definition(&definition(19).to_string()).expect("block set 19 supports new fields");
}

#[test]
fn settings_and_window_title_bindings_and_actions_are_validated() {
    let mut invalid_binding = definition(19);
    invalid_binding["settings"]["available"] = json!({"client": "missing"});
    let error =
        parse_app_definition(&invalid_binding.to_string()).expect_err("unknown output must fail");
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("/settings/available")),
        "{error:?}"
    );

    let mut invalid_action = definition(19);
    invalid_action["settings"]["ui"]["children"][1]["on_click"] = json!({"client": "missing"});
    let error =
        parse_app_definition(&invalid_action.to_string()).expect_err("unknown action must fail");
    assert!(
        error
            .details
            .iter()
            .any(|detail| detail.contains("/settings/ui/children/1/on_click")),
        "{error:?}"
    );
}

#[test]
fn app_definition_schema_exposes_settings_and_window_title() {
    let schema = app_definition_schema().to_string();
    assert!(schema.contains("window_title"));
    assert!(schema.contains("settings"));
    assert!(schema.contains("available"));
}

#[test]
fn settings_e2e_fixtures_are_valid_app_definitions() {
    for (name, raw) in [
        (
            "settings tree",
            include_str!("../../../ui/e2e/fixtures/settings-tree/app.json"),
        ),
        (
            "storage settings",
            include_str!("../../../ui/e2e/fixtures/settings-tree/storage-settings.json"),
        ),
    ] {
        parse_app_definition(raw).unwrap_or_else(|error| panic!("{name}: {error:?}"));
    }
}
