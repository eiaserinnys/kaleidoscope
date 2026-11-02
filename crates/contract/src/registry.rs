//! 코어와 오케스트레이터 사이 HTTP 약속 (레지스트리 9판, 261030)
//!
//! 4판에서 더한 것(카드 #806): 코어가 이벤트 스트림을 열 때 지원 범위를 알리고([`SUPPORTED_HEADER`]),
//! 서버는 그 기기가 그릴 수 있는 앱만 보낸다. 아래 「기기마다 그릴 수 있는 앱만」 절.
//!
//! 5판에서 더한 것(카드 #809): 이름 붙인 연결(모듈 `connection` 1판). 연결 목록 이벤트 `connections.snapshot`,
//! 서버가 대신 부르는 `relay` 연결의 중계 경로, 기기 로그인 `oauth` 연결의 코어 쪽 절차, 배치 보고의 식 오류.
//! 아래 「연결」 절.
//!
//! 6판에서 더한 것(카드 #780): 연결한 쉘의 워크스페이스, 데스크톱, 앱 창을 서버가 정본으로 들고 기기 사이에 맞춘다.
//! 코어가 [`REGISTRY_HEADER`]로 레지스트리 판을 알리고, 바뀐 것 올리기(`POST /api/device/layout/changes`), 이벤트
//! `layout.snapshot`과 `layout.changed`, 에이전트의 띄우기를 기기 하나에만 보내는 규칙, 작업과 PAS의 이름과 수명 맞추기.
//! 아래 「작업과 배치 동기화」 절.
//!
//! 7판에서 더한 것(카드 #814): 창 같이 보기. 코어가 같이 보기 창에 보이는 글을 올리고 지우는 경로
//! (`PUT`/`DELETE /api/device/shares/{window_id}`)와 MCP `get_shared_view`. 아래 「같이 보기」 절.
//!
//! 8판에서 더한 것(카드 #818): 계정 × 앱 저장소의 기기 경로와 `storage.snapshot`/`storage.changed` 이벤트.
//! 계정은 서버가 기기 토큰이나 MCP principal에서 찾으며 기기 요청 본문은 account id를 받지 않는다.
//! 연결 등록도 계정마다 이뤄진다. 아래 「앱 저장소」 절.
//!
//! 9판: 기본 앱은 쉘과 함께 제공한다. 레지스트리 앱을 지우면 `app.deleted`를 보내고,
//! 재연결 스냅샷의 `deleted`에 지운 앱 id를 담는다. 기본 앱은 올리거나 지울 수 없다.
//!
//! 오케스트레이터는 앱 레지스트리의 정본이다. 쉘의 코어는 기기 토큰으로 붙어 앱을 받고, 에이전트는 같은
//! 서버의 MCP(`/mcp`, MCP 토큰)로 앱을 올린다. MCP 도구의 모양은 오케스트레이터 코드에 있고 이 파일에는 없다.
//! 이 파일의 타입은 화면에 가지 않으므로 TS로 만들지 않는다.
//! `/mcp`는 MCP 전역 토큰 또는 기기 토큰을 받는다. 기기 토큰 요청에 `workspace_id`가 빠지면 서버는
//! [`WORKSPACE_HEADER`]의 작업 id를 기본값으로 사용한다.
//!
//! # 주소와 인증
//! 코어의 `server_url`(끝에 `/` 없음, 예: `https://server.example`) 뒤에 아래 경로를 붙인다.
//!
//! | 메서드와 경로 | 인증 | 요청 본문 | 성공 | 실패 |
//! |---|---|---|---|---|
//! | `POST /api/pair/start` | 없음 | [`PairStartRequest`] | 200 [`PairStartReply`] | 429 승인 대기 중인 연결이 너무 많음 |
//! | `POST /api/pair/poll` | 없음(`device_code`가 비밀) | [`PairPollRequest`] | 200 [`PairPollReply`] | 404 없거나 만료됨 |
//! | `GET /api/device/events` | `Authorization: Bearer <기기 토큰>`, [`SUPPORTED_HEADER`] | 없음 | 200 `text/event-stream` | 401 토큰 거부 |
//! | `POST /api/device/apps` | 같음 | [`DeviceUploadRequest`] | 200 [`RegistryApp`] | 400 검사 실패, 401 |
//! | `PUT /api/device/layout` | 같음 | [`DeviceLayout`] | 200 `{}` | 400 형식, 401 |
//! | `POST /api/device/layout/changes` | 같음 | [`LayoutChanges`] | 200 [`LayoutChanges`] | 400 형식이나 창 상태가 너무 큼, 401, 413 |
//! | `GET /api/device/app-storage/{app_id}/items?workspace_id=...` | 같음 | 없음 | 200 [`crate::app_storage::StorageListReply`] | 400 선언되지 않은 항목이나 workspace, 401, 404 |
//! | `GET /api/device/app-storage/{app_id}/items/{entry_id}?workspace_id=...` | 같음 | 없음 | 200 [`crate::app_storage::StorageReadReply`] | 400 선언되지 않은 항목이나 workspace, 401, 404 |
//! | `PUT /api/device/app-storage/{app_id}/items/{entry_id}?workspace_id=...` | 같음 | [`crate::app_storage::StorageWriteRequest`] | 200 [`crate::app_storage::StorageWriteReply`] | 400 값 검사, 401, 404, 409 현재 revision, 413 |
//! | `DELETE /api/device/app-storage/{app_id}/items/{entry_id}?workspace_id=...` | 같음 | [`crate::app_storage::StorageResetRequest`] | 200 [`crate::app_storage::StorageResetReply`] | 400 형식, 401, 404, 409 현재 revision |
//! | `GET /api/device/app-storage/{app_id}/collections/{entry_id}?workspace_id=...` | 같음 | 없음 | 200 [`crate::app_storage::CollectionListReply`] | 400 선언된 모음이나 workspace가 아님, 401, 404 |
//! | `GET`/`PUT`/`DELETE /api/device/app-storage/{app_id}/collections/{entry_id}/document?workspace_id=...&doc=...` | 같음 | 쓰기와 삭제는 기존 저장 요청 | 200 읽기/쓰기/삭제 응답 | 400 형식, 401, 404, 409 현재 revision |
//! | `POST /api/device/app-storage/{app_id}/collections/{entry_id}/move?workspace_id=...` | 같음 | [`crate::app_storage::CollectionMove`] | 200 [`crate::app_storage::CollectionMoveReply`] | 400 형식, 401, 404, 409 revision 또는 대상 충돌 |
//! | `GET /api/device/app-values/{app_id}?prefix=...&workspace_id=...` | 같음 | 없음 | 200 [`crate::app_storage::CollectionListReply`] | 400 선언된 기본 앱 모음이 아님, 401, 404 |
//! | `GET`/`PUT`/`DELETE /api/device/app-values/{app_id}/{key}` | 같음 | 쓰기와 삭제는 기존 저장 요청 | 200 읽기/쓰기/삭제 응답 | 400 형식, 401, 404, 409 현재 revision |
//! | `POST /api/device/app-values/{app_id}` | 같음 | [`crate::app_storage::AppValueMoveRequest`] | 200 [`crate::app_storage::CollectionMoveReply`] | 400 형식, 401, 404, 409 revision 또는 대상 충돌 |
//! | `PUT /api/device/shares/{window_id}` | 같음 | [`ShareUpload`] | 200 `{}` | 400 글이 너무 김이나 형식, 401 |
//! | `DELETE /api/device/shares/{window_id}` | 같음 | 없음 | 200 `{}`(없어도) | 401 |
//! | `POST /api/device/connections/{name}/request` | 같음 | [`ConnectionRequest`] | 200 [`ConnectionReply`] | 400 경로나 메서드, 401, 403 앱이 선언하지 않음이나 쓰기 불가, 404 없는 연결, 413 너무 큼, 502 원천에 닿지 못함, 504 시간 초과 |
//! | `GET /api/health` | 없음 | 없음 | 200 `{"ok":true}` | |
//!
//! 실패 본문은 모두 [`CoreError`] JSON이다. 검사 실패(400)는 [`crate::validate::parse_app_definition`]의 오류
//! 그대로이고(`invalid_app_definition`, `unsupported_app`), 401, 404, 429와 서버 오류는 code `server`에 한국어 설명이다.
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
//! - 스냅샷에 없는 캐시 앱은 그대로 둔다. `deleted`와 `app.deleted`의 앱은 캐시에서 지운다.
//!   쉘에 실린 기본 앱은 서버가 보낸 같은 id의 정의와 삭제를 무시한다.
//! - 받은 정의도 [`crate::validate::parse_cached_app_definition`]로 다시 검사한다. 이 쉘이 그릴 수 없는 정의
//!   (`unsupported_app` 등)는 캐시에 넣지 않고 넘긴다(더 새 쉘이 필요한 앱).
//! - `app.published`의 `open`이 참이거나 `app.open`을 받으면, 반영한 `state.changed` 뒤에 화면에
//!   `app.open_requested`를 보낸다. 캐시에 없는 앱의 `app.open`은 넘긴다.
//! - 이벤트에 `workspace_id`가 있으면 그 값을 `app.open_requested`에 그대로 싣는다. 이 기기에 없는
//!   워크스페이스면 띄우기 요청을 넘긴다(앱 캐시 반영은 그대로 한다). 서버는 `workspace_id`가 있는 띄우기와
//!   그 워크스페이스를 마지막 배치 보고에 담은 기기에만 보내고, 다른 기기에는 `app.published`를
//!   `open: false`, `workspace_id` 없이 보내 캐시만 맞춘다. 배치 보고를 모르는 옛 쉘에 엉뚱한 창이 뜨지 않게 하려는 것이다.
//! - 6판: 배치를 동기화하는 기기들 사이에서는 띄우기를 기기 하나에만 보낸다(「작업과 배치 동기화」의 「띄우기 대상」).
//!   창이 동기화되므로 여러 기기가 같은 띄우기를 받으면 같은 창이 기기 수만큼 생기기 때문이다.
//!
//! # 기기마다 그릴 수 있는 앱만
//! 옛 쉘은 이벤트 줄 하나를 통째로 타입에 맞춰 읽으므로, 모르는 블록을 쓴 앱이 하나라도 `apps.snapshot`에
//! 있으면 그 줄 전체를 버려 연결이 맞춰지지 않는다. 그래서 서버가 기기마다 거른다.
//! - 코어는 `GET /api/device/events`에 [`SUPPORTED_HEADER`] 헤더로 자기 [`crate::Supported`]를 JSON 한 줄로
//!   보낸다(예: `{"blocks":3,"modules":{"agent":2,"files":1,"web":1}}`).
//! - 서버는 그 연결에 보내는 `apps.snapshot`에서 그 기기가 그릴 수 없는 앱을 빼고, 그런 앱의 `app.published`와
//!   `app.open`은 그 연결에 보내지 않는다. 그릴 수 있는지는 헤더가 있으면 [`crate::Supported::renders`]다.
//!   헤더가 없거나 읽을 수 없으면 옛 쉘로 보고 `requires.blocks`가 [`crate::LEGACY_BLOCK_SET_VERSION`] 이하인지만
//!   본다. 옛 쉘이 줄 전체를 버리는 것은 모르는 블록과 필드 때문이고, 모르는 모듈이나 더 높은 모듈 판은 옛 쉘도
//!   스스로 그 앱만 넘기기 때문이다.
//! - 서버는 기기마다 마지막으로 알린 지원 범위를 기억해 두고, MCP의 앱 올리기와 띄우기 결과에 「이 앱을 그릴
//!   수 없는 쉘이라 받지 못한 연결된 기기」를 적는다. 에이전트가 디렉터에게 쉘을 새로 깔라고 말할 수 있게.
//! - 코어도 스트림 줄을 읽을 때 앱 정의를 앱마다 따로 읽고 검사해, 그릴 수 없는 앱 하나 때문에 이벤트 전체를
//!   버리지 않는다(그 앱만 넘긴다). 서버가 거르지 못한 경우를 위한 것이다.
//!
//! # 배치 보고
//! 에이전트가 「지금 펼친 데스크톱에 어떤 창이 무엇을 보고 있는지」를 MCP로 읽을 수 있게, 연결한 코어는
//! 자기 워크스페이스, 데스크톱, 창 배치를 서버에 알린다. 6판에서 배치를 동기화하는 기기도 같은 보고를 그대로 보낸다.
//! 서버는 그 보고에서 기기마다 다른 것(지금 보는 워크스페이스와 데스크톱, 고른 폴더 이름, 식 오류)과 기기의 마지막
//! 활동 시각만 쓰고, 워크스페이스, 데스크톱, 창의 정본은 「작업과 배치 동기화」의 저장소다. 동기화하지 않는 옛 쉘의
//! 보고는 그 쉘의 배치로만 남고 정본에 들어가지 않는다.
//! - 코어는 `connected`가 될 때마다 한 번, 그 뒤로는 [`DeviceLayout`]에 담길 값이 바뀔 때마다 보낸다.
//!   바뀐 뒤 [`LAYOUT_DEBOUNCE_MS`] 동안 더 바뀌지 않으면 보내고, 마지막으로 보낸 것과 같으면 보내지 않는다.
//!   실패하면 연결이 이어져 있는 동안 [`LAYOUT_RETRY_SECS`] 뒤에 다시 보낸다.
//! - 서버는 기기마다 마지막 보고 하나를 통째로 바꿔 둔다.
//! - 고른 폴더의 절대 경로는 보내지 않는다. 폴더 이름만 보낸다(`root_name`).
//!
//! # 작업과 배치 동기화 (6판)
//! 연결한 쉘의 워크스페이스, 데스크톱, 앱 창([`crate::Workspace`], [`crate::Desktop`], [`crate::AppWindow`])은 서버가
//! 정본이다. 기기마다 다른 것(지금 보는 워크스페이스와 데스크톱, 고른 폴더, 로그인)은 기기에만 둔다.
//!
//! 동기화하는 기기: 코어가 `GET /api/device/events`에 [`REGISTRY_HEADER`]로 [`LAYOUT_SYNC_REGISTRY_VERSION`] 이상을 보낸 연결이다.
//! 헤더가 없으면 옛 쉘로 보고 이 절의 이벤트를 보내지 않으며, 띄우기는 위 5판까지의 규칙대로 보낸다.
//!
//! 서버가 지키는 것:
//! - 저장: 워크스페이스, 데스크톱, 창을 계약 타입 모양 그대로 둔다. 데스크톱의 워크스페이스와 창의 데스크톱은 있어야 한다.
//!   목록은 만든 시각(`created_at`), id 순으로 준다. 창의 앱이 레지스트리에 있는지는 보지 않는다.
//! - 이벤트: 동기화하는 연결에는 `apps.snapshot`(과 `connections.snapshot`) 바로 뒤에 [`DeviceEvent::LayoutSnapshot`]을
//!   보낸다. 그 뒤로 정본이 바뀌면 바뀐 것만 [`DeviceEvent::LayoutChanged`]로 모든 동기화하는 연결에 보낸다. 바꾼
//!   기기에도 보낸다. 구독을 먼저 걸고 스냅샷을 만들므로 겹쳐 온 것은 코어가 같은 값으로 넘긴다.
//! - 바뀐 것 받기(`POST /api/device/layout/changes`, 본문 한도 [`LAYOUT_CHANGES_BODY_MAX_BYTES`]): 한 트랜잭션에서
//!   1. 워크스페이스 upsert(엔티티 통째로 바꾼다. 충돌은 서버에 늦게 도착한 쪽이 이긴다),
//!   2. 데스크톱 upsert(워크스페이스가 없으면 저장하지 않는다),
//!   3. 창 upsert(데스크톱이 없으면 저장하지 않는다. 창 상태가 [`crate::WINDOW_STATE_MAX_BYTES`]를 넘으면 요청 전체를 400
//!      `invalid_request`로 거부한다),
//!   4. 창 지우기, 데스크톱 지우기(그 창도), 워크스페이스 지우기(그 데스크톱과 창도) 순서로 한다. 없는 id를 지워도 된다.
//!      한 요청에 같은 id의 upsert와 지우기가 함께 있으면 지우기가 이긴다. 지우면 서버에 워크스페이스가 하나도 남지
//!      않는 워크스페이스 지우기는 하지 않는다.
//! - 응답은 요청에 나온 모든 id와 함께 지워진 것의 결과다. 있으면 upsert 목록에 지금 모습으로, 없으면 지운 목록에
//!   담는다. 저장하지 않은 upsert는 지운 목록에, 하지 않은 워크스페이스 지우기는 그 워크스페이스와 데스크톱, 창을
//!   지금 모습으로 담는다. 같은 내용 가운데 실제로 바뀐 것만 `layout.changed`로 보낸다.
//! - 이 기기의 마지막 활동 시각은 그 기기가 바뀐 것을 올린 시각, 또는 배치 보고에서 그 기기만의 것(지금 보는
//!   워크스페이스와 데스크톱, 고른 폴더)이 이전 보고와 달라진 시각이다(아래 「띄우기 대상」). 다른 기기의 변경을
//!   반영한 쉘도 배치를 다시 보고하므로 보고 자체는 활동으로 치지 않는다. 첫 보고는 활동이다.
//! - MCP로 작업을 지울 때도 위 규칙을 따르고 `layout.changed`로 알린다.
//! - 앱의 새 버전을 저장하면 그 앱의 창을 [`crate::migrate_window_state`]로 옮기고 `app_version`을 바꿔 `app.published`
//!   뒤에 `layout.changed`로 알린다. 그 버전을 그릴 수 없어 `app.published`를 받지 못한 기기는 코어의 맞추기 규칙대로
//!   제 캐시의 버전으로 옮겨 그린다.
//! - 정본을 처음 만들 때(저장소 판 올림) 지우지 않은 기기의 마지막 배치 보고로 채우고, 지운 기기의 배치 보고는 지운다.
//!   그 뒤에도 기기를 지우면(MCP 기기 연결 끊기) 그 기기의 배치 보고를 지운다. 작업 조회는 지운 기기의 보고를 읽지 않는다.
//!   한 엔티티가 여러 보고에 있으면 늦은 보고의 것을 쓴다.
//!
//! 띄우기 대상:
//! - 에이전트가 `workspace_id`를 주고 띄우면 서버 정본에 그 워크스페이스가 있어야 하고, 연결된 동기화하는 기기 가운데
//!   마지막 활동 시각이 가장 늦은 기기 하나가 대상이다(디렉터가 지금 앞에 앉은 기기). `workspace_id`가 없을 때도 같다.
//! - 대상 기기에는 `app.published`를 `open: true`로(또는 `app.open`을), 다른 동기화하는 기기에는 `app.published`를
//!   `open: false`, `workspace_id` 없이 보낸다(`app.open`은 보내지 않는다). 대상 기기의 쉘이 창을 열면 그 창이 동기화된다.
//! - MCP의 올리기와 띄우기 결과에 띄우기를 보낸 기기 이름을 적는다.
//!
//! 코어가 지키는 것:
//! - 동기화는 `link.json`이 있을 때(연결했을 때) 한다. 연결하지 않은 쉘은 코어가 정본이다.
//! - 미전송 목록: 이 기기에서 명령으로 바꾼(만들기, 바꾸기, 지우기) 워크스페이스, 데스크톱, 창의 id를 서버가 받을 때까지
//!   들고 있고, 앱 데이터 폴더의 `sync.json`에 기기 id와 함께 둔다(기기 id가 다르면 없는 것으로 본다). 웹 화면이 이동해 창 상태의 주소가 바뀐 것도 넣는다.
//!   단 서버에서 받은 주소로 그 웹 화면 창의 주소가 바뀐 뒤 10초 안의 이동(리디렉트)은 넣지 않는다(두 기기의 리디렉트가 갈려 주소가 오가지 않게).
//!   서버 이벤트를 반영한 것과 앱의 새 버전으로 창을 옮긴 것은 넣지 않는다.
//! - 올리기: 이 연결의 `layout.snapshot`을 반영한 뒤부터, 미전송 목록이 있으면 각 id의 지금 모습(있으면 upsert, 없으면
//!   지우기)을 [`LayoutChanges`] 하나로 보낸다. 끊긴 동안 바꾼 것도 다시 이으면 이렇게 올라간다. 200이면 보낸 뒤로 다시
//!   바뀌지 않은 id를 목록에서 빼고 응답을 서버 이벤트처럼 반영한다. 실패하면 연결이 이어져 있는 동안
//!   [`LAYOUT_RETRY_SECS`] 뒤에 다시 보낸다. 401은 토큰 거부다. 400이면 보낸 id를 목록에서 빼고 로그를 남긴다.
//! - 반영: `layout.snapshot`은 정본 전체로 바꾸고, `layout.changed`와 올리기 응답은 담긴 id만 바꾼다. 어느 쪽이든
//!   미전송 목록에 있는 id는 이 기기의 것을 그대로 둔다. 반영 뒤에 맞춘다.
//!   - 워크스페이스가 없는 데스크톱, 데스크톱이 없는 창은 지운다(미전송 목록에서도 뺀다).
//!   - 창의 `app_version`이 캐시의 그 앱 지금 버전과 다르면 [`crate::migrate_window_state`]로 옮긴다(올리지 않는다).
//!     캐시에 없는 앱의 창은 그대로 둔다.
//!   - 기기 상태: 지금 보는 워크스페이스가 없으면 첫 워크스페이스로, 지운 워크스페이스와 데스크톱을 가리키는 마지막 본
//!     데스크톱은 빼고, 지운 창의 고른 폴더는 지운다.
//!   - 목록의 자리: 스냅샷은 서버 순서를 따르고, 바뀐 것은 이미 있는 id면 제자리에서 바꾸고 새 id면 뒤에 붙인다.
//! - 처음 맞추기: 이 연결 정보(`link.json`의 기기 id)로 처음 받은 `layout.snapshot`을 반영하기 전에, 이 기기의
//!   워크스페이스, 데스크톱, 창을 모두 미전송 목록에 넣는다. 그래서 서버에 같은 id가 있어도 이 기기 것이 이긴다(옛 쉘로
//!   쓰는 동안 바꾼 배치가 서버의 옛 사본에 덮이지 않게). 단 스냅샷에 워크스페이스가 하나라도 있으면, 창이 하나도 없는
//!   이 기기의 워크스페이스는 그 데스크톱과 함께 이 기기에서 지우고 올리지 않는다(서버에 같은 id가 있으면 서버 것을
//!   받는다). 새 쉘이 만든 빈 「작업 1」이 모든 기기에 퍼지지 않게 하려는 것이다. 맞춘 것은 `sync.json`에 적는다.
//! - 전부터 보내던 배치 보고(`PUT /api/device/layout`)는 그대로 보낸다.
//!
//! # 같이 보기 (7판)
//! 디렉터가 창의 「같이 보기」를 켜 두면 그 창에 보이는 글이 작업 PAS에 가는 말과 함께 간다(계약 9판 「같이 보기」 절).
//! 서버는 보이는 글을 메모리에만 둔다(저장소 판을 바꾸지 않는다). 서버가 다시 켜지면 잊고, 코어가 다시 이을 때 올린다.
//!
//! 코어가 지키는 것:
//! - `share.view`로 받은 글이나 `visual`이 그 창에 대해 서버에 마지막으로 올린 것과 다르면 `PUT .../shares/{window_id}`로
//!   올린다. 창의 워크스페이스와 앱 이름을 함께 싣는다.
//! - `share.set` 끄기, 창이 없어짐, `link.unlink`이면 `DELETE .../shares/{window_id}`를 보낸다(연결되어 있을 때).
//! - 이벤트 스트림이 이어질 때마다(`connected`가 될 때마다) 같이 보기 중인 모든 창의 마지막 글을 다시 올린다.
//!   끊긴 동안 끈 창은 이때 지운다. 서버가 끊긴 기기의 보기를 지웠을 수 있으므로 같은 글이어도 다시 올린다.
//!
//! 서버가 지키는 것:
//! - 보기는 (기기, 창)마다 하나다. `PUT`은 통째로 바꾸고 받은 시각을 적는다. `DELETE`는 없어도 200이다.
//!   [`crate::SHARE_TEXT_MAX_BYTES`]를 넘는 글은 400 `invalid_request`다.
//! - 기기의 이벤트 스트림이 하나도 남지 않으면 그 기기의 보기를 모두 지운다(쉘을 끄면 같이 보기도 끝난다).
//! - 같은 창을 여러 기기가 같이 보면(창이 동기화되므로 있을 수 있다) 그 창은 가장 늦게 받은 보기 하나로 본다.
//! - 워크스페이스마다 「PAS에 보낸 것」을 창 id별 글로 메모리에 둔다.
//! - MCP `get_shared_view`(입력 `workspace_id`): 그 워크스페이스의 지금 보기를 창마다(창 id, 앱 이름, 기기 이름, 받은 시각,
//!   `visual`, 글 전체) 돌려준다. 「PAS에 보낸 것」은 바꾸지 않는다. 없으면 같이 보는 창이 없다고 알린다.
//!
//! # 연결 (5판, 모듈 `connection` 1판)
//! 앱이 외부 서비스의 데이터를 받는 길이다. 연결 정의(이름, 종류, 주소, 인증)는 서버에 있고 에이전트가 MCP로 등록한다
//! (`set_connection`, `list_connections`, `delete_connection`). 쉘과 서버의 코드에는 서비스 이름이 나오지 않는다.
//! 앱 정의는 `connection` 권한으로 연결 이름만 가리킨다.
//!
//! 연결 정의(서버가 지키는 것):
//! - `name`: 소문자, 숫자, `-` 1~64자. `kind`: `relay`나 `oauth`. `base_url`: `https://`(로컬 시험은 `http://`)
//!   주소이고 끝의 `/`는 뗀다. 요청 주소는 `base_url` 뒤에 경로를 붙인 것이다.
//! - `writable`: 거짓이면 GET만 보낸다(기본 거짓). `paths`: 비어 있지 않으면 경로가 그 가운데 하나로 시작해야 한다.
//! - `relay`의 `headers`: 서버가 요청마다 붙이는 헤더. `${env:` 참조는 거부한다. 값은
//!   쓰기만 하고 MCP 조회에는 헤더 이름만 보인다.
//! - `oauth`의 `issuer`(없으면 `base_url`의 origin), `scopes`(공백으로 나눈 목록, 선택), `resource`(RFC 8707, 선택).
//!   비밀은 없다.
//! - 등록 소유자는 계정이다. 같은 계정 안에서 연결 이름은 하나만 쓴다.
//!
//! 연결 목록:
//! - 서버는 이벤트 스트림의 `apps.snapshot` 바로 뒤에 [`DeviceEvent::ConnectionsSnapshot`]을 보내고, 연결이 바뀔 때마다
//!   다시 보낸다. 지원 범위에 `connection` 모듈이 없는 기기(옛 쉘)에는 보내지 않는다.
//! - [`ConnectionInfo`]에는 비밀이 없다. 코어는 마지막 목록을 들고 있고(파일에 두지 않는다), 목록에 없는 연결을
//!   가리키는 원천은 실패(「서버에 없는 연결입니다」)다.
//!
//! 경로 규칙(코어와 서버 모두): [`crate::validate::valid_request_path`]를 지키고, 연결의 `paths`가 있으면 그 가운데
//! 하나로 시작한다. 쿼리는 키 순서대로 붙이고 값은 퍼센트 인코딩한다.
//!
//! `relay`(서버가 대신 부른다):
//! - 코어는 `POST /api/device/connections/{name}/request`에 [`ConnectionRequest`]를 보낸다.
//! - 서버가 보는 것: 연결이 있고 `relay`다(아니면 404, `oauth`면 400). 요청한 `app_id`의 지금 버전이 그 연결을 가리키는
//!   `connection` 권한을 선언했다(아니면 403). GET이 아니면 그 권한이 `readwrite`이고 연결이 `writable`이다(아니면 403).
//!   경로 규칙(아니면 400).
//! - 서버는 연결의 헤더를 붙여 보낸다. 리다이렉트는 따라가지 않는다. 응답 본문이 `accept`의 한도(`json`과 `text`는
//!   [`crate::data::SOURCE_MAX_BYTES`], `bytes`는 [`crate::data::MEDIA_MAX_BYTES`])를 넘으면 413이고,
//!   [`crate::data::CONNECTION_TIMEOUT_SECS`] 안에 끝나지 않으면 504다. 서버는 응답을 저장하지 않는다.
//! - 원천의 응답 상태가 무엇이든 받았으면 200 [`ConnectionReply`]로 돌려준다(2xx인지는 코어가 본다).
//!
//! `oauth`(이 기기가 로그인해 원천에 직접 부른다. 회사 데이터가 서버를 지나지 않는다):
//! - 로그인 정보(client_id, 등록한 루프백 포트, 액세스 토큰, 리프레시 토큰, 만료 시각)는 연결마다 이 기기의
//!   `logins.json`에만 둔다. 서버와 화면에 보내지 않는다.
//! - 로그인(`connection.login`): `issuer`의 RFC 8414 메타데이터(`/.well-known/oauth-authorization-server`)를 읽는다.
//!   client_id가 없거나, 등록한 포트를 지금 열 수 없거나, 그 client_id가 거부되면(만료 포함) 127.0.0.1의 빈 포트를
//!   열고 RFC 7591 동적 등록(`redirect_uris: ["http://127.0.0.1:<포트>/callback"]`, `token_endpoint_auth_method: none`,
//!   `grant_types: ["authorization_code", "refresh_token"]`, `client_name: "kaleidoscope (<기기 이름>)"`)으로 다시 받는다.
//!   있으면 등록한 포트를 다시 연다. PKCE(S256)와 `state`를 붙여 기본 브라우저로 인가 쪽을 열고(RFC 8252), 루프백으로
//!   돌아온 code를 토큰으로 바꾼다. 루프백 쪽은 「로그인했습니다. 이 창을 닫아도 됩니다.」 한 줄을 보인다.
//! - 요청: `Authorization: Bearer <액세스 토큰>`을 붙여 `base_url` 뒤 경로로 직접 보낸다. 리다이렉트는 따라가지 않는다.
//!   토큰이 만료됐거나 원천이 401이면 리프레시 토큰이 있을 때 한 번 바꿔 보고, 안 되면 로그인 정보의 토큰을 지우고
//!   그 원천을 `login_required`로 둔다.
//!
//! # 앱 저장소와 문서 모음 (11판, 모듈 `storage` 3판)
//! 앱 정의의 [`crate::app_storage::StorageDecl`]이 저장할 항목, kind, 기본값, 스키마를 선언한다. 저장 칸은 계정 × 앱이며
//! 워크스페이스 전용 키에는 `{workspace_id}`를 쓴다. 계정 id는 API 인자나 저장 본문에 없다. 서버는 기기 요청에서
//! 기기 토큰의 계정을, MCP 요청에서 MCP principal의 계정을 해석한다.
//!
//! - 항목 목록: `GET {DEVICE_APP_STORAGE_PATH}/{app_id}/items?workspace_id={id}`. 경로의 앱과 선언된 항목만 다룬다.
//! - 읽기: `GET {DEVICE_APP_STORAGE_PATH}/{app_id}/items/{entry_id}?workspace_id={id}`. 없으면 선언 기본값과
//!   `exists: false`, `revision: null`을 돌려준다.
//! - 쓰기: 같은 항목 경로의 `PUT`. [`crate::app_storage::StorageWriteRequest`]에 본문과
//!   `expected_revision`을 쓰는 compare-and-set이다. 빠지거나 `null`이면 아직 행이 없을 때만 맞고, 성공하면 새 revision을 준다.
//!   충돌은 409와 [`crate::app_storage::StorageConflict::current_revision`]이다.
//! - 기본값으로 되돌리기: 같은 항목 경로의 `DELETE`, 본문은 [`crate::app_storage::StorageResetRequest`].
//!   revision 비교를 통과하면 저장 행을 지우고 기본값으로 돌아가며, 응답은 [`crate::app_storage::StorageResetReply`]다.
//! - 문서 모음: `collection: true`인 항목은 `kind: md`, `presentation: hidden`, 빈 문자열 기본값을 쓰며 schema,
//!   choices, agent_context는 없다. 선언 `key`가 prefix이고, 그 아래 상대 경로마다 본문과 revision이 있는 문서 행 하나를 둔다.
//!   모음 목록은 본문 없이 경로, revision, 수정 시각, UTF-8 크기를 돌려준다. 문서 읽기/쓰기/삭제는 위 `document` 경로에서
//!   `doc` 쿼리로 지정하며, 이름 변경은 한 트랜잭션에서 키만 옮겨 본문과 revision을 유지한다. 대상 키가 있으면 409다.
//!   기본 앱은 같은 동작을 원시 `app-values` 경로로 제공한다. 내장 서버와 원격 서버는 같은 DB 계약을 쓴다.
//! - 저장 항목 변경은 `storage.changed`에 metadata만 담고 본문은 싣지 않는다. 연결 직후 `storage.snapshot`은
//!   현재 계정 × 앱 칸의 항목 metadata를 보낸다. 기기에서 쓰는 코어는 `storage.update`로 화면에 전달한다.
//!   서버는 이벤트 스트림의 지원 범위에 `storage: 1`을 보낸 기기에만 두 이벤트를 보낸다. 저장소 모듈을 모르는
//!   옛 쉘에는 새 이벤트 variant를 보내지 않는다.
//!   이름 변경은 전체 저장 키를 담은 `storage.moved` 또는 기본 앱의 `app_value.moved` metadata 이벤트로 보내며 본문은 싣지 않는다.
//! - 앱을 새 버전으로 올릴 때 저장값이 있는 선언의 `id`, key, kind가 바뀌거나 기존 값이 새 schema를 통과하지 못하면
//!   올리기를 거부한다. revision은 md 원문 UTF-8 바이트 또는 키를 정렬한 JSON 직렬화 바이트의 SHA-256이다.
//!
//! 식 오류 보고: 코어는 배치 보고([`DeviceLayout::data_errors`])에 이은 창의 식과 원천 오류를 창마다 앞에서부터
//! [`LAYOUT_DATA_ERRORS_MAX`]개까지 싣는다. 에이전트가 MCP의 작업 조회로 보고 고친다.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::data::HttpMethod;
use crate::{App, AppVersion, AppWindow, Desktop, JsonValue, Workspace};

