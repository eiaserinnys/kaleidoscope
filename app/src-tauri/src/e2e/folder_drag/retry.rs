//! 입력 이벤트가 없는 첫 시도만 다시 보낸다. 드롭 결함은 그대로 실패한다.
pub(crate) fn allow_retry(
    attempt: usize,
    no_events: bool,
    source_exists: bool,
    destination_exists: bool,
) -> bool {
    attempt == 0 && no_events && source_exists && !destination_exists
}

#[cfg(test)]
mod tests {
    use super::allow_retry;
    #[test]
    fn retries_only_the_first_undelivered_input() {
        assert!(allow_retry(0, true, true, false));
        assert!(!allow_retry(1, true, true, false));
    }
    #[test]
    fn dragstart_without_drop_is_a_failure() {
        assert!(!allow_retry(0, false, true, false));
    }
    #[test]
    fn completed_or_partial_file_moves_are_not_retried() {
        assert!(!allow_retry(0, true, false, true));
        assert!(!allow_retry(0, true, true, true));
        assert!(!allow_retry(0, true, false, false));
    }
}
