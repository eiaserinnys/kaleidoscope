error_catalog! { ENTRIES;
    SHELL_CLIENT_INSTRUCTIONS_CAPABILITY_UNDECLARED() { class: PermissionDenied, place: "클라이언트 지침 요청", cause: "앱이 지침 기능을 선언하지 않았다", message: "앱이 지침 읽기 기능을 선언하지 않았습니다. 앱 정의의 client.capabilities를 고치세요.", fix: "client.capabilities에 instructions를 선언하세요" }
    SHELL_CLIENT_CONTEXT_CAPABILITY_UNDECLARED() { class: PermissionDenied, place: "클라이언트 같이 보기 요청", cause: "앱이 같이 보기 기능을 선언하지 않았다", message: "앱이 같이 보기 준비 기능을 선언하지 않았습니다. 앱 정의의 client.capabilities를 고치세요.", fix: "client.capabilities에 context_capture를 선언하세요" }
    SHELL_APP_IMPORT_REPLY_INVALID() {
        class: Io,
        place: "앱 정의 가져오기 응답",
        cause: "가져오기 응답의 종류가 예상과 다르다",
        message: "앱 정의를 가져온 결과를 확인하지 못했습니다. 쉘을 다시 시작한 뒤 다시 시도하세요.",
        fix: "쉘을 다시 시작한 뒤 다시 시도하세요"
    }
    SHELL_WINDOW_CLOSE_UNSAVED() {
        class: Io,
        place: "창 닫기 전 저장",
        cause: "열린 내용의 저장을 마치지 못했다",
        message: "저장하지 못한 내용이 있어 창을 닫지 않았습니다. 내용을 저장한 뒤 다시 닫으세요.",
        fix: "내용을 저장한 뒤 다시 닫으세요"
    }
    SHELL_UPDATE_RESTART_UNSAVED() {
        class: Io,
        place: "업데이트 재시작 전 저장",
        cause: "편집 중인 내용의 저장을 마치지 못했다",
        message: "저장하지 못한 편집이 있어 다시 시작하지 않았습니다. 내용을 저장한 뒤 다시 시작하세요.",
        fix: "내용을 저장한 뒤 다시 시작하세요"
    }
    SHELL_STATE_REPLY_INVALID() {
        class: Io,
        place: "쉘 초기 상태 응답",
        cause: "상태 응답의 종류가 예상과 다르다",
        message: "쉘 상태를 불러오지 못했습니다. 쉘을 다시 시작하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    SHELL_HTTP_EXTERNAL_SCHEME_INVALID() {
        class: InvalidRequest,
        place: "브라우저 외부 주소 열기",
        cause: "외부 주소가 HTTP 또는 HTTPS가 아니다",
        message: "이 링크는 웹 주소가 아니라 열 수 없습니다. HTTP 또는 HTTPS 주소를 사용하세요.",
        fix: "HTTP 또는 HTTPS 주소를 사용하세요"
    }
    SHELL_HTTP_ERROR_REPLY_INVALID() {
        class: Io,
        place: "코어 HTTP 오류 응답 읽기",
        cause: "코어의 오류 응답이 예상한 형식과 다르다",
        message: "코어의 오류 응답을 읽지 못했습니다. 쉘을 다시 시작한 뒤 다시 시도하세요.",
        fix: "쉘을 다시 시작한 뒤 다시 시도하세요"
    }
    SHELL_HTTP_REQUEST_FAILED() {
        class: Io,
        place: "코어 HTTP 요청",
        cause: "코어가 요청에 실패 응답을 보냈다",
        message: "코어가 요청에 실패 응답을 보냈습니다. 쉘을 다시 시작한 뒤 다시 시도하세요.",
        fix: "쉘을 다시 시작한 뒤 다시 시도하세요"
    }
    SHELL_EDITOR_ITEM_DELETED() {
        class: Conflict,
        place: "편집 중인 항목 삭제",
        cause: "저장하지 않은 파일 또는 문서가 삭제됐다",
        message: "편집 중인 항목이 삭제되어 저장하지 못했습니다. 내용을 복사해 다른 문서에 저장하세요.",
        fix: "내용을 복사해 다른 문서에 저장하세요"
    }
    SHELL_THREAD_READ_INVALID(name) {
        class: InvalidRequest,
        place: "HTML 문서 커멘트 기록 읽기",
        cause: "저장된 커멘트 기록을 읽을 수 없다",
        message: "문서 {name}의 커멘트 기록을 읽지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    SHELL_CALL_UNEXPECTED_FAILURE(reason) {
        class: Io,
        place: "쉘 코어 호출 응답 처리",
        cause: "호출에서 코어 오류 형식이 아닌 예외가 발생했다",
        message: "쉘에서 예상하지 못한 오류가 났습니다. 다시 시도하세요. 원인: {reason}",
        fix: "다시 시도하세요"
    }
    SHELL_IPC_OPERATION_HEADER_INVALID() {
        class: InvalidRequest,
        place: "쉘 파일 전송 요청 처리",
        cause: "요청 종류 정보가 없거나 올바른 문자열이 아니다",
        message: "파일을 주고받지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트한 뒤 다시 시도하세요"
    }
    SHELL_IPC_WINDOW_HEADER_INVALID() {
        class: InvalidRequest,
        place: "쉘 파일 전송 창 확인",
        cause: "창 정보가 없거나 올바른 문자열이 아니다",
        message: "파일을 주고받을 창을 확인하지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트한 뒤 다시 시도하세요"
    }
    SHELL_IPC_HANDLE_HEADER_INVALID() {
        class: InvalidRequest,
        place: "쉘 파일 전송 대상 확인",
        cause: "요청 대상 정보가 없거나 올바른 문자열이 아니다",
        message: "주고받을 파일을 확인하지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트한 뒤 다시 시도하세요"
    }
    SHELL_IPC_BODY_INVALID() {
        class: InvalidRequest,
        place: "쉘 파일 내용 전송",
        cause: "요청 본문이 raw 이진 데이터가 아니다",
        message: "파일 내용을 주고받지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트한 뒤 다시 시도하세요"
    }
    SHELL_IPC_EXPORT_OFFSET_INVALID() {
        class: InvalidRequest,
        place: "쉘 파일 내보내기 위치 확인",
        cause: "파일 쓰기에 필요한 위치가 없거나 숫자로 읽히지 않는다",
        message: "파일 내보내기 위치 정보가 없거나 올바르지 않아 쓸 수 없습니다. 내보내기를 다시 시작하세요.",
        fix: "내보내기를 다시 시작하세요"
    }
    SHELL_IPC_OPERATION_UNSUPPORTED() {
        class: InvalidRequest,
        place: "쉘 파일 전송 작업 처리",
        cause: "요청 종류가 지원되는 이진 작업이 아니다",
        message: "요청한 파일 작업을 처리하지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트한 뒤 다시 시도하세요"
    }
    SHELL_IPC_CORE_TASK_INTERRUPTED() {
        class: Io,
        place: "쉘 코어 요청 실행",
        cause: "백그라운드 코어 작업이 중단되었다",
        message: "쉘 코어 작업이 중단되어 요청을 마치지 못했습니다. 다시 시도하세요.",
        fix: "요청을 다시 시도하세요"
    }
    SHELL_IPC_BYTES_TASK_INTERRUPTED() {
        class: Io,
        place: "쉘 이진 IPC 작업 실행",
        cause: "백그라운드 이진 작업이 중단되었다",
        message: "파일 작업이 중단되어 요청을 마치지 못했습니다. 다시 시도하세요.",
        fix: "요청을 다시 시도하세요"
    }
    SHELL_CONVERSATION_ATTACHMENT_REPLY_INVALID() {
        class: Io,
        place: "대화 첨부 읽기",
        cause: "첨부 명령이 다른 종류의 응답을 받았다",
        message: "대화 첨부를 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 첨부를 다시 여세요"
    }
    SHELL_AGENT_SESSION_ATTACH_REPLY_INVALID() {
        class: Io,
        place: "로컬 에이전트 연결",
        cause: "에이전트 상태 명령이 다른 종류의 응답을 받았다",
        message: "로컬 에이전트 상태를 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_AGENT_SESSION_ATTACHMENT_REPLY_INVALID() {
        class: Io,
        place: "로컬 에이전트 첨부 읽기",
        cause: "첨부 명령이 다른 종류의 응답을 받았다",
        message: "로컬 에이전트 첨부를 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 첨부를 다시 여세요"
    }
    SHELL_AGENT_SESSION_FAILURE_DETAILS_MISSING() {
        class: LocalAgentFailed,
        place: "로컬 에이전트 실패 표시",
        cause: "실패 상태에 원인 설명이 없다",
        message: "로컬 에이전트가 실패했지만 원인을 받지 못했습니다. 에이전트를 다시 시도하세요.",
        fix: "로컬 에이전트를 다시 시도하세요"
    }
    SHELL_CANVAS_TRANSFER_UNSUPPORTED() {
        class: Unavailable,
        place: "캔버스 화면 연결",
        cause: "현재 브라우저가 화면 연결 기능을 지원하지 않는다",
        message: "이 환경은 캔버스 화면을 연결할 수 없습니다. 지원되는 쉘에서 다시 여세요.",
        fix: "지원되는 쉘에서 앱을 여세요"
    }
    SHELL_MARKDOWN_VALUE_NOT_TEXT() {
        class: InvalidRequest,
        place: "마크다운 보기 값 확인",
        cause: "마크다운 값이 문자열이 아니다",
        message: "마크다운 값은 글이어야 합니다. 앱 정의에서 마크다운 값에 글을 연결하세요.",
        fix: "앱 정의의 마크다운 값을 글로 바꾸세요"
    }
    SHELL_HTML_VALUE_NOT_TEXT() {
        class: InvalidRequest,
        place: "HTML 보기 값 확인",
        cause: "HTML 값이 문자열이 아니다",
        message: "HTML 값은 글이어야 합니다. 앱 정의에서 HTML 값에 글을 연결하세요.",
        fix: "앱 정의의 HTML 값을 글로 바꾸세요"
    }
    SHELL_HTML_REVISION_REPLY_INVALID() {
        class: Io,
        place: "HTML 문서 리비전 읽기",
        cause: "저장소 응답에 글 리비전이 없다",
        message: "HTML 리비전을 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_SANDBOX_HTML_ASSET_MIME_INVALID() {
        class: Io,
        place: "HTML 앱 자산 읽기",
        cause: "HTML 앱 자산이 HTML 형식이 아니다",
        message: "HTML 앱의 자산 형식이 올바르지 않습니다. HTML 자산으로 앱을 다시 올리세요.",
        fix: "앱 정의에서 HTML 형식 자산을 지정하세요"
    }
    SHELL_SANDBOX_STORAGE_READ_REPLY_INVALID() {
        class: Io,
        place: "HTML 앱 저장 항목 읽기",
        cause: "저장소 읽기 명령이 다른 종류의 응답을 받았다",
        message: "HTML 앱의 저장 항목을 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_SANDBOX_STORAGE_WRITE_REPLY_INVALID() {
        class: Io,
        place: "HTML 앱 저장 항목 쓰기",
        cause: "저장소 쓰기 명령이 다른 종류의 응답을 받았다",
        message: "HTML 앱의 저장 항목을 쓰지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_HTML_COMMENT_LIST_REPLY_INVALID() {
        class: Io,
        place: "HTML 문서 커멘트 목록 읽기",
        cause: "목록 명령이 다른 종류의 응답을 받았다",
        message: "HTML 문서의 커멘트 목록을 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_HTML_COMMENT_THREAD_REPLY_INVALID() {
        class: Io,
        place: "HTML 문서 커멘트 읽기",
        cause: "커멘트 읽기 명령이 다른 종류의 응답을 받았다",
        message: "HTML 문서의 커멘트를 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_HTML_COMMENT_SAVE_CONFLICT() {
        class: Conflict,
        place: "HTML 문서 커멘트 저장",
        cause: "세 번 다시 저장해도 다른 창의 변경과 충돌한다",
        message: "HTML 문서 커멘트가 다른 창의 변경과 충돌해 저장되지 않았습니다. 잠시 뒤 다시 저장하세요.",
        fix: "잠시 뒤 다시 저장하세요"
    }
    SHELL_APP_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 창 내용 표시",
        cause: "표시할 창이 현재 상태에 없다",
        message: "앱 창이 사라져 내용을 표시할 수 없습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    SHELL_APP_VERSION_NOT_FOUND() {
        class: NotFound,
        place: "앱 창 정의 읽기",
        cause: "창이 참조하는 앱 정의를 찾을 수 없다",
        message: "앱 정의를 찾을 수 없어 창을 표시하지 못했습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    SHELL_WINDOW_DATA_CONTEXT_MISSING() {
        class: Io,
        place: "창 데이터 접근",
        cause: "창 데이터 연결 없이 데이터 블록을 렌더링했다",
        message: "창 데이터가 연결되지 않아 화면을 그릴 수 없습니다. 쉘을 다시 시작하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    SHELL_CLIENT_BINDING_DATA_CONTEXT_MISSING() {
        class: Io,
        place: "화면 값 데이터 연결 읽기",
        cause: "화면 값에 연결된 데이터 문맥이 없다",
        message: "화면 값의 데이터 연결을 찾지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    SHELL_MEDIA_PLAYBACK_UNSUPPORTED() {
        class: Io,
        place: "미디어 재생",
        cause: "브라우저가 선택한 미디어를 읽거나 재생할 수 없다",
        message: "이 파일의 미디어 데이터를 재생할 수 없습니다. 지원되는 파일로 다시 시도하세요.",
        fix: "지원되는 미디어 파일을 여세요"
    }
    SHELL_CLIENT_SCRIPT_ASSET_INVALID() {
        class: Io,
        place: "앱 클라이언트 스크립트 읽기",
        cause: "클라이언트 자산이 JavaScript 형식이 아니다",
        message: "앱 실행 파일의 형식이 올바르지 않습니다. JavaScript 자산으로 앱을 다시 올리세요.",
        fix: "앱 정의에서 JavaScript 형식 자산을 지정하세요"
    }
    SHELL_CLIENT_SCRIPT_ASSET_REPLY_INVALID() {
        class: Io,
        place: "앱 클라이언트 스크립트 읽기",
        cause: "자산 읽기 명령이 다른 종류의 응답을 받았다",
        message: "앱 실행 파일을 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_CLIENT_FRAME_NAVIGATED() {
        class: Io,
        place: "앱 클라이언트 프레임 감시",
        cause: "앱 프레임이 처음 열린 뒤 다른 문서로 이동했다",
        message: "앱 실행 화면이 예상과 다르게 바뀌어 실행을 멈췄습니다. 다시 시작을 누르세요.",
        fix: "다시 시작을 누르세요"
    }
    SHELL_CLIENT_UNRESPONSIVE() {
        class: Io,
        place: "앱 클라이언트 응답 확인",
        cause: "앱 프레임이 제한 시간 안에 응답하지 않았다",
        message: "앱이 응답하지 않아 실행을 멈췄습니다. 다시 시작을 누르세요.",
        fix: "다시 시작을 누르세요"
    }
    SHELL_CLIENT_COMMAND_UNDECLARED(name) {
        class: InvalidRequest,
        place: "앱 클라이언트 명령 실행",
        cause: "앱이 선언하지 않은 명령을 요청했다",
        message: "앱 명령 {name}: 앱 정의에 없습니다. 앱 정의에 명령을 선언하세요.",
        fix: "앱 정의에 해당 명령을 선언하세요"
    }
    SHELL_CLIENT_SAVE_PROMPT_INPUT_INVALID() {
        class: Io,
        place: "앱 파일 저장 대화상자 열기",
        cause: "파일 이름이나 형식이 문자열이 아니다",
        message: "앱 파일 저장에 필요한 이름이나 형식이 올바르지 않습니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_SAVE_PROMPT_REPLY_INVALID() {
        class: Io,
        place: "앱 파일 저장 대화상자 처리",
        cause: "저장 대화상자 명령이 다른 종류의 응답을 받았다",
        message: "파일 저장 대화상자를 열지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_CLIENT_CAN_SHARE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 호스트 파일 공유 가능 여부 확인",
        cause: "앱 정의에 share capability가 없다",
        message: "앱 정의에 share capability가 없어 파일을 공유할 수 없습니다. 앱 정의의 capabilities에 share를 추가하세요.",
        fix: "앱 정의의 capabilities에 share를 추가하세요"
    }
    SHELL_CLIENT_CAN_SHARE_ACTION_REQUIRED() {
        class: InvalidRequest,
        place: "앱 파일 공유 가능 여부 확인",
        cause: "앱 동작 밖에서 공유 가능 여부를 확인했다",
        message: "파일 공유 가능 여부 확인은 앱 동작 안에서 해야 합니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_SHARE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 호스트 파일 공유",
        cause: "앱 정의에 share capability가 없다",
        message: "앱 정의에 share capability가 없어 파일을 공유할 수 없습니다. 앱 정의의 capabilities에 share를 추가하세요.",
        fix: "앱 정의의 capabilities에 share를 추가하세요"
    }
    SHELL_CLIENT_SHARE_ACTION_REQUIRED() {
        class: InvalidRequest,
        place: "앱 파일 공유",
        cause: "앱 동작 밖에서 파일 공유를 요청했다",
        message: "파일 공유는 앱 동작 안에서 요청해야 합니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_KEEP_AWAKE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 호스트 화면 켜짐 유지",
        cause: "앱 정의에 keep_awake capability가 없다",
        message: "앱 정의에 keep_awake capability가 없어 화면을 켜 둘 수 없습니다. 앱 정의의 capabilities에 keep_awake를 추가하세요.",
        fix: "앱 정의의 capabilities에 keep_awake를 추가하세요"
    }
    SHELL_CLIENT_KEEP_AWAKE_ACTION_REQUIRED() {
        class: InvalidRequest,
        place: "화면 켜짐 유지",
        cause: "앱 동작 밖에서 화면 켜짐 유지를 요청했다",
        message: "화면 켜짐 유지 요청은 앱 동작 안에서 해야 합니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_FRAME_CAN_SHARE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 프레임 파일 공유 가능 여부 확인",
        cause: "앱 정의에 share capability가 없다",
        message: "앱 정의에 share capability가 없어 파일을 공유할 수 없습니다. 앱 정의의 capabilities에 share를 추가하세요.",
        fix: "앱 정의의 capabilities에 share를 추가하세요"
    }
    SHELL_CLIENT_FRAME_SHARE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 프레임 파일 공유",
        cause: "앱 정의에 share capability가 없다",
        message: "앱 정의에 share capability가 없어 파일을 공유할 수 없습니다. 앱 정의의 capabilities에 share를 추가하세요.",
        fix: "앱 정의의 capabilities에 share를 추가하세요"
    }
    SHELL_CLIENT_FRAME_KEEP_AWAKE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 프레임 화면 켜짐 유지",
        cause: "앱 정의에 keep_awake capability가 없다",
        message: "앱 정의에 keep_awake capability가 없어 화면을 켜 둘 수 없습니다. 앱 정의의 capabilities에 keep_awake를 추가하세요.",
        fix: "앱 정의의 capabilities에 keep_awake를 추가하세요"
    }
    SHELL_CLIENT_ASSET_UNDECLARED(asset_id) {
        class: InvalidRequest,
        place: "앱 자산 읽기",
        cause: "앱이 정의에 없는 자산을 요청했다",
        message: "앱 자산 {asset_id}: 앱 정의에 없습니다. 앱 정의의 자산 목록을 확인하세요.",
        fix: "앱 정의에 해당 자산을 추가하세요"
    }
    SHELL_CLIENT_HTTP_TRANSPORT_UNAVAILABLE() {
        class: Io,
        place: "앱 공개 자료 읽기",
        cause: "현재 쉘에 이진 요청 전송 기능이 없다",
        message: "이 쉘에서는 앱이 공개 자료를 읽을 수 없습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SHELL_CLIENT_BLOB_INPUT_INVALID() {
        class: Io,
        place: "앱 저장 항목에 파일 쓰기",
        cause: "파일과 바이트를 모두 주거나 둘 다 주지 않았다",
        message: "앱 파일 쓰기 요청에는 파일 또는 파일 내용 하나만 지정해야 합니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_BLOB_TRANSPORT_UNAVAILABLE() {
        class: Io,
        place: "앱 저장 항목에 파일 쓰기",
        cause: "현재 쉘에 이진 요청 전송 기능이 없다",
        message: "이 쉘에서는 파일을 앱 저장 항목에 쓸 수 없습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SHELL_CLIENT_BLOB_BYTES_REQUIRED() {
        class: Io,
        place: "앱 저장 항목에 파일 쓰기",
        cause: "선택한 파일이나 입력값이 파일 내용으로 읽히지 않았다",
        message: "저장할 파일 내용을 읽지 못했습니다. 파일을 다시 선택한 뒤 저장하세요.",
        fix: "파일을 다시 선택하세요"
    }
    SHELL_CLIENT_FILE_SIZE_INVALID(size) {
        class: InvalidRequest,
        place: "앱 파일 내보내기 크기 확인",
        cause: "파일 크기가 0 이상의 정수가 아니다",
        message: "앱이 넘긴 파일 크기 {size}: 0 이상의 정수가 아닙니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_OUTPUT_SERIALIZE_FAILED(name) {
        class: InvalidRequest,
        place: "앱 클라이언트 출력 JSON 변환",
        cause: "출력값을 JSON으로 바꿀 수 없다",
        message: "앱 출력 {name}: JSON으로 바꿀 수 없습니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_OUTPUT_TOO_LARGE(name, limit) {
        class: InvalidRequest,
        place: "앱 클라이언트 출력 크기 확인",
        cause: "출력 JSON이 허용 크기를 넘었다",
        message: "앱 출력 {name}: 허용 크기는 {limit}입니다. 출력 크기를 줄이세요.",
        fix: "앱 출력 크기를 줄이세요"
    }
    SHELL_CLIENT_ACTION_FAILED(reason) {
        class: Io,
        place: "앱 클라이언트 동작 실행",
        cause: "앱 클라이언트 동작에서 예외가 발생했다",
        message: "앱 동작을 끝내지 못했습니다. 앱 코드를 확인하세요. 원인: {reason}",
        fix: "앱 코드를 확인하세요"
    }
    SHELL_CLIENT_FILE_PICK_TOO_LARGE(name, limit) {
        class: Io,
        place: "앱에 파일 전달",
        cause: "고른 파일이 앱 전달 한도를 넘었다",
        message: "파일 크기 초과: {name}. 앱에 전달할 수 있는 크기 제한은 {limit}입니다. 더 작은 파일을 선택하세요.",
        fix: "더 작은 파일을 선택하세요"
    }
    SHELL_CLIENT_FILE_NOT_FOUND() {
        class: Io,
        place: "앱이 고른 파일 읽기",
        cause: "현재 앱 창에서 파일을 찾을 수 없다",
        message: "고른 파일을 이 앱 창에서 찾을 수 없습니다. 파일을 다시 고르세요.",
        fix: "파일을 다시 고르세요"
    }
    SHELL_CLIENT_FILE_READ_TOO_LARGE(name, limit) {
        class: Io,
        place: "앱이 고른 파일 읽기",
        cause: "파일 크기가 앱 전달 한도를 넘었다",
        message: "파일 크기 초과: {name}. 앱에 전달할 수 있는 크기 제한은 {limit}입니다. 더 작은 파일을 선택하세요.",
        fix: "더 작은 파일을 선택하세요"
    }
    SHELL_CLIENT_FILE_WRITE_TARGET_MISSING() {
        class: Io,
        place: "앱 파일 내보내기 쓰기",
        cause: "파일 내보내기 대상을 찾을 수 없다",
        message: "파일 내보내기 대상이 사라져 쓸 수 없습니다. 파일을 다시 선택해 내보내세요.",
        fix: "파일을 다시 선택해 내보내세요"
    }
    SHELL_CLIENT_FILE_WRITE_OFFSET_INVALID(offset) {
        class: Io,
        place: "앱 파일 내보내기 쓰기",
        cause: "파일을 쓸 위치가 0 이상의 정수가 아니다",
        message: "앱이 넘긴 파일 쓰기 위치 {offset}: 0 이상의 정수가 아닙니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_FILE_WRITE_TOO_LARGE(limit) {
        class: Io,
        place: "앱 파일 내보내기 쓰기",
        cause: "브라우저 임시 파일 크기가 64MiB를 넘었다",
        message: "이 브라우저에서는 허용 크기 {limit}보다 큰 파일을 내보낼 수 없습니다. 더 작은 파일로 나누어 저장하세요.",
        fix: "파일을 {limit} 이하로 나누어 저장하세요"
    }
    SHELL_CLIENT_FILE_TRUNCATE_TARGET_MISSING() {
        class: Io,
        place: "앱 파일 내보내기 크기 변경",
        cause: "크기를 바꿀 파일 내보내기 대상을 찾을 수 없다",
        message: "파일 내보내기 대상이 사라져 크기를 바꿀 수 없습니다. 파일을 다시 선택해 내보내세요.",
        fix: "파일을 다시 선택해 내보내세요"
    }
    SHELL_CLIENT_FILE_TRUNCATE_SIZE_INVALID(size) {
        class: Io,
        place: "앱 파일 내보내기 크기 변경",
        cause: "새 파일 크기가 0 이상의 정수가 아니다",
        message: "앱이 넘긴 새 파일 크기 {size}: 0 이상의 정수가 아닙니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_FILE_TRUNCATE_TOO_LARGE(limit) {
        class: Io,
        place: "앱 파일 내보내기 크기 변경",
        cause: "브라우저 임시 파일 크기가 64MiB를 넘었다",
        message: "이 브라우저에서는 허용 크기 {limit}보다 큰 파일을 내보낼 수 없습니다. 더 작은 파일로 나누어 저장하세요.",
        fix: "파일을 {limit} 이하로 나누어 저장하세요"
    }
    SHELL_CLIENT_FILE_CLOSE_TARGET_MISSING() {
        class: Io,
        place: "앱 파일 내보내기 완료",
        cause: "완료할 파일 내보내기 대상을 찾을 수 없다",
        message: "파일 내보내기 대상이 사라져 저장을 마치지 못했습니다. 파일을 다시 선택해 내보내세요.",
        fix: "파일을 다시 선택해 내보내세요"
    }
    SHELL_CLIENT_FILE_ABORT_TARGET_MISSING() {
        class: Io,
        place: "앱 파일 내보내기 취소",
        cause: "취소할 파일 내보내기 대상을 찾을 수 없다",
        message: "파일 내보내기가 이미 끝나 취소할 대상이 없습니다. 추가 조치는 필요하지 않습니다.",
        fix: "추가 조치는 필요하지 않습니다"
    }
    SHELL_CLIENT_STORAGE_ENTRY_UNDECLARED(entry) {
        class: PermissionDenied,
        place: "앱 저장 항목 접근",
        cause: "앱이 정의에 없는 저장 항목을 요청했다",
        message: "저장 항목 {entry}: 앱 정의에 없어 접근할 수 없습니다. 앱 정의의 저장 항목을 확인하세요.",
        fix: "앱 정의에 해당 저장 항목을 선언하세요"
    }
    SHELL_CLIENT_SAVE_PROMPT_ACTION_REQUIRED() {
        class: InvalidRequest,
        place: "앱 파일 저장 대화상자 열기",
        cause: "앱 동작 밖에서 파일 저장 대화상자를 열었다",
        message: "파일 저장 대화상자는 앱 동작 안에서 열어야 합니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_CLIENT_PICK_FOLDER_ACTION_REQUIRED() {
        class: InvalidRequest,
        place: "앱 폴더 선택",
        cause: "앱 동작 밖에서 폴더 선택 대화상자를 열었다",
        message: "폴더 선택은 앱 동작 안에서 요청해야 합니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    SHELL_WINDOW_GEOMETRY_TOKEN_INVALID() {
        class: Io,
        place: "새 앱 창 크기 계산",
        cause: "창 최소 크기 디자인 토큰을 읽지 못했다",
        message: "새 앱 창의 최소 크기를 계산하지 못했습니다. 쉘을 다시 시작하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    SHELL_CHAT_ATTACHMENT_COUNT_EXCEEDED(limit) {
        class: InvalidRequest,
        place: "대화 첨부 추가",
        cause: "한 번에 고른 첨부 수가 제한을 넘었다",
        message: "한 번에 첨부할 수 있는 파일은 {limit}개까지입니다. 파일 수를 줄이세요.",
        fix: "첨부 파일 수를 줄이세요"
    }
    SHELL_CHAT_ATTACHMENT_TOO_LARGE(name, limit) {
        class: InvalidRequest,
        place: "대화 첨부 추가",
        cause: "고른 첨부 파일이 크기 제한을 넘었다",
        message: "첨부 파일 크기 초과: {name}. 허용 크기는 {limit}입니다. 더 작은 파일을 고르세요.",
        fix: "더 작은 파일을 고르세요"
    }
    SHELL_CHAT_ATTACHMENT_TOTAL_TOO_LARGE(limit) {
        class: InvalidRequest,
        place: "대화 첨부 추가",
        cause: "첨부 파일의 합계가 크기 제한을 넘었다",
        message: "첨부 파일 합계 허용 크기는 {limit}입니다. 파일 수나 크기를 줄이세요.",
        fix: "첨부 파일 수나 크기를 줄이세요"
    }
    SHELL_FILE_LIST_REPLY_INVALID() {
        class: Io,
        place: "파일 목록 응답 확인",
        cause: "코어 응답이 요청한 파일 목록과 다르다",
        message: "파일 목록 응답이 쉘이 예상한 형식과 다릅니다. 파일 목록에서 새로 고침을 선택하세요.",
        fix: "파일 목록에서 새로 고침을 선택하세요"
    }
    SHELL_FILE_PATH_REPLY_INVALID() {
        class: Io,
        place: "파일 경로 응답 확인",
        cause: "코어 응답이 요청한 파일 경로와 다르다",
        message: "파일 경로 응답이 쉘이 예상한 형식과 다릅니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SHELL_FILE_MOVE_REPLY_INVALID() {
        class: Io,
        place: "파일 이동 응답 확인",
        cause: "코어 응답이 요청한 파일 이동과 다르다",
        message: "파일 이동 응답이 쉘이 예상한 형식과 다릅니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SHELL_FILE_COPY_REPLY_INVALID() {
        class: Io,
        place: "파일 복사 응답 확인",
        cause: "코어 응답이 요청한 파일 복사와 다르다",
        message: "파일 복사 응답이 쉘이 예상한 형식과 다릅니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SHELL_FILE_REMOVE_REPLY_INVALID() {
        class: Io,
        place: "파일 삭제 응답 확인",
        cause: "코어 응답이 요청한 파일 삭제와 다르다",
        message: "파일 삭제 응답이 쉘이 예상한 형식과 다릅니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SHELL_FILE_STORAGE_LIST_REPLY_INVALID() {
        class: Io,
        place: "저장 문서 목록 응답 확인",
        cause: "코어 응답이 요청한 저장 문서 목록과 다르다",
        message: "저장 문서 목록 응답이 쉘이 예상한 형식과 다릅니다. 저장 문서 목록에서 새로 고침을 선택하세요.",
        fix: "저장 문서 목록에서 새로 고침을 선택하세요"
    }
    SHELL_FILE_STORAGE_RENAME_REVISION_MISSING() {
        class: Io,
        place: "저장 문서 이름 바꾸기 판 확인",
        cause: "이름을 바꿀 저장 문서의 판 정보가 목록 응답에 없다",
        message: "저장 문서 이름을 바꾸는 데 필요한 판 정보를 받지 못했습니다. 쉘을 업데이트하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SHELL_FILE_STORAGE_REMOVE_REVISION_MISSING() {
        class: NotFound,
        place: "저장 문서 삭제 판 확인",
        cause: "삭제할 저장 문서의 판 정보를 찾지 못했다",
        message: "삭제할 저장 문서 판 정보를 찾지 못했습니다. 저장 문서 목록에서 대상을 확인하세요.",
        fix: "저장 문서 목록에서 대상을 확인하세요"
    }
    SHELL_FILE_MARKDOWN_STORAGE_INVALID(entry) {
        class: Io,
        place: "마크다운 저장 문서 읽기",
        cause: "저장 항목의 값이 마크다운 문서가 아니다",
        message: "저장 항목 {entry}: 값이 마크다운 문서가 아닙니다. 앱 정의 storage.entries에서 이 항목의 kind를 md로 고치세요.",
        fix: "앱 정의 storage.entries의 kind를 md로 고치세요"
    }
    SHELL_FILE_EXTENSION_NOT_ALLOWED(name, extensions) {
        class: InvalidRequest,
        place: "파일 이름 확장자 확인",
        cause: "파일 이름이 허용된 확장자로 끝나지 않는다",
        message: "파일 이름 ({name})의 확장자가 허용되지 않습니다. 허용되는 확장자 ({extensions})에 맞춰 이름을 고치세요.",
        fix: "허용된 확장자에 맞춰 파일 이름을 고치세요"
    }
    SHELL_FILE_EDITOR_SAVE_FAILED() {
        class: Io,
        place: "파일 작업 전 편집기 저장",
        cause: "파일 작업 전에 편집 중인 내용을 저장하지 못했다",
        message: "편집 중인 내용을 저장하지 못해 파일 작업을 취소했습니다. 편집기에 표시된 오류를 확인하세요.",
        fix: "편집기에 표시된 오류를 확인하세요"
    }
    SHELL_TREE_CONTROL_HEIGHT_MISSING() {
        class: Io,
        place: "트리 행 표시 설정 읽기",
        cause: "쉘 스타일에 트리 행 높이가 없다",
        message: "트리 행 높이 설정을 읽지 못했습니다. 쉘 스타일에서 행 높이를 설정하세요.",
        fix: "쉘 스타일에 트리 행 높이를 설정하세요"
    }
    SHELL_COPY_TEXT_EMPTY() {
        class: InvalidRequest,
        place: "화면 글 복사",
        cause: "copy_text 바인딩이 빈 문자열이다",
        message: "복사할 글이 없습니다. 앱 정의의 copy_text 값이 빈 글이 아닌지 확인하세요.",
        fix: "앱 정의의 copy_text 값에 복사할 글을 넣으세요"
    }
    SHELL_COPY_TEXT_NOT_TEXT() {
        class: InvalidRequest,
        place: "화면 글 복사",
        cause: "copy_text 바인딩 값이 문자열이 아니다",
        message: "복사할 값이 글이 아닙니다. 앱 정의의 copy_text가 글을 내는 바인딩인지 확인하세요.",
        fix: "앱 정의의 copy_text가 글을 내는 바인딩인지 확인하세요"
    }
    SHELL_COPY_TEXT_WRITE_FAILED(reason) {
        class: Io,
        place: "화면 글 클립보드 쓰기",
        cause: "브라우저가 클립보드 쓰기를 거부했다",
        message: "클립보드에 쓰지 못했습니다. 클립보드 권한을 확인한 뒤 다시 누르세요. 원인: {reason}",
        fix: "클립보드 권한을 확인한 뒤 다시 누르세요"
    }
    SHELL_MENU_CLIPBOARD_WRITE_FAILED(item, reason) {
        class: Io,
        place: "메뉴 클립보드 쓰기",
        cause: "브라우저가 메뉴의 클립보드 쓰기를 거부했다",
        message: "{item} 항목을 클립보드에 쓰지 못했습니다. 클립보드 권한을 확인한 뒤 다시 시도하세요. 원인: {reason}",
        fix: "클립보드 권한을 확인한 뒤 다시 시도하세요"
    }
    SHELL_MENU_CLIPBOARD_READ_FAILED(reason) {
        class: Io,
        place: "메뉴 붙여넣기 클립보드 읽기",
        cause: "브라우저가 메뉴의 클립보드 읽기를 거부했다",
        message: "붙여넣을 글을 클립보드에서 읽지 못했습니다. 클립보드 권한을 확인한 뒤 다시 시도하세요. 원인: {reason}",
        fix: "클립보드 권한을 확인한 뒤 다시 시도하세요"
    }

}
