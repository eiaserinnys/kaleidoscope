use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::json;

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
