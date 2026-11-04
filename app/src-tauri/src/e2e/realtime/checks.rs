//! 실행 경로의 증거가 빠졌을 때 성공으로 오인하지 않게 하는 판정.
pub fn roundtrip(text: bool, binary: bool, sends: usize, reads: usize) -> bool {
    text && binary && sends >= 2 && reads >= 2
}

pub fn fresh_session(before: &[String], after: &[String]) -> bool {
    after.len() > before.len() && after.last().is_some_and(|id| !before.contains(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 왕복은_두_내용과_실제_바이트_경로를_모두_요구한다() {
        assert!(roundtrip(true, true, 2, 2));
        assert!(!roundtrip(false, true, 2, 2));
        assert!(!roundtrip(true, false, 2, 2));
        assert!(!roundtrip(true, true, 0, 2));
        assert!(!roundtrip(true, true, 2, 0));
    }

    #[test]
    fn 리로드는_이전과_다른_새_세션을_요구한다() {
        let before = vec!["a".into()];
        assert!(fresh_session(&before, &["a".into(), "b".into()]));
        assert!(!fresh_session(&before, &before));
        assert!(!fresh_session(&before, &["a".into(), "a".into()]));
    }
}