pub const PAIR_START_PATH: &str = "/api/pair/start";
pub const PAIR_POLL_PATH: &str = "/api/pair/poll";
pub const DEVICE_EVENTS_PATH: &str = "/api/device/events";
pub const DEVICE_APPS_PATH: &str = "/api/device/apps";
/// (8판) 계정 × 앱 저장소. 뒤에 `/{app_id}/items`와 항목 id를 붙인다.
pub const DEVICE_APP_STORAGE_PATH: &str = "/api/device/app-storage";
pub const HEALTH_PATH: &str = "/api/health";
/// 코어가 이벤트 스트림을 열 때 지원 범위([`crate::Supported`] JSON)를 싣는 헤더.
pub const SUPPORTED_HEADER: &str = "x-kaleidoscope-supported";
/// 코어가 이벤트 스트림을 열 때 자기가 아는 레지스트리 판(정수)을 싣는 헤더. 6 이상이면 배치를 동기화한다.
pub const REGISTRY_HEADER: &str = "x-kaleidoscope-registry";
/// 기기 토큰을 쓴 MCP 호출의 작업 기본값.
pub const WORKSPACE_HEADER: &str = "x-kaleidoscope-workspace";
/// 이 빌드가 아는 레지스트리 판.
pub const REGISTRY_VERSION: u32 = 11;
pub const APP_VALUES_REGISTRY_VERSION: u32 = 10;
/// 배치를 동기화하는 레지스트리 판. 서버는 [`REGISTRY_HEADER`]가 이 값 이상인 연결과 배치를 맞춘다.
pub const LAYOUT_SYNC_REGISTRY_VERSION: u32 = 6;
/// 앱 저장소 동기화를 받을 수 있는 최소 레지스트리 판.
pub const STORAGE_REGISTRY_VERSION: u32 = 8;
/// 문서 모음과 이동 이벤트를 지원하는 레지스트리 판.
pub const COLLECTION_REGISTRY_VERSION: u32 = 11;

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
/// 바뀐 워크스페이스, 데스크톱, 창을 올리는 경로.
pub const DEVICE_LAYOUT_CHANGES_PATH: &str = "/api/device/layout/changes";
/// (7판) 같이 보기 창의 보이는 글. 뒤에 `/{window_id}`를 붙인다.
pub const DEVICE_SHARES_PATH: &str = "/api/device/shares";
/// 코어가 대화 문맥에 넣는 같이 보기 블록의 경계.
pub const SHARE_BLOCK_START: &str = "<kaleidoscope-share>";
pub const SHARE_BLOCK_END: &str = "</kaleidoscope-share>";
/// 바뀐 것 올리기 본문의 최대 바이트 수. 처음 맞추기에서 창 상태가 큰 창 여럿을 한 번에 올릴 수 있게 넉넉히 둔다.
pub const LAYOUT_CHANGES_BODY_MAX_BYTES: usize = 16 * 1024 * 1024;

