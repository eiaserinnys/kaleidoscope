//! 창의 결과와 실제 이진 운반 경로를 함께 판정한다.
pub fn result(text: &str, requests: usize, reads: usize) -> bool {
    let mut lines = text.lines().map(str::trim);
    lines.next() == Some("denied-request ok")
        && lines.next() == Some("denied-read ok")
        && lines.next() == Some("get ok")
        && lines.next() == Some("read ok")
        && lines.next().and_then(|line| line.strip_prefix("put ok ")).is_some_and(|status| status.parse::<u16>().is_ok())
        && lines.next().is_none()
        && requests >= 3
        && reads >= 2
}

#[cfg(test)]
mod tests {
    use super::result;

    const OK: &str = "denied-request ok\ndenied-read ok\nget ok\nread ok\nput ok 405";

    #[test]
    fn 다섯_줄과_실제_요청_횟수가_모두_필요하다() {
        assert!(result(OK, 3, 2));
        assert!(!result(OK, 2, 2));
        assert!(!result(OK, 3, 1));
        for missing in 0..5 {
            let text = OK.lines().enumerate().filter_map(|(index, line)| (index != missing).then_some(line)).collect::<Vec<_>>().join("\n");
            assert!(!result(&text, 3, 2), "{missing}번째 결과 누락");
        }
        assert!(!result(&OK.replace("denied-read ok", "denied-read SHELL_IPC_HANDLE_HEADER_INVALID"), 3, 2));
        assert!(!result(&OK.replace("put ok 405", "put ok 실패"), 3, 2));
    }
}
