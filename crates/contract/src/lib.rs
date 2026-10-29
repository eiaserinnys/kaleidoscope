//! kaleidoscope 코어와 화면 사이 계약 (계약 5판, 261030)
//!
//! 이 파일 하나가 코어(Rust)와 화면(TS) 양쪽 타입의 정본이다. TS 타입은
//! `cargo test -p kaleidoscope-contract`가 `ui/src/contract/contract.ts`로 생성한다.
//! 화면이 지키는 한도 상수는 같은 테스트가 `ui/src/contract/limits.ts`로 생성한다.
//! 생성된 TS는 손으로 고치지 않는다. 계약을 바꾸려면 이 파일을 고치고 다시 생성한다.
//!
//! 같은 크레이트에 둘이 더 있다.
//! - [`validate`]: 앱 정의 검사. 코어(가져오기)와 오케스트레이터(에이전트가 올릴 때)가 같이 쓴다.
//! - [`registry`]: 코어와 오케스트레이터 사이 HTTP 약속(기기 연결, 앱 올리기, 이벤트 스트림).
//!
//! 2판에서 바뀐 것: 오케스트레이터 연결 상태 [`LinkStatus`]와 `link.*` 명령, 연결했을 때 `app.import`가
//! 오케스트레이터를 거치는 것, 에이전트가 앱을 띄워 달라고 할 때의 `app.open_requested` 이벤트,
//! 오류 코드 `server`.
//!
//! 3판에서 바뀐 것(워크스페이스 PAS, 카드 #779): 블록 세트 2판(`agent_chat` 블록)과 모듈 `agent` 1판,
//! `agent.*` 명령과 `agent.update` 이벤트, `app.open_requested`의 `workspace_id`.
//! 워크스페이스 PAS는 워크스페이스마다 하나인 소울스트림 퍼시스턴트 세션이고, 오케스트레이터가 만들고
//! 대화를 중계한다. 소울스트림 토큰은 오케스트레이터에만 있다. 서버 쪽 약속은 [`registry`]의
//! 「워크스페이스 PAS」 절에 있다.
//!
//! 4판에서 바뀐 것(PAS 첨부, 카드 #807): 모듈 `agent` 2판. `agent.send`의 `attachments`, 기록의
//! [`AgentItem::attachments`], 첨부를 읽는 `agent.attachment`와 기기의 기본 앱으로 여는
//! `agent.attachment_open`. 블록 세트는 2판 그대로다(`agent_chat`의 정의는 같고, 이 쉘의 대화 블록에
//! 첨부 단추와 붙여넣기가 붙는다). 한도는 [`AGENT_ATTACHMENTS_MAX`] 등 세 상수다.
//!
//! 5판에서 바뀐 것(웹 화면과 탐색기, 카드 #806): 블록 세트 3판(`web_view`, `explorer` 블록)과 모듈 `web` 1판,
//! 앱 정의의 `opens`(이 앱이 여는 파일 확장자), `files.open`과 `web.*` 명령, `web.update` 이벤트,
//! 오류 코드 `unavailable`. 블록마다 처음 생긴 판보다 낮은 `requires.blocks`로 그 블록을 쓰면 거부한다.
//! 서버는 기기마다 그 쉘이 그릴 수 있는 앱만 보낸다([`registry`]의 「기기마다 그릴 수 있는 앱만」 절).
//!
//! # 전송
//! - 화면은 명령 하나로 [`CoreRequest`]를 보내고 [`CoreReply`]를 받거나 [`CoreError`]로 실패를 받는다.
//! - 코어는 이벤트 채널 하나로 [`CoreEvent`]를 보낸다.
//! - Tauri: 명령 이름 [`TAURI_COMMAND`], 인자 `{ request: CoreRequest }`. 실패는 promise reject로 CoreError가 온다.
//!   이벤트 이름 [`TAURI_EVENT`], payload는 CoreEvent.
//! - 개발용 HTTP 다리(브라우저 검증용, 127.0.0.1만): `POST /core` 본문 CoreRequest, 성공 200 CoreReply,
//!   실패 400 CoreError. `GET /events`는 SSE이고 `data:` 한 줄이 CoreEvent 하나다.
//! - 어느 전송이든 JSON은 같다. 전송을 바꿔도 이 계약은 바뀌지 않는다.
//!
//! # JSON 규칙
//! - 필드 이름은 snake_case다.
//! - 식별자는 문자열이다. 워크스페이스, 데스크톱, 창의 id는 코어가 만든다(UUID). 앱 id는 앱 정의가 정한다.
//! - 시각은 RFC 3339 UTC 문자열이다(예: `2026-10-28T11:27:04Z`).
//! - 파일 경로는 고른 폴더 기준 상대 경로이고 구분자는 `/`다. 규칙은 [`FileRef`]에 있다.
//!
//! # 화면의 상태 저장소
//! 화면이 보는 상태는 [`ShellSnapshot`] 하나다. 화면은 `state.get` 응답과 `state.changed` 이벤트의
//! snapshot으로만 저장소를 바꾼다. 명령의 응답은 방금 만든 것의 id를 알 때만 쓴다.
//! 코어는 공유 상태나 기기 상태를 바꾸는 명령이 성공할 때마다 `state.changed`를 보낸다.
//! 파일 읽기, 목록, 쓰기는 상태를 바꾸지 않으므로 이벤트가 없다.
//!
//! # 저장과 동기화 경계
//! - [`SharedState`]: 앱 레지스트리, 워크스페이스, 데스크톱, 앱 창. 코어가 앱 데이터 폴더의 `state.json`에 둔다.
//!   - 앱과 앱 버전: 오케스트레이터에 연결했으면 오케스트레이터 레지스트리가 정본이고 `state.json`은 그
//!     캐시다. 코어는 레지스트리의 앱마다 지금 버전 하나만 캐시에 둔다(창은 늘 지금 버전을 그리므로).
//!     연결하지 않았으면 1판처럼 코어가 정본이다.
//!   - 워크스페이스, 데스크톱, 앱 창: 아직 코어가 정본이다. 기기 사이 동기화는 다음 단계다.
//! - [`DeviceState`]: 지금 고른 워크스페이스와 데스크톱, 고른 폴더. 그 기기의 `device.json`에만 둔다.
//! - 오케스트레이터 연결 정보(서버 주소, 기기 id, 기기 토큰)는 그 기기의 `link.json`에만 두고 화면에
//!   보내지 않는다. 화면은 [`LinkStatus`]만 본다.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod registry;
pub mod validate;

/// 창 상태와 앱 정의의 상태 기본값에 쓰는 임의 JSON 값.
pub type JsonValue = serde_json::Value;

/// Tauri 명령 이름. 화면은 `invoke("core", { request })`로 부른다.
pub const TAURI_COMMAND: &str = "core";
/// Tauri 이벤트 이름. 화면은 `listen("core-event", ...)`로 받는다.
pub const TAURI_EVENT: &str = "core-event";

/// 이 쉘이 그릴 수 있는 블록 세트 버전. 블록 세트 전체에 정수 하나다.
///
/// 호환 규칙: 블록 세트의 새 판은 블록을 더하기만 한다. 있던 블록의 필드와 동작은 바꾸지 않으므로
/// `requires.blocks`가 이 값 이하인 정의는 모두 그대로 그린다. 있던 블록을 바꿔야 하면 그때 다시 정한다.
/// - 1판: `split`, `file_tree`, `markdown_editor`, `markdown_view`.
/// - 2판: 1판 + `agent_chat`.
/// - 3판: 2판 + `web_view`, `explorer`, 앱 정의의 `opens`.
pub const BLOCK_SET_VERSION: u32 = 3;
/// 이 쉘이 제공하는 모듈과 버전.
/// - `files` 1판: 기기마다 고른 폴더의 파일 목록, 읽기, 쓰기, 탐색기에서 다른 앱으로 열기(`files.open`).
/// - `agent` 1판: 창이 있는 워크스페이스의 PAS와 대화(`agent.*` 명령).
/// - `agent` 2판: 1판 + 첨부(보내기, 기록에서 보기와 열기). 모듈의 새 판도 더하기만 하므로
///   `agent: 1`을 요구하는 정의는 2판 쉘에서 그대로 돌고 첨부도 쓴다.
/// - `web` 1판: 창 안에 웹 페이지를 띄우는 웹 화면(`web.*` 명령). 쉘이 그린 화면 위에 따로 뜬다.
pub const MODULE_VERSIONS: &[(&str, u32)] = &[("files", 1), ("agent", 2), ("web", 1)];

/// 지원 범위를 알리지 않는 옛 쉘(블록 세트 3판 전)이 그릴 수 있는 블록 세트 판. 서버가 그런 기기에 보낼 앱을
/// 거를 때 쓴다([`registry`]의 「기기마다 그릴 수 있는 앱만」 절).
pub const LEGACY_BLOCK_SET_VERSION: u32 = 2;

/// 창 상태 하나를 JSON으로 직렬화했을 때의 최대 바이트 수.
pub const WINDOW_STATE_MAX_BYTES: usize = 64 * 1024;
/// `files.read`가 읽는 파일의 최대 바이트 수.
pub const FILE_READ_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// 말 하나에 붙일 수 있는 첨부의 최대 개수.
pub const AGENT_ATTACHMENTS_MAX: usize = 10;
/// 첨부 파일 하나의 최대 바이트 수(base64로 바꾸기 전). `agent.attachment`로 읽을 수 있는 크기도 같다.
pub const AGENT_ATTACHMENT_MAX_BYTES: u64 = 20 * 1024 * 1024;
/// 말 하나에 붙인 첨부의 합의 최대 바이트 수(base64로 바꾸기 전).
pub const AGENT_ATTACHMENTS_TOTAL_MAX_BYTES: u64 = 30 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 엔티티 (2단계 오케스트레이터 레지스트리와 같은 모양)
// ---------------------------------------------------------------------------

