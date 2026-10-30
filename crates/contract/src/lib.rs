//! kaleidoscope 코어와 화면 사이 계약 (계약 16판, 261030)
//!
//! 이 파일 하나가 코어(Rust)와 화면(TS) 양쪽 타입의 정본이다. TS 타입은
//! `cargo test -p kaleidoscope-contract`가 `ui/src/contract/contract.ts`로 생성한다.
//! 화면이 지키는 한도 상수는 같은 테스트가 `ui/src/contract/limits.ts`로 생성한다.
//! 생성된 TS는 손으로 고치지 않는다. 계약을 바꾸려면 이 파일을 고치고 다시 생성한다.
//!
//! 같은 크레이트에 셋이 더 있다.
//! - [`validate`]: 앱 정의 검사. 코어(가져오기)와 오케스트레이터(에이전트가 올릴 때)가 같이 쓴다.
//! - [`registry`]: 코어와 오케스트레이터 사이 HTTP 약속(기기 연결, 앱 올리기, 이벤트 스트림, 연결 중계).
//! - [`data`]: 앱 데이터(원천, 식 바인딩, 동작)와 4판 블록이 받는 데이터 모양, 바인딩 자리 규칙.
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
//! 6판에서 바뀐 것(범용 블록 확충, 카드 #809): 블록 세트 4판(배치 `stack`, `tabs`, `toolbar`, `section`, 데이터
//! `list`, `table`, `properties`, `tree`, `feed`, `text`, 입력 `input`, `select`, `toggle`, `button`, 문서와 미디어
//! `code_editor`, `code_view`, `image`, `media`)과 앱 정의의 `sources`, 4판 블록의 식 바인딩과 동작([`data`]),
//! 모듈 `connection` 1판(서버에 등록한 이름 붙인 연결, `connection` 권한), `data.*`와 `connection.login` 명령,
//! `data.update` 이벤트. 블록은 서비스의 데이터 모양을 모르고, 앱 정의의 JSONata 식이 데이터를 블록의 모양으로
//! 바꾼다(결정 「쉘은 OS처럼 범용 기능과 범용 애셋만 (261030)」). 서버 쪽은 [`registry`]의 「연결」 절에 있다.
//!
//! 7판에서 바뀐 것(작업과 창 배치 동기화, 카드 #780): 화면 계약은 그대로다. 연결한 쉘에서 워크스페이스, 데스크톱,
//! 앱 창의 정본이 오케스트레이터로 옮겨 가고, 코어가 서버와 바뀐 것을 주고받는다([`registry`]의 「작업과 배치 동기화」 절).
//! 앱의 새 버전으로 창 상태를 옮기는 규칙은 코어와 서버가 같이 쓰도록 [`migrate_window_state`]로 뺐다.
//!
//! 8판에서 바뀐 것(탐색기 두 칸, 카드 #815): 블록 세트 5판. `explorer`가 왼쪽 폴더 트리와 오른쪽 내용의 두 칸이
//! 되고, 보는 폴더와 보기 방식([`ExplorerView`])을 창 상태에 둘 선택 필드 넷(`folder`, `on_folder`, `view`, `on_view`)이
//! 생겼다. 있던 블록에 필드를 더한 첫 판이다(규칙은 [`BLOCK_SET_VERSION`]). `files.list`의 [`FileEntry`]에 크기와
//! 바뀐 시각이 붙었다.
//!
//! 9판에서 바뀐 것(창 같이 보기, 카드 #814): 창마다 켜는 「같이 보기」. `share.set`과 `share.view` 명령,
//! [`ShellSnapshot::sharing`], 화면이 옮긴 보이는 글 [`VisibleView`], `agent.send`가 같이 보는 창의 모습을 첨부로
//! 붙이는 규칙. 블록 세트와 모듈 판은 그대로다(앱 정의가 쓰는 것이 아니라 쉘의 기능이다). 아래 「같이 보기」 절과
//! [`registry`]의 「같이 보기」 절.
//!
//! 10판에서 바뀐 것(쉘 자동 업데이트, 카드 #819): [`ShellSnapshot::update`]와 `update.restart` 명령. 설치본 쉘이 새 판을
//! 스스로 받아 두고, 디렉터가 고를 때 다시 시작하며 깐다. 블록 세트와 모듈 판, 레지스트리는 그대로다(앱 정의가 쓰는 것이
//! 아니라 쉘 자신의 기능이고, 업데이트 서버는 오케스트레이터가 아니다). 아래 「쉘 업데이트」 절.
//!
//! 11판에서 바뀐 것(P1, 카드 #818): 블록 세트 6판의 Markdown 저장소 문서 바인딩, 앱 정의 storage와 대화 provider,
//! 모듈 `storage` 1판, `agent` 3판, `connection` 2판, registry 8판. 계정은 서버가 인증 문맥에서 해석하고 기기 계약은
//! account id를 받지 않는다. 구 `agent.update`와 `workspace_id` 요청 모양은 이행 중 유지한다.
//! 대화 provider 이벤트는 `conversation.update`로 전달하고 저장소 알림은 metadata만 보낸다.
//!
//! # 계약 12판: 모듈 `storage` 2판
//! 저장 항목은 설정 화면의 보조 글 `description`과 선택지 바인딩 `choices`를 선언할 수 있다.
//! `description`은 한 줄 120자 이하이며, `choices`는 JSON 설정의 string, nullable string 또는 string 배열에서만 쓴다.
//! 설정 화면은 앱 창 제목 줄의 「앱 설정」에서 연다. 지금 쓰는 앱 버전에 `presentation: settings`인 항목이 하나 이상 있을 때
//! 보이며, 선언 순서대로 그린다. 키에 `{workspace_id}`가 없는 항목은 모든 작업 구역에, 있는 항목은 지금 작업 구역에 둔다.
//! 화면 모양은 쉘이 정한다. Markdown 항목은 저장소 문서 편집기, boolean은 toggle, enum 또는 `choices`가 있는 항목은
//! select, string과 number, integer는 입력, string 배열은 순서 있는 목록 편집으로 그린다. `[T, "null"]` 값은 비우면 null이다.
//! 선택과 toggle은 바로 저장하고 입력은 편집을 끝낼 때 저장한다. 코어는 읽은 revision으로 `storage.write`를 보내며,
//! 충돌 안내는 편집기와 같은 다시 불러오기/덮어쓰기 흐름을 쓴다. 저장값이 있을 때만 「기본값으로」를 보여 `storage.reset`한다.
//! 손대지 않은 항목은 `storage.update`를 받으면 다시 읽는다. 선택지에 없는 현재 값은 그대로 보이고, 선택지 목록이 아직 없을 때
//! 기본값으로 덮지 않는다. 이 필드가 있는 앱 정의는 `requires.modules.storage` 2판 이상을 요구한다.
//! 13판에서 바뀐 것(흐름 블록 본문 나란히와 복사 단추, 카드 #808): 블록 세트 7판. `feed`의 `columns`(본문 문단 나란히)와
//! `copy`(`meta`와 문단마다 복사 단추). 모듈과 레지스트리 판은 그대로다.
//!
//! # 계약 14판: 모듈 `files` 2판, 내 PC 범위 (카드 #815)
//! `files` 권한에 선택 필드 `scope`가 생겼다([`FilesScope`]). `pc`면 폴더를 고르지 않고 이 PC 전체를 읽는다.
//! 경로의 첫 마디가 「내 PC」의 뿌리([`PcRootKind`]: 알려진 폴더나 볼륨)이고, 그 아래는 고른 폴더와 같은 경로 규칙이다.
//! 빈 경로는 내 PC 자체이고 `files.list`는 뿌리들을 낸다. 이 범위는 기기마다 앱마다 처음 한 번 허용받는다
//! (`files.allow_pc`, [`PcAccess`]). 지금은 `explorer` 블록만 이 범위의 권한을 쓸 수 있다. 탐색기가 파일을 열면
//! 여는 앱에는 그 파일이 든 폴더만 준다. 이 필드를 쓴 앱 정의는 `requires.modules.files` 2판 이상을 요구한다.
//!
//! # 계약 15판: 대화 제공자 코어 오류와 adoption
//! `login_required`면 화면은 앱 정의의 `agent.permission`으로 `connection.login`을 부른다.
//! `binding_conflict`는 저장소와 제공자의 대화 참조가 다른 경우다. 생성 notice는 기록의 notice item으로 받는다.
//! 기존 대화 연결의 adoption 요청 DTO를 더했다. 블록 세트와 모듈 판은 그대로다.
//! 스트림의 최종 인증 실패는 `conversation.error`로 알리고, 로그인 성공 시 코어가 다시 연결한다.
//! 접수 전에 중단된 초안은 `conversation.get` 때 `conversation.draft`로 창에 알린다.
//! 실패한 영수증의 초안은 `failed: true`이며 새 request_id로 다시 보낸다.
//!
//! # 계약 16판: 대화 설정 적용 상태
//! `conversation.apply_status`와 같은 이름의 이벤트는 앱 설정의 제공자 적용 상태를 나타낸다.
//! 저장 성공과 적용 성공은 별개이며, `unapplied`일 때 `conversation.apply_retry`로 다시 시도한다.
//! `agent`의 바인딩은 리터럴과 `$storage`, `$storage_meta`만 사용한다. 창 상태 바인딩이나
//! `$state`, `$data`, `$event`, `$item` 참조는 거부한다. 생성과 재적용은 계정 × 앱과 작업의 저장값을
//! 같은 방식으로 계산하며 작업 키는 대상 작업으로 푼다. 창은 작업을 식별하는 데만 쓴다.
//! 앱 정의, 블록과 모듈 판, 제공자 wire는 바꾸지 않는다.
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
//!   - 워크스페이스, 데스크톱, 앱 창: 오케스트레이터에 연결했으면 오케스트레이터가 정본이고 `state.json`은 그
//!     사본이다. 코어는 바꾼 것을 서버에 올리고 서버가 알리는 것을 받아 맞춘다. 끊긴 동안 바꾼 것은 다시 이으면
//!     올린다. 연결하지 않았으면 코어가 정본이다. 규칙은 [`registry`]의 「작업과 배치 동기화」 절에 있다.
//!   - 화면은 이 경계를 모른다. 다른 기기에서 바뀐 것도 `state.changed`로 온다.
//! - [`DeviceState`]: 지금 고른 워크스페이스와 데스크톱, 고른 폴더. 그 기기의 `device.json`에만 둔다.
//!   다른 기기에서 워크스페이스나 데스크톱, 창이 지워지면 코어가 이 기기의 고른 것과 고른 폴더를 맞춘다.
//! - 오케스트레이터 연결 정보(서버 주소, 기기 id, 기기 토큰)는 그 기기의 `link.json`에만 두고 화면에
//!   보내지 않는다. 화면은 [`LinkStatus`]만 본다.
//! - 같이 보기를 켠 창([`ShellSnapshot::sharing`])과 그 창의 보이는 글은 코어의 메모리에만 둔다.
//!
//! # 같이 보기 (9판)
//! 디렉터가 창의 「같이 보기」를 켜 두면, 그 창에 지금 보이는 글을 작업 PAS가 디렉터의 다음 말과 함께 받는다.
//! - 켜고 끄는 것은 그 기기의 그 창 하나에만 걸린다. 저장하지 않으므로 쉘을 다시 켜면 모두 꺼진 채로 시작한다.
//!   창이 없어지면(창 닫기, 데스크톱과 워크스페이스 지우기, 다른 기기에서 지운 것을 받은 때) 코어가 끈다.
//! - 화면은 켜진 창에 보이는 부분을 글로 옮겨([`VisibleView`]) 바뀔 때마다 `share.view`로 코어에 준다. 앱마다
//!   요약하지 않고, 쉘이 블록 종류와 접근성 정보(ARIA 역할과 이름)로 옮긴다. 스크롤 밖이나 다른 데스크톱처럼
//!   보이지 않는 부분은 옮기지 않는다.
//! - 코어는 연결되어 있으면 그 글을 서버에 올린다. 서버는 창마다 지금 글을 들고 있다가, 그 작업의 PAS에 말이 갈
//!   때 지난번에 보낸 것과 달라진 것만 말 뒤에 붙인다([`registry`]의 「같이 보기」 절). 글이 바뀔 때마다 PAS를
//!   깨우지 않는다(말 하나가 PAS의 턴 하나이므로).
//! - 이미지나 웹 화면처럼 글로 옮길 수 없는 것이 보이는 창(`visual`)은, `agent.send` 때 코어가 그 창의 모습을
//!   찍어 첨부로 붙인다. 지난번에 붙인 모습과 같으면 붙이지 않는다.
//! - 같이 보기를 켠 창만, 켠 동안만 이 기기 밖(서버와 소울스트림)으로 나간다.
//!
//! # 쉘 업데이트 (10판)
//! 설치본 쉘(Windows NSIS)이 새 판을 스스로 받아 깐다. 디렉터는 업데이터가 든 첫 판만 손으로 깐다.
//! - 묻고 받는 것은 앱 크레이트(Tauri 업데이터)가 한다. 쉘을 켜고 [`UPDATE_FIRST_CHECK_DELAY_SECS`] 뒤 한 번, 그 뒤로
//!   [`UPDATE_CHECK_INTERVAL_SECS`](5분)마다 업데이트 서버(`https://eiaserinnys.me/tauri-update/update/kaleidoscope`,
//!   서비스 `tauri-app-updater`)에 묻는다. 새 판이 있으면 바로 받아 서명을 확인하고 [`UpdateStatus::Ready`]로 알린다.
//!   받은 설치본은 메모리에만 있어 다시 시작하지 않고 쉘을 끄면 다음에 켤 때 다시 받는다. `ready`인 동안에는 묻지 않는다.
//! - 쉘은 혼자 다시 시작하지 않는다. 디렉터가 화면에서 고르면 화면이 편집기의 저장 대기분을 먼저 저장하고(저장이
//!   실패하거나 충돌이면 다시 시작하지 않는다) `update.restart`를 부른다. 코어는 디스크에 쓸 것을 쓰고 설치를 시작한다.
//!   Windows에서는 설치 프로그램이 조용한 모드(진행 막대만)로 뜨고 쉘이 바로 끝나며, 설치가 끝나면 새 판 쉘이 다시 뜬다.
//!   워크스페이스, 데스크톱, 창과 창 상태는 저장된 그대로 이어진다(연결한 쉘은 서버 정본). 같이 보기처럼 메모리에만
//!   두는 것은 꺼진 채로 시작한다.
//! - 서명은 쉘에 들어 있는 공개 키로 받은 직후와 깔기 직전에 확인한다. 맞지 않으면 깔지 않고 [`UpdateStatus::Failed`]다.
//!   서명 비밀 키는 리포의 GitHub secrets에만 있고 릴리스 워크플로가 서명한다.
//! - 개발용 HTTP 다리, 브라우저 하니스, 업데이터 설정이 없는 빌드는 늘 [`UpdateStatus::Unavailable`]이다.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod app_storage;
pub mod conversation;
pub mod data;
pub mod registry;
pub mod validate;

