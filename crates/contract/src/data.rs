//! 앱 데이터: 원천, 식 바인딩, 동작, 블록이 받는 데이터 모양 (블록 세트 4판, 계약 6판, 카드 #809)
//!
//! 블록 세트 4판의 블록은 서비스의 데이터 모양을 모른다. 앱 정의가 데이터를 어디서 받을지(원천)와 받은 것을
//! 블록이 받는 모양으로 바꾸는 식(JSONata)을 적고, 코어가 계산해 화면에는 결과만 보낸다.
//!
//! # 흐름
//! 1. 원천([`SourceDecl`]): 앱 정의의 `sources`에 이름을 붙여 적는다. 연결(`request`), 기기 폴더의 파일(`file`),
//!    폴더 목록(`folder`) 셋이다. 코어가 받아 창마다 들고 있다. 원자료는 화면에 가지 않는다.
//! 2. 바인딩([`Binding`]): 4판 블록의 값 자리에 리터럴, 창 상태(`{ "state": 키 }`), 식(`{ "expr": "..." }`)을 쓴다.
//!    리터럴과 상태는 화면이 스스로 푼다. 식은 코어가 계산해 `data.attach` 응답과 `data.update` 이벤트로 보낸다.
//! 3. 동작([`Actions`]): 블록 이벤트(누르기, 고르기, 바꾸기)에 상태 쓰기, 원천 다시 받기, 연결 부르기를 순서대로 건다.
//!    화면은 `data.act`로 동작 자리만 알리고, 코어가 식을 계산해 실행한다.
//!
//! # 식
//! - 언어는 JSONata(<https://jsonata.org>)다. 코어와 오케스트레이터는 jsonata-core(Rust, 참조 시험 1686/1686)로
//!   읽고 계산한다. 앱 정의를 받을 때 모든 식을 읽어 보고, 읽지 못하면 거부한다.
//! - 식이 보는 것(변수). 입력 문서(`$`)는 비어 있다.
//!   - `$state`: 그 창의 상태 객체(앱 정의 `state`의 키들).
//!   - `$data`: 원천 이름 → 받은 값. 아직 값이 없는 원천은 없다(undefined).
//!   - `$storage`: 선언된 저장 항목 id → JSON 값 또는 md 문자열. `$storage_meta.bucket_id`는 현재 계정 × 앱 칸 id다.
//!   - `$event`, `$item`: 동작 안에서만. `$event`는 블록 이벤트의 값(고른 항목의 `key`, 입력한 글, 켜고 끈 값 등),
//!     `$item`은 목록, 표, 트리, 흐름에서 그 항목 전체다.
//! - 원천의 값 자리(`path`, `query` 등)에 쓴 식은 `$state`만 본다(원천끼리 기대지 않는다).
//! - 식이 원천을 읽는 것은 `$data.이름` 꼴로만 알아본다. 코어는 이 꼴로 식이 기대는 원천을 정하고, 그 원천의 상태
//!   (불러오는 중, 실패, 로그인 필요)를 그 식의 값에 붙인다. `$data["이름"]`이나 `$lookup($data, ...)`처럼 쓰면
//!   계산은 되지만 상태가 붙지 않는다.
//! - 식 하나의 계산은 [`EXPR_TIMEOUT_MS`] 안에 끝나야 하고, 넘으면 그 값은 실패다.
//! - 결과가 undefined면 null로 보낸다. 결과 JSON이 [`DATA_VALUE_MAX_BYTES`]를 넘으면 실패다.
//! - JSONata는 결과가 하나뿐이면 배열을 벗겨 그 값 하나를 낸다(거르기에 한 줄만 걸릴 때 등). 그래서 화면은 배열을
//!   받는 자리(`list`의 `items`와 묶음의 `items`, `table`의 `rows`, `tree`의 `items`와 `children`, `feed`의
//!   `entries`, `badges`, `select`의 `options`)에 배열이 아닌 값이 오면 그 하나를 담은 배열로 보고, null이면 빈
//!   배열로 본다. 코어는 결과를 바꾸지 않고 그대로 보낸다.
//!
//! # 바인딩 자리 (JSON Pointer)
//! 식의 값은 앱 정의 JSON 안에서 그 바인딩 자리의 JSON Pointer(RFC 6901)를 열쇠로 오간다. 예: `ui` 뿌리가 `stack`이고
//! 둘째 자식이 `list`면 그 `items`는 `/ui/children/1/items`다. 동작 자리도 같은 규칙이다(`/ui/children/1/on_select`).
//! 화면은 블록 트리를 그리며 같은 규칙으로 자리를 만든다. 열쇠는 앱 정의의 JSON 필드 이름과 배열 순서 그대로다
//! (`tabs`의 `/tabs/0/child`, `toolbar`의 `/start/0`, `properties`의 `/fields/2/value`, `button`의 `/confirm/body`).
//! `set_storage` 값은 `/ui/.../set_storage/value` 자리다. [`ui_bindings`]와 [`ui_actions`]가 이 규칙의 정본이다.
//!
//! # 원천의 상태와 값의 상태
//! - 코어는 창이 이어지면(`data.attach`) 입력이 갖춰진 원천을 받는다. 입력(식이나 상태로 정한 `path` 등)이 null이면
//!   부르지 않고 `idle`이다. 창 상태가 바뀌어 입력이 달라지면 다시 받는다.
//! - 다시 받는 때: 입력이 바뀜, `refresh` 동작, `data.refresh`, `refresh_secs`마다(창이 이어져 있는 동안만),
//!   `file`과 `folder`는 쉘 창이 포커스를 다시 얻을 때도.
//! - 식의 값([`BindingValue`]): 기대는 원천에 값이 있으면(다시 받는 중이거나 다시 받다 실패했어도) 그 값으로 계산해
//!   `ready`다. 값이 없는 원천이 있으면 `login_required`, `failed`, `loading` 순으로 그 원천의 상태를 따른다.
//!   `idle` 원천은 값 없이(undefined) 계산한다.
//! - 이미 값이 있는 원천을 다시 받다 실패하면 값은 그대로 두고 원천 상태만 `failed`가 된다. 화면은 창 아래에
//!   오류 한 줄과 다시 받기를 보인다.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{AppDefinition, Block, JsonValue, SetState, StateRef};