/// 레지스트리의 앱 항목. 버전이 쌓이고 `current_version`이 지금 쓰는 버전을 가리킨다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct App {
    /// 앱 정의의 `id`.
    pub id: String,
    /// 지금 쓰는 버전의 정의에 있는 `name`.
    pub name: String,
    /// 지금 쓰는 버전 번호.
    pub current_version: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// 앱 버전. 한 번 저장하면 바뀌지 않는다. 번호는 앱마다 1부터 1씩 는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AppVersion {
    pub app_id: String,
    pub version: u32,
    pub definition: AppDefinition,
    pub created_at: String,
}

/// 작업 주제 하나. 데스크톱 여러 장을 가진다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 화면 한 장. 앱 창 배치를 가진다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct Desktop {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    /// 워크스페이스 안의 순서. 0부터.
    pub position: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// 앱 하나의 실행. 데스크톱 위의 창 하나다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AppWindow {
    pub id: String,
    pub desktop_id: String,
    pub app_id: String,
    /// 이 창이 그리는 앱 버전. 앱의 새 버전을 가져오면 코어가 그 앱의 열린 창을 새 버전으로 옮긴다.
    pub app_version: u32,
    /// 데스크톱 영역 기준 위치와 크기(CSS px).
    pub rect: Rect,
    /// 겹침 순서. 클수록 위다. 데스크톱 안에서만 비교한다.
    pub z: u32,
    /// 창 상태. 키는 앱 정의의 `state`에 선언된 것뿐이다. 열린 파일 같은 것을 담는다.
    pub state: BTreeMap<String, JsonValue>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 이 기기에서 앱 창의 권한 하나에 고른 폴더. 기기 밖으로 나가지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct Grant {
    pub window_id: String,
    /// 앱 정의의 권한 `id`.
    pub permission: String,
    /// 고른 폴더의 절대 경로(이 기기의 표기 그대로).
    pub root_path: String,
    /// 고른 폴더의 이름. 화면에 보일 때 쓴다.
    pub root_name: String,
    pub granted_at: String,
}

/// 기기 사이에 맞출 상태. 2단계 동기화의 단위다.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct SharedState {
    pub apps: Vec<App>,
    pub app_versions: Vec<AppVersion>,
    pub workspaces: Vec<Workspace>,
    pub desktops: Vec<Desktop>,
    pub windows: Vec<AppWindow>,
}

/// 이 기기에만 두는 상태.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct DeviceState {
    pub active_workspace_id: Option<String>,
    /// 워크스페이스 id → 그 워크스페이스에서 마지막으로 본 데스크톱 id.
    pub active_desktop_ids: BTreeMap<String, String>,
    pub grants: Vec<Grant>,
}

/// 이 쉘이 지원하는 블록 세트와 모듈의 버전.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct Supported {
    pub blocks: u32,
    pub modules: BTreeMap<String, u32>,
}

impl Supported {
    /// 이 빌드의 지원 범위.
    pub fn current() -> Self {
        Supported {
            blocks: BLOCK_SET_VERSION,
            modules: MODULE_VERSIONS
                .iter()
                .map(|(name, version)| (name.to_string(), *version))
                .collect(),
        }
    }

    /// 이 지원 범위의 쉘이 `requires`를 요구하는 앱을 그릴 수 있는가. 블록 세트 판이 이 값 이하이고,
    /// 요구한 모듈을 모두 알며 판이 이 값 이하여야 한다.
    pub fn renders(&self, requires: &Requires) -> bool {
        requires.blocks <= self.blocks
            && requires.modules.iter().all(|(name, version)| {
                self.modules
                    .get(name)
                    .is_some_and(|supported| version <= supported)
            })
    }
}

/// 화면이 보는 상태 전체.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ShellSnapshot {
    pub shared: SharedState,
    pub device: DeviceState,
    pub supported: Supported,
    pub link: LinkStatus,
}

/// 이 기기와 오케스트레이터의 연결 상태. `state`로 가른다.
///
/// 흐름: `unlinked` → (`link.start`) `pairing` → (에이전트가 코드를 승인) `connected` ⇄ `offline`.
/// 승인 전에 코드가 만료되거나 `link.cancel`이면 `unlinked`로 돌아간다. 서버가 기기 토큰을 거부하면
/// `revoked`이고, 다시 `link.start`로 연결한다. `link.unlink`는 어느 상태에서든 `unlinked`로 간다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum LinkStatus {
    /// 연결하지 않았다. 앱은 이 기기에만 있고 `app.import`는 1판처럼 로컬로 가져온다.
    Unlinked {},
    /// 연결 코드를 받아 에이전트의 승인을 기다린다. 코어가 `interval_secs`마다 승인 여부를 묻는다.
    Pairing {
        server_url: String,
        /// 사람이 읽고 에이전트에게 전하는 코드. 예: `K7PQ-4XMR`.
        user_code: String,
        expires_at: String,
    },
    /// 연결했고 이벤트 스트림이 이어져 있다. 레지스트리의 앱이 캐시와 맞춰져 있다.
    Connected {
        server_url: String,
        device_name: String,
    },
    /// 연결했지만 지금 서버에 닿지 않는다(시작 직후 포함). 코어가 다시 잇는다. 캐시의 앱은 그대로 쓴다.
    Offline {
        server_url: String,
        device_name: String,
        /// 마지막으로 실패한 까닭. 사람이 읽는 한국어 한 줄.
        reason: String,
    },
    /// 서버가 이 기기의 토큰을 거부했다(에이전트가 기기 연결을 끊음 등). 캐시의 앱은 그대로 쓴다.
    Revoked { server_url: String },
}

// ---------------------------------------------------------------------------
// 앱 정의 (블록 세트 3판)
// ---------------------------------------------------------------------------

/// 앱 정의. 에이전트가 쓰는 JSON 문서이고, 가져오면 앱 버전 하나가 된다.
///
/// 가져오기(`app.import`)에서 코어가 확인하는 것:
/// 1. `requires`를 먼저 읽어, 블록 세트 버전이 이 쉘보다 높거나 모르는 모듈이거나 모듈 버전이 높으면
///    `unsupported_app`으로 거부한다. 형식 검사보다 먼저 해서 더 새 쉘이 필요한 앱을 알아보게 한다.
/// 2. 모르는 필드, 모르는 블록 `type`, 빠진 필드는 `invalid_app_definition`으로 거부한다.
/// 3. 아래 의미 검사에 걸리면 `invalid_app_definition`으로 거부하고, 걸린 것을 모두 `details`에 담는다.
///    - `id`와 권한 `id`는 소문자, 숫자, `-`로 1~64자. 권한 `id`는 겹치지 않는다. `name`은 비어 있지 않다.
///    - 권한의 `module`은 `requires.modules`에 있어야 한다.
///    - 블록이 가리키는 권한(`permission`)은 선언되어 있고 `files` 모듈이다.
///    - `markdown_editor`가 가리키는 권한은 `readwrite`다.
///    - 블록이 읽고 쓰는 상태 키(`state`, `set_state`)는 정의의 `state`에 선언되어 있다.
///    - 정의에 직접 적은 경로(문자열 `path`)는 [`FileRef`]의 경로 규칙을 지킨다. 어기면 고른 폴더 밖을
///      요구하는 정의로 보고 거부한다.
///    - `split`의 `children`은 둘 이상이고, `sizes`가 있으면 개수가 같고 모두 0보다 크다.
///    - `agent_chat`을 쓰면 `requires.modules`에 `agent`가 있다.
///    - 쓴 블록마다 처음 생긴 판([`Block::introduced_in`]) 이상을 `requires.blocks`에 적는다.
///      `opens`를 쓰면 `requires.blocks`가 3 이상이다.
///    - `web_view`는 정의에 하나까지이고, 쓰면 `requires.modules`에 `web`이 있다. 정의에 직접 적은 주소는
///      `http://`나 `https://`로 시작하고 공백이 없다.
///    - `opens`의 확장자는 하나 이상이고 각각 소문자와 숫자 1~16자이며, 권한과 상태 키는 선언되어 있다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppDefinition {
    /// 앱 식별자. 같은 id를 다시 가져오면 그 앱의 새 버전이 된다.
    pub id: String,
    /// 화면에 보이는 이름.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub requires: Requires,
    #[serde(default)]
    pub permissions: Vec<PermissionDecl>,
    /// 창 상태의 키와 기본값. 창을 열 때 이 값으로 시작한다.
    #[serde(default)]
    pub state: BTreeMap<String, JsonValue>,
    /// (블록 세트 3판) 이 앱이 여는 파일. 탐색기(`explorer` 블록)에서 이 확장자의 파일을 열면 이 앱의 창이
    /// 뜬다. 규칙은 `files.open`에 있다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub opens: Option<OpensDecl>,
    /// 창 안을 채우는 블록 트리의 뿌리.
    pub ui: Block,
}

