//! kaleidoscope 코어와 화면 사이 계약 (계약 34판, 261105)
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
//! 5판에서 바뀐 것(웹 화면과 탐색기, 카드 #806): 블록 세트 3판(`web_view`, `explorer` 블록)과 모듈 `web` 1판,
//! 앱 정의의 `opens`(이 앱이 여는 파일 확장자), `files.open`과 `web.*` 명령, `web.update` 이벤트,
//! 오류 코드 `unavailable`. 블록마다 처음 생긴 판보다 낮은 `requires.blocks`로 그 블록을 쓰면 거부한다.
//! 서버는 기기마다 그 쉘이 그릴 수 있는 앱만 보낸다([`registry`]의 「기기마다 그릴 수 있는 앱만」 절).
//!
//! 6판에서 바뀐 것(범용 블록 확충, 카드 #809): 블록 세트 4판(배치 `stack`, `tabs`, `toolbar`, `section`, 데이터
//! `list`, `table`, `properties`, `tree`, `feed`, `text`, 입력 `input`, `select`, `toggle`, `button`, 문서와 미디어
//! `code`, `image`, `media`)과 앱 정의의 `sources`, 4판 블록의 식 바인딩과 동작([`data`]),
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
//! 9판에서 바뀐 것(창 같이 보기, 카드 #814): 창마다 켜는 「같이 보기」. `share.set`, `share.view`, `share.freeze`,
//! `share.capture`, `share.unfreeze` 명령,
//! [`Desktop::sharing`]과 [`Desktop::last_sent_context`], 화면이 옮긴 보이는 글 [`VisibleView`], `conversation.send`가
//! 같이 보는 창의 모습을 첨부로 붙이는 규칙. 켠 창과 대화별 전송 기준은 데스크톱 속성으로 저장·동기화하고,
//! 현재 보이는 글만 코어 메모리에 둔다. 블록 세트와 모듈 판은 그대로다(앱 정의가 쓰는 것이 아니라 쉘의 기능이다).
//! 아래 「같이 보기」 절과 [`registry`]의 「같이 보기」 절.
//!
//! 10판에서 바뀐 것(쉘 자동 업데이트, 카드 #819): [`ShellSnapshot::update`]와 `update.restart` 명령. 설치본 쉘이 새 판을
//! 스스로 받아 두고, 디렉터가 고를 때 다시 시작하며 깐다. 블록 세트와 모듈 판, 레지스트리는 그대로다(앱 정의가 쓰는 것이
//! 아니라 쉘 자신의 기능이고, 업데이트 서버는 오케스트레이터가 아니다). 아래 「쉘 업데이트」 절.
//!
//! 11판에서 바뀐 것(P1, 카드 #818): 블록 세트 6판의 Markdown 저장소 문서 바인딩, 앱 정의 storage와 대화 provider,
//! 모듈 `storage` 1판, `agent` 3판, `connection` 2판, registry 8판. 계정은 서버가 인증 문맥에서 해석하고 기기 계약은
//! account id를 받지 않는다.
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
//! # 계약 17판: conversation-v1의 내부 context
//! `SendMessageRequest.context`는 제공자가 에이전트 입력에 덧붙이는 선택 필드다.
//! 사람 기록의 `text`에는 `text`만 보인다. 요청 식별과 멱등 본문에는 `context`도 포함한다.
//! 비어 있는 context는 전송하지 않는다. 제공자 요청 본문 크기는 기존 한도를 따른다.
//!
//! # 계약 18판: 옛 서버 대화 중계 제거
//! 대화는 앱 정의의 제공자와 기기 로그인으로만 이뤄진다. 제공자가 없는 기존 대화 블록은 빈 상태를 보인다.
//! 새 정의에는 제공자가 필요하다. 블록과 모듈 판은 그대로다.
//!
//! # 계약 19판: 기본 앱
//! 기본 앱은 리포의 apps/와 [`builtin`] 표가 정본이고 쉘과 함께 나간다.
//! 개인 앱 삭제와 동기화는 레지스트리 9판에서 처리한다.
//!
//! # 계약 21판: 작업 PAS 프로필과 모델 선택
//! `conversation.get`은 제공자 프로필 목록과 시작 기본값을 함께 돌려주고 선택 프로필로 모델을 조회한다.
//! `conversation.create`는 선택 프로필을 받을 수 있고, `conversation.switch`는 같은 대화 기록 안에서 프로필이나 모델을 바꾼다.
//! 모델의 실행 위치 묶음과 제한 정보, thread의 프로필·실행 식별자를 추가한다. 블록 세트, 모듈과 레지스트리 판은 그대로다.
//!
//! # 계약 23판: 창 단위 클라이언트 로직과 시간축
//! 모듈 `client` 1판, 블록 세트 12판의 `canvas`와 `timeline`, 로컬 출력 바인딩과 동작,
//! 파일 선택 및 오프셋 내보내기 명령을 더했다. 세부 선언은 [`client`]와 [`data`]에 있다.
//! # 계약 25판: 모듈 `files` 3판과 입력 표본 프로파일링
//! 폴더 생성, 이름 바꾸기, 이동, 복사, 삭제, 파일 관리자에서 보기, 절대 경로 조회를 더한다.
//! 파일 변경 이벤트는 grant 절대 경로와 grant 기준 상대 경로만 화면에 보낸다.
//! `profiler.report`는 입력 이벤트와 긴 프레임 표본을 묶어 코어 프로파일러에 보낸다.
//!
//! # 계약 25판: 블록 세트 13판의 `folder`
//! 파일 권한 또는 `storage` 3판 문서 모음을 뿌리로 하는 읽기와 선택용 폴더 블록을 더한다.
//! 옛 `tree.root`와 `file_tree` wire는 유지하고 공개 스키마에서 `tree.root`를 숨긴다.
//!
//! # 계약 26판: 창 상태 이행 식과 머리 없는 탭
//! 앱 판을 올릴 때 옛 상태에 없는 키의 값을 계산하는 `state_migrate`, 파일을 열 때 경로와 같이 쓰는 `opens.set_state`,
//! 방문한 탭을 유지하는 `tabs.keep_mounted`와 탭 줄을 숨기는 `tabs.header`를 더한다. 새 필드는 블록 세트 15판이다.
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
//! 화면은 응답의 순번으로 그 명령의 결과까지 스냅샷이 왔는지 기다릴 수 있다.
//! 순번을 받은 응답으로 저장소를 바꾸지는 않는다.
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
//! - 같이 보기를 켠 창과 대화마다 마지막으로 보낸 컨텍스트는 각 [`Desktop`]의 속성으로 저장하고
//!   배치와 함께 동기화한다. 창에 지금 보이는 글([`VisibleView`])만 코어 메모리에 둔다.
//!
//! # 같이 보기 (9판)
//! 디렉터가 창의 「같이 보기」를 켜 두면, 그 창에 지금 보이는 글을 작업 PAS가 디렉터의 다음 말과 함께 받는다.
//! - 켜고 끄는 상태는 창이 속한 [`Desktop::sharing`]에 저장하고 다른 기기와 동기화한다.
//!   마지막으로 보낸 대화별 컨텍스트는 [`Desktop::last_sent_context`]에 저장한다.
//!   창이 없어지면(창 닫기, 데스크톱과 워크스페이스 지우기, 다른 기기에서 지운 것을 받은 때) 코어가 끈다.
//! - 화면은 켜진 창에 보이는 부분을 글로 옮겨([`VisibleView`]) 바뀔 때마다 `share.view`로 코어에 준다. 보내기 직전
//!   화면에 온전히 보이지 않는 시각 창은 `share.freeze`로 메인 화면을 고정하고 다른 창을 숨긴 뒤 `share.capture`로
//!   별도 캡처한다. 마친 뒤 `share.unfreeze`로 화면 고정을 푼다. 앱마다
//!   요약하지 않고, 쉘이 블록 종류와 접근성 정보(ARIA 역할과 이름)로 옮긴다. 스크롤 밖이나 다른 데스크톱처럼
//!   보이지 않는 부분은 옮기지 않는다.
//! - 코어는 연결되어 있으면 그 글을 서버에 올려 조회할 수 있게 한다. 대화 전송 시 코어가 지난번과 달라진
//!   글을 제공자 요청의 context에 담는다. 보낸 기준도 데스크톱과 동기화해 재시작 뒤 중복 전송을 막는다.
//! - 이미지나 웹 화면처럼 글로 옮길 수 없는 것이 보이는 창(`visual`)은, `conversation.send` 때 코어가 그 창의 모습을
//!   찍어 첨부로 붙인다. 지난번에 붙인 모습과 같으면 붙이지 않는다.
//! - 같이 보기를 켠 창만, 켠 동안만 이 기기 밖(서버와 외부 대화 서비스)으로 나간다.
//!
//! # 쉘 업데이트 (10판)
//! 설치본 쉘(Windows NSIS)이 새 판을 스스로 받아 깐다. 디렉터는 업데이터가 든 첫 판만 손으로 깐다.
//! - 묻고 받는 것은 앱 크레이트(Tauri 업데이터)가 한다. 쉘을 켜고 [`UPDATE_FIRST_CHECK_DELAY_SECS`] 뒤 한 번, 그 뒤로
//!   [`UPDATE_CHECK_INTERVAL_SECS`](5분)마다 R2 정적 매니페스트(`https://kaleidoscope.eiaserinnys.me/releases/latest.json`)에
//!   먼저 묻고 연결이나 HTTP 오류면 공용 업데이트 서버(서비스 `tauri-app-updater`)에 묻는다. 새 판이 있으면 바로 받아 서명을 확인하고
//!   [`UpdateStatus::Ready`]로 알린다.
//!   받은 설치본은 메모리에만 있어 다시 시작하지 않고 쉘을 끄면 다음에 켤 때 다시 받는다. `ready`인 동안에는 묻지 않는다.
//! - 쉘은 혼자 다시 시작하지 않는다. 디렉터가 화면에서 고르면 화면이 편집기의 저장 대기분을 먼저 저장하고(저장이
//!   실패하거나 충돌이면 다시 시작하지 않는다) `update.restart`를 부른다. 코어는 디스크에 쓸 것을 쓰고 설치를 시작한다.
//!   Windows에서는 설치 프로그램이 조용한 모드(진행 막대만)로 뜨고 쉘이 바로 끝나며, 설치가 끝나면 새 판 쉘이 다시 뜬다.
//!   워크스페이스, 데스크톱, 창과 창 상태는 저장된 그대로 이어진다(연결한 쉘은 서버 정본). 창에 지금 보이는 글처럼
//!   메모리에만 두는 것은 다시 계산될 때까지 비어 있다.
//! - 서명은 쉘에 들어 있는 공개 키로 받은 직후와 깔기 직전에 확인한다. 맞지 않으면 깔지 않고 [`UpdateStatus::Failed`]다.
//!   서명 비밀 키는 리포의 GitHub secrets에만 있고 릴리스 워크플로가 서명한다.
//!   릴리스 워크플로는 설치본, 서명, `latest.json`을 R2 `releases/`에 올린다.
//! - 개발용 HTTP 다리, 브라우저 하니스, 업데이터 설정이 없는 빌드는 늘 [`UpdateStatus::Unavailable`]이다.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::ser::{
    self, SerializeMap, SerializeSeq, SerializeStruct, SerializeStructVariant, SerializeTuple,
    SerializeTupleStruct, SerializeTupleVariant,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod transfer;

/// MCP와 로컬 에이전트가 공유하는 앱 제작 안내.
pub const APP_AUTHORING_GUIDE: &str = include_str!("app_guide.txt");

pub mod store;
pub mod app_storage;
pub mod assets;
pub mod builtin;
pub mod client;
pub mod conversation;
pub mod data;
pub mod errors;
pub mod file_name;
pub mod jsonata_functions;
pub mod process;
pub mod preferences;
pub mod realtime;
pub mod registry;
pub mod size;
pub mod validate;
mod validate_input;
mod validate_button;
pub mod window_control;
pub mod worker;
pub use window_control::*;

use data::{Actions, Binding, SourceDecl};

/// 창 상태와 앱 정의의 상태 기본값에 쓰는 임의 JSON 값.
pub type JsonValue = serde_json::Value;

/// 한 번에 보낼 수 있는 대화 글의 최대 글자 수.
pub const CONVERSATION_MESSAGE_MAX_CHARS: usize = 20_000;
/// 첨부를 포함한 대화 요청 본문의 최대 바이트 수.
pub const CONVERSATION_SEND_BODY_MAX_BYTES: usize = 48 * 1024 * 1024;

/// Tauri 명령 이름. 화면은 `invoke("core", { request })`로 부른다.
pub const TAURI_COMMAND: &str = "core";
/// Tauri 이벤트 이름. 화면은 `listen("core-event", ...)`로 받는다.
pub const TAURI_EVENT: &str = "core-event";
/// 코어와 화면 사이 계약의 판.
pub const CONTRACT_VERSION: u32 = 36;

/// 이 쉘이 그릴 수 있는 블록 세트 버전. 블록 세트 전체에 정수 하나다.
///
/// 호환 규칙: 블록 세트의 새 판은 블록이나 있던 블록의 선택 필드를 더하기만 한다. 있던 필드의 뜻은 바꾸지
/// 않으므로 `requires.blocks`가 이 값 이하인 정의는 모두 그대로 그린다.
/// - 있던 블록에 더한 필드는 그 판 이상을 요구한다. 그 필드를 쓴 정의의 `requires.blocks`가 낮으면 검사기가
///   거부하고, 서버는 그 판을 그리지 못하는 쉘에 그 앱을 보내지 않는다. 필드를 쓰지 않은 정의는 전 판 그대로다.
/// - 블록이 그리는 모양과 조작은 쉘이 판마다 다듬을 수 있다(OS가 기본 앱을 고치듯). 정의 필드의 뜻과 앱이 기대는
///   동작(예: 탐색기에서 파일을 열면 `opens`의 앱으로 연다)은 지킨다.
/// - 1판: `split`, 폴더 모드 `tree`, 파일 모드 `markdown`.
/// - 2판: 1판 + 제공자 대화 모드 `chat`.
/// - 3판: 2판 + `web_view`, `explorer`, 앱 정의의 `opens`.
/// - 4판: 3판 + `stack`, `tabs`, `toolbar`, `section`, `list`, `table`, `properties`, `tree`, `feed`, `text`,
///   `input`, `select`, `toggle`, `button`, `code`, `image`, `media`, 앱 정의의 `sources`.
/// - 5판: 4판 + `explorer`의 `folder`, `on_folder`, `view`, `on_view`. 5판 쉘은 탐색기를 폴더 트리와 내용의 두 칸으로
///   그리고, 이 필드가 없는 3판 정의의 탐색기도 같은 모습으로 그린다.
/// - 6판: 5판 + `markdown`의 `document`와 읽기 전용 `value` 바인딩, `html_view`, 앱 정의의 `storage`와 `agent`.
/// - 7판: 6판 + `feed`의 `columns`, `copy`.
/// - 8판: 7판 + 기기 로컬 ACP 세션 모드의 `chat`.
/// - 9판: 8판 + `metrics`, `button_grid`, `chart`(캔들 포함), 표의 등락률과 스파크라인.
/// - 10판: 9판 + 세계 지도 `map`, 피드의 중첩 답글과 접기.
/// - 11판: `sandbox`, `slider`, `color`와 `input.rows`.
/// - 12판: 창 단위 클라이언트 로직과 `canvas`, `timeline`.
/// - 13판: 파일 또는 저장소 문서 모음을 뿌리로 하는 읽기 전용 `folder`.
/// - 14판: `canvas.surface`, `repeat`, `when`, `dialog`, `tour`, `anchor`, `progress`와 입력·배치 확장(v0.6.12).
/// - 15판: `tabs.header`, `tabs.keep_mounted`, `tabs.collapsible`, `folder.header`, `state_migrate`, `opens.set_state`.
/// - 16판: 탭과 입력 블록 라벨, `dialog.close_label`, `dialog.cancel_label`, `tour.labels`의 바인딩.
///   평문 문자열은 이전 판과 같은 wire 모양이다.
/// - 17판: 클라이언트 process 실행 권한.
/// - 18판: 클라이언트 채널과 대화 블록의 `client` 및 `footer`, 도구 중계, 지침과 같이 보기 준비, 창 범위 기기 저장소와
///   `process.file_uri`, stack 가운데 배치, notice, select와 toggle의 비활성 바인딩, 단독 동작 `copy_text`(아이콘이 있는
///   단추의 on_click에서 바인딩이 낸 글을 기기 클립보드에 쓴다).
/// - 19판: 앱 정의의 `settings` 설정 트리와 `window_title` 창 제목 및 메타 바인딩, `dialog.on_confirm`과 `dialog.danger`.
/// - 20판: 자동 열 격자 칸의 최소 폭을 고르는 `repeat.grid.item_width`,
///   `list`, `table`, `tree`, `feed`의 `item_menu`.
/// - 21판: input, select, slider, color의 `label_position`과 slider의 `show_value`.
/// - 22판: request 원천의 `page`(쪽 넘김)와 목록 블록의 다음 쪽 받기, `data.more`.
/// - 25판: `input.read_only` 읽기 전용 바인딩.
/// - 26판: 앱 정의의 불변 자산 아이콘.
/// - 27판: `split.column_below`, `repeat.gap`.
/// - 28판: `button.description` 도움말 바인딩.
/// - 29판: client의 메시지 수신 능력.
/// - 30판: `list`의 아이콘 격자 배치.
/// - 31판: `input.spin` 숫자 스핀 단추.
/// - 32판: 단추 강조 바인딩과 움직이는 그림 아이콘.
/// - 33판: 입력 선택지와 선택지 설명.
/// - 34판: timeline 날짜 눈금과 줄 배치.
/// - 35판: 날짜와 시간 입력.
/// - 36판: 목록 빼기와 주소 열기 동작.
/// - 37판: 쌓기 목록 채움.
pub const BLOCK_SET_VERSION: u32 = STACK_FILL_LIST_BLOCK_SET_VERSION;
pub const LIST_REMOVE_OPEN_URL_BLOCK_SET_VERSION: u32 = 36;
/// 날짜와 시간 입력의 첫 블록 세트 판.
pub const INPUT_DATE_TIME_BLOCK_SET_VERSION: u32 = 35;
/// stack.fill 목록을 처음 지원하는 블록 세트 판.
pub const STACK_FILL_LIST_BLOCK_SET_VERSION: u32 = 37;
/// 메시지 수신 능력을 처음 지원하는 블록 세트와 client 모듈 판.
pub const RECEIVE_MESSAGE_BLOCK_SET_VERSION: u32 = 29;
pub const RECEIVE_MESSAGE_CLIENT_VERSION: u32 = 6;
/// 숫자 입력의 스핀 단추를 지원하는 첫 블록 세트 판.
pub const INPUT_SPIN_BLOCK_SET_VERSION: u32 = 31;
/// 입력 선택지와 선택지 설명의 첫 블록 세트 판.
pub const INPUT_OPTIONS_BLOCK_SET_VERSION: u32 = 33;
/// timeline 날짜 눈금의 첫 블록 세트 판.
pub const TIMELINE_DATES_BLOCK_SET_VERSION: u32 = 34;
/// 앱 아이콘 자산 참조의 첫 블록 세트 판.
pub const APP_ICON_BLOCK_SET_VERSION: u32 = 26;
/// 분할의 반응형 방향과 반복 간격의 첫 블록 세트 판.
pub const LAYOUT_FIELDS_BLOCK_SET_VERSION: u32 = 27;
/// button.description을 처음 지원한 블록 세트 판.
pub const BUTTON_DESCRIPTION_BLOCK_SET_VERSION: u32 = 28;
/// 목록 아이콘 배치의 첫 블록 세트 판.
pub const LIST_ICONS_BLOCK_SET_VERSION: u32 = 30;
/// 입력 읽기 전용 바인딩의 첫 블록 세트 판.
pub const INPUT_READ_ONLY_BLOCK_SET_VERSION: u32 = 25;
/// 동적 표 열과 칸 격자의 첫 블록 세트 판.
pub const TABLE_GRID_BLOCK_SET_VERSION: u32 = 24;
/// 이 쉘이 제공하는 모듈과 버전.
/// - `files` 1판: 기기마다 고른 폴더의 파일 목록, 읽기, 쓰기, 탐색기에서 다른 앱으로 열기(`files.open`).
///   목록의 항목은 계약 8판부터 크기와 바뀐 시각을 담는다(앱 정의와 무관해 모듈 판은 그대로다).
/// - `files` 2판: 1판 + 권한의 `scope: pc`(이 PC 전체 읽기, 내 PC의 알려진 폴더와 볼륨, 기기와 앱마다 처음 한 번
///   허용, `files.allow_pc`). 계약 14판.
/// - `agent` 1판과 2판: 옛 서버 중계용이며 18판부터 사용하지 않는다.
/// - `web` 1판: 창 안에 웹 페이지를 띄우는 웹 화면(`web.*` 명령). 쉘이 그린 화면 위에 따로 뜬다.
/// - `agent` 3판: `conversation-v1` 제공자 설정과 `window_id` 기반 대화 명령. 옛 `workspace_id` 명령은 이행 중 유지한다.
/// - `storage` 1판: 계정 × 앱 저장소의 선언과 읽기, CAS 쓰기, 초기화.
/// - `storage` 2판: 1판 + 저장 항목의 설정 화면 보조 글과 선택지 바인딩.
/// - `connection` 1판: 서버에 등록한 이름 붙인 연결(`connection` 권한). 원천 받기, 동작의 연결 부르기,
///   이미지와 소리 받기. 연결은 서버가 헤더를 쥐고 대신 부르는 `relay`와 이 기기가 로그인해 직접 부르는
///   `oauth` 두 가지다([`registry`]의 「연결」 절).
/// - `connection` 2판: 계정마다 연결 이름을 등록한다.
/// - `client` 1판: 창별 격리 프레임의 로직과 로컬 출력.
/// - `client` 2판: HTTP 권한, 기기 저장소와 기본 런타임 기능.
/// - `client` 3판: 로컬 process 실행 권한.
/// - `client` 4판: 채팅 채널과 앱 작성 지침·같이 보기 준비 기능, 앱 정의에서 선언한 폴더 권한의 선택과 grant 변경 알림,
///   창 범위 기기 저장소와 프로그램 파일 주소.
/// - `process` 1판: 로컬 프로그램 실행, 명세마다 허용.
/// - `process` 2판: 1판 + 권한의 `command`, 프로그램마다 한 번 허용.
pub const MODULE_VERSIONS: &[(&str, u32)] = &[
    ("files", 3),
    ("agent", 3),
    ("web", 1),
    ("connection", realtime::REALTIME_CONNECTION_VERSION),
    ("storage", 3),
    ("assets", 1),
    ("http", 2),
    ("worker", 1),
    ("profiler", 1),
    ("client", RECEIVE_MESSAGE_CLIENT_VERSION),
    ("process", 2),
    ("store", 1),
];