/// 식 하나의 계산 제한 시간.
pub const EXPR_TIMEOUT_MS: u64 = 1000;
/// 식 하나의 결과 JSON의 최대 바이트 수.
pub const DATA_VALUE_MAX_BYTES: usize = 16 * 1024 * 1024;
/// 원천 하나가 받는 JSON이나 글의 최대 바이트 수(연결 응답, 파일).
pub const SOURCE_MAX_BYTES: u64 = 16 * 1024 * 1024;
/// `folder` 원천이 내는 항목의 최대 수. 넘으면 앞에서부터 이만큼만 내고 원천은 `ready`다.
pub const FOLDER_SOURCE_MAX_ENTRIES: usize = 5000;
/// `refresh_secs`의 최솟값.
pub const SOURCE_REFRESH_MIN_SECS: u32 = 10;
/// 연결 요청 하나를 기다리는 시간(원천 받기, 동작의 연결 부르기, 이미지와 소리).
pub const CONNECTION_TIMEOUT_SECS: u64 = 60;
/// 이미지와 소리 원본 하나의 최대 바이트 수.
pub const MEDIA_MAX_BYTES: u64 = 20 * 1024 * 1024;
/// 기기 로그인(`connection.login`)에서 사용자가 브라우저 로그인을 마치기를 기다리는 시간.
pub const LOGIN_TIMEOUT_SECS: u64 = 300;

/// 버튼 아이콘으로 쓸 수 있는 이름. Lucide(<https://lucide.dev>) 아이콘 이름이고 쉘이 이 목록만 싣는다.
pub const ICON_NAMES: &[&str] = &[
    "arrow-down",
    "arrow-left",
    "arrow-right",
    "arrow-up",
    "arrow-up-down",
    "bell",
    "bookmark",
    "calendar",
    "check",
    "chevron-down",
    "chevron-left",
    "chevron-right",
    "chevron-up",
    "circle-alert",
    "circle-check",
    "circle-x",
    "clipboard-copy",
    "clock",
    "copy",
    "download",
    "ellipsis",
    "external-link",
    "eye",
    "eye-off",
    "file",
    "file-text",
    "filter",
    "folder",
    "folder-open",
    "heart",
    "history",
    "house",
    "image",
    "info",
    "link",
    "list-filter",
    "lock",
    "lock-open",
    "log-in",
    "log-out",
    "maximize-2",
    "message-square",
    "minimize-2",
    "minus",
    "music",
    "pause",
    "pencil",
    "play",
    "plus",
    "refresh-cw",
    "rotate-ccw",
    "save",
    "search",
    "send",
    "settings",
    "share",
    "skip-back",
    "skip-forward",
    "square",
    "star",
    "tag",
    "trash-2",
    "triangle-alert",
    "upload",
    "user",
    "users",
    "video",
    "x",
    "zoom-in",
    "zoom-out",
];