/// 연결 중계 경로. `{name}` 자리에 연결 이름을 넣는다.
pub fn device_connection_request_path(name: &str) -> String {
    format!("/api/device/connections/{name}/request")
}

/// (8판) 앱의 계정 × 앱 저장소 항목 모음 경로.
pub fn device_app_storage_items_path(app_id: &str) -> String {
    format!("{DEVICE_APP_STORAGE_PATH}/{app_id}/items")
}

/// (8판) 앱 저장소에서 선언된 항목 하나의 경로.
pub fn device_app_storage_item_path(app_id: &str, entry_id: &str) -> String {
    format!("{}/{}", device_app_storage_items_path(app_id), entry_id)
}

/// 배치 보고에 창마다 싣는 식과 원천 오류의 최대 수.
pub const LAYOUT_DATA_ERRORS_MAX: usize = 10;

/// 배치가 바뀐 뒤 이만큼 더 바뀌지 않으면 보고한다.
pub const LAYOUT_DEBOUNCE_MS: u64 = 1000;
/// 배치 보고가 실패하면 이만큼 뒤에 다시 보낸다.
pub const LAYOUT_RETRY_SECS: u64 = 10;
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
    /// (5판) 이은 창의 식과 원천 오류. 없으면 빼고 보낸다(4판 서버도 읽게).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data_errors: Vec<LayoutDataError>,
}

