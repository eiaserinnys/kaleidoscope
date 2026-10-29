//! 코어와 오케스트레이터 사이 HTTP 약속 (레지스트리 2판, 261029)
//!
//! 2판에서 더한 것(카드 #779): 배치 보고(`PUT /api/device/layout`), 워크스페이스 PAS 경로 셋,
//! 이벤트 `agent.update`, `app.published`와 `app.open`의 `workspace_id`. 아래 「워크스페이스 PAS」 절.
//!
//! 오케스트레이터는 앱 레지스트리의 정본이다. 쉘의 코어는 기기 토큰으로 붙어 앱을 받고, 에이전트는 같은
//! 서버의 MCP(`/mcp`, MCP 토큰)로 앱을 올린다. MCP 도구의 모양은 오케스트레이터 코드에 있고 이 파일에는 없다.
//! 이 파일의 타입은 화면에 가지 않으므로 TS로 만들지 않는다.
//!
//! # 주소와 인증
//! 코어의 `server_url`(끝에 `/` 없음, 예: `https://eiaserinnys.me/kaleidoscope`) 뒤에 아래 경로를 붙인다.
//!
//! | 메서드와 경로 | 인증 | 요청 본문 | 성공 | 실패 |
//! |---|---|---|---|---|
//! | `POST /api/pair/start` | 없음 | [`PairStartRequest`] | 200 [`PairStartReply`] | 429 승인 대기 중인 연결이 너무 많음 |
//! | `POST /api/pair/poll` | 없음(`device_code`가 비밀) | [`PairPollRequest`] | 200 [`PairPollReply`] | 404 없거나 만료됨 |
//! | `GET /api/device/events` | `Authorization: Bearer <기기 토큰>` | 없음 | 200 `text/event-stream` | 401 토큰 거부 |
//! | `POST /api/device/apps` | 같음 | [`DeviceUploadRequest`] | 200 [`RegistryApp`] | 400 검사 실패, 401 |
//! | `PUT /api/device/layout` | 같음 | [`DeviceLayout`] | 200 `{}` | 400 형식, 401 |
//! | `GET /api/device/workspaces/{workspace_id}/agent` | 같음 | 없음 | 200 [`DeviceAgentReply`] | 401 |
//! | `POST /api/device/workspaces/{workspace_id}/agent` | 같음 | [`AgentCreateRequest`] | 200 [`crate::AgentInfo`] | 400 모르는 모델, 401, 502 소울스트림 실패 |
//! | `POST /api/device/workspaces/{workspace_id}/agent/messages` | 같음 | [`AgentSendRequest`] | 200 `{}` | 400 빈 글이나 너무 김, 401, 404 PAS 없음, 502 |
//! | `GET /api/health` | 없음 | 없음 | 200 `{"ok":true}` | |
//!
//! 실패 본문은 모두 [`CoreError`] JSON이다. 검사 실패(400)는 [`crate::validate::parse_app_definition`]의 오류
//! 그대로이고(`invalid_app_definition`, `unsupported_app`), 401, 404, 429와 서버 오류는 code `server`에 한국어 설명이다.
//! 예외: 워크스페이스 PAS 경로의 400은 code `invalid_request`, 404는 `not_found`다. 코어는 이 둘을 그대로
//! 화면에 돌려주고, 그 밖의 실패는 `server`로 바꾼다.
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
//! - 이벤트에 `workspace_id`가 있으면 그 값을 `app.open_requested`에 그대로 싣는다. 이 기기에 없는
//!   워크스페이스면 띄우기 요청을 넘긴다(앱 캐시 반영은 그대로 한다). 서버는 `workspace_id`가 있는 띄우기와
//!   `agent.update`를 그 워크스페이스를 마지막 배치 보고에 담은 기기에만 보내고, 다른 기기에는 `app.published`를
//!   `open: false`, `workspace_id` 없이 보내 캐시만 맞춘다. 배치 보고를 모르는 옛 쉘에 엉뚱한 창이 뜨지 않게 하려는 것이다.
//!
//! # 배치 보고
//! 에이전트가 「지금 펼친 데스크톱에 어떤 창이 무엇을 보고 있는지」를 MCP로 읽을 수 있게, 연결한 코어는
//! 자기 워크스페이스, 데스크톱, 창 배치를 서버에 알린다(기기 사이 동기화 전까지 정본은 여전히 코어다).
//! - 코어는 `connected`가 될 때마다 한 번, 그 뒤로는 [`DeviceLayout`]에 담길 값이 바뀔 때마다 보낸다.
//!   바뀐 뒤 [`LAYOUT_DEBOUNCE_MS`] 동안 더 바뀌지 않으면 보내고, 마지막으로 보낸 것과 같으면 보내지 않는다.
//!   실패하면 연결이 이어져 있는 동안 [`LAYOUT_RETRY_SECS`] 뒤에 다시 보낸다.
//! - 서버는 기기마다 마지막 보고 하나를 통째로 바꿔 둔다.
//! - 고른 폴더의 절대 경로는 보내지 않는다. 폴더 이름만 보낸다(`root_name`).
//!
//! # 워크스페이스 PAS
//! 워크스페이스마다 소울스트림 퍼시스턴트 세션 하나를 서버가 만들어 묶는다. 소울스트림 서비스 토큰은
//! 서버의 설정에만 있고 코어와 화면은 소울스트림을 모른다.
//!
//! 서버가 지키는 것:
//! - 묶음은 `workspace_id` 하나에 PAS 하나다. 만든 기기를 함께 적어 둔다.
//! - 만들기(`POST .../agent`): 이미 있으면 그대로 돌려준다. 없으면 [`AGENT_MODELS`]에서 고른 모델부터,
//!   그다음 나머지를 [`AGENT_MODELS`] 순서로 시도한다. 소울스트림이 모델을 지금 쓸 수 없다고 거부하면
//!   (422 `INVALID_MODEL_PRESET`) 다음 모델로 가고, 고른 것과 다른 모델로 만들었으면 `notice` 기록을 남긴다.
//!   대체 순서(소울스트림 `fallback_models`)는 만든 모델을 뺀 나머지를 [`AGENT_MODELS`] 순서로 둔다.
//!   만든 직후 PAS가 첫 인사 턴을 돌므로 `busy`는 참으로 시작한다. 모든 기기에 `created`를 보낸다.
//! - 보내기(`POST .../agent/messages`): 소울스트림 세션에 개입으로 보낸다. 사용자 기록은 여기서 만들지 않고
//!   PAS의 이벤트에서 확인한 뒤 만든다(소울스트림 화면에서 보낸 말도 같은 길로 들어온다).
//! - 중계: 서버는 묶은 PAS마다 소울스트림 세션 이벤트 스트림을 이어 두고(마지막으로 처리한 이벤트 번호부터),
//!   아래처럼 바꿔 기록하고 모든 기기에 `agent.update`로 보낸다. 나머지 이벤트는 버린다.
//!   - 사용자 말(소울스트림 `user_message`와, 진행 중인 턴에 들어간 `intervention_sent`): 사람(쉘, 소울스트림 웹과 앱, 슬랙)이 보낸 것만 `user` 기록이 되고 `busy`가 참이 된다.
//!     처음 지시와 캐시 유지 호출처럼 시스템이 넣은 말은 기록하지 않는다.
//!   - 답의 조각: `delta`로 보낸다. 캐시 유지 호출의 답(`[SILENT]`)과 그 앞부분은 보내지 않는다.
//!   - 답 한 덩이: `assistant` 기록. `[SILENT]`이면 기록하지 않는다.
//!   - 도구 시작과 끝: `activity`(busy 참, 도구 이름이나 null).
//!   - 턴 끝: `activity`(busy 거짓).
//!   - 턴 실패: `error` 기록과 `activity`(busy 거짓).
//! - 기록은 서버에 남고, `GET .../agent`는 최근 [`AGENT_HISTORY_LIMIT`]개를 오래된 것부터 준다.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{AgentInfo, AgentItem, AgentModel, AgentUpdate, App, AppVersion, AppWindow, Desktop, Workspace};

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

