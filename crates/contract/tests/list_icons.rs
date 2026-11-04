use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::json;
const N: u32 = kaleidoscope_contract::LIST_ICONS_BLOCK_SET_VERSION;

#[test]
fn icon_layout_requires_its_block_set_and_round_trips() {
    let mut app = json!({
        "id": "test-list-icons", "name": "목록",
        "requires": {"blocks": N, "modules": {}}, "permissions": [],
        "ui": {"type": "list", "layout": "icons", "items": []}
    });
    let parsed = parse_app_definition(&app.to_string()).expect("아이콘 배치를 읽는다");
    assert_eq!(serde_json::to_value(parsed).unwrap()["ui"]["layout"], "icons");
    app["requires"]["blocks"] = json!(N - 1);
    assert!(parse_app_definition(&app.to_string()).is_err());
    app["ui"]["layout"] = json!("rows");
    assert!(parse_app_definition(&app.to_string()).is_ok());
    app["ui"]["layout"] = json!("grid");
    assert!(parse_app_definition(&app.to_string()).is_ok());
}