/// 바뀐 워크스페이스, 데스크톱, 창. 코어가 올리는 본문, 서버의 응답, `layout.changed` 이벤트가 같은 모양이다.
/// upsert 목록은 엔티티의 지금 모습 전체이고, 지운 목록은 id다. 규칙은 「작업과 배치 동기화」 절.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutChanges {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workspaces: Vec<Workspace>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub desktops: Vec<Desktop>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub windows: Vec<AppWindow>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_workspaces: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_desktops: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_windows: Vec<String>,
}

impl LayoutChanges {
    pub fn is_empty(&self) -> bool {
        self.workspaces.is_empty()
            && self.desktops.is_empty()
            && self.windows.is_empty()
            && self.deleted_workspaces.is_empty()
            && self.deleted_desktops.is_empty()
            && self.deleted_windows.is_empty()
    }
}

/// 창 하나의 식이나 원천 오류. `pointer`는 바인딩 자리나 `/sources/이름`이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutDataError {
    pub window_id: String,
    pub pointer: String,
    pub message: String,
}

/// 창의 권한 하나에 고른 폴더의 이름. 절대 경로는 담지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutFolder {
    pub window_id: String,
    pub permission: String,
    pub root_name: String,
}

/// (7판) `PUT /api/device/shares/{window_id}` 본문. 같이 보기 창 하나에 지금 보이는 것.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShareUpload {
    /// 그 창의 워크스페이스. 작업별 조회에 쓴다.
    pub workspace_id: String,
    /// 블록 머리에 보일 앱 이름(그 창 앱의 지금 버전의 `name`).
    pub app_name: String,
    /// [`crate::VisibleView::text`].
    pub text: String,
    /// [`crate::VisibleView::visual`].
    pub visual: bool,
}

