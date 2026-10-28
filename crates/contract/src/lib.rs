//! kaleidoscope 코어와 화면 사이 계약 (계약 1판, 261028)
//!
//! 이 파일 하나가 코어(Rust)와 화면(TS) 양쪽 타입의 정본이다. TS 타입은
//! `cargo test -p kaleidoscope-contract`가 `ui/src/contract/contract.ts`로 생성한다.
//! 생성된 TS는 손으로 고치지 않는다. 계약을 바꾸려면 이 파일을 고치고 다시 생성한다.
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
//! - [`SharedState`]: 앱 레지스트리, 워크스페이스, 데스크톱, 앱 창. 지금은 코어가 앱 데이터 폴더의
//!   `state.json`에 두고, 2단계에서 오케스트레이터가 정본이 되어 기기 사이에 맞춘다. 모양은 그때도 같다.
//! - [`DeviceState`]: 지금 고른 워크스페이스와 데스크톱, 고른 폴더. 그 기기의 `device.json`에만 둔다.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 창 상태와 앱 정의의 상태 기본값에 쓰는 임의 JSON 값.
pub type JsonValue = serde_json::Value;

/// Tauri 명령 이름. 화면은 `invoke("core", { request })`로 부른다.
pub const TAURI_COMMAND: &str = "core";
/// Tauri 이벤트 이름. 화면은 `listen("core-event", ...)`로 받는다.
pub const TAURI_EVENT: &str = "core-event";

/// 이 쉘이 그릴 수 있는 블록 세트 버전. 블록 세트 전체에 정수 하나다.
pub const BLOCK_SET_VERSION: u32 = 1;
/// 이 쉘이 제공하는 모듈과 버전.
pub const MODULE_VERSIONS: &[(&str, u32)] = &[("files", 1)];

/// 창 상태 하나를 JSON으로 직렬화했을 때의 최대 바이트 수.
pub const WINDOW_STATE_MAX_BYTES: usize = 64 * 1024;
/// `files.read`가 읽는 파일의 최대 바이트 수.
pub const FILE_READ_MAX_BYTES: u64 = 5 * 1024 * 1024;

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
}

/// 화면이 보는 상태 전체.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ShellSnapshot {
    pub shared: SharedState,
    pub device: DeviceState,
    pub supported: Supported,
}

// ---------------------------------------------------------------------------
// 앱 정의 (블록 세트 1판)
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
    /// 창 안을 채우는 블록 트리의 뿌리.
    pub ui: Block,
}

/// 앱이 필요로 하는 블록 세트와 모듈의 버전.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct Requires {
    pub blocks: u32,
    #[serde(default)]
    pub modules: BTreeMap<String, u32>,
}

/// 앱이 쓰겠다고 선언하는 권한. 실제로 허락하는 것은 기기마다 사용자다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum FileAccess {
    /// 목록과 읽기.
    Read,
    /// 목록, 읽기, 쓰기.
    Readwrite,
}

/// 블록. 블록 세트 1판의 전부다. 새 블록은 쉘 릴리스로만 더한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum SplitDirection {
    /// 좌우로 나눈다.
    Row,
    /// 위아래로 나눈다.
    Column,
}

/// 창 상태 키 하나를 읽는다. 예: `{ "state": "current_file" }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StateRef {
    pub state: String,
}

/// 블록 이벤트의 값을 창 상태 키 하나에 쓴다. 예: `{ "set_state": "current_file" }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct SetState {
    pub set_state: String,
}

/// 권한 하나가 가리키는 폴더(고른 폴더 자체).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct FileRef {
    pub permission: String,
    pub path: PathValue,
}

/// 경로 값. 창 상태에서 읽거나(`{ "state": "current_file" }`) 정의에 직접 적는다(`"notes/todo.md"`).
/// 상태 값이 null이거나 문자열이 아니면 열 파일이 없는 것이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
    #[serde(rename = "app.import")]
    AppImport { definition_json: String },

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
    /// 공유 상태나 기기 상태가 바뀌었다. 화면은 저장소를 이 snapshot으로 바꾼다.
    #[serde(rename = "state.changed")]
    StateChanged { snapshot: ShellSnapshot },
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
        for name in ["md-editor.json", "md-viewer.json"] {
            let def: AppDefinition =
                serde_json::from_str(&example(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(def.requires.blocks, BLOCK_SET_VERSION, "{name}");
        }
    }

    #[test]
    fn unknown_block_type_and_unknown_field_are_rejected() {
        let unknown_type = r#"{"type":"web_view","url":"https://example.com"}"#;
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
