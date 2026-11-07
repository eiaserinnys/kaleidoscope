pub(crate) fn safe_attachment_name(name: &str) -> String {
    let name: String = name
        .chars()
        .map(|character| {
            if "<>:\"/\\|?*".contains(character) || character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect();
    let name = name.trim_end_matches(|character| character == '.' || character == ' ');
    if name.is_empty() {
        "첨부".into()
    } else {
        name.into()
    }
}

pub(crate) fn should_reveal(name: &str) -> bool {
    const REVEAL_EXTENSIONS: &[&str] = &[
        "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jse", "wsf", "hta", "cpl",
        "lnk", "reg", "command", "tool", "sh", "app", "pkg", "terminal", "workflow", "scpt",
        "applescript",
    ];
    let Some((_, extension)) = name.rsplit_once('.') else {
        return false;
    };
    !extension.is_empty()
        && REVEAL_EXTENSIONS
            .iter()
            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attachment_names_are_safe_and_executables_are_revealed() {
        assert_eq!(safe_attachment_name("../메모.txt"), ".._메모.txt");
        assert_eq!(safe_attachment_name("..."), "첨부");
        assert!(should_reveal("setup.EXE"));
        assert!(!should_reveal("메모.txt"));
    }

    #[test]
    fn macos_executables_are_revealed() {
        for name in [
            "start.command",
            "build.tool",
            "install.SH",
            "도구.app",
            "setup.pkg",
            "session.terminal",
            "자동화.workflow",
            "run.scpt",
            "run.applescript",
        ] {
            assert!(should_reveal(name), "{name}");
        }
        assert!(!should_reveal("사진.png"));
        assert!(!should_reveal("app"));
    }
}