pub const DEVICE_LAYOUT_PATH: &str = "/api/device/layout";

/// 워크스페이스 PAS 경로. `{workspace_id}` 자리에 워크스페이스 id를 넣는다.
pub fn device_agent_path(workspace_id: &str) -> String {
    format!("/api/device/workspaces/{workspace_id}/agent")
}

/// 워크스페이스 PAS에 말을 보내는 경로.
pub fn device_agent_messages_path(workspace_id: &str) -> String {
    format!("/api/device/workspaces/{workspace_id}/agent/messages")
}

/// 배치가 바뀐 뒤 이만큼 더 바뀌지 않으면 보고한다.
pub const LAYOUT_DEBOUNCE_MS: u64 = 1000;
/// 배치 보고가 실패하면 이만큼 뒤에 다시 보낸다.
pub const LAYOUT_RETRY_SECS: u64 = 10;
/// `GET .../agent`가 주는 대화 기록의 최대 개수.
pub const AGENT_HISTORY_LIMIT: usize = 200;
/// 한 번에 보낼 수 있는 글의 최대 글자 수(앞뒤 공백을 뺀 뒤, 유니코드 문자 단위).
pub const AGENT_MESSAGE_MAX_CHARS: usize = 20_000;

/// 워크스페이스 PAS를 만들 때 고를 수 있는 모델(소울스트림 preset id, 화면 이름). 순서가 대체 순서다.
/// 추론 등급은 정하지 않고 preset의 기본값을 쓴다. 쉘이 처음 고르는 값은 맨 앞이다.
pub const AGENT_MODELS: &[(&str, &str)] = &[
    ("gemini-4-argon", "Argon"),
    ("claude-opus", "Opus"),
    ("codex-6.1-sol", "Sol"),
];

