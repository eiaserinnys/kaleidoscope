//! 세 요청 경로가 공유하는 원천의 요청 한도 판정.
use kaleidoscope_contract::registry::RateLimitHint;
use reqwest::header::{HeaderMap, RETRY_AFTER};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn rate_limit(status: u16, headers: &HeaderMap) -> Option<RateLimitHint> {
    let retry = headers.get(RETRY_AFTER).and_then(|v| v.to_str().ok());
    let limited = matches!(status, 429 | 418)
        || (status == 503 && retry.is_some())
        || (status == 403
            && headers
                .get("x-ratelimit-remaining")
                .and_then(|v| v.to_str().ok())
                == Some("0"));
    if !limited {
        return None;
    }
    let now = SystemTime::now();
    let seconds = retry
        .and_then(|v| {
            v.trim().parse::<u64>().ok().or_else(|| {
                httpdate::parse_http_date(v).ok().map(|at| {
                    let remaining = at.duration_since(now).unwrap_or(Duration::ZERO);
                    remaining.as_secs() + u64::from(remaining.subsec_nanos() > 0)
                })
            })
        })
        .or_else(|| {
            headers
                .get("x-ratelimit-reset")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .map(|at| {
                    at.saturating_sub(now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
                })
        });
    Some(RateLimitHint {
        retry_after_secs: seconds,
    })
}