/// 단추 강조 바인딩과 새 아이콘을 처음 지원한 블록 세트 판.
pub const BUTTON_VARIANT_ICON_BLOCK_SET_VERSION: u32 = 32;
/// 지원 범위를 알리지 않는 옛 쉘(블록 세트 3판 전)이 그릴 수 있는 블록 세트 판. 서버가 그런 기기에 보낼 앱을
/// 거를 때 쓴다([`registry`]의 「기기마다 그릴 수 있는 앱만」 절).
pub const LEGACY_BLOCK_SET_VERSION: u32 = 2;

/// 창 상태 하나를 JSON으로 직렬화했을 때의 최대 바이트 수.
pub const WINDOW_STATE_MAX_BYTES: usize = 64 * 1024;
/// `files.read`가 읽는 파일의 최대 바이트 수.
pub const FILE_READ_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// 말 하나에 붙일 수 있는 첨부의 최대 개수.
pub const AGENT_ATTACHMENTS_MAX: usize = 10;
/// 첨부 파일 하나의 최대 바이트 수(base64로 바꾸기 전).
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin: Option<store::StoreOrigin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub installed_version: Option<u32>,
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

/// 데스크톱에서 마지막으로 대화에 보낸 같이 보기 창 하나의 컨텍스트.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct SentShareContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub app_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub visual_hash: Option<String>,
}

/// 화면 한 장. 앱 창 배치와 대화별 마지막 컨텍스트를 가진다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct Desktop {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    /// 워크스페이스 안의 순서. 0부터.
    pub position: u32,
    /// 옛 판 호환용. 새 코어는 쓰거나 읽지 않으며 정본은 기기 코어 메모리다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<String>>")]
    pub sharing: Vec<String>,
    /// 대화 키별로 이 데스크톱에서 마지막으로 보낸 창별 컨텍스트.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[ts(
        optional,
        as = "Option<BTreeMap<String, BTreeMap<String, SentShareContext>>>"
    )]
    pub last_sent_context: BTreeMap<String, BTreeMap<String, SentShareContext>>,
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
    /// 창이 화면에서 숨겨져 있다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub minimized: bool,
    /// 창이 데스크톱의 사용 가능 영역을 채운다. `rect`에는 이전 크기를 보존한다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub maximized: bool,
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
    let state_before_migrations = next.clone();
    for (key, expression) in &definition.state_migrate {
        if old_state.contains_key(key) {
            continue;
        }
        let Ok(ast) = jsonata_core::parser::parse(expression) else {
            continue;
        };
        let mut context = jsonata_core::evaluator::Context::new();
        context.bind(
            "state".into(),
            jsonata_core::value::JValue::from(
                serde_json::to_value(&state_before_migrations).expect("JSON 상태"),
            ),
        );
        let mut evaluator = jsonata_core::evaluator::Evaluator::with_options(
            context,
            jsonata_core::evaluator::EvaluatorOptions {
                timeout_ms: Some(1000),
                max_stack_depth: Some(2000),
                ..Default::default()
            },
        );
        jsonata_functions::install_standard_functions(&mut evaluator);
        if let Ok(value) = evaluator.evaluate(&ast, &jsonata_core::value::JValue::Null) {
            next.insert(key.clone(), JsonValue::from(&value));
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
    /// None은 아직 서버에서 계정 설정을 받지 않은 상태다.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub preferences: Option<preferences::AccountPreferences>,
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
    #[serde(default)]
    pub process_access: Vec<process::ProcessAccess>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<assets::AssetDep>>")]
    pub assets: Vec<assets::AssetDep>,
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
            assets: builtin::BUNDLED_ASSET_KEYS
                .iter()
                .map(|(id, version)| assets::AssetDep {
                    id: (*id).into(),
                    version: *version,
                })
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

    /// 번들 자산은 해당 자산의 판을 가진 쉘에서만 쓸 수 있다.
    pub fn renders_app(&self, definition: &AppDefinition) -> bool {
        self.renders(&definition.requires)
            && definition
                .assets
                .iter()
                .all(|asset| !asset.id.starts_with("builtin-") || self.assets.contains(asset))
    }
}

/// 화면이 보는 상태 전체.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct ShellSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_transfer: Option<transfer::TransferResult>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub transfer_error: Option<String>,
    #[serde(default)]
    pub embedded_available: bool,
    pub shared: SharedState,
    pub device: DeviceState,
    pub supported: Supported,
    pub link: LinkStatus,
    /// 이 기기 코어 메모리에서 같이 보기를 켠 살아 있는 창 id. 켠 순서다.
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
/// 현재 연결의 저장과 실행 위치. 옛 연결 파일은 원격으로 읽는다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ServerMode {
    Embedded,
    #[default]
    Remote,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum LinkStatus {
    /// 연결하지 않았다. 앱은 이 기기에만 있고 `app.import`는 1판처럼 로컬로 가져온다.
    Unlinked {},
    /// 연결 코드를 받아 에이전트의 승인을 기다린다. 코어가 `interval_secs`마다 승인 여부를 묻는다.
    Pairing {
        server_url: String,
        /// 사람이 읽고 에이전트에게 전하는 코드. 예: `123456`. 이전 서버가 주는 문자 코드도 그대로 표시한다.
        user_code: String,
        expires_at: String,
    },
    /// 연결했고 이벤트 스트림이 이어져 있다. 레지스트리의 앱이 캐시와 맞춰져 있다.
    Connected {
        #[serde(default)]
        mode: ServerMode,
        server_url: String,
        device_name: String,
    },
    /// 연결했지만 지금 서버에 닿지 않는다(시작 직후 포함). 코어가 다시 잇는다. 캐시의 앱은 그대로 쓴다.
    Offline {
        #[serde(default)]
        mode: ServerMode,
        server_url: String,
        device_name: String,
        /// 마지막 연결 오류. 연결을 시작하는 동안에는 없다.
        reason: Option<CoreError>,
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
///    - `markdown`이나 `code`의 편집 모드에서 파일 권한은 `readwrite`다.
///    - 블록이 읽고 쓰는 상태 키(`state`, `set_state`)는 정의의 `state`에 선언되어 있다.
///    - 정의에 직접 적은 경로(문자열 `path`)는 [`FileRef`]의 경로 규칙을 지킨다. 어기면 고른 폴더 밖을
///      요구하는 정의로 보고 거부한다.
///    - `split`의 `children`은 둘 이상이고, `sizes`가 있으면 개수가 같고 모두 0보다 크다.
///    - `chat`은 `requires.modules`에 `agent`를 선언한다.
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
///      `button`의 `icon`은 [`data::ICON_NAMES`]에 있다. `code`는 `value`와 `file` 가운데 꼭 하나를 쓴다.
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
    /// 앱 아이콘. assets에 같은 id와 판을 선언한 SVG, PNG 또는 WebP 자산이다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub icon: Option<assets::AppIconRef>,
    pub requires: Requires,
    /// 앱이 참조할 수 있는 자산과 고정된 판.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<assets::AssetDep>>")]
    pub assets: Vec<assets::AssetDep>,
    #[serde(default)]
    pub permissions: Vec<PermissionDecl>,
    /// 창 상태의 키와 기본값. 창을 열 때 이 값으로 시작한다.
    #[serde(default)]
    pub state: BTreeMap<String, JsonValue>,
    /// (15판) 앱 판을 올려 기존 창을 옮길 때, 옛 상태에 없는 키의 값을 계산하는 JSONata 식.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[ts(optional, as = "Option<BTreeMap<String, String>>")]
    pub state_migrate: BTreeMap<String, String>,
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
    /// 개인 앱 서버에서 실행할 워커.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub worker: Option<worker::WorkerDecl>,
    /// 창 단위 클라이언트 로직.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub client: Option<client::ClientDecl>,
    /// 앱의 창 단축키.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub shortcuts: Option<Vec<Shortcut>>,
    /// 언어별 메시지 사전.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub messages: Option<BTreeMap<String, BTreeMap<String, String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub locale: Option<StateRef>,
    /// (블록 세트 19판) 앱 설정 화면. 저장소의 `presentation: settings` 자동 폼보다 우선한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub settings: Option<SettingsDecl>,
    /// (블록 세트 19판) 창 제목과 메타 글. 각 창에서 바인딩을 따로 계산한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub window_title: Option<WindowTitleDecl>,
    /// 창 안을 채우는 블록 트리의 뿌리.
    pub ui: Block,
}

/// 앱 정의의 사용자 지정 설정 패널.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct SettingsDecl {
    pub ui: Block,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub available: Option<data::Binding>,
}

/// 앱 창의 데이터 바인딩 제목과 선택 메타 글.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct WindowTitleDecl {
    pub title: data::Binding,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub meta: Option<data::Binding>,
}