/// 연결 하나(비밀 없이). 「연결」 절.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub name: String,
    pub kind: ConnectionKind,
    pub base_url: String,
    pub writable: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    /// `oauth`만. 없으면 `base_url`의 origin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    /// `oauth`만. 공백으로 나눈 목록.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<String>,
    /// `oauth`만. RFC 8707 resource.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    /// 서버가 헤더를 쥐고 대신 부른다.
    Relay,
    /// 기기가 로그인해 원천에 직접 부른다.
    Oauth,
}

/// `relay` 연결 중계 요청.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectionRequest {
    /// 부르는 창의 앱. 서버가 그 앱의 지금 버전이 이 연결을 선언했는지 본다.
    pub app_id: String,
    pub method: HttpMethod,
    /// 연결 주소 아래 경로.
    pub path: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub query: BTreeMap<String, String>,
    /// JSON 본문. 있으면 `content-type: application/json`으로 보낸다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<JsonValue>,
    pub accept: ConnectionAccept,
}

/// 응답 본문을 돌려받는 꼴.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionAccept {
    /// JSON으로 읽어 `json`에. 읽지 못하면 `text`에 글로 담는다.
    Json,
    /// UTF-8 글로 `text`에.
    Text,
    /// 그대로 base64로 `data_base64`에(이미지, 소리).
    Bytes,
}

