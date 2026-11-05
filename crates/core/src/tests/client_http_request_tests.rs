use super::*;

fn packet(value: Value, body: &[u8]) -> Vec<u8> {
    let meta = serde_json::to_vec(&value).unwrap();
    let mut packet = (meta.len() as u32).to_be_bytes().to_vec();
    packet.extend(meta);
    packet.extend(body);
    packet
}

#[test]
fn binary_response_metadata_and_payload_roundtrip() {
    let response = kaleidoscope_data::public_http::PublicResponse { status: 412, headers: BTreeMap::from([("etag".into(), "v1".into())]), mime: "text/plain".into(), bytes: vec![1, 2], rate_limit: None, retry_after: None };
    let packet = crate::client_http::encode_response(response);
    let size = u32::from_be_bytes(packet[..4].try_into().unwrap()) as usize;
    let metadata: Value = serde_json::from_slice(&packet[4..4 + size]).unwrap();
    assert_eq!(metadata, json!({"status":412,"headers":{"etag":"v1"},"mime":"text/plain"}));
    assert_eq!(&packet[4 + size..], &[1, 2]);
}

#[test]
fn request_rejects_missing_permissions_version_unsafe_headers_and_body() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let definition = json!({"id":"http-fixture", "name":"HTTP 시험", "requires":{"blocks":17,"modules":{"assets":1,"client":2,"http":3}},
        "permissions":[{"module":"http","id":"net","label":"웹","base_url":"https://example.com","paths":["/"],"access":"readwrite"}, {"module":"http","id":"read","label":"읽기","base_url":"https://example.com","paths":["/"]}],
        "assets":[{"id":"client-code","version":1}], "client":{"runtime":"javascript","entry":{"id":"client-code","version":1},"http_permissions":["net","read"]}, "ui":{"type":"text","value":"시험"}});
    let core = open_core(temp.path(), vec![definition.to_string()], &host);
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "http-fixture");
    let meta = json!({"permission":"net","method":"PUT","path":"/item","query":{},"headers":{}});
    let call = |value: &Value, body: &[u8]| core.client_binary("client.http_request", &window, "", &packet(value.clone(), body)).unwrap_err().id.unwrap();
    let mut value = meta.clone(); value["permission"] = json!("other");
    assert_eq!(call(&value, &[]), "DATA_CLIENT_HTTP_REQUEST_CLIENT_PERMISSION_DENIED");
    value["permission"] = json!("read");
    assert_eq!(call(&value, &[]), "DATA_CLIENT_HTTP_REQUEST_WRITE_DENIED");
    value = meta.clone(); value["method"] = json!("GET");
    assert_eq!(call(&value, b"x"), "DATA_CLIENT_HTTP_REQUEST_GET_BODY");
    for name in ["Authorization", "cookie", "Host", "sec-fetch-mode", "proxy-foo"] {
        value = meta.clone(); value["headers"] = Value::Object([(name.to_string(), json!("value"))].into_iter().collect());
        assert_eq!(call(&value, &[]), "DATA_CLIENT_HTTP_REQUEST_HEADER_FORBIDDEN", "{name}");
    }
    for (name, header_value) in [("X-HTTP-Method-Override", "TRACE"), ("x-method-override", "get, Connect"), ("X-HTTP-Method", "track")] {
        value = meta.clone(); value["headers"] = Value::Object([(name.to_string(), json!(header_value))].into_iter().collect());
        assert_eq!(call(&value, &[]), "DATA_CLIENT_HTTP_REQUEST_HEADER_FORBIDDEN", "{name}: {header_value}");
    }
    value = meta.clone(); value["path"] = json!("/item?invalid"); value["headers"] = json!({"X-HTTP-Method-Override":"PATCH"});
    assert_eq!(call(&value, &[]), "DATA_CLIENT_HTTP_REQUEST_ADDRESS_INVALID");
    value = meta.clone(); value["headers"] = Value::Object((0..33).map(|n| (format!("x-{n}"), json!("v"))).collect());
    assert_eq!(call(&value, &[]), "DATA_CLIENT_HTTP_REQUEST_HEADERS_TOO_MANY");
    value = meta.clone(); value["headers"] = json!({"bad header":"x"});
    assert_eq!(call(&value, &[]), "DATA_CLIENT_HTTP_REQUEST_HEADER_NAME_INVALID");
    value = meta.clone(); value["headers"] = json!({"x-value":"bad\nvalue"});
    assert_eq!(call(&value, &[]), "DATA_CLIENT_HTTP_REQUEST_HEADER_VALUE_INVALID");
    value = meta.clone(); value["headers"] = json!({"x-value":"x".repeat(8193)});
    assert_eq!(call(&value, &[]), "DATA_CLIENT_HTTP_REQUEST_HEADER_VALUE_TOO_LARGE");
    assert_eq!(call(&meta, &vec![0; kaleidoscope_contract::data::SOURCE_MAX_BYTES as usize + 1]), "DATA_CLIENT_HTTP_REQUEST_BODY_TOO_LARGE");
    value = meta.clone(); value["path"] = json!("/item?secret=value");
    let error = core.client_binary("client.http_request", &window, "", &packet(value, &[])).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("DATA_CLIENT_HTTP_REQUEST_ADDRESS_INVALID"));
    assert!(!error.message.contains("secret"));
    {
        let mut state = core.inner.state.lock().unwrap();
        let version = state.shared.app_versions.iter_mut().find(|v| v.app_id == "http-fixture").unwrap();
        version.definition.requires.modules.insert("http".into(), 2);
    }
    assert_eq!(call(&meta, &[]), "DATA_CLIENT_HTTP_REQUEST_MODULE_VERSION");
    assert_eq!(core.client_binary("client.http_request", &window, "", &[]).unwrap_err().id.as_deref(), Some("DESK_CLIENT_HTTP_REQUEST_HEADER_MISSING"));
    assert_eq!(core.client_binary("client.http_request", &window, "", &[0, 0, 0, 2, b'{']).unwrap_err().id.as_deref(), Some("DESK_CLIENT_HTTP_REQUEST_META_TRUNCATED"));
    assert_eq!(core.client_binary("client.http_request", &window, "", &[0, 0, 0, 1, b'x']).unwrap_err().id.as_deref(), Some("DESK_CLIENT_HTTP_REQUEST_META_INVALID"));
}
