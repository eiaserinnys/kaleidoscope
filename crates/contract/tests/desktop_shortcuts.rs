use kaleidoscope_contract::{registry::LayoutChanges, CoreRequest, SharedState};
use serde_json::json;

#[test]
fn desktop_shortcut_contract_reads_old_state_and_new_commands() {
    let old: SharedState = serde_json::from_value(json!({
        "apps": [], "app_versions": [], "workspaces": [], "desktops": [], "windows": []
    })).unwrap();
    assert!(serde_json::to_value(old).unwrap().get("desktop_shortcuts").is_none());
    let changes: LayoutChanges = serde_json::from_value(json!({
        "desktop_shortcuts": [{"id":"d/app", "desktop_id":"d", "app_id":"app", "column":0, "row":0, "created_at":"now", "updated_at":"now"}]
    })).unwrap();
    assert_eq!(serde_json::to_value(changes).unwrap()["desktop_shortcuts"][0]["id"], "d/app");
    assert!(serde_json::from_value::<LayoutChanges>(json!({
        "desktop_shortcuts": [{"id":"wrong", "desktop_id":"d", "app_id":"app", "column":0, "row":0, "created_at":"now", "updated_at":"now"}]
    })).is_err());
    let _: CoreRequest = serde_json::from_value(json!({"op":"desktop.shortcut.add", "desktop_id":"d", "app_id":"app"})).unwrap();
}
