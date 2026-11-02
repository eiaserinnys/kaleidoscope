error_catalog! { ENTRIES;
    SHELL_THREAD_READ_INVALID(name) {
        class: InvalidRequest,
        place: "HTML 문서 커멘트 읽기",
        cause: "thread.json을 JSON으로 읽을 수 없거나 커멘트 문서 구조가 올바르지 않다",
        message: "문서 {name}의 thread.json 형식이 올바르지 않습니다. 파일을 고쳐 다시 저장하세요.",
        fix: "thread.json 파일을 고쳐 다시 저장하세요"
    }
    SHELL_CALL_UNEXPECTED_FAILURE(reason) {
        class: Io,
        place: "쉘 코어 호출 응답 처리",
        cause: "호출에서 코어 오류 형식이 아닌 예외가 발생했다",
        message: "쉘에서 예상하지 못한 오류가 났습니다: {reason}",
        fix: "표시된 원인을 확인하고 다시 시도하세요"
    }
    SHELL_IPC_OPERATION_HEADER_INVALID() {
        class: InvalidRequest,
        place: "쉘 이진 요청 종류 확인",
        cause: "요청 종류 정보가 없거나 올바른 문자열이 아니다",
        message: "쉘 이진 요청 종류를 읽지 못했습니다. 요청을 다시 보내세요.",
        fix: "쉘 요청을 다시 보내세요"
    }
    SHELL_IPC_WINDOW_HEADER_INVALID() {
        class: InvalidRequest,
        place: "쉘 이진 요청 창 정보 확인",
        cause: "창 정보가 없거나 올바른 문자열이 아니다",
        message: "쉘 이진 요청의 창 정보를 읽지 못했습니다. 요청을 다시 보내세요.",
        fix: "쉘 요청을 다시 보내세요"
    }
    SHELL_IPC_HANDLE_HEADER_INVALID() {
        class: InvalidRequest,
        place: "쉘 이진 요청 대상 정보 확인",
        cause: "요청 대상 정보가 없거나 올바른 문자열이 아니다",
        message: "쉘 이진 요청의 대상 정보를 읽지 못했습니다. 요청을 다시 보내세요.",
        fix: "쉘 요청을 다시 보내세요"
    }
    SHELL_IPC_BODY_INVALID() {
        class: InvalidRequest,
        place: "쉘 이진 IPC 본문 확인",
        cause: "요청 본문이 raw 이진 데이터가 아니다",
        message: "쉘 이진 요청의 본문이 올바른 형식이 아닙니다. 이진 데이터를 다시 보내세요.",
        fix: "raw 이진 본문을 보내세요"
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
        place: "쉘 이진 요청 종류 확인",
        cause: "요청 종류가 지원되는 이진 작업이 아니다",
        message: "쉘에서 지원하지 않는 이진 작업입니다. 파일 읽기, 내보내기, HTTP 읽기 또는 Blob 저장을 사용하세요.",
        fix: "지원되는 이진 작업을 사용하세요"
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
        message: "쉘 이진 작업이 중단되어 요청을 마치지 못했습니다. 다시 시도하세요.",
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
    SHELL_CANVAS_DUPLICATE_SURFACE(id) {
        class: InvalidRequest,
        place: "창의 캔버스 표면 등록",
        cause: "같은 창에서 이미 사용 중인 표면 이름을 다시 사용했다",
        message: "중복 표면 이름 {id}: 이 창에서 이미 사용 중입니다. 캔버스마다 다른 이름을 지정하세요.",
        fix: "캔버스마다 유일한 이름을 지정하세요"
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
        place: "HTML 문서 코멘트 목록 읽기",
        cause: "목록 명령이 다른 종류의 응답을 받았다",
        message: "HTML 문서의 코멘트 목록을 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_HTML_COMMENT_THREAD_REPLY_INVALID() {
        class: Io,
        place: "HTML 문서 코멘트 읽기",
        cause: "코멘트 읽기 명령이 다른 종류의 응답을 받았다",
        message: "HTML 문서의 코멘트를 읽지 못했습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하고 다시 시도하세요"
    }
    SHELL_HTML_COMMENT_SAVE_CONFLICT() {
        class: Conflict,
        place: "HTML 문서 코멘트 저장",
        cause: "세 번 다시 저장해도 다른 창의 변경과 충돌한다",
        message: "HTML 문서 코멘트를 저장하는 동안 다른 창에서 내용이 바뀌었습니다. 문서를 다시 불러온 뒤 저장하세요.",
        fix: "문서를 다시 불러온 뒤 코멘트를 저장하세요"
    }
    SHELL_APP_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 창 내용 표시",
        cause: "표시할 창이 현재 상태에 없다",
        message: "앱 창이 사라져 내용을 표시할 수 없습니다. 창 목록을 다시 불러오세요.",
        fix: "창 목록을 다시 불러오세요"
    }
    SHELL_APP_VERSION_NOT_FOUND() {
        class: NotFound,
        place: "앱 창 정의 읽기",
        cause: "창이 참조하는 앱 정의를 찾을 수 없다",
        message: "앱 정의를 찾을 수 없어 창을 표시하지 못했습니다. 앱 목록을 다시 불러오세요.",
        fix: "앱 목록을 다시 불러오세요"
    }
    SHELL_WINDOW_DATA_CONTEXT_MISSING() {
        class: Io,
        place: "창 데이터 접근",
        cause: "창 데이터 연결 없이 데이터 블록을 렌더링했다",
        message: "창 데이터가 연결되지 않아 화면을 그릴 수 없습니다. 쉘을 다시 열어 보세요.",
        fix: "쉘을 다시 열어 보세요"
    }
    SHELL_CLIENT_DATA_CONTEXT_MISSING() {
        class: Io,
        place: "창 클라이언트 데이터 접근",
        cause: "창 데이터 연결 없이 클라이언트 동작을 요청했다",
        message: "창 데이터가 연결되지 않아 앱 동작을 실행할 수 없습니다. 쉘을 다시 열어 보세요.",
        fix: "쉘을 다시 열어 보세요"
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
        message: "앱 실행 화면이 예상과 다르게 바뀌어 실행을 멈췄습니다. 쉘을 다시 열어 보세요.",
        fix: "쉘을 다시 열어 앱을 실행하세요"
    }
    SHELL_CLIENT_UNRESPONSIVE() {
        class: Io,
        place: "앱 클라이언트 응답 확인",
        cause: "앱 프레임이 제한 시간 안에 응답하지 않았다",
        message: "앱이 응답하지 않아 실행을 멈췄습니다. 앱을 다시 열어 보세요.",
        fix: "앱을 다시 열어 보세요"
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
        message: "파일 저장에 필요한 이름이나 형식이 올바르지 않습니다. 파일 이름과 형식을 다시 지정하세요.",
        fix: "파일 이름과 형식을 다시 지정하세요"
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
        message: "앱 정의에 share capability가 없어 파일을 공유할 수 없습니다. 앱 정의에 권한을 추가하세요.",
        fix: "앱 정의의 capabilities에 share를 추가하세요"
    }
    SHELL_CLIENT_CAN_SHARE_ACTION_REQUIRED() {
        class: InvalidRequest,
        place: "앱 파일 공유 가능 여부 확인",
        cause: "클라이언트 동작 밖에서 공유 가능 여부를 확인했다",
        message: "파일 공유 가능 여부는 앱 동작 중에만 확인할 수 있습니다. 앱 동작에서 다시 요청하세요.",
        fix: "앱 동작 안에서 파일 공유 가능 여부를 확인하세요"
    }
    SHELL_CLIENT_SHARE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 호스트 파일 공유",
        cause: "앱 정의에 share capability가 없다",
        message: "앱 정의에 share capability가 없어 파일을 공유할 수 없습니다. 앱 정의에 권한을 추가하세요.",
        fix: "앱 정의의 capabilities에 share를 추가하세요"
    }
    SHELL_CLIENT_SHARE_ACTION_REQUIRED() {
        class: InvalidRequest,
        place: "앱 파일 공유",
        cause: "클라이언트 동작 밖에서 파일 공유를 요청했다",
        message: "파일 공유는 앱 동작 중에만 할 수 있습니다. 앱 동작에서 다시 요청하세요.",
        fix: "앱 동작 안에서 파일을 공유하세요"
    }
    SHELL_CLIENT_KEEP_AWAKE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 호스트 화면 켜짐 유지",
        cause: "앱 정의에 keep_awake capability가 없다",
        message: "앱 정의에 keep_awake capability가 없어 화면을 켜 둘 수 없습니다. 앱 정의에 capability를 추가하세요.",
        fix: "앱 정의의 capabilities에 keep_awake를 추가하세요"
    }
    SHELL_CLIENT_KEEP_AWAKE_ACTION_REQUIRED() {
        class: InvalidRequest,
        place: "화면 켜짐 유지",
        cause: "클라이언트 동작 밖에서 화면 켜짐 유지를 요청했다",
        message: "화면 켜짐 유지는 앱 동작 중에만 바꿀 수 있습니다. 앱 동작에서 다시 요청하세요.",
        fix: "앱 동작 안에서 화면 켜짐 유지를 바꾸세요"
    }
    SHELL_CLIENT_FRAME_CAN_SHARE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 프레임 파일 공유 가능 여부 확인",
        cause: "앱 정의에 share capability가 없다",
        message: "앱 정의에 share capability가 없어 파일을 공유할 수 없습니다. 앱 정의에 권한을 추가하세요.",
        fix: "앱 정의의 capabilities에 share를 추가하세요"
    }
    SHELL_CLIENT_FRAME_SHARE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 프레임 파일 공유",
        cause: "앱 정의에 share capability가 없다",
        message: "앱 정의에 share capability가 없어 파일을 공유할 수 없습니다. 앱 정의에 권한을 추가하세요.",
        fix: "앱 정의의 capabilities에 share를 추가하세요"
    }
    SHELL_CLIENT_FRAME_KEEP_AWAKE_CAPABILITY_UNDECLARED() {
        class: PermissionDenied,
        place: "앱 프레임 화면 켜짐 유지",
        cause: "앱 정의에 keep_awake capability가 없다",
        message: "앱 정의에 keep_awake capability가 없어 화면을 켜 둘 수 없습니다. 앱 정의에 capability를 추가하세요.",
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
        message: "이 쉘에서는 앱이 공개 자료를 읽을 수 없습니다. 최신 쉘로 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SHELL_CLIENT_BLOB_INPUT_INVALID() {
        class: Io,
        place: "앱 저장 항목에 파일 쓰기",
        cause: "파일과 바이트를 모두 주거나 둘 다 주지 않았다",
        message: "파일 또는 바이트 하나를 지정해야 합니다. 둘 중 하나만 골라 다시 저장하세요.",
        fix: "파일 또는 바이트 하나만 지정하세요"
    }
    SHELL_CLIENT_BLOB_TRANSPORT_UNAVAILABLE() {
        class: Io,
        place: "앱 저장 항목에 파일 쓰기",
        cause: "현재 쉘에 이진 요청 전송 기능이 없다",
        message: "이 쉘에서는 파일을 앱 저장 항목에 쓸 수 없습니다. 최신 쉘로 업데이트한 뒤 다시 시도하세요.",
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
        message: "파일 크기 {size}바이트가 올바르지 않습니다. 앱에서 파일 크기를 다시 지정하세요.",
        fix: "앱에서 0 이상의 정수 크기를 지정하세요"
    }
    SHELL_CLIENT_OUTPUT_SERIALIZE_FAILED(name) {
        class: InvalidRequest,
        place: "앱 클라이언트 출력 JSON 변환",
        cause: "출력값을 JSON으로 바꿀 수 없다",
        message: "앱 출력 {name}: JSON으로 읽을 수 없습니다. 출력값을 JSON으로 바꾼 뒤 다시 보내세요.",
        fix: "앱 출력값을 JSON으로 바꾸세요"
    }
    SHELL_CLIENT_OUTPUT_TOO_LARGE(name, max_bytes) {
        class: InvalidRequest,
        place: "앱 클라이언트 출력 크기 확인",
        cause: "출력 JSON이 허용 크기를 넘었다",
        message: "앱 출력 {name}: {max_bytes}바이트를 넘어 전달하지 못했습니다. 출력 크기를 줄이세요.",
        fix: "앱 출력 크기를 줄이세요"
    }
    SHELL_CLIENT_ACTION_FAILED(reason) {
        class: Io,
        place: "앱 클라이언트 동작 실행",
        cause: "앱 클라이언트 동작에서 예외가 발생했다",
        message: "앱 동작을 끝내지 못했습니다: {reason}. 앱의 클라이언트 코드를 확인하세요.",
        fix: "표시된 원인을 확인하고 앱 클라이언트 코드를 고치세요"
    }
    SHELL_CLIENT_FILE_PICK_TOO_LARGE(name, max_bytes) {
        class: Io,
        place: "앱에 파일 전달",
        cause: "고른 파일이 앱 전달 한도를 넘었다",
        message: "파일 크기 초과: {name}. 앱에 전달할 수 있는 크기는 {max_bytes}바이트까지입니다. 더 작은 파일을 선택하세요.",
        fix: "더 작은 파일을 선택하세요"
    }
    SHELL_CLIENT_FILE_NOT_FOUND(file_id) {
        class: Io,
        place: "앱이 고른 파일 읽기",
        cause: "현재 앱 창에서 파일을 찾을 수 없다",
        message: "파일 식별자 {file_id}: 이 앱 창에서 찾을 수 없습니다. 파일을 다시 고르세요.",
        fix: "파일을 다시 고르세요"
    }
    SHELL_CLIENT_FILE_READ_TOO_LARGE(name, max_bytes) {
        class: Io,
        place: "앱이 고른 파일 읽기",
        cause: "파일 크기가 앱 전달 한도를 넘었다",
        message: "파일 크기 초과: {name}. 앱에 전달할 수 있는 크기는 {max_bytes}바이트까지입니다. 더 작은 파일을 선택하세요.",
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
        message: "파일 쓰기 위치 {offset}: 올바른 0 이상의 정수가 아닙니다. 앱에서 위치를 다시 지정하세요.",
        fix: "앱에서 0 이상의 정수 위치를 지정하세요"
    }
    SHELL_CLIENT_FILE_WRITE_TOO_LARGE() {
        class: Io,
        place: "앱 파일 내보내기 쓰기",
        cause: "브라우저 임시 파일 크기가 64MiB를 넘었다",
        message: "이 브라우저에서는 64MiB보다 큰 파일을 내보낼 수 없습니다. 작은 파일로 나누어 저장하세요.",
        fix: "파일을 64MiB 이하로 나누어 저장하세요"
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
        message: "새 파일 크기 {size}바이트가 올바르지 않습니다. 앱에서 다시 지정하세요.",
        fix: "앱에서 0 이상의 정수 크기를 지정하세요"
    }
    SHELL_CLIENT_FILE_TRUNCATE_TOO_LARGE() {
        class: Io,
        place: "앱 파일 내보내기 크기 변경",
        cause: "브라우저 임시 파일 크기가 64MiB를 넘었다",
        message: "이 브라우저에서는 64MiB보다 큰 파일을 내보낼 수 없습니다. 작은 파일로 나누어 저장하세요.",
        fix: "파일을 64MiB 이하로 나누어 저장하세요"
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
        message: "취소할 파일 내보내기 대상을 찾을 수 없습니다. 파일을 다시 선택하세요.",
        fix: "필요하면 파일을 다시 선택하세요"
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
        cause: "클라이언트 동작 밖에서 파일 저장 대화상자를 열었다",
        message: "파일 저장 대화상자는 앱 동작 중에만 열 수 있습니다. 앱 동작에서 다시 요청하세요.",
        fix: "앱 동작 안에서 파일 저장을 요청하세요"
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
    SHELL_CHAT_ATTACHMENT_TOO_LARGE(name, max_bytes) {
        class: InvalidRequest,
        place: "대화 첨부 추가",
        cause: "고른 첨부 파일이 크기 제한을 넘었다",
        message: "첨부 파일 크기 초과: {name}. 보낼 수 있는 크기는 {max_bytes}바이트까지입니다. 작은 파일을 고르세요.",
        fix: "작은 파일을 고르세요"
    }
    SHELL_CHAT_ATTACHMENT_TOTAL_TOO_LARGE(max_bytes) {
        class: InvalidRequest,
        place: "대화 첨부 추가",
        cause: "첨부 파일의 합계가 크기 제한을 넘었다",
        message: "첨부 파일 합계는 {max_bytes}바이트까지입니다. 파일 수나 크기를 줄이세요.",
        fix: "첨부 파일 수나 크기를 줄이세요"
    }
}