/// 앱이 여는 파일의 선언. 예: `{ "extensions": ["md"], "permission": "docs", "state": "current_file" }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct OpensDecl {
    /// 여는 파일 확장자(점 없이, 소문자). 하나 이상.
    pub extensions: Vec<String>,
    /// 탐색기의 폴더를 이어 받을 `files` 권한 id. 파일을 열면 이 권한에 탐색기와 같은 폴더를 고른 것이 된다.
    pub permission: String,
    /// 연 파일의 경로(그 폴더 기준 상대 경로)를 쓸 상태 키. 블록은 이 키로 그 파일을 연다.
    pub state: String,
}

/// 앱이 필요로 하는 블록 세트와 모듈의 버전.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct Requires {
    pub blocks: u32,
    #[serde(default)]
    pub modules: BTreeMap<String, u32>,
}

/// 앱이 쓰겠다고 선언하는 권한. 실제로 허락하는 것은 기기마다 사용자다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "module", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum PermissionDecl {
    /// 기기마다 사용자가 고르는 폴더 하나. 파일 경로는 그 폴더 안으로만 풀린다.
    Files {
        id: String,
        access: FileAccess,
        /// 폴더를 고르라고 할 때 보일 이름(예: "문서 폴더").
        label: String,
    },
}

impl PermissionDecl {
    pub fn id(&self) -> &str {
        match self {
            PermissionDecl::Files { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum FileAccess {
    /// 목록과 읽기.
    Read,
    /// 목록, 읽기, 쓰기.
    Readwrite,
}

/// 블록. 블록 세트 3판의 전부다. 새 블록은 쉘 릴리스로만 더한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum Block {
    /// 자식 블록을 나란히 놓는다. 경계를 끌어 크기를 바꿀 수 있다(바꾼 크기는 저장하지 않는다).
    Split {
        direction: SplitDirection,
        /// 자식마다의 상대 크기. 없으면 똑같이 나눈다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        sizes: Option<Vec<f64>>,
        children: Vec<Block>,
    },
    /// 고른 폴더의 파일 트리. 폴더를 아직 안 골랐으면 폴더 고르기를 보인다.
    /// 파일을 누르면 그 경로를 `on_select`의 상태 키에 쓴다. 폴더는 펼치고 접기만 한다.
    /// 쉘 창이 포커스를 다시 얻으면 펼친 폴더를 다시 읽는다(다른 곳에서 생긴 파일이 보이게).
    FileTree {
        root: FolderRef,
        /// 보일 파일 확장자(점 없이, 소문자). 비어 있으면 모든 파일. 폴더는 늘 보인다.
        #[serde(default)]
        extensions: Vec<String>,
        /// 선택 표시에 쓸 상태 키.
        selected: StateRef,
        on_select: SetState,
    },
    /// 마크다운 원문 편집기. `file`이 가리키는 파일을 읽어 보이고, 원문을 그대로 쓴다.
    /// 자동 저장: 입력을 멈추고 1초 뒤, 다른 파일로 바뀌기 전, Ctrl+S에 저장한다. 저장은 읽은 revision을
    /// 함께 보내고, 그 사이 디스크에서 바뀌었으면(`conflict`) 다시 불러오기와 덮어쓰기를 고르게 한다.
    /// 고치지 않은 상태에서 쉘 창이 포커스를 다시 얻으면 파일을 다시 읽는다. 경로가 null이면 빈 상태를 보인다.
    MarkdownEditor { file: FileRef },
    /// 마크다운을 렌더해서 읽기만 한다. 원문의 HTML은 그리지 않는다.
    /// 쉘 창이 포커스를 다시 얻으면 파일을 다시 읽는다. 경로가 null이면 빈 상태를 보인다.
    MarkdownView { file: FileRef },
    /// (블록 세트 2판) 이 창이 있는 워크스페이스의 PAS와 나누는 대화. `requires.modules`에 `agent`가
    /// 있어야 한다. 창마다 설정할 것이 없다. 같은 워크스페이스의 대화 창은 모두 같은 PAS를 본다.
    /// - 서버에 연결하지 않았으면 연결하라는 빈 상태를 보인다.
    /// - 그 워크스페이스에 PAS가 없으면 모델을 고르고 시작하는 판을 보인다(`agent.create`).
    /// - PAS가 있으면 대화 기록과 진행 중인 답을 보이고, 아래 입력창으로 보낸다(`agent.send`).
    ///   Enter는 보내기, Shift+Enter는 줄바꿈이다. 한글 조합 중의 Enter는 보내지 않는다.
    /// - 답은 마크다운으로 렌더한다. HTML은 그리지 않고 링크를 눌러도 쉘이 다른 곳으로 가지 않는다.
    /// - (모듈 `agent` 2판) 입력 줄의 첨부 단추로 파일을 고르거나 입력창에 클립보드 이미지를 붙여 넣으면
    ///   보낼 첨부로 쌓인다. 첨부가 있으면 글 없이도 보낸다. 기록의 사용자 말에 첨부가 보이고, 이미지는
    ///   눌러 크게 보고 다른 파일은 눌러 기기의 기본 앱으로 연다.
    AgentChat {},
    /// (블록 세트 3판) 웹 페이지 하나를 띄우는 웹 화면. `requires.modules`에 `web`이 있어야 하고 정의에
    /// 하나까지 둘 수 있다. 위에 뒤로, 앞으로, 새로고침 단추와 페이지 제목 줄이 있고, `address_bar`면 제목 자리에
    /// 주소창이 온다(Enter로 이동, scheme이 없으면 `https://`를 붙이고 주소로 보이지 않는 글은 검색한다).
    ///
    /// - 처음 열 때 `url`의 주소를 연다(`web.attach`). 그 뒤 `url`이 가리키는 값이 바뀌어 지금 페이지와 다르면
    ///   그 주소로 간다. 값이 `http://`나 `https://` 주소가 아니면 빈 상태를 보인다.
    /// - 페이지가 다른 주소로 가면 코어가 그 주소를 `on_navigate`의 상태 키에 쓴다. 창을 다시 열거나 다른 기기에서
    ///   열어도 보던 곳에서 이어 보게 하려는 것이다.
    /// - 웹 화면은 쉘이 그린 화면 위에 따로 뜨는 화면이라, 쉘이 그린 것(위에 있는 다른 창, 메뉴, 팝오버)을 그 위에
    ///   그릴 수 없다. 그래서 그런 것이 웹 화면에 조금이라도 겹치면 화면은 그 순간을 찍은 정지 화면으로 바꿔 보이고
    ///   (`web.capture`, 웹 화면은 숨김), 겹친 것이 사라지면 다시 살아 있는 웹 화면을 보인다. 정지 화면을 누르면
    ///   창이 맨 위로 올라와 살아난다. 자기 창을 끌거나 크기를 바꾸는 동안에는 살아 있는 채로 따라간다.
    ///   보이지 않는 데스크톱의 웹 화면은 숨기되 닫지 않는다(돌아오면 보던 페이지 그대로다).
    /// - 웹 화면은 `http`와 `https`만 연다. 다른 scheme(쉘 자신의 주소, `file`, `javascript` 등)으로 가는 이동은
    ///   막는다. 새 창을 여는 링크와 `window.open`은 같은 웹 화면에서 연다. 웹 화면의 페이지는 코어 명령에 닿지 않는다.
    /// - 이 쉘이 웹 화면을 띄울 수 없으면(개발용 HTTP 다리 등, `unavailable`) 그렇다는 빈 상태를 보인다.
    WebView {
        /// 열 주소. 상태에서 읽거나(`{ "state": "url" }`) 정의에 적는다(`"https://example.com"`).
        url: UrlValue,
        /// 페이지가 다른 주소로 가면 그 주소를 쓸 상태 키.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_navigate: Option<SetState>,
        /// 주소창을 보일지. 거짓이면 그 자리에 페이지 제목만 보인다(정해진 사이트를 띄우는 앱).
        #[serde(default)]
        address_bar: bool,
    },
    /// (블록 세트 3판) 고른 폴더의 파일을 모두 보이는 탐색기. 폴더를 아직 안 골랐으면 폴더 고르기를 보인다.
    ///
    /// - 폴더는 펼치고 접는다. 파일을 누르면 고르기만 한다(창 상태에 쓰지 않는다).
    /// - 파일을 두 번 누르거나 고른 채 Enter를 누르면 그 확장자를 여는 앱(지금 버전 정의의 `opens`)으로 연다
    ///   (`files.open`). 여는 앱이 하나면 바로 열고, 여럿이면 앱 이름순 메뉴로 고르게 하고, 없으면 그 메뉴에 열 수
    ///   있는 앱이 없다고 보인다. 파일의 오른쪽 클릭 메뉴도 같은 앱 목록이다.
    /// - 쉘 창이 포커스를 다시 얻으면 펼친 폴더를 다시 읽는다.
    Explorer { root: FolderRef },
}

impl Block {
    /// 이 블록이 처음 생긴 블록 세트 판. 정의의 `requires.blocks`는 쓴 블록의 이 값 이상이어야 한다.
    pub fn introduced_in(&self) -> u32 {
        match self {
            Block::Split { .. }
            | Block::FileTree { .. }
            | Block::MarkdownEditor { .. }
            | Block::MarkdownView { .. } => 1,
            Block::AgentChat {} => 2,
            Block::WebView { .. } | Block::Explorer { .. } => 3,
        }
    }
}

/// 주소 값. 창 상태에서 읽거나(`{ "state": "url" }`) 정의에 직접 적는다(`"https://example.com"`).
/// 상태 값이 null이거나 문자열이 아니면 열 주소가 없는 것이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum UrlValue {
    State(StateRef),
    Literal(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum SplitDirection {
    /// 좌우로 나눈다.
    Row,
    /// 위아래로 나눈다.
    Column,
}

/// 창 상태 키 하나를 읽는다. 예: `{ "state": "current_file" }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StateRef {
    pub state: String,
}

/// 블록 이벤트의 값을 창 상태 키 하나에 쓴다. 예: `{ "set_state": "current_file" }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct SetState {
    pub set_state: String,
}

/// 권한 하나가 가리키는 폴더(고른 폴더 자체).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct FolderRef {
    pub permission: String,
}

/// 권한 하나의 폴더 안 파일 하나.
///
/// 경로 규칙(정의에 적은 경로와 `files.*` 명령의 경로 모두):
/// - 고른 폴더 기준 상대 경로이고 이름들을 `/`로 잇는다. 앞뒤에 `/`를 두지 않는다.
/// - 이름은 비어 있지 않고 `.`, `..`가 아니며 `\`, `:`, NUL을 담지 않는다.
/// - 빈 문자열은 폴더 자체이고 `files.list`의 `dir`에서만 쓴다.
/// - 코어는 실행할 때 심볼릭 링크를 풀어 실제 경로가 고른 폴더의 실제 경로 안에 있는지 다시 확인하고,
///   밖이면 `path_outside_root`로 거부한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct FileRef {
    pub permission: String,
    pub path: PathValue,
}

