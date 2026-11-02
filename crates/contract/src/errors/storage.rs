error_catalog! { ENTRIES;
    STORAGE_WRITE_SCHEMA_MISMATCH(key, reason) {
        class: InvalidRequest,
        place: "저장소 내용 검사",
        cause: "쓴 값이 항목에 선언된 JSON 스키마를 만족하지 않는다",
        message: "저장 항목 {key}의 값이 앱 선언과 맞지 않습니다. {reason} 값을 고쳐 다시 저장하세요.",
        fix: "앱 정의의 저장소 스키마와 저장하는 값을 대조해 고치세요"
    }
    STORAGE_WRITE_SCHEMA_MISSING(key) {
        class: InvalidRequest,
        place: "저장소 JSON 항목 검사",
        cause: "JSON 항목에 스키마 선언이 없다",
        message: "저장 항목에 JSON 형식 선언이 없습니다: {key}. 앱 정의에 schema를 추가한 뒤 다시 저장하세요.",
        fix: "앱 정의의 저장 항목에 JSON schema를 추가하세요"
    }
    STORAGE_WRITE_JSON_SERIALIZATION_FAILED(key) {
        class: InvalidRequest,
        place: "저장소 JSON 항목 검사",
        cause: "JSON 값을 직렬화할 수 없다",
        message: "저장 항목 {key}의 값을 JSON으로 만들지 못했습니다. JSON으로 표현할 수 있는 값으로 바꾼 뒤 다시 저장하세요.",
        fix: "JSON으로 표현할 수 있는 값으로 바꾸세요"
    }
    STORAGE_WRITE_JSON_TOO_LARGE(key, max_bytes) {
        class: InvalidRequest,
        place: "저장소 JSON 항목 검사",
        cause: "직렬화한 JSON 값이 허용 크기를 넘는다",
        message: "저장 항목 {key}의 JSON 값이 {max_bytes}바이트를 넘습니다. 값을 줄인 뒤 다시 저장하세요.",
        fix: "저장할 JSON 값을 허용 크기 안으로 줄이세요"
    }
    STORAGE_WRITE_MD_TOO_LARGE(key, max_bytes) {
        class: InvalidRequest,
        place: "저장소 Markdown 항목 검사",
        cause: "Markdown 원문이 허용 크기를 넘는다",
        message: "저장 항목 {key}의 Markdown 원문이 {max_bytes} UTF-8 바이트를 넘습니다. 내용을 줄인 뒤 다시 저장하세요.",
        fix: "Markdown 내용을 허용 크기 안으로 줄이세요"
    }
    STORAGE_WRITE_MD_NOT_STRING(key) {
        class: InvalidRequest,
        place: "저장소 Markdown 항목 검사",
        cause: "Markdown 값이 문자열이 아니다",
        message: "저장 항목 {key}의 Markdown 값이 문자열이 아닙니다. 문자열로 바꾼 뒤 다시 저장하세요.",
        fix: "Markdown 저장값을 문자열로 바꾸세요"
    }
    STORAGE_SERVER_UNAUTHORIZED() {
        class: Server,
        place: "저장소 서버 요청",
        cause: "서버가 저장소 인증을 거부했다",
        message: "kaleidoscope 서버가 저장소 인증을 거부했습니다. 서버 연결을 다시 확인하세요.",
        fix: "기기 연결을 다시 확인하세요"
    }
    STORAGE_SERVER_NOT_FOUND() {
        class: Server,
        place: "저장소 서버 요청",
        cause: "서버가 저장소 요청 대상을 찾지 못했다",
        message: "kaleidoscope 서버에서 저장소 요청 대상을 찾지 못했습니다. 앱과 저장 항목을 확인한 뒤 다시 시도하세요.",
        fix: "앱과 저장 항목이 현재 선언에 있는지 확인하세요"
    }
    STORAGE_SERVER_REQUEST_FAILED() {
        class: Server,
        place: "저장소 서버 요청",
        cause: "서버 요청이 네트워크 또는 서버 오류로 끝났다",
        message: "kaleidoscope 서버가 저장소 요청을 처리하지 못했습니다. 연결을 확인한 뒤 다시 시도하세요.",
        fix: "서버 연결 상태를 확인하고 다시 시도하세요"
    }
    STORAGE_WINDOW_NOT_FOUND(window_id) {
        class: NotFound,
        place: "창 저장소 접근",
        cause: "저장소를 열 창이 현재 상태에 없다",
        message: "창 ID {window_id}: 저장소를 열 수 없습니다. 창 목록을 새로고침한 뒤 다시 시도하세요.",
        fix: "창 목록을 새로고침하세요"
    }
    STORAGE_DESKTOP_NOT_FOUND(desktop_id) {
        class: NotFound,
        place: "창 저장소 작업 확인",
        cause: "창의 데스크톱이 현재 상태에 없다",
        message: "데스크톱 ID {desktop_id}: 창에서 사용할 데스크톱을 찾지 못했습니다. 창을 다시 열어 시도하세요.",
        fix: "창을 다시 여세요"
    }
    STORAGE_APP_VERSION_NOT_FOUND(app_id, version) {
        class: NotFound,
        place: "앱 저장소 선언 조회",
        cause: "창에서 사용하는 앱 버전이 없다",
        message: "앱 ID {app_id}, 버전 {version}: 저장소에 필요한 앱 버전이 없습니다. 앱을 다시 가져와 시도하세요.",
        fix: "앱을 다시 가져오세요"
    }
    STORAGE_DECLARATION_MISSING(app_id) {
        class: InvalidRequest,
        place: "앱 저장소 선언 조회",
        cause: "앱 정의에 저장소가 선언되지 않았다",
        message: "앱 ID {app_id}: 저장소가 선언되지 않았습니다. 저장소를 선언한 뒤 다시 시도하세요.",
        fix: "앱 정의의 저장소 선언을 확인하세요"
    }
    STORAGE_ENTRY_NOT_DECLARED(entry_id) {
        class: InvalidRequest,
        place: "앱 저장 항목 조회",
        cause: "요청한 항목 id가 앱 정의에 없다",
        message: "저장 항목 {entry_id}: 앱 정의에 없습니다. 선언된 항목을 골라 다시 시도하세요.",
        fix: "앱에 선언된 저장 항목 id를 사용하세요"
    }
    STORAGE_COLLECTION_LIST_REQUIRED(entry_id) {
        class: InvalidRequest,
        place: "저장 문서 목록 요청",
        cause: "요청한 항목이 문서 모음으로 선언되지 않았다",
        message: "저장 항목 {entry_id}: 문서 모음으로 선언되지 않았습니다. 문서 모음 항목의 목록을 요청하세요.",
        fix: "문서 모음으로 선언된 항목을 선택하세요"
    }
    STORAGE_COLLECTION_READ_REQUIRED(entry_id) {
        class: InvalidRequest,
        place: "저장 문서 읽기 요청",
        cause: "읽기를 요청한 항목이 문서 모음으로 선언되지 않았다",
        message: "저장 항목 {entry_id}: 문서 모음으로 선언되지 않았습니다. 문서 모음 항목에서 문서를 읽으세요.",
        fix: "문서 모음으로 선언된 항목에서 문서를 읽으세요"
    }
    STORAGE_COLLECTION_WRITE_REQUIRED(entry_id) {
        class: InvalidRequest,
        place: "저장 문서 쓰기 요청",
        cause: "쓰기를 요청한 항목이 문서 모음으로 선언되지 않았다",
        message: "저장 항목 {entry_id}: 문서 모음으로 선언되지 않았습니다. 문서 모음 항목에 문서를 쓰세요.",
        fix: "문서 모음으로 선언된 항목에 문서를 쓰세요"
    }
    STORAGE_COLLECTION_RESET_REQUIRED(entry_id) {
        class: InvalidRequest,
        place: "저장 문서 초기화 요청",
        cause: "초기화를 요청한 항목이 문서 모음으로 선언되지 않았다",
        message: "저장 항목 {entry_id}: 문서 모음으로 선언되지 않았습니다. 문서 모음 항목에서 문서를 초기화하세요.",
        fix: "문서 모음으로 선언된 항목에서 문서를 초기화하세요"
    }
    STORAGE_COLLECTION_MOVE_REQUIRED(entry_id) {
        class: InvalidRequest,
        place: "저장 문서 이름 변경 요청",
        cause: "이름 변경을 요청한 항목이 문서 모음으로 선언되지 않았다",
        message: "저장 항목 {entry_id}: 문서 모음으로 선언되지 않았습니다. 문서 모음 항목의 문서 이름을 바꾸세요.",
        fix: "문서 모음으로 선언된 항목의 문서 이름을 바꾸세요"
    }
    STORAGE_READ_COLLECTION_NEEDS_DOC(entry_id) {
        class: InvalidRequest,
        place: "저장 항목 읽기 요청",
        cause: "문서 모음 항목을 읽으면서 문서 이름을 지정하지 않았다",
        message: "저장 항목 {entry_id}: 문서 모음이라 문서 이름을 함께 지정해야 합니다. 문서 이름을 넣어 다시 읽으세요.",
        fix: "읽을 문서 이름을 지정하세요"
    }
    STORAGE_WRITE_COLLECTION_NEEDS_DOC(entry_id) {
        class: InvalidRequest,
        place: "저장 항목 쓰기 요청",
        cause: "문서 모음 항목에 쓰면서 문서 이름을 지정하지 않았다",
        message: "저장 항목 {entry_id}: 문서 모음이라 문서 이름을 함께 지정해야 합니다. 문서 이름을 넣어 다시 저장하세요.",
        fix: "저장할 문서 이름을 지정하세요"
    }
    STORAGE_RESET_COLLECTION_NEEDS_DOC(entry_id) {
        class: InvalidRequest,
        place: "저장 항목 초기화 요청",
        cause: "문서 모음 항목을 초기화하면서 문서 이름을 지정하지 않았다",
        message: "저장 항목 {entry_id}: 문서 모음이라 문서 이름을 함께 지정해야 합니다. 초기화할 문서 이름을 넣으세요.",
        fix: "초기화할 문서 이름을 지정하세요"
    }
    STORAGE_WORKSPACE_REQUIRED(key) {
        class: InvalidRequest,
        place: "작업별 저장 키 만들기",
        cause: "저장 키에 작업 id가 필요하지만 전달되지 않았다",
        message: "작업별 저장 키를 만들려면 작업 id가 필요합니다: {key}. 작업을 선택한 뒤 다시 시도하세요.",
        fix: "작업을 선택하세요"
    }
    STORAGE_WORKSPACE_KEY_INVALID(key) {
        class: InvalidRequest,
        place: "작업별 저장 키 만들기",
        cause: "작업 id를 넣은 저장 키가 선언과 맞지 않는다",
        message: "작업 id를 넣은 저장 키가 앱 선언과 맞지 않습니다: {key}. 앱 정의와 작업 id를 확인하세요.",
        fix: "앱 정의의 저장 키와 작업 id를 확인하세요"
    }
    STORAGE_WORKSPACE_NOT_OWNED(workspace_id) {
        class: NotFound,
        place: "작업별 저장소 접근",
        cause: "현재 계정에 속한 작업이 없다",
        message: "작업 ID {workspace_id}: 현재 계정에 속한 작업을 찾지 못해 저장소에 접근할 수 없습니다. 현재 계정의 작업을 선택하세요.",
        fix: "현재 계정에 속한 작업을 선택하세요"
    }
    STORAGE_STORED_KIND_INVALID(key) {
        class: Server,
        place: "저장값 읽기",
        cause: "저장된 항목의 종류가 앱 선언과 다르다",
        message: "저장 항목 {key}의 종류가 앱 선언과 다릅니다. 저장소 상태를 확인하고 다시 시도하세요.",
        fix: "저장 항목 선언과 저장된 종류를 확인하세요"
    }
    STORAGE_RECEIVED_KIND_MISMATCH(key) {
        class: InvalidRequest,
        place: "서버 저장값 읽기",
        cause: "서버가 보낸 저장 항목 종류가 앱 선언과 다르다",
        message: "저장 항목 {key}의 종류가 서버 응답과 앱 선언에서 다릅니다. 저장소를 새로고침한 뒤 다시 읽으세요.",
        fix: "서버 응답과 앱 선언의 저장 항목 종류를 확인하세요"
    }
    STORAGE_STORED_CONTENT_INVALID(key) {
        class: Server,
        place: "저장값 읽기",
        cause: "저장된 항목을 JSON으로 읽을 수 없다",
        message: "저장 항목 {key}의 내용을 읽을 수 없습니다. 저장소 상태를 확인하고 다시 시도하세요.",
        fix: "저장소의 저장값을 확인하세요"
    }
    STORAGE_STORED_KIND_MISSING(key) {
        class: InvalidRequest,
        place: "서버 저장값 읽기",
        cause: "서버 응답에 저장 항목 종류가 없다",
        message: "저장 항목 {key}의 종류가 서버 응답에 없습니다. 서버 연결을 새로고침한 뒤 다시 읽으세요.",
        fix: "서버 연결을 새로고침하고 다시 읽으세요"
    }
    STORAGE_STORED_CONTENT_MISSING(key) {
        class: InvalidRequest,
        place: "서버 저장값 읽기",
        cause: "서버 응답에 저장 항목 내용이 없다",
        message: "저장 항목 {key}의 내용이 서버 응답에 없습니다. 서버 연결을 새로고침한 뒤 다시 읽으세요.",
        fix: "서버 연결을 새로고침하고 다시 읽으세요"
    }
    STORAGE_DOCUMENT_READ_NOT_FOUND(doc) {
        class: NotFound,
        place: "저장 문서 읽기",
        cause: "문서 모음에 요청한 문서가 없다",
        message: "저장 문서를 찾을 수 없습니다: {doc}. 문서 목록을 새로고침한 뒤 다시 시도하세요.",
        fix: "문서 목록을 새로고침하세요"
    }
    STORAGE_DOCUMENT_MOVE_SOURCE_NOT_FOUND(doc) {
        class: NotFound,
        place: "저장 문서 이름 변경",
        cause: "이름을 바꾸려는 원본 문서가 없다",
        message: "이름을 바꿀 저장 문서를 찾을 수 없습니다: {doc}. 문서 목록을 새로고침한 뒤 다시 시도하세요.",
        fix: "문서 목록을 새로고침하세요"
    }
    STORAGE_DOCUMENT_KEY_INVALID(doc) {
        class: InvalidRequest,
        place: "저장 문서 키 만들기",
        cause: "문서 이름으로 선언된 저장 키를 만들 수 없다",
        message: "저장 문서 이름으로 유효한 저장 키를 만들 수 없습니다: {doc}. 문서 이름을 고친 뒤 다시 시도하세요.",
        fix: "문서 이름을 고치세요"
    }
    STORAGE_DOCUMENT_NAME_REQUIRED() {
        class: InvalidRequest,
        place: "저장 문서 요청 검사",
        cause: "문서 모음 요청에 문서 이름이 없다",
        message: "저장 문서 이름이 필요합니다. 문서 이름을 지정한 뒤 다시 시도하세요.",
        fix: "문서 이름을 지정하세요"
    }
    STORAGE_DOCUMENT_NAME_INVALID(doc) {
        class: InvalidRequest,
        place: "저장 문서 요청 검사",
        cause: "문서 이름이 허용된 형식이 아니다",
        message: "저장 문서 이름이 허용된 형식이 아닙니다: {doc}. 문서 이름을 고쳐 다시 시도하세요.",
        fix: "문서 이름에 허용된 문자와 경로를 사용하세요"
    }
    STORAGE_DOCUMENT_READ_KIND_MISMATCH(doc) {
        class: Server,
        place: "저장 문서 읽기",
        cause: "저장된 문서 종류가 항목 선언과 다르다",
        message: "저장 문서 {doc}의 종류가 앱 선언과 다릅니다. 문서 목록을 새로고침한 뒤 다시 시도하세요.",
        fix: "저장 문서 종류와 항목 선언을 확인하세요"
    }
    STORAGE_DOCUMENT_MOVE_KIND_MISMATCH(doc) {
        class: Server,
        place: "저장 문서 이름 변경",
        cause: "이름을 바꾸려는 문서 종류가 항목 선언과 다르다",
        message: "저장 문서 {doc}의 종류가 앱 선언과 다릅니다. 문서 목록을 새로고침한 뒤 다시 시도하세요.",
        fix: "저장 문서 종류와 항목 선언을 확인하세요"
    }
    STORAGE_DOCUMENT_SERIALIZATION_FAILED(doc) {
        class: Server,
        place: "저장 문서 쓰기",
        cause: "저장할 문서 내용을 JSON으로 직렬화할 수 없다",
        message: "저장 문서 {doc}의 내용을 저장 형식으로 만들지 못했습니다. 내용을 고친 뒤 다시 저장하세요.",
        fix: "저장 문서 내용을 JSON으로 표현할 수 있게 고치세요"
    }
    STORAGE_DOCUMENT_REVISION_FAILED(doc) {
        class: InvalidRequest,
        place: "저장 문서 revision 만들기",
        cause: "문서 내용을 바탕으로 revision을 만들 수 없다",
        message: "저장 문서 {doc}의 변경 확인값을 만들지 못했습니다. 문서 내용을 고친 뒤 다시 저장하세요.",
        fix: "문서 내용을 확인하세요"
    }
    STORAGE_PREVIEW_VALUE_INVALID(key) {
        class: Server,
        place: "저장값 미리 보기",
        cause: "저장된 값이 앱 선언과 맞지 않아 미리 보기를 만들 수 없다",
        message: "저장 항목 {key}의 값이 앱 선언과 맞지 않아 미리 보기를 만들 수 없습니다. 저장값을 확인하세요.",
        fix: "저장 항목 값과 앱 선언을 확인하세요"
    }
    STORAGE_SERVER_WRITE_CONFLICT() {
        class: Conflict,
        place: "저장 항목 쓰기",
        cause: "서버가 저장 항목 쓰기 충돌을 알렸지만 오류 코드가 없다",
        message: "저장 항목이 읽은 뒤 바뀌었습니다. 값을 다시 읽고 변경 내용을 적용하세요.",
        fix: "값을 다시 읽고 변경 내용을 적용하세요"
    }
    STORAGE_DOCUMENT_WRITE_CONFLICT(doc) {
        class: Conflict,
        place: "저장 문서 쓰기",
        cause: "읽은 뒤 저장 문서가 바뀌었다",
        message: "저장 문서 {doc}: 읽은 뒤 내용이 바뀌었습니다. 문서를 다시 읽고 변경 내용을 적용하세요.",
        fix: "문서를 다시 읽고 변경 내용을 적용하세요"
    }
    STORAGE_DOCUMENT_RESET_CONFLICT(doc) {
        class: Conflict,
        place: "저장 문서 초기화",
        cause: "읽은 뒤 저장 문서가 바뀌었다",
        message: "저장 문서 {doc}: 읽은 뒤 내용이 바뀌어 초기화하지 못했습니다. 문서를 다시 읽고 초기화하세요.",
        fix: "문서를 다시 읽고 초기화하세요"
    }
    STORAGE_DOCUMENT_MOVE_CONFLICT(doc) {
        class: Conflict,
        place: "저장 문서 이름 변경",
        cause: "읽은 뒤 원본 문서가 바뀌었다",
        message: "저장 문서 {doc}: 읽은 뒤 내용이 바뀌어 이름을 바꾸지 못했습니다. 문서를 다시 읽고 다시 시도하세요.",
        fix: "문서를 다시 읽으세요"
    }
    STORAGE_DOCUMENT_TARGET_EXISTS(doc) {
        class: Conflict,
        place: "저장 문서 이름 변경",
        cause: "같은 이름의 대상 문서가 이미 있다",
        message: "저장 문서 {doc}: 같은 이름의 문서가 이미 있습니다. 다른 이름을 골라 다시 시도하세요.",
        fix: "새 문서 이름을 고르세요"
    }
    STORAGE_PUBLISH_INCOMPATIBLE(app_id) {
        class: InvalidAppDefinition,
        place: "앱 저장소 선언 갱신",
        cause: "새 저장소 선언이 기존 저장값과 맞지 않는다",
        message: "앱 ID {app_id}의 새 저장소 선언이 기존 저장값과 맞지 않습니다. 기존 값과 호환되도록 선언을 고친 뒤 다시 올리세요.",
        fix: "기존 저장값과 호환되는 선언을 사용하세요"
    }
    STORAGE_COMMAND_INVALID() {
        class: InvalidRequest,
        place: "저장소 명령 검사",
        cause: "요청이 저장소에서 지원하지 않는 명령이다",
        message: "저장소에서 지원하지 않는 명령입니다. 저장소 읽기, 쓰기, 초기화 또는 문서 이동을 요청하세요.",
        fix: "저장소에서 지원하는 명령을 사용하세요"
    }
    STORAGE_HTTP_DOCUMENT_READ_REQUIRED() {
        class: InvalidRequest,
        place: "HTTP 저장 문서 읽기 요청",
        cause: "문서 읽기 요청에 문서 이름이 없다",
        message: "문서 이름이 없어 저장 내용을 읽지 못했습니다. doc을 지정해 다시 요청하세요.",
        fix: "doc에 문서 이름을 지정하세요"
    }
    STORAGE_HTTP_DOCUMENT_WRITE_REQUIRED() {
        class: InvalidRequest,
        place: "HTTP 저장 문서 쓰기 요청",
        cause: "문서 쓰기 요청에 문서 이름이 없다",
        message: "문서 이름이 없어 저장하지 못했습니다. doc을 지정해 다시 요청하세요.",
        fix: "doc에 문서 이름을 지정하세요"
    }
    STORAGE_HTTP_DOCUMENT_RESET_REQUIRED() {
        class: InvalidRequest,
        place: "HTTP 저장 문서 초기화 요청",
        cause: "문서 초기화 요청에 문서 이름이 없다",
        message: "문서 이름이 없어 초기화하지 못했습니다. doc을 지정해 다시 요청하세요.",
        fix: "doc에 문서 이름을 지정하세요"
    }
    STORAGE_HTTP_REVISION_REQUIRED() {
        class: InvalidRequest,
        place: "HTTP 저장소 초기화 요청",
        cause: "초기화 요청에 저장값 revision이 없다",
        message: "초기화할 저장값의 revision이 없습니다. 저장값을 다시 읽고 revision과 함께 요청하세요.",
        fix: "저장값을 다시 읽고 revision을 전달하세요"
    }
    STORAGE_CONTEXT_METADATA_MISSING(entry_id) {
        class: Server,
        place: "작업 문맥 저장값 조회",
        cause: "Markdown 저장 항목의 문맥 metadata를 만들지 못했다",
        message: "저장 항목 {entry_id}의 문맥 정보를 찾지 못했습니다. 앱 저장소를 새로고침한 뒤 다시 시도하세요.",
        fix: "앱 저장소를 새로고침하세요"
    }
    STORAGE_VALUES_KIND_UNKNOWN(key, kind) {
        class: Server,
        place: "기본 앱 저장값 목록 읽기",
        cause: "저장된 항목 종류가 지원 값이 아니다",
        message: "저장 항목 {key}의 종류 {kind}: 지원하지 않는 저장 형식입니다. 저장소 상태를 확인하세요.",
        fix: "저장된 항목 종류를 확인하세요"
    }
    STORAGE_VALUES_RESPONSE_SERIALIZATION_FAILED() {
        class: Server,
        place: "기본 앱 저장값 목록 응답 만들기",
        cause: "저장값 목록을 JSON 응답으로 만들지 못했다",
        message: "저장값 목록을 응답으로 만들지 못했습니다. 다시 시도하세요.",
        fix: "저장값 목록을 다시 요청하세요"
    }
    STORAGE_APP_VALUE_APP_NOT_BUILTIN(app_id) {
        class: InvalidRequest,
        place: "기본 앱 저장값 접근",
        cause: "요청한 앱이 쉘 기본 앱이 아니다",
        message: "앱 ID {app_id}: 쉘 기본 앱이 아닙니다. 기본 앱 저장값 도구에는 기본 앱 ID를 사용하세요.",
        fix: "쉘에 포함된 기본 앱 id를 사용하세요"
    }
    STORAGE_APP_VALUE_KEY_INVALID(key) {
        class: InvalidRequest,
        place: "기본 앱 저장 키 검사",
        cause: "저장 키가 허용된 형식이 아니다",
        message: "저장 키 {key}: 앱 선언에서 허용하지 않는 형식입니다. 앱에 선언된 저장 키를 사용하세요.",
        fix: "앱에 선언된 저장 키를 사용하세요"
    }
    STORAGE_APP_VALUE_JSON_TOO_LARGE(key, max_bytes) {
        class: InvalidRequest,
        place: "기본 앱 JSON 저장값 크기 검사",
        cause: "기본 앱 JSON 저장값이 허용 크기를 넘는다",
        message: "저장 항목 {key}의 JSON 값이 {max_bytes}바이트를 넘습니다. 값을 줄인 뒤 다시 저장하세요.",
        fix: "JSON 값을 허용 크기 안으로 줄이세요"
    }
    STORAGE_APP_VALUE_JSON_SERIALIZATION_FAILED(key) {
        class: InvalidRequest,
        place: "기본 앱 JSON 저장값 검사",
        cause: "기본 앱 JSON 저장값을 직렬화할 수 없다",
        message: "저장 항목 {key}의 JSON 값을 만들지 못했습니다. JSON으로 표현할 수 있는 값으로 바꿔 다시 저장하세요.",
        fix: "JSON으로 표현할 수 있는 값으로 바꾸세요"
    }
    STORAGE_APP_VALUE_MD_TOO_LARGE(key, max_bytes) {
        class: InvalidRequest,
        place: "기본 앱 Markdown 저장값 크기 검사",
        cause: "기본 앱 Markdown 저장값이 허용 크기를 넘는다",
        message: "저장 항목 {key}의 Markdown 원문이 {max_bytes} UTF-8 바이트를 넘습니다. 내용을 줄인 뒤 다시 저장하세요.",
        fix: "Markdown 내용을 허용 크기 안으로 줄이세요"
    }
    STORAGE_APP_VALUE_MD_NOT_STRING(key) {
        class: InvalidRequest,
        place: "기본 앱 Markdown 저장값 검사",
        cause: "기본 앱 Markdown 저장값이 문자열이 아니다",
        message: "저장 항목 {key}의 Markdown 값이 문자열이 아닙니다. 문자열로 바꾼 뒤 다시 저장하세요.",
        fix: "Markdown 저장값을 문자열로 바꾸세요"
    }
    STORAGE_APP_VALUE_KIND_MISMATCH(key) {
        class: InvalidRequest,
        place: "기본 앱 저장값 쓰기",
        cause: "저장 요청의 종류가 앱 항목 선언과 다르다",
        message: "저장 항목 {key}의 종류가 앱 선언과 다릅니다. 선언된 종류로 다시 저장하세요.",
        fix: "앱 선언에 맞는 저장값 종류를 사용하세요"
    }
    STORAGE_APP_VALUE_WORKSPACE_MISMATCH(key, workspace_id) {
        class: InvalidRequest,
        place: "기본 앱 작업 저장값 검사",
        cause: "저장 키가 지정된 작업에 속하지 않는다",
        message: "저장 키와 작업 ID가 서로 맞지 않습니다. 저장 키: {key}, 작업 ID: {workspace_id}. 지정한 작업의 저장 키를 사용하세요.",
        fix: "지정한 작업에 속한 저장 키를 사용하세요"
    }
    STORAGE_APP_VALUE_REVISION_FAILED(key) {
        class: InvalidRequest,
        place: "기본 앱 저장 revision 만들기",
        cause: "저장값 revision을 만들 수 없다",
        message: "저장 항목 {key}의 변경 확인값을 만들지 못했습니다. 저장값 형식을 고친 뒤 다시 시도하세요.",
        fix: "저장값 형식을 확인하세요"
    }
    STORAGE_APP_VALUE_WRITE_CONFLICT(key) {
        class: Conflict,
        place: "기본 앱 저장값 쓰기",
        cause: "읽은 뒤 저장값이 바뀌었다",
        message: "저장 항목 {key}: 읽은 뒤 값이 바뀌었습니다. 값을 다시 읽고 변경 내용을 적용하세요.",
        fix: "값을 다시 읽고 변경 내용을 적용하세요"
    }
    STORAGE_APP_VALUE_RESET_CONFLICT(key) {
        class: Conflict,
        place: "기본 앱 저장값 초기화",
        cause: "읽은 뒤 저장값이 바뀌었다",
        message: "저장 항목 {key}: 읽은 뒤 값이 바뀌어 초기화하지 못했습니다. 값을 다시 읽고 초기화하세요.",
        fix: "값을 다시 읽고 초기화하세요"
    }
    STORAGE_APP_VALUE_SERIALIZATION_FAILED(key) {
        class: Server,
        place: "기본 앱 저장값 쓰기",
        cause: "저장값을 JSON으로 직렬화할 수 없다",
        message: "저장 항목 {key}: 저장 형식으로 만들지 못했습니다. 저장값을 다시 만들고 시도하세요.",
        fix: "저장값을 다시 만들고 시도하세요"
    }
    STORAGE_MOVE_OPERATION_INVALID(operation) {
        class: InvalidRequest,
        place: "기본 앱 저장 문서 이동 요청",
        cause: "문서 이동 요청 동작이 move가 아니다",
        message: "저장 문서 동작 {operation}: 지원하지 않습니다. move 동작으로 다시 요청하세요.",
        fix: "operation에 move를 지정하세요"
    }
    STORAGE_MOVE_COLLECTION_MISMATCH(from, to) {
        class: InvalidRequest,
        place: "기본 앱 저장 문서 이동 요청",
        cause: "원본과 대상 문서가 같은 문서 모음에 있지 않다",
        message: "저장 문서 이동 경로 {from} → {to}: 같은 문서 모음에 속하지 않습니다. 같은 문서 모음 안에서 이름을 바꾸세요.",
        fix: "같은 문서 모음 안에서 이름을 바꾸세요"
    }
    STORAGE_APP_DEFINITION_INVALID(app_id) {
        class: Server,
        place: "앱 저장소 선언 읽기",
        cause: "앱 저장소 선언 JSON을 읽을 수 없다",
        message: "앱 ID {app_id}의 저장소 선언을 읽지 못했습니다. 앱 정의를 다시 올린 뒤 시도하세요.",
        fix: "앱 정의를 다시 올리세요"
    }
    STORAGE_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "서버 저장 항목 목록 조회",
        cause: "요청한 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 저장 항목 목록을 만들 앱을 찾지 못했습니다. 앱 목록을 새로고침하고 다시 시도하세요.",
        fix: "현재 계정의 앱 id를 사용하세요"
    }
    STORAGE_READ_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "서버 저장 항목 읽기",
        cause: "읽을 저장 항목이 속한 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 읽을 저장 항목이 속한 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 읽으세요.",
        fix: "현재 계정의 앱에서 저장 항목을 읽으세요"
    }
    STORAGE_WRITE_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "서버 저장 항목 쓰기",
        cause: "쓸 저장 항목이 속한 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 저장할 항목이 속한 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 저장하세요.",
        fix: "현재 계정의 앱에 저장 항목을 쓰세요"
    }
    STORAGE_RESET_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "서버 저장 항목 초기화",
        cause: "초기화할 저장 항목이 속한 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 초기화할 항목이 속한 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 초기화하세요.",
        fix: "현재 계정의 앱에서 저장 항목을 초기화하세요"
    }
    STORAGE_DOCUMENT_LIST_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "저장 문서 목록 조회",
        cause: "문서 목록을 조회할 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 문서 목록을 조회할 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 시도하세요.",
        fix: "현재 계정의 앱에서 문서 목록을 조회하세요"
    }
    STORAGE_DOCUMENT_READ_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "저장 문서 읽기",
        cause: "읽을 문서가 속한 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 읽을 문서가 속한 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 읽으세요.",
        fix: "현재 계정의 앱에서 문서를 읽으세요"
    }
    STORAGE_DOCUMENT_WRITE_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "저장 문서 쓰기",
        cause: "쓸 문서가 속한 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 저장할 문서가 속한 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 저장하세요.",
        fix: "현재 계정의 앱에 문서를 쓰세요"
    }
    STORAGE_DOCUMENT_RESET_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "저장 문서 초기화",
        cause: "초기화할 문서가 속한 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 초기화할 문서가 속한 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 초기화하세요.",
        fix: "현재 계정의 앱에서 문서를 초기화하세요"
    }
    STORAGE_DOCUMENT_MOVE_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "저장 문서 이름 변경",
        cause: "이름을 바꿀 문서가 속한 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 이름을 바꿀 문서가 속한 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 시도하세요.",
        fix: "현재 계정의 앱에서 문서 이름을 바꾸세요"
    }
    STORAGE_MCP_LOOKUP_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "저장소 MCP 앱 조회",
        cause: "저장소를 조회할 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 저장소를 조회할 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 조회하세요.",
        fix: "현재 계정의 앱을 지정하세요"
    }
    STORAGE_APP_DECLARATION_NOT_FOUND(app_id) {
        class: NotFound,
        place: "앱 저장소 목록 조회",
        cause: "앱에 저장소 선언이 없다",
        message: "앱에 저장소 선언이 없습니다: {app_id}. 저장소를 선언한 앱을 선택하세요.",
        fix: "앱 저장소 선언을 확인하세요"
    }
    STORAGE_STORED_SERIALIZATION_FAILED(key) {
        class: Server,
        place: "저장값 쓰기",
        cause: "저장할 값을 JSON으로 직렬화할 수 없다",
        message: "저장 항목 {key}: 저장 형식으로 만들지 못했습니다. 저장값을 다시 만들고 시도하세요.",
        fix: "저장값을 다시 만들고 시도하세요"
    }
    STORAGE_ITEM_WRITE_CONFLICT(key) {
        class: Conflict,
        place: "저장 항목 쓰기",
        cause: "읽은 뒤 저장 항목이 바뀌었다",
        message: "저장 항목 {key}: 읽은 뒤 값이 바뀌었습니다. 값을 다시 읽고 변경 내용을 적용하세요.",
        fix: "값을 다시 읽고 변경 내용을 적용하세요"
    }
    STORAGE_ITEM_RESET_CONFLICT(key) {
        class: Conflict,
        place: "저장 항목 초기화",
        cause: "읽은 뒤 저장 항목이 바뀌었다",
        message: "저장 항목 {key}: 읽은 뒤 값이 바뀌어 초기화하지 못했습니다. 값을 다시 읽고 초기화하세요.",
        fix: "값을 다시 읽고 초기화하세요"
    }
    STORAGE_REVISION_FAILED(key) {
        class: InvalidRequest,
        place: "저장 revision 만들기",
        cause: "저장값 revision을 만들 수 없다",
        message: "저장 항목 {key}의 변경 확인값을 만들지 못했습니다. 저장값 형식을 확인한 뒤 다시 시도하세요.",
        fix: "저장값 형식을 확인하세요"
    }
    STORAGE_SERVER_NOT_CONNECTED() {
        class: Unavailable,
        place: "앱 저장소 서버 연결 확인",
        cause: "저장소 요청에 서버 연결이 필요하지만 연결되지 않았다",
        message: "kaleidoscope 서버에 연결되어 있지 않아 저장소를 사용할 수 없습니다. 서버를 연결한 뒤 다시 시도하세요.",
        fix: "쉘에서 서버를 연결하세요"
    }
    STORAGE_OFFLINE_COLLECTION_UNAVAILABLE(entry_id) {
        class: Unavailable,
        place: "오프라인 저장 문서 읽기",
        cause: "문서 모음은 서버 연결 없이 읽을 수 없다",
        message: "저장 항목 {entry_id}의 문서 모음은 오프라인에서 읽을 수 없습니다. 서버를 연결한 뒤 다시 시도하세요.",
        fix: "서버에 연결하세요"
    }
    STORAGE_READ_DOCUMENT_NAME_NOT_ALLOWED(entry_id) {
        class: InvalidRequest,
        place: "코어 저장 항목 읽기 요청",
        cause: "문서 모음이 아닌 항목에 문서 이름을 지정했다",
        message: "저장 항목 {entry_id}: 문서 모음이 아닙니다. doc 없이 항목을 읽으세요.",
        fix: "문서 모음 항목에서만 doc을 지정하세요"
    }
    STORAGE_WRITE_DOCUMENT_NAME_NOT_ALLOWED(entry_id) {
        class: InvalidRequest,
        place: "코어 저장 항목 쓰기 요청",
        cause: "문서 모음이 아닌 항목에 문서 이름을 지정했다",
        message: "저장 항목 {entry_id}: 문서 모음이 아닙니다. doc 없이 항목을 저장하세요.",
        fix: "문서 모음 항목에서만 doc을 지정하세요"
    }
    STORAGE_RESET_DOCUMENT_NAME_NOT_ALLOWED(entry_id) {
        class: InvalidRequest,
        place: "코어 저장 항목 초기화 요청",
        cause: "문서 모음이 아닌 항목에 문서 이름을 지정했다",
        message: "저장 항목 {entry_id}: 문서 모음이 아닙니다. doc 없이 항목을 초기화하세요.",
        fix: "문서 모음 항목에서만 doc을 지정하세요"
    }
    STORAGE_MCP_READ_DOCUMENT_NAME_NOT_ALLOWED(entry_id) {
        class: InvalidRequest,
        place: "저장소 MCP 읽기 요청",
        cause: "문서 모음이 아닌 항목에 문서 이름을 지정했다",
        message: "저장 항목 {entry_id}: 문서 모음이 아닙니다. MCP 읽기 요청에서 doc을 빼세요.",
        fix: "문서 모음 항목에서만 doc을 지정하세요"
    }
    STORAGE_MCP_WRITE_DOCUMENT_NAME_NOT_ALLOWED(entry_id) {
        class: InvalidRequest,
        place: "저장소 MCP 쓰기 요청",
        cause: "문서 모음이 아닌 항목에 문서 이름을 지정했다",
        message: "저장 항목 {entry_id}: 문서 모음이 아닙니다. MCP 쓰기 요청에서 doc을 빼세요.",
        fix: "문서 모음 항목에서만 doc을 지정하세요"
    }
    STORAGE_MCP_RESET_DOCUMENT_NAME_NOT_ALLOWED(entry_id) {
        class: InvalidRequest,
        place: "저장소 MCP 초기화 요청",
        cause: "문서 모음이 아닌 항목에 문서 이름을 지정했다",
        message: "저장 항목 {entry_id}: 문서 모음이 아닙니다. MCP 초기화 요청에서 doc을 빼세요.",
        fix: "문서 모음 항목에서만 doc을 지정하세요"
    }
    STORAGE_DOCUMENT_RESET_REVISION_REQUIRED(doc) {
        class: InvalidRequest,
        place: "저장 문서 초기화 요청",
        cause: "문서 초기화에 필요한 revision이 없다",
        message: "저장 문서 {doc}: 초기화 revision이 없습니다. 문서를 다시 읽고 revision과 함께 요청하세요.",
        fix: "문서를 다시 읽고 revision을 보내세요"
    }
    STORAGE_DOCUMENT_MOVE_NAME_INVALID() {
        class: InvalidRequest,
        place: "저장 문서 이름 변경 요청",
        cause: "원본 또는 대상 문서 이름이 허용된 형식이 아니다",
        message: "원본 또는 새 문서 이름이 허용된 형식이 아닙니다. 문서 이름을 고쳐 다시 시도하세요.",
        fix: "원본과 새 문서 이름을 확인하세요"
    }
    STORAGE_VALUE_NOT_FOUND(key) {
        class: NotFound,
        place: "저장값 읽기",
        cause: "요청한 고정 저장값이 저장되어 있지 않다",
        message: "저장된 값을 찾을 수 없습니다: {key}. 항목을 먼저 저장하거나 선언된 키를 확인하세요.",
        fix: "저장 항목을 먼저 쓰거나 앱 정의의 키를 확인하세요"
    }
    STORAGE_MCP_ENTRY_REQUIRED(action) {
        class: InvalidRequest,
        place: "저장소 MCP 요청 검사",
        cause: "고정 저장 항목 요청에 entry_id가 없거나 key와 함께 지정되었다",
        message: "저장소 {action} 요청에 entry_id가 없거나 key와 함께 지정되었습니다. entry_id만 지정해 다시 요청하세요.",
        fix: "entry_id를 하나 지정하고 key는 생략하세요"
    }
    STORAGE_MCP_WRITE_KIND_NOT_ALLOWED() {
        class: InvalidRequest,
        place: "일반 앱 저장소 MCP 쓰기 요청",
        cause: "일반 앱 저장소 쓰기에 kind를 지정했다",
        message: "일반 앱 저장소 쓰기 요청은 kind를 받지 않습니다. 앱 정의에 선언된 종류를 쓰도록 kind를 빼세요.",
        fix: "일반 앱 저장소 쓰기 요청에서 kind를 빼세요"
    }
    STORAGE_MCP_WRITE_ENTRY_REQUIRED() {
        class: InvalidRequest,
        place: "일반 앱 저장소 MCP 쓰기 요청",
        cause: "일반 앱 저장소 쓰기에 entry_id가 없다",
        message: "일반 앱 저장소 쓰기 요청에 entry_id가 없습니다. 앱에 선언된 항목 ID를 지정하세요.",
        fix: "앱에 선언된 entry_id를 지정하세요"
    }
    STORAGE_MCP_WRITE_KEY_WITH_ENTRY() {
        class: InvalidRequest,
        place: "일반 앱 저장소 MCP 쓰기 요청",
        cause: "일반 앱 저장소 쓰기에 entry_id와 key를 함께 지정했다",
        message: "일반 앱 저장소 쓰기 요청에 entry_id와 key를 함께 지정했습니다. entry_id만 남기고 key를 빼세요.",
        fix: "일반 앱 저장소 쓰기 요청에서 key를 빼세요"
    }
    STORAGE_MCP_KEY_INVALID(key) {
        class: InvalidRequest,
        place: "기본 앱 저장소 MCP 요청 검사",
        cause: "요청한 키가 앱에 선언된 저장 항목이나 문서 모음에 속하지 않는다",
        message: "앱에서 저장 키를 찾지 못했습니다: {key}. 선언된 항목 키를 확인해 다시 요청하세요.",
        fix: "앱에 선언된 저장 키를 사용하세요"
    }
    STORAGE_MCP_RESET_REVISION_REQUIRED(key) {
        class: InvalidRequest,
        place: "저장소 MCP 초기화 요청 검사",
        cause: "저장값 초기화 요청에 expected_revision이 없다",
        message: "저장 항목 {key} 초기화에는 expected_revision이 필요합니다. 값을 다시 읽고 revision을 함께 보내세요.",
        fix: "저장값을 다시 읽고 expected_revision을 지정하세요"
    }
    STORAGE_RUNTIME_FAILED() {
        class: Server,
        place: "저장소 응답을 데이터 식에 전달",
        cause: "저장소 오류 응답을 데이터 식 실행 중 표시한다",
        message: "저장소 응답을 처리하지 못했습니다. 저장소를 다시 읽고 오류를 확인하세요.",
        fix: "저장소를 다시 읽고 오류를 확인하세요"
    }
    STORAGE_RUNTIME_NOT_READY() {
        class: Unavailable,
        place: "저장소 revision 조회",
        cause: "저장 항목 응답이 준비되지 않았다",
        message: "저장 항목 응답이 아직 준비되지 않았습니다. 잠시 뒤 다시 시도하세요.",
        fix: "저장 항목을 다시 읽으세요"
    }
    STORAGE_RUNTIME_ENTRY_MISSING(entry) {
        class: InvalidRequest,
        place: "저장소 revision 조회",
        cause: "앱에 선언되지 않은 저장 항목의 revision을 요청했다",
        message: "저장 항목을 찾을 수 없습니다: {entry}. 앱에 선언된 항목을 선택하세요.",
        fix: "앱에 선언된 저장 항목을 사용하세요"
    }
}