use data::{Actions, Binding, SourceDecl};

/// 창 상태와 앱 정의의 상태 기본값에 쓰는 임의 JSON 값.
pub type JsonValue = serde_json::Value;

/// Tauri 명령 이름. 화면은 `invoke("core", { request })`로 부른다.
pub const TAURI_COMMAND: &str = "core";
/// Tauri 이벤트 이름. 화면은 `listen("core-event", ...)`로 받는다.
pub const TAURI_EVENT: &str = "core-event";

/// 이 쉘이 그릴 수 있는 블록 세트 버전. 블록 세트 전체에 정수 하나다.
///
/// 호환 규칙: 블록 세트의 새 판은 블록이나 있던 블록의 선택 필드를 더하기만 한다. 있던 필드의 뜻은 바꾸지
/// 않으므로 `requires.blocks`가 이 값 이하인 정의는 모두 그대로 그린다.
/// - 있던 블록에 더한 필드는 그 판 이상을 요구한다. 그 필드를 쓴 정의의 `requires.blocks`가 낮으면 검사기가
///   거부하고, 서버는 그 판을 그리지 못하는 쉘에 그 앱을 보내지 않는다. 필드를 쓰지 않은 정의는 전 판 그대로다.
/// - 블록이 그리는 모양과 조작은 쉘이 판마다 다듬을 수 있다(OS가 기본 앱을 고치듯). 정의 필드의 뜻과 앱이 기대는
///   동작(예: 탐색기에서 파일을 열면 `opens`의 앱으로 연다)은 지킨다.
/// - 1판: `split`, `file_tree`, `markdown_editor`, `markdown_view`.
/// - 2판: 1판 + `agent_chat`.
/// - 3판: 2판 + `web_view`, `explorer`, 앱 정의의 `opens`.
/// - 4판: 3판 + `stack`, `tabs`, `toolbar`, `section`, `list`, `table`, `properties`, `tree`, `feed`, `text`,
///   `input`, `select`, `toggle`, `button`, `code_editor`, `code_view`, `image`, `media`, 앱 정의의 `sources`.
/// - 5판: 4판 + `explorer`의 `folder`, `on_folder`, `view`, `on_view`. 5판 쉘은 탐색기를 폴더 트리와 내용의 두 칸으로
///   그리고, 이 필드가 없는 3판 정의의 탐색기도 같은 모습으로 그린다.
/// - 6판: 5판 + `markdown_editor`와 `markdown_view`의 `document` 바인딩, 앱 정의의 `storage`와 `agent`.
/// - 7판: 6판 + `feed`의 `columns`, `copy`.
pub const BLOCK_SET_VERSION: u32 = 7;
/// 이 쉘이 제공하는 모듈과 버전.
/// - `files` 1판: 기기마다 고른 폴더의 파일 목록, 읽기, 쓰기, 탐색기에서 다른 앱으로 열기(`files.open`).
///   목록의 항목은 계약 8판부터 크기와 바뀐 시각을 담는다(앱 정의와 무관해 모듈 판은 그대로다).
/// - `files` 2판: 1판 + 권한의 `scope: pc`(이 PC 전체 읽기, 내 PC의 알려진 폴더와 볼륨, 기기와 앱마다 처음 한 번
///   허용, `files.allow_pc`). 계약 14판.
/// - `agent` 1판: 창이 있는 워크스페이스의 PAS와 대화(`agent.*` 명령).
/// - `agent` 2판: 1판 + 첨부(보내기, 기록에서 보기와 열기). 모듈의 새 판도 더하기만 하므로
///   `agent: 1`을 요구하는 정의는 2판 쉘에서 그대로 돌고 첨부도 쓴다.
/// - `web` 1판: 창 안에 웹 페이지를 띄우는 웹 화면(`web.*` 명령). 쉘이 그린 화면 위에 따로 뜬다.
/// - `agent` 3판: `conversation-v1` 제공자 설정과 `window_id` 기반 대화 명령. 옛 `workspace_id` 명령은 이행 중 유지한다.
/// - `storage` 1판: 계정 × 앱 저장소의 선언과 읽기, CAS 쓰기, 초기화.
/// - `storage` 2판: 1판 + 저장 항목의 설정 화면 보조 글과 선택지 바인딩.
/// - `connection` 1판: 서버에 등록한 이름 붙인 연결(`connection` 권한). 원천 받기, 동작의 연결 부르기,
///   이미지와 소리 받기. 연결은 서버가 헤더를 쥐고 대신 부르는 `relay`와 이 기기가 로그인해 직접 부르는
///   `oauth` 두 가지다([`registry`]의 「연결」 절).
/// - `connection` 2판: 계정마다 연결 이름을 등록한다.
pub const MODULE_VERSIONS: &[(&str, u32)] = &[
    ("files", 2),
    ("agent", 3),
    ("web", 1),
    ("connection", 2),
    ("storage", 2),
];

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

/// (9판) 같이 보기 글([`VisibleView::text`]) 하나의 최대 바이트 수(UTF-8). 화면은 넘으면 줄 경계에서 뒤를 자르고
/// 마지막 줄에 [`SHARE_TEXT_CUT_MARK`]를 둔다(그 줄까지 합쳐 이 값 이하). 코어와 서버는 넘는 글을 거부한다.
pub const SHARE_TEXT_MAX_BYTES: usize = 16 * 1024;
/// (9판) 잘린 같이 보기 글의 마지막 줄.
pub const SHARE_TEXT_CUT_MARK: &str = "…(아래는 길어서 뺐습니다)";
/// (9판) 같이 보기 창에 보이는 것이 바뀐 뒤 화면이 글을 다시 옮기기까지 기다리는 시간. 그 사이 또 바뀌면
/// 다시 기다린다.
pub const SHARE_DEBOUNCE_MS: u64 = 800;
/// (9판) 같이 보기 모습 캡처의 긴 변 최대 픽셀. 크면 코어가 비율을 지켜 줄인다.
pub const SHARE_CAPTURE_MAX_EDGE: u32 = 1600;
/// (9판) 같이 보기 모습 캡처 첨부의 이름 앞부분. 뒤에 앱 이름과 `.png`가 붙는다(예: `같이 보기 - 웹 브라우저.png`).
/// 앱 이름의 경로 구분자와 Windows가 파일 이름에 받지 않는 글자는 `_`로 바꾼다.
pub const SHARE_CAPTURE_NAME_PREFIX: &str = "같이 보기 - ";

/// (10판) 쉘을 켠 뒤 처음 새 판을 묻기까지 기다리는 시간. 시작 직후의 연결과 화면 그리기를 먼저 하려는 것이다.
pub const UPDATE_FIRST_CHECK_DELAY_SECS: u64 = 10;
/// (10판) 새 판을 다시 묻는 간격. 서버가 GitHub 릴리스 목록을 5분 캐시하므로 기기마다 5분 간격으로 물어도 부담이 없다.
pub const UPDATE_CHECK_INTERVAL_SECS: u64 = 300;

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

/// 앱의 다른 버전으로 창을 옮길 때의 창 상태. 새 정의의 `state`에 선언된 키만 남기고, 옛 상태에 같은 키가
/// 있으면 그 값을, 없으면 새 정의의 기본값을 쓴다.
///
/// 코어(앱의 새 버전을 받았을 때와 서버에서 받은 창의 버전이 캐시와 다를 때)와 오케스트레이터(앱의 새 버전을
/// 올렸을 때 저장한 창을 옮길 때)가 같은 규칙을 쓴다. 창의 `app_version`은 부른 쪽이 바꾼다.
pub fn migrate_window_state(
    definition: &AppDefinition,
    old_state: &BTreeMap<String, JsonValue>,
) -> BTreeMap<String, JsonValue> {
    let mut next = definition.state.clone();
    for (key, value) in old_state {
        if let Some(slot) = next.get_mut(key) {
            *slot = value.clone();
        }
    }
    next
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
    /// (계약 14판) 이 기기에서 `scope: pc` 권한을 허용한 앱과 권한. 앱마다 한 번이고 그 앱의 모든 창이 쓴다.
    /// 앱의 새 버전에서도 같은 `id`의 `pc` 권한이 있으면 이어 쓴다.
    #[serde(default)]
    pub pc_access: Vec<PcAccess>,
}

/// (계약 14판) 이 기기에서 앱 하나의 `scope: pc` 권한 하나를 허용한 기록. 기기 밖으로 나가지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct PcAccess {
    pub app_id: String,
    /// 앱 정의의 권한 `id`.
    pub permission: String,
    pub granted_at: String,
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
    /// (9판) 이 기기에서 같이 보기를 켠 창의 id. 켠 순서다. 코어의 메모리에만 있어 쉘을 다시 켜면 빈 목록이다.
    pub sharing: Vec<String>,
    /// (10판) 이 쉘 자신의 새 판 받기 상태. 코어의 메모리에만 있다.
    pub update: UpdateStatus,
}

/// (10판) 이 쉘 자신의 새 판 받기 상태. `state`로 가른다. 위 「쉘 업데이트」 절.
///
/// 흐름: `idle` → (새 판이 있음) `downloading` → (받고 서명 확인) `ready` → (`update.restart`) 쉘이 끝나고 새 판이 뜬다.
/// 묻기, 받기, 서명 확인, 설치 시작 가운데 하나가 실패하면 `failed`이고, 다음 확인 때 처음부터 다시 한다.
/// 화면은 `ready`일 때만 디렉터에게 알린다. 나머지 상태는 보이지 않는다(검증과 진단용).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum UpdateStatus {
    /// 이 쉘은 스스로 업데이트하지 않는다(개발용 다리, 업데이터 설정이 없는 빌드).
    Unavailable {},
    /// 지금 판이 최신이거나 아직 묻지 않았다. `current_version`은 이 쉘의 판(예: `0.5.0`).
    Idle { current_version: String },
    /// 새 판 `version`을 받는 중이다.
    Downloading {
        current_version: String,
        version: String,
    },
    /// 새 판 `version`을 받아 서명까지 확인했다. `update.restart`로 다시 시작하면 깔린다.
    Ready {
        current_version: String,
        version: String,
    },
    /// 실패했다. `version`은 받으려던 새 판(묻기에서 실패했으면 null), `reason`은 사람이 읽는 한국어 한 줄.
    Failed {
        current_version: String,
        version: Option<String>,
        reason: String,
    },
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
// 앱 정의 (블록 세트 4판)
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
///    - (4판) `sources`를 쓰면 `requires.blocks`가 4 이상이다. 원천 이름은 [`data::valid_source_name`]을 지킨다.
///      `request` 원천의 권한은 `connection` 모듈, `file`과 `folder`의 권한은 `files` 모듈이다.
///      `refresh_secs`는 [`data::SOURCE_REFRESH_MIN_SECS`] 이상이다. 원천의 값 자리 식은 `$data`, `$event`, `$item`을
///      쓰지 않는다. 정의에 직접 적은 `request` 경로는 `/`로 시작하고, `file` 경로는 [`FileRef`]의 경로 규칙을 지킨다.
///    - (4판) 모든 식(`expr`)은 JSONata로 읽혀야 하고, 식이 `$data.이름`으로 읽는 원천은 `sources`에 있다.
///      `state`나 `expr` 하나만 가진 객체를 리터럴 바인딩으로 쓰지 않는다(모양이 틀린 바인딩).
///    - (4판) 동작의 상태 키는 선언되어 있고, `refresh`의 원천은 있다. `call`의 권한은 `connection` 모듈이고,
///      GET이 아니면 `readwrite`다.
///    - (4판) `connection` 권한을 쓰면 `requires.modules`에 `connection`이 있다. 연결 이름은 소문자, 숫자, `-` 1~64자다.
///    - (4판) `toolbar`의 자식은 `input`, `select`, `toggle`, `button`, `text`뿐이다. `stack`의 `fill`은 자식 안의
///      순서다. `tabs`와 `stack`에는 자식이 하나 이상 있다. `table`의 열은 하나 이상이고 `field`가 겹치지 않는다.
///      `button`의 `icon`은 [`data::ICON_NAMES`]에 있다. `code_editor`의 권한은 `readwrite`다.
///      `code_view`는 `value`와 `file` 가운데 꼭 하나를 쓴다.
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
    /// (블록 세트 4판) 이름 붙인 원천. 식에서 `$data.이름`으로 읽는다. 규칙은 [`data`] 모듈 머리글에 있다.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[ts(optional, as = "Option<BTreeMap<String, SourceDecl>>")]
    pub sources: BTreeMap<String, SourceDecl>,
    /// (계약 11판, 모듈 `storage` 1판) 계정 × 앱 저장소에 둘 항목과 기본값.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub storage: Option<app_storage::StorageDecl>,
    /// (계약 11판, 모듈 `agent` 3판) 앱이 사용하는 범용 대화 제공자와 저장소 바인딩.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent: Option<AgentProvider>,
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