/// 경로 값. 창 상태에서 읽거나(`{ "state": "current_file" }`) 정의에 직접 적는다(`"notes/todo.md"`).
/// 상태 값이 null이거나 문자열이 아니면 열 파일이 없는 것이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum PathValue {
    State(StateRef),
    Literal(String),
}

// ---------------------------------------------------------------------------
// 명령, 응답, 이벤트, 오류
// ---------------------------------------------------------------------------

/// 화면이 코어에 보내는 명령. `op`로 가른다. 응답은 같은 `op`의 [`CoreReply`]다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "op", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum CoreRequest {
    /// 상태 전체를 읽는다. 화면이 켜질 때 한 번 부른다.
    #[serde(rename = "state.get")]
    StateGet {},

    /// 워크스페이스를 만든다. 첫 데스크톱 하나를 함께 만들고, 둘 다 지금 보는 것으로 바꾼다.
    #[serde(rename = "workspace.create")]
    WorkspaceCreate { name: String },
    #[serde(rename = "workspace.rename")]
    WorkspaceRename { workspace_id: String, name: String },
    /// 워크스페이스와 그 안의 데스크톱, 창, 고른 폴더를 지운다. 마지막 하나는 지울 수 없다(`invalid_request`).
    #[serde(rename = "workspace.delete")]
    WorkspaceDelete { workspace_id: String },
    #[serde(rename = "workspace.activate")]
    WorkspaceActivate { workspace_id: String },

    /// 데스크톱을 워크스페이스 끝에 만들고 지금 보는 것으로 바꾼다.
    #[serde(rename = "desktop.create")]
    DesktopCreate { workspace_id: String, name: String },
    #[serde(rename = "desktop.rename")]
    DesktopRename { desktop_id: String, name: String },
    /// 데스크톱과 그 안의 창, 고른 폴더를 지운다. 워크스페이스의 마지막 하나는 지울 수 없다(`invalid_request`).
    #[serde(rename = "desktop.delete")]
    DesktopDelete { desktop_id: String },
    /// 그 데스크톱의 워크스페이스도 지금 보는 것으로 바꾼다.
    #[serde(rename = "desktop.activate")]
    DesktopActivate { desktop_id: String },

    /// 앱의 지금 버전으로 창을 연다. 창 상태는 정의의 `state` 기본값, z는 그 데스크톱 맨 위.
    /// `rect`가 없으면 코어가 정한 기본 위치와 크기로 연다.
    #[serde(rename = "window.open")]
    WindowOpen {
        desktop_id: String,
        app_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        rect: Option<Rect>,
    },
    /// 창을 옮기거나 크기를 바꾼다. 화면은 끌기를 마쳤을 때만 부른다.
    #[serde(rename = "window.set_rect")]
    WindowSetRect { window_id: String, rect: Rect },
    /// 창을 그 데스크톱 맨 위로 올린다.
    #[serde(rename = "window.raise")]
    WindowRaise { window_id: String },
    /// 창과 그 창의 고른 폴더를 지운다.
    #[serde(rename = "window.close")]
    WindowClose { window_id: String },
    /// 창 상태를 통째로 바꾼다. 선언되지 않은 키나 크기 초과는 `invalid_request`.
    #[serde(rename = "window.set_state")]
    WindowSetState {
        window_id: String,
        state: BTreeMap<String, JsonValue>,
    },

    /// 앱 정의 JSON 원문을 가져와 앱 버전 하나로 저장하고 그 버전을 지금 버전으로 둔다.
    /// 같은 id의 앱이 있으면 새 버전이 되고, 그 앱의 열린 창은 새 버전으로 옮긴다.
    /// 옮긴 창의 상태에서 새 정의에 없는 키는 버리고 새 키는 기본값으로 채운다.
    /// 고른 폴더는 권한 id가 같고 모듈이 같으면 이어 쓰고 아니면 지운다.
    ///
    /// 연결 상태에 따라 갈린다.
    /// - `unlinked`: 위처럼 로컬에서 가져온다. 버전 번호는 로컬에서 센다.
    /// - `connected`: 오케스트레이터에 올리고(`registry` 모듈의 앱 올리기), 서버가 돌려준 앱과 버전을
    ///   위 규칙대로 캐시에 반영한 뒤 응답한다. 검사 실패는 서버의 오류를 그대로 돌려준다.
    /// - `pairing`, `offline`, `revoked`: `server`로 거부한다(로컬과 레지스트리가 갈라지지 않게).
    #[serde(rename = "app.import")]
    AppImport { definition_json: String },

    /// 오케스트레이터 연결을 시작한다. 서버에 연결 코드를 받아 `pairing`으로 가고, 응답에 코드를 준다.
    /// 이미 `pairing`이면 진행 중인 것을 버리고 새로 받는다. `connected`, `offline`이면 `invalid_request`.
    /// 서버에 닿지 않으면 `server`.
    #[serde(rename = "link.start")]
    LinkStart {},
    /// 진행 중인 연결 시도를 그만두고 `unlinked`로 간다. `pairing`이 아니면 아무것도 하지 않는다.
    #[serde(rename = "link.cancel")]
    LinkCancel {},
    /// 이 기기의 연결 정보(`link.json`)를 지우고 `unlinked`로 간다. 캐시의 앱과 창은 그대로 둔다.
    #[serde(rename = "link.unlink")]
    LinkUnlink {},

    /// 이 기기의 폴더 고르기 창을 띄워 창의 권한 하나에 폴더를 준다. 이미 있으면 바꾼다.
    /// 사용자가 취소하면 `grant`가 null이다.
    #[serde(rename = "files.pick_folder")]
    FilesPickFolder {
        window_id: String,
        permission: String,
    },
    /// 폴더 안 바로 아래 항목. 이름이 `.`로 시작하는 항목은 뺀다. 폴더 먼저, 그다음 이름순(대소문자 무시).
    #[serde(rename = "files.list")]
    FilesList {
        window_id: String,
        permission: String,
        dir: String,
    },
    /// UTF-8 텍스트 파일을 읽는다. 텍스트가 아니거나 너무 크면 `io`.
    #[serde(rename = "files.read")]
    FilesRead {
        window_id: String,
        permission: String,
        path: String,
    },
    /// 텍스트를 그대로 쓴다(줄바꿈과 인코딩을 바꾸지 않는다). `readwrite` 권한이 필요하다.
    /// `expected_revision`이 있으면 디스크의 지금 revision과 같을 때만 쓰고 다르면 `conflict`.
    /// 없으면 파일이 없을 때만 새로 만들고 있으면 `conflict`. 상위 폴더는 만들지 않는다.
    #[serde(rename = "files.write")]
    FilesWrite {
        window_id: String,
        permission: String,
        path: String,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        expected_revision: Option<String>,
    },
    /// 탐색기 창에서 고른 파일을 그 확장자를 여는 앱의 창으로 연다. `window_id`와 `permission`은 탐색기 창과
    /// 그 권한, `path`는 그 폴더 안 파일, `app_id`는 열 앱이다. 여는 앱이 여럿일 때 고르는 것은 화면이 한다.
    ///
    /// - `app_id` 앱의 지금 버전 정의에 `opens`가 있고 그 `extensions`에 이 파일의 확장자(소문자로 바꿔 비교)가
    ///   있어야 한다. 아니면 `invalid_request`.
    /// - 띄울 데스크톱은 탐색기 창의 데스크톱이다.
    /// - 그 데스크톱에 그 앱의 창이 있고 그 창의 `opens.permission`에 탐색기와 같은 폴더(같은 절대 경로)를
    ///   골라 두었으면, 그 창의 `opens.state`에 경로를 쓰고 맨 위로 올린다. 그런 창이 여럿이면 가장 위의 것이다.
    /// - 아니면 그 앱의 창을 새로 열고(`rect`가 없으면 코어의 기본 자리) 그 창의 `opens.permission`에 탐색기와
    ///   같은 폴더를 고른 것으로 둔 뒤 `opens.state`에 경로를 쓴다.
    /// - 파일을 연 것은 그 앱 창에 그 폴더를 고른 것과 같다. 접근 수준은 여는 앱의 권한 선언을 따른다
    ///   (탐색기가 read여도 편집기는 readwrite로 연다). 사용자가 그 파일을 그 앱으로 열겠다고 고른 것이기 때문이다.
    /// - 탐색기 창에 폴더를 아직 안 골랐으면 `not_granted`, 없는 파일이면 `not_found`, 폴더면 `invalid_request`,
    ///   폴더 밖이면 `path_outside_root`.
    /// 응답은 연 창(또는 올린 창)이다. `state.changed`가 따라온다.
    #[serde(rename = "files.open")]
    FilesOpen {
        window_id: String,
        permission: String,
        path: String,
        app_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        rect: Option<Rect>,
    },

    /// 창의 웹 화면을 잇는다. 없으면 숨긴 채로 만들어 `url`을 열고, 있으면 그대로 두고 지금 페이지를 돌려준다
    /// (화면을 다시 그려도 페이지가 다시 열리지 않게). 창의 앱 지금 버전에 `web_view`가 없으면 `invalid_request`,
    /// `url`이 `http://`나 `https://` 주소가 아니면 `invalid_request`, 이 쉘이 웹 화면을 띄울 수 없으면
    /// `unavailable`. 코어는 창이 닫히거나(데스크톱, 워크스페이스 지우기 포함) 앱의 새 버전에 `web_view`가
    /// 없으면 그 창의 웹 화면을 닫는다.
    #[serde(rename = "web.attach")]
    WebAttach { window_id: String, url: String },
    /// 웹 화면을 놓을 자리. `bounds`는 쉘 화면(메인 웹뷰) 왼쪽 위 기준 CSS px이고, null이면 숨긴다.
    /// 화면은 자리나 보임이 바뀔 때만 보낸다. 상태를 바꾸지 않으므로 이벤트가 없다.
    #[serde(rename = "web.place")]
    WebPlace {
        window_id: String,
        bounds: Option<Rect>,
    },
    /// 웹 화면을 그 주소로 보낸다. `http://`나 `https://` 주소가 아니면 `invalid_request`.
    #[serde(rename = "web.navigate")]
    WebNavigate { window_id: String, url: String },
    /// 뒤로, 앞으로, 새로고침, 멈춤. 갈 곳이 없으면 아무것도 하지 않는다.
    #[serde(rename = "web.history")]
    WebHistory {
        window_id: String,
        action: WebHistoryAction,
    },
    /// 웹 화면의 지금 모습을 PNG로 찍는다. 정지 화면에 쓴다. 숨기기 전에 부른다(숨긴 뒤에는 빈 화면이 찍힐 수 있다).
    /// 찍지 못하면 `image`가 null이고, 화면은 정지 화면 대신 빈 바탕에 페이지 제목을 보인다.
    #[serde(rename = "web.capture")]
    WebCapture { window_id: String },
    /// 창의 웹 화면을 닫는다. 블록이 화면에서 빠질 때 부른다. 없으면 아무것도 하지 않는다.
    #[serde(rename = "web.detach")]
    WebDetach { window_id: String },

    /// 워크스페이스 PAS의 지금 모습과 대화 기록(최근 [`registry::AGENT_HISTORY_LIMIT`]개)을 읽는다.
    /// 대화 블록이 켜질 때와 연결이 다시 이어졌을 때 부른다. `connected`가 아니면 `server`,
    /// 이 기기에 없는 워크스페이스면 `not_found`.
    #[serde(rename = "agent.get")]
    AgentGet { workspace_id: String },
    /// 워크스페이스 PAS를 만든다. `model_preset`은 `agent.get`의 `models` 가운데 하나다.
    /// 고른 모델이 지금 한도에 걸려 있으면 서버가 `models` 순서로 다음 모델을 써서 만들고, 그 사실을
    /// `notice` 기록으로 남긴다. 이미 PAS가 있으면 새로 만들지 않고 있는 것을 돌려준다.
    /// 코어는 워크스페이스 이름을 붙여 서버에 보낸다. `connected`가 아니면 `server`.
    #[serde(rename = "agent.create")]
    AgentCreate {
        workspace_id: String,
        model_preset: String,
    },
    /// 워크스페이스 PAS에 말을 보낸다. 보낸 말은 서버가 PAS의 기록에서 확인한 뒤 `agent.update`의
    /// `item`(user)으로 돌아온다. 첨부와 함께 보내면 그 기록의 `attachments`에 같은 순서로 보인다.
    /// - `invalid_request`: 앞뒤 공백을 뺀 글이 비었는데 첨부도 없음, 글이
    ///   [`registry::AGENT_MESSAGE_MAX_CHARS`]자를 넘음, 첨부가 [`AGENT_ATTACHMENTS_MAX`]개를 넘음,
    ///   파일 하나가 [`AGENT_ATTACHMENT_MAX_BYTES`]나 합이 [`AGENT_ATTACHMENTS_TOTAL_MAX_BYTES`]를 넘음,
    ///   이름이 비었거나 `data_base64`가 base64가 아님. 화면은 첨부를 쌓을 때 개수와 크기를 먼저 막는다.
    /// - PAS가 없으면 `not_found`, `connected`가 아니면 `server`.
    /// - 첨부를 올리다 하나라도 실패하면 말은 보내지 않고 `server`다(일부만 간 말을 만들지 않는다).
    #[serde(rename = "agent.send")]
    AgentSend {
        workspace_id: String,
        text: String,
        /// 빼면 빈 배열이다(모듈 `agent` 1판의 명령 모양).
        #[serde(default)]
        #[ts(as = "Option<Vec<AgentUpload>>", optional)]
        attachments: Vec<AgentUpload>,
    },
    /// (모듈 `agent` 2판) 기록에 있는 첨부 하나의 내용을 읽는다. 대화 블록이 이미지 첨부를 그릴 때 부른다.
    /// `index`는 그 기록의 `attachments` 안 순서(0부터)다. 같은 첨부는 바뀌지 않으므로 화면은 받은 것을
    /// 창이 살아 있는 동안 다시 쓴다. 기록이나 첨부가 없거나 원천에서 지워졌으면 `not_found`,
    /// [`AGENT_ATTACHMENT_MAX_BYTES`]보다 크면 `invalid_request`, `connected`가 아니면 `server`.
    #[serde(rename = "agent.attachment")]
    AgentAttachment {
        workspace_id: String,
        item_id: String,
        index: u32,
    },
    /// (모듈 `agent` 2판) 기록에 있는 첨부 하나를 이 기기의 기본 앱으로 연다. 대화 블록이 이미지가 아닌
    /// 첨부를 눌렀을 때 부른다. 코어가 `agent.attachment`와 같은 길로 받아 앱 데이터 폴더의
    /// `attachments/<item_id>-<index>/<이름>`에 쓰고(있으면 덮어씀) 연다. 이름의 경로 구분자와 Windows가
    /// 파일 이름에 받지 않는 글자는 `_`로 바꾼다. 실행 파일과 스크립트(`exe`, `msi`, `bat`, `cmd`, `com`,
    /// `scr`, `ps1`, `vbs`, `js`, `jse`, `wsf`, `hta`, `cpl`, `lnk`, `reg`)는 열지 않고 탐색기에서 그 파일을
    /// 가리킨다. 쓰거나 열다 실패하면 `io`, 나머지 실패는 `agent.attachment`와 같다.
    #[serde(rename = "agent.attachment_open")]
    AgentAttachmentOpen {
        workspace_id: String,
        item_id: String,
        index: u32,
    },
}