/// `relay` 연결 중계 응답. 원천의 응답 상태와 본문.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConnectionReply {
    pub status: u16,
    /// 원천의 `content-type`(없으면 빈 문자열).
    pub mime: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub json: Option<JsonValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_base64: Option<String>,
}

/// 이벤트 스트림의 이벤트. `event`로 가른다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event")]
pub enum DeviceEvent {
    /// 연결 직후 한 번. 레지스트리의 모든 앱의 지금 버전.
    #[serde(rename = "apps.snapshot")]
    AppsSnapshot {
        apps: Vec<RegistryApp>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        deleted: Vec<String>,
    },
    /// 레지스트리에서 앱을 지웠다.
    #[serde(rename = "app.deleted")]
    AppDeleted { app_id: String },
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
    #[serde(rename = "connections.snapshot")]
    ConnectionsSnapshot { connections: Vec<ConnectionInfo> },
    /// (8판) 저장소 metadata 전체. 본문 값은 별도 읽기로 받는다.
    #[serde(rename = "storage.snapshot")]
    StorageSnapshot {
        app_id: String,
        snapshot: crate::app_storage::StorageSnapshot,
    },
    /// (8판) 저장소 metadata가 바뀌었다. 본문 값은 이벤트에 싣지 않는다.
    #[serde(rename = "storage.changed")]
    StorageChanged {
        app_id: String,
        changed: crate::app_storage::StorageChanged,
    },
    #[serde(rename = "app_values.snapshot")]
    AppValuesSnapshot {
        app_id: String,
        bucket_id: String,
        items: Vec<crate::app_storage::AppValueMeta>,
    },
    #[serde(rename = "app_value.changed")]
    AppValueChanged {
        app_id: String,
        bucket_id: String,
        item: crate::app_storage::AppValueMeta,
    },
    #[serde(rename = "storage.moved")]
    StorageMoved {
        app_id: String,
        bucket_id: String,
        entry_id: String,
        from_key: String,
        to_key: String,
        revision: String,
    },
    #[serde(rename = "app_value.moved")]
    AppValueMoved {
        app_id: String,
        bucket_id: String,
        from_key: String,
        to_key: String,
        revision: String,
    },
    /// 서버 정본의 워크스페이스, 데스크톱, 창 전체. 동기화하는 연결에만 스냅샷들 바로 뒤에 한 번 보낸다(6판).
    #[serde(rename = "layout.snapshot")]
    LayoutSnapshot {
        workspaces: Vec<Workspace>,
        desktops: Vec<Desktop>,
        windows: Vec<AppWindow>,
    },
    /// 서버 정본에서 바뀐 것. 모든 동기화하는 연결에 보낸다(6판).
    #[serde(rename = "layout.changed")]
    LayoutChanged { changes: LayoutChanges },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_event_parser_ignores_snapshot_deleted_and_skips_new_event() {
        #[derive(Deserialize)]
        #[serde(tag = "event")]
        enum LegacyEvent {
            #[serde(rename = "apps.snapshot")]
            AppsSnapshot { apps: Vec<RegistryApp> },
        }
        let snapshot: LegacyEvent =
            serde_json::from_str(r#"{"event":"apps.snapshot","apps":[],"deleted":["personal"]}"#)
                .unwrap();
        assert!(matches!(snapshot, LegacyEvent::AppsSnapshot { apps } if apps.is_empty()));
        assert!(serde_json::from_str::<LegacyEvent>(
            r#"{"event":"app.deleted","app_id":"personal"}"#
        )
        .is_err());
    }

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
        assert_eq!(
            parsed,
            DeviceEvent::AppsSnapshot {
                apps: vec![],
                deleted: vec![]
            }
        );
        let targeted: DeviceEvent =
            serde_json::from_str(r#"{"event":"app.open","app_id":"a","workspace_id":"w"}"#)
                .unwrap();
        assert_eq!(
            targeted,
            DeviceEvent::AppOpen {
                app_id: "a".into(),
                workspace_id: Some("w".into())
            }
        );
    }

    #[test]
    fn connection_messages_round_trip() {
        assert_eq!(
            device_connection_request_path("board"),
            "/api/device/connections/board/request"
        );
        let request: ConnectionRequest = serde_json::from_str(
            r#"{"app_id":"cards","method":"GET","path":"/api/cards","query":{"folderId":"f"},"accept":"json"}"#,
        )
        .unwrap();
        assert_eq!(request.method, HttpMethod::Get);
        assert_eq!(request.accept, ConnectionAccept::Json);
        assert!(
            serde_json::from_str::<ConnectionRequest>(
                r#"{"app_id":"a","method":"GET","path":"/","accept":"json","headers":{}}"#
            )
            .is_err(),
            "기기는 헤더를 보낼 수 없다"
        );
        let event = DeviceEvent::ConnectionsSnapshot {
            connections: vec![ConnectionInfo {
                name: "board".into(),
                kind: ConnectionKind::Relay,
                base_url: "https://example.com".into(),
                writable: false,
                paths: vec![],
                issuer: None,
                scopes: None,
                resource: None,
            }],
        };
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"event":"connections.snapshot","connections":[{"name":"board","kind":"relay","base_url":"https://example.com","writable":false}]}"#
        );
        // 식 오류가 없는 배치 보고는 4판 모양 그대로다.
        let layout = DeviceLayout::default();
        assert!(!serde_json::to_string(&layout)
            .unwrap()
            .contains("data_errors"));
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

