//! 상류 SSE 응답의 프레임 읽기와 재연결 물러섬. 대화 스트림과 앱 변경 알림 스트림이 함께 쓴다.
use std::time::Duration;
use tokio::sync::watch;

pub(crate) const INITIAL_RETRY_DELAY_SECS: u64 = 2;
pub(crate) const MAX_RETRY_DELAY_SECS: u64 = 30;
pub(crate) const READ_TIMEOUT_SECS: u64 = 90;
const CONNECT_TIMEOUT_SECS: u64 = 10;
const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

/// 다음 재시도까지 기다릴 초. 연결에 성공해 스트림을 받기 시작한 뒤 끊기면 처음 값으로 돌아가고,
/// 연결에 실패만 이어지면 두 배씩 늘려 상한에서 멈춘다.
pub(crate) fn next_delay(prev: u64, connected: bool) -> u64 {
    if connected {
        INITIAL_RETRY_DELAY_SECS
    } else {
        (prev * 2).min(MAX_RETRY_DELAY_SECS)
    }
}

/// 스트림을 읽는 HTTP 클라이언트. 연결 10초, 읽기 90초이며 리다이렉트를 따르지 않는다.
pub(crate) fn client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .read_timeout(Duration::from_secs(READ_TIMEOUT_SECS))
        .build()
}

/// 프레임 하나. `event`는 `event:` 줄(없으면 None), `data`는 `data:` 줄들을 `\n`으로 이은 것, `id`는 `id:` 줄.
pub(crate) struct Frame {
    pub event: Option<String>,
    pub data: Vec<u8>,
    pub id: Option<String>,
}

/// 프레임 콜백의 다음 동작.
pub(crate) enum Control {
    /// 계속 읽는다.
    Continue,
    /// 스트림 항목이 사라졌다. 연결을 닫는다.
    Close,
    /// 프레임이 깨졌다. 연결을 끊고 다시 잇는다.
    Retry,
}

pub(crate) enum ReadEnd {
    /// 서버가 응답을 닫았거나 읽기가 실패했다.
    Disconnected,
    /// 멈춤 신호를 받았다.
    Stopped,
    /// 콜백이 연결을 닫으라고 했다.
    Close,
    /// 콜백이 연결을 끊고 다시 잇으라고 했다.
    Retry,
}

/// 응답 본문에서 프레임을 읽어 콜백에 넘긴다. `stop`의 값이 참으로 바뀌면 읽기를 멈춘다.
/// 프레임 하나나 아직 읽지 못한 조각이 4MiB를 넘거나 `data:` 줄의 합이 4MiB를 넘으면 `Retry`다.
pub(crate) async fn read_frames<F>(
    response: &mut reqwest::Response,
    mut stop: Option<&mut watch::Receiver<bool>>,
    mut on_frame: F,
) -> ReadEnd
where
    F: FnMut(Frame) -> Control,
{
    let mut bytes = Vec::<u8>::new();
    let mut data = Vec::<Vec<u8>>::new();
    let mut event = None::<String>;
    let mut id = None::<String>;
    loop {
        let chunk = match stop.as_deref_mut() {
            Some(stop) => tokio::select! {
                chunk = response.chunk() => chunk,
                _ = stop.changed() => return ReadEnd::Stopped,
            },
            None => response.chunk().await,
        };
        let chunk = match chunk {
            Ok(Some(chunk)) => chunk,
            _ => return ReadEnd::Disconnected,
        };
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_FRAME_BYTES {
            return ReadEnd::Retry;
        }
        while let Some(newline) = bytes.iter().position(|b| *b == b'\n') {
            let mut line: Vec<u8> = bytes.drain(..=newline).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                if !data.is_empty() {
                    let frame = Frame {
                        event: event.take(),
                        data: std::mem::take(&mut data).join(&b'\n'),
                        id: id.take(),
                    };
                    match on_frame(frame) {
                        Control::Continue => {}
                        Control::Close => return ReadEnd::Close,
                        Control::Retry => return ReadEnd::Retry,
                    }
                }
                event = None;
                id = None;
            } else if let Some(value) = line.strip_prefix(b"data:") {
                data.push(value.strip_prefix(b" ").unwrap_or(value).to_vec());
            } else if let Some(value) = line.strip_prefix(b"event:") {
                event = Some(
                    String::from_utf8_lossy(value.strip_prefix(b" ").unwrap_or(value)).into_owned(),
                );
            } else if let Some(value) = line.strip_prefix(b"id:") {
                id = String::from_utf8(value.strip_prefix(b" ").unwrap_or(value).to_vec()).ok();
            }
            if data.iter().map(Vec::len).sum::<usize>() > MAX_FRAME_BYTES {
                return ReadEnd::Retry;
            }
        }
    }
}

/// 멈춤 신호를 기다리는 동안 자는다. 신호가 오면 `false`.
pub(crate) async fn sleep_or_stop(stop: &mut watch::Receiver<bool>, seconds: u64) -> bool {
    if *stop.borrow() {
        return false;
    }
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs(seconds)) => !*stop.borrow(),
        _ = stop.changed() => false,
    }
}

#[cfg(test)]
mod tests {
    use super::next_delay;

    #[test]
    fn retry_delay_doubles_while_failing_and_resets_after_connect() {
        let mut delay = 2;
        let mut seen = vec![delay];
        for _ in 0..5 {
            delay = next_delay(delay, false);
            seen.push(delay);
        }
        assert_eq!(seen, [2, 4, 8, 16, 30, 30]);
        assert_eq!(next_delay(30, true), 2);
        assert_eq!(next_delay(2, true), 2);
    }
}