/// 보낼 첨부 하나(모듈 `agent` 2판).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentUpload {
    /// 파일 이름(확장자 포함). 붙여 넣은 이미지처럼 이름이 없으면 화면이 정한다(`붙여넣은 이미지.png`).
    pub name: String,
    /// MIME 형식. 모르면 빈 문자열이고, 서버가 `application/octet-stream`으로 올린다.
    pub mime: String,
    /// 파일 내용. 표준 base64(채움 문자 있음).
    pub data_base64: String,
}

/// 기록에 붙은 첨부 하나(모듈 `agent` 2판). 내용은 `agent.attachment`로 읽는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentAttachment {
    /// 화면에 보일 파일 이름.
    pub name: String,
    /// 서버가 확장자로 정한 MIME 형식(모르면 `application/octet-stream`). `image/`로 시작하면 대화
    /// 블록이 이미지로 그린다.
    pub mime: String,
}

/// 코어의 응답. `op`는 명령과 같다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "op")]
#[ts(export, export_to = "contract.ts")]
pub enum CoreReply {
    #[serde(rename = "state.get")]
    StateGet { snapshot: ShellSnapshot },

    #[serde(rename = "workspace.create")]
    WorkspaceCreate {
        workspace: Workspace,
        desktop: Desktop,
    },
    #[serde(rename = "workspace.rename")]
    WorkspaceRename { workspace: Workspace },
    #[serde(rename = "workspace.delete")]
    WorkspaceDelete {},
    #[serde(rename = "workspace.activate")]
    WorkspaceActivate {},

    #[serde(rename = "desktop.create")]
    DesktopCreate { desktop: Desktop },
    #[serde(rename = "desktop.rename")]
    DesktopRename { desktop: Desktop },
    #[serde(rename = "desktop.delete")]
    DesktopDelete {},
    #[serde(rename = "desktop.activate")]
    DesktopActivate {},

