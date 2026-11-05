//! 실측에 필요한 재생, 버퍼 밖 이동과 서버 응답을 함께 판정한다.
pub(super) fn passed(
    seeked: bool,
    progress: bool,
    unbuffered: bool,
    requests: &[(u16, u64, String)],
) -> bool {
    seeked
        && progress
        && unbuffered
        && requests.iter().any(|(status, start, origin)| {
            *status == 206 && *start > 0 && origin == "http://tauri.localhost"
        })
}

#[cfg(test)]
mod tests {
    use super::passed;
    #[test]
    fn rejects_missing_playback_seek_range_or_origin() {
        let valid = [(206, 1024, "http://tauri.localhost".to_string())];
        assert!(passed(true, true, true, &valid));
        assert!(!passed(false, true, true, &valid));
        assert!(!passed(true, false, true, &valid));
        assert!(!passed(true, true, false, &valid));
        assert!(!passed(
            true,
            true,
            true,
            &[(200, 1024, valid[0].2.clone())]
        ));
        assert!(!passed(true, true, true, &[(206, 0, valid[0].2.clone())]));
        assert!(!passed(true, true, true, &[(206, 1024, "null".into())]));
        assert!(!passed(true, true, true, &[]));
    }
}
