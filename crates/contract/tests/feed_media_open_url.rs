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
    let mut old = app(list.clone(), 32); old["state"]["selected"] = Value::Null;
    let error = parse_app_definition(&old.to_string()).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("APP_LIST_ON_REMOVE_VERSION_REQUIRED"));
    assert!(error.message.contains("33판"));
    old["requires"]["blocks"] = json!(33);
    assert!(parse_app_definition(&old.to_string()).is_ok());
    let menu = |binding| json!({"type":"list","items":[],"item_menu":[{"label":"열기","on_select":{"open_url":binding}}]});
    let error = parse_app_definition(&app(menu(json!({"item":"url"})), 32).to_string()).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("APP_OPEN_URL_VERSION_REQUIRED"));
    assert!(error.message.contains("33판"));
    let parsed = parse_app_definition(&app(menu(json!({"item":"url"})), 33).to_string()).expect("항목 주소 열기");
    assert!(data::local_actions(data::all_ui_actions(&parsed)[0].1));
    assert!(parse_app_definition(&app(menu(json!({"expr":"$item.url"})), 33).to_string()).is_err());
    let array = json!({"type":"button", "label":"열기", "icon":"link", "on_click":[{"open_url":"https://example.com"}]});
    let result = parse_app_definition(&app(array, 33).to_string());
    assert!(result.is_err(), "open_url은 배열에 넣을 수 없다: {result:?}");
}

#[test]
fn 지역_동작은_객체로만_읽고_기존_복사를_유지한다() {
    use data::{Actions, Action, CopyTextAction, OpenUrlAction, PickFilesAction, SaveFileAction};
    for binding in [json!("본문"), json!({"item":"title"}), json!(["a", "b"])] {
        let value = json!({"copy_text":binding});
        let single: Actions = serde_json::from_value(value.clone()).unwrap();
        assert!(matches!(single, Actions::CopyText(_)));
        assert_eq!(serde_json::to_value(single).unwrap(), value);
        let many: Actions = serde_json::from_value(json!([value.clone()])).unwrap();
        assert!(matches!(many, Actions::Many(ref actions) if matches!(&actions[0], Action::CopyText(_))));
        assert_eq!(serde_json::to_value(many).unwrap(), json!([value]));
    }
    assert!(serde_json::from_value::<CopyTextAction>(json!(["본문"])).is_err());
    assert!(serde_json::from_value::<OpenUrlAction>(json!(["https://example.com"])).is_err());
    assert!(serde_json::from_value::<PickFilesAction>(json!([{"accept":[],"client":"pick"}])).is_err());
    assert!(serde_json::from_value::<SaveFileAction>(json!([{"suggested_name":"a","mime":"text/plain","client":"save"}])).is_err());
}
