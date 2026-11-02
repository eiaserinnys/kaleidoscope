use kaleidoscope_data::rate_limit::rate_limit;
use reqwest::header::{HeaderMap, HeaderValue, RETRY_AFTER};

#[test]
fn 분리된_한도_판정과_대기_시간() {
    let mut headers = HeaderMap::new();
    assert!(rate_limit(403, &headers).is_none());
    assert_eq!(rate_limit(429, &headers).unwrap().retry_after_secs, None);
    assert_eq!(rate_limit(418, &headers).unwrap().retry_after_secs, None);
    assert!(rate_limit(503, &headers).is_none());
    headers.insert(RETRY_AFTER, HeaderValue::from_static("17"));
    assert_eq!(
        rate_limit(503, &headers).unwrap().retry_after_secs,
        Some(17)
    );
    headers.remove(RETRY_AFTER);
    headers.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
    assert_eq!(rate_limit(403, &headers).unwrap().retry_after_secs, None);
    headers.insert("x-ratelimit-reset", HeaderValue::from_static("4102444800"));
    assert!(rate_limit(403, &headers).unwrap().retry_after_secs.unwrap() > 0);
    headers.insert(
        RETRY_AFTER,
        HeaderValue::from_static("Sun, 06 Nov 2095 08:49:37 GMT"),
    );
    assert!(rate_limit(429, &headers).unwrap().retry_after_secs.unwrap() > 0);
}

#[test]
fn 옛_서버의_응답은_한도_필드_없이_읽는다() {
    let reply: kaleidoscope_contract::registry::ConnectionReply = serde_json::from_value(serde_json::json!({"status":429,"mime":"application/json","json":{},"text":null,"data_base64":null})).unwrap();
    assert!(reply.rate_limit.is_none());
}