/// 앱 창에 등록하는 키 조합.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct Shortcut {
    pub code: String,
    #[serde(default)]
    pub modifiers: Vec<ShortcutModifier>,
    pub action: Actions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ShortcutModifier {
    Shift,
    Alt,
    Ctrl,
    Meta,
    Primary,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum RepeatLayout {
    Row,
    #[default]
    Column,
    Grid,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum RepeatColumns {
    Count(u32),
    Auto(RepeatAuto),
}

/// 자동 열 격자 칸의 최소 폭. (블록 세트 20판)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum RepeatGridItemWidth {
    Small,
    Medium,
    Large,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct RepeatGrid {
    pub columns: RepeatColumns,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub item_width: Option<RepeatGridItemWidth>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum RepeatAuto {
    Auto,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct TourStep {
    pub key: String,
    pub target: String,
    pub title: Binding,
    pub body: Binding,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct TourLabels {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub previous: Option<Binding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next: Option<Binding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub done: Option<Binding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub skip: Option<Binding>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum InputCommit {
    #[default]
    Debounce,
    Blur,
    Submit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct InputFormat {
    pub kind: InputFormatKind,
    pub digits: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum InputFormatKind {
    Decimal,
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
    /// (15판) 파일을 열 때 경로와 함께 창 상태에 쓸 값.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[ts(optional, as = "Option<BTreeMap<String, JsonValue>>")]
    pub set_state: BTreeMap<String, JsonValue>,
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

/// 저장소 문서를 참조한다. `entry`는 앱의 저장 항목 id이고, 문서 모음에서는 `doc`에 문서 이름을 준다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct DocumentRef {
    pub entry: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub doc: Option<StringOrStateRef>,
}

/// 문서 모음 주소의 고정 이름 또는 창 상태 참조.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum StringOrStateRef {
    String(String),
    State(StateRef),
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
    /// 인증 없이 공개 HTTPS 경로를 읽는다.
    Http {
        id: String,
        label: String,
        base_url: String,
        paths: Vec<String>,
    },
    /// 이 기기에서 사용자가 허용한 프로그램을 실행한다.
    Process {
        id: String,
        label: String,
        /// (모듈 process 2판) 이 권한으로 실행할 프로그램. 선언하면 이 기기에서 허용을 (앱, 권한, 프로그램, 환경 변수)마다 한 번 받고 인자는 앱이 실행마다 정한다. 실행 명세의 command는 이 값과 정확히 같아야 한다. 없으면 실행 명세(이름, 프로그램, 인자, 환경 변수)마다 허용을 묻는다(1판의 뜻).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        command: Option<String>,
    },
    /// 이 기기에서 코어 성능 기록을 조회하고 측정한다.
    Profiler { id: String, label: String },
    /// 앱스토어에서 목록 읽기와 앱 설치·삭제.
    Store { id: String, label: String },
}

/// (모듈 `files` 2판) `files` 권한이 가리키는 범위.
///
/// `pc`의 규칙:
/// - 읽기 전용이다(`access: read`). 지금은 `explorer` 블록의 `root`만 이 권한을 가리킬 수 있다(검사기가 거부).
/// - 이 기기에서 이 앱에 처음 쓸 때 허용을 받는다(`files.allow_pc`). 허용 전의 `files.list`와 `files.open`은 `not_granted`다.
/// - `pc` 권한으로는 `files.list`와 `files.open`만 한다. `files.read`는 `not_granted`, `files.write`는
///   `permission_denied`이고 파일 내용은 여는 앱이 넘겨받은 폴더로 읽는다.
/// - 경로의 첫 마디는 뿌리의 id([`PcRootKind`])이고 그 아래는 [`FileRef`]의 경로 규칙을 따른다. 빈 경로는 내 PC 자체이고
///   `files.list`는 뿌리들을 낸다(알려진 폴더 먼저, 그다음 볼륨, 각각 이 기기가 준 순서). 뿌리에 없는 첫 마디는
///   `not_found`다. 창 상태에 이 경로를 두므로 다른 PC에서도 같은 알려진 폴더 아래를 연다(없으면 `not_found`).
/// - 코어는 이 쉘 자신의 데이터 폴더(기기 토큰, 로그인 정보) 안을 가리키는 경로를 `permission_denied`로 거부하고,
///   목록에서도 뺀다. 이 규칙은 `folder` 범위와 탐색기가 열며 넘겨준 폴더에도 같다.
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
            PermissionDecl::Files { id, .. }
            | PermissionDecl::Connection { id, .. }
            | PermissionDecl::Http { id, .. }
            | PermissionDecl::Profiler { id, .. }
            | PermissionDecl::Process { id, .. }
            | PermissionDecl::Store { id, .. } => id,
        }
    }

    /// 이 권한의 모듈 이름.
    pub fn module(&self) -> &'static str {
        match self {
            PermissionDecl::Files { .. } => "files",
            PermissionDecl::Connection { .. } => "connection",
            PermissionDecl::Http { .. } => "http",
            PermissionDecl::Process { .. } => "process",
            PermissionDecl::Profiler { .. } => "profiler",
            PermissionDecl::Store { .. } => "store",
        }
    }

    pub fn access(&self) -> FileAccess {
        match self {
            PermissionDecl::Files { access, .. } | PermissionDecl::Connection { access, .. } => {
                *access
            }
            PermissionDecl::Process { .. } | PermissionDecl::Http { .. } => FileAccess::Read,
            PermissionDecl::Profiler { .. } | PermissionDecl::Store { .. } => FileAccess::Readwrite,
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

fn default_tabs_header() -> bool {
    true
}

fn skip_default_tabs_header(value: &bool) -> bool {
    *value
}

fn skip_default_tabs_keep_mounted(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum TimelineScale {
    Seconds,
    Dates,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum TimelineLanes {
    Single,
    Pack,
    Each,
}

/// 블록. 블록 세트 4판의 전부다. 새 블록은 쉘 릴리스로만 더한다.
///
/// 4판 블록의 값 자리는 [`Binding`](리터럴, 창 상태, 식)이고, 이벤트 자리는 [`Actions`]다. 블록이 받는 데이터
/// 모양은 [`data`] 모듈의 [`data::ListItem`] 등에 있다. 식의 값이 아직 없으면(원천을 받는 중, 실패, 로그인 필요)
/// 데이터 블록은 그 상태를 그 자리에 보인다. 4판 블록은 쉘의 토큰과 공통 부품만으로 그리고, 앱이 색이나 크기를
/// 정하지 않는다(항목의 `color`와 배지 색만 예외).
#[derive(Debug, Clone, PartialEq, Serialize, TS, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub enum Block {
    Repeat {
        items: Binding,
        key: String,
        /// 항목 사이 간격. 생략하면 기존 배치의 간격을 쓴다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        gap: Option<Gap>,
        #[serde(default)]
        #[ts(optional, as = "Option<RepeatLayout>")]
        layout: RepeatLayout,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        grid: Option<RepeatGrid>,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        r#virtual: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        follow_key: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        follow_pause_ms: Option<u32>,
        template: Box<Block>,
    },
    When {
        #[serde(
            default,
            deserialize_with = "present_binding",
            skip_serializing_if = "Option::is_none"
        )]
        #[ts(optional)]
        value: Option<Binding>,
        /// (19판) 창 본문 너비가 CSS px 기준으로 이 값 이상일 때 자식을 그린다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        min_width: Option<u32>,
        /// (19판) 창 본문 너비가 CSS px 기준으로 이 값 이하일 때 자식을 그린다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        max_width: Option<u32>,
        child: Box<Block>,
    },
    Dialog {
        open: Binding,
        title: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        close_label: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        cancel_label: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_confirm: Option<Actions>,
        #[serde(default, skip_serializing_if = "is_false")]
        #[ts(optional, as = "Option<bool>")]
        danger: bool,
        child: Box<Block>,
        on_close: Actions,
    },
    Tour {
        open: Binding,
        step: Binding,
        steps: Vec<TourStep>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        labels: Option<TourLabels>,
        on_step: Actions,
        on_close: Actions,
    },
    Anchor {
        id: String,
        child: Box<Block>,
    },
    Progress {
        value: Binding,
        max: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        label: Option<Binding>,
    },
    /// (12판) 클라이언트가 그리는 픽셀 표면.
    Canvas {
        surface: Binding,
        /// (19판) 참이면 표준 로딩 표현을 보인다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        loading: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        aspect_ratio: Option<Binding>,
        #[serde(default)]
        #[ts(optional, as = "Option<client::CanvasFit>")]
        fit: client::CanvasFit,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        description: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_pointer: Option<Actions>,
    },
    /// (12판) 구간과 마커를 표시하고 시간축 편집 의도를 전달한다.
    Timeline {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        scale: Option<TimelineScale>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        lanes: Option<TimelineLanes>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        today: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        off_days: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        viewport: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_viewport: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        controls: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        duration: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        position: Option<Binding>,
        tracks: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        markers: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        ticks: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selection: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        snap: Option<Binding>,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        read_only: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_seek: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_edit: Option<Actions>,
    },
    /// (11판) 선언한 HTML을 격리된 프레임에서 실행한다.
    Sandbox {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        asset: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        document: Option<DocumentRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        title: Option<String>,
        #[serde(default, alias = "min_height", skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        height: Option<u16>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        state_keys: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        storage_entries: Vec<String>,
    },
    /// (11판) 수치 범위를 선택한다.
    Slider {
        value: Binding,
        on_change: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        label: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_inline")]
        #[ts(optional, as = "Option<LabelPosition>")]
        label_position: LabelPosition,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        #[ts(optional, as = "Option<bool>")]
        show_value: bool,
        min: f64,
        max: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        step: Option<f64>,
    },
    /// (11판) 색상을 선택한다.
    Color {
        value: Binding,
        on_change: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        label: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_inline")]
        #[ts(optional, as = "Option<LabelPosition>")]
        label_position: LabelPosition,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        disabled: Option<Binding>,
    },
    /// 자식 블록을 나란히 놓는다. 경계를 끌어 크기를 바꿀 수 있다(바꾼 크기는 저장하지 않는다).
    Split {
        direction: SplitDirection,
        /// row 분할의 자기 폭이 이 값보다 작으면 column으로 놓는다. 0은 쓸 수 없다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        column_below: Option<u32>,
        /// 자식마다의 상대 크기. 없으면 똑같이 나눈다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        sizes: Option<Vec<f64>>,
        children: Vec<Block>,
    },
    /// `items`면 앱 데이터 항목의 트리, `root`면 폴더의 파일 트리다. 둘 중 하나를 둔다.
    /// 데이터 모드의 항목은 [`data::TreeItem`]이고 `by`가 `path`면 항목의 경로를 나눠 가상 폴더를 만든다.
    /// `by: "children"`에서 자식이 있는 항목은 펼치고 접으며, 항목이 있으면 같은 동작에서 `on_select`도 실행한다.
    /// `by: "path"`의 가상 중간 폴더는 펼치고 접기만 하고, 자식이 없는 데이터 항목은 `on_select`를 실행한다.
    /// `selected` 항목의 상위 노드는 펼쳐지며 편 상태는 저장하지 않는다. 폴더 모드에서는 파일을 누르면 `on_select` 상태 키에
    /// 경로를 쓰고 폴더는 펼치고 접기만 한다. 쉘 창이 포커스를 다시 얻으면 폴더 모드의 트리를 다시 읽는다.
    Tree {
        #[serde(
            default,
            deserialize_with = "present_binding",
            skip_serializing_if = "Option::is_none"
        )]
        #[ts(optional)]
        items: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(skip)]
        #[ts(skip)]
        root: Option<FolderRef>,
        /// 보일 파일 확장자(점 없이, 소문자). 비어 있으면 모든 파일. 폴더는 늘 보인다.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        extensions: Vec<String>,
        #[serde(default)]
        #[ts(optional, as = "Option<TreeBy>")]
        by: TreeBy,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
        /// (20판) 데이터 항목의 메뉴. 동작 문맥은 `on_select`와 같다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        item_menu: Option<Vec<ItemMenuEntry>>,
    },
    /// (13판) 파일 폴더 또는 선언된 저장소 문서 모음을 읽고 항목을 고른다.
    /// PC 전체 권한은 탐색기만 받는다. `read_only`는 쓰기 UI를 보이지 않게 한다.
    Folder {
        root: FolderRoot,
        /// (15판) 거짓이면 폴더 머리 줄을 숨긴다.
        #[serde(
            default = "default_tabs_header",
            skip_serializing_if = "skip_default_tabs_header"
        )]
        #[ts(optional, as = "Option<bool>")]
        header: bool,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        extensions: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
        #[serde(default, skip_serializing_if = "is_false")]
        #[ts(optional, as = "Option<bool>")]
        read_only: bool,
    },
    /// `file`, `document`, `value` 가운데 하나의 마크다운을 표시한다. `value`는 읽기 전용이다.
    /// `read_only`가 거짓이면 `file`이나 `document`를 편집하고 저장한다. 파일은 원문 줄바꿈을 보존하며 자동 저장,
    /// 충돌 안내, 포커스 때 다시 읽기를 한다. (블록 세트 6판) `document`는 선언된 md 저장 항목을 쓰며,
    /// `file` 및 `value`와 함께 쓰지 않는다.
    Markdown {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        document: Option<DocumentRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_false")]
        #[ts(optional, as = "Option<bool>")]
        read_only: bool,
    },
    /// HTML을 격리된 프레임으로 본다. document 모드는 storage 3판의 md 문서 모음에서 리비전과 코멘트를 다루고 file/value 모드는 HTML을 읽기만 한다.
    HtmlView {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        document: Option<DocumentRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected_doc: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select_doc: Option<SetState>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected_revision: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select_revision: Option<SetState>,
    },
    /// (블록 세트 2판) 이 창이 있는 워크스페이스의 PAS와 나누는 대화다. `requires.modules`에 `agent`가 있어야 한다.
    /// `client`를 지정하면 앱이 대화 채널과 동작을 제공한다.
    /// 제공자 모드에서 앱 정의에 `agent` provider가 있으면 `agent` 3판의 대화 제공자를 사용한다. provider가 없으면 빈 상태다.
    /// - 서버에 연결하지 않았으면 연결하라는 빈 상태를 보인다.
    /// - 대화가 없으면 모델을 고르고 시작하는 판을 보인다(`conversation.create`).
    /// - 대화가 있으면 기록과 진행 중인 답을 보이고 입력창으로 보낸다(`conversation.send`).
    ///   Enter는 보내기, Shift+Enter는 줄바꿈이다. 한글 조합 중의 Enter는 보내지 않는다.
    /// - 답은 마크다운으로 렌더한다. HTML은 그리지 않고 링크를 눌러도 쉘이 다른 곳으로 가지 않는다.
    /// - (모듈 `agent` 2판) 입력 줄의 첨부 단추로 파일을 고르거나 입력창에 클립보드 이미지를 붙여 넣으면
    ///   보낼 첨부로 쌓인다. 첨부가 있으면 글 없이도 보낸다. 기록의 사용자 말에 첨부가 보이고, 이미지는
    ///   눌러 크게 보고 다른 파일은 눌러 기기의 기본 앱으로 연다.
    Chat {
        /// (블록 세트 18판) 대화 기록과 입력을 클라이언트 채널 및 동작에 연결한다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        client: Option<client::ChatClient>,
        /// (블록 세트 18판) 기록과 입력 사이에 그릴 앱 정의 블록.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        footer: Option<Box<Block>>,
    },
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
    /// (4판) 자식을 한 줄로 쌓는다. 끌어서 크기를 바꾸지 않는다(그건 `split`). `fill`번째 자식이 남은
    /// 자리를 모두 차지하며 넘치면 그 칸 안에서 스크롤한다. 앞 칸이 길면 채우는 칸이 먼저 0까지 줄어드니,
    /// 길어질 수 있는 목록과 문서를 `fill`로 둔다. `fill`을 생략하면 마지막 자식이 채운다. 다만 마지막 자식이
    /// 쌓는 방향으로 크기가 정해진 조작이면 채우는 칸 없이 모두 제 크기를 갖는다. 세로에서는 단추, 한 줄 입력,
    /// 고르기, 켜기, 슬라이더, 색, 도구 막대, 가로에서는 단추, 켜기, 색이고 이것들만 담은 스택도 같다.
    /// `when`과 `anchor`는 감싼 자식으로 본다. 세로 스택이 넘치면 창 몸통이 스크롤한다.
    /// `fill`이 `min_width`나 `max_width`를 가진 `when`을 가리키면, 바로 이웃한 폭 조건 `when`들도
    /// 채움 자리가 되어 창 폭으로 배치를 바꿔 끼울 때 보이는 쪽이 남은 공간을 채운다.
    /// 목록 형태의 `fill`은 지정한 칸들이 남은 공간을 똑같이 나눈다. 목록은 중복 없이 자식 범위 안의 번호를 하나 이상 담는다.
    /// `place:"center"`는 `fill`을 무시하고 가운데 배치한다.
    Stack {
        direction: SplitDirection,
        #[serde(default)]
        #[ts(optional, as = "Option<Gap>")]
        gap: Gap,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        fill: Option<StackFill>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        wrap: Option<bool>,
        /// (18판) 창 가운데 세로 기둥에 자식을 놓는다. 폭과 넘침 처리는 쉘이 정한다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        place: Option<StackPlace>,
        /// (19판) 교차축 정렬. `place:"center"`이면 가운데 배치가 정렬보다 우선한다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        align: Option<StackAlign>,
        children: Vec<Block>,
    },
    /// (4판) 탭. 고른 탭의 자식만 그린다. `selected`를 주면 고른 탭의 순서(0부터)를 창 상태에서 읽고 바꿀 때
    /// `on_change`로 쓴다(다시 열어도 그 탭). 없으면 쉘이 들고 저장하지 않는다.
    Tabs {
        tabs: Vec<Tab>,
        #[serde(
            default = "default_tabs_header",
            skip_serializing_if = "skip_default_tabs_header"
        )]
        #[ts(optional, as = "Option<bool>")]
        header: bool,
        #[serde(default, skip_serializing_if = "skip_default_tabs_keep_mounted")]
        #[ts(optional, as = "Option<bool>")]
        keep_mounted: bool,
        /// (15판) 참이면 분할 칸의 접기와 펼치기를 탭이 맡는다.
        #[serde(default, skip_serializing_if = "is_false")]
        #[ts(optional, as = "Option<bool>")]
        collapsible: bool,
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        actions: Option<Vec<Block>>,
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
        selected: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        /// (블록 세트 36판) 항목 끝의 빼기 단추가 실행하는 동작.
        on_remove: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        item_menu: Option<Vec<ItemMenuEntry>>,
    },
    /// (4판) 표. `rows`는 객체 배열이고 각 행에 `key`(문자열)가 있다. 칸은 `columns`의 `field`로 행에서 읽는다.
    /// 열 머리를 누르면 오름차순, 내림차순, 처음 순서로 돈다(저장하지 않음, `sort`가 처음 모습). 머리는 위에
    /// 붙어 있고 긴 표는 보이는 줄만 그린다. 고르기는 `list`와 같다.
    Table {
        rows: Binding,
        columns: TableColumns,
        #[serde(default, skip_serializing_if = "TableSelection::is_row")]
        #[ts(optional, as = "Option<TableSelection>")]
        selection: TableSelection,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        row_header: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        sort: Option<SortSpec>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        item_menu: Option<Vec<ItemMenuEntry>>,
    },
    /// (4판) 속성 이름과 값의 목록(상세 보기). 값이 null이거나 빈 글이면 그 줄을 뺀다. 값을 고르고 복사할 수 있다.
    /// (19판) `layout: "rows"`는 좁은 폭에서도 이름과 값을 두 열로 둔다.
    Properties {
        fields: Vec<PropertyField>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        layout: Option<PropertiesLayout>,
    },
    /// (4판) 흐름. 대화 기록, 대사, 로그처럼 이름과 본문이 이어지는 것. `entries`는 [`data::FeedEntry`] 배열이고,
    /// `grouped`면 [`data::Group`]`<FeedEntry>` 배열이다(묶음 머리에 제목과 부가 정보). 본문은 줄바꿈을 지키고
    /// 글을 고르고 복사할 수 있다. `format`이 `markdown`이면 본문을 마크다운으로 그린다(HTML은 그리지 않는다).
    /// `follow`면 끝에 붙어 있을 때 새 항목이 오면 끝을 따라간다. `on_select`가 있으면 항목을 누를 수 있다
    /// (글을 고르는 중의 누르기는 고르기가 아니다).
    #[serde(alias = "thread")]
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
        /// (블록 세트 10판) 대댓글과 긴 항목의 접기·펴기를 켠다.
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        collapsible: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        item_menu: Option<Vec<ItemMenuEntry>>,
    },
    /// (4판) 글. 값이 문자열이 아니면 JSON으로 보인다. `format`이 `markdown`이면 마크다운으로 그린다(HTML은
    /// 그리지 않는다). 글을 고르고 복사할 수 있다. 넘치면 그 칸 안에서 스크롤한다.
    Text {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_click: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_double_click: Option<Actions>,
        value: Binding,
        #[serde(default)]
        #[ts(optional, as = "Option<DisplayTextFormat>")]
        format: DisplayTextFormat,
        #[serde(default)]
        #[ts(optional, as = "Option<TextStyle>")]
        style: TextStyle,
    },

    // ----- 블록 세트 4판: 입력과 동작 -----
    /// (4판) 글 입력. `value`의 상태를 보이고, 입력이 멈추고 0.3초 뒤와 포커스를 잃을 때 `on_change`가 `$event`
    /// (입력한 글, `number`면 숫자나 null)로 돈다. 입력 중에는 상태가 바뀌어도 글을 덮지 않는다. `search`는 앞에
    /// 돋보기, 글이 있으면 끝에 지우기 단추가 붙는다. `multiline`이면 한 줄로 시작해 글을 따라 자란다(최대 8줄).
    /// Enter는 `on_submit`이 있으면 그것을 부른다(`multiline`에서는 Ctrl+Enter). 한글 조합 중의 Enter는 보내지 않는다.
    /// (19판) `columns`는 보일 문자 수로 폭을 정하며, 양수여야 하고 지정한 폭보다 줄어들지 않는다.
    /// (31판) `spin`은 숫자 입력에 위아래 단추를 보인다.
    Input {
        /// (33판) 입력하면서 거를 문자열 선택지 바인딩.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        options: Option<Binding>,
        /// (33판) 참이면 선택지 값만 확정한다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        options_only: Option<bool>,
        /// (25판) 참이면 편집을 막고 글 선택과 복사는 허용한다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        read_only: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        spin: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        min: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        max: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        step: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        format: Option<InputFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        commit: Option<InputCommit>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        focus: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_cancel: Option<Actions>,
        value: Binding,
        on_change: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        label: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_inline")]
        #[ts(optional, as = "Option<LabelPosition>")]
        label_position: LabelPosition,
        #[serde(default)]
        #[ts(optional, as = "Option<InputKind>")]
        kind: InputKind,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        multiline: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        rows: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        columns: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        placeholder: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_submit: Option<Actions>,
    },
    /// (4판) 고르기. `options`는 [`data::SelectOption`] 배열이다. 고르면 `on_change`가 `$event`(고른 값)로 돈다.
    /// `segmented`는 선택지가 한 줄에 다 보이는 모양이다(선택지 2~5개에 쓴다).
    Select {
        value: Binding,
        on_change: Actions,
        options: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        label: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_inline")]
        #[ts(optional, as = "Option<LabelPosition>")]
        label_position: LabelPosition,
        #[serde(default)]
        #[ts(optional, as = "Option<SelectStyle>")]
        style: SelectStyle,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        placeholder: Option<Binding>,
        /// (18판) 참이면 이 고르기를 사용할 수 없다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        disabled: Option<Binding>,
    },
    /// (4판) 켜고 끄기. 바꾸면 `on_change`가 `$event`(참이나 거짓)로 돈다.
    Toggle {
        value: Binding,
        on_change: Actions,
        label: Binding,
        /// (18판) 참이면 이 켜고 끄기를 사용할 수 없다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        disabled: Option<Binding>,
    },
    /// (18판) 일반 상태, 오류, 로딩 안내와 선택 동작을 보여준다.
    Notice {
        message: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        error_id: Option<Binding>,
        #[serde(default)]
        #[ts(optional, as = "Option<NoticeKind>")]
        kind: NoticeKind,
        #[serde(default)]
        actions: Vec<NoticeAction>,
    },
    /// (4판) 단추. 누르면 `on_click`이 돈다(`$event`는 null). 도는 동안 단추는 쉬고, 실패하면 창 아래에 오류
    /// 한 줄이 보인다. `confirm`이 있으면 확인 대화상자에서 확인했을 때만 돈다. `icon_only`면 아이콘만 보이고
    /// `label`은 도움말과 읽어 주기에 쓴다. `disabled`가 참이면 누를 수 없다. (19판) `preview`는 canvas 또는
    /// image 미리보기고 조작하지 않는다. `prefix`는 label 앞에 둘 보조 바인딩이다.
    Button {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pressed: Option<Binding>,
        label: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        description: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        icon: Option<Binding>,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        icon_only: bool,
        #[serde(default = "default_button_variant")]
        #[ts(optional, as = "Option<Binding>")]
        variant: Binding,
        on_click: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        confirm: Option<Confirm>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        disabled: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        #[schemars(description = "읽기 전용 그림. preview 안 블록의 조작부는 그리지 않는다.")]
        preview: Option<Box<Block>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        prefix: Option<Binding>,
    },

    // ----- 블록 세트 4판: 문서와 미디어 -----
    /// 코드와 설정 파일의 편집기 또는 읽기 전용 보기다. `file`과 `value` 가운데 하나를 쓴다.
    /// `file`은 기본으로 편집하고 `read_only`면 읽기 전용이다. `value`는 읽기 전용이다.
    /// `language`가 없으면 확장자로 정하며 `follow`는 따라가기를 고른다. `wrap`을 생략하면 창 폭에서 줄바꿈하고,
    /// `false`면 줄바꿈하지 않는다.
    Code {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        language: Option<CodeLanguage>,
        #[serde(default, skip_serializing_if = "is_false")]
        #[ts(optional, as = "Option<bool>")]
        read_only: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        #[ts(optional, as = "Option<bool>")]
        follow: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        wrap: Option<bool>,
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
    /// (9판) 수치와 보조 정보를 타일로 표시한다.
    Metrics {
        items: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        columns: Option<u32>,
    },
    /// (9판) 키와 단축키를 가진 단추를 격자로 표시한다.
    ButtonGrid {
        columns: u8,
        buttons: Binding,
        on_press: Actions,
    },
    /// (9판) 순서가 있는 수치 시리즈를 표시한다.
    Chart {
        #[serde(default)]
        #[ts(optional, as = "Option<ChartKind>")]
        kind: ChartKind,
        series: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        y_unit: Option<String>,
        #[serde(default)]
        #[ts(optional, as = "Option<ChartHeight>")]
        height: ChartHeight,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<Actions>,
    },
    /// (10판) 세계 지도 위에 위도·경도 지점을 표시한다. 고르면 `$event`는 키, `$item`은 지점이다.
    Map {
        #[serde(alias = "markers")]
        points: data::Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        on_select: Option<data::Actions>,
        #[serde(default)]
        #[ts(optional, as = "Option<ChartHeight>")]
        height: ChartHeight,
    },
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn present_binding<'de, D>(deserializer: D) -> Result<Option<Binding>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Binding::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum RawBlock {
    Repeat {
        items: Binding,
        key: String,
        #[serde(default)]
        gap: Option<Gap>,
        #[serde(default)]
        layout: RepeatLayout,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        grid: Option<RepeatGrid>,
        #[serde(default)]
        r#virtual: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        follow_key: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        follow_pause_ms: Option<u32>,
        template: Box<Block>,
    },
    When {
        #[serde(
            default,
            deserialize_with = "present_binding",
            skip_serializing_if = "Option::is_none"
        )]
        value: Option<Binding>,
        #[serde(default)]
        min_width: Option<u32>,
        #[serde(default)]
        max_width: Option<u32>,
        child: Box<Block>,
    },
    Dialog {
        open: Binding,
        title: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        close_label: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cancel_label: Option<Binding>,
        #[serde(default)]
        on_confirm: Option<Actions>,
        #[serde(default, skip_serializing_if = "is_false")]
        danger: bool,
        child: Box<Block>,
        on_close: Actions,
    },
    Tour {
        open: Binding,
        step: Binding,
        steps: Vec<TourStep>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        labels: Option<TourLabels>,
        on_step: Actions,
        on_close: Actions,
    },
    Anchor {
        id: String,
        child: Box<Block>,
    },
    Progress {
        value: Binding,
        max: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<Binding>,
    },
    Canvas {
        surface: Binding,
        #[serde(default)]
        loading: Option<Binding>,
        #[serde(default)]
        aspect_ratio: Option<Binding>,
        #[serde(default)]
        fit: client::CanvasFit,
        #[serde(default)]
        description: Option<Binding>,
        #[serde(default)]
        on_pointer: Option<Actions>,
    },
    Timeline {
        #[serde(default)]
        scale: Option<TimelineScale>,
        #[serde(default)]
        lanes: Option<TimelineLanes>,
        #[serde(default)]
        today: Option<bool>,
        #[serde(default)]
        off_days: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        viewport: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_viewport: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        controls: Option<bool>,
        #[serde(default)]
        duration: Option<Binding>,
        #[serde(default)]
        position: Option<Binding>,
        tracks: Binding,
        #[serde(default)]
        markers: Option<Binding>,
        #[serde(default)]
        ticks: Option<Binding>,
        #[serde(default)]
        selection: Option<Binding>,
        #[serde(default)]
        snap: Option<Binding>,
        #[serde(default)]
        read_only: bool,
        #[serde(default)]
        on_seek: Option<Actions>,
        #[serde(default)]
        on_select: Option<Actions>,
        #[serde(default)]
        on_edit: Option<Actions>,
    },
    #[serde(alias = "interactive_html")]
    Sandbox {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        asset: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        document: Option<DocumentRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, alias = "min_height", skip_serializing_if = "Option::is_none")]
        height: Option<u16>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        state_keys: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        storage_entries: Vec<String>,
    },
    Slider {
        value: Binding,
        on_change: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_inline")]
        label_position: LabelPosition,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        show_value: bool,
        min: f64,
        max: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        step: Option<f64>,
    },
    Color {
        value: Binding,
        on_change: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_inline")]
        label_position: LabelPosition,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        disabled: Option<Binding>,
    },
    /// 자식 블록을 나란히 놓는다. 경계를 끌어 크기를 바꿀 수 있다(바꾼 크기는 저장하지 않는다).
    Split {
        direction: SplitDirection,
        #[serde(default)]
        column_below: Option<u32>,
        /// 자식마다의 상대 크기. 없으면 똑같이 나눈다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sizes: Option<Vec<f64>>,
        children: Vec<Block>,
    },
    /// `items`면 앱 데이터 항목의 트리, `root`면 폴더의 파일 트리다. 둘 중 하나를 둔다.
    /// 데이터 모드의 항목은 [`data::TreeItem`]이고 `by`가 `path`면 항목의 경로를 나눠 가상 폴더를 만든다.
    /// `by: "children"`에서 자식이 있는 항목은 펼치고 접으며, 항목이 있으면 같은 동작에서 `on_select`도 실행한다.
    /// `by: "path"`의 가상 중간 폴더는 펼치고 접기만 하고, 자식이 없는 데이터 항목은 `on_select`를 실행한다.
    /// `selected` 항목의 상위 노드는 펼쳐지며 편 상태는 저장하지 않는다. 폴더 모드에서는 파일을 누르면 `on_select` 상태 키에
    /// 경로를 쓰고 폴더는 펼치고 접기만 한다. 쉘 창이 포커스를 다시 얻으면 폴더 모드의 트리를 다시 읽는다.
    Tree {
        #[serde(
            default,
            deserialize_with = "present_binding",
            skip_serializing_if = "Option::is_none"
        )]
        items: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        root: Option<FolderRef>,
        /// 보일 파일 확장자(점 없이, 소문자). 비어 있으면 모든 파일. 폴더는 늘 보인다.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        extensions: Vec<String>,
        #[serde(default)]
        by: TreeBy,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_select: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        item_menu: Option<Vec<ItemMenuEntry>>,
    },
    Folder {
        root: FolderRoot,
        #[serde(default = "default_tabs_header")]
        header: bool,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        extensions: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_select: Option<Actions>,
        #[serde(default)]
        read_only: bool,
    },
    /// 마크다운 원문 편집기. `file`이 가리키는 파일을 읽어 보이고, 원문을 그대로 쓴다.
    /// 자동 저장: 입력을 멈추고 1초 뒤, 다른 파일로 바뀌기 전, Ctrl+S에 저장한다. 저장은 읽은 revision을
    /// 함께 보내고, 그 사이 디스크에서 바뀌었으면(`conflict`) 다시 불러오기와 덮어쓰기를 고르게 한다.
    /// 고치지 않은 상태에서 쉘 창이 포커스를 다시 얻으면 파일을 다시 읽는다. 경로가 null이면 빈 상태를 보인다.
    /// (블록 세트 6판) `document`는 선언된 md 저장 항목을 읽고 쓴다. `file`과 함께 쓰지 않는다.
    Markdown {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        document: Option<DocumentRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_false")]
        read_only: bool,
    },
    /// HTML을 격리된 프레임으로 본다. document 모드는 문서·리비전·코멘트를 다루고 file/value 모드는 HTML을 읽기만 한다.
    HtmlView {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        document: Option<DocumentRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected_doc: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_select_doc: Option<SetState>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected_revision: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_select_revision: Option<SetState>,
    },
    /// (블록 세트 2판) 이 창이 있는 워크스페이스의 PAS와 나누는 대화. `requires.modules`에 `agent`가
    /// 있어야 한다. 창마다 설정할 것이 없다. 같은 워크스페이스의 대화 창은 모두 같은 PAS를 본다.
    /// 앱 정의에 `agent` provider가 있으면 `agent` 3판의 대화 제공자를 사용한다. 선언이 없는 기존
    /// `agent_chat {}`는 대화 제공자가 없다는 빈 상태를 보인다.
    /// - 서버에 연결하지 않았으면 연결하라는 빈 상태를 보인다.
    /// - 대화가 없으면 모델을 고르고 시작하는 판을 보인다(`conversation.create`).
    /// - 대화가 있으면 기록과 진행 중인 답을 보이고 입력창으로 보낸다(`conversation.send`).
    ///   Enter는 보내기, Shift+Enter는 줄바꿈이다. 한글 조합 중의 Enter는 보내지 않는다.
    /// - 답은 마크다운으로 렌더한다. HTML은 그리지 않고 링크를 눌러도 쉘이 다른 곳으로 가지 않는다.
    /// - (모듈 `agent` 2판) 입력 줄의 첨부 단추로 파일을 고르거나 입력창에 클립보드 이미지를 붙여 넣으면
    ///   보낼 첨부로 쌓인다. 첨부가 있으면 글 없이도 보낸다. 기록의 사용자 말에 첨부가 보이고, 이미지는
    ///   눌러 크게 보고 다른 파일은 눌러 기기의 기본 앱으로 연다.
    Chat {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client: Option<client::ChatClient>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        footer: Option<Box<RawBlock>>,
    },
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
        folder: Option<StateRef>,
        /// (5판) 보는 폴더가 바뀌면 그 경로를 쓸 상태 키.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_folder: Option<SetState>,
        /// (5판) 보기 방식([`ExplorerView`]의 문자열)을 읽을 상태 키.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        view: Option<StateRef>,
        /// (5판) 보기 방식을 바꾸면 그 값을 쓸 상태 키.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_view: Option<SetState>,
    },

    // ----- 블록 세트 4판: 배치 -----
    /// (4판) 자식을 한 줄로 쌓는다. 끌어서 크기를 바꾸지 않는다(그건 `split`). `fill`번째 자식이 남은
    /// 자리를 모두 차지하며 넘치면 그 칸 안에서 스크롤한다. 앞 칸이 길면 채우는 칸이 먼저 0까지 줄어드니,
    /// 길어질 수 있는 목록과 문서를 `fill`로 둔다. `fill`을 생략하면 마지막 자식이 채운다. 다만 마지막 자식이
    /// 쌓는 방향으로 크기가 정해진 조작이면 채우는 칸 없이 모두 제 크기를 갖는다. 세로에서는 단추, 한 줄 입력,
    /// 고르기, 켜기, 슬라이더, 색, 도구 막대, 가로에서는 단추, 켜기, 색이고 이것들만 담은 스택도 같다.
    /// `when`과 `anchor`는 감싼 자식으로 본다. 세로 스택이 넘치면 창 몸통이 스크롤한다.
    /// `fill`이 `min_width`나 `max_width`를 가진 `when`을 가리키면, 바로 이웃한 폭 조건 `when`들도
    /// 채움 자리가 되어 창 폭으로 배치를 바꿔 끼울 때 보이는 쪽이 남은 공간을 채운다.
    /// 목록 형태의 `fill`은 지정한 칸들이 남은 공간을 똑같이 나눈다. 목록은 중복 없이 자식 범위 안의 번호를 하나 이상 담는다.
    /// `place:"center"`는 `fill`을 무시하고 가운데 배치한다.
    Stack {
        direction: SplitDirection,
        #[serde(default)]
        gap: Gap,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill: Option<StackFill>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        wrap: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        place: Option<StackPlace>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        align: Option<StackAlign>,
        children: Vec<Block>,
    },
    /// (4판) 탭. 고른 탭의 자식만 그린다. `selected`를 주면 고른 탭의 순서(0부터)를 창 상태에서 읽고 바꿀 때
    /// `on_change`로 쓴다(다시 열어도 그 탭). 없으면 쉘이 들고 저장하지 않는다.
    Tabs {
        tabs: Vec<Tab>,
        #[serde(
            default = "default_tabs_header",
            skip_serializing_if = "skip_default_tabs_header"
        )]
        header: bool,
        #[serde(default, skip_serializing_if = "skip_default_tabs_keep_mounted")]
        keep_mounted: bool,
        #[serde(default)]
        collapsible: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_change: Option<SetState>,
    },
    /// (4판) 도구 막대. 한 줄의 컨트롤을 앞(`start`)과 끝(`end`)으로 나눠 놓는다. 자식은 `input`, `select`,
    /// `toggle`, `button`, `text`뿐이다. 높이와 여백, 아래 구분은 쉘이 정한다. `input`은 남은 폭을 차지한다.
    Toolbar {
        start: Vec<Block>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        end: Vec<Block>,
    },
    /// (4판) 제목이 있는 구역. `collapsible`이면 머리를 눌러 접고 편다(저장하지 않음). `collapsed`는 처음 모습이다.
    Section {
        title: Binding,
        /// 제목 옆에 작게 보일 부가 정보(개수 등).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        meta: Option<Binding>,
        #[serde(default)]
        collapsible: bool,
        #[serde(default)]
        collapsed: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        actions: Option<Vec<Block>>,
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
        layout: ListLayout,
        #[serde(default)]
        grouped: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_select: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_remove: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        item_menu: Option<Vec<ItemMenuEntry>>,
    },
    /// (4판) 표. `rows`는 객체 배열이고 각 행에 `key`(문자열)가 있다. 칸은 `columns`의 `field`로 행에서 읽는다.
    /// 열 머리를 누르면 오름차순, 내림차순, 처음 순서로 돈다(저장하지 않음, `sort`가 처음 모습). 머리는 위에
    /// 붙어 있고 긴 표는 보이는 줄만 그린다. 고르기는 `list`와 같다.
    Table {
        rows: Binding,
        columns: TableColumns,
        #[serde(default, skip_serializing_if = "TableSelection::is_row")]
        selection: TableSelection,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        row_header: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sort: Option<SortSpec>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_select: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        item_menu: Option<Vec<ItemMenuEntry>>,
    },
    /// (4판) 속성 이름과 값의 목록(상세 보기). 값이 null이거나 빈 글이면 그 줄을 뺀다. 값을 고르고 복사할 수 있다.
    /// (19판) `layout: "rows"`는 좁은 폭에서도 이름과 값을 두 열로 둔다.
    Properties {
        fields: Vec<PropertyField>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        layout: Option<PropertiesLayout>,
    },
    /// (4판) 흐름. 대화 기록, 대사, 로그처럼 이름과 본문이 이어지는 것. `entries`는 [`data::FeedEntry`] 배열이고,
    /// `grouped`면 [`data::Group`]`<FeedEntry>` 배열이다(묶음 머리에 제목과 부가 정보). 본문은 줄바꿈을 지키고
    /// 글을 고르고 복사할 수 있다. `format`이 `markdown`이면 본문을 마크다운으로 그린다(HTML은 그리지 않는다).
    /// `follow`면 끝에 붙어 있을 때 새 항목이 오면 끝을 따라간다. `on_select`가 있으면 항목을 누를 수 있다
    /// (글을 고르는 중의 누르기는 고르기가 아니다).
    #[serde(alias = "thread")]
    Feed {
        entries: Binding,
        #[serde(default)]
        grouped: bool,
        #[serde(default)]
        format: TextFormat,
        #[serde(default)]
        follow: bool,
        /// (블록 세트 7판) 본문 문단(`body`가 배열일 때)을 같은 너비의 칸으로 나란히 놓는다. 창이 좁아 칸마다
        /// 최소 너비를 지킬 수 없으면 위아래로 쌓는다. 예: 여러 문단 비교.
        #[serde(default)]
        columns: bool,
        /// (블록 세트 7판) 항목의 `meta`와 본문 문단마다 복사 단추를 붙인다. 누르면 그 글을 그대로(줄바꿈 포함)
        /// 클립보드에 쓴다. 단추를 눌러도 항목 고르기는 돌지 않는다.
        #[serde(default)]
        copy: bool,
        /// (블록 세트 10판) 대댓글과 긴 항목의 접기·펴기를 켠다.
        #[serde(default)]
        collapsible: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_select: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        item_menu: Option<Vec<ItemMenuEntry>>,
    },
    /// (4판) 글. 값이 문자열이 아니면 JSON으로 보인다. `format`이 `markdown`이면 마크다운으로 그린다(HTML은
    /// 그리지 않는다). 글을 고르고 복사할 수 있다. 넘치면 그 칸 안에서 스크롤한다.
    Text {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_click: Option<Actions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_double_click: Option<Actions>,
        value: Binding,
        #[serde(default)]
        format: DisplayTextFormat,
        #[serde(default)]
        style: TextStyle,
    },

    // ----- 블록 세트 4판: 입력과 동작 -----
    /// (4판) 글 입력. `value`의 상태를 보이고, 입력이 멈추고 0.3초 뒤와 포커스를 잃을 때 `on_change`가 `$event`
    /// (입력한 글, `number`면 숫자나 null)로 돈다. 입력 중에는 상태가 바뀌어도 글을 덮지 않는다. `search`는 앞에
    /// 돋보기, 글이 있으면 끝에 지우기 단추가 붙는다. `multiline`이면 한 줄로 시작해 글을 따라 자란다(최대 8줄).
    /// Enter는 `on_submit`이 있으면 그것을 부른다(`multiline`에서는 Ctrl+Enter). 한글 조합 중의 Enter는 보내지 않는다.
    Input {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        spin: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        options: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        options_only: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        read_only: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        step: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        format: Option<InputFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        commit: Option<InputCommit>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        focus: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_cancel: Option<Actions>,
        value: Binding,
        on_change: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_inline")]
        label_position: LabelPosition,
        #[serde(default)]
        kind: InputKind,
        #[serde(default)]
        multiline: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rows: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        columns: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        placeholder: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_submit: Option<Actions>,
    },
    Textarea {
        value: Binding,
        on_change: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<Binding>,
        #[serde(default)]
        kind: InputKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rows: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        placeholder: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_submit: Option<Actions>,
    },
    /// (4판) 고르기. `options`는 [`data::SelectOption`] 배열이다. 고르면 `on_change`가 `$event`(고른 값)로 돈다.
    /// `segmented`는 선택지가 한 줄에 다 보이는 모양이다(선택지 2~5개에 쓴다).
    Select {
        value: Binding,
        on_change: Actions,
        options: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<Binding>,
        #[serde(default, skip_serializing_if = "is_inline")]
        label_position: LabelPosition,
        #[serde(default)]
        style: SelectStyle,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        placeholder: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        disabled: Option<Binding>,
    },
    /// (4판) 켜고 끄기. 바꾸면 `on_change`가 `$event`(참이나 거짓)로 돈다.
    Toggle {
        value: Binding,
        on_change: Actions,
        label: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        disabled: Option<Binding>,
    },
    Notice {
        message: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error_id: Option<Binding>,
        #[serde(default)]
        kind: NoticeKind,
        #[serde(default)]
        actions: Vec<NoticeAction>,
    },
    /// (4판) 단추. 누르면 `on_click`이 돈다(`$event`는 null). 도는 동안 단추는 쉬고, 실패하면 창 아래에 오류
    /// 한 줄이 보인다. `confirm`이 있으면 확인 대화상자에서 확인했을 때만 돈다. `icon_only`면 아이콘만 보이고
    /// `label`은 도움말과 읽어 주기에 쓴다. `disabled`가 참이면 누를 수 없다.
    Button {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pressed: Option<Binding>,
        label: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<Binding>,
        #[serde(default)]
        icon_only: bool,
        #[serde(default = "default_button_variant")]
        variant: Binding,
        on_click: Actions,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        confirm: Option<Confirm>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        disabled: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        preview: Option<Box<Block>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prefix: Option<Binding>,
    },

    // ----- 블록 세트 4판: 문서와 미디어 -----
    /// (4판) 코드와 설정 파일 편집기. 저장, 충돌, 다시 읽기는 `markdown_editor`와 같다(원문 보존, 자동 저장).
    /// `language`가 없으면 확장자로 정한다. 권한은 `readwrite`다.
    Code {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        language: Option<CodeLanguage>,
        #[serde(default, skip_serializing_if = "is_false")]
        read_only: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        follow: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        wrap: Option<bool>,
    },
    /// (4판) 이미지 하나. `src`는 [`data::MediaRef`]이고 그 `crop`대로 자른다. `zoom`이면 휠과 단추로 확대하고
    /// 끌어서 옮기며, 두 번 누르면 맞춤으로 돌아간다. 이미지가 없으면 빈 상태를 보인다.
    Image {
        src: Binding,
        #[serde(default)]
        fit: ImageFit,
        #[serde(default)]
        zoom: bool,
    },
    /// (4판) 소리나 영상 재생기. `src`는 [`data::MediaRef`]다. `kind`가 없으면 받은 MIME으로 정한다. 재생, 멈춤,
    /// 위치 끌기, 시간, 소리 크기를 쉘이 그린다. `autoplay`면 `src`가 바뀔 때 바로 재생한다(목록에서 고르면 듣기).
    Media {
        src: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        kind: Option<MediaKind>,
        #[serde(default)]
        autoplay: bool,
    },
    /// (9판) 수치와 보조 정보를 타일로 표시한다.
    Metrics {
        items: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        columns: Option<u32>,
    },
    /// (9판) 키와 단축키를 가진 단추를 격자로 표시한다.
    ButtonGrid {
        columns: u8,
        buttons: Binding,
        on_press: Actions,
    },
    /// (9판) 순서가 있는 수치 시리즈를 표시한다.
    Chart {
        #[serde(default)]
        kind: ChartKind,
        series: Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        y_unit: Option<String>,
        #[serde(default)]
        height: ChartHeight,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_select: Option<Actions>,
    },
    /// (10판) 세계 지도 위에 위도·경도 지점을 표시한다. 고르면 `$event`는 키, `$item`은 지점이다.
    Map {
        #[serde(alias = "markers")]
        points: data::Binding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected: Option<StateRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_select: Option<data::Actions>,
        #[serde(default)]
        height: ChartHeight,
    },
    /// 이전 파일 탐색기 이름.
    FileTree {
        root: FolderRef,
        #[serde(default)]
        extensions: Vec<String>,
        selected: StateRef,
        on_select: SetState,
    },
    /// 이전 마크다운 편집기 이름.
    MarkdownEditor {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        document: Option<DocumentRef>,
    },
    /// 이전 마크다운 보기 이름.
    MarkdownView {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        document: Option<DocumentRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Binding>,
    },
    /// 이전 코드 편집기 이름.
    CodeEditor {
        file: FileRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        language: Option<CodeLanguage>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        wrap: Option<bool>,
    },
    /// 이전 코드 보기 이름.
    CodeView {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Binding>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file: Option<FileRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        language: Option<CodeLanguage>,
        #[serde(default, skip_serializing_if = "is_false")]
        follow: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        wrap: Option<bool>,
    },
    /// 이전 제공자 대화 이름.
    AgentChat {},
    /// 이전 계산기 격자 이름.
    Keypad {
        columns: u8,
        buttons: Binding,
        on_press: Actions,
    },
}