// ---------------------------------------------------------------------------
// 앱 정의에 쓰는 것
// ---------------------------------------------------------------------------

/// 4판 블록의 값 자리. 리터럴, 창 상태, 식 가운데 하나다.
///
/// - `{ "state": "키" }`: 창 상태 하나. 화면이 스스로 푼다.
/// - `{ "expr": "JSONata 식" }`: 코어가 계산한 값. 규칙은 이 모듈 머리글에 있다.
/// - 그 밖의 JSON: 그대로의 값. `state`나 `expr` 하나만 가진 객체는 리터럴로 쓸 수 없다(검사가 거부한다).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum Binding {
    State(StateRef),
    Expr(ExprRef),
    Literal(JsonValue),
}

/// 식 바인딩. 예: `{ "expr": "$data.cards.cards[status = 'running']" }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ExprRef {
    pub expr: String,
}

/// 원천 하나. `kind`로 가른다. 이름은 소문자로 시작하고 소문자, 숫자, `_`로 1~32자다(식에서 `$data.이름`으로 읽는다).
/// 값 자리([`Binding`])의 식은 `$state`만 본다. 값이 null이면 그 원천을 부르지 않는다(`idle`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum SourceDecl {
    /// 연결(모듈 `connection`)에 GET을 보낸다. `permission`은 `connection` 권한 id다.
    /// `path`는 연결의 주소 아래 경로로 `/`로 시작한다. `query`의 값은 문자열로 바꿔 붙인다(null이면 그 키를 뺀다).
    /// 응답이 2xx가 아니면 실패다.
    Request {
        permission: String,
        path: Binding,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        #[ts(optional, as = "Option<BTreeMap<String, Binding>>")]
        query: BTreeMap<String, Binding>,
        #[serde(default)]
        #[ts(optional, as = "Option<SourceFormat>")]
        format: SourceFormat,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        refresh_secs: Option<u32>,
    },
    /// 기기마다 고른 폴더(모듈 `files`)의 파일 하나를 읽는다. `path`는 [`FileRef`]의 경로 규칙을 따른다.
    /// 없는 파일이면 실패다. `json`이면 JSON으로 읽고, 읽지 못하면 실패다.
    File {
        permission: String,
        path: Binding,
        #[serde(default)]
        #[ts(optional, as = "Option<SourceFormat>")]
        format: SourceFormat,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        refresh_secs: Option<u32>,
    },
    /// 기기마다 고른 폴더(모듈 `files`)의 항목 목록. 값은 [`FolderEntry`] 배열이다.
    /// `dir`이 없으면 고른 폴더 자체다. `recursive`면 하위 폴더까지 내려간다. `extensions`가 있으면 그 확장자의
    /// 파일과(재귀가 아니면) 폴더만 낸다. 이름이 `.`로 시작하는 항목은 뺀다. 폴더 먼저, 그다음 경로순(대소문자 무시).
    Folder {
        permission: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        dir: Option<Binding>,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        recursive: bool,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        extensions: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        refresh_secs: Option<u32>,
    },
}

impl SourceDecl {
    pub fn permission(&self) -> &str {
        match self {
            SourceDecl::Request { permission, .. }
            | SourceDecl::File { permission, .. }
            | SourceDecl::Folder { permission, .. } => permission,
        }
    }

    pub fn refresh_secs(&self) -> Option<u32> {
        match self {
            SourceDecl::Request { refresh_secs, .. }
            | SourceDecl::File { refresh_secs, .. }
            | SourceDecl::Folder { refresh_secs, .. } => *refresh_secs,
        }
    }
}

/// 원천이 받은 것을 읽는 방법.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum SourceFormat {
    /// JSON으로 읽는다.
    #[default]
    Json,
    /// 글 그대로(UTF-8) 문자열 하나로 둔다. 로그처럼 식에서 `$split`으로 나눠 쓴다.
    Text,
}

