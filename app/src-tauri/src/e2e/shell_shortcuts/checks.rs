pub(crate) fn switched(
    before: &str,
    after: &str,
    expected: &str,
    commands: usize,
    app_keys: u64,
) -> bool {
    before != after && after == expected && commands == 1 && app_keys == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn 전환_없음과_중복과_앱_키_누출을_거부한다() {
        assert!(switched("a", "b", "b", 1, 0));
        assert!(!switched("a", "a", "b", 0, 0));
        assert!(!switched("a", "b", "b", 2, 0));
        assert!(!switched("a", "b", "b", 1, 1));
        assert!(!switched("a", "c", "b", 1, 0));
    }
}