/// TypeScript에서 대화 설정 바인딩의 창 상태 형태를 제외한다. 실행 시 공통 검사기가 식도 검사한다.
#[derive(TS)]
#[ts(
    export,
    export_to = "contract.ts",
    type = "ExprRef | string | number | boolean | null | Array<JsonValue> | ({ [key: string]: JsonValue } & { state?: never; expr?: never })"
)]
pub struct AgentBinding;

/// 앱의 대화 제공자. 바인딩은 리터럴 또는 `$storage`, `$storage_meta`만 읽는다.
/// 창 상태 바인딩과 `$state`, `$data`, `$event`, `$item`은 사용할 수 없다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AgentProvider {
    pub protocol: conversation::ConversationProtocol,
    pub permission: String,
    /// 연결 base URL 아래의 안전한 상대 경로.
    pub base_path: String,
    #[schemars(schema_with = "agent_binding_schema")]
    #[ts(as = "AgentBinding")]
    pub namespace: Binding,
    #[schemars(schema_with = "agent_binding_schema")]
    #[ts(as = "AgentBinding")]
    pub profile: Binding,
    #[schemars(schema_with = "agent_binding_schema")]
    #[ts(as = "AgentBinding")]
    pub collection: Binding,
    #[schemars(schema_with = "agent_binding_schema")]
    #[ts(as = "AgentBinding")]
    pub model_order: Binding,
    #[schemars(schema_with = "agent_binding_schema")]
    #[ts(as = "AgentBinding")]
    pub selected_model: Binding,
    #[schemars(schema_with = "agent_binding_schema")]
    #[ts(as = "AgentBinding")]
    pub title_template: Binding,
    #[schemars(schema_with = "agent_binding_schema")]
    #[ts(as = "AgentBinding")]
    pub initial_instruction_template: Binding,
    #[schemars(schema_with = "agent_binding_schema")]
    #[ts(as = "AgentBinding")]
    pub instructions_template: Binding,
    /// 현재 작업에 thread id를 저장하는 JSON 항목 id.
    pub thread_entry: String,
}

fn agent_binding_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    let mut schema = generator.subschema_for::<Binding>();
    schema.insert(
        "not".into(),
        serde_json::json!({"type":"object", "required":["state"]}),
    );
    schema.insert("description".into(), serde_json::json!("리터럴 또는 $storage와 $storage_meta를 읽는 식. $state, $data, $event, $item은 사용할 수 없다."));
    schema
}

/// 문서를 저장소 md 항목에 연결한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct DocumentRef {
    pub entry: String,
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
    /// (모듈 `files` 2판) `scope`가 `pc`면 폴더를 고르지 않고 이 PC 전체를 읽는다([`FilesScope`]).
    Files {
        id: String,
        access: FileAccess,
        /// 폴더를 고르라고 할 때 보일 이름(예: "문서 폴더"). `scope: pc`면 탐색기 경로의 맨 앞 마디 이름(예: "내 PC").
        label: String,
        /// (모듈 `files` 2판) 없으면 `folder`다.
        #[serde(default, skip_serializing_if = "FilesScope::is_folder")]
        #[ts(optional, as = "Option<FilesScope>")]
        scope: FilesScope,
    },
    /// (모듈 `connection` 1판) 서버에 등록한 연결 하나. 주소와 인증은 서버의 연결 설정에 있고 앱 정의에는 이름만 둔다.
    /// `read`는 GET만, `readwrite`는 동작의 연결 부르기에서 다른 메서드도 쓴다(서버의 연결도 쓰기를 허락해야 한다).
    /// 연결이 기기 로그인(`oauth`)이면 이 기기에서 처음 쓸 때 로그인 단추가 보인다.
    Connection {
        id: String,
        /// 서버에 등록한 연결 이름(소문자, 숫자, `-` 1~64자).
        connection: String,
        access: FileAccess,
        /// 로그인을 구할 때와 오류에 보일 이름(예: "카드 보드").
        label: String,
    },
}

/// (모듈 `files` 2판) `files` 권한이 가리키는 범위.
///
/// `pc`의 규칙:
/// - 읽기 전용이다(`access: read`). 지금은 `explorer` 블록의 `root`만 이 권한을 가리킬 수 있다(검사기가 거부).
/// - 이 기기에서 이 앱에 처음 쓸 때 허용을 받는다(`files.allow_pc`). 허용 전의 `files.*`는 `not_granted`다.
/// - 경로의 첫 마디는 뿌리의 id([`PcRootKind`])이고 그 아래는 [`FileRef`]의 경로 규칙을 따른다. 빈 경로는 내 PC 자체이고
///   `files.list`는 뿌리들을 낸다(알려진 폴더 먼저, 그다음 볼륨, 각각 이 기기가 준 순서). 뿌리에 없는 첫 마디는
///   `not_found`다. 창 상태에 이 경로를 두므로 다른 PC에서도 같은 알려진 폴더 아래를 연다(없으면 `not_found`).
/// - 코어는 이 쉘 자신의 데이터 폴더(기기 토큰, 로그인 정보) 안을 가리키는 경로를 `permission_denied`로 거부하고,
///   목록에서도 뺀다.
/// - Windows에서는 숨김이나 시스템 속성이 있는 항목을 목록에서 뺀다(`$Recycle.Bin`, `System Volume Information`,
///   `pagefile.sys`, 문서 폴더의 `My Music` 같은 연결점). 이 규칙은 `folder` 범위의 목록에도 같다.
/// - 탐색기가 이 범위의 파일을 열면(`files.open`) 여는 앱의 창에는 그 파일이 든 폴더를 고른 것으로 두고, 경로는
///   파일 이름이다. 여는 앱은 PC 전체를 받지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum FilesScope {
    /// 기기마다 고르는 폴더 하나(1판부터의 뜻).
    #[default]
    Folder,
    /// 이 PC 전체(읽기만).
    Pc,
}

impl FilesScope {
    pub fn is_folder(&self) -> bool {
        matches!(self, FilesScope::Folder)
    }
}

/// (계약 14판) 내 PC 뿌리의 종류. 뿌리 하나는 id(경로의 첫 마디), 종류, 화면 이름, 이 기기의 절대 경로이고,
/// 코어의 호스트가 이 기기에서 찾아 준다(절대 경로는 화면과 서버에 보내지 않는다).
/// - 알려진 폴더: id는 [`PC_KNOWN_FOLDERS`]의 id, 이름은 그 표의 이름.
/// - 볼륨: Windows는 id가 드라이브 글자 하나(대문자, 예: `C`)이고 이름은 「볼륨 이름 (C:)」, 볼륨 이름이 없으면
///   「로컬 디스크 (C:)」다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum PcRootKind {
    /// 사용자의 알려진 폴더(바탕 화면, 문서 등).
    Known,
    /// 드라이브나 볼륨.
    Volume,
}

/// (계약 14판) 내 PC에 보일 알려진 폴더의 id와 이 쉘이 쓰는 이름, 이 순서로 보인다. 이 기기에 없는 것은 뺀다.
pub const PC_KNOWN_FOLDERS: &[(&str, &str)] = &[
    ("desktop", "바탕 화면"),
    ("documents", "문서"),
    ("downloads", "다운로드"),
    ("pictures", "사진"),
    ("music", "음악"),
    ("videos", "동영상"),
];

impl PermissionDecl {
    pub fn id(&self) -> &str {
        match self {
            PermissionDecl::Files { id, .. } | PermissionDecl::Connection { id, .. } => id,
        }
    }