/// 블록 이벤트에 거는 동작. 상태 키 하나에 이벤트 값을 쓰는 짧은 꼴(`{ "set_state": "키" }`)이나 동작 목록이다.
/// 목록은 코어가 순서대로 실행하고, 하나가 실패하면 거기서 멈춘다(앞에서 쓴 상태는 그대로 둔다).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum Actions {
    One(SetState),
    Many(Vec<Action>),
}

/// 동작 하나.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum Action {
    SetState(SetStateAction),
    Refresh(RefreshAction),
    Call(CallAction),
    SetStorage(SetStorageAction),
}

/// 저장소 항목 하나에 값을 쓴다. 예: `{ "set_storage": { "entry": "selection", "value": { "expr": "$event" } } }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct SetStorageAction {
    pub set_storage: SetStorageSpec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct SetStorageSpec {
    pub entry: String,
    /// 빠졌으면 `$event`, 적혀 있으면 null도 값이다.
    #[serde(
        default,
        deserialize_with = "present_binding",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub value: Option<Binding>,
}

/// 창 상태 키 하나에 값을 쓴다. `value`를 빼면 `$event`를 쓴다. `"value": null`은 null을 쓴다(상태 비우기).
/// 예: `{ "set_state": "file", "value": { "expr": "$item.file" } }`, `{ "set_state": "conversation", "value": null }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct SetStateAction {
    pub set_state: String,
    /// 빠졌으면 None, 적혀 있으면 null이어도 `Some(Binding::Literal(null))`이다.
    #[serde(
        default,
        deserialize_with = "present_binding",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub value: Option<Binding>,
}

/// 필드가 있으면 null도 값으로 읽는다(`Option`의 기본 읽기는 null을 None으로 본다).
fn present_binding<'de, D>(deserializer: D) -> Result<Option<Binding>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Binding::deserialize(deserializer).map(Some)
}

/// 원천을 다시 받는다. 빈 배열이면 모든 원천이다. 받기를 마칠 때까지 기다린다(실패해도 동작은 이어 간다).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct RefreshAction {
    pub refresh: Vec<String>,
}

/// 연결을 부른다. 응답이 2xx가 아니면 실패다. 응답 본문은 쓰지 않는다(바뀐 것은 `refresh`로 다시 받는다).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct CallAction {
    pub call: CallSpec,
}

/// 연결 부르기. `permission`은 `connection` 권한이고, GET이 아니면 그 권한이 `readwrite`여야 한다
/// (서버의 연결도 쓰기를 허락해야 한다). `body`는 JSON으로 보낸다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct CallSpec {
    pub permission: String,
    pub method: HttpMethod,
    pub path: Binding,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[ts(optional, as = "Option<BTreeMap<String, Binding>>")]
    pub query: BTreeMap<String, Binding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub body: Option<Binding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "UPPERCASE")]
#[ts(export, export_to = "contract.ts")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl HttpMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Delete => "DELETE",
        }
    }
}

// ---------------------------------------------------------------------------
// 블록이 받는 데이터 모양 (식이 내는 값). 화면은 모르는 필드를 넘기고, 모양이 틀린 항목은 그리지 않는다.
// ---------------------------------------------------------------------------

/// 이미지와 소리 원본 하나. 식이 이 모양의 객체를 내면 블록이 `data.media`로 받아 그린다.
/// `permission`의 모듈이 `connection`이면 `path`는 연결의 주소 아래 경로(`/`로 시작)이고 `query`를 붙인다.
/// `files`면 `path`는 고른 폴더 기준 상대 경로다. `crop`은 그리는 방법이라 원본을 가르지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct MediaRef {
    pub permission: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[ts(optional, as = "Option<BTreeMap<String, String>>")]
    pub query: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub crop: Option<Crop>,
}

/// 이미지에서 보일 부분. 원본 가로와 세로에 대한 비율(0~1)이고 `x`, `y`는 왼쪽 위다.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// 배지. 글만 쓰거나(`"진행 중"`) 색을 붙인다(`{ "text": "진행 중", "color": "#315da8" }`).
/// 색은 `#rgb`나 `#rrggbb`이고, 쉘이 글자 대비를 맞춘다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum Badge {
    Text(String),
    Colored {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<String>,
    },
}