impl From<RawBlock> for Block {
    fn from(raw: RawBlock) -> Self {
        match raw {
            RawBlock::Repeat {
                items,
                key,
                gap,
                layout,
                grid,
                r#virtual,
                follow_key,
                follow_pause_ms,
                template,
            } => Block::Repeat {
                items,
                key,
                gap,
                layout,
                grid,
                r#virtual,
                follow_key,
                follow_pause_ms,
                template,
            },
            RawBlock::When {
                value,
                min_width,
                max_width,
                child,
            } => Block::When {
                value,
                min_width,
                max_width,
                child,
            },
            RawBlock::Dialog {
                open,
                title,
                close_label,
                cancel_label,
                on_confirm,
                danger,
                child,
                on_close,
            } => Block::Dialog {
                open,
                title,
                close_label,
                cancel_label,
                on_confirm,
                danger,
                child,
                on_close,
            },
            RawBlock::Tour {
                open,
                step,
                steps,
                labels,
                on_step,
                on_close,
            } => Block::Tour {
                open,
                step,
                steps,
                labels,
                on_step,
                on_close,
            },
            RawBlock::Anchor { id, child } => Block::Anchor { id, child },
            RawBlock::Progress { value, max, label } => Block::Progress { value, max, label },
            RawBlock::Canvas {
                surface,
                loading,
                aspect_ratio,
                fit,
                description,
                on_pointer,
            } => Block::Canvas {
                surface,
                loading,
                aspect_ratio,
                fit,
                description,
                on_pointer,
            },
            RawBlock::Timeline {
                scale,
                lanes,
                today,
                off_days,
                viewport,
                on_viewport,
                controls,
                duration,
                position,
                tracks,
                markers,
                ticks,
                selection,
                snap,
                read_only,
                on_seek,
                on_select,
                on_edit,
            } => Block::Timeline {
                scale,
                lanes,
                today,
                off_days,
                viewport,
                on_viewport,
                controls,
                duration,
                position,
                tracks,
                markers,
                ticks,
                selection,
                snap,
                read_only,
                on_seek,
                on_select,
                on_edit,
            },
            RawBlock::Sandbox {
                asset,
                file,
                document,
                value,
                title,
                height,
                state_keys,
                storage_entries,
            } => Block::Sandbox {
                asset,
                file,
                document,
                value,
                title,
                height,
                state_keys,
                storage_entries,
            },
            RawBlock::Slider {
                value,
                on_change,
                label,
                label_position,
                show_value,
                min,
                max,
                step,
            } => Block::Slider {
                value,
                on_change,
                label,
                label_position,
                show_value,
                min,
                max,
                step,
            },
            RawBlock::Color {
                value,
                on_change,
                label,
                label_position,
                disabled,
            } => Block::Color {
                value,
                on_change,
                label,
                label_position,
                disabled,
            },
            RawBlock::Split {
                direction,
                column_below,
                sizes,
                children,
            } => Block::Split {
                direction,
                column_below,
                sizes,
                children,
            },
            RawBlock::Tree {
                items,
                root,
                extensions,
                by,
                selected,
                on_select,
                item_menu,
            } => Block::Tree {
                items,
                root,
                extensions,
                by,
                selected,
                on_select,
                item_menu,
            },
            RawBlock::Folder {
                root,
                header,
                extensions,
                selected,
                on_select,
                read_only,
            } => Block::Folder {
                root,
                header,
                extensions,
                selected,
                on_select,
                read_only,
            },
            RawBlock::Markdown {
                file,
                document,
                value,
                read_only,
            } => Block::Markdown {
                file,
                document,
                value,
                read_only,
            },
            RawBlock::HtmlView {
                document,
                file,
                value,
                selected_doc,
                on_select_doc,
                selected_revision,
                on_select_revision,
            } => Block::HtmlView {
                document,
                file,
                value,
                selected_doc,
                on_select_doc,
                selected_revision,
                on_select_revision,
            },
            RawBlock::Chat { client, footer } => Block::Chat {
                client,
                footer: footer.map(|child| Box::new((*child).into())),
            },
            RawBlock::WebView {
                url,
                on_navigate,
                address_bar,
            } => Block::WebView {
                url,
                on_navigate,
                address_bar,
            },
            RawBlock::Explorer {
                root,
                folder,
                on_folder,
                view,
                on_view,
            } => Block::Explorer {
                root,
                folder,
                on_folder,
                view,
                on_view,
            },
            RawBlock::Stack {
                direction,
                gap,
                fill,
                wrap,
                place,
                align,
                children,
            } => Block::Stack {
                direction,
                gap,
                fill,
                wrap,
                place,
                align,
                children,
            },
            RawBlock::Tabs {
                tabs,
                header,
                keep_mounted,
                collapsible,
                selected,
                on_change,
            } => Block::Tabs {
                tabs,
                header,
                keep_mounted,
                collapsible,
                selected,
                on_change,
            },
            RawBlock::Toolbar { start, end } => Block::Toolbar { start, end },
            RawBlock::Section {
                title,
                meta,
                collapsible,
                collapsed,
                actions,
                child,
            } => Block::Section {
                title,
                meta,
                collapsible,
                collapsed,
                actions,
                child,
            },
            RawBlock::List {
                items,
                layout,
                grouped,
                selected,
                on_select,
                on_remove,
                item_menu,
            } => Block::List {
                items,
                layout,
                grouped,
                selected,
                on_select,
                on_remove,
                item_menu,
            },
            RawBlock::Table {
                rows,
                columns,
                selection,
                row_header,
                sort,
                selected,
                on_select,
                item_menu,
            } => Block::Table {
                rows,
                columns,
                selection,
                row_header,
                sort,
                selected,
                on_select,
                item_menu,
            },
            RawBlock::Properties { fields, layout } => Block::Properties { fields, layout },
            RawBlock::Feed {
                entries,
                grouped,
                format,
                follow,
                columns,
                copy,
                collapsible,
                selected,
                on_select,
                item_menu,
            } => Block::Feed {
                entries,
                grouped,
                format,
                follow,
                columns,
                copy,
                collapsible,
                selected,
                on_select,
                item_menu,
            },
            RawBlock::Text {
                on_click,
                on_double_click,
                value,
                format,
                style,
            } => Block::Text {
                on_click,
                on_double_click,
                value,
                format,
                style,
            },
            RawBlock::Input {
                spin,
                options,
                options_only,
                read_only,
                min,
                max,
                step,
                format,
                commit,
                focus,
                on_cancel,
                value,
                on_change,
                label,
                label_position,
                kind,
                multiline,
                rows,
                columns,
                placeholder,
                on_submit,
            } => Block::Input {
                spin,
                options,
                options_only,
                read_only,
                min,
                max,
                step,
                format,
                commit,
                focus,
                on_cancel,
                value,
                on_change,
                label,
                label_position,
                kind,
                multiline,
                rows,
                columns,
                placeholder,
                on_submit,
            },
            RawBlock::Textarea {
                value,
                on_change,
                label,
                kind,
                rows,
                placeholder,
                on_submit,
            } => Block::Input {
                spin: None,
                options: None,
                options_only: None,
                read_only: None,
                min: None,
                max: None,
                step: None,
                format: None,
                commit: None,
                focus: None,
                on_cancel: None,
                value,
                on_change,
                label,
                label_position: LabelPosition::Inline,
                kind,
                multiline: true,
                rows,
                columns: None,
                placeholder,
                on_submit,
            },
            RawBlock::Select {
                value,
                on_change,
                options,
                label,
                label_position,
                style,
                placeholder,
                disabled,
            } => Block::Select {
                value,
                on_change,
                options,
                label,
                label_position,
                style,
                placeholder,
                disabled,
            },
            RawBlock::Toggle {
                value,
                on_change,
                label,
                disabled,
            } => Block::Toggle {
                value,
                on_change,
                label,
                disabled,
            },
            RawBlock::Notice {
                message,
                error_id,
                kind,
                actions,
            } => Block::Notice {
                message,
                error_id,
                kind,
                actions,
            },
            RawBlock::Button {
                pressed,
                label,
                description,
                icon,
                icon_only,
                variant,
                on_click,
                confirm,
                disabled,
                preview,
                prefix,
            } => Block::Button {
                pressed,
                label,
                description,
                icon,
                icon_only,
                variant,
                on_click,
                confirm,
                disabled,
                preview,
                prefix,
            },
            RawBlock::Code {
                value,
                file,
                language,
                read_only,
                follow,
                wrap,
            } => Block::Code {
                value,
                file,
                language,
                read_only,
                follow,
                wrap,
            },
            RawBlock::Image { src, fit, zoom } => Block::Image { src, fit, zoom },
            RawBlock::Media {
                src,
                kind,
                autoplay,
            } => Block::Media {
                src,
                kind,
                autoplay,
            },
            RawBlock::Metrics { items, columns } => Block::Metrics { items, columns },
            RawBlock::ButtonGrid {
                columns,
                buttons,
                on_press,
            } => Block::ButtonGrid {
                columns,
                buttons,
                on_press,
            },
            RawBlock::Chart {
                kind,
                series,
                y_unit,
                height,
                on_select,
            } => Block::Chart {
                kind,
                series,
                y_unit,
                height,
                on_select,
            },
            RawBlock::Map {
                points,
                selected,
                on_select,
                height,
            } => Block::Map {
                points,
                selected,
                on_select,
                height,
            },
            RawBlock::FileTree {
                root,
                extensions,
                selected,
                on_select,
            } => Block::Tree {
                items: None,
                root: Some(root),
                extensions,
                by: TreeBy::default(),
                selected: Some(selected),
                on_select: Some(Actions::One(on_select)),
                item_menu: None,
            },
            RawBlock::MarkdownEditor { file, document } => Block::Markdown {
                file,
                document,
                value: None,
                read_only: false,
            },
            RawBlock::MarkdownView {
                file,
                document,
                value,
            } => Block::Markdown {
                file,
                document,
                value,
                read_only: true,
            },
            RawBlock::CodeEditor {
                file,
                language,
                wrap,
            } => Block::Code {
                value: None,
                file: Some(file),
                language,
                read_only: false,
                follow: false,
                wrap,
            },
            RawBlock::CodeView {
                value,
                file,
                language,
                follow,
                wrap,
            } => Block::Code {
                value,
                file,
                language,
                read_only: true,
                follow,
                wrap,
            },
            RawBlock::AgentChat {} => Block::Chat {
                client: None,
                footer: None,
            },
            RawBlock::Keypad {
                columns,
                buttons,
                on_press,
            } => Block::ButtonGrid {
                columns,
                buttons,
                on_press,
            },
        }
    }
}

