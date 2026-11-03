//! 기기에서 자손과 수명을 함께하는 프로세스를 띄운다.
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use std::{collections::BTreeMap, io, path::Path, process::Stdio};
use tokio::process::Command;

pub(crate) fn spawn(
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
    cwd: &Path,
) -> io::Result<Box<dyn ChildWrapper>> {
    let path = which::which(command).map_err(|e| io::Error::new(io::ErrorKind::NotFound, e))?;
    let mut command = Command::new(path);
    command
        .args(args)
        .envs(env)
        .current_dir(cwd)
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
    wrapped.spawn()
}