    /// 이 권한의 모듈 이름.
    pub fn module(&self) -> &'static str {
        match self {
            PermissionDecl::Files { .. } => "files",
            PermissionDecl::Connection { .. } => "connection",
        }
    }

    pub fn access(&self) -> FileAccess {
        match self {
            PermissionDecl::Files { access, .. } | PermissionDecl::Connection { access, .. } => {
                *access
            }
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

/// 블록. 블록 세트 4판의 전부다. 새 블록은 쉘 릴리스로만 더한다.
///
/// 4판 블록의 값 자리는 [`Binding`](리터럴, 창 상태, 식)이고, 이벤트 자리는 [`Actions`]다. 블록이 받는 데이터
/// 모양은 [`data`] 모듈의 [`data::ListItem`] 등에 있다. 식의 값이 아직 없으면(원천을 받는 중, 실패, 로그인 필요)
/// 데이터 블록은 그 상태를 그 자리에 보인다. 4판 블록은 쉘의 토큰과 공통 부품만으로 그리고, 앱이 색이나 크기를
/// 정하지 않는다(항목의 `color`와 배지 색만 예외).
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
    /// (블록 세트 6판) `document`는 선언된 md 저장 항목을 읽고 쓴다. `file`과 함께 쓰지 않는다.
    MarkdownEditor {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        document: Option<DocumentRef>,
    },
    /// 마크다운을 렌더해서 읽기만 한다. 원문의 HTML은 그리지 않는다.
    /// 쉘 창이 포커스를 다시 얻으면 파일이나 문서를 다시 읽는다. 경로가 null이면 빈 상태를 보인다.
    /// (블록 세트 6판) `document`는 선언된 md 저장 항목을 읽는다. `file`과 함께 쓰지 않는다.
    MarkdownView {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        document: Option<DocumentRef>,
    },
    /// (블록 세트 2판) 이 창이 있는 워크스페이스의 PAS와 나누는 대화. `requires.modules`에 `agent`가
    /// 있어야 한다. 창마다 설정할 것이 없다. 같은 워크스페이스의 대화 창은 모두 같은 PAS를 본다.
    /// 앱 정의에 `agent` provider가 있으면 `agent` 3판의 대화 제공자를 사용한다. 선언이 없는 기존
    /// `agent_chat {}`는 아래 워크스페이스 PAS 동작을 유지한다.
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
    /// (블록 세트 3판, 5판에서 두 칸으로) 고른 폴더를 보는 탐색기. 폴더를 아직 안 골랐으면 폴더 고르기를 보인다.
    ///
    /// - 왼쪽 칸은 폴더 트리(폴더만), 오른쪽 칸은 지금 보는 폴더의 내용이다. 처음에는 고른 폴더 자체를 본다.
    ///   왼쪽 칸은 `split`의 첫 칸처럼 접을 수 있고, 두 칸 사이를 끌어 폭을 바꾼다(저장하지 않음).
    /// - 왼쪽에서 폴더를 누르면 그 폴더를 보고 그 폴더를 편다. 오른쪽에서 폴더를 두 번 누르거나 고른 채 Enter를
    ///   누르면 그 폴더로 들어가고, 왼쪽 트리도 그 폴더까지 펴서 고른다. 오른쪽 위에는 위 폴더로 가는 단추와
    ///   지금 경로가 있고, 경로의 마디를 누르면 그 폴더로 간다.
    /// - 오른쪽 보기는 [`ExplorerView`]의 둘이다. 「아이콘」은 파일 종류 아이콘과 이름의 격자, 「자세히」는 이름,
    ///   수정한 날짜, 종류, 크기의 표이고 머리를 누르면 그 열로 정렬한다(오름차순, 내림차순, 처음 순서, 저장하지
    ///   않음). 어느 보기든 폴더가 파일보다 앞이다.
    /// - 파일을 누르면 고르기만 한다(창 상태에 쓰지 않는다). 파일을 두 번 누르거나 고른 채 Enter를 누르면 그
    ///   확장자를 여는 앱(지금 버전 정의의 `opens`)으로 연다(`files.open`). 여는 앱이 하나면 바로 열고, 여럿이면 앱
    ///   이름순 메뉴로 고르게 하고, 없으면 그 메뉴에 열 수 있는 앱이 없다고 보인다. 파일의 오른쪽 클릭 메뉴도 같은
    ///   앱 목록이다.
    /// - 쉘 창이 포커스를 다시 얻으면 지금 보는 폴더와 왼쪽에서 편 폴더를 다시 읽는다.
    /// - `folder`와 `on_folder`, `view`와 `on_view`(5판)를 주면 보는 폴더와 보기 방식을 창 상태에서 읽고 바뀔 때 쓴다
    ///   (창을 다시 열거나 다른 기기에서 열어도 그 자리). 없으면 쉘이 들고 저장하지 않는다. 읽은 폴더가 경로 규칙
    ///   ([`FileRef`])에 맞지 않거나 읽을 수 없으면 고른 폴더 자체를 보고 그것을 쓴다. 보기 값이 [`ExplorerView`]가
    ///   아니면 「아이콘」으로 본다. 고른 폴더를 바꾸면 고른 폴더 자체로 돌아간다.
    Explorer {
        root: FolderRef,
        /// (5판) 지금 보는 폴더를 읽을 상태 키. 값은 고른 폴더 기준 상대 경로이고 빈 문자열이 고른 폴더 자체다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        folder: Option<StateRef>,
        /// (5판) 보는 폴더가 바뀌면 그 경로를 쓸 상태 키.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_folder: Option<SetState>,
        /// (5판) 보기 방식([`ExplorerView`]의 문자열)을 읽을 상태 키.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        view: Option<StateRef>,
        /// (5판) 보기 방식을 바꾸면 그 값을 쓸 상태 키.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_view: Option<SetState>,
    },

    // ----- 블록 세트 4판: 배치 -----
    /// (4판) 자식을 한 줄로 쌓는다. 끌어서 크기를 바꾸지 않는다(그건 `split`). 자식은 제 크기만 차지하고,
    /// `fill`번째 자식(없으면 마지막)이 남은 자리를 모두 차지한다. 넘치면 그 칸 안에서 스크롤한다.
    Stack {
        direction: SplitDirection,
        #[serde(default)]
        #[ts(optional, as = "Option<Gap>")]
        gap: Gap,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        fill: Option<u32>,
        children: Vec<Block>,
    },
    /// (4판) 탭. 고른 탭의 자식만 그린다. `selected`를 주면 고른 탭의 순서(0부터)를 창 상태에서 읽고 바꿀 때
    /// `on_change`로 쓴다(다시 열어도 그 탭). 없으면 쉘이 들고 저장하지 않는다.
    Tabs {
        tabs: Vec<Tab>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_change: Option<SetState>,
    },
    /// (4판) 도구 막대. 한 줄의 컨트롤을 앞(`start`)과 끝(`end`)으로 나눠 놓는다. 자식은 `input`, `select`,
    /// `toggle`, `button`, `text`뿐이다. 높이와 여백, 아래 구분은 쉘이 정한다. `input`은 남은 폭을 차지한다.
    Toolbar {
        start: Vec<Block>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<Block>>")]
        end: Vec<Block>,
    },
    /// (4판) 제목이 있는 구역. `collapsible`이면 머리를 눌러 접고 편다(저장하지 않음). `collapsed`는 처음 모습이다.
    Section {
        title: Binding,
        /// 제목 옆에 작게 보일 부가 정보(개수 등).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        meta: Option<Binding>,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        collapsible: bool,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        collapsed: bool,
        child: Box<Block>,
    },

    // ----- 블록 세트 4판: 데이터 보기 -----
    /// (4판) 목록. `items`는 [`data::ListItem`] 배열이고, `grouped`면 [`data::Group`]`<ListItem>` 배열이다.
    /// `layout`이 `grid`면 그림 칸의 격자다(그림이 없는 항목은 빈 칸에 제목만). 항목을 누르면 `on_select`가
    /// `$event`(항목의 `key`)와 `$item`(항목)으로 돈다. `selected`의 값과 `key`가 같은 항목을 고른 것으로 보인다.
    /// 화살표 키로 옮겨 다니고 Enter로 고른다. 긴 목록은 보이는 줄만 그린다.
    List {
        items: Binding,
        #[serde(default)]
        #[ts(optional, as = "Option<ListLayout>")]
        layout: ListLayout,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        grouped: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
    },
    /// (4판) 표. `rows`는 객체 배열이고 각 행에 `key`(문자열)가 있다. 칸은 `columns`의 `field`로 행에서 읽는다.
    /// 열 머리를 누르면 오름차순, 내림차순, 처음 순서로 돈다(저장하지 않음, `sort`가 처음 모습). 머리는 위에
    /// 붙어 있고 긴 표는 보이는 줄만 그린다. 고르기는 `list`와 같다.
    Table {
        rows: Binding,
        columns: Vec<Column>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        sort: Option<SortSpec>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
    },
    /// (4판) 속성 이름과 값의 목록(상세 보기). 값이 null이거나 빈 글이면 그 줄을 뺀다. 값을 고르고 복사할 수 있다.
    Properties { fields: Vec<PropertyField> },
    /// (4판) 데이터 트리. `items`는 [`data::TreeItem`] 배열이다. `by`가 `path`면 항목의 `path`를 `/`로 나눠 폴더를
    /// 만든다. 아래 항목이 있는 것(폴더)은 펴고 접기만 하고, 끝 항목을 누르면 `on_select`가 돈다. 고른 항목의
    /// 위 폴더는 처음에 펴 둔다. 편 상태는 저장하지 않는다.
    Tree {
        items: Binding,
        #[serde(default)]
        #[ts(optional, as = "Option<TreeBy>")]
        by: TreeBy,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
    },
    /// (4판) 흐름. 대화 기록, 대사, 로그처럼 이름과 본문이 이어지는 것. `entries`는 [`data::FeedEntry`] 배열이고,
    /// `grouped`면 [`data::Group`]`<FeedEntry>` 배열이다(묶음 머리에 제목과 부가 정보). 본문은 줄바꿈을 지키고
    /// 글을 고르고 복사할 수 있다. `format`이 `markdown`이면 본문을 마크다운으로 그린다(HTML은 그리지 않는다).
    /// `follow`면 끝에 붙어 있을 때 새 항목이 오면 끝을 따라간다. `on_select`가 있으면 항목을 누를 수 있다
    /// (글을 고르는 중의 누르기는 고르기가 아니다).
    Feed {
        entries: Binding,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        grouped: bool,
        #[serde(default)]
        #[ts(optional, as = "Option<TextFormat>")]
        format: TextFormat,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        follow: bool,
        /// (블록 세트 7판) 본문 문단(`body`가 배열일 때)을 같은 너비의 칸으로 나란히 놓는다. 창이 좁아 칸마다
        /// 최소 너비를 지킬 수 없으면 위아래로 쌓는다. 예: 여러 문단 비교.
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        columns: bool,
        /// (블록 세트 7판) 항목의 `meta`와 본문 문단마다 복사 단추를 붙인다. 누르면 그 글을 그대로(줄바꿈 포함)
        /// 클립보드에 쓴다. 단추를 눌러도 항목 고르기는 돌지 않는다.
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        copy: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
    },
    /// (4판) 글. 값이 문자열이 아니면 JSON으로 보인다. `format`이 `markdown`이면 마크다운으로 그린다(HTML은
    /// 그리지 않는다). 글을 고르고 복사할 수 있다. 넘치면 그 칸 안에서 스크롤한다.
    Text {
        value: Binding,
        #[serde(default)]
        #[ts(optional, as = "Option<TextFormat>")]
        format: TextFormat,
        #[serde(default)]
        #[ts(optional, as = "Option<TextStyle>")]
        style: TextStyle,
    },

    // ----- 블록 세트 4판: 입력과 동작 -----
    /// (4판) 글 입력. `value`의 상태를 보이고, 입력이 멈추고 0.3초 뒤와 포커스를 잃을 때 `on_change`가 `$event`
    /// (입력한 글, `number`면 숫자나 null)로 돈다. 입력 중에는 상태가 바뀌어도 글을 덮지 않는다. `search`는 앞에
    /// 돋보기, 글이 있으면 끝에 지우기 단추가 붙는다. `multiline`이면 한 줄로 시작해 글을 따라 자란다(최대 8줄).
    /// Enter는 `on_submit`이 있으면 그것을 부른다(`multiline`에서는 Ctrl+Enter). 한글 조합 중의 Enter는 보내지 않는다.
    Input {
        value: StateRef,
        on_change: Actions,
        #[serde(default)]
        #[ts(optional, as = "Option<InputKind>")]
        kind: InputKind,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        multiline: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        placeholder: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_submit: Option<Actions>,
    },
    /// (4판) 고르기. `options`는 [`data::SelectOption`] 배열이다. 고르면 `on_change`가 `$event`(고른 값)로 돈다.
    /// `segmented`는 선택지가 한 줄에 다 보이는 모양이다(선택지 2~5개에 쓴다).
    Select {
        value: StateRef,
        on_change: Actions,
        options: Binding,
        #[serde(default)]
        #[ts(optional, as = "Option<SelectStyle>")]
        style: SelectStyle,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        placeholder: Option<String>,
    },
    /// (4판) 켜고 끄기. 바꾸면 `on_change`가 `$event`(참이나 거짓)로 돈다.
    Toggle {
        value: StateRef,
        on_change: Actions,
        label: String,
    },
    /// (4판) 단추. 누르면 `on_click`이 돈다(`$event`는 null). 도는 동안 단추는 쉬고, 실패하면 창 아래에 오류
    /// 한 줄이 보인다. `confirm`이 있으면 확인 대화상자에서 확인했을 때만 돈다. `icon_only`면 아이콘만 보이고
    /// `label`은 도움말과 읽어 주기에 쓴다. `disabled`가 참이면 누를 수 없다.
    Button {
        label: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        icon: Option<String>,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        icon_only: bool,
        #[serde(default)]
        #[ts(optional, as = "Option<ButtonVariant>")]
        variant: ButtonVariant,
        on_click: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        confirm: Option<Confirm>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        disabled: Option<Binding>,
    },

    // ----- 블록 세트 4판: 문서와 미디어 -----
    /// (4판) 코드와 설정 파일 편집기. 저장, 충돌, 다시 읽기는 `markdown_editor`와 같다(원문 보존, 자동 저장).
    /// `language`가 없으면 확장자로 정한다. 권한은 `readwrite`다.
    CodeEditor {
        file: FileRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        language: Option<CodeLanguage>,
    },
    /// (4판) 코드와 로그 보기(읽기만). `value`(식이나 상태의 글)나 `file` 가운데 하나를 보인다. `file`이면 쉘 창이
    /// 포커스를 다시 얻을 때 다시 읽는다. `follow`면 끝에 붙어 있을 때 글이 늘면 끝을 따라간다. `wrap`이면 긴 줄을
    /// 접는다. 줄 번호가 보이고 글을 고르고 복사할 수 있다.
    CodeView {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        language: Option<CodeLanguage>,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        follow: bool,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        wrap: bool,
    },
    /// (4판) 이미지 하나. `src`는 [`data::MediaRef`]이고 그 `crop`대로 자른다. `zoom`이면 휠과 단추로 확대하고
    /// 끌어서 옮기며, 두 번 누르면 맞춤으로 돌아간다. 이미지가 없으면 빈 상태를 보인다.
    Image {
        src: Binding,
        #[serde(default)]
        #[ts(optional, as = "Option<ImageFit>")]
        fit: ImageFit,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        zoom: bool,
    },
    /// (4판) 소리나 영상 재생기. `src`는 [`data::MediaRef`]다. `kind`가 없으면 받은 MIME으로 정한다. 재생, 멈춤,
    /// 위치 끌기, 시간, 소리 크기를 쉘이 그린다. `autoplay`면 `src`가 바뀔 때 바로 재생한다(목록에서 고르면 듣기).
    Media {
        src: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        kind: Option<MediaKind>,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        autoplay: bool,
    },
}

impl Block {
    /// 이 블록이 처음 생긴 블록 세트 판. 정의의 `requires.blocks`는 쓴 블록의 이 값 이상이어야 한다.
    pub fn introduced_in(&self) -> u32 {
        match self {
            Block::Split { .. } | Block::FileTree { .. } => 1,
            Block::MarkdownEditor {
                document: Some(_), ..
            }
            | Block::MarkdownView {
                document: Some(_), ..
            } => 6,
            Block::MarkdownEditor { .. } | Block::MarkdownView { .. } => 1,
            Block::AgentChat {} => 2,
            Block::WebView { .. } | Block::Explorer { .. } => 3,
            Block::Stack { .. }
            | Block::Tabs { .. }
            | Block::Toolbar { .. }
            | Block::Section { .. }
            | Block::List { .. }
            | Block::Table { .. }
            | Block::Properties { .. }
            | Block::Tree { .. }
            | Block::Feed { .. }
            | Block::Text { .. }
            | Block::Input { .. }
            | Block::Select { .. }
            | Block::Toggle { .. }
            | Block::Button { .. }
            | Block::CodeEditor { .. }
            | Block::CodeView { .. }
            | Block::Image { .. }
            | Block::Media { .. } => 4,
        }
    }

    /// JSON의 `type` 이름.
    pub fn type_name(&self) -> &'static str {
        match self {
            Block::Split { .. } => "split",
            Block::FileTree { .. } => "file_tree",
            Block::MarkdownEditor { .. } => "markdown_editor",
            Block::MarkdownView { .. } => "markdown_view",
            Block::AgentChat {} => "agent_chat",
            Block::WebView { .. } => "web_view",
            Block::Explorer { .. } => "explorer",
            Block::Stack { .. } => "stack",
            Block::Tabs { .. } => "tabs",
            Block::Toolbar { .. } => "toolbar",
            Block::Section { .. } => "section",
            Block::List { .. } => "list",
            Block::Table { .. } => "table",
            Block::Properties { .. } => "properties",
            Block::Tree { .. } => "tree",
            Block::Feed { .. } => "feed",
            Block::Text { .. } => "text",
            Block::Input { .. } => "input",
            Block::Select { .. } => "select",
            Block::Toggle { .. } => "toggle",
            Block::Button { .. } => "button",
            Block::CodeEditor { .. } => "code_editor",
            Block::CodeView { .. } => "code_view",
            Block::Image { .. } => "image",
            Block::Media { .. } => "media",
        }
    }
}

/// `stack`의 자식 사이 간격. 쉘의 간격 토큰 가운데 하나다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum Gap {
    None,
    Small,
    #[default]
    Medium,
    Large,
}

/// 탭 하나.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct Tab {
    pub label: String,
    pub child: Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ListLayout {
    /// 한 줄에 항목 하나.
    #[default]
    Rows,
    /// 그림 칸의 격자.
    Grid,
}

/// 표의 열.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct Column {
    /// 행 객체의 키.
    pub field: String,
    pub label: String,
    #[serde(default)]
    #[ts(optional, as = "Option<ColumnWidth>")]
    pub width: ColumnWidth,
    #[serde(default)]
    #[ts(optional, as = "Option<CellFormat>")]
    pub format: CellFormat,
}

/// 열 너비. 남은 폭은 `fill` 열들이 나눈다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ColumnWidth {
    Narrow,
    Medium,
    Wide,
    #[default]
    Fill,
}

