use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::json;

#[test]
fn public_http_paths_match_exact_values_or_safe_trailing_prefixes() {
    use kaleidoscope_contract::validate::allowed_public_http_path;
    let paths = vec![
        "/api/v1/items/".to_string(),
        "/repos/".to_string(),
        "/exact".to_string(),
    ];
    for path in ["/api/v1/items/42001234", "/repos/torvalds/linux", "/exact"] {
        assert!(allowed_public_http_path(&paths, path), "{path}");
    }
    for path in [
        "/api/v1/items",
        "/api/v1/items/../secret",
        "/api/v1/items/%2e%2e/secret",
        "/api/v1/items//123",
        "/api/v1/items/%2fsecret",
        "/api/v1/items/%25secret",
        "/api/v1/items/a b",
        "/api/v1/items/a?b=c",
        "/api/v1/items/a#b",
    ] {
        assert!(!allowed_public_http_path(&paths, path), "{path}");
    }
    assert!(!allowed_public_http_path(
        &["/api/v1/items".to_string()],
        "/api/v1/items/123"
    ));
}

#[test]
fn feed_thread_alias_and_new_fields_parse_and_collapsible_requires_block_ten() {
    use kaleidoscope_contract::{data::FeedEntry, validate::parse_app_definition};
    let entry: FeedEntry = serde_json::from_value(json!({
        "key":"root", "name":"작성자", "badges":[{"text":"답글 1"}], "depth":0,
        "body":"본문", "children":[{"key":"reply", "body":"답글", "depth":1}]
    }))
    .unwrap();
    assert_eq!(entry.children.len(), 1);
    assert_eq!(entry.depth, Some(0));
    assert_eq!(
        serde_json::to_value(entry).unwrap()["children"][0]["key"],
        "reply"
    );

    let app = |blocks, kind| {
        json!({
            "id":"thread-test", "name":"스레드 시험", "requires":{"blocks":blocks,"modules":{}},
            "permissions":[], "ui":{"type":kind,"entries":[],"collapsible":true}
        })
    };
    assert!(parse_app_definition(&app(9, "feed").to_string()).is_err());
    assert!(parse_app_definition(&app(10, "feed").to_string()).is_ok());
    assert!(parse_app_definition(&app(10, "thread").to_string()).is_ok());
}

#[test]
fn public_http_permission_accepts_only_public_https_origin_and_normalized_paths() {
    let mut app = json!({"id":"http-test", "name":"HTTP 시험", "requires":{"blocks":4,"modules":{"http":1}},
        "permissions":[{"module":"http","id":"api","label":"API", "base_url":"https://example.com", "paths":["/v1/data"]}],
        "sources":{"sample":{"kind":"request","permission":"api","path":"/v1/data"}},
        "ui":{"type":"text","value":{"expr":"$data.sample"}}});
    assert!(parse_app_definition(&app.to_string()).is_ok());
    for origin in [
        "http://example.com",
        "https://127.0.0.1",
        "https://localhost",
        "https://example.com:8443",
        "https://example.com/path",
    ] {
        app["permissions"][0]["base_url"] = json!(origin);
        assert!(parse_app_definition(&app.to_string()).is_err(), "{origin}");
    }
    app["permissions"][0]["base_url"] = json!("https://example.com");
    for path in ["/a/../b", "/a//b", "/a/%2e%2e/b", "/a\\b"] {
        app["permissions"][0]["paths"] = json!([path]);
        assert!(parse_app_definition(&app.to_string()).is_err(), "{path}");
    }
}
