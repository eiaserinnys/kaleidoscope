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
        "lnk", "reg",
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
}
