//! Finder나 Dock으로 띄운 macOS 앱은 launchd가 준 최소 PATH(`/usr/bin:/bin:/usr/sbin:/sbin`)로 돈다.
//! 로그인 셸이 보는 PATH를 앞에 붙여 터미널에서 띄운 것과 같은 명령(node, npx, python3)을 찾게 한다.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const START: &str = "__KALEIDOSCOPE_PATH_START__";
const END: &str = "__KALEIDOSCOPE_PATH_END__";

/// 프로세스 PATH를 로그인 셸 PATH로 보강한다. 실패하면 PATH를 그대로 둔다.
#[cfg(target_os = "macos")]
pub(crate) fn apply() {
    let shell = std::env::var("SHELL").ok();
    let Some(login) = resolve(&shell_for(shell.as_deref()), Duration::from_secs(5)) else {
        return;
    };
    let current = std::env::var("PATH").unwrap_or_default();
    // 다른 스레드가 환경을 읽기 전, run() 맨 앞에서만 부른다.
    std::env::set_var("PATH", merge(&login, &current));
}

/// `$SHELL`이 절대 경로면 그 셸을, 아니면 macOS 기본 셸을 쓴다.
fn shell_for(shell: Option<&str>) -> String {
    match shell {
        Some(shell) if Path::new(shell).is_absolute() => shell.to_string(),
        _ => "/bin/zsh".to_string(),
    }
}

/// nvm과 Homebrew 설정이 .zshrc에 있는 경우가 많아 대화형 로그인 셸로 PATH를 읽는다.
fn resolve(shell: &str, timeout: Duration) -> Option<String> {
    let script = format!("printf '%s' \"{START}${{PATH}}{END}\"");
    let mut child = Command::new(shell)
        .args(["-ilc", &script])
        .env("DISABLE_AUTO_UPDATE", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut output = String::new();
        let _ = stdout.read_to_string(&mut output);
        let _ = tx.send(output);
    });
    let deadline = Instant::now() + timeout;
    let output = rx.recv_timeout(timeout).ok();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if output.is_some() && Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(10))
            }
            _ => break None,
        }
    };
    let Some(status) = status else {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    if !status.success() {
        return None;
    }
    parse(&output?)
}

/// 대화형 셸이 앞뒤로 찍는 잡음은 버리고 표지 사이만 읽는다.
fn parse(output: &str) -> Option<String> {
    let start = output.find(START)? + START.len();
    let end = start + output[start..].find(END)?;
    let path = output[start..end].trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// 로그인 셸 항목을 앞에 두고 현재 PATH에만 있는 항목을 뒤에 붙인다.
fn merge(login: &str, current: &str) -> String {
    let mut entries: Vec<&str> = Vec::new();
    for entry in login.split(':').chain(current.split(':')) {
        if !entry.is_empty() && !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    entries.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    struct Script(PathBuf);

    impl Script {
        fn new(name: &str, body: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "kaleidoscope-login-path-{name}-{}",
                std::process::id()
            ));
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            Self(path)
        }

        fn path(&self) -> &str {
            self.0.to_str().unwrap()
        }
    }

    impl Drop for Script {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    #[test]
    fn login_entries_come_first_without_duplicates_or_empty_entries() {
        assert_eq!(
            merge(
                "/opt/homebrew/bin::/usr/bin:/opt/homebrew/bin",
                "/usr/bin:/bin::/usr/sbin:/Usr/bin"
            ),
            "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/Usr/bin"
        );
        assert_eq!(merge("", "/usr/bin:/bin"), "/usr/bin:/bin");
    }

    #[test]
    fn only_text_between_markers_is_read() {
        assert_eq!(
            parse(&format!("환영합니다\n{START}/a:/b{END}\n프롬프트")).as_deref(),
            Some("/a:/b")
        );
        assert_eq!(parse("/a:/b"), None);
        assert_eq!(parse(&format!("{START}/a:/b")), None);
        assert_eq!(parse(&format!("{START}{END}")), None);
    }

    #[test]
    fn shell_must_be_absolute_or_falls_back_to_zsh() {
        assert_eq!(shell_for(Some("/bin/bash")), "/bin/bash");
        assert_eq!(shell_for(Some("bash")), "/bin/zsh");
        assert_eq!(shell_for(None), "/bin/zsh");
    }

    #[test]
    fn path_is_read_from_shell_output() {
        let shell = Script::new(
            "ok",
            &format!("echo 잡음\nprintf '%s' '{START}/opt/homebrew/bin:/usr/bin{END}'\necho 끝"),
        );
        assert_eq!(
            resolve(shell.path(), Duration::from_secs(5)).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn real_login_shell_prints_its_path() {
        let path = resolve("/bin/zsh", Duration::from_secs(5)).unwrap();
        assert!(path.split(':').any(|entry| entry == "/usr/bin"), "{path}");
    }

    #[test]
    fn failing_shell_yields_nothing() {
        assert_eq!(resolve("/usr/bin/false", Duration::from_secs(5)), None);
        assert_eq!(resolve("/없는/셸", Duration::from_secs(5)), None);
        let shell = Script::new("fail", &format!("printf '%s' '{START}/a{END}'\nexit 1"));
        assert_eq!(resolve(shell.path(), Duration::from_secs(5)), None);
    }

    #[test]
    fn slow_shell_is_killed_after_timeout() {
        let shell = Script::new("slow", &format!("sleep 5\nprintf '%s' '{START}/a{END}'"));
        let started = Instant::now();
        assert_eq!(resolve(shell.path(), Duration::from_millis(300)), None);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
