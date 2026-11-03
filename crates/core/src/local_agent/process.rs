//! 프로세스와 자손을 같은 수명으로 묶는다.
use super::WorkerConfig;
use process_wrap::tokio::ChildWrapper;
use std::io;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
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
        let mut child = crate::os_process::spawn(
            &config.spec.command,
            &config.spec.args,
            &config.spec.env,
            &config.cwd,
        )?;
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
