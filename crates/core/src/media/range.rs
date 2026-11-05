#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_ranges_and_invalid_requests() {
        assert_eq!(parse(Some("bytes=0-9"), 100), Range::Partial(0, 9));
        assert_eq!(parse(Some("bytes=90-"), 100), Range::Partial(90, 99));
        assert_eq!(parse(Some("bytes=-10"), 100), Range::Partial(90, 99));
        assert_eq!(parse(Some("bytes=100-"), 100), Range::Unsatisfiable);
        assert_eq!(parse(Some("bytes=9-2"), 100), Range::Invalid);
        assert_eq!(
            parse(Some("bytes=18446744073709551616-"), 100),
            Range::Invalid
        );
        assert_eq!(parse(Some("bytes=0-1,3-4"), 100), Range::Full);
        assert_eq!(parse(None, 100), Range::Full);
    }
}
// 한 구간의 HTTP 바이트 범위를 파일 길이에 맞춰 계산한다.
#[derive(Debug, PartialEq)]
pub(super) enum Range {
    Full,
    Partial(u64, u64),
    Invalid,
    Unsatisfiable,
}

pub(super) fn parse(header: Option<&str>, len: u64) -> Range {
    let Some(header) = header else {
        return Range::Full;
    };
    let Some(value) = header.strip_prefix("bytes=") else {
        return Range::Full;
    };
    if value.contains(',') {
        return Range::Full;
    }
    let Some((start, end)) = value.split_once('-') else {
        return Range::Invalid;
    };
    let number = |value: &str| {
        if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
            None
        } else {
            value.parse::<u64>().ok()
        }
    };
    if start.is_empty() {
        let Some(suffix) = number(end) else {
            return Range::Invalid;
        };
        if suffix == 0 || len == 0 {
            return Range::Unsatisfiable;
        }
        return Range::Partial(len.saturating_sub(suffix), len - 1);
    }
    let Some(start) = number(start) else {
        return Range::Invalid;
    };
    let end = if end.is_empty() {
        None
    } else {
        let Some(end) = number(end) else {
            return Range::Invalid;
        };
        if end < start {
            return Range::Invalid;
        }
        Some(end)
    };
    if start >= len {
        return Range::Unsatisfiable;
    }
    Range::Partial(start, end.unwrap_or(len - 1).min(len - 1))
}
