//! 워커 프로세스와 자손을 같은 수명으로 실행한다.
use super::*;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use std::{
    path::Path,
    process::{Output, Stdio},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct ProcessTree(Box<dyn ChildWrapper>);
impl Drop for ProcessTree {
    fn drop(&mut self) {
        let _ = self.0.start_kill();
    }
}

pub(super) async fn execute(
    code: &str,
    state_dir: &Path,
    code_dir: &Path,
    input: &[u8],
    bridge_url: String,
    bridge_token: String,
    deadline: tokio::time::Instant,
) -> Result<Output, CoreError> {
    let interpreter = if cfg!(windows) { "python" } else { "python3" };
    let mut command = tokio::process::Command::new(interpreter);
    command
        .arg("-c")
        .arg(code)
        .current_dir(state_dir)
        .env_clear();
    for name in ["PATH", "HOME", "USER"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    #[cfg(windows)]
    for name in [
        "SystemRoot",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "TEMP",
        "TMP",
        "PATHEXT",
        "COMSPEC",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        .env("LANG", "C.UTF-8")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONPATH", code_dir)
        .env("KALEIDOSCOPE_WORKER_API_URL", bridge_url)
        .env("KALEIDOSCOPE_WORKER_TOKEN", bridge_token)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut wrapped = CommandWrap::from(command);
    #[cfg(unix)]
    wrapped.wrap(process_wrap::tokio::ProcessGroup::leader());
    #[cfg(windows)]
    {
        wrapped.wrap(process_wrap::tokio::JobObject);
        let mut flags = process_wrap::tokio::CreationFlags(Default::default());
        flags.0 .0 = 0x08000000;
        wrapped.wrap(flags);
    }
    wrapped.wrap(KillOnDrop);
    let mut child = ProcessTree(
        wrapped
            .spawn()
            .map_err(|e| server_error(&format!("워커를 시작할 수 없습니다: {e}")))?,
    );
    let mut stdout = child
        .0
        .stdout()
        .take()
        .ok_or_else(|| server_error("stdout 없음"))?;
    let mut stderr = child
        .0
        .stderr()
        .take()
        .ok_or_else(|| server_error("stderr 없음"))?;
    let output = tokio::time::timeout_at(deadline, async {
        let mut stdin = child
            .0
            .stdin()
            .take()
            .ok_or_else(|| std::io::Error::other("stdin 없음"))?;
        stdin.write_all(input).await?;
        drop(stdin);
        let mut out = Vec::new();
        let mut err = Vec::new();
        let (status, _, _) = tokio::try_join!(
            child.0.wait(),
            stdout.read_to_end(&mut out),
            stderr.read_to_end(&mut err)
        )?;
        Ok::<_, std::io::Error>(std::process::Output {
            status,
            stdout: out,
            stderr: err,
        })
    })
    .await;
    let output = match output {
        Ok(Ok(output)) => output,
        other => {
            let _ = child.0.start_kill();
            let _ = child.0.wait().await;
            return Err(match other {
                Err(_) => server_error("워커 실행 시간이 초과되었습니다"),
                Ok(Err(error)) => server_error(&format!("워커 실행 실패: {error}")),
                Ok(Ok(_)) => unreachable!(),
            });
        }
    };
    Ok(output)
}
