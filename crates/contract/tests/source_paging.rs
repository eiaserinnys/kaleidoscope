use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id":"paging-test", "name":"쪽 넘김 시험", "requires":{"blocks":21,"modules":{"http":1}},
        "permissions":[{"module":"http","id":"api","label":"API","base_url":"https://example.com","paths":["/items"]}],
        "state":{},
        "sources":{"items":{"kind":"request","permission":"api","path":"/items","refresh_secs":30,
            "page":{"param":"cursor","next":"nextCursor","items":"data.items"}}},
        "ui":{"type":"text","value":{"expr":"$data.items.data.items"}}
    })
}

#[test]
fn page_decl_is_versioned_and_round_trips() {
    let app = parse_app_definition(&definition().to_string()).expect("21판 원천의 page 선언");
    let result = serde_json::to_value(&app).unwrap();
    assert_eq!(result["sources"]["items"]["page"], definition()["sources"]["items"]["page"]);
    let mut old = definition();
    old["requires"]["blocks"] = json!(20);
    assert!(parse_app_definition(&old.to_string()).is_err());
}

#[test]
fn page_decl_rejects_invalid_fields() {
    parse_app_definition(&definition().to_string()).expect("유효한 page 선언부터 받는다");
    let cases = [
        ("param", json!("")),
        ("items", json!("data..items")),
        ("items", json!(".items")),
        ("items", json!("items.")),
        ("next", json!("(")),
    ];
    for (field, value) in cases {
        let mut app = definition();
        app["sources"]["items"]["page"][field] = value;
        assert!(parse_app_definition(&app.to_string()).is_err(), "{field}: {app}");
    }
    let mut duplicate = definition();
    duplicate["sources"]["items"]["query"] = json!({"cursor":"existing"});
    assert!(parse_app_definition(&duplicate.to_string()).is_err());
}