/// `list` 항목.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ListItem {
    /// 고르기와 비교에 쓰는 열쇠. 목록 안에서 겹치지 않는다. 고르면 `$event`가 이 값이다.
    pub key: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub subtitle: Option<String>,
    /// 오른쪽에 작게 보이는 부가 정보(시각, 개수).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub meta: Option<String>,
    /// 항목의 표시 색(`#rrggbb`). 앞의 점이나 막대로 보인다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<Badge>>")]
    pub badges: Vec<Badge>,
    /// 줄 보기에서는 앞의 작은 그림, 격자 보기에서는 칸의 그림.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<MediaRef>,
}

/// 묶음 하나(`grouped`인 `list`와 `feed`). 머리에 제목과 부가 정보(개수 등)를 보인다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct Group<T> {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub meta: Option<String>,
    pub items: Vec<T>,
}

/// `tree` 항목. `by: children`이면 `children`으로 내려가고, `by: path`면 `path`를 `/`로 나눠 폴더를 만든다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct TreeItem {
    pub key: String,
    /// 없으면 `path`의 마지막 이름이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub meta: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<Badge>>")]
    pub badges: Vec<Badge>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<TreeItem>>")]
    pub children: Vec<TreeItem>,
}

/// `feed` 항목. 이름(색과 초상)과 본문 줄들. 본문은 줄바꿈을 지키고 글을 고르고 복사할 수 있다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct FeedEntry {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    /// 이름의 색(`#rrggbb`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
    /// 이름 옆의 작은 원형 초상.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<MediaRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub meta: Option<String>,
    /// 본문. 문자열 하나나 문자열 배열(문단마다 하나, 예: 한국어와 영어).
    pub body: FeedBody,
    #[serde(default)]
    #[ts(optional, as = "Option<Tone>")]
    pub tone: Tone,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum FeedBody {
    One(String),
    Many(Vec<String>),
}

/// 글의 결. `muted`는 눈에 덜 띄게, `error`는 오류 색으로.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum Tone {
    #[default]
    Default,
    Muted,
    Error,
}

/// `select`의 선택지. 문자열만 쓰면 값과 이름이 같다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum SelectOption {
    Plain(String),
    Labeled { value: JsonValue, label: String },
}

/// `folder` 원천의 항목.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct FolderEntry {
    pub name: String,
    /// 고른 폴더 기준 상대 경로.
    pub path: String,
    pub kind: crate::FileKind,
    /// 확장자(점 없이, 소문자). 없으면 빈 문자열.
    pub ext: String,
    /// 파일 크기(바이트). 폴더는 0.
    pub size: u64,
    /// 마지막으로 바뀐 시각(RFC 3339 UTC).
    pub modified: String,
}

// ---------------------------------------------------------------------------
// 코어가 화면에 보내는 것
// ---------------------------------------------------------------------------

/// 창 하나의 데이터 모습. `data.attach` 응답 전체이고, `data.update`는 바뀐 것만 같은 모양으로 보낸다.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct DataView {
    /// 원천 이름 → 상태.
    pub sources: BTreeMap<String, SourceStatus>,
    /// 식 바인딩 자리(JSON Pointer) → 값. 리터럴과 상태 바인딩은 담지 않는다(화면이 스스로 푼다).
    pub values: BTreeMap<String, BindingValue>,
}

/// 원천 하나의 상태. `state`로 가른다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum SourceStatus {
    /// 입력이 null이라 부르지 않았다. 값이 없다.
    Idle {},
    /// 받는 중이다. 이전 값이 있으면 식은 그 값으로 계산된다.
    Loading { has_value: bool },
    /// 받았다.
    Ready { updated_at: String },
    /// 받다가 실패했다. 이전 값이 있으면 식은 그 값으로 계산된다.
    Failed { message: String, has_value: bool },
    /// 연결이 기기 로그인(`oauth`)인데 이 기기에 로그인 정보가 없거나 원천이 401을 돌려줬다.
    LoginRequired { permission: String },
}

/// 식 바인딩 하나의 값. `status`로 가른다. 규칙은 이 모듈 머리글의 「원천의 상태와 값의 상태」에 있다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum BindingValue {
    Ready {
        value: JsonValue,
    },
    /// 기대는 원천을 처음 받는 중이다. 블록은 불러오는 모습을 보인다.
    Loading {},
    /// 기대는 원천을 받지 못했거나 식이 실패했다. 블록은 오류와(`retry`가 있으면) 다시 받기를 보인다.
    /// `retry`는 `data.refresh`에 넘길 원천 이름이다. 식 오류면 빈 배열이다.
    Failed {
        message: String,
        #[serde(default)]
        retry: Vec<String>,
    },
    /// 기대는 원천의 연결에 로그인해야 한다. 블록은 로그인 단추를 보이고 `connection.login`을 부른다.
    LoginRequired {
        permission: String,
    },
}