/// 칸 값을 보이는 방법. `number`와 `date`는 끝에 맞추고, 나머지는 앞에 맞춘다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum CellFormat {
    /// 글 한 줄(넘치면 말줄임).
    #[default]
    Text,
    /// 숫자(천 단위 구분).
    Number,
    /// RFC 3339 시각을 이 기기의 날짜와 시각으로.
    Date,
    /// [`data::Badge`] 하나.
    Badge,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct SortSpec {
    pub field: String,
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub desc: bool,
}

/// 속성 한 줄.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct PropertyField {
    pub label: String,
    pub value: Binding,
    #[serde(default)]
    #[ts(optional, as = "Option<FieldFormat>")]
    pub format: FieldFormat,
}

/// 속성 값을 보이는 방법.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum FieldFormat {
    /// 글(줄바꿈 지킴).
    #[default]
    Text,
    /// 마크다운(HTML은 그리지 않는다).
    Markdown,
    /// [`data::Badge`] 하나나 배열.
    Badge,
    /// RFC 3339 시각을 이 기기의 날짜와 시각으로.
    Date,
    /// 고정폭 글(식별자, 경로).
    Code,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum TreeBy {
    /// 항목의 `children`으로 내려간다.
    #[default]
    Children,
    /// 항목의 `path`를 `/`로 나눠 폴더를 만든다.
    Path,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum TextFormat {
    #[default]
    Plain,
    Markdown,
}

/// 글의 크기와 결. 쉘의 글자 토큰 가운데 하나다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum TextStyle {
    #[default]
    Body,
    Title,
    Meta,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum InputKind {
    #[default]
    Text,
    Search,
    Number,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum SelectStyle {
    #[default]
    Dropdown,
    Segmented,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ButtonVariant {
    #[default]
    Default,
    /// 강조. 한 화면에 하나만 쓴다.
    Primary,
    /// 지우기처럼 되돌리기 어려운 것.
    Danger,
    /// 테두리 없는 가벼운 단추.
    Ghost,
}

/// 단추를 누른 뒤 묻는 확인 대화상자. `ok`가 없으면 단추의 `label`을 쓴다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct Confirm {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub body: Option<Binding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ok: Option<String>,
}

/// 코드 편집기와 보기의 언어(색 입히기). 확장자로 정할 때: json, yaml/yml, toml, js/mjs/cjs/jsx, ts/tsx, py,
/// rs, css, html/htm, sql, sh/bash/zsh/ps1, xml/svg, md/markdown, 그 밖은 plain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum CodeLanguage {
    Plain,
    Json,
    Yaml,
    Toml,
    Javascript,
    Typescript,
    Python,
    Rust,
    Css,
    Html,
    Sql,
    Shell,
    Xml,
    Markdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ImageFit {
    /// 칸 안에 다 보이게.
    #[default]
    Contain,
    /// 칸을 다 채우게(넘치는 부분은 잘림).
    Cover,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum MediaKind {
    Audio,
    Video,
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

/// (블록 세트 5판) 탐색기 오른쪽 칸의 보기 방식. 창 상태에는 이 문자열로 둔다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ExplorerView {
    /// 파일 종류 아이콘과 이름의 격자. 기본값이다.
    Icons,
    /// 이름, 수정한 날짜, 종류, 크기의 표.
    Details,
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

    /// 앱 설정이 대화 제공자에 적용됐는지 읽거나 다시 적용한다.
    #[serde(rename = "conversation.apply_status")]
    ConversationApplyStatus { window_id: String },
    #[serde(rename = "conversation.apply_retry")]
    ConversationApplyRetry { window_id: String },

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
    /// (계약 14판) 창의 앱에 `scope: pc` 권한 하나를 이 기기에서 허용한다([`PcAccess`]). 그 앱의 모든 창이 쓴다.
    /// 권한이 `pc` 범위가 아니면 `invalid_request`. 이미 허용했으면 그대로 둔다. 응답은 허용 기록이고
    /// `state.changed`가 따라온다(이미 있었으면 없다).
    #[serde(rename = "files.allow_pc")]
    FilesAllowPc {
        window_id: String,
        permission: String,
    },
    /// 폴더 안 바로 아래 항목. 이름이 `.`로 시작하는 항목은 뺀다. 폴더 먼저, 그다음 이름순(대소문자 무시).
    /// `scope: pc` 권한의 빈 `dir`은 내 PC의 뿌리들이다([`FilesScope`]).
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
    /// - (계약 14판) 탐색기의 권한이 `scope: pc`면 위의 「탐색기와 같은 폴더」는 그 파일이 든 폴더(절대 경로)이고,
    ///   여는 앱의 `opens.state`에 쓰는 경로는 파일 이름이다. 허용 전이면 `not_granted`, 내 PC 자체나 뿌리에 없는
    ///   첫 마디면 `not_found`다.
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
    /// - (9판) 위 검사를 마친 뒤, 이 워크스페이스에서 같이 보기를 켠 창 가운데 마지막 [`VisibleView::visual`]이
    ///   참이고 이 기기에서 지금 보는 데스크톱에 있는 창마다 코어가 모습을 찍어 화면이 준 첨부 뒤에 붙인다.
    ///   `web_view`가 있는 창은 웹 화면(`web.capture`와 같은 것)을, 아니면 쉘 화면에서 그 창의 `bounds` 자리를
    ///   찍는다. 긴 변을 [`SHARE_CAPTURE_MAX_EDGE`] 이하로 줄인 PNG이고, 이름은 [`SHARE_CAPTURE_NAME_PREFIX`]와
    ///   앱 이름, `.png`다. 그 창에 지난번 말에 붙여 보낸 모습과 픽셀이 같으면 붙이지 않는다. 찍지 못했거나
    ///   붙이면 첨부 한도를 넘는 모습은 빼고 보낸다(화면이 준 첨부가 먼저다). 붙인 모습은 화면이 준 첨부와 같은
    ///   길로 올라가 기록의 `attachments`에도 보인다. 말을 보내지 못하면 「지난번에 보낸 모습」을 바꾸지 않는다.
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

    /// (모듈 `agent` 3판) 창의 제공자 대화와 최근 기록을 읽는다.
    #[serde(rename = "conversation.get")]
    ConversationGet { window_id: String },
    /// 이전 기록을 읽는다.
    #[serde(rename = "conversation.history")]
    ConversationHistory { window_id: String, before: String },
    /// 고른 모델로 대화를 만든다.
    #[serde(rename = "conversation.create")]
    ConversationCreate { window_id: String, model: String },
    /// 요청 식별자와 글, 첨부를 제공자에 보낸다.
    #[serde(rename = "conversation.send")]
    ConversationSend {
        window_id: String,
        request_id: String,
        text: String,
        attachments: Vec<conversation::ConversationUpload>,
    },
    /// 제공자 기록의 첨부를 읽는다.
    #[serde(rename = "conversation.attachment")]
    ConversationAttachment {
        window_id: String,
        item_id: String,
        attachment_id: String,
    },
    /// 제공자 기록의 첨부를 기기에서 연다.
    #[serde(rename = "conversation.attachment_open")]
    ConversationAttachmentOpen {
        window_id: String,
        item_id: String,
        attachment_id: String,
    },

    /// (모듈 `storage` 1판) 창의 앱 선언 항목을 읽는다. 새 저장소 명령은 현재 unavailable이다.
    #[serde(rename = "storage.get")]
    StorageGet { window_id: String, entry: String },
    /// (모듈 `storage` 1판) expected_revision CAS로 선언 항목을 쓴다. 빠지거나 null이면 저장값이 없을 때만 만든다.
    #[serde(rename = "storage.write")]
    StorageWrite {
        window_id: String,
        entry: String,
        content: JsonValue,
        #[serde(default)]
        #[ts(optional, as = "Option<app_storage::ExpectedRevision>")]
        expected_revision: app_storage::ExpectedRevision,
    },
    /// (모듈 `storage` 1판) expected_revision CAS로 저장 override를 지우고 선언 기본값으로 돌아간다.
    #[serde(rename = "storage.reset")]
    StorageReset {
        window_id: String,
        entry: String,
        #[serde(default)]
        #[ts(optional, as = "Option<app_storage::ExpectedRevision>")]
        expected_revision: app_storage::ExpectedRevision,
    },

    /// (블록 세트 4판) 창의 데이터를 잇는다. 4판 블록이 든 창이 그려질 때 한 번 부른다. 코어는 아직 받지 않은
    /// 원천을 받기 시작하고, 지금 모습 전체를 돌려준다. 그 뒤 바뀐 것은 `data.update`로 온다. 같은 창을 여러 화면이
    /// 이어도 된다(개발용 다리). 앱의 지금 버전에 `sources`도 식 바인딩도 없으면 빈 모습이다. 없는 창이면 `not_found`.
    /// 이어 둔 동안만 `refresh_secs`와 포커스 때 다시 받기가 돈다. 받은 값은 창이 닫히거나 앱의 새 버전으로 옮길
    /// 때까지 코어가 들고 있어, 다른 데스크톱에 갔다 와도 다시 받지 않는다.
    #[serde(rename = "data.attach")]
    DataAttach { window_id: String },
    /// 창의 데이터 잇기를 놓는다. 블록이 화면에서 빠질 때 부른다. 이어 둔 화면이 하나도 없으면 다시 받기를 멈춘다.
    #[serde(rename = "data.detach")]
    DataDetach { window_id: String },
    /// 동작 자리 하나를 실행한다. `pointer`는 그 자리([`data::ui_actions`]), `event`는 `$event`, `item`은 `$item`이다.
    /// 모두 마치면 응답한다. 상태를 쓰면 `state.changed`가, 원천이나 식 값이 바뀌면 `data.update`가 따라온다.
    /// 없는 자리면 `invalid_request`, 상태 크기 초과도 `invalid_request`, 연결 부르기가 실패하면 `server`(응답 상태와
    /// 본문 앞부분이 `message`에), 권한이 모자라면 `permission_denied`, 로그인이 필요하면 `not_granted`다.
    #[serde(rename = "data.act")]
    DataAct {
        window_id: String,
        pointer: String,
        #[serde(default)]
        #[ts(optional, as = "Option<JsonValue>")]
        event: JsonValue,
        #[serde(default)]
        #[ts(optional, as = "Option<JsonValue>")]
        item: JsonValue,
    },
    /// 원천을 다시 받는다(값의 `retry`, 창 아래 오류 줄의 다시 받기). 빈 배열이면 모든 원천이다. 받기를 시작하면
    /// 바로 응답하고, 결과는 `data.update`로 온다. 모르는 원천 이름은 넘긴다.
    #[serde(rename = "data.refresh")]
    DataRefresh {
        window_id: String,
        #[serde(default)]
        #[ts(optional, as = "Option<Vec<String>>")]
        sources: Vec<String>,
    },
    /// 이미지와 소리 원본 하나를 받는다. `media`의 권한은 그 창의 앱이 선언한 것이어야 한다(`permission_denied`).
    /// 코어는 원본을 (권한, 경로, 쿼리)로 캐시한다. 이미지이고 `max_px`가 있으면 긴 변이 그 값을 넘지 않게 줄여서
    /// 보낸다(PNG, JPEG, WebP, GIF 첫 장. 투명이 있으면 PNG, 아니면 JPEG). 원본이 [`data::MEDIA_MAX_BYTES`]보다
    /// 크면 `io`, 파일이 없으면 `not_found`, 연결이 실패하면 `server`, 로그인이 필요하면 `not_granted`다.
    #[serde(rename = "data.media")]
    DataMedia {
        window_id: String,
        media: data::MediaRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        max_px: Option<u32>,
    },
    /// (모듈 `connection` 1판) 창의 `connection` 권한이 가리키는 기기 로그인(`oauth`) 연결에 로그인한다. 코어가 이
    /// 기기의 기본 브라우저로 로그인 쪽을 열고, 로그인을 마치거나 [`data::LOGIN_TIMEOUT_SECS`]가 지나면 응답한다.
    /// 마치면 그 연결을 쓰는 모든 창의 `login_required` 원천을 다시 받는다. 사용자가 그만두거나 시간이 지나면
    /// `invalid_request`, 연결이 `relay`면 `invalid_request`, 이 쉘이 브라우저를 열 수 없으면(개발용 다리) `unavailable`,
    /// 로그인 쪽이 실패하면 `server`.
    #[serde(rename = "connection.login")]
    ConnectionLogin {
        window_id: String,
        permission: String,
    },

    /// (9판) 창의 같이 보기를 켜거나 끈다. 코어의 메모리에만 두고, [`ShellSnapshot::sharing`]이 바뀌므로
    /// `state.changed`가 따라온다. 이미 그 상태면 아무것도 하지 않는다(이벤트 없음). 없는 창이면 `not_found`.
    /// 연결 상태와 무관하게 성공한다.
    /// - 켜면 화면이 곧 `share.view`로 보이는 것을 준다. 코어는 그 전까지 서버에 올릴 것이 없다.
    /// - 끄면 코어가 그 창의 보이는 글과 「지난번에 보낸 모습」을 버리고, 연결되어 있으면 서버의 그 창 보기를
    ///   지운다([`registry`]의 「같이 보기」 절). 지우다 실패하면 다시 이을 때 지운다.
    #[serde(rename = "share.set")]
    ShareSet { window_id: String, on: bool },
    /// (9판) 같이 보기 창에 지금 보이는 것을 코어에 준다. 화면은 켠 직후 한 번, 그 뒤로는 창에 보이는 것이나 창의
    /// 자리가 바뀌고 [`SHARE_DEBOUNCE_MS`] 동안 더 바뀌지 않을 때 부른다. 대화 블록은 `agent.send` 전에 기다리던
    /// 옮기기를 바로 해서 이 명령을 마친다(보낸 말이 방금 본 것과 함께 가도록).
    /// - 같이 보기가 꺼진 창이면 아무것도 하지 않고 성공한다(끈 직후 늦게 온 것). 없는 창이면 `not_found`.
    /// - `text`가 [`SHARE_TEXT_MAX_BYTES`]를 넘으면 `invalid_request`.
    /// - 코어는 마지막 것을 창마다 하나 들고 있는다. 연결되어 있고 글이나 `visual`이 서버에 마지막으로 올린 것과
    ///   다르면 서버에 올린 뒤 응답한다. 올리다 실패해도 성공으로 응답하고, 다음 `share.view`나 다시 이을 때 올린다.
    ///   상태를 바꾸지 않으므로 이벤트가 없다.
    #[serde(rename = "share.view")]
    ShareView {
        window_id: String,
        view: VisibleView,
    },

    /// (10판) 받아 둔 새 판으로 다시 시작한다. 위 「쉘 업데이트」 절.
    /// - 업데이터가 없는 쉘([`UpdateStatus::Unavailable`])이면 `unavailable`, 그 밖에 `ready`가 아니면 `invalid_request`.
    /// - 코어는 디스크에 아직 쓰지 않은 상태를 쓰고 설치를 시작한다. Windows에서는 설치를 시작하면 응답 전에 쉘이
    ///   끝난다. 화면은 부른 뒤 「다시 시작하는 중」으로 두고 응답을 기다리지 않아도 된다.
    /// - 설치를 시작하지 못하면(서명이 맞지 않음 포함) `io`와 까닭이고, 상태는 [`UpdateStatus::Failed`]가 된다.
    #[serde(rename = "update.restart")]
    UpdateRestart {},
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

/// (9판) 같이 보기 창에 지금 보이는 것을 화면이 옮긴 것.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct VisibleView {
    /// 창의 내용 영역에 보이는 글. 사람과 PAS가 읽는 글이고, 서버는 줄 단위로 앞의 것과 비교한다.
    /// 화면이 지키는 모양:
    /// - 위에서 아래, 왼쪽에서 오른쪽 순서로 한 줄에 한 덩이를 둔다. 빈 줄은 이어서 두지 않는다.
    /// - 블록마다 그 블록을 알리는 머리 줄을 대괄호로 둔다. 예: `[파일 notes/plan.md, 40~78줄 / 전체 210줄]`(편집기와
    ///   코드 보기는 그 아래에 보이는 줄의 원문을 그대로 둔다), `[목록, 전체 120개 중 11~30번째]`, `[표, 전체 52줄 중
    ///   1~18번째]`(칸은 ` | `로 잇는다), `[웹 화면: 페이지 제목, https://...]`, `[이미지: 설명]`.
    /// - 줄 번호는 머리 줄의 범위로만 알리고 줄마다 붙이지 않는다. 줄마다 붙이면 한 줄을 넣거나 지울 때 그 아래 줄이
    ///   모두 바뀐 것으로 보여, 서버의 차분이 글 전체가 된다(카드 #814 운영 확인에서 드러남).
    /// - 고른 항목은 줄 앞에 `› `, 체크 상자는 `[x] `나 `[ ] `, 입력칸은 `이름: 값`이다.
    /// - [`SHARE_TEXT_MAX_BYTES`]를 넘지 않는다.
    pub text: String,
    /// 이미지, 동영상, 그림판, 웹 화면처럼 글로 옮길 수 없는 것이 보이는가. 참이면 `agent.send` 때 모습을 찍는다.
    pub visual: bool,
    /// 창의 내용 영역(제목 줄 아래)이 쉘 화면(메인 웹뷰) 왼쪽 위 기준 어디에 있는가(CSS px). 모습을 찍을 때 쓴다.
    pub bounds: Rect,
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

/// 기기에 저장된 앱 설정의 제공자 적용 상태.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ConversationApplyStatus {
    Applying,
    Applied,
    Unapplied,
}

/// 코어의 응답. `op`는 명령과 같다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "op")]
#[ts(export, export_to = "contract.ts")]
pub enum CoreReply {
    #[serde(rename = "state.get")]
    StateGet { snapshot: ShellSnapshot },

    #[serde(rename = "conversation.apply_status")]
    ConversationApplyStatus { status: ConversationApplyStatus },
    #[serde(rename = "conversation.apply_retry")]
    ConversationApplyRetry {},

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
    LinkStart {
        user_code: String,
        expires_at: String,
    },
    #[serde(rename = "link.cancel")]
    LinkCancel {},
    #[serde(rename = "link.unlink")]
    LinkUnlink {},

    #[serde(rename = "files.pick_folder")]
    FilesPickFolder { grant: Option<Grant> },
    #[serde(rename = "files.allow_pc")]
    FilesAllowPc { access: PcAccess },
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

    #[serde(rename = "conversation.get")]
    ConversationGet {
        thread: Option<conversation::ConversationThread>,
        items: Vec<conversation::ConversationItem>,
        cursor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        next_before: Option<String>,
        models: Vec<conversation::ConversationModel>,
    },
    #[serde(rename = "conversation.history")]
    ConversationHistory {
        items: Vec<conversation::ConversationItem>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        next_before: Option<String>,
    },
    #[serde(rename = "conversation.create")]
    ConversationCreate {
        thread: conversation::ConversationThread,
    },
    #[serde(rename = "conversation.send")]
    ConversationSend {},
    #[serde(rename = "conversation.attachment")]
    ConversationAttachment {
        name: String,
        mime: String,
        data_base64: String,
    },
    #[serde(rename = "conversation.attachment_open")]
    ConversationAttachmentOpen {},

    #[serde(rename = "storage.get")]
    StorageGet {
        result: app_storage::StorageReadReply,
    },
    #[serde(rename = "storage.write")]
    StorageWrite { revision: String },
    #[serde(rename = "storage.reset")]
    StorageReset { revision: Option<String> },

    #[serde(rename = "data.attach")]
    DataAttach { view: data::DataView },
    #[serde(rename = "data.detach")]
    DataDetach {},
    #[serde(rename = "data.act")]
    DataAct {},
    #[serde(rename = "data.refresh")]
    DataRefresh {},
    #[serde(rename = "data.media")]
    DataMedia { media: data::MediaData },
    #[serde(rename = "connection.login")]
    ConnectionLogin {},
    #[serde(rename = "share.set")]
    ShareSet {},
    #[serde(rename = "share.view")]
    ShareView {},
    /// 설치를 시작했지만 쉘이 스스로 끝나지 않는 플랫폼에서만 온다(Windows는 응답 전에 끝난다).
    #[serde(rename = "update.restart")]
    UpdateRestart {},
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
    /// (8판) 파일 크기(바이트). 폴더는 0.
    #[ts(type = "number")]
    pub size: u64,
    /// (8판) 마지막으로 바뀐 시각(RFC 3339 UTC, 초까지, 예: `2026-10-30T01:02:03Z`). 읽지 못하면 빈 문자열.
    pub modified: String,
    /// (계약 14판) `scope: pc`의 내 PC 목록(빈 경로)에서만 붙는 뿌리의 종류. 그때 `path`는 뿌리의 id이고
    /// `name`은 뿌리의 화면 이름, `kind`는 `dir`, `size`는 0, `modified`는 빈 문자열이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub root_kind: Option<PcRootKind>,
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
    /// 같은 앱의 설정 화면에서 적용 결과를 갱신한다.
    #[serde(rename = "conversation.apply_status")]
    ConversationApplyStatus {
        app_id: String,
        status: ConversationApplyStatus,
    },
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
    /// (모듈 `agent` 3판) 제공자 대화 이벤트. 기존 `agent.update`(바깥 workspace_id, 안쪽 기존 AgentUpdate)는 이행 중 그대로 둔다.
    /// 블록은 `conversation.get` 응답의 `thread.id`를 얻고 `conversation.update`를 thread_id로 거른다.
    /// 같은 PC에서 같은 thread를 연 창이 여럿이면 모두 같은 이벤트를 받는다.
    /// 아직 thread가 없는 시작 판은 `conversation.create` 응답이나 thread 저장 항목의 `storage.update` 뒤 `conversation.get`을 다시 불러 id를 얻는다.
    /// envelope는 `{ thread_id, update }`이며 `update`는 `conversation.rs`의 `ConversationEvent` 그대로다.
    /// envelope에는 window_id와 workspace_id를 넣지 않는다.
    #[serde(rename = "conversation.update")]
    ConversationUpdate {
        thread_id: String,
        update: conversation::ConversationEvent,
    },
    /// 대화 스트림의 최종 로그인 필요 또는 권한 거부. 제공자 wire 이벤트와는 별개다.
    #[serde(rename = "conversation.error")]
    ConversationError { thread_id: String, code: ErrorCode },
    /// 미접수 초안은 같은 request_id로, 실패한 초안은 새 request_id로 다시 보낸다.
    #[serde(rename = "conversation.draft")]
    ConversationDraft {
        window_id: String,
        request_id: String,
        text: String,
        attachments: Vec<conversation::ConversationUpload>,
        failed: bool,
    },
    /// 창의 웹 화면 페이지가 바뀌었다(주소, 제목, 읽는 중, 뒤로와 앞으로 갈 수 있는지 가운데 하나라도).
    /// 페이지 전체를 보낸다. 웹 화면을 이은(`web.attach`) 창의 것만 온다.
    #[serde(rename = "web.update")]
    WebUpdate { window_id: String, page: WebPage },
    /// (블록 세트 4판) 이은(`data.attach`) 창의 원천 상태나 식 값이 바뀌었다. 바뀐 것만 담는다. 화면은 받은 열쇠만
    /// 바꾸고 나머지는 둔다. 앱의 새 버전으로 옮긴 창은 화면이 블록을 다시 그리며 `data.attach`를 다시 부른다.
    #[serde(rename = "data.update")]
    DataUpdate {
        window_id: String,
        #[serde(default)]
        view: data::DataView,
    },
    /// (모듈 `storage` 1판) 창이 사용하는 bucket의 snapshot이나 항목 변경 알림. 본문은 이벤트에 담지 않는다.
    #[serde(rename = "storage.update")]
    StorageUpdate {
        window_id: String,
        update: app_storage::StorageUpdate,
    },
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
    /// 선언한 권한이지만 이 기기에서 아직 폴더를 고르지 않았다(`scope: pc`면 아직 허용하지 않았다).
    NotGranted,
    /// 경로가 고른 폴더 밖을 가리킨다.
    PathOutsideRoot,
    /// 파일이 읽은 뒤에 바뀌었거나, 새로 만들려는 파일이 이미 있다.
    Conflict,
    /// 이 창의 대화 제공자 연결에 기기 로그인이 필요하다.
    LoginRequired,
    /// 저장소와 제공자가 가리키는 대화가 다르다.
    BindingConflict,
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
            ErrorCode::LoginRequired => "대화 제공자에 로그인이 필요합니다.",
            ErrorCode::BindingConflict => "저장된 대화 참조와 제공자의 대화가 다릅니다.",
            ErrorCode::Io => "파일을 읽거나 쓸 수 없습니다.",
            ErrorCode::Server => {
                "kaleidoscope 서버에 연결되어 있지 않거나 서버가 요청을 처리하지 못했습니다."
            }
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
            "block-gallery.json",
            "card-board.json",
        ] {
            let def: AppDefinition =
                serde_json::from_str(&example(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(def.requires.blocks <= BLOCK_SET_VERSION, "{name}");
        }
    }

    #[test]
    fn migrate_window_state_keeps_declared_keys() {
        let definition: AppDefinition = serde_json::from_str(&example("md-editor.json")).unwrap();
        let old = BTreeMap::from([
            ("current_file".to_string(), serde_json::json!("notes/a.md")),
            ("gone".to_string(), serde_json::json!(1)),
        ]);
        let next = migrate_window_state(&definition, &old);
        assert_eq!(
            next.get("current_file"),
            Some(&serde_json::json!("notes/a.md"))
        );
        assert!(!next.contains_key("gone"));
        assert_eq!(
            migrate_window_state(&definition, &BTreeMap::new()),
            definition.state
        );
    }

    #[test]
    fn agent_chat_needs_agent_module() {
        validate::parse_app_definition(&example("workspace-pas.json")).expect("작업 PAS 예제");
        let without_module =
            example("workspace-pas.json").replace(r#""agent": 1"#, r#""files": 1"#);
        assert_ne!(without_module, example("workspace-pas.json"));
        let error = validate::parse_app_definition(&without_module).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
        assert!(
            error.details.iter().any(|d| d.contains("agent 모듈")),
            "{error:?}"
        );

        let block: Block = serde_json::from_str(r#"{"type":"agent_chat"}"#).unwrap();
        assert_eq!(block, Block::AgentChat {});
        assert!(serde_json::from_str::<Block>(r#"{"type":"agent_chat","x":1}"#).is_err());
    }

    #[test]
    fn block_set_one_definitions_stay_valid() {
        let old = example("md-viewer.json");
        assert!(
            old.contains(r#""blocks": 1"#),
            "md 예제는 1판으로 남겨 호환을 보인다"
        );
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
                model_preset: "gemini-4-argon".into(),
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
        let conversation = CoreEvent::ConversationUpdate {
            thread_id: "thread-1".into(),
            update: conversation::ConversationEvent::Text {
                stream_id: "stream-1".into(),
                text: "누적된 답".into(),
            },
        };
        let serialized = serde_json::to_value(&conversation).unwrap();
        assert_eq!(serialized["event"], "conversation.update");
        assert_eq!(serialized["thread_id"], "thread-1");
        assert_eq!(serialized["update"]["kind"], "text");
        assert_eq!(serialized["update"]["stream_id"], "stream-1");
        assert_eq!(serialized["update"]["text"], "누적된 답");
        assert_eq!(
            serde_json::from_value::<CoreEvent>(serialized).unwrap(),
            conversation
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
            serde_json::from_str(r#"{"op":"agent.send","workspace_id":"w","text":"안녕"}"#)
                .unwrap();
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
                index: 0,
            }
        );
        let reply = CoreReply::AgentAttachmentOpen {};
        assert_eq!(
            serde_json::to_string(&reply).unwrap(),
            r#"{"op":"agent.attachment_open"}"#
        );
    }

    #[test]
    fn share_requests_round_trip() {
        let set: CoreRequest =
            serde_json::from_str(r#"{"op":"share.set","window_id":"w1","on":true}"#).unwrap();
        assert_eq!(
            set,
            CoreRequest::ShareSet {
                window_id: "w1".into(),
                on: true
            }
        );
        let view: CoreRequest = serde_json::from_str(
            r#"{"op":"share.view","window_id":"w1","view":{"text":"[목록, 전체 3개 중 1~3번째]\n› 첫째","visual":false,"bounds":{"x":10,"y":40,"width":600,"height":400}}}"#,
        )
        .unwrap();
        let CoreRequest::ShareView { view, .. } = &view else {
            panic!("share.view");
        };
        assert!(view.text.ends_with("› 첫째"));
        assert!(serde_json::from_str::<CoreRequest>(
            r#"{"op":"share.view","window_id":"w1","view":{"text":"","visual":false,"bounds":{"x":0,"y":0,"width":1,"height":1},"image":""}}"#
        )
        .is_err());
        assert_eq!(
            serde_json::to_string(&CoreReply::ShareSet {}).unwrap(),
            r#"{"op":"share.set"}"#
        );
        assert!(SHARE_TEXT_CUT_MARK.len() < SHARE_TEXT_MAX_BYTES);
    }

    #[test]
    fn update_status_and_restart_round_trip() {
        let restart: CoreRequest = serde_json::from_str(r#"{"op":"update.restart"}"#).unwrap();
        assert_eq!(restart, CoreRequest::UpdateRestart {});
        assert_eq!(
            serde_json::to_string(&CoreReply::UpdateRestart {}).unwrap(),
            r#"{"op":"update.restart"}"#
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::Unavailable {}).unwrap(),
            serde_json::json!({ "state": "unavailable" })
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::Ready {
                current_version: "0.5.0".into(),
                version: "0.5.1".into(),
            })
            .unwrap(),
            serde_json::json!({ "state": "ready", "current_version": "0.5.0", "version": "0.5.1" })
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::Failed {
                current_version: "0.5.0".into(),
                version: None,
                reason: "업데이트 서버에 닿지 않습니다".into(),
            })
            .unwrap()["version"],
            serde_json::Value::Null
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
             export const AGENT_MESSAGE_MAX_CHARS = {};\n\
             /** JSON 저장 항목 하나의 최대 바이트 수. */\n\
             export const STORAGE_JSON_MAX_BYTES = {};\n\
             /** Markdown 저장 항목 하나의 최대 UTF-8 바이트 수. */\n\
             export const STORAGE_MD_MAX_BYTES = {};\n\
             /** 저장소 명령 HTTP 본문의 최대 바이트 수. */\n\
             export const STORAGE_COMMAND_BODY_MAX_BYTES = {};\n\
             /** (9판) 같이 보기 글 하나의 최대 바이트 수(UTF-8). */\n\
             export const SHARE_TEXT_MAX_BYTES = {};\n\
             /** (9판) 잘린 같이 보기 글의 마지막 줄. */\n\
             export const SHARE_TEXT_CUT_MARK = {:?};\n\
             /** (9판) 같이 보기 창이 바뀐 뒤 글을 다시 옮기기까지 기다리는 시간(ms). */\n\
             export const SHARE_DEBOUNCE_MS = {};\n\
             /** 단추 아이콘으로 쓸 수 있는 Lucide 아이콘 이름(블록 세트 4판). */\n\
             export const ICON_NAMES = [{}] as const;\n\
             export type IconName = (typeof ICON_NAMES)[number];\n",
            AGENT_ATTACHMENTS_MAX,
            AGENT_ATTACHMENT_MAX_BYTES,
            AGENT_ATTACHMENTS_TOTAL_MAX_BYTES,
            registry::AGENT_MESSAGE_MAX_CHARS,
            app_storage::STORAGE_JSON_MAX_BYTES,
            app_storage::STORAGE_MD_MAX_BYTES,
            app_storage::STORAGE_COMMAND_BODY_MAX_BYTES,
            SHARE_TEXT_MAX_BYTES,
            SHARE_TEXT_CUT_MARK,
            SHARE_DEBOUNCE_MS,
            data::ICON_NAMES
                .iter()
                .map(|name| format!("\"{name}\""))
                .collect::<Vec<_>>()
                .join(", "),
        );
        let dir = std::env::var("TS_RS_EXPORT_DIR")
            .expect("TS_RS_EXPORT_DIR는 .cargo/config.toml에 있다");
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
            validate::parse_app_definition(&example(name))
                .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        }
        let outside = example("md-viewer.json").replace(
            r#""path": { "state": "current_file" }"#,
            r#""path": "../secret.md""#,
        );
        assert_ne!(
            outside,
            example("md-viewer.json"),
            "예제의 경로 자리를 바꿨는지 확인"
        );
        let error = validate::parse_app_definition(&outside).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidAppDefinition);
        assert!(
            error.details.iter().any(|d| d.contains("고른 폴더 밖")),
            "{error:?}"
        );
    }

    #[test]
    fn app_definition_schema_lists_block_types() {
        let schema = app_definition_schema();
        let definitions = schema
            .get("$defs")
            .or_else(|| schema.get("definitions"))
            .expect("앱 정의 스키마의 정의 목록");
        let storage_entry = &definitions["StorageEntryDecl"]["properties"];
        for field in ["description", "choices"] {
            assert!(
                storage_entry.get(field).is_some(),
                "저장 항목 JSON Schema에 {field}가 없다"
            );
        }
        let schema = schema.to_string();
        for block in [
            "split",
            "file_tree",
            "markdown_editor",
            "markdown_view",
            "agent_chat",
            "web_view",
            "explorer",
            "stack",
            "tabs",
            "toolbar",
            "section",
            "list",
            "table",
            "properties",
            "tree",
            "feed",
            "text",
            "input",
            "select",
            "toggle",
            "button",
            "code_editor",
            "code_view",
            "image",
            "media",
        ] {
            assert!(
                schema.contains(&format!("\"{block}\"")),
                "스키마에 {block}이 없다"
            );
        }
    }

    #[test]
    fn web_and_explorer_examples_validate() {
        for name in [
            "web-browser.json",
            "explorer.json",
            "md-editor.json",
            "workspace-pas.json",
        ] {
            validate::parse_app_definition(&example(name))
                .unwrap_or_else(|e| panic!("{name}: {e:?}"));
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
        rejected(&browser.replace(r#""web": 1"#, r#""files": 1"#), "web 모듈");
        rejected(
            &browser.replace(r#""blocks": 3"#, r#""blocks": 2"#),
            "블록 세트 3판",
        );
        rejected(
            &browser.replace(
                r#""url": { "state": "url" }"#,
                r#""url": "file:///C:/a.html""#,
            ),
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
            &editor.replace(
                r#""permission": "docs", "state""#,
                r#""permission": "notes", "state""#,
            ),
            "선언되지 않은 권한",
        );
        rejected(
            &editor.replace(
                r#""state": "current_file" },
  "ui""#,
                r#""state": "open_file" },
  "ui""#,
            ),
            "선언되지 않은 상태 키",
        );
    }

    #[test]
    fn blocks_need_their_block_set() {
        let pas = example("workspace-pas.json").replace(r#""blocks": 2"#, r#""blocks": 1"#);
        rejected(&pas, "블록 세트 2판");
        let explorer = example("explorer.json").replace(r#""blocks": 5"#, r#""blocks": 2"#);
        rejected(&explorer, "블록 세트 3판");
    }

    #[test]
    fn explorer_state_fields_need_block_set_five() {
        // 3판 정의(필드 없음)는 그대로 통과한다.
        let three = r#"{
            "id": "explorer", "name": "탐색기",
            "requires": { "blocks": 3, "modules": { "files": 1 } },
            "permissions": [{ "module": "files", "id": "folder", "access": "read", "label": "볼 폴더" }],
            "ui": { "type": "explorer", "root": { "permission": "folder" } }
        }"#;
        validate::parse_app_definition(three).expect("3판 탐색기");
        let five = example("explorer.json");
        let definition = validate::parse_app_definition(&five).expect("5판 탐색기");
        assert!(matches!(
            &definition.ui,
            Block::Explorer {
                folder: Some(_),
                on_folder: Some(_),
                view: Some(_),
                on_view: Some(_),
                ..
            }
        ));
        rejected(
            &five.replace(r#""blocks": 5"#, r#""blocks": 4"#),
            "블록 세트 5판",
        );
        rejected(
            &five.replace(
                r#""view": { "state": "view" }"#,
                r#""view": { "state": "mode" }"#,
            ),
            "mode",
        );
        assert_eq!(
            serde_json::to_value(ExplorerView::Details).unwrap(),
            serde_json::json!("details")
        );
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
            r#"{"blocks":7,"modules":{"agent":3,"connection":2,"files":2,"storage":2,"web":1}}"#
        );
        // 4판 쉘(v0.4.x)은 5판 필드를 쓴 탐색기를 받지 않는다.
        let explorer = validate::parse_app_definition(&example("explorer.json")).unwrap();
        let four = Supported {
            blocks: 4,
            ..Supported::current()
        };
        assert!(!four.renders(&explorer.requires));
        assert!(current.renders(&explorer.requires));
        // files 1판 쉘(v0.5.0 이하)은 내 PC 범위의 탐색기를 받지 않는다.
        let pc = validate::parse_app_definition(PC_EXPLORER).unwrap();
        let mut files_one = Supported::current();
        files_one.modules.insert("files".into(), 1);
        assert!(!files_one.renders(&pc.requires));
        assert!(current.renders(&pc.requires));
    }

    /// 내 PC 범위의 탐색기(계약 14판). 구현이 들어오면 examples/explorer.json이 이 모양이 된다.
    const PC_EXPLORER: &str = r#"{
  "id": "explorer",
  "name": "탐색기",
  "requires": { "blocks": 5, "modules": { "files": 2 } },
  "permissions": [
    { "module": "files", "id": "pc", "access": "read", "label": "내 PC", "scope": "pc" }
  ],
  "state": { "folder": "", "view": "icons" },
  "ui": {
    "type": "explorer",
    "root": { "permission": "pc" },
    "folder": { "state": "folder" },
    "on_folder": { "set_state": "folder" },
    "view": { "state": "view" },
    "on_view": { "set_state": "view" }
  }
}"#;

    #[test]
    fn files_pc_scope_rules() {
        let explorer = PC_EXPLORER.to_string();
        let definition = validate::parse_app_definition(&explorer).expect("내 PC 탐색기");
        assert!(matches!(
            &definition.permissions[0],
            PermissionDecl::Files {
                scope: FilesScope::Pc,
                access: FileAccess::Read,
                ..
            }
        ));
        // scope는 files 2판이 필요하다.
        rejected(
            &explorer.replace(r#""files": 2"#, r#""files": 1"#),
            "files 모듈 2판",
        );
        // pc 범위는 읽기만.
        rejected(
            &explorer.replace(r#""access": "read""#, r#""access": "readwrite""#),
            "access가 read",
        );
        // explorer의 root 말고는 pc 범위를 가리킬 수 없다.
        let tree = r#"{
            "id": "tree", "name": "트리",
            "requires": { "blocks": 1, "modules": { "files": 2 } },
            "permissions": [{ "module": "files", "id": "pc", "access": "read", "label": "내 PC", "scope": "pc" }],
            "state": { "file": null },
            "ui": { "type": "file_tree", "root": { "permission": "pc" }, "selected": { "state": "file" }, "on_select": { "set_state": "file" } }
        }"#;
        rejected(tree, "explorer의 root에만");
        let opens = explorer.replace(
            r#""state": { "folder": "", "view": "icons" },"#,
            r#""state": { "folder": "", "view": "icons", "file": null },
  "opens": { "extensions": ["md"], "permission": "pc", "state": "file" },"#,
        );
        rejected(&opens, "opens에 쓸 수 없습니다");
        // scope가 없으면 folder이고, 직렬화에도 나오지 않는다(1판 정의 그대로).
        let three = r#"{"module":"files","id":"folder","access":"read","label":"볼 폴더"}"#;
        let permission: PermissionDecl = serde_json::from_str(three).unwrap();
        assert!(matches!(
            permission,
            PermissionDecl::Files {
                scope: FilesScope::Folder,
                ..
            }
        ));
        assert_eq!(serde_json::to_string(&permission).unwrap(), three);
        assert_eq!(PC_KNOWN_FOLDERS[1], ("documents", "문서"));
    }

    #[test]
    fn files_allow_pc_round_trips() {
        let request: CoreRequest =
            serde_json::from_str(r#"{"op":"files.allow_pc","window_id":"w","permission":"pc"}"#)
                .unwrap();
        assert!(matches!(request, CoreRequest::FilesAllowPc { .. }));
        let entry = FileEntry {
            name: "문서".into(),
            path: "documents".into(),
            kind: FileKind::Dir,
            size: 0,
            modified: String::new(),
            root_kind: Some(PcRootKind::Known),
        };
        assert_eq!(
            serde_json::to_value(&entry).unwrap()["root_kind"],
            serde_json::json!("known")
        );
        let device: DeviceState = serde_json::from_str(
            r#"{"active_workspace_id":null,"active_desktop_ids":{},"grants":[]}"#,
        )
        .unwrap();
        assert!(device.pc_access.is_empty());
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
            serde_json::from_str(r#"{"op":"web.history","window_id":"x","action":"back"}"#)
                .unwrap();
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
    fn block_set_four_examples_validate() {
        for name in ["block-gallery.json", "card-board.json"] {
            validate::parse_app_definition(&example(name))
                .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        }
        rejected(
            &example("block-gallery.json").replace(r#""blocks": 4"#, r#""blocks": 3"#),
            "블록 세트 4판",
        );
        rejected(
            &example("card-board.json").replace(
                r#""modules": { "connection": 1 }"#,
                r#""modules": { "files": 1 }"#,
            ),
            "connection 모듈",
        );
    }

    #[test]
    fn binding_and_action_pointers_follow_json_paths() {
        let board = validate::parse_app_definition(&example("card-board.json")).unwrap();
        let bindings: Vec<String> = data::ui_bindings(&board)
            .into_iter()
            .filter(|(_, binding)| matches!(binding, data::Binding::Expr(_)))
            .map(|(pointer, _)| pointer)
            .collect();
        assert_eq!(
            bindings,
            vec![
                "/ui/children/0/children/1/items",
                "/ui/children/1/children/0/start/0/value",
                "/ui/children/1/children/0/end/0/confirm/body",
                "/ui/children/1/children/0/end/0/disabled",
                "/ui/children/1/children/1/fields/0/value",
                "/ui/children/1/children/1/fields/1/value",
                "/ui/children/1/children/1/fields/2/value",
                "/ui/children/1/children/1/fields/3/value",
            ]
        );
        let actions: Vec<String> = data::ui_actions(&board)
            .into_iter()
            .map(|(pointer, _)| pointer)
            .collect();
        assert_eq!(
            actions,
            vec![
                "/ui/children/0/children/0/start/0/on_change",
                "/ui/children/0/children/0/end/0/on_change",
                "/ui/children/0/children/0/end/1/on_click",
                "/ui/children/0/children/1/on_select",
                "/ui/children/1/children/0/end/0/on_click",
            ]
        );
        // 자리는 앱 정의 JSON에서 그 값을 그대로 가리킨다.
        let json: serde_json::Value = serde_json::from_str(&example("card-board.json")).unwrap();
        for pointer in bindings.iter().chain(&actions) {
            assert!(json.pointer(pointer).is_some(), "{pointer}");
        }
        let gallery = validate::parse_app_definition(&example("block-gallery.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&example("block-gallery.json")).unwrap();
        for (pointer, _) in data::ui_bindings(&gallery) {
            assert!(json.pointer(&pointer).is_some(), "{pointer}");
        }
        for (pointer, _) in data::ui_actions(&gallery) {
            assert!(json.pointer(&pointer).is_some(), "{pointer}");
        }
        let exprs = data::all_exprs(&board);
        assert!(exprs
            .iter()
            .any(|(pointer, _)| pointer == "/sources/detail/path"));
        assert!(exprs
            .iter()
            .any(|(pointer, _)| pointer == "/ui/children/1/children/0/end/0/on_click/0/call/path"));
    }

    #[test]
    fn data_refs_and_names() {
        assert_eq!(
            data::data_refs("$data.narrative.files[filePath = $state.file] ~> $count() + $count($data.master.x) + $count($data.narrative)"),
            vec!["narrative".to_string(), "master".to_string()]
        );
        assert!(data::data_refs("$database.x").is_empty());
        assert!(data::valid_source_name("narrative_2"));
        assert!(!data::valid_source_name("2cards"));
        assert!(!data::valid_source_name("my-cards"));
        assert!(validate::valid_request_path("/api/cards"));
        assert!(validate::valid_request_path("/"));
        assert!(validate::valid_request_path("/media/portrait/a%20b.png"));
        assert!(
            validate::valid_request_path("/files/a.%2econfig"),
            "점이 섞인 보통 이름은 받는다"
        );
        assert!(
            validate::valid_request_path("/api/narrative/narrative%2F_rev2%2Fx.yaml"),
            "점 조각이 없는 인코딩 / 는 식별자로 받는다"
        );
        for bad in [
            "api/cards",
            "//evil.example/x",
            "/a/../b",
            "/a?b=c",
            "/a\\b",
            "/a b",
            "/a//b",
            "/%2e%2e/x",
            "/safe/%2e./secret",
            "/safe/.%2E/secret",
            "/safe/%2E%2e/secret",
            "/safe/%2e/x",
            "/safe/..%2Fsecret",
            "/safe/a%2F..%2Fb",
            "/safe/%5C..%5Csecret",
            "/safe/a%00",
        ] {
            assert!(!validate::valid_request_path(bad), "{bad}");
        }
    }

    fn with_ui(ui: &str, extra: &str) -> String {
        format!(
            r#"{{"id":"t","name":"시험","requires":{{"blocks":4,"modules":{{"files":1,"connection":1}}}},
            "permissions":[{{"module":"files","id":"docs","access":"read","label":"문서"}},
                           {{"module":"connection","id":"board","connection":"board","access":"read","label":"보드"}}],
            "state":{{"q":"","sel":null}}{extra},
            "ui":{ui}}}"#
        )
    }

    #[test]
    fn block_set_four_rules() {
        let ok = with_ui(
            r#"{"type":"list","items":{"expr":"$data.cards.items"}}"#,
            r#","sources":{"cards":{"kind":"request","permission":"board","path":"/api/items"}}"#,
        );
        validate::parse_app_definition(&ok).unwrap_or_else(|e| panic!("{e:?}"));

        rejected(
            &with_ui(r#"{"type":"list","items":{"expr":"$data.cards["}}"#, ""),
            "식을 읽을 수 없습니다",
        );
        rejected(
            &with_ui(
                r#"{"type":"list","items":{"expr":"$data.cardz.items"}}"#,
                r#","sources":{"cards":{"kind":"request","permission":"board","path":"/api/items"}}"#,
            ),
            "없는 원천",
        );
        rejected(
            &with_ui(
                r#"{"type":"text","value":"x"}"#,
                r#","sources":{"cards":{"kind":"request","permission":"board","path":{"expr":"'/api/' & $data.x"}}}"#,
            ),
            "원천의 값 자리 식은 $state와 $storage만",
        );
        rejected(
            &with_ui(r#"{"type":"text","value":{"state":1}}"#, ""),
            "바인딩 모양",
        );
        rejected(
            &with_ui(r#"{"type":"text","value":{"state":"nope"}}"#, ""),
            "선언되지 않은 상태 키",
        );
        rejected(
            &with_ui(
                r#"{"type":"toolbar","start":[{"type":"list","items":[]}]}"#,
                "",
            ),
            "toolbar에는",
        );
        rejected(
            &with_ui(
                r#"{"type":"button","label":"a","icon":"rocket","on_click":{"set_state":"q"}}"#,
                "",
            ),
            "없는 아이콘",
        );
        rejected(
            &with_ui(
                r#"{"type":"code_view","value":"a","file":{"permission":"docs","path":"a.json"}}"#,
                "",
            ),
            "꼭 하나",
        );
        rejected(
            &with_ui(
                r#"{"type":"code_editor","file":{"permission":"docs","path":"a.json"}}"#,
                "",
            ),
            "readwrite",
        );
        rejected(
            &with_ui(
                r#"{"type":"button","label":"a","on_click":[{"call":{"permission":"board","method":"POST","path":"/api/x"}}]}"#,
                "",
            ),
            "readwrite",
        );
        rejected(
            &with_ui(
                r#"{"type":"button","label":"a","on_click":[{"call":{"permission":"docs","method":"GET","path":"/api/x"}}]}"#,
                "",
            ),
            "connection 권한",
        );
        rejected(
            &with_ui(
                r#"{"type":"button","label":"a","on_click":[{"refresh":["nope"]}]}"#,
                "",
            ),
            "없는 원천을 다시",
        );
        rejected(
            &with_ui(
                r#"{"type":"button","label":"a","on_click":[{"set_state":"nope","value":1}]}"#,
                "",
            ),
            "선언되지 않은 상태 키",
        );
        rejected(
            &with_ui(
                r#"{"type":"stack","direction":"column","fill":3,"children":[{"type":"text","value":"a"}]}"#,
                "",
            ),
            "fill",
        );
        rejected(
            &with_ui(
                r#"{"type":"table","rows":[],"columns":[{"field":"a","label":"A"},{"field":"a","label":"B"}]}"#,
                "",
            ),
            "겹칩니다",
        );
        rejected(
            &with_ui(
                r#"{"type":"text","value":"a"}"#,
                r#","sources":{"Cards":{"kind":"request","permission":"board","path":"/api"}}"#,
            ),
            "원천 이름",
        );
        rejected(
            &with_ui(
                r#"{"type":"text","value":"a"}"#,
                r#","sources":{"cards":{"kind":"file","permission":"board","path":"a.json"}}"#,
            ),
            "files 권한",
        );
        rejected(
            &with_ui(
                r#"{"type":"text","value":"a"}"#,
                r#","sources":{"cards":{"kind":"request","permission":"board","path":"api"}}"#,
            ),
            "/로 시작",
        );
        rejected(
            &with_ui(
                r#"{"type":"text","value":"a"}"#,
                r#","sources":{"cards":{"kind":"file","permission":"docs","path":"../a.json"}}"#,
            ),
            "고른 폴더 밖",
        );
        rejected(
            &with_ui(
                r#"{"type":"text","value":"a"}"#,
                r#","sources":{"cards":{"kind":"request","permission":"board","path":"/a","refresh_secs":3}}"#,
            ),
            "refresh_secs",
        );
        rejected(
            &with_ui(
                r#"{"type":"file_tree","root":{"permission":"board"},"selected":{"state":"sel"},"on_select":{"set_state":"sel"}}"#,
                "",
            ),
            "files 권한",
        );

        // 식은 4판부터다.
        let old = r#"{"id":"t","name":"시험","requires":{"blocks":3},"ui":{"type":"text","value":{"expr":"1"}}}"#;
        rejected(old, "블록 세트 4판");
        // 바인딩이 아닌 리터럴 객체는 그대로 받는다.
        let literal = with_ui(
            r##"{"type":"properties","fields":[{"label":"상태","value":{"text":"진행","color":"#315da8"},"format":"badge"}]}"##,
            "",
        );
        validate::parse_app_definition(&literal).unwrap_or_else(|e| panic!("{e:?}"));
    }

    #[test]
    fn data_messages_round_trip() {
        let act: CoreRequest =
            serde_json::from_str(r#"{"op":"data.act","window_id":"w","pointer":"/ui/on_click"}"#)
                .unwrap();
        assert_eq!(
            act,
            CoreRequest::DataAct {
                window_id: "w".into(),
                pointer: "/ui/on_click".into(),
                event: JsonValue::Null,
                item: JsonValue::Null
            }
        );
        let media: CoreRequest = serde_json::from_str(
            r#"{"op":"data.media","window_id":"w","media":{"permission":"shots","path":"a.png","crop":{"x":0.1,"y":0.2,"w":0.5,"h":0.5}},"max_px":256}"#,
        )
        .unwrap();
        assert!(matches!(
            media,
            CoreRequest::DataMedia {
                max_px: Some(256),
                ..
            }
        ));
        let event = CoreEvent::DataUpdate {
            window_id: "w".into(),
            view: data::DataView {
                sources: [(
                    "cards".to_string(),
                    data::SourceStatus::Loading { has_value: false },
                )]
                .into_iter()
                .collect(),
                values: [
                    ("/ui/items".to_string(), data::BindingValue::Loading {}),
                    (
                        "/ui/title".to_string(),
                        data::BindingValue::Ready {
                            value: JsonValue::String("가".into()),
                        },
                    ),
                    (
                        "/ui/children/1/items".to_string(),
                        data::BindingValue::LoginRequired {
                            permission: "shay".into(),
                        },
                    ),
                ]
                .into_iter()
                .collect(),
            },
        };
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"event":"data.update","window_id":"w","view":{"sources":{"cards":{"state":"loading","has_value":false}},"values":{"/ui/children/1/items":{"status":"login_required","permission":"shay"},"/ui/items":{"status":"loading"},"/ui/title":{"status":"ready","value":"가"}}}}"#
        );
        let item: data::ListItem = serde_json::from_str(
            r##"{"key":"a","title":"가","badges":["새로",{"text":"완료","color":"#2f7d4f"}],"image":{"permission":"m","path":"/p.png"},"extra":1}"##,
        )
        .expect("블록이 받는 모양은 모르는 필드를 넘긴다");
        assert_eq!(item.badges.len(), 2);
        let actions: data::Actions = serde_json::from_str(r#"{"set_state":"card"}"#).unwrap();
        assert!(matches!(actions, data::Actions::One(_)));
        let actions: data::Actions = serde_json::from_str(
            r#"[{"set_state":"file","value":{"expr":"$item.file"}},{"refresh":[]},{"call":{"permission":"b","method":"DELETE","path":"/x"}}]"#,
        )
        .unwrap();
        let data::Actions::Many(list) = actions else {
            panic!()
        };
        assert_eq!(list.len(), 3);
        assert!(matches!(list[2], data::Action::Call(_)));

        // value를 빼면 $event, null을 적으면 null을 쓴다.
        let clear: data::Actions =
            serde_json::from_str(r#"[{"set_state":"a"},{"set_state":"b","value":null}]"#).unwrap();
        let data::Actions::Many(list) = clear else {
            panic!()
        };
        let data::Action::SetState(first) = &list[0] else {
            panic!()
        };
        let data::Action::SetState(second) = &list[1] else {
            panic!()
        };
        assert_eq!(first.value, None);
        assert_eq!(second.value, Some(data::Binding::Literal(JsonValue::Null)));
        assert_eq!(
            serde_json::to_string(&list[1]).unwrap(),
            r#"{"set_state":"b","value":null}"#
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
