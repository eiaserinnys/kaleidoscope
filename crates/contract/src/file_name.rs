//! 파일과 문서의 이름 규칙. 어느 OS에서 돌든 Windows에서 쓸 수 있는 이름만 새로 만든다.

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 새로 만들거나 바꿀 이름을 검사한다. 어긋나면 화면에 그대로 보일 문구를 돌려준다.
pub fn check_file_name(name: &str) -> Result<(), &'static str> {
    if name.is_empty() {
        return Err("이름을 입력하세요.");
    }
    if name == "." || name == ".." {
        return Err("쓸 수 없는 이름입니다.");
    }
    if name.chars().any(|c| {
        c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
    }) {
        return Err("이름에 \\ / : * ? \" < > | 는 쓸 수 없습니다.");
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return Err("이름은 공백이나 점으로 끝날 수 없습니다.");
    }
    if name.encode_utf16().count() > 255 {
        return Err("이름이 너무 깁니다.");
    }
    let stem = name.split('.').next().unwrap_or(name).trim_end().to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return Err("Windows가 예약한 이름이라 쓸 수 없습니다.");
    }
    Ok(())
}
