use kaleidoscope_contract::{validate::parse_app_definition, CoreRequest, Supported};
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id":"live-fixture", "name":"실시간 시험",
        "requires":{"blocks":23,"modules":{"assets":1,"client":5,"connection":3}},
        "permissions":[{"module":"connection","id":"live","label":"연결","connection":"example","access":"readwrite"}],
        "assets":[{"id":"script","version":1}],
        "client":{"runtime":"javascript","entry":{"id":"script","version":1},"realtime_permissions":["live"]},
        "ui":{"type":"text","value":"시험"}
    })
}

#[test]
fn 실시간_권한은_선언과_판과_쓰기_권한을_요구한다() {
    let valid = definition();
    parse_app_definition(&valid.to_string()).expect("올바른 실시간 선언");
    for invalid in [
        {
            let mut v = valid.clone();
            v["requires"]["blocks"] = json!(22);
            v
        },
        {
            let mut v = valid.clone();
            v["requires"]["modules"]["client"] = json!(4);
            v
        },
        {
            let mut v = valid.clone();
            v["requires"]["modules"]["connection"] = json!(2);
            v
        },
        {
            let mut v = valid.clone();
            v["client"]["realtime_permissions"] = json!(["live", "live"]);
            v
        },
        {
            let mut v = valid.clone();
            v["client"]["realtime_permissions"] = json!(["missing"]);
            v
        },
        {
            let mut v = valid.clone();
            v["permissions"][0]["access"] = json!("read");
            v
        },
    ] {
        assert!(
            parse_app_definition(&invalid.to_string()).is_err(),
            "잘못된 선언: {invalid}"
        );
    }
}

#[test]
fn 종류와_이전_쉘_지원_여부를_구분한다() {
    let app = parse_app_definition(&definition().to_string()).unwrap();
    let mut old = Supported::current();
    old.blocks = 22;
    old.modules.insert("client".into(), 4);
    old.modules.insert("connection".into(), 2);
    assert!(!old.renders(&app.requires));
    assert!(Supported::current().renders(&app.requires));
    let request = json!({"op":"connection.realtime.open", "window_id":"w", "session":"s", "permission":"live", "kind":"websocket", "path":"/socket", "protocols":[]});
    assert!(serde_json::from_value::<CoreRequest>(request.clone()).is_ok());
    let mut invalid = request;
    invalid["kind"] = json!("sse");
    assert!(serde_json::from_value::<CoreRequest>(invalid).is_err());
}

#[test]
fn 실시간_명령의_선택_필드는_생성된_타입에서도_생략할_수_있다() {
    let close = json!({"op":"connection.realtime.close", "window_id":"w", "session":"s", "handle":"h"});
    assert!(serde_json::from_value::<CoreRequest>(close).is_ok());
    let generated = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../ui/src/contract/contract.ts")).unwrap();
    let request = generated.lines().find(|line| line.starts_with("export type CoreRequest =")).unwrap();
    let open = request.split("\"op\": \"connection.realtime.open\",").nth(1).unwrap().split('}').next().unwrap();
    let close = request.split("\"op\": \"connection.realtime.close\",").nth(1).unwrap().split('}').next().unwrap();
    assert!(open.contains("protocols?: Array<string>"), "{open}");
    assert!(close.contains("code?: number") && close.contains("reason?: string"), "{close}");
}
