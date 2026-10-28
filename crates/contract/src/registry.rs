//! 코어와 오케스트레이터 사이 HTTP 약속 (레지스트리 1판, 261029)
//!
//! 오케스트레이터는 앱 레지스트리의 정본이다. 쉘의 코어는 기기 토큰으로 붙어 앱을 받고, 에이전트는 같은
//! 서버의 MCP(`/mcp`, MCP 토큰)로 앱을 올린다. MCP 도구의 모양은 오케스트레이터 코드에 있고 이 파일에는 없다.
//! 이 파일의 타입은 화면에 가지 않으므로 TS로 만들지 않는다.
//!
//! # 주소와 인증
//! 코어의 `server_url`(끝에 `/` 없음, 예: `https://kaleidoscope.eiaserinnys.me`) 뒤에 아래 경로를 붙인다.
//!
//! | 메서드와 경로 | 인증 | 요청 본문 | 성공 | 실패 |
//! |---|---|---|---|---|
//! | `POST /api/pair/start` | 없음 | [`PairStartRequest`] | 200 [`PairStartReply`] | 429 승인 대기 중인 연결이 너무 많음 |
//! | `POST /api/pair/poll` | 없음(`device_code`가 비밀) | [`PairPollRequest`] | 200 [`PairPollReply`] | 404 없거나 만료됨 |
//! | `GET /api/device/events` | `Authorization: Bearer <기기 토큰>` | 없음 | 200 `text/event-stream` | 401 토큰 거부 |
//! | `POST /api/device/apps` | 같음 | [`DeviceUploadRequest`] | 200 [`RegistryApp`] | 400 검사 실패, 401 |
//! | `GET /api/health` | 없음 | 없음 | 200 `{"ok":true}` | |
//!
//! 실패 본문은 모두 [`CoreError`] JSON이다. 검사 실패(400)는 [`crate::validate::parse_app_definition`]의 오류
//! 그대로이고(`invalid_app_definition`, `unsupported_app`), 401, 404, 429와 서버 오류는 code `server`에 한국어 설명이다.
//!
//! # 기기 연결 (장치 코드 방식)
//! 1. 코어가 `pair/start`로 `device_code`(비밀, 코어만 안다)와 `user_code`(사람이 읽는 코드)를 받는다.
//! 2. 디렉터가 `user_code`를 에이전트에게 전하고, 에이전트가 MCP의 기기 승인 도구로 승인한다.
//!    MCP 토큰을 가진 에이전트만 승인할 수 있으므로 이것이 연결의 신뢰 근거다.
//! 3. 코어는 `interval_secs`마다 `pair/poll`을 부르다가 `approved`를 받으면 기기 토큰을 `link.json`에 저장하고
//!    이벤트 스트림을 연다. 토큰은 승인 뒤 첫 poll에 한 번만 준다. 만료(404)면 `unlinked`로 돌아간다.
//! - `user_code`는 헷갈리는 글자(0, O, 1, I, L, U)를 뺀 대문자와 숫자 8자를 `XXXX-XXXX`로 보인다.
//!   승인 도구는 대소문자와 `-` 유무를 가리지 않는다. 유효 시간은 10분, `interval_secs`는 3이다.
//! - 서버는 기기 토큰의 sha256만 저장한다.
//!
//! # 이벤트 스트림
//! - SSE다. 이벤트 하나는 `data: <DeviceEvent JSON 한 줄>`과 빈 줄이다. `event:`와 `id:` 줄은 쓰지 않는다.
//! - 서버는 15초마다 주석 줄(`: ping`)을 보낸다. 코어는 45초 동안 아무 줄도 못 받으면 끊고 다시 잇는다.
//! - 연결 직후 첫 이벤트는 `apps.snapshot`(레지스트리의 모든 앱의 지금 버전)이다. 서버는 변경 구독을 먼저 걸고
//!   스냅샷을 만들어, 그 사이의 변경을 놓치지 않는다. 겹쳐 온 같은 버전은 코어가 넘긴다.
//! - 끊긴 동안의 `app.published`와 `app.open`은 다시 보내지 않는다. 다시 이었을 때의 스냅샷이 앱을 맞추고,
//!   지난 띄우기 요청은 버린다(오래된 요청으로 창이 갑자기 뜨지 않게).
//!
//! # 코어가 받은 앱을 캐시에 반영하는 규칙
//! - [`RegistryApp`] 하나를 받으면, 캐시에 같은 id의 앱이 있고 지금 버전 번호와 정의가 모두 같으면 넘긴다.
//!   아니면 `app.import`의 창 옮기기 규칙(상태 키, 고른 폴더)대로 반영하되, 버전 번호는 서버의 것을 쓰고
//!   그 앱의 캐시 버전 목록은 받은 버전 하나로 바꾼다.
//! - 스냅샷에 없는 캐시 앱(연결 전에 로컬로 가져온 앱)은 그대로 둔다. 레지스트리에서 앱을 지우는 기능은 아직 없다.
//! - 받은 정의도 [`crate::validate::parse_app_definition`]로 다시 검사한다. 이 쉘이 그릴 수 없는 정의
//!   (`unsupported_app` 등)는 캐시에 넣지 않고 넘긴다(더 새 쉘이 필요한 앱).
//! - `app.published`의 `open`이 참이거나 `app.open`을 받으면, 반영한 `state.changed` 뒤에 화면에
//!   `app.open_requested`를 보낸다. 캐시에 없는 앱의 `app.open`은 넘긴다.