/// `data.media` 응답의 내용.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct MediaData {
    pub mime: String,
    /// 표준 base64.
    pub data_base64: String,
    /// 이미지면 보내는 그림의 가로와 세로(px). 소리와 영상은 null.
    pub width: Option<u32>,
    pub height: Option<u32>,
}

// ---------------------------------------------------------------------------
// 바인딩 자리와 동작 자리
// ---------------------------------------------------------------------------

/// 앱 정의의 화면 바인딩 자리(JSON Pointer)와 바인딩. UI 트리 순서 뒤에 저장 설정 선택지를 선언 순서로 둔다.
/// 1~3판 블록의 상태 참조(`StateRef`)는 바인딩이 아니라 담지 않는다.
pub fn ui_bindings(definition: &AppDefinition) -> Vec<(String, &Binding)> {
    let mut out = Vec::new();
    walk(&definition.ui, "/ui", &mut |pointer, slot| {
        if let Slot::Binding(binding) = slot {
            out.push((pointer, binding));
        }
    });
    if let Some(storage) = &definition.storage {
        for (index, entry) in storage.entries.iter().enumerate() {
            if let Some(choices) = &entry.choices {
                out.push((format!("/storage/entries/{index}/choices"), choices));
            }
        }
    }
    out
}

/// 앱 정의의 `ui` 안의 모든 동작 자리(JSON Pointer)와 동작. 화면은 이 자리를 `data.act`의 `pointer`로 보낸다.
pub fn ui_actions(definition: &AppDefinition) -> Vec<(String, &Actions)> {
    let mut out = Vec::new();
    walk(&definition.ui, "/ui", &mut |pointer, slot| {
        if let Slot::Actions(actions) = slot {
            out.push((pointer, actions));
        }
    });
    out
}

/// 블록 하나와 그 아래 블록들을 앞에서부터 깊이 우선으로 돈다(검사와 자리 계산이 같이 쓴다).
pub fn walk_blocks<'a>(block: &'a Block, pointer: &str, visit: &mut dyn FnMut(&str, &'a Block)) {
    visit(pointer, block);
    for (child_pointer, child) in child_blocks(block, pointer) {
        walk_blocks(child, &child_pointer, visit);
    }
}

/// 블록의 바로 아래 블록과 그 자리.
pub fn child_blocks<'a>(block: &'a Block, pointer: &str) -> Vec<(String, &'a Block)> {
    match block {
        Block::Split { children, .. } | Block::Stack { children, .. } => children
            .iter()
            .enumerate()
            .map(|(index, child)| (format!("{pointer}/children/{index}"), child))
            .collect(),
        Block::Tabs { tabs, .. } => tabs
            .iter()
            .enumerate()
            .map(|(index, tab)| (format!("{pointer}/tabs/{index}/child"), &tab.child))
            .collect(),
        Block::Toolbar { start, end } => start
            .iter()
            .enumerate()
            .map(|(index, child)| (format!("{pointer}/start/{index}"), child))
            .chain(
                end.iter()
                    .enumerate()
                    .map(|(index, child)| (format!("{pointer}/end/{index}"), child)),
            )
            .collect(),
        Block::Section { child, .. } => vec![(format!("{pointer}/child"), child.as_ref())],
        _ => Vec::new(),
    }
}