    #[serde(rename = "window.open")]
    WindowOpen { window: AppWindow },
    #[serde(rename = "window.set_rect")]
    WindowSetRect { window: AppWindow },
    #[serde(rename = "window.raise")]
    WindowRaise { window: AppWindow },
    #[serde(rename = "window.close")]
    WindowClose {},
    #[serde(rename = "window.set_state")]
    WindowSetState { window: AppWindow },

    #[serde(rename = "app.import")]
    AppImport { app: App, version: AppVersion },

    #[serde(rename = "link.start")]
    LinkStart { user_code: String, expires_at: String },
    #[serde(rename = "link.cancel")]
    LinkCancel {},
    #[serde(rename = "link.unlink")]
    LinkUnlink {},

    #[serde(rename = "files.pick_folder")]
    FilesPickFolder { grant: Option<Grant> },
    #[serde(rename = "files.list")]
    FilesList { entries: Vec<FileEntry> },
    #[serde(rename = "files.read")]
    FilesRead {
        path: String,
        text: String,
        revision: String,
    },
    #[serde(rename = "files.write")]
    FilesWrite { path: String, revision: String },
    #[serde(rename = "files.open")]
    FilesOpen { window: AppWindow },

    #[serde(rename = "web.attach")]
    WebAttach { page: WebPage },
    #[serde(rename = "web.place")]
    WebPlace {},
    #[serde(rename = "web.navigate")]
    WebNavigate {},
    #[serde(rename = "web.history")]
    WebHistory {},
    #[serde(rename = "web.capture")]
    WebCapture {
        /// `data:image/png;base64,...`. 찍지 못하면 null.
        image: Option<String>,
    },
    #[serde(rename = "web.detach")]
    WebDetach {},

    #[serde(rename = "agent.get")]
    AgentGet {
        /// 그 워크스페이스의 PAS. 없으면 null이고, 대화 블록은 시작하는 판을 보인다.
        agent: Option<AgentInfo>,
        /// 대화 기록. 오래된 것부터.
        items: Vec<AgentItem>,
        /// 만들 때 고를 수 있는 모델. 순서가 대체 순서다(앞의 모델이 막히면 다음).
        models: Vec<AgentModel>,
    },
    #[serde(rename = "agent.create")]
    AgentCreate { agent: AgentInfo },
    #[serde(rename = "agent.send")]
    AgentSend {},
    #[serde(rename = "agent.attachment")]
    AgentAttachment {
        name: String,
        mime: String,
        /// 파일 내용. 표준 base64.
        data_base64: String,
    },
    #[serde(rename = "agent.attachment_open")]
    AgentAttachmentOpen {},
}

/// 워크스페이스 PAS 하나.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentInfo {
    pub workspace_id: String,
    /// 만들 때 쓴 모델 preset(예: `gemini-4-argon`). 한도로 대체 모델이 도는 중이어도 이 값은 그대로다.
    pub model_preset: String,
    /// 화면에 보일 모델 이름(예: `Argon`).
    pub model_label: String,
    /// 지금 답을 만드는 중인가.
    pub busy: bool,
    /// 지금 쓰는 도구 이름. 없으면 null.
    pub tool: Option<String>,
    pub created_at: String,
}

/// 만들 때 고를 수 있는 모델 하나.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentModel {
    pub preset: String,
    pub label: String,
}

/// 대화 기록 하나. 한 번 기록되면 바뀌지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentItem {
    /// 워크스페이스 안에서 늘어나는 순번(문자열). 같은 id가 두 번 오면 화면은 하나만 둔다.
    pub id: String,
    pub kind: AgentItemKind,
    /// 사용자 글이나 PAS의 답(마크다운), 오류나 알림 한 줄. 첨부만 보낸 사용자 말이면 빈 문자열이다.
    pub text: String,
    pub at: String,
    /// (모듈 `agent` 2판) 사용자 말에 붙은 첨부. 보낸 순서 그대로다. 다른 종류의 기록과 첨부 없는 말은
    /// 빈 배열이다. 1판 서버의 기록처럼 필드가 없으면 빈 배열로 읽는다. 코어는 늘 채워 보내지만, 첨부 전의
    /// 화면 코드와 시험 자료가 그대로 맞도록 TS에서는 빠질 수 있게 두었다(없으면 빈 배열로 본다).
    #[serde(default)]
    #[ts(as = "Option<Vec<AgentAttachment>>", optional)]
    pub attachments: Vec<AgentAttachment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum AgentItemKind {
    /// 디렉터가 보낸 말(쉘이나 소울스트림 화면에서).
    User,
    /// PAS의 답 한 덩이. 한 턴에 여럿일 수 있다(도구를 쓰는 사이사이).
    Assistant,
    /// 턴이 실패했다.
    Error,
    /// 쉘이 남기는 알림(대체 모델로 시작함 등). 눈에 덜 띄게 그린다.
    Notice,
}

/// 워크스페이스 PAS에 일어난 일. `kind`로 가른다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum AgentUpdate {
    /// PAS가 만들어졌다(다른 창이나 기기에서 만든 것 포함).
    Created { agent: AgentInfo },
    /// 기록이 하나 늘었다. `assistant`가 오면 화면은 진행 중인 답을 비운다(그 답의 최종본이다).
    Item { item: AgentItem },
    /// 진행 중인 답의 다음 조각. 화면은 진행 중인 답 끝에 이어 붙인다.
    Delta { text: String },
    /// 바쁜 상태나 쓰는 도구가 바뀌었다. `busy`가 거짓이 되면 화면은 진행 중인 답을 비운다.
    Activity { busy: bool, tool: Option<String> },
}

/// 웹 화면의 지금 페이지.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct WebPage {
    /// 지금 주소. 페이지 안에서만 바뀐 주소(history.pushState)도 포함한다.
    pub url: String,
    /// 문서 제목. 없으면 빈 문자열이고, 화면은 그때 주소의 호스트를 보인다.
    pub title: String,
    /// 페이지를 읽는 중인가.
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum WebHistoryAction {
    Back,
    Forward,
    Reload,
    Stop,
}

/// 폴더 안 항목 하나.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct FileEntry {
    pub name: String,
    /// 고른 폴더 기준 상대 경로.
    pub path: String,
    pub kind: FileKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum FileKind {
    File,
    Dir,
}

/// 코어가 화면에 보내는 이벤트. `event`로 가른다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "event")]
#[ts(export, export_to = "contract.ts")]
pub enum CoreEvent {
    /// 공유 상태나 기기 상태, 연결 상태가 바뀌었다. 화면은 저장소를 이 snapshot으로 바꾼다.
    #[serde(rename = "state.changed")]
    StateChanged { snapshot: ShellSnapshot },
    /// 에이전트가 앱을 띄워 달라고 했다(앱을 올리며 띄우기를 요청했거나 앱 열기를 요청함).
    /// 코어는 그 앱을 캐시에 반영한 `state.changed`를 먼저 보내고 이 이벤트를 보낸다.
    /// 띄울 데스크톱: `workspace_id`가 없으면 지금 보는 데스크톱, 있으면 그 워크스페이스에서 마지막으로 본
    /// 데스크톱이다(지금 보는 워크스페이스가 아니어도 보는 화면을 바꾸지 않는다). 코어는 이 기기에 없는
    /// 워크스페이스의 요청을 화면에 보내지 않는다.
    /// 화면은 그 데스크톱에 그 앱의 창이 없으면 새 창 자리 규칙대로 `window.open`을 부르고,
    /// 있으면 그 창을 `window.raise`로 올린다. 화면이 여럿이면(개발용 다리) 각자 처리한다.
    #[serde(rename = "app.open_requested")]
    AppOpenRequested {
        app_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        workspace_id: Option<String>,
    },
    /// 워크스페이스 PAS에 일어난 일. 코어는 이 기기에 있는 워크스페이스의 것만 보낸다.
    /// 대화 블록은 자기 워크스페이스의 것만 반영한다. 끊긴 동안의 것은 다시 오지 않으므로, 연결이 다시
    /// 이어지면(`link`가 `connected`로 바뀌면) 대화 블록이 `agent.get`으로 다시 읽는다.
    #[serde(rename = "agent.update")]
    AgentUpdate {
        workspace_id: String,
        update: AgentUpdate,
    },
    /// 창의 웹 화면 페이지가 바뀌었다(주소, 제목, 읽는 중, 뒤로와 앞으로 갈 수 있는지 가운데 하나라도).
    /// 페이지 전체를 보낸다. 웹 화면을 이은(`web.attach`) 창의 것만 온다.
    #[serde(rename = "web.update")]
    WebUpdate { window_id: String, page: WebPage },
}

/// 명령의 실패.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct CoreError {
    pub code: ErrorCode,
    /// 사람이 읽는 한국어 설명.
    pub message: String,
    /// 걸린 것이 여럿일 때 하나씩(앱 정의 검사 등). 없으면 빈 배열.
    #[serde(default)]
    pub details: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ErrorCode {
    /// 명령 형식이 틀렸거나 지금 할 수 없는 명령(마지막 데스크톱 지우기, 선언되지 않은 상태 키 등).
    InvalidRequest,
    /// 없는 워크스페이스, 데스크톱, 창, 앱, 파일.
    NotFound,
    /// 앱 정의가 형식이나 의미 검사에 걸렸다. 걸린 것은 `details`에.
    InvalidAppDefinition,
    /// 앱이 이 쉘보다 새 블록 세트나 모듈을 요구한다.
    UnsupportedApp,
    /// 창의 앱이 선언하지 않은 권한이거나 접근 수준이 모자라다(read 권한으로 쓰기).
    PermissionDenied,
    /// 선언한 권한이지만 이 기기에서 아직 폴더를 고르지 않았다.
    NotGranted,
    /// 경로가 고른 폴더 밖을 가리킨다.
    PathOutsideRoot,
    /// 파일이 읽은 뒤에 바뀌었거나, 새로 만들려는 파일이 이미 있다.
    Conflict,
    /// 파일을 읽고 쓰다 실패했다(텍스트가 아님, 너무 큼 포함).
    Io,
    /// 오케스트레이터에 닿지 않거나, 연결이 필요한데 연결되어 있지 않거나, 서버가 요청을 처리하지 못했다.
    Server,
    /// 이 쉘의 실행 환경에서는 쓸 수 없는 기능이다(개발용 HTTP 다리의 웹 화면 등).
    Unavailable,
}

