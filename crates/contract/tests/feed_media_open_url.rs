use kaleidoscope_contract::{data::{self, FeedEntry}, validate::parse_app_definition};
use serde_json::{json, Value};

fn app(ui: Value, blocks: u32) -> Value {
    json!({"id":"feed-test", "name":"피드 시험", "requires":{"blocks":blocks,"modules":{}}, "permissions":[], "state":{}, "ui":ui})
}

#[test]
fn feed_media_and_link_round_trip() {
    let value = json!({"key":"a","body":"본문","media":[{"image":{"asset":"photo"},"kind":"video","alt":"사진"}],"link":"https://example.com"});
    let parsed: FeedEntry = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap()["media"], value["media"]);
    assert_eq!(serde_json::to_value(serde_json::from_value::<FeedEntry>(value.clone()).unwrap()).unwrap()["link"], value["link"]);
    let old = app(json!({"type":"feed", "entries":[value]}), 27);
    assert!(parse_app_definition(&old.to_string()).is_ok(), "피드 데이터 필드는 판을 제한하지 않는다");
}

#[test]
fn list_remove_and_open_url_require_new_version_and_menu_item_binding() {
    let list = json!({"type":"list","items":[],"on_remove":{"set_state":"selected"}});
    let mut old = app(list.clone(), 29); old["state"]["selected"] = Value::Null;
    assert_eq!(parse_app_definition(&old.to_string()).unwrap_err().id.as_deref(), Some("APP_LIST_ON_REMOVE_VERSION_REQUIRED"));
    old["requires"]["blocks"] = json!(30);
    assert!(parse_app_definition(&old.to_string()).is_ok());
    let menu = |binding| json!({"type":"list","items":[],"item_menu":[{"label":"열기","on_select":{"open_url":binding}}]});
    assert_eq!(parse_app_definition(&app(menu(json!({"item":"url"})), 29).to_string()).unwrap_err().id.as_deref(), Some("APP_OPEN_URL_VERSION_REQUIRED"));
    let parsed = parse_app_definition(&app(menu(json!({"item":"url"})), 30).to_string()).expect("항목 주소 열기");
    assert!(data::local_actions(data::all_ui_actions(&parsed)[0].1));
    assert!(parse_app_definition(&app(menu(json!({"expr":"$item.url"})), 30).to_string()).is_err());
    let array = json!({"type":"button", "label":"열기", "icon":"link", "on_click":[{"open_url":"https://example.com"}]});
    let result = parse_app_definition(&app(array, 30).to_string());
    assert!(result.is_err(), "open_url은 배열에 넣을 수 없다: {result:?}");
}