enum Slot<'a> {
    Binding(&'a Binding),
    Actions(&'a Actions),
}

fn walk<'a>(block: &'a Block, pointer: &str, visit: &mut dyn FnMut(String, Slot<'a>)) {
    for (field, slot) in own_slots(block) {
        visit(format!("{pointer}/{field}"), slot);
    }
    for (child_pointer, child) in child_blocks(block, pointer) {
        walk(child, &child_pointer, visit);
    }
}

/// 블록 자신의 바인딩과 동작 자리(블록 자리 기준 상대 경로).
fn own_slots(block: &Block) -> Vec<(String, Slot<'_>)> {
    let mut slots: Vec<(String, Slot<'_>)> = Vec::new();
    macro_rules! bind {
        ($field:expr, $value:expr) => {
            slots.push(($field.to_string(), Slot::Binding($value)))
        };
    }
    macro_rules! act {
        ($field:expr, $value:expr) => {
            slots.push(($field.to_string(), Slot::Actions($value)))
        };
    }
    match block {
        Block::Section { title, meta, .. } => {
            bind!("title", title);
            if let Some(meta) = meta {
                bind!("meta", meta);
            }
        }
        Block::List {
            items, on_select, ..
        }
        | Block::Tree {
            items, on_select, ..
        } => {
            bind!("items", items);
            if let Some(on_select) = on_select {
                act!("on_select", on_select);
            }
        }
        Block::Table {
            rows, on_select, ..
        } => {
            bind!("rows", rows);
            if let Some(on_select) = on_select {
                act!("on_select", on_select);
            }
        }
        Block::Properties { fields } => {
            for (index, field) in fields.iter().enumerate() {
                bind!(format!("fields/{index}/value"), &field.value);
            }
        }
        Block::Feed {
            entries, on_select, ..
        } => {
            bind!("entries", entries);
            if let Some(on_select) = on_select {
                act!("on_select", on_select);
            }
        }
        Block::Text { value, .. } => bind!("value", value),
        Block::Input {
            on_change,
            on_submit,
            ..
        } => {
            act!("on_change", on_change);
            if let Some(on_submit) = on_submit {
                act!("on_submit", on_submit);
            }
        }
        Block::Select {
            options, on_change, ..
        } => {
            bind!("options", options);
            act!("on_change", on_change);
        }
        Block::Toggle { on_change, .. } => act!("on_change", on_change),
        Block::Button {
            on_click,
            confirm,
            disabled,
            ..
        } => {
            act!("on_click", on_click);
            if let Some(body) = confirm.as_ref().and_then(|confirm| confirm.body.as_ref()) {
                bind!("confirm/body", body);
            }
            if let Some(disabled) = disabled {
                bind!("disabled", disabled);
            }
        }
        Block::CodeView { value, .. } => {
            if let Some(value) = value {
                bind!("value", value);
            }
        }
        Block::Image { src, .. } | Block::Media { src, .. } => bind!("src", src),
        Block::Split { .. }
        | Block::FileTree { .. }
        | Block::MarkdownEditor { .. }
        | Block::MarkdownView { .. }
        | Block::AgentChat {}
        | Block::WebView { .. }
        | Block::Explorer { .. }
        | Block::Stack { .. }
        | Block::Tabs { .. }
        | Block::Toolbar { .. }
        | Block::CodeEditor { .. } => {}
    }
    slots
}

/// 앱 정의의 모든 식(자리와 원문). `ui` 바인딩, 동작 안의 값, 원천의 값 자리를 모두 담는다. 검사가 쓴다.
pub fn all_exprs(definition: &AppDefinition) -> Vec<(String, &str)> {
    let mut out: Vec<(String, &str)> = Vec::new();
    for (name, source) in &definition.sources {
        let base = format!("/sources/{}", escape_pointer(name));
        for (field, binding) in source_bindings(source) {
            if let Binding::Expr(expr) = binding {
                out.push((format!("{base}/{field}"), expr.expr.as_str()));
            }
        }
    }
    for (pointer, binding) in ui_bindings(definition) {
        if let Binding::Expr(expr) = binding {
            out.push((pointer, expr.expr.as_str()));
        }
    }
    for (pointer, actions) in ui_actions(definition) {
        if let Actions::Many(list) = actions {
            for (index, action) in list.iter().enumerate() {
                for (field, binding) in action_bindings(action) {
                    if let Binding::Expr(expr) = binding {
                        out.push((format!("{pointer}/{index}/{field}"), expr.expr.as_str()));
                    }
                }
            }
        }
    }
    if let Some(agent) = &definition.agent {
        for (field, binding) in [
            ("namespace", &agent.namespace),
            ("profile", &agent.profile),
            ("collection", &agent.collection),
            ("model_order", &agent.model_order),
            ("selected_model", &agent.selected_model),
            ("title_template", &agent.title_template),
            (
                "initial_instruction_template",
                &agent.initial_instruction_template,
            ),
            ("instructions_template", &agent.instructions_template),
        ] {
            if let Binding::Expr(expr) = binding {
                out.push((format!("/agent/{field}"), expr.expr.as_str()));
            }
        }
    }
    out
}

/// 원천 하나 안의 바인딩 자리(원천 자리 기준 상대 경로).
pub fn source_bindings(source: &SourceDecl) -> Vec<(String, &Binding)> {
    match source {
        SourceDecl::Request { path, query, .. } => {
            let mut out = vec![("path".to_string(), path)];
            for (key, value) in query {
                out.push((format!("query/{}", escape_pointer(key)), value));
            }
            out
        }
        SourceDecl::File { path, .. } => vec![("path".to_string(), path)],
        SourceDecl::Folder { dir, .. } => dir.iter().map(|dir| ("dir".to_string(), dir)).collect(),
    }
}

/// 동작 하나 안의 바인딩 자리(동작 자리 기준 상대 경로).
pub fn action_bindings(action: &Action) -> Vec<(String, &Binding)> {
    match action {
        Action::SetState(set) => set
            .value
            .iter()
            .map(|value| ("value".to_string(), value))
            .collect(),
        Action::Refresh(_) => Vec::new(),
        Action::Call(call) => {
            let mut out = vec![("call/path".to_string(), &call.call.path)];
            for (key, value) in &call.call.query {
                out.push((format!("call/query/{}", escape_pointer(key)), value));
            }
            if let Some(body) = &call.call.body {
                out.push(("call/body".to_string(), body));
            }
            out
        }
        Action::SetStorage(set_storage) => set_storage
            .set_storage
            .value
            .iter()
            .map(|value| ("set_storage/value".to_string(), value))
            .collect(),
    }
}

/// JSON Pointer 한 토막의 이스케이프(`~` → `~0`, `/` → `~1`).
pub fn escape_pointer(token: &str) -> String {
    token.replace('~', "~0").replace('/', "~1")
}

/// 식이 `$data.이름` 꼴로 읽는 원천 이름들(겹치지 않게, 처음 나온 순서).
pub fn data_refs(expr: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let bytes = expr.as_bytes();
    let needle = b"$data.";
    let mut index = 0;
    while index + needle.len() <= bytes.len() {
        if &bytes[index..index + needle.len()] == needle {
            let start = index + needle.len();
            let mut end = start;
            while end < bytes.len()
                && (bytes[end].is_ascii_lowercase()
                    || bytes[end].is_ascii_digit()
                    || bytes[end] == b'_')
            {
                end += 1;
            }
            if end > start {
                let name = &expr[start..end];
                if !out.iter().any(|known| known == name) {
                    out.push(name.to_string());
                }
            }
            index = end.max(index + 1);
        } else {
            index += 1;
        }
    }
    out
}

/// 식이 `$storage.항목_id`로 읽는 저장 항목 id들(겹치지 않게, 처음 나온 순서).
pub fn storage_refs(expr: &str) -> Vec<String> {
    refs_after(expr, "$storage.")
}

/// `$storage_meta.` 뒤에서 읽는 필드들. 현재 허용되는 필드는 `bucket_id`뿐이다.
pub fn storage_meta_refs(expr: &str) -> Vec<String> {
    refs_after(expr, "$storage_meta.")
}

fn refs_after(expr: &str, prefix: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = expr.as_bytes();
    let needle = prefix.as_bytes();
    let mut index = 0;
    while index + needle.len() <= bytes.len() {
        if &bytes[index..index + needle.len()] == needle {
            let start = index + needle.len();
            let mut end = start;
            while end < bytes.len()
                && (bytes[end].is_ascii_lowercase()
                    || bytes[end].is_ascii_digit()
                    || bytes[end] == b'_')
            {
                end += 1;
            }
            if end > start {
                let name = &expr[start..end];
                if !out.iter().any(|known| known == name) {
                    out.push(name.to_string());
                }
            }
            index = end.max(start);
        } else {
            index += 1;
        }
    }
    out
}

#[cfg(test)]
mod storage_reference_tests {
    use super::{storage_meta_refs, storage_refs};

    #[test]
    fn storage_references_are_deduplicated_and_ignore_invalid_unicode_names() {
        assert_eq!(
            storage_refs("$storage.profile & $storage.profile & $storage_meta.bucket_id"),
            vec!["profile"]
        );
        assert_eq!(
            storage_meta_refs("$storage_meta.bucket_id"),
            vec!["bucket_id"]
        );
        assert!(storage_refs("$storage.한글").is_empty());
    }
}

/// 원천 이름의 규칙. 소문자로 시작하고 소문자, 숫자, `_`로 1~32자.
pub fn valid_source_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    (1..=32).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
}