use serde::{Deserialize, Serialize};

use crate::{App, AppVersion};

pub const PAIR_START_PATH: &str = "/api/pair/start";
pub const PAIR_POLL_PATH: &str = "/api/pair/poll";
pub const DEVICE_EVENTS_PATH: &str = "/api/device/events";
pub const DEVICE_APPS_PATH: &str = "/api/device/apps";
pub const HEALTH_PATH: &str = "/api/health";

/// 서버가 보내는 주석 줄 간격.
pub const PING_INTERVAL_SECS: u64 = 15;
/// 코어가 아무 줄도 못 받으면 끊는 시간.
pub const STREAM_IDLE_TIMEOUT_SECS: u64 = 45;
/// 연결 코드의 유효 시간.
pub const PAIRING_TTL_SECS: u64 = 600;
/// 코어가 승인 여부를 묻는 간격.
pub const PAIRING_POLL_INTERVAL_SECS: u32 = 3;
/// 서버가 동시에 들고 있는 승인 대기 연결의 최대 수. 넘으면 429.
pub const PAIRING_MAX_PENDING: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairStartRequest {
    /// 기기 이름(그 PC의 호스트 이름). 에이전트가 승인할 때와 기기 목록에서 보인다.
    pub device_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PairStartReply {
    /// 코어만 아는 비밀. poll에 쓴다.
    pub device_code: String,
    /// 사람이 읽는 코드. `XXXX-XXXX`.
    pub user_code: String,
    pub expires_at: String,
    pub interval_secs: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairPollRequest {
    pub device_code: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PairPollReply {
    /// 아직 승인되지 않았다.
    Pending {},
    /// 승인됐다. 토큰은 이 응답에서 한 번만 준다.
    Approved { device_id: String, token: String },
}

/// 쉘에서 손으로 가져온 앱 정의를 레지스트리에 올린다(`app.import`가 연결 상태일 때).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceUploadRequest {
    pub definition_json: String,
}

/// 레지스트리의 앱 하나와 그 지금 버전.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RegistryApp {
    pub app: App,
    pub version: AppVersion,
}

/// 이벤트 스트림의 이벤트. `event`로 가른다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event")]
pub enum DeviceEvent {
    /// 연결 직후 한 번. 레지스트리의 모든 앱의 지금 버전.
    #[serde(rename = "apps.snapshot")]
    AppsSnapshot { apps: Vec<RegistryApp> },
    /// 앱의 새 버전이 올라왔다. `open`이면 에이전트가 띄워 달라고 한 것이다.
    /// 기기가 손으로 올린 앱은 `open`이 거짓이다(그 쉘이 직접 창을 연다).
    #[serde(rename = "app.published")]
    AppPublished { app: RegistryApp, open: bool },
    /// 에이전트가 이미 있는 앱을 띄워 달라고 했다.
    #[serde(rename = "app.open")]
    AppOpen { app_id: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_event_uses_event_tag() {
        let event = DeviceEvent::AppOpen {
            app_id: "md-editor".into(),
        };
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"event":"app.open","app_id":"md-editor"}"#
        );
        let parsed: DeviceEvent =
            serde_json::from_str(r#"{"event":"apps.snapshot","apps":[]}"#).unwrap();
        assert_eq!(parsed, DeviceEvent::AppsSnapshot { apps: vec![] });
    }

    #[test]
    fn pair_poll_reply_uses_status_tag() {
        let pending: PairPollReply = serde_json::from_str(r#"{"status":"pending"}"#).unwrap();
        assert_eq!(pending, PairPollReply::Pending {});
        let approved = PairPollReply::Approved {
            device_id: "d".into(),
            token: "t".into(),
        };
        assert_eq!(
            serde_json::to_string(&approved).unwrap(),
            r#"{"status":"approved","device_id":"d","token":"t"}"#
        );
    }
}