    #[test]
    fn layout_events_round_trip() {
        let changes = LayoutChanges {
            workspaces: vec![Workspace {
                id: "w".into(),
                name: "작업 1".into(),
                created_at: "2026-10-30T00:00:00Z".into(),
                updated_at: "2026-10-30T00:00:00Z".into(),
            }],
            deleted_windows: vec!["x".into()],
            ..LayoutChanges::default()
        };
        let event = DeviceEvent::LayoutChanged {
            changes: changes.clone(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(
            json,
            r#"{"event":"layout.changed","changes":{"workspaces":[{"id":"w","name":"작업 1","created_at":"2026-10-30T00:00:00Z","updated_at":"2026-10-30T00:00:00Z"}],"deleted_windows":["x"]}}"#
        );
        assert_eq!(serde_json::from_str::<DeviceEvent>(&json).unwrap(), event);
        assert!(!changes.is_empty());
        assert!(LayoutChanges::default().is_empty());
        assert_eq!(
            serde_json::to_string(&LayoutChanges::default()).unwrap(),
            "{}"
        );

        let snapshot: DeviceEvent = serde_json::from_str(
            r#"{"event":"layout.snapshot","workspaces":[],"desktops":[],"windows":[]}"#,
        )
        .unwrap();
        assert_eq!(
            snapshot,
            DeviceEvent::LayoutSnapshot {
                workspaces: vec![],
                desktops: vec![],
                windows: vec![],
            }
        );
    }
}
/// 기기가 내장 앱의 실행 선언을 서버에 등록한다.
pub const DEVICE_BUILTIN_SPECS_PATH: &str = "/api/device/builtin-specs";