impl ErrorCode {
    /// 코드마다의 기본 한국어 설명.
    pub fn default_message(self) -> &'static str {
        match self {
            ErrorCode::InvalidRequest => "명령을 처리할 수 없습니다.",
            ErrorCode::NotFound => "요청한 항목을 찾을 수 없습니다.",
            ErrorCode::InvalidAppDefinition => "앱 정의가 유효하지 않습니다.",
            ErrorCode::UnsupportedApp => "앱이 지원되지 않는 블록이나 모듈 버전을 요구합니다.",
            ErrorCode::PermissionDenied => {
                "앱에 선언되지 않았거나 쓰기가 허용되지 않은 권한입니다."
            }
            ErrorCode::NotGranted => "이 기기에서 폴더를 선택해야 합니다.",
            ErrorCode::PathOutsideRoot => "고른 폴더 밖의 경로입니다.",
            ErrorCode::Conflict => "파일이 읽은 뒤 바뀌었거나 이미 존재합니다.",
            ErrorCode::Io => "파일을 읽거나 쓸 수 없습니다.",
            ErrorCode::Server => "kaleidoscope 서버에 연결되어 있지 않거나 서버가 요청을 처리하지 못했습니다.",
            ErrorCode::Unavailable => "이 쉘에서는 쓸 수 없는 기능입니다.",
        }
    }
}

impl CoreError {
    /// 기본 설명을 단 오류.
    pub fn new(code: ErrorCode) -> Self {
        CoreError {
            code,
            message: code.default_message().to_string(),
            details: Vec::new(),
        }
    }

    /// 기본 설명과 걸린 것 목록을 단 오류.
    pub fn with_details(code: ErrorCode, details: Vec<String>) -> Self {
        CoreError {
            code,
            message: code.default_message().to_string(),
            details,
        }
    }
}

