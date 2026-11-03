/// 바이트 한도를 화면에서 읽기 쉬운 단위로 바꾼다.
pub fn format_byte_limit(bytes: u64) -> String {
    let (value, unit) = if bytes >= 1024 * 1024 {
        (bytes as f64 / (1024 * 1024) as f64, "MB")
    } else if bytes >= 1024 {
        (bytes as f64 / 1024.0, "KB")
    } else {
        return format!("{bytes}B");
    };
    let value = format!("{value:.2}");
    format!(
        "{}{unit}",
        value.trim_end_matches('0').trim_end_matches('.')
    )
}

#[cfg(test)]
mod tests {
    use super::format_byte_limit;

    #[test]
    fn 한도를_읽기_쉬운_단위로_표시한다() {
        assert_eq!(format_byte_limit(1024), "1KB");
        assert_eq!(format_byte_limit(64 * 1024), "64KB");
        assert_eq!(format_byte_limit(20 * 1024 * 1024), "20MB");
        assert_eq!(format_byte_limit(512 * 1024 * 1024), "512MB");
    }
}