/// [`AGENT_MODELS`]를 화면에 줄 모양으로.
pub fn agent_models() -> Vec<AgentModel> {
    AGENT_MODELS
        .iter()
        .map(|(preset, label)| AgentModel {
            preset: (*preset).to_string(),
            label: (*label).to_string(),
        })
        .collect()
}

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

/// 코어가 알리는 이 기기의 배치. 「배치 보고」 절.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceLayout {
    pub workspaces: Vec<Workspace>,
    pub desktops: Vec<Desktop>,
    pub windows: Vec<AppWindow>,
    /// 창마다 고른 폴더의 이름.
    pub folders: Vec<LayoutFolder>,
    pub active_workspace_id: Option<String>,
    /// 워크스페이스 id → 그 워크스페이스에서 마지막으로 본 데스크톱 id.
    pub active_desktop_ids: BTreeMap<String, String>,
}

/// 창의 권한 하나에 고른 폴더의 이름. 절대 경로는 담지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutFolder {
    pub window_id: String,
    pub permission: String,
    pub root_name: String,
}

/// 워크스페이스 PAS의 지금 모습과 기록. 화면의 `agent.get` 응답과 같은 것을 담는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceAgentReply {
    pub agent: Option<AgentInfo>,
    pub items: Vec<AgentItem>,
    pub models: Vec<AgentModel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentCreateRequest {
    /// 소울스트림 세션 이름과 PAS에게 주는 지시에 쓴다.
    pub workspace_name: String,
    pub model_preset: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentSendRequest {
    pub text: String,
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
    /// `workspace_id`는 에이전트가 띄울 워크스페이스를 정했을 때만 있다.
    #[serde(rename = "app.published")]
    AppPublished {
        app: RegistryApp,
        open: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workspace_id: Option<String>,
    },
    /// 에이전트가 이미 있는 앱을 띄워 달라고 했다.
    #[serde(rename = "app.open")]
    AppOpen {
        app_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workspace_id: Option<String>,
    },
    /// 워크스페이스 PAS에 일어난 일. 「워크스페이스 PAS」 절.
    #[serde(rename = "agent.update")]
    AgentUpdate {
        workspace_id: String,
        update: AgentUpdate,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_event_uses_event_tag() {
        let event = DeviceEvent::AppOpen {
            app_id: "md-editor".into(),
            workspace_id: None,
        };
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"event":"app.open","app_id":"md-editor"}"#
        );
        let parsed: DeviceEvent =
            serde_json::from_str(r#"{"event":"apps.snapshot","apps":[]}"#).unwrap();
        assert_eq!(parsed, DeviceEvent::AppsSnapshot { apps: vec![] });
        let targeted: DeviceEvent =
            serde_json::from_str(r#"{"event":"app.open","app_id":"a","workspace_id":"w"}"#).unwrap();
        assert_eq!(
            targeted,
            DeviceEvent::AppOpen {
                app_id: "a".into(),
                workspace_id: Some("w".into())
            }
        );
    }

    #[test]
    fn agent_update_event_round_trips() {
        let event = DeviceEvent::AgentUpdate {
            workspace_id: "w".into(),
            update: AgentUpdate::Delta { text: "안".into() },
        };
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(
            json,
            r#"{"event":"agent.update","workspace_id":"w","update":{"kind":"delta","text":"안"}}"#
        );
        assert_eq!(serde_json::from_str::<DeviceEvent>(&json).unwrap(), event);
    }

    #[test]
    fn agent_paths_and_models() {
        assert_eq!(device_agent_path("w1"), "/api/device/workspaces/w1/agent");
        assert_eq!(
            device_agent_messages_path("w1"),
            "/api/device/workspaces/w1/agent/messages"
        );
        let models = agent_models();
        assert_eq!(models.first().map(|m| m.preset.as_str()), Some("gemini-4-argon"));
        assert_eq!(models.len(), AGENT_MODELS.len());
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