/// 앱 정의의 JSON Schema. 오케스트레이터 MCP가 앱 올리기 도구의 입력 스키마로 보여 준다.
/// 설명은 이 파일의 doc 주석에서 나온다. 형식 검사 뒤의 의미 검사는 [`validate`]가 한다.
pub fn app_definition_schema() -> serde_json::Value {
    serde_json::to_value(schemars::schema_for!(AppDefinition)).expect("schema serializes")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example(name: &str) -> String {
        let path = format!("{}/../../examples/{}", env!("CARGO_MANIFEST_DIR"), name);
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
    }

    #[test]
    fn examples_parse_as_app_definitions() {
        for name in [
            "md-editor.json",
            "md-viewer.json",
            "workspace-pas.json",
            "web-browser.json",
            "explorer.json",
        ] {
            let def: AppDefinition =
                serde_json::from_str(&example(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(def.requires.blocks <= BLOCK_SET_VERSION, "{name}");
        }
    }

    #[test]
    fn agent_chat_needs_agent_module() {
        validate::parse_app_definition(&example("workspace-pas.json")).expect("작업 PAS 예제");
        let without_module = example("workspace-pas.json").replace(r#""agent": 1"#, r#""files": 1"#);
        assert_ne!(without_module, example("workspace-pas.json"));
        let error = validate::parse_app_definition(&without_module).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
        assert!(error.details.iter().any(|d| d.contains("agent 모듈")), "{error:?}");

        let block: Block = serde_json::from_str(r#"{"type":"agent_chat"}"#).unwrap();
        assert_eq!(block, Block::AgentChat {});
        assert!(serde_json::from_str::<Block>(r#"{"type":"agent_chat","x":1}"#).is_err());
    }

    #[test]
    fn block_set_one_definitions_stay_valid() {
        let old = example("md-viewer.json");
        assert!(old.contains(r#""blocks": 1"#), "md 예제는 1판으로 남겨 호환을 보인다");
        validate::parse_app_definition(&old).expect("1판 정의는 2판 쉘에서도 유효");
    }

    #[test]
    fn agent_requests_and_events_round_trip() {
        let req: CoreRequest = serde_json::from_str(
            r#"{"op":"agent.create","workspace_id":"w","model_preset":"gemini-4-argon"}"#,
        )
        .unwrap();
        assert_eq!(
            req,
            CoreRequest::AgentCreate {
                workspace_id: "w".into(),
                model_preset: "gemini-4-argon".into()
            }
        );
        let event = CoreEvent::AgentUpdate {
            workspace_id: "w".into(),
            update: AgentUpdate::Activity {
                busy: true,
                tool: Some("upload_app".into()),
            },
        };
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"event":"agent.update","workspace_id":"w","update":{"kind":"activity","busy":true,"tool":"upload_app"}}"#
        );
        let item = AgentItem {
            id: "3".into(),
            kind: AgentItemKind::Notice,
            text: "알림".into(),
            at: "2026-10-29T00:00:00Z".into(),
            attachments: vec![],
        };
        assert_eq!(serde_json::to_value(&item).unwrap()["kind"], "notice");
    }

    #[test]
    fn agent_attachments_are_optional_on_input_and_round_trip() {
        // 1판 모양의 보내기는 첨부 없이 읽힌다.
        let old: CoreRequest =
            serde_json::from_str(r#"{"op":"agent.send","workspace_id":"w","text":"안녕"}"#).unwrap();
        assert_eq!(
            old,
            CoreRequest::AgentSend {
                workspace_id: "w".into(),
                text: "안녕".into(),
                attachments: vec![]
            }
        );
        let with: CoreRequest = serde_json::from_str(
            r#"{"op":"agent.send","workspace_id":"w","text":"","attachments":[{"name":"붙여넣은 이미지.png","mime":"image/png","data_base64":"iVBORw=="}]}"#,
        )
        .unwrap();
        let CoreRequest::AgentSend { attachments, .. } = &with else {
            panic!("{with:?}")
        };
        assert_eq!(attachments[0].name, "붙여넣은 이미지.png");
        assert!(serde_json::from_str::<CoreRequest>(
            r#"{"op":"agent.send","workspace_id":"w","text":"","attachments":[{"name":"a","mime":"","data_base64":"","size":1}]}"#
        )
        .is_err(), "첨부의 모르는 필드는 거부한다");

        // 1판 서버의 기록은 첨부 없이 읽힌다.
        let item: AgentItem = serde_json::from_str(
            r#"{"id":"1","kind":"user","text":"안녕","at":"2026-10-29T00:00:00Z"}"#,
        )
        .unwrap();
        assert!(item.attachments.is_empty());

        let read: CoreRequest = serde_json::from_str(
            r#"{"op":"agent.attachment","workspace_id":"w","item_id":"7","index":0}"#,
        )
        .unwrap();
        assert_eq!(
            read,
            CoreRequest::AgentAttachment {
                workspace_id: "w".into(),
                item_id: "7".into(),
                index: 0
            }
        );
        let reply = CoreReply::AgentAttachmentOpen {};
        assert_eq!(
            serde_json::to_string(&reply).unwrap(),
            r#"{"op":"agent.attachment_open"}"#
        );
    }

    /// 화면이 지키는 한도를 `ui/src/contract/limits.ts`로 내보낸다. ts-rs처럼 `cargo test`가 다시 쓰고,
    /// CI는 생성된 폴더가 바뀌지 않았는지 본다.
    #[test]
    fn export_limits_ts() {
        let body = format!(
            "// 이 파일은 crates/contract/src/lib.rs의 export_limits_ts 테스트가 만든다. 손으로 고치지 않는다.\n\
             \n\
             /** 말 하나에 붙일 수 있는 첨부의 최대 개수. */\n\
             export const AGENT_ATTACHMENTS_MAX = {};\n\
             /** 첨부 파일 하나의 최대 바이트 수. */\n\
             export const AGENT_ATTACHMENT_MAX_BYTES = {};\n\
             /** 말 하나에 붙인 첨부의 합의 최대 바이트 수. */\n\
             export const AGENT_ATTACHMENTS_TOTAL_MAX_BYTES = {};\n\
             /** 한 번에 보낼 수 있는 글의 최대 글자 수(앞뒤 공백을 뺀 뒤, 유니코드 문자 단위). */\n\
             export const AGENT_MESSAGE_MAX_CHARS = {};\n",
            AGENT_ATTACHMENTS_MAX,
            AGENT_ATTACHMENT_MAX_BYTES,
            AGENT_ATTACHMENTS_TOTAL_MAX_BYTES,
            registry::AGENT_MESSAGE_MAX_CHARS,
        );
        let dir = std::env::var("TS_RS_EXPORT_DIR").expect("TS_RS_EXPORT_DIR는 .cargo/config.toml에 있다");
        let path = std::path::Path::new(&dir).join("limits.ts");
        if std::fs::read_to_string(&path).ok().as_deref() != Some(body.as_str()) {
            std::fs::write(&path, &body).unwrap();
        }
    }

    #[test]
    fn unknown_block_type_and_unknown_field_are_rejected() {
        let unknown_type = r#"{"type":"web_page","url":"https://example.com"}"#;
        assert!(serde_json::from_str::<Block>(unknown_type).is_err());

        let unknown_field =
            r#"{"type":"markdown_view","file":{"permission":"docs","path":"a.md"},"color":"red"}"#;
        assert!(serde_json::from_str::<Block>(unknown_field).is_err());
    }

    #[test]
    fn path_value_reads_state_ref_or_literal() {
        let state: PathValue = serde_json::from_str(r#"{"state":"current_file"}"#).unwrap();
        assert_eq!(
            state,
            PathValue::State(StateRef {
                state: "current_file".into()
            })
        );
        let literal: PathValue = serde_json::from_str(r#""notes/todo.md""#).unwrap();
        assert_eq!(literal, PathValue::Literal("notes/todo.md".into()));
    }

    #[test]
    fn request_and_reply_round_trip_with_op_tag() {
        let req: CoreRequest = serde_json::from_str(r#"{"op":"state.get"}"#).unwrap();
        assert_eq!(req, CoreRequest::StateGet {});

        let req: CoreRequest = serde_json::from_str(
            r#"{"op":"files.write","window_id":"w","permission":"docs","path":"a.md","text":"x"}"#,
        )
        .unwrap();
        assert!(matches!(
            req,
            CoreRequest::FilesWrite {
                expected_revision: None,
                ..
            }
        ));

        let reply = CoreReply::WindowClose {};
        assert_eq!(
            serde_json::to_string(&reply).unwrap(),
            r#"{"op":"window.close"}"#
        );

        let err = serde_json::from_str::<CoreRequest>(r#"{"op":"state.get","extra":1}"#);
        assert!(err.is_err(), "모르는 필드는 거부한다");
    }

    #[test]
    fn validator_accepts_examples_and_rejects_outside_path() {
        for name in ["md-editor.json", "md-viewer.json"] {
            validate::parse_app_definition(&example(name)).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        }
        let outside = example("md-viewer.json").replace(
            r#""path": { "state": "current_file" }"#,
            r#""path": "../secret.md""#,
        );
        assert_ne!(outside, example("md-viewer.json"), "예제의 경로 자리를 바꿨는지 확인");
        let error = validate::parse_app_definition(&outside).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
        assert!(error.details.iter().any(|d| d.contains("고른 폴더 밖")), "{error:?}");
    }

    #[test]
    fn app_definition_schema_lists_block_types() {
        let schema = app_definition_schema().to_string();
        for block in [
            "split",
            "file_tree",
            "markdown_editor",
            "markdown_view",
            "agent_chat",
            "web_view",
            "explorer",
        ] {
            assert!(schema.contains(&format!("\"{block}\"")), "스키마에 {block}이 없다");
        }
    }

    #[test]
    fn web_and_explorer_examples_validate() {
        for name in ["web-browser.json", "explorer.json", "md-editor.json", "workspace-pas.json"] {
            validate::parse_app_definition(&example(name)).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        }
        let editor = validate::parse_app_definition(&example("md-editor.json")).unwrap();
        let opens = editor.opens.expect("편집기는 md를 연다");
        assert_eq!(opens.extensions, vec!["md".to_string()]);
    }

    fn rejected(json: &str, needle: &str) {
        let error = validate::parse_app_definition(json).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidAppDefinition, "{json}");
        assert!(
            error.details.iter().any(|d| d.contains(needle)),
            "{needle} 없음: {error:?}"
        );
    }

    #[test]
    fn web_view_rules() {
        let browser = example("web-browser.json");
        rejected(
            &browser.replace(r#""web": 1"#, r#""files": 1"#),
            "web 모듈",
        );
        rejected(
            &browser.replace(r#""blocks": 3"#, r#""blocks": 2"#),
            "블록 세트 3판",
        );
        rejected(
            &browser.replace(r#""url": { "state": "url" }"#, r#""url": "file:///C:/a.html""#),
            "http://",
        );
        rejected(
            &browser.replace(r#""url": { "state": "url" }"#, r#""url": "https://a b""#),
            "공백",
        );
        rejected(
            &browser.replace(r#""set_state": "url""#, r#""set_state": "where""#),
            "선언되지 않은 상태 키",
        );
        let two = r#"{"id":"two","name":"둘","requires":{"blocks":3,"modules":{"web":1}},
            "ui":{"type":"split","direction":"row","children":[
              {"type":"web_view","url":"https://a.example"},
              {"type":"web_view","url":"https://b.example"}]}}"#;
        rejected(two, "하나까지");
        assert!(validate::valid_web_url("https://example.com/a?b=c"));
        assert!(!validate::valid_web_url("https://"));
        assert!(!validate::valid_web_url("javascript:alert(1)"));

        let block: Block =
            serde_json::from_str(r#"{"type":"web_view","url":"https://example.com"}"#).unwrap();
        assert_eq!(
            block,
            Block::WebView {
                url: UrlValue::Literal("https://example.com".into()),
                on_navigate: None,
                address_bar: false
            }
        );
    }

    #[test]
    fn opens_rules() {
        let editor = example("md-editor.json");
        rejected(
            &editor.replace(r#""blocks": 3"#, r#""blocks": 1"#),
            "opens는 블록 세트 3판",
        );
        rejected(
            &editor.replace(r#""extensions": ["md"]"#, r#""extensions": [".MD"]"#),
            "소문자와 숫자",
        );
        rejected(
            &editor.replace(r#""extensions": ["md"]"#, r#""extensions": []"#),
            "하나 이상",
        );
        rejected(
            &editor.replace(r#""permission": "docs", "state""#, r#""permission": "notes", "state""#),
            "선언되지 않은 권한",
        );
        rejected(
            &editor.replace(r#""state": "current_file" },
  "ui""#, r#""state": "open_file" },
  "ui""#),
            "선언되지 않은 상태 키",
        );
    }

    #[test]
    fn blocks_need_their_block_set() {
        let pas = example("workspace-pas.json").replace(r#""blocks": 2"#, r#""blocks": 1"#);
        rejected(&pas, "블록 세트 2판");
        let explorer = example("explorer.json").replace(r#""blocks": 3"#, r#""blocks": 2"#);
        rejected(&explorer, "블록 세트 3판");
    }

    #[test]
    fn supported_renders_by_block_set_and_modules() {
        let current = Supported::current();
        let browser = validate::parse_app_definition(&example("web-browser.json")).unwrap();
        let pas = validate::parse_app_definition(&example("workspace-pas.json")).unwrap();
        assert!(browser.requires.blocks > LEGACY_BLOCK_SET_VERSION);
        assert!(pas.requires.blocks <= LEGACY_BLOCK_SET_VERSION);
        assert!(current.renders(&browser.requires));
        assert!(current.renders(&pas.requires));
        let unknown_module = Requires {
            blocks: 1,
            modules: [("shay".to_string(), 1)].into_iter().collect(),
        };
        assert!(!current.renders(&unknown_module));
        assert_eq!(
            serde_json::to_string(&current).unwrap(),
            r#"{"blocks":3,"modules":{"agent":2,"files":1,"web":1}}"#
        );
    }

    #[test]
    fn files_open_and_web_messages_round_trip() {
        let req: CoreRequest = serde_json::from_str(
            r#"{"op":"files.open","window_id":"x","permission":"folder","path":"a/b.md","app_id":"md-editor"}"#,
        )
        .unwrap();
        assert!(matches!(req, CoreRequest::FilesOpen { rect: None, .. }));
        let req: CoreRequest =
            serde_json::from_str(r#"{"op":"web.place","window_id":"x","bounds":null}"#).unwrap();
        assert_eq!(
            req,
            CoreRequest::WebPlace {
                window_id: "x".into(),
                bounds: None
            }
        );
        let req: CoreRequest =
            serde_json::from_str(r#"{"op":"web.history","window_id":"x","action":"back"}"#).unwrap();
        assert!(matches!(
            req,
            CoreRequest::WebHistory {
                action: WebHistoryAction::Back,
                ..
            }
        ));
        let event = CoreEvent::WebUpdate {
            window_id: "x".into(),
            page: WebPage {
                url: "https://example.com/".into(),
                title: "Example".into(),
                loading: false,
                can_go_back: true,
                can_go_forward: false,
            },
        };
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"event":"web.update","window_id":"x","page":{"url":"https://example.com/","title":"Example","loading":false,"can_go_back":true,"can_go_forward":false}}"#
        );
        assert_eq!(
            serde_json::to_value(CoreError::new(ErrorCode::Unavailable)).unwrap()["code"],
            "unavailable"
        );
    }

    #[test]
    fn link_status_uses_state_tag() {
        assert_eq!(
            serde_json::to_string(&LinkStatus::Unlinked {}).unwrap(),
            r#"{"state":"unlinked"}"#
        );
        let event = CoreEvent::AppOpenRequested {
            app_id: "md-viewer".into(),
            workspace_id: None,
        };
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"event":"app.open_requested","app_id":"md-viewer"}"#
        );
    }

    #[test]
    fn error_serializes_with_snake_case_code() {
        let err = CoreError {
            code: ErrorCode::PathOutsideRoot,
            message: "고른 폴더 밖 경로입니다".into(),
            details: vec![],
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "path_outside_root");
    }
}
