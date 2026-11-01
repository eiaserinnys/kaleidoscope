//! 프로세스와 자손을 같은 수명으로 묶는다.
use super::WorkerConfig;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use std::{io, process::Stdio};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

pub(super) struct Process {
    pub child: Box<dyn ChildWrapper>,
    pub stderr: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<String>>>,
}
impl Process {
    pub fn spawn(
        config: &WorkerConfig,
    ) -> io::Result<(
        Self,
        impl agent_client_protocol::ConnectTo<agent_client_protocol::Client>,
    )> {
        let path = which::which(&config.spec.command)
            .map_err(|e| io::Error::new(io::ErrorKind::NotFound, e))?;
        let mut command = Command::new(path);
        command
            .args(&config.spec.args)
            .envs(&config.spec.env)
            .current_dir(&config.cwd)
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
            flags.0 .0 = 0x08000000; // CREATE_NO_WINDOW
            wrapped.wrap(flags);
        }
        wrapped.wrap(KillOnDrop);
        let mut child = wrapped.spawn()?;
        let input = child
            .stdin()
            .take()
            .ok_or_else(|| io::Error::other("stdin 없음"))?;
        let output = child
            .stdout()
            .take()
            .ok_or_else(|| io::Error::other("stdout 없음"))?;
        let stderr = child
            .stderr()
            .take()
            .ok_or_else(|| io::Error::other("stderr 없음"))?;
        let tail = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::new()));
        let sink = tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut t = sink.lock().unwrap();
                if t.len() == 5 {
                    t.pop_front();
                }
                t.push_back(line);
            }
        });
        let (reader, mut writer) = tokio::io::duplex(64 * 1024);
        let diagnostics = tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(output).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if serde_json::from_str::<serde_json::Value>(&line).is_err() {
                    diagnostics
                        .lock()
                        .unwrap()
                        .push_back("에이전트가 잘못된 JSON을 보냈습니다".into());
                    break;
                }
                if writer.write_all(line.as_bytes()).await.is_err()
                    || writer.write_all(b"\n").await.is_err()
                {
                    break;
                }
            }
        });
        Ok((
            Self {
                child,
                stderr: tail,
            },
            agent_client_protocol::ByteStreams::new(input.compat_write(), reader.compat()),
        ))
    }
    pub async fn stop(&mut self) {
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}
