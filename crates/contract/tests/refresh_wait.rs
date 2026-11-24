use kaleidoscope_contract::{
    app_definition_schema, validate::parse_app_definition, BLOCK_SET_VERSION,
    REFRESH_WAIT_BLOCK_SET_VERSION,
};
use serde_json::{json, Value};

fn definition(blocks: u32, refresh: Value) -> Value {
    json!({
        "id": "refresh-wait-test",
        "name": "다시 받기 기다림 시험",
        "requires": {"blocks": blocks, "modules": {"files": 1}},
        "permissions": [{"module": "files", "id": "file", "label": "파일", "access": "read"}],
        "state": {},
        "sources": {"item": {"kind": "file", "permission": "file", "path": "a.json"}},
        "ui": {"type": "button", "label": "받기", "on_click": [refresh]}
    })
}

#[test]
fn refresh_wait_is_block_set_69_and_round_trips() {
    assert_eq!(REFRESH_WAIT_BLOCK_SET_VERSION, 69);
    assert!(BLOCK_SET_VERSION >= REFRESH_WAIT_BLOCK_SET_VERSION);

    let refresh = json!({"refresh": ["item"], "wait": false});
    let app = parse_app_definition(&definition(69, refresh.clone()).to_string())
        .expect("블록 세트 69판은 refresh.wait를 받는다");
    assert_eq!(serde_json::to_value(&app).unwrap()["ui"]["on_click"][0], refresh);

    let old = parse_app_definition(&definition(68, refresh).to_string())
        .expect_err("refresh.wait는 블록 세트 69판이 필요하다");
    assert!(
        old.details.iter().any(|detail| detail.contains("wait") && detail.contains("69")),
        "{old:?}"
    );
    // 참으로 적어도 칸이 있으면 같은 판이 필요하다.
    assert!(parse_app_definition(
        &definition(68, json!({"refresh": ["item"], "wait": true})).to_string()
    )
    .is_err());
    assert!(app_definition_schema().to_string().contains("\"wait\""));
}

#[test]
fn refresh_without_wait_keeps_its_old_block_set_and_wire_shape() {
    let app = parse_app_definition(&definition(4, json!({"refresh": ["item"]})).to_string())
        .expect("wait가 없으면 낮은 판도 받는다");
    assert_eq!(
        serde_json::to_value(&app).unwrap()["ui"]["on_click"][0],
        json!({"refresh": ["item"]})
    );
}