impl<'de> Deserialize<'de> for Block {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        RawBlock::deserialize(deserializer).map(Block::from)
    }
}

impl Block {
    /// 이 블록이 처음 생긴 블록 세트 판. 정의의 `requires.blocks`는 쓴 블록의 이 값 이상이어야 한다.
    pub fn introduced_in(&self) -> u32 {
        match self {
            Block::Notice { .. } => 18,
            Block::Repeat { .. }
            | Block::When { .. }
            | Block::Dialog { .. }
            | Block::Tour { .. }
            | Block::Anchor { .. }
            | Block::Progress { .. } => 14,
            Block::Canvas { .. } | Block::Timeline { .. } => 12,
            Block::Sandbox { .. } | Block::Slider { .. } | Block::Color { .. } => 11,
            Block::Folder { .. } => 13,
            Block::HtmlView { .. } => 6,
            Block::Split { .. } => 1,
            Block::Tree {
                root: Some(_),
                items: None,
                ..
            } => 1,
            Block::Tree { .. } => 4,
            Block::Markdown {
                document: Some(_), ..
            } => 6,
            Block::Markdown { value: Some(_), .. } => 4,
            Block::Markdown { .. } => 1,
            Block::Chat {
                client: Some(_), ..
            } => 18,
            Block::Chat { .. } => 2,
            Block::Map { .. } => 10,
            Block::Metrics { .. } | Block::ButtonGrid { .. } | Block::Chart { .. } => 9,
            Block::WebView { .. } | Block::Explorer { .. } => 3,
            Block::Stack { .. }
            | Block::Tabs { .. }
            | Block::Toolbar { .. }
            | Block::Section { .. }
            | Block::List { .. }
            | Block::Table { .. }
            | Block::Properties { .. }
            | Block::Feed { .. }
            | Block::Text { .. }
            | Block::Input { .. }
            | Block::Select { .. }
            | Block::Toggle { .. }
            | Block::Button { .. }
            | Block::Code { .. }
            | Block::Image { .. }
            | Block::Media { .. } => 4,
        }
    }

    /// 클라이언트 채널을 사용하는 대화 블록인지 판단한다.
    pub fn is_client_chat(&self) -> bool {
        matches!(
            self,
            Block::Chat {
                client: Some(_),
                ..
            }
        )
    }

    /// JSON의 `type` 이름.
    pub fn type_name(&self) -> &'static str {
        match self {
            Block::Repeat { .. } => "repeat",
            Block::When { .. } => "when",
            Block::Dialog { .. } => "dialog",
            Block::Tour { .. } => "tour",
            Block::Anchor { .. } => "anchor",
            Block::Progress { .. } => "progress",
            Block::Canvas { .. } => "canvas",
            Block::Timeline { .. } => "timeline",
            Block::Sandbox { .. } => "sandbox",
            Block::Slider { .. } => "slider",
            Block::Color { .. } => "color",
            Block::Split { .. } => "split",
            Block::Tree { .. } => "tree",
            Block::Folder { .. } => "folder",
            Block::Markdown { .. } => "markdown",
            Block::HtmlView { .. } => "html_view",
            Block::Chat { .. } => "chat",
            Block::WebView { .. } => "web_view",
            Block::Explorer { .. } => "explorer",
            Block::Stack { .. } => "stack",
            Block::Tabs { .. } => "tabs",
            Block::Toolbar { .. } => "toolbar",
            Block::Section { .. } => "section",
            Block::List { .. } => "list",
            Block::Table { .. } => "table",
            Block::Properties { .. } => "properties",
            Block::Feed { .. } => "feed",
            Block::Text { .. } => "text",
            Block::Input { .. } => "input",
            Block::Select { .. } => "select",
            Block::Toggle { .. } => "toggle",
            Block::Notice { .. } => "notice",
            Block::Button { .. } => "button",
            Block::Code { .. } => "code",
            Block::Image { .. } => "image",
            Block::Media { .. } => "media",
            Block::Metrics { .. } => "metrics",
            Block::ButtonGrid { .. } => "button_grid",
            Block::Chart { .. } => "chart",
            Block::Map { .. } => "map",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ChartKind {
    #[default]
    Line,
    Bar,
    Area,
    Candlestick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ChartHeight {
    Compact,
    #[default]
    Medium,
    Tall,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum StackPlace {
    Center,
}

/// `stack` 자식의 교차축 정렬. 생략하면 flex의 기존 늘이기 동작을 유지한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum StackAlign {
    Start,
    Center,
    End,
    Baseline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum NoticeKind {
    #[default]
    Info,
    Error,
    Loading,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct NoticeAction {
    pub label: Binding,
    pub on_click: Actions,
}

/// 탭 하나.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct Tab {
    pub label: Binding,
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
    /// 작은 아이콘과 이름의 격자.
    Icons,
}

/// 표의 열 배열 또는 열 값을 내는 바인딩.
#[derive(Debug, Clone, PartialEq, Serialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum TableColumns {
    Static(Vec<Column>),
    Bound(Binding),
}

impl<'de> Deserialize<'de> for TableColumns {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        if value.is_array() {
            return serde_json::from_value(value).map(Self::Static).map_err(serde::de::Error::custom);
        }
        let binding: Binding = serde_json::from_value(value).map_err(serde::de::Error::custom)?;
        if matches!(binding, Binding::Literal(_)) {
            return Err(serde::de::Error::custom("table.columns는 열 배열이거나 state, expr, client, item 바인딩이어야 합니다"));
        }
        Ok(Self::Bound(binding))
    }
}

/// 표에서 고르는 단위.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum TableSelection {
    #[default]
    Row,
    Cell,
}
impl TableSelection {
    fn is_row(&self) -> bool { *self == Self::Row }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_lines: Option<u8>,
}

/// 쌓기에서 남은 공간을 차지할 자식 번호 또는 번호 목록.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum StackFill {
    Index(u32),
    Indices(Vec<u32>),
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
    /// 등락률을 부호와 상승·하락 색으로 표시한다.
    Delta,
    /// 숫자 배열을 표 안의 추이 곡선으로 표시한다.
    Sparkline,
    /// 제목, 본문, 색과 배지로 된 내용.
    Content,
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
    pub label: Binding,
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
    /// 색 문자열 배열을 읽기 전용 색 견본으로 표시한다.
    Swatches,
}

/// 속성 이름과 값을 나란히 보이는 배치.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum PropertiesLayout {
    Rows,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum DisplayTextFormat {
    #[default]
    Plain,
    Markdown,
    Time,
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

/// 컨트롤의 이름표 위치. 생략하면 인라인이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum LabelPosition {
    #[default]
    Inline,
    Top,
    Hidden,
}

fn is_inline(value: &LabelPosition) -> bool {
    *value == LabelPosition::Inline
}
fn default_true() -> bool {
    true
}
fn is_true(value: &bool) -> bool {
    *value
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum InputKind {
    #[default]
    Text,
    Search,
    Number,
    Date,
    Time,
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
    Chip,
}

fn default_button_variant() -> Binding {
    Binding::Literal(JsonValue::String("default".into()))
}

/// 항목 메뉴의 동작. `$event`는 블록의 `on_select`와 같은 항목 키(트리도 같은 값), `$item`은 항목이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct ItemMenuEntry {
    pub label: String,
    pub on_select: Actions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub danger: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub confirm: Option<Confirm>,
}

/// 단추 또는 메뉴 항목을 누른 뒤 묻는 확인 대화상자. `ok`가 없으면 해당 `label`을 쓴다.
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

/// 블록 세트 13판 폴더 뿌리. 기기 파일 권한 또는 앱 저장소의 문서 모음이다.
#[derive(Debug, Clone, PartialEq, Serialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum FolderRoot {
    Files { permission: String },
    Collection { entry: String },
}

impl<'de> Deserialize<'de> for FolderRoot {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        let object = value.as_object().ok_or_else(|| {
            <D::Error as serde::de::Error>::custom("folder root는 객체여야 합니다")
        })?;
        match (object.len(), object.get("permission"), object.get("entry")) {
            (1, Some(serde_json::Value::String(permission)), None) => Ok(Self::Files {
                permission: permission.clone(),
            }),
            (1, None, Some(serde_json::Value::String(entry))) => Ok(Self::Collection {
                entry: entry.clone(),
            }),
            _ => Err(<D::Error as serde::de::Error>::custom(
                "folder root는 permission 또는 entry 하나만 가져야 합니다",
            )),
        }
    }
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
    /// 계정의 기본 메시지 수신 앱을 바꾼다. None은 기본 앱 묶음의 초기 수신 앱을 뜻한다.
    #[serde(rename = "shell.preferences.set_default")]
    ShellPreferencesSetDefault { app_id: Option<String> },
    /// 새 수신 앱을 기본으로 쓸지 답한다.
    #[serde(rename = "shell.preferences.answer")]
    ShellPreferencesAnswer { app_id: String, use_as_default: bool },
    #[serde(rename = "window.control.respond")]
    WindowControlRespond { response: WindowControlResponse },
    #[serde(rename = "window.control.capture")]
    WindowControlCapture {
        request_id: String,
        window_id: String,
        bounds: Rect,
    },
    #[serde(rename = "web.control")]
    WebControl {
        request_id: String,
        window_id: String,
        operation: WindowControlOperation,
    },
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
    /// 창을 숨기되 위치와 크기, 최대화 상태를 보존한다.
    #[serde(rename = "window.minimize")]
    WindowMinimize { window_id: String },
    /// 창을 사용 가능 영역에 맞춘다.
    #[serde(rename = "window.maximize")]
    WindowMaximize { window_id: String },
    /// 창을 보존된 위치와 크기로 복원한다.
    #[serde(rename = "window.restore")]
    WindowRestore { window_id: String },
    /// 창과 그 창의 고른 폴더를 지운다.
    #[serde(rename = "window.close")]
    WindowClose { window_id: String },
    /// 창 상태를 통째로 바꾼다. 선언되지 않은 키나 크기 초과는 `invalid_request`.
    #[serde(rename = "window.set_state")]
    WindowSetState {
        window_id: String,
        state: BTreeMap<String, JsonValue>,
    },
    /// 창 상태의 현재 값 위에 patch의 키만 덮어 합치고 나머지 키는 유지한다.
    /// 창, 선언된 키, 크기는 `window.set_state`와 같이 검사한다.
    #[serde(rename = "window.patch_state")]
    WindowPatchState {
        window_id: String,
        patch: BTreeMap<String, JsonValue>,
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
    /// - `pairing`, 원격 `offline`, `revoked`: `server`로 거부한다. 내장 서버는 스트림 연결 전에도 HTTP로 가져온다.
    #[serde(rename = "app.import")]
    AppImport { definition_json: String },

    /// 설치된 앱의 지정한 판이 선언한 아이콘을 읽는다. 창을 만들지 않는다.
    #[serde(rename = "app.icon")]
    AppIcon { app_id: String, app_version: u32 },

    /// 오케스트레이터 연결을 시작한다. 서버에 연결 코드를 받아 `pairing`으로 가고, 응답에 코드를 준다.
    /// server_url을 생략하거나 비우면 호스트의 기본 원격 주소를 쓴다. 보관한 연결이 있으면 재사용한다.
    /// 서버에 닿지 않으면 `server`.
    #[serde(rename = "link.start")]
    LinkStart {
        #[serde(default)]
        #[ts(optional)]
        server_url: Option<String>,
    },
    /// 진행 중인 연결 시도를 그만두고 내장 서버로 복귀한다. 내장 서버가 없으면 `unlinked`로 간다.
    #[serde(rename = "link.use_local")]
    LinkUseLocal {},
    #[serde(rename = "link.sync_local_to_remote")]
    LinkSyncLocalToRemote {},
    #[serde(rename = "link.cancel")]
    LinkCancel {},
    /// 내장 서버가 있으면 서버별 배치를 보존하고 내 PC 서버로 복귀한다. 없으면 연결 정보를 지운다.
    #[serde(rename = "link.unlink")]
    LinkUnlink {},

    #[serde(rename = "client.http_read")]
    ClientHttpRead {
        window_id: String,
        permission: String,
        path: String,
        query: BTreeMap<String, JsonValue>,
    },
    #[serde(rename = "client.blob_put")]
    ClientBlobPut {
        window_id: String,
        key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        bytes: Option<Vec<u8>>,
    },
    #[serde(rename = "client.blob_open")]
    ClientBlobOpen { window_id: String, key: String },
    #[serde(rename = "client.blob_remove")]
    ClientBlobRemove { window_id: String, key: String },
    #[serde(rename = "client.blob_list")]
    ClientBlobList { window_id: String, prefix: String },
    #[serde(rename = "files.save_prompt")]
    FilesSavePrompt {
        window_id: String,
        suggested_name: String,
        mime: String,
    },

    /// 이 기기의 폴더 고르기 창을 띄워 창의 권한 하나에 폴더를 준다. 이미 있으면 바꾼다.
    /// 사용자가 취소하면 `grant`가 null이다.
    #[serde(rename = "files.pick_folder")]
    FilesPickFolder {
        window_id: String,
        permission: String,
    },
    #[serde(rename = "files.pick")]
    FilesPick {
        window_id: String,
        accept: Vec<data::FileAccept>,
        multiple: bool,
    },
    #[serde(rename = "export.begin")]
    ExportBegin {
        window_id: String,
        suggested_name: String,
        mime: String,
    },
    #[serde(rename = "export.truncate")]
    ExportTruncate {
        window_id: String,
        sink_id: String,
        #[ts(type = "number")]
        size: u64,
    },
    #[serde(rename = "export.close")]
    ExportClose { window_id: String, sink_id: String },
    #[serde(rename = "export.abort")]
    ExportAbort { window_id: String, sink_id: String },
    #[serde(rename = "client.release")]
    ClientRelease { window_id: String },
    #[serde(rename = "client.command")]
    ClientCommand {
        window_id: String,
        name: String,
        event: JsonValue,
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
    /// 고른 폴더 안에 새 폴더를 만든다. 같은 이름이 있으면 conflict다.
    #[serde(rename = "files.mkdir")]
    FilesMkdir {
        window_id: String,
        permission: String,
        parent: String,
        name: String,
    },
    /// 항목의 이름을 바꾼다. 다른 폴더로 옮기지 않는다.
    #[serde(rename = "files.rename")]
    FilesRename {
        window_id: String,
        permission: String,
        path: String,
        name: String,
    },
    /// 선택한 항목을 대상 폴더로 옮긴다. 덮어쓰지 않는다.
    #[serde(rename = "files.move")]
    FilesMove {
        window_id: String,
        permission: String,
        paths: Vec<String>,
        destination: String,
    },
    /// 선택한 항목을 대상 폴더에 복사한다. 이름이 겹치면 복사본 이름을 붙인다.
    #[serde(rename = "files.copy")]
    FilesCopy {
        window_id: String,
        permission: String,
        paths: Vec<String>,
        destination: String,
    },
    /// 선택한 항목을 휴지통으로 보내거나 영구 삭제한다.
    #[serde(rename = "files.remove")]
    FilesRemove {
        window_id: String,
        permission: String,
        paths: Vec<String>,
        permanent: bool,
    },
    /// 파일 관리자에서 항목을 표시한다.
    #[serde(rename = "files.reveal")]
    FilesReveal {
        window_id: String,
        permission: String,
        path: String,
    },
    /// 선택한 파일의 절대 경로를 읽는다.
    #[serde(rename = "files.path")]
    FilesPath {
        window_id: String,
        permission: String,
        path: String,
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
    /// http 또는 https 주소를 기기의 기본 브라우저로 연다.
    #[serde(rename = "external.open")]
    ExternalOpen {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        window_id: Option<String>,
        url: String,
    },
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

    /// (모듈 `agent` 3판) 창의 제공자 대화와 최근 기록을 읽는다.
    #[serde(rename = "conversation.get")]
    ConversationGet {
        window_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        profile: Option<String>,
    },
    /// 이전 기록을 읽는다.
    #[serde(rename = "conversation.history")]
    ConversationHistory { window_id: String, before: String },
    /// 고른 모델로 대화를 만든다.
    #[serde(rename = "conversation.create")]
    ConversationCreate {
        window_id: String,
        model: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        profile: Option<String>,
    },
    /// 현재 대화의 프로필이나 모델을 바꾼다. 실행이 바뀌어도 thread와 저장된 기록은 유지한다.
    #[serde(rename = "conversation.switch")]
    ConversationSwitch {
        window_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        profile: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        model: Option<String>,
    },
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
    StorageGet {
        window_id: String,
        entry: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        doc: Option<String>,
    },
    /// (모듈 `storage` 3판) 문서 모음의 본문 없는 목록을 읽는다.
    #[serde(rename = "storage.list")]
    StorageList { window_id: String, entry: String },
    /// (모듈 `storage` 1판) expected_revision CAS로 선언 항목을 쓴다. 빠지거나 null이면 저장값이 없을 때만 만든다.
    #[serde(rename = "storage.write")]
    StorageWrite {
        window_id: String,
        entry: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        doc: Option<String>,
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        doc: Option<String>,
        #[serde(default)]
        #[ts(optional, as = "Option<app_storage::ExpectedRevision>")]
        expected_revision: app_storage::ExpectedRevision,
    },
    /// (모듈 `storage` 3판) 문서 모음 안에서 이름을 바꾼다. 한 CAS transaction이며 본문을 보내지 않는다.
    #[serde(rename = "storage.move")]
    StorageMove {
        window_id: String,
        entry: String,
        from: String,
        to: String,
        expected_revision: String,
    },

    /// (블록 세트 4판) 창의 데이터를 잇는다. 4판 블록이 든 창이 그려질 때 한 번 부른다. 코어는 아직 받지 않은
    /// 원천을 받기 시작하고, 지금 모습 전체를 돌려준다. 그 뒤 바뀐 것은 `data.update`로 온다. 같은 창을 여러 화면이
    /// 이어도 된다(개발용 다리). 앱의 지금 버전에 `sources`도 식 바인딩도 없으면 빈 모습이다. 없는 창이면 `not_found`.
    /// 이어 둔 동안만 `refresh_secs`와 포커스 때 다시 받기가 돈다. 받은 값은 창이 닫히거나 앱의 새 버전으로 옮길
    /// 때까지 코어가 들고 있어, 다른 데스크톱에 갔다 와도 다시 받지 않는다.
    #[serde(rename = "data.attach")]
    DataAttach {
        window_id: String,
        #[serde(default)]
        #[ts(optional, as = "Option<Vec<String>>")]
        dormant: Vec<String>,
    },
    /// 화면에서 쉬고 있는 블록 자리의 목록을 바꾼다.
    #[serde(rename = "data.dormant")]
    DataDormant {
        window_id: String,
        dormant: Vec<String>,
    },
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        modifiers: Option<client::EventModifiers>,
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
    /// 원천의 다음 쪽을 받는다. 시작 여부를 바로 응답하고 결과는 `data.update`로 보낸다.
    #[serde(rename = "data.more")]
    DataMore { window_id: String, source: String },
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

    /// (9판) 창의 같이 보기를 켜거나 끈다. 창이 속한 [`Desktop::sharing`]에 저장하고 동기화한다.
    /// [`ShellSnapshot::sharing`]이 바뀌므로 `state.changed`가 따라온다. 이미 그 상태면 아무것도 하지 않는다(이벤트 없음). 없는 창이면 `not_found`.
    /// 연결 상태와 무관하게 성공한다.
    /// - 켜면 화면이 곧 `share.view`로 보이는 것을 준다. 코어는 그 전까지 서버에 올릴 것이 없다.
    /// - 끄면 코어가 그 창의 현재 보이는 글과 마지막 이미지 해시를 지우고, 연결되어 있으면 서버의 그 창 보기를
    ///   지운다([`registry`]의 「같이 보기」 절). 대화별 마지막 글은 다음 전송에서 「같이 보기 끝」을 보낼 때까지 둔다.
    ///   서버 삭제에 실패하면 다시 이을 때 지운다.
    #[serde(rename = "share.set")]
    ShareSet { window_id: String, on: bool },
    /// (9판) 같이 보기 창에 지금 보이는 것을 코어에 준다. 화면은 켠 직후 한 번, 그 뒤로는 창에 보이는 것이나 창의
    /// 자리가 바뀌고 [`SHARE_DEBOUNCE_MS`] 동안 더 바뀌지 않을 때 부른다. 대화 블록은 `conversation.send` 전에 기다리던
    /// 옮기기를 바로 해서 이 명령을 마친다(보낸 말이 방금 본 것과 함께 가도록).
    /// - 같이 보기가 꺼진 창이면 아무것도 하지 않고 성공한다(끈 직후 늦게 온 것). 없는 창이면 `not_found`.
    /// - `text`가 [`SHARE_TEXT_MAX_BYTES`]를 넘으면 `invalid_request`.
    /// - 코어는 현재 보이는 글을 창마다 하나 메모리에 둔다. 연결되어 있고 글이나 `visual`이 서버에 마지막으로 올린 것과
    ///   다르면 서버에 올린 뒤 응답한다. 올리다 실패해도 성공으로 응답하고, 다음 `share.view`나 다시 이을 때 올린다.
    ///   상태를 바꾸지 않으므로 이벤트가 없다.
    #[serde(rename = "share.view")]
    ShareView {
        window_id: String,
        view: VisibleView,
    },
    /// 같이 보기 이미지 전송을 위해 Windows 화면을 고정한다. 다른 플랫폼이나 네이티브 호스트가 없는 쉘은
    /// `frozen: false`로 응답한다. 실패는 이미지 없는 전송으로 이어지고 화면은 5초 안에 자동으로 원상 복구된다.
    #[serde(rename = "share.freeze")]
    ShareFreeze {},
    /// 숨은 창을 잠시 드러내 격리 캡처를 코어 메모리에 저장한다. 웹 화면이 있으면 그 자식 웹뷰만 캡처하고,
    /// 아니면 쉘 화면에서 창 영역을 자른다. 캡처 실패는 `captured: false`이며 화면은 이후에도 복원된다.
    #[serde(rename = "share.capture")]
    ShareCapture { window_id: String },
    /// `share.freeze`로 고정한 화면을 해제한다. 호스트가 없거나 해제에 실패해도 명령은 성공한다.
    #[serde(rename = "share.unfreeze")]
    ShareUnfreeze {},

    #[serde(rename = "host.instructions")]
    HostInstructions { window_id: String, kind: String },
    #[serde(rename = "context.prepare")]
    ContextPrepare {
        window_id: String,
        request_id: String,
        channel: String,
        attachments: client::ContextAttachments,
    },
    #[serde(rename = "context.commit")]
    ContextCommit { window_id: String, ticket: String },

    #[serde(rename = "connection.realtime.session")]
    RealtimeSession { window_id: String },
    #[serde(rename = "connection.realtime.open")]
    RealtimeOpen {
        window_id: String,
        session: String,
        permission: String,
        kind: realtime::RealtimeKind,
        path: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        protocols: Vec<String>,
    },
    #[serde(rename = "connection.realtime.read")]
    RealtimeRead { window_id: String, session: String, handle: String, #[ts(type = "number")] after: u64 },
    #[serde(rename = "connection.realtime.ack")]
    RealtimeAck { window_id: String, session: String, handle: String, #[ts(type = "number")] through: u64 },
    #[serde(rename = "connection.realtime.send")]
    RealtimeSend { window_id: String, session: String, handle: String, message: realtime::RealtimePayload },
    #[serde(rename = "connection.realtime.close")]
    RealtimeClose {
        window_id: String,
        session: String,
        handle: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        code: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        reason: Option<String>,
    },
    #[serde(rename = "connection.realtime.release")]
    RealtimeRelease { window_id: String, session: String },

    #[serde(rename = "app.respond_install_permission")]
    AppRespondInstallPermission { window_id: String, request_id: String, digest: String, allow: bool },

    /// 프로세스 명령. 허용 응답은 쉘에서만 보낸다.
    #[serde(rename = "process.start")]
    ProcessStart {
        window_id: String,
        key: String,
        permission: String,
        spec: process::ProcessSpec,
        cwd_permission: String,
        #[serde(default)]
        services: Vec<String>,
    },
    #[serde(rename = "process.respond_permission")]
    ProcessRespondPermission {
        window_id: String,
        request_id: String,
        allow: bool,
    },
    #[serde(rename = "process.attach")]
    ProcessAttach { window_id: String, key: String },
    #[serde(rename = "process.read")]
    ProcessRead {
        window_id: String,
        handle: String,
        #[ts(type = "number")]
        after: u64,
        max_bytes: usize,
    },
    #[serde(rename = "process.ack")]
    ProcessAck {
        window_id: String,
        handle: String,
        #[ts(type = "number")]
        after: u64,
        checkpoint: Option<serde_json::Value>,
    },
    #[serde(rename = "process.write")]
    ProcessWrite {
        window_id: String,
        handle: String,
        bytes: Vec<u8>,
        checkpoint: Option<serde_json::Value>,
    },
    #[serde(rename = "process.close_input")]
    ProcessCloseInput { window_id: String, handle: String },
    #[serde(rename = "process.stop")]
    ProcessStop { window_id: String, handle: String },
    /// (클라이언트 4판) 창 범위 저장소 파일의 `file://` 주소를 돌려준다.
    #[serde(rename = "process.file_uri")]
    ProcessFileUri { window_id: String, blob_key: String },

    /// (10판) 받아 둔 새 판으로 다시 시작한다. 위 「쉘 업데이트」 절.
    /// - 업데이터가 없는 쉘([`UpdateStatus::Unavailable`])이면 `unavailable`, 그 밖에 `ready`가 아니면 `invalid_request`.
    /// - 코어는 디스크에 아직 쓰지 않은 상태를 쓰고 설치를 시작한다. Windows에서는 설치를 시작하면 응답 전에 쉘이
    ///   끝난다. 화면은 부른 뒤 「다시 시작하는 중」으로 두고 응답을 기다리지 않아도 된다.
    /// - 설치를 시작하지 못하면(서명이 맞지 않음 포함) `io`와 까닭이고, 상태는 [`UpdateStatus::Failed`]가 된다.
    #[serde(rename = "update.restart")]
    UpdateRestart {},

    /// 화면 입력 단계와 긴 프레임의 묶음 표본을 코어 프로파일러에 보낸다.
    #[serde(rename = "profiler.report")]
    ProfilerReport {
        inputs: Vec<UiInputSample>,
        frames: Vec<UiFrameSample>,
    },
}

/// 입력 이벤트에서 측정한 브라우저 응답 단계.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct UiInputSample {
    pub event: String,
    pub target: String,
    pub app_id: Option<String>,
    pub responding: bool,
    pub wait_ms: f64,
    pub processing_ms: f64,
    pub paint_ms: f64,
}

/// Long Animation Frame 관측값.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct UiFrameSample {
    pub ms: f64,
    pub blocking_ms: f64,
    pub script_ms: f64,
    pub forced_layout_ms: f64,
    pub render_ms: f64,
    pub top_script: Option<String>,
    pub input: bool,
}

/// 프로파일러가 명령 처리에 필요한 최소 정보.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RequestMeta {
    pub op: String,
    pub window_id: Option<String>,
}

impl CoreRequest {
    /// 태그와 창 id만 읽는다. 나머지 값은 값 직렬화를 시작하지 않는다.
    pub fn meta(&self) -> RequestMeta {
        self.serialize(RequestMetaSerializer::default())
            .expect("request metadata serialization is infallible")
    }
}

#[derive(Default)]
struct RequestMetaSerializer {
    meta: RequestMeta,
    mode: MetaMode,
}

#[derive(Clone, Copy, Default)]
enum MetaMode {
    #[default]
    Root,
    Op,
    WindowId,
    MapKey,
}

struct MetaCompound {
    meta: RequestMeta,
    key: Option<String>,
}

fn metadata_value<T: ?Sized + Serialize>(key: &str, value: &T, meta: &mut RequestMeta) {
    let mode = match key {
        "op" => MetaMode::Op,
        "window_id" => MetaMode::WindowId,
        _ => return,
    };
    if let Ok(value_meta) = value.serialize(RequestMetaSerializer {
        meta: RequestMeta::default(),
        mode,
    }) {
        match key {
            "op" => meta.op = value_meta.op,
            "window_id" => meta.window_id = value_meta.window_id,
            _ => {}
        }
    }
}

#[derive(Debug)]
struct MetaSerializeError;

impl std::fmt::Display for MetaSerializeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("metadata serialization failed")
    }
}
impl std::error::Error for MetaSerializeError {}
impl ser::Error for MetaSerializeError {
    fn custom<T: std::fmt::Display>(_: T) -> Self {
        Self
    }
}

