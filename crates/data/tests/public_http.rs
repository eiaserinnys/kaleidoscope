use std::net::IpAddr;
use std::collections::BTreeMap;
use kaleidoscope_contract::data::HttpMethod;
use kaleidoscope_data::public_http::{request_with, PublicResponse, PublicHttpError};

#[test]
fn request_preserves_method_headers_body_and_rejects_private_dns() {
    let query = BTreeMap::new();
    let headers = BTreeMap::from([("if-match".to_string(), "version".to_string())]);
    let result = request_with("https://example.com", &["/item".into()], "/item", &query, HttpMethod::Put, &headers, Some(b"update"), 1024,
        |_| Ok(vec!["8.8.8.8:443".parse().unwrap()]),
        |_, _, _, _, method, actual_headers, body, _| {
            assert_eq!(method, HttpMethod::Put);
            assert_eq!(actual_headers, &headers);
            assert_eq!(body, Some(&b"update"[..]));
            Ok(PublicResponse { status: 412, headers: BTreeMap::new(), rate_limit: None, retry_after: None, mime: "text/plain".into(), bytes: b"conflict".to_vec() })
        }).unwrap();
    assert_eq!(result.status, 412);
    let result = request_with("https://example.com", &["/item".into()], "/item", &query, HttpMethod::Get, &BTreeMap::new(), None, 1024,
        |_| Ok(vec!["127.0.0.1:443".parse().unwrap()]), |_, _, _, _, _, _, _, _| panic!("private address reached transport"));
    assert!(matches!(result, Err(PublicHttpError::PrivateAddress)));
}

#[test]
fn private_and_reserved_addresses_are_rejected() {
    for address in [
        "127.0.0.1",
        "10.1.2.3",
        "169.254.1.1",
        "192.0.2.1",
        "100.64.0.1",
        "::1",
        "fc00::1",
        "fe80::1",
        "2001:db8::1",
        "::ffff:127.0.0.1",
    ] {
        assert!(
            !kaleidoscope_data::public_http::is_public_ip(address.parse::<IpAddr>().unwrap()),
            "{address}"
        );
    }
    assert!(kaleidoscope_data::public_http::is_public_ip(
        "8.8.8.8".parse().unwrap()
    ));
    assert!(kaleidoscope_data::public_http::is_public_ip(
        "2606:4700:4700::1111".parse().unwrap()
    ));
}