impl ser::Serializer for RequestMetaSerializer {
    type Ok = RequestMeta;
    type Error = MetaSerializeError;
    type SerializeSeq = MetaCompound;
    type SerializeTuple = MetaCompound;
    type SerializeTupleStruct = MetaCompound;
    type SerializeTupleVariant = MetaCompound;
    type SerializeMap = MetaCompound;
    type SerializeStruct = MetaCompound;
    type SerializeStructVariant = MetaCompound;
    fn serialize_bool(self, _: bool) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_i8(self, _: i8) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_i16(self, _: i16) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_i32(self, _: i32) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_i64(self, _: i64) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_i128(self, _: i128) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_u8(self, _: u8) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_u16(self, _: u16) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_u32(self, _: u32) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_u64(self, _: u64) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_u128(self, _: u128) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_f32(self, _: f32) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_f64(self, _: f64) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_char(self, _: char) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_str(mut self, value: &str) -> Result<Self::Ok, Self::Error> {
        match self.mode {
            MetaMode::Root => {}
            MetaMode::Op | MetaMode::MapKey => self.meta.op = value.into(),
            MetaMode::WindowId => self.meta.window_id = Some(value.into()),
        }
        Ok(self.meta)
    }
    fn serialize_bytes(self, _: &[u8]) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_none(self) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_some<T: ?Sized + Serialize>(self, value: &T) -> Result<Self::Ok, Self::Error> {
        value.serialize(self)
    }
    fn serialize_unit(self) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_unit_struct(self, _: &'static str) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
    fn serialize_unit_variant(
        mut self,
        _: &'static str,
        _: u32,
        variant: &'static str,
    ) -> Result<Self::Ok, Self::Error> {
        self.meta.op = variant.into();
        Ok(self.meta)
    }
    fn serialize_newtype_struct<T: ?Sized + Serialize>(
        self,
        _: &'static str,
        value: &T,
    ) -> Result<Self::Ok, Self::Error> {
        value.serialize(self)
    }
    fn serialize_newtype_variant<T: ?Sized + Serialize>(
        mut self,
        _: &'static str,
        _: u32,
        variant: &'static str,
        _: &T,
    ) -> Result<Self::Ok, Self::Error> {
        self.meta.op = variant.into();
        Ok(self.meta)
    }
    fn serialize_seq(self, _: Option<usize>) -> Result<Self::SerializeSeq, Self::Error> {
        Ok(MetaCompound {
            meta: self.meta,
            key: None,
        })
    }
    fn serialize_tuple(self, _: usize) -> Result<Self::SerializeTuple, Self::Error> {
        Ok(MetaCompound {
            meta: self.meta,
            key: None,
        })
    }
    fn serialize_tuple_struct(
        self,
        _: &'static str,
        _: usize,
    ) -> Result<Self::SerializeTupleStruct, Self::Error> {
        Ok(MetaCompound {
            meta: self.meta,
            key: None,
        })
    }
    fn serialize_tuple_variant(
        mut self,
        _: &'static str,
        _: u32,
        variant: &'static str,
        _: usize,
    ) -> Result<Self::SerializeTupleVariant, Self::Error> {
        self.meta.op = variant.into();
        Ok(MetaCompound {
            meta: self.meta,
            key: None,
        })
    }
    fn serialize_map(self, _: Option<usize>) -> Result<Self::SerializeMap, Self::Error> {
        Ok(MetaCompound {
            meta: self.meta,
            key: None,
        })
    }
    fn serialize_struct(
        self,
        _: &'static str,
        _: usize,
    ) -> Result<Self::SerializeStruct, Self::Error> {
        Ok(MetaCompound {
            meta: self.meta,
            key: None,
        })
    }
    fn serialize_struct_variant(
        mut self,
        _: &'static str,
        _: u32,
        variant: &'static str,
        _: usize,
    ) -> Result<Self::SerializeStructVariant, Self::Error> {
        self.meta.op = variant.into();
        Ok(MetaCompound {
            meta: self.meta,
            key: None,
        })
    }
}

impl SerializeMap for MetaCompound {
    type Ok = RequestMeta;
    type Error = MetaSerializeError;
    fn serialize_key<T: ?Sized + Serialize>(&mut self, key: &T) -> Result<(), Self::Error> {
        self.key = key
            .serialize(RequestMetaSerializer {
                meta: RequestMeta::default(),
                mode: MetaMode::MapKey,
            })
            .ok()
            .map(|meta| meta.op);
        Ok(())
    }
    fn serialize_value<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<(), Self::Error> {
        if let Some(key) = self.key.take() {
            metadata_value(&key, value, &mut self.meta);
        }
        Ok(())
    }
    fn serialize_entry<K: ?Sized + Serialize, V: ?Sized + Serialize>(
        &mut self,
        key: &K,
        value: &V,
    ) -> Result<(), Self::Error> {
        self.serialize_key(key)?;
        self.serialize_value(value)
    }
    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
}

impl SerializeStruct for MetaCompound {
    type Ok = RequestMeta;
    type Error = MetaSerializeError;
    fn serialize_field<T: ?Sized + Serialize>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Self::Error> {
        metadata_value(key, value, &mut self.meta);
        Ok(())
    }
    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
}
impl SerializeStructVariant for MetaCompound {
    type Ok = RequestMeta;
    type Error = MetaSerializeError;
    fn serialize_field<T: ?Sized + Serialize>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Self::Error> {
        metadata_value(key, value, &mut self.meta);
        Ok(())
    }
    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
}
impl SerializeSeq for MetaCompound {
    type Ok = RequestMeta;
    type Error = MetaSerializeError;
    fn serialize_element<T: ?Sized + Serialize>(&mut self, _: &T) -> Result<(), Self::Error> {
        Ok(())
    }
    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
}
impl SerializeTuple for MetaCompound {
    type Ok = RequestMeta;
    type Error = MetaSerializeError;
    fn serialize_element<T: ?Sized + Serialize>(&mut self, _: &T) -> Result<(), Self::Error> {
        Ok(())
    }
    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
}
impl SerializeTupleStruct for MetaCompound {
    type Ok = RequestMeta;
    type Error = MetaSerializeError;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, _: &T) -> Result<(), Self::Error> {
        Ok(())
    }
    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
}
impl SerializeTupleVariant for MetaCompound {
    type Ok = RequestMeta;
    type Error = MetaSerializeError;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, _: &T) -> Result<(), Self::Error> {
        Ok(())
    }
    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(self.meta)
    }
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
    /// 이미지, 동영상, 그림판, 웹 화면처럼 글로 옮길 수 없는 것이 보이는가. 참이면 `conversation.send` 때 모습을 찍는다.
    pub visual: bool,
    /// 이 창이 쉘 화면에서 온전히 보이지 않는가. 다른 창이나 오버레이와 겹치거나 최소화됐으면 참이다. 참인 창의
    /// 이미지는 `share.freeze`와 `share.capture`로 그 창만 드러낸 뒤 얻는다. 오래된 화면 호출의 JSON에는 이 필드가
    /// 없어도 된다.
    #[serde(default)]
    pub occluded: bool,
    /// 화면에서 직접 제공하는 PNG 이미지의 base64 표현.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image_base64: Option<String>,
    /// 창의 내용 영역(제목 줄 아래)이 쉘 화면(메인 웹뷰) 왼쪽 위 기준 어디에 있는가(CSS px). 모습을 찍을 때 쓴다.
    pub bounds: Rect,
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
    #[serde(rename = "shell.preferences.set_default")]
    ShellPreferencesSetDefault { preferences: preferences::AccountPreferences },
    #[serde(rename = "shell.preferences.answer")]
    ShellPreferencesAnswer { preferences: preferences::AccountPreferences },
    #[serde(rename = "client.http_read")]
    ClientHttpRead { bytes: Vec<u8>, mime: String },
    #[serde(rename = "client.blob_put")]
    ClientBlobPut {},
    #[serde(rename = "client.blob_open")]
    ClientBlobOpen { file: Option<client::ClientFile> },
    #[serde(rename = "client.blob_remove")]
    ClientBlobRemove {},
    #[serde(rename = "client.blob_list")]
    ClientBlobList { keys: Vec<String> },
    #[serde(rename = "files.save_prompt")]
    FilesSavePrompt { file_id: Option<String> },
    #[serde(rename = "state.get")]
    StateGet { snapshot: ShellSnapshot, #[ts(type = "number")] sequence: u64 },
    #[serde(rename = "profiler.report")]
    ProfilerReport {},
    #[serde(rename = "files.pick")]
    FilesPick {
        cancelled: bool,
        files: Vec<client::ClientFile>,
    },
    #[serde(rename = "export.begin")]
    ExportBegin {
        cancelled: bool,
        sink_id: Option<String>,
    },
    #[serde(rename = "export.truncate")]
    ExportTruncate {},
    #[serde(rename = "export.close")]
    ExportClose {},
    #[serde(rename = "export.abort")]
    ExportAbort {},
    #[serde(rename = "client.release")]
    ClientRelease {},
    #[serde(rename = "client.command")]
    ClientCommand {},

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
    #[serde(rename = "window.minimize")]
    WindowMinimize { window: AppWindow },
    #[serde(rename = "window.maximize")]
    WindowMaximize { window: AppWindow },
    #[serde(rename = "window.restore")]
    WindowRestore { window: AppWindow },
    #[serde(rename = "window.close")]
    WindowClose {},
    #[serde(rename = "window.set_state")]
    WindowSetState { window: AppWindow },
    #[serde(rename = "window.patch_state")]
    WindowPatchState { window: AppWindow },

    #[serde(rename = "app.import")]
    AppImport { app: App, version: AppVersion },

    #[serde(rename = "app.icon")]
    AppIcon { media: Option<data::MediaData> },

    #[serde(rename = "link.start")]
    LinkStart {
        user_code: String,
        expires_at: String,
    },
    #[serde(rename = "link.use_local")]
    LinkUseLocal {},
    #[serde(rename = "link.sync_local_to_remote")]
    LinkSyncLocalToRemote { result: transfer::TransferResult },
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
    #[serde(rename = "files.mkdir")]
    FilesMkdir { path: String },
    #[serde(rename = "files.rename")]
    FilesRename { from: String, to: String },
    #[serde(rename = "files.move")]
    FilesMove { results: Vec<FileOpResult> },
    #[serde(rename = "files.copy")]
    FilesCopy { results: Vec<FileOpResult> },
    #[serde(rename = "files.remove")]
    FilesRemove { results: Vec<FileOpResult> },
    #[serde(rename = "files.reveal")]
    FilesReveal {},
    #[serde(rename = "files.path")]
    FilesPath { text: String },
    #[serde(rename = "files.open")]
    FilesOpen { window: AppWindow },

    #[serde(rename = "web.attach")]
    WebAttach { page: WebPage },
    #[serde(rename = "web.place")]
    WebPlace {},
    #[serde(rename = "web.navigate")]
    WebNavigate {},
    #[serde(rename = "external.open")]
    ExternalOpen {},
    #[serde(rename = "web.history")]
    WebHistory {},
    #[serde(rename = "web.capture")]
    WebCapture {
        /// `data:image/png;base64,...`. 찍지 못하면 null.
        image: Option<String>,
    },
    #[serde(rename = "web.detach")]
    WebDetach {},

    #[serde(rename = "window.control.respond")]
    WindowControlRespond {},
    #[serde(rename = "window.control.capture")]
    WindowControlCapture {
        image_base64: String,
        geometry: WindowGeometry,
    },
    #[serde(rename = "web.control")]
    WebControl { result: WindowControlResult },

    #[serde(rename = "conversation.get")]
    ConversationGet {
        thread: Option<conversation::ConversationThread>,
        items: Vec<conversation::ConversationItem>,
        cursor: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        next_before: Option<String>,
        models: Vec<conversation::ConversationModel>,
        profiles: Vec<conversation::ConversationProfile>,
        start: conversation::ConversationStart,
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
    #[serde(rename = "conversation.switch")]
    ConversationSwitch {
        thread: conversation::ConversationThread,
        notices: Vec<String>,
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

    #[serde(rename = "connection.realtime.session")]
    RealtimeSession { session: String },
    #[serde(rename = "connection.realtime.open")]
    RealtimeOpen { handle: String, protocol: Option<String> },
    #[serde(rename = "connection.realtime.read")]
    RealtimeRead { item: Option<realtime::RealtimeItem> },
    #[serde(rename = "connection.realtime.ack")]
    RealtimeAck {},
    #[serde(rename = "connection.realtime.send")]
    RealtimeSend {},
    #[serde(rename = "connection.realtime.close")]
    RealtimeClose {},
    #[serde(rename = "connection.realtime.release")]
    RealtimeRelease {},
    #[serde(rename = "process.start")]
    ProcessStart { result: process::ProcessStartResult },
    #[serde(rename = "host.instructions")]
    HostInstructions { text: String, hash: String },
    #[serde(rename = "context.prepare")]
    ContextPrepare {
        text: Option<String>,
        images: Vec<client::ContextImage>,
        ticket: String,
    },
    #[serde(rename = "context.commit")]
    ContextCommit {},
    #[serde(rename = "app.respond_install_permission")]
    AppRespondInstallPermission {},
    #[serde(rename = "process.respond_permission")]
    ProcessRespondPermission {},
    #[serde(rename = "process.attach")]
    ProcessAttach {
        process: Option<process::ProcessSnapshot>,
    },
    #[serde(rename = "process.read")]
    ProcessRead {
        bytes: Vec<u8>,
        #[ts(type = "number")]
        next: u64,
        stderr_tail: Vec<u8>,
        exit: Option<process::ProcessExit>,
    },
    #[serde(rename = "process.ack")]
    ProcessAck {},
    #[serde(rename = "process.write")]
    ProcessWrite {},
    #[serde(rename = "process.close_input")]
    ProcessCloseInput {},
    #[serde(rename = "process.stop")]
    ProcessStop {},
    #[serde(rename = "process.file_uri")]
    ProcessFileUri { uri: String },

    #[serde(rename = "storage.get")]
    StorageGet {
        result: app_storage::StorageReadReply,
    },
    #[serde(rename = "storage.list")]
    StorageList {
        result: app_storage::CollectionListReply,
    },
    #[serde(rename = "storage.write")]
    StorageWrite { revision: String },
    #[serde(rename = "storage.reset")]
    StorageReset { revision: Option<String> },
    #[serde(rename = "storage.move")]
    StorageMove { revision: String },

    #[serde(rename = "data.attach")]
    DataAttach { view: data::DataView },
    #[serde(rename = "data.dormant")]
    DataDormant {},
    #[serde(rename = "data.detach")]
    DataDetach {},
    #[serde(rename = "data.act")]
    DataAct { #[ts(type = "number")] sequence: u64 },
    #[serde(rename = "data.refresh")]
    DataRefresh {},
    #[serde(rename = "data.more")]
    DataMore { started: bool },
    #[serde(rename = "data.media")]
    DataMedia { media: data::MediaData },
    #[serde(rename = "connection.login")]
    ConnectionLogin {},
    #[serde(rename = "share.set")]
    ShareSet {},
    #[serde(rename = "share.view")]
    ShareView {},
    #[serde(rename = "share.freeze")]
    ShareFreeze { frozen: bool },
    #[serde(rename = "share.capture")]
    ShareCapture { captured: bool },
    #[serde(rename = "share.unfreeze")]
    ShareUnfreeze {},
    /// 설치를 시작했지만 쉘이 스스로 끝나지 않는 플랫폼에서만 온다(Windows는 응답 전에 끝난다).
    #[serde(rename = "update.restart")]
    UpdateRestart {},
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
    #[serde(rename = "window.control")]
    WindowControl { request: WindowControlRequest },
    /// 공유 상태나 기기 상태, 연결 상태가 바뀌었다. 화면은 저장소를 이 snapshot으로 바꾼다.
    #[serde(rename = "state.changed")]
    StateChanged { snapshot: ShellSnapshot, #[ts(type = "number")] sequence: u64 },
    /// 파일 작업이 성공했다. root는 권한 grant의 절대 경로이며 changes는 grant 기준 상대 경로다.
    #[serde(rename = "files.changed")]
    FilesChanged {
        root: String,
        changes: Vec<FileChange>,
    },
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
    /// (모듈 `agent` 3판) 제공자 대화 이벤트.
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
    ConversationError { thread_id: String, error: CoreError },
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
    #[serde(rename = "app.install_permission")]
    AppInstallPermission { window_id: String, request_id: String, app_name: String, release: u32, store_url: String, digest: String, definition: AppDefinition },
    /// 쉘이 사용자에게 실행 허용을 묻는다.
    #[serde(rename = "process.permission")]
    ProcessPermission {
        window_id: String,
        request_id: String,
        spec: process::ProcessSpec,
        scope: process::ProcessGrantScope,
    },
    #[serde(rename = "connection.realtime.ready")]
    RealtimeReady { window_id: String, session: String, handle: String },
    #[serde(rename = "connection.realtime.closed")]
    RealtimeClosed { window_id: String, session: String, handle: String, code: u16, reason: String, error: Option<CoreError> },
    /// 프로세스 출력을 읽거나 종료를 확인할 수 있다.
    #[serde(rename = "process.ready")]
    ProcessReady { window_id: String, handle: String },
    #[serde(rename = "process.services_changed")]
    ProcessServicesChanged { window_id: String, handle: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct FileChange {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub to: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum FileOpResult {
    Ok { path: String, ok: FileChange },
    Error { path: String, error: CoreError },
}

/// 명령의 실패.
///
/// ```compile_fail
/// use kaleidoscope_contract::{CoreError, ErrorCode};
/// let _ = CoreError { id: None, code: ErrorCode::Server, message: String::new(), details: vec![] };
/// ```
///
/// ```compile_fail
/// use kaleidoscope_contract::{CoreError, ErrorCode};
/// let _ = CoreError::new(ErrorCode::Server);
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
#[non_exhaustive]
pub struct CoreError {
    /// 장소와 원인을 가리키는 에러코드. 등록부(`errors`)의 코드다. 옛 서버와 옛 쉘이 보낸 오류에는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    pub code: ErrorCode,
    /// 사람이 읽는 한국어 설명.
    pub message: String,
    /// 걸린 것이 여럿일 때 하나씩(앱 정의 검사 등). 없으면 빈 배열.
    #[serde(default)]
    pub details: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum ErrorCode {
    /// 명령 형식이 틀렸거나 지금 할 수 없는 명령(마지막 데스크톱 지우기, 선언되지 않은 상태 키 등).
    InvalidRequest,
    /// 요청에 필요한 인증 정보가 없거나 맞지 않는다.
    Unauthorized,
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
    /// 파일 이름을 만들거나 바꿀 수 없다.
    InvalidName,
    /// 다른 프로그램이 파일을 사용 중이다.
    FileBusy,
    /// 시스템 휴지통으로 보낼 수 없다.
    TrashUnavailable,
}

impl CoreError {
    pub(crate) fn registered(id: &str, code: ErrorCode, message: String) -> Self {
        Self {
            id: Some(id.to_string()),
            code,
            message,
            details: Vec::new(),
        }
    }

    pub fn and_details(mut self, details: Vec<String>) -> Self {
        self.details.extend(details);
        self
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

    #[test]
    fn generalized_block_names_accept_legacy_aliases_and_serialize_canonically() {
        let cases = [
            (
                r#"{"type":"keypad","columns":4,"buttons":[],"on_press":{"set_state":"press"}}"#,
                r#"{"type":"button_grid","columns":4,"buttons":[],"on_press":{"set_state":"press"}}"#,
            ),
            (
                r#"{"type":"file_tree","root":{"permission":"files"},"extensions":["md"],"selected":{"state":"file"},"on_select":{"set_state":"file"}}"#,
                r#"{"type":"tree","root":{"permission":"files"},"extensions":["md"],"by":"children","selected":{"state":"file"},"on_select":{"set_state":"file"}}"#,
            ),
            (
                r#"{"type":"tree","items":null}"#,
                r#"{"type":"tree","items":null,"by":"children"}"#,
            ),
            (
                r#"{"type":"markdown_editor","file":{"permission":"files","path":{"state":"path"}}}"#,
                r#"{"type":"markdown","file":{"permission":"files","path":{"state":"path"}}}"#,
            ),
            (
                r#"{"type":"markdown_view","value":{"state":"body"}}"#,
                r#"{"type":"markdown","value":{"state":"body"},"read_only":true}"#,
            ),
            (
                r#"{"type":"code_editor","file":{"permission":"files","path":{"state":"path"}}}"#,
                r#"{"type":"code","file":{"permission":"files","path":{"state":"path"}}}"#,
            ),
            (
                r#"{"type":"code_editor","file":{"permission":"files","path":{"state":"path"}},"wrap":false}"#,
                r#"{"type":"code","file":{"permission":"files","path":{"state":"path"}},"wrap":false}"#,
            ),
            (
                r#"{"type":"code","value":{"state":"body"}}"#,
                r#"{"type":"code","value":{"state":"body"}}"#,
            ),
            (
                r#"{"type":"code","value":{"state":"body"},"wrap":false}"#,
                r#"{"type":"code","value":{"state":"body"},"wrap":false}"#,
            ),
            (
                r#"{"type":"code_editor","file":{"permission":"files","path":{"state":"path"}},"wrap":true}"#,
                r#"{"type":"code","file":{"permission":"files","path":{"state":"path"}},"wrap":true}"#,
            ),
            (
                r#"{"type":"code_view","value":{"state":"body"},"follow":true}"#,
                r#"{"type":"code","value":{"state":"body"},"read_only":true,"follow":true}"#,
            ),
            (r#"{"type":"agent_chat"}"#, r#"{"type":"chat"}"#),
            (
                r#"{"type":"html_view","value":{"state":"html"}}"#,
                r#"{"type":"html_view","value":{"state":"html"}}"#,
            ),
        ];

        for (legacy, canonical) in cases {
            let block: Block = serde_json::from_str(legacy).expect("블록 별칭 역직렬화");
            let actual = serde_json::to_value(block).expect("정본 블록 직렬화");
            assert_eq!(
                actual,
                serde_json::from_str::<serde_json::Value>(canonical).unwrap()
            );
        }
    }

    #[test]
    fn generalized_tree_keeps_null_binding_and_independent_folder_state_keys() {
        let null_tree = r#"{"id":"empty-tree","name":"빈 트리","requires":{"blocks":4,"modules":{}},"permissions":[],"state":{},"ui":{"type":"tree","items":null}}"#;
        validate::parse_app_definition(null_tree).expect("null은 빈 데이터 트리 바인딩");

        let folder_tree = r#"{"id":"legacy-tree","name":"옛 파일 트리","requires":{"blocks":1,"modules":{"files":1}},"permissions":[{"module":"files","id":"docs","access":"read","label":"문서"}],"state":{"selected":null,"opened":null},"ui":{"type":"file_tree","root":{"permission":"docs"},"selected":{"state":"selected"},"on_select":{"set_state":"opened"}}}"#;
        validate::parse_app_definition(folder_tree)
            .expect("옛 파일 트리는 선택 키와 쓰기 키가 달라도 유효");
    }

    #[test]
    fn folder_contract_keeps_legacy_tree_wire_and_uses_block_set_thirteen() {
        assert!(
            serde_json::from_value::<FolderRoot>(
                serde_json::json!({"permission":"docs","entry":"documents"})
            )
            .is_err(),
            "파일 권한과 저장소 뿌리를 한 값에 함께 두면 거부한다",
        );

        let legacy_file_tree: Block = serde_json::from_str(
            r#"{"type":"file_tree","root":{"permission":"docs"},"extensions":["md"],"selected":{"state":"selected"},"on_select":{"set_state":"selected"}}"#,
        )
        .expect("옛 file_tree 역직렬화");
        assert_eq!(legacy_file_tree.introduced_in(), 1);
        assert_eq!(
            serde_json::to_value(&legacy_file_tree).unwrap(),
            serde_json::json!({
                "type":"tree",
                "root":{"permission":"docs"},
                "extensions":["md"],
                "by":"children",
                "selected":{"state":"selected"},
                "on_select":{"set_state":"selected"}
            })
        );

        let legacy_tree_root: Block = serde_json::from_str(
            r#"{"type":"tree","root":{"permission":"docs"},"extensions":["md"],"selected":{"state":"selected"},"on_select":{"set_state":"selected"}}"#,
        )
        .expect("옛 tree.root 역직렬화");
        assert_eq!(legacy_tree_root.introduced_in(), 1);
        assert_eq!(legacy_tree_root, legacy_file_tree);

        let data_tree: Block =
            serde_json::from_str(r#"{"type":"tree","items":{"state":"items"},"by":"children"}"#)
                .expect("데이터 tree 역직렬화");
        assert_eq!(data_tree.introduced_in(), 4);
        assert_eq!(data_tree.type_name(), "tree");

        let folder: Block = serde_json::from_value(serde_json::json!({
            "type":"folder",
            "root":{"permission":"docs"},
            "extensions":["md"],
            "selected":{"state":"selected"},
            "on_select":{"set_state":"selected"},
            "read_only":true
        }))
        .expect("새 folder 역직렬화");
        assert_eq!(folder.introduced_in(), 13);
        assert_eq!(folder.type_name(), "folder");
        assert!(data::child_blocks(&folder, "/ui").is_empty());
    }

    #[test]
    fn folder_requires_declared_file_permission_or_storage_collection_and_block_set_thirteen() {
        let definition = |blocks: u32, root: serde_json::Value, pc: bool| {
            let value = serde_json::json!({
                "id":"folder-test",
                "name":"Folder test",
                "requires":{"blocks":blocks,"modules":{"files":1,"storage":3}},
                "permissions":[
                    {"module":"files","id":"docs","access":"read","label":"문서","scope":if pc {"pc"} else {"folder"}}
                ],
                "storage":{"entries":[
                    {"id":"documents","key":"documents","collection":true,"kind":"md","default":"","label":"문서","presentation":"hidden"}
                ]},
                "state":{"selected":null},
                "ui":{"type":"folder","root":root,"selected":{"state":"selected"},"on_select":{"set_state":"selected"},"read_only":true}
            });
            serde_json::to_string(&value).unwrap()
        };

        let file_root = serde_json::json!({"permission":"docs"});
        assert!(validate::parse_app_definition(&definition(12, file_root.clone(), false)).is_err());
        let file_app = validate::parse_app_definition(&definition(13, file_root.clone(), false))
            .expect("blocks 13 파일 뿌리");
        assert_eq!(file_app.ui.introduced_in(), 13);
        assert!(data::ui_actions(&file_app)
            .iter()
            .any(|(pointer, _)| pointer == "/ui/on_select"));

        let docs_root = serde_json::json!({"entry":"documents"});
        let docs_app = validate::parse_app_definition(&definition(13, docs_root, false))
            .expect("blocks 13 문서 모음 뿌리");
        assert_eq!(docs_app.ui.type_name(), "folder");
        assert!(validate::parse_app_definition(&definition(13, file_root, true)).is_err());
        assert!(validate::parse_app_definition(&definition(
            13,
            serde_json::json!({"entry":"missing"}),
            false
        ))
        .is_err());
        let not_collection = definition(13, serde_json::json!({"entry":"documents"}), false)
            .replace("\"collection\":true", "\"collection\":false");
        assert!(validate::parse_app_definition(&not_collection).is_err());

        let mut old_shell = Supported::current();
        old_shell.blocks = 12;
        assert!(!old_shell.renders(&file_app.requires));
        assert!(Supported::current().renders(&file_app.requires));
    }

    #[test]
    fn folder_schema_hides_legacy_tree_root_from_public_block_contract() {
        fn find_variant<'a>(
            value: &'a serde_json::Value,
            name: &str,
        ) -> Option<&'a serde_json::Value> {
            if value
                .get("properties")
                .and_then(|properties| properties.get("type"))
                .and_then(|type_schema| type_schema.get("const"))
                .and_then(serde_json::Value::as_str)
                == Some(name)
            {
                return Some(value);
            }
            match value {
                serde_json::Value::Object(object) => {
                    object.values().find_map(|child| find_variant(child, name))
                }
                serde_json::Value::Array(array) => {
                    array.iter().find_map(|child| find_variant(child, name))
                }
                _ => None,
            }
        }

        let schema = app_definition_schema();
        let tree = find_variant(&schema, "tree").expect("tree schema variant");
        assert!(tree["properties"].get("root").is_none());
        assert!(find_variant(&schema, "folder").is_some());

        let typescript = include_str!("../../../ui/src/contract/contract.ts");
        let tree = typescript
            .split("{ \"type\": \"tree\", items?: Binding,")
            .nth(1)
            .expect("생성된 TypeScript tree variant");
        let tree = tree.split("} | ").next().expect("tree variant 끝");
        assert!(
            !tree.contains("root"),
            "공개 TypeScript tree에서 root를 숨긴다"
        );
        assert!(typescript.contains("{ \"type\": \"folder\", root: FolderRoot"));
    }

    #[test]
    fn html_view_accepts_document_collections_and_checks_references() {
        let raw = r#"{"id":"review","name":"Review","requires":{"blocks":6,"modules":{"storage":3}},"permissions":[],"state":{"selected":null},"storage":{"entries":[{"id":"drafts","key":"drafts","kind":"md","label":"Drafts","presentation":"hidden","collection":true,"default":""}]},"ui":{"type":"html_view","document":{"entry":"drafts"},"selected_doc":{"state":"selected"}}}"#;
        let definition = validate::parse_app_definition(raw).expect("HTML 보기 정의");
        assert_eq!(definition.ui.introduced_in(), 6);
        let entry = &definition.storage.as_ref().unwrap().entries[0];
        assert!(
            app_storage::validate_storage_content(entry, &serde_json::json!("<p>one</p>")).is_ok()
        );
        assert!(validate::parse_app_definition(
            &raw.replace("\"entry\":\"drafts\"", "\"entry\":\"missing\"")
        )
        .is_err());
        assert!(
            validate::parse_app_definition(&raw.replace("\"storage\":3", "\"storage\":1")).is_err()
        );
        assert!(validate::parse_app_definition(
            &raw.replace("\"collection\":true", "\"collection\":false")
        )
        .is_err());
        assert!(
            validate::parse_app_definition(&raw.replace("\"blocks\":6", "\"blocks\":5")).is_err()
        );
    }

    fn example(name: &str) -> String {
        if name == "md-viewer.json" {
            return include_str!("../fixtures/md-viewer.json").to_string();
        }
        let directory = if [
            "explorer.json",
            "md-editor.json",
            "md-viewer.json",
            "web-browser.json",
        ]
        .contains(&name)
        {
            "apps"
        } else {
            "examples"
        };
        let path = format!(
            "{}/../../{}/{}",
            env!("CARGO_MANIFEST_DIR"),
            directory,
            name
        );
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
            migrate_window_state(&definition, &BTreeMap::new())
                .get("source")
                .and_then(JsonValue::as_f64),
            Some(0.0)
        );
    }

    #[test]
    fn migrate_window_state_encodes_url_components() {
        let mut definition: AppDefinition = serde_json::from_str(&example("md-editor.json")).unwrap();
        definition.state_migrate.insert("source".into(), "$encodeUrlComponent('tweet-2117_a.b~c')".into());
        assert_eq!(migrate_window_state(&definition, &BTreeMap::new()).get("source"), Some(&serde_json::json!("tweet-2117_a.b~c")));
    }

    #[test]
    fn new_definition_fields_require_block_set_fifteen() {
        let base = serde_json::json!({
            "id":"version-gate", "name":"판 검사", "requires":{"blocks":14,"modules":{"files":3}},
            "permissions":[{"module":"files","id":"docs","access":"readwrite","label":"문서"}],
            "state":{"path":null,"mode":0}, "ui":{"type":"text","value":"내용"}
        });
        let tabs = serde_json::json!({"type":"tabs","tabs":[{"label":"내용","child":{"type":"text","value":"내용"}}]});
        let mut cases = Vec::new();
        for field in ["header", "keep_mounted", "collapsible"] {
            let mut app = base.clone();
            app["ui"] = tabs.clone();
            app["ui"][field] = serde_json::json!(false);
            cases.push((field, app));
        }
        let mut folder = base.clone();
        folder["ui"] =
            serde_json::json!({"type":"folder","root":{"permission":"docs"},"header":false});
        cases.push(("folder.header", folder));
        let mut migration = base.clone();
        migration["state_migrate"] = serde_json::json!({"mode":"0"});
        cases.push(("state_migrate", migration));
        let mut opens = base.clone();
        opens["opens"] = serde_json::json!({"extensions":["md"],"permission":"docs","state":"path","set_state":{"mode":1}});
        cases.push(("opens.set_state", opens));
        for (field, mut app) in cases {
            assert!(
                validate::parse_app_definition(&app.to_string()).is_err(),
                "14판은 {field}를 모른다"
            );
            app["requires"]["blocks"] = serde_json::json!(15);
            assert!(
                validate::parse_app_definition(&app.to_string()).is_ok(),
                "15판은 {field}를 지원한다"
            );
        }
        let mut section = base;
        section["ui"] = serde_json::json!({"type":"section","title":"구역","collapsible":true,"child":{"type":"text","value":"내용"}});
        assert!(validate::parse_app_definition(&section.to_string()).is_ok());
    }

    #[test]
    fn folder_header_and_collapsible_tabs_are_explicit_v15_options() {
        let mut app = serde_json::json!({
            "id": "folder-tabs-options", "name": "옵션 검사",
            "requires": { "blocks": 15, "modules": { "files": 1 } },
            "permissions": [{ "module": "files", "id": "docs", "access": "read", "label": "문서" }],
            "state": {},
            "ui": { "type": "tabs", "collapsible": true, "tabs": [
                { "label": "문서", "child": { "type": "folder", "root": { "permission": "docs" }, "header": false } }
            ] }
        });
        let definition = validate::parse_app_definition(&app.to_string()).unwrap();
        let encoded = serde_json::to_value(&definition).unwrap();
        assert_eq!(encoded["ui"]["collapsible"], true);
        assert_eq!(encoded["ui"]["tabs"][0]["child"]["header"], false);

        app["ui"]["collapsible"] = serde_json::json!(false);
        app["ui"]["tabs"][0]["child"]["header"] = serde_json::json!(true);
        let defaults = validate::parse_app_definition(&app.to_string()).unwrap();
        let encoded = serde_json::to_value(defaults).unwrap();
        assert!(encoded["ui"].get("collapsible").is_none());
        assert!(encoded["ui"]["tabs"][0]["child"].get("header").is_none());

        app["requires"]["blocks"] = serde_json::json!(14);
        assert!(validate::parse_app_definition(&app.to_string()).is_err());
        app["ui"]["tabs"][0]["child"] = serde_json::json!({ "type": "text", "value": "내용" });
        assert!(validate::parse_app_definition(&app.to_string()).is_err());
        app["requires"]["blocks"] = serde_json::json!(15);
        app["ui"]["collapsible"] = serde_json::json!(true);
        app["ui"]["header"] = serde_json::json!(false);
        assert!(validate::parse_app_definition(&app.to_string()).is_err());
    }

    #[test]
    fn u6_definition_fields_parse_and_migrate_new_window_state() {
        let definition = serde_json::json!({
            "id": "u6-editor",
            "name": "U6 편집기",
            "requires": { "blocks": 15, "modules": { "files": 3, "storage": 3 } },
            "permissions": [{ "module": "files", "id": "docs", "access": "readwrite", "label": "문서 폴더" }],
            "state": { "source": 0, "current_file": null, "current_document": null },
            "state_migrate": { "source": "$state.current_file != null ? 1 : 0" },
            "opens": { "extensions": ["md"], "permission": "docs", "state": "current_file", "set_state": { "source": 1 } },
            "ui": {
                "type": "tabs", "header": false, "keep_mounted": true,
                "selected": { "state": "source" }, "on_change": { "set_state": "source" },
                "tabs": [
                    { "label": "서버", "child": { "type": "text", "value": "서버" } },
                    { "label": "내 폴더", "child": { "type": "text", "value": "내 폴더" } }
                ]
            }
        });
        let definition = validate::parse_app_definition(&definition.to_string())
            .expect("U6 필드를 사용하는 정의는 유효하다");
        assert!(CONTRACT_VERSION >= 33);
        let Block::Tabs {
            header,
            keep_mounted,
            ..
        } = &definition.ui
        else {
            panic!("tabs 블록이어야 한다");
        };
        assert!(!header);
        assert!(*keep_mounted);

        let old = BTreeMap::from([("current_file".to_string(), serde_json::json!("a.md"))]);
        let migrated = migrate_window_state(&definition, &old);
        assert_eq!(
            migrated.get("source").and_then(JsonValue::as_f64),
            Some(1.0)
        );
        assert_eq!(
            migrated.get("current_file"),
            Some(&serde_json::json!("a.md"))
        );

        let user_selected_server = BTreeMap::from([
            ("source".to_string(), serde_json::json!(0)),
            ("current_file".to_string(), serde_json::json!("a.md")),
        ]);
        assert_eq!(
            migrate_window_state(&definition, &user_selected_server).get("source"),
            Some(&serde_json::json!(0))
        );
        assert_eq!(
            migrate_window_state(&definition, &BTreeMap::new())
                .get("source")
                .and_then(JsonValue::as_f64),
            Some(0.0)
        );

        let mut independent_migrations = definition.clone();
        independent_migrations
            .state
            .insert("first".into(), serde_json::json!(0));
        independent_migrations
            .state
            .insert("second".into(), serde_json::json!(0));
        independent_migrations.state_migrate = BTreeMap::from([
            ("first".into(), "1".into()),
            ("second".into(), "$state.first".into()),
        ]);
        let independent = migrate_window_state(&independent_migrations, &BTreeMap::new());
        assert_eq!(
            independent.get("first").and_then(JsonValue::as_f64),
            Some(1.0)
        );
        assert_eq!(
            independent.get("second").and_then(JsonValue::as_f64),
            Some(0.0)
        );

        let mut failed_migration = definition.clone();
        failed_migration
            .state_migrate
            .insert("source".into(), "$unknown_function()".into());
        assert_eq!(
            migrate_window_state(&failed_migration, &BTreeMap::new()).get("source"),
            Some(&serde_json::json!(0))
        );

        let encoded = serde_json::to_value(&definition).unwrap();
        assert_eq!(
            encoded["opens"]["set_state"]["source"],
            serde_json::json!(1)
        );
        assert_eq!(encoded["ui"]["header"], serde_json::json!(false));
        assert_eq!(encoded["ui"]["keep_mounted"], serde_json::json!(true));
    }

    #[test]
    fn u6_validation_checks_only_migration_syntax_and_declared_state_keys() {
        let base = serde_json::json!({
            "id": "u6-validation", "name": "검사",
            "requires": { "blocks": 15, "modules": { "files": 3 } },
            "permissions": [{ "module": "files", "id": "docs", "access": "readwrite", "label": "문서" }],
            "state": { "source": 0, "current_file": null },
            "state_migrate": { "source": "$state.current_file != null ? 1 : 0" },
            "opens": { "extensions": ["md"], "permission": "docs", "state": "current_file", "set_state": { "source": 1 } },
            "ui": { "type": "text", "value": "시험" }
        });
        assert!(validate::parse_app_definition(&base.to_string()).is_ok());

        let mut invalid_migration_key = base.clone();
        invalid_migration_key["state_migrate"] =
            serde_json::json!({ "missing": "$state.current_file" });
        assert!(validate::parse_app_definition(&invalid_migration_key.to_string()).is_err());

        let mut invalid_expression = base.clone();
        invalid_expression["state_migrate"] =
            serde_json::json!({ "source": "$state.current_file ?" });
        assert!(validate::parse_app_definition(&invalid_expression.to_string()).is_err());

        let mut undeclared_open_state = base.clone();
        undeclared_open_state["opens"]["set_state"] = serde_json::json!({ "missing": true });
        assert!(validate::parse_app_definition(&undeclared_open_state.to_string()).is_err());

        let mut overlapping_open_state = base.clone();
        overlapping_open_state["opens"]["set_state"] =
            serde_json::json!({ "current_file": "a.md" });
        assert!(validate::parse_app_definition(&overlapping_open_state.to_string()).is_err());

        let mut old_tabs = base;
        old_tabs["ui"] = serde_json::json!({
            "type": "tabs", "tabs": [
                { "label": "옛 탭", "child": { "type": "text", "value": "내용" } }
            ]
        });
        old_tabs["requires"]["blocks"] = serde_json::json!(4);
        old_tabs.as_object_mut().unwrap().remove("state_migrate");
        old_tabs.as_object_mut().unwrap().remove("opens");
        let legacy: AppDefinition = serde_json::from_value(old_tabs.clone()).unwrap();
        let encoded_legacy = serde_json::to_value(legacy).unwrap();
        assert!(encoded_legacy["ui"].get("header").is_none());
        assert!(encoded_legacy["ui"].get("keep_mounted").is_none());
        assert_eq!(encoded_legacy["ui"]["tabs"][0]["label"], "옛 탭");

        let mut explicit_defaults = old_tabs.clone();
        explicit_defaults["requires"]["blocks"] = serde_json::json!(15);
        explicit_defaults["ui"]["header"] = serde_json::json!(true);
        explicit_defaults["ui"]["keep_mounted"] = serde_json::json!(false);
        let explicit_defaults: AppDefinition =
            validate::parse_app_definition(&explicit_defaults.to_string()).unwrap();
        let encoded_defaults = serde_json::to_value(explicit_defaults).unwrap();
        assert!(encoded_defaults["ui"].get("header").is_none());
        assert!(encoded_defaults["ui"].get("keep_mounted").is_none());

        let mut new_tab_fields_on_old_set = serde_json::json!({
            "id": "old-tabs", "name": "옛 탭",
            "requires": { "blocks": 14 }, "state": {},
            "ui": { "type": "tabs", "header": false,
                "tabs": [{ "label": "탭", "child": { "type": "text", "value": "내용" } }] }
        });
        assert!(validate::parse_app_definition(&new_tab_fields_on_old_set.to_string()).is_err());
        new_tab_fields_on_old_set["requires"]["blocks"] = serde_json::json!(15);
        assert!(validate::parse_app_definition(&new_tab_fields_on_old_set.to_string()).is_ok());
        new_tab_fields_on_old_set["requires"]["blocks"] = serde_json::json!(14);
        new_tab_fields_on_old_set["ui"]["header"] = serde_json::json!(true);
        new_tab_fields_on_old_set["ui"]["keep_mounted"] = serde_json::json!(true);
        assert!(validate::parse_app_definition(&new_tab_fields_on_old_set.to_string()).is_err());
    }

    #[test]
    fn u6_state_migration_and_open_state_require_block_set_15() {
        let mut definition = serde_json::json!({
            "id": "u6-state-version", "name": "상태 판 검사",
            "requires": { "blocks": 14, "modules": { "files": 3 } },
            "permissions": [{ "module": "files", "id": "docs", "access": "readwrite", "label": "문서" }],
            "state": { "source": 0, "current_file": null },
            "ui": { "type": "text", "value": "시험" }
        });

        definition["state_migrate"] =
            serde_json::json!({ "source": "$state.current_file != null ? 1 : 0" });
        assert!(validate::parse_app_definition(&definition.to_string()).is_err());
        definition["requires"]["blocks"] = serde_json::json!(15);
        assert!(validate::parse_app_definition(&definition.to_string()).is_ok());

        definition.as_object_mut().unwrap().remove("state_migrate");
        definition["requires"]["blocks"] = serde_json::json!(14);
        definition["opens"] = serde_json::json!({
            "extensions": ["md"], "permission": "docs", "state": "current_file",
            "set_state": { "source": 1 }
        });
        assert!(validate::parse_app_definition(&definition.to_string()).is_err());
        definition["requires"]["blocks"] = serde_json::json!(15);
        assert!(validate::parse_app_definition(&definition.to_string()).is_ok());
    }

    #[test]
    fn legacy_chat_is_cached_but_new_upload_is_rejected() {
        let legacy = include_str!("../tests/legacy-workspace-pas.json");
        assert!(validate::parse_cached_app_definition(legacy).is_ok());
        let error = validate::parse_app_definition(legacy).unwrap_err();
        assert!(error
            .details
            .iter()
            .any(|detail| detail.contains("대화 제공자")));
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
        assert_eq!(
            serde_json::from_str::<CoreRequest>(r#"{"op":"share.freeze"}"#).unwrap(),
            CoreRequest::ShareFreeze {}
        );
        assert_eq!(
            serde_json::from_str::<CoreRequest>(r#"{"op":"share.capture","window_id":"w1"}"#)
                .unwrap(),
            CoreRequest::ShareCapture {
                window_id: "w1".into()
            }
        );
        assert_eq!(
            serde_json::from_str::<CoreRequest>(r#"{"op":"share.unfreeze"}"#).unwrap(),
            CoreRequest::ShareUnfreeze {}
        );
        assert_eq!(
            serde_json::to_string(&CoreReply::ShareFreeze { frozen: true }).unwrap(),
            r#"{"op":"share.freeze","frozen":true}"#
        );
        assert!(SHARE_TEXT_CUT_MARK.len() < SHARE_TEXT_MAX_BYTES);
    }

    #[test]
    fn visible_view_occlusion_defaults_for_existing_clients() {
        let view: VisibleView = serde_json::from_str(
            r#"{"text":"view","visual":false,"bounds":{"x":0,"y":0,"width":1,"height":1}}"#,
        )
        .unwrap();
        assert!(!view.occluded);
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
             export const CONVERSATION_MESSAGE_MAX_CHARS = {};\n\
             /** JSON 저장 항목 하나의 최대 바이트 수. */\n\
             export const STORAGE_JSON_MAX_BYTES = {};\n\
             /** Markdown 저장 항목 하나의 최대 UTF-8 바이트 수. */\n\
             export const STORAGE_MD_MAX_BYTES = {};\n\
             /** 저장소 명령 HTTP 본문의 최대 바이트 수. */\n\
             export const STORAGE_COMMAND_BODY_MAX_BYTES = {};\n\
             /** 클라이언트 출력 하나의 최대 UTF-8 바이트 수. */\n\
             export const CLIENT_OUTPUT_MAX_BYTES = {};\n\
             /** 클라이언트가 고른 파일 하나의 최대 바이트 수. */\n\
             export const CLIENT_PICK_FILE_MAX_BYTES = {};\n\
             /** 클라이언트 프레임 응답을 기다리는 최대 초. */\n\
             export const CLIENT_PING_TIMEOUT_SECS = {};\n\
             /** (9판) 같이 보기 글 하나의 최대 바이트 수(UTF-8). */\n\
             export const SHARE_TEXT_MAX_BYTES = {};\n\
             /** (9판) 잘린 같이 보기 글의 마지막 줄. */\n\
             export const SHARE_TEXT_CUT_MARK = {:?};\n\
             /** (9판) 같이 보기 창이 바뀐 뒤 글을 다시 옮기기까지 기다리는 시간(ms). */\n\
             export const SHARE_DEBOUNCE_MS = {};\n\
             /** 쉘에 기본 탑재되는 앱 ID 목록. */\n\
             export const BUILTIN_APP_IDS = [{}] as const;\n\
             /** 기본 메시지 수신 앱으로 표시된 기본 앱 ID 목록. */\n\
             export const BUILTIN_DEFAULT_MESSAGE_APP_IDS = [{}] as const;\n\
             /** 단추 아이콘으로 쓸 수 있는 Lucide 아이콘 이름(블록 세트 4판). */\n\
             export const ICON_NAMES = [{}] as const;\n\
             export type IconName = (typeof ICON_NAMES)[number];\n",
            AGENT_ATTACHMENTS_MAX,
            AGENT_ATTACHMENT_MAX_BYTES,
            AGENT_ATTACHMENTS_TOTAL_MAX_BYTES,
            CONVERSATION_MESSAGE_MAX_CHARS,
            app_storage::STORAGE_JSON_MAX_BYTES,
            app_storage::STORAGE_MD_MAX_BYTES,
            app_storage::STORAGE_COMMAND_BODY_MAX_BYTES,
            client::CLIENT_OUTPUT_MAX_BYTES,
            client::CLIENT_PICK_FILE_MAX_BYTES,
            client::CLIENT_PING_TIMEOUT_SECS,
            SHARE_TEXT_MAX_BYTES,
            SHARE_TEXT_CUT_MARK,
            SHARE_DEBOUNCE_MS,
            builtin::BUILTIN_IDENTITIES.iter().map(|app| format!("\"{}\"", app.id)).collect::<Vec<_>>().join(", "),
            builtin::BUILTIN_IDENTITIES.iter().filter(|app| app.default_message_receiver).map(|app| format!("\"{}\"", app.id)).collect::<Vec<_>>().join(", "),
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
    fn request_meta_reports_variant_tags_and_window_without_serializing_payloads() {
        let request = CoreRequest::WindowSetState {
            window_id: "window-7".into(),
            state: BTreeMap::from([("large".into(), JsonValue::String("payload".into()))]),
        };
        assert_eq!(request.meta().op, "window.set_state");
        assert_eq!(request.meta().window_id.as_deref(), Some("window-7"));

        let request = CoreRequest::WindowPatchState {
            window_id: "window-8".into(),
            patch: BTreeMap::from([("large".into(), JsonValue::String("payload".into()))]),
        };
        assert_eq!(request.meta().op, "window.patch_state");
        assert_eq!(request.meta().window_id.as_deref(), Some("window-8"));

        let request = CoreRequest::ConversationAttachment {
            window_id: "chat-2".into(),
            item_id: "item-1".into(),
            attachment_id: "attachment-1".into(),
        };
        assert_eq!(request.meta().op, "conversation.attachment");
        assert_eq!(request.meta().window_id.as_deref(), Some("chat-2"));

        let request = CoreRequest::StateGet {};
        assert_eq!(request.meta().op, "state.get");
        assert_eq!(request.meta().window_id, None);
    }

    #[test]
    fn window_minimize_maximize_restore_round_trip_and_legacy_defaults() {
        for (op, request) in [
            (
                "window.minimize",
                CoreRequest::WindowMinimize {
                    window_id: "w".into(),
                },
            ),
            (
                "window.maximize",
                CoreRequest::WindowMaximize {
                    window_id: "w".into(),
                },
            ),
            (
                "window.restore",
                CoreRequest::WindowRestore {
                    window_id: "w".into(),
                },
            ),
        ] {
            let json = serde_json::to_value(&request).unwrap();
            assert_eq!(json["op"], op);
            assert_eq!(
                serde_json::from_value::<CoreRequest>(json).unwrap(),
                request
            );
        }

        let legacy: AppWindow = serde_json::from_value(serde_json::json!({
            "id":"w", "desktop_id":"d", "app_id":"a", "app_version":1,
            "rect":{"x":0,"y":0,"width":10,"height":10}, "z":0,
            "state":{}, "created_at":"created", "updated_at":"updated"
        }))
        .unwrap();
        assert!(!legacy.minimized && !legacy.maximized);
        let replies = [
            (
                "window.minimize",
                CoreReply::WindowMinimize {
                    window: AppWindow {
                        minimized: true,
                        ..legacy.clone()
                    },
                },
            ),
            (
                "window.maximize",
                CoreReply::WindowMaximize {
                    window: AppWindow {
                        maximized: true,
                        ..legacy.clone()
                    },
                },
            ),
            (
                "window.restore",
                CoreReply::WindowRestore {
                    window: legacy.clone(),
                },
            ),
        ];
        for (op, reply) in replies {
            let json = serde_json::to_value(&reply).unwrap();
            assert_eq!(json["op"], op);
            assert!(
                json["window"].get("minimized").is_none() || json["window"]["minimized"] == true
            );
            assert!(
                json["window"].get("maximized").is_none() || json["window"]["maximized"] == true
            );
            assert_eq!(serde_json::from_value::<CoreReply>(json).unwrap(), reply);
        }
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
            "tree",
            "markdown",
            "chat",
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
            "code",
            "image",
            "media",
            "html_view",
            "button_grid",
            "metrics",
            "chart",
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

    fn without_icon_at_block_set(json: &str, blocks: u32) -> serde_json::Value {
        let mut definition: serde_json::Value = serde_json::from_str(json).unwrap();
        let object = definition.as_object_mut().unwrap();
        object.remove("icon");
        object.remove("assets");
        definition["requires"]["modules"].as_object_mut().unwrap().remove("assets");
        definition["requires"]["blocks"] = serde_json::json!(blocks);
        definition
    }

    #[test]
    fn web_view_rules() {
        let browser = example("web-browser.json");
        rejected(&browser.replace(r#""web": 1"#, r#""files": 1"#), "web 모듈");
        rejected(
            &without_icon_at_block_set(&browser, 2).to_string(),
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
        let mut insufficient_blocks = without_icon_at_block_set(&editor, 1);
        insufficient_blocks["ui"] = serde_json::json!({"type":"text","value":"시험"});
        rejected(&insufficient_blocks.to_string(), "opens는 블록 세트 3판");
        rejected(
            &editor.replace(r#""extensions": ["md"]"#, r#""extensions": [".MD"]"#),
            "소문자와 숫자",
        );
        rejected(
            &editor.replace(r#""extensions": ["md"]"#, r#""extensions": []"#),
            "하나 이상",
        );
        let mut undeclared_permission: serde_json::Value = serde_json::from_str(&editor).unwrap();
        undeclared_permission["opens"]["permission"] = serde_json::json!("notes");
        rejected(&undeclared_permission.to_string(), "선언되지 않은 권한");
        let mut undeclared_state: serde_json::Value = serde_json::from_str(&editor).unwrap();
        undeclared_state["opens"]["state"] = serde_json::json!("open_file");
        rejected(&undeclared_state.to_string(), "선언되지 않은 상태 키");
    }

    #[test]
    fn blocks_need_their_block_set() {
        let pas = include_str!("../tests/legacy-workspace-pas.json")
            .replace(r#""blocks": 2"#, r#""blocks": 1"#);
        rejected(&pas, "블록 세트 2판");
        let explorer = without_icon_at_block_set(&example("explorer.json"), 2).to_string();
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
            &without_icon_at_block_set(&five, 4).to_string(),
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
        let pas = validate::parse_cached_app_definition(include_str!(
            "../tests/legacy-workspace-pas.json"
        ))
        .unwrap();
        assert!(browser.requires.blocks > LEGACY_BLOCK_SET_VERSION);
        assert!(pas.requires.blocks <= LEGACY_BLOCK_SET_VERSION);
        assert!(current.renders(&browser.requires));
        assert!(current.renders(&pas.requires));
        let unknown_module = Requires {
            blocks: 1,
            modules: [("shay".to_string(), 1)].into_iter().collect(),
        };
        assert!(!current.renders(&unknown_module));
        let decoded: Supported =
            serde_json::from_str(&serde_json::to_string(&current).unwrap()).unwrap();
        assert_eq!(decoded, current);
        assert_eq!(current.assets.len(), builtin::BUNDLED_ASSET_KEYS.len());
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

    /// 내 PC 범위의 탐색기(계약 14판). 구현이 들어오면 apps/explorer.json이 이 모양이 된다.
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
        rejected(tree, "folder 범위");
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
            serde_json::to_value(errors::WEB_REQUEST_HOST_UNAVAILABLE()).unwrap()["code"],
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
            &example("card-board.json").replace(r#""blocks": 4"#, r#""blocks": 3"#),
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
        assert!(data::data_refs("$lookup($data, 'optional_source').items").is_empty());
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
    fn source_pipeline_validation() {
        let ui = r#"{"type":"text","value":"x"}"#;
        let chain = r#", "sources": {
          "c":{"kind":"request","permission":"board","path":{"expr":"'/c/' & $data.b.id"}},
          "b":{"kind":"request","permission":"board","path":{"expr":"'/b/' & $data.a.id"}},
          "a":{"kind":"request","permission":"board","path":"/a"}}"#;
        validate::parse_app_definition(&with_ui(ui, chain)).unwrap();
        rejected(
            &with_ui(
                ui,
                r#", "sources":{"a":{"kind":"request","permission":"board","path":"/a"},"b":{"kind":"request","permission":"board","path":{"expr":"'/b/' & $data.a.id & $lookup($data, 'a').id"}}}"#,
            ),
            "다른 원천은 $data.이름 꼴로만",
        );
        rejected(
            &with_ui(
                ui,
                r#", "sources":{"a":{"kind":"request","permission":"board","path":"/a"},"b":{"kind":"request","permission":"board","path":{"expr":"'/b/' & $data.a.id & $data['a'].id"}}}"#,
            ),
            "다른 원천은 $data.이름 꼴로만",
        );
        for sources in [
            r#", "sources":{"a":{"kind":"request","permission":"board","path":{"expr":"'/a/' & $data.a.id"}}}"#,
            r#", "sources":{"a":{"kind":"request","permission":"board","path":{"expr":"'/a/' & $data.b.id"}},"b":{"kind":"request","permission":"board","path":{"expr":"'/b/' & $data.a.id"}}}"#,
            r#", "sources":{"a":{"kind":"request","permission":"board","path":{"expr":"'/a/' & $data.b.id"}},"b":{"kind":"request","permission":"board","path":{"expr":"'/b/' & $data.c.id"}},"c":{"kind":"request","permission":"board","path":{"expr":"'/c/' & $data.a.id"}}}"#,
        ] {
            rejected(&with_ui(ui, sources), "원천 참조가 순환합니다");
        }
        rejected(
            &with_ui(
                ui,
                r#", "sources":{"a":{"kind":"request","permission":"board","path":{"expr":"'/a/' & $data.missing.id"}}}"#,
            ),
            "없는 원천",
        );
        for variable in ["$event", "$item", "$data_meta"] {
            let sources = format!(
                r#", "sources":{{"a":{{"kind":"request","permission":"board","path":{{"expr":"'/a/' & {variable}"}}}}}}"#
            );
            rejected(
                &with_ui(ui, &sources),
                "원천의 값 자리 식은 $state, $storage, $data만",
            );
        }
        rejected(
            &with_ui(
                ui,
                r#", "sources":{"a":{"kind":"request","permission":"board","path":{"expr":"'/a/' & $data"}}}"#,
            ),
            "다른 원천은 $data.이름 꼴로만",
        );
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
            "없는 원천",
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
                item: JsonValue::Null,
                modifiers: None,
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
                source_meta: BTreeMap::new(),
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
                            value: JsonValue::String("가".into()), more: None
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
        let err = errors::FILE_ACCESS_ROOT_CHANGED("docs");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "path_outside_root");
    }

    #[test]
    fn legacy_core_error_without_id_deserializes_and_omits_id_when_serialized() {
        let error: CoreError = serde_json::from_value(serde_json::json!({
            "code": "path_outside_root",
            "message": "고른 폴더 밖 경로입니다",
            "details": []
        }))
        .unwrap();

        assert_eq!(error.id, None);
        assert!(!serde_json::to_value(error)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("id"));
    }
}
