error_catalog! { ENTRIES;
    SERVER_HTTP_BODY_TOO_LARGE(limit) {
        class: InvalidRequest, place: "서버 HTTP 본문 읽기", cause: "경로의 요청 본문 한도를 넘었다",
        message: "요청 본문이 이 경로의 서버 한도 {limit}를 넘었습니다. 요청 크기를 줄여 다시 시도하세요. 큰 요청이 필요하면 서버의 해당 경로 한도를 늘리세요.", fix: "요청 크기를 줄여 다시 시도하세요"
    }

    SERVER_PREFERENCES_BODY_INVALID() {
        class: InvalidRequest,
        place: "쉘 설정 요청",
        cause: "요청 본문의 형식이 올바르지 않다",
        message: "쉘 설정 요청의 형식이 올바르지 않습니다. 쉘을 최신 판으로 업데이트하세요",
        fix: "쉘을 최신 판으로 업데이트하세요"
    }
    SERVER_PREFERENCES_APP_NOT_FOUND() {
        class: NotFound,
        place: "쉘 설정 앱 검사",
        cause: "선택한 앱이 없다",
        message: "선택한 앱을 찾을 수 없습니다. 쉘 설정에서 다른 앱을 고르세요",
        fix: "쉘 설정에서 다른 앱을 고르세요"
    }
    SERVER_PREFERENCES_APP_NOT_RECEIVABLE(app) {
        class: InvalidRequest,
        place: "쉘 설정 앱 수신 검사",
        cause: "선택한 앱이 메시지를 받지 않는다",
        message: "{app}은 메시지를 받는 앱으로 선택할 수 없습니다. 쉘 설정에서 다른 앱을 고르세요",
        fix: "쉘 설정에서 다른 앱을 고르세요"
    }
    SERVER_PREFERENCES_READ_FAILED() {
        class: Server,
        place: "계정 설정 읽기",
        cause: "서버 저장소를 읽지 못했다",
        message: "계정의 쉘 설정을 읽지 못했습니다. 서버 저장소 상태를 확인한 뒤 다시 연결하세요",
        fix: "서버 저장소 상태를 확인한 뒤 다시 연결하세요"
    }
    SERVER_PREFERENCES_WRITE_FAILED() {
        class: Server,
        place: "계정 설정 쓰기",
        cause: "서버 저장소에 저장하지 못했다",
        message: "기본 에이전트 설정을 저장하지 못했습니다. 서버 저장소 상태를 확인한 뒤 다시 시도하세요",
        fix: "서버 저장소 상태를 확인한 뒤 다시 시도하세요"
    }
    SERVER_PREFERENCES_NOT_CONNECTED() {
        class: Server,
        place: "기본 에이전트 설정 변경",
        cause: "서버에 연결되어 있지 않다",
        message: "서버에 연결되어 있지 않아 기본 에이전트를 바꾸지 못했습니다. 서버에 연결한 뒤 다시 시도하세요",
        fix: "서버에 연결한 뒤 다시 시도하세요"
    }
    SERVER_PREFERENCES_REQUEST_SEND_FAILED() {
        class: Server,
        place: "계정 설정 요청 전송",
        cause: "서버로 요청을 보내지 못했다",
        message: "기본 에이전트 설정을 서버에 보내지 못했습니다. 서버 연결을 확인한 뒤 다시 시도하세요",
        fix: "서버 연결을 확인한 뒤 다시 시도하세요"
    }
    SERVER_PREFERENCES_RESPONSE_STATUS_FAILED() {
        class: Server,
        place: "계정 설정 서버 응답",
        cause: "서버가 설정 요청을 거부했다",
        message: "서버가 기본 에이전트 설정 요청을 처리하지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요",
        fix: "서버 상태를 확인한 뒤 다시 시도하세요"
    }
    SERVER_PREFERENCES_RESPONSE_READ_FAILED() {
        class: Server,
        place: "계정 설정 응답 읽기",
        cause: "서버 응답을 읽지 못했다",
        message: "기본 에이전트 설정의 서버 응답을 읽지 못했습니다. 서버와 쉘을 확인한 뒤 다시 시도하세요",
        fix: "서버와 쉘을 확인한 뒤 다시 시도하세요"
    }
    SERVER_MCP_ACCOUNT_LOOKUP_DATABASE_FAILED() {
        class: Server,
        place: "MCP 계정 조회",
        cause: "MCP 계정 조회 SQL이 실패했다",
        message: "MCP 계정 정보를 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_DEVICE_ACCOUNT_LOOKUP_DATABASE_FAILED() {
        class: Server,
        place: "기기 계정 조회",
        cause: "기기 계정 조회 SQL이 실패했다",
        message: "연결 기기의 계정 정보를 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_DEVICE_WORKSPACE_ACCESS_DATABASE_FAILED() {
        class: Server,
        place: "기기 작업 접근 확인",
        cause: "기기가 작업에 속하는지 확인하는 SQL이 실패했다",
        message: "기기가 이 작업에 접근할 수 있는지 서버에서 확인하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_MCP_WORKSPACE_ACCESS_DATABASE_FAILED() {
        class: Server,
        place: "MCP 작업 접근 확인",
        cause: "MCP 계정이 작업에 속하는지 확인하는 SQL이 실패했다",
        message: "MCP 계정이 이 작업에 접근할 수 있는지 서버에서 확인하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_LIST_DATABASE_FAILED() {
        class: Server,
        place: "앱 목록 조회",
        cause: "앱 목록 조회 SQL이 실패했다",
        message: "앱 목록을 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_LOOKUP_DATABASE_FAILED(app_id) {
        class: Server,
        place: "앱 조회",
        cause: "앱과 버전 조회 SQL이 실패했다",
        message: "앱 ID {app_id}: 앱 정보를 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_DEVICE_AUTH_DATABASE_FAILED() {
        class: Server,
        place: "기기 인증 조회",
        cause: "기기 인증 조회 SQL이 실패했다",
        message: "기기 인증 정보를 서버에서 확인하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_DEVICE_LAST_SEEN_DATABASE_FAILED() {
        class: Server,
        place: "기기 마지막 접속 시각 저장",
        cause: "기기 마지막 접속 시각 갱신 SQL이 실패했다",
        message: "서버에 기기의 마지막 접속 시각을 저장하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_DEVICE_LIST_DATABASE_FAILED() {
        class: Server,
        place: "연결 기기 목록 조회",
        cause: "연결 기기 목록 조회 SQL이 실패했다",
        message: "연결 기기 목록을 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_DEVICE_REVOKE_DATABASE_FAILED() {
        class: Server,
        place: "기기 연결 해제",
        cause: "기기 연결 해제 SQL이 실패했다",
        message: "서버에서 기기 연결을 해제하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_PREVIEW_WINDOW_STATE_DATABASE_FAILED(window_id) {
        class: Server,
        place: "미리 볼 창 상태 조회",
        cause: "창 상태 조회 SQL이 실패했다",
        message: "창 ID {window_id}: 미리 볼 상태를 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_PREVIEW_WINDOW_LOOKUP_DATABASE_FAILED(window_id) {
        class: Server,
        place: "앱 미리 보기 창 조회",
        cause: "미리 볼 창 조회 SQL이 실패했다",
        message: "창 ID {window_id}: 미리 보기 정보를 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_PREVIEW_WORKSPACE_ACCESS_DATABASE_FAILED(app_id) {
        class: Server,
        place: "앱 미리 보기 작업 접근 확인",
        cause: "앱 미리 보기에 필요한 작업 접근 조회 SQL이 실패했다",
        message: "앱 ID {app_id}: 미리 보기에 쓸 작업에 접근할 수 있는지 서버에서 확인하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_PREVIEW_STORAGE_DATABASE_FAILED(app_id) {
        class: Server,
        place: "앱 미리 보기 저장값 조회",
        cause: "미리 볼 앱 저장값 조회 SQL이 실패했다",
        message: "앱 ID {app_id}: 미리 보기에 쓸 저장값을 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_BUILTIN_SPEC_SAVE_DATABASE_FAILED() {
        class: Server,
        place: "기본 앱 실행 설정 저장",
        cause: "기본 앱 실행 설정 저장 SQL이 실패했다",
        message: "기본 앱 실행 설정을 서버에 저장하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_BUILTIN_SPEC_LOAD_DATABASE_FAILED(app_id) {
        class: Server,
        place: "기본 앱 실행 설정 조회",
        cause: "기본 앱 실행 설정 조회 SQL이 실패했다",
        message: "기본 앱 ID {app_id}의 실행 설정을 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_TRANSFER_EXPORT_DATABASE_FAILED(subject) {
        class: Server,
        place: "서버 자료 내보내기",
        cause: "자료 내보내기 SQL이 실패했다",
        message: "자료를 내보내는 중 {subject} 정보를 서버에서 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_TRANSFER_IMPORT_DATABASE_FAILED() {
        class: Server,
        place: "서버 자료 가져오기",
        cause: "자료 가져오기 SQL이 실패했다",
        message: "서버에 자료를 가져오지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_PUBLISH_DATABASE_FAILED(app_id) {
        class: Server,
        place: "앱 게시",
        cause: "앱 게시 SQL이 실패했다",
        message: "앱 ID {app_id}: 앱을 서버에 올리지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_OPEN_TARGET_DATABASE_FAILED() {
        class: Server,
        place: "앱을 열 기기 조회",
        cause: "앱을 열 기기 조회 SQL이 실패했다",
        message: "앱을 열 기기 정보를 서버에서 조회하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_DATABASE_LOCK_FAILED() {
        class: Server,
        place: "서버 데이터베이스 접근",
        cause: "데이터베이스 잠금을 얻지 못했다",
        message: "서버 데이터베이스를 사용할 수 없습니다. 서버를 다시 시작해야 합니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_DEVICE_ACCOUNT_NOT_FOUND() {
        class: Server,
        place: "연결 기기 계정 조회",
        cause: "등록된 기기의 계정 정보를 찾지 못했다",
        message: "이 기기의 계정 정보를 찾지 못했습니다. 서버 연결에서 기기를 다시 연결하세요.",
        fix: "서버 연결에서 기기를 다시 연결하세요"
    }
    SERVER_APP_DEFINITION_JSON_INVALID(app_id) {
        class: Server,
        place: "저장된 앱 정의 읽기",
        cause: "저장된 앱 정의가 올바른 JSON이 아니다",
        message: "앱 ID {app_id}의 저장된 정의를 읽지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "upload_app으로 앱을 다시 올리세요"
    }
    SERVER_APP_LIST_DEFINITION_JSON_INVALID(app_id) {
        class: Server,
        place: "현재 앱 목록 조회",
        cause: "목록에 포함된 저장 앱 정의가 올바른 JSON이 아니다",
        message: "앱 ID {app_id}의 저장된 정의를 앱 목록에 불러오지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "upload_app으로 앱을 다시 올리세요"
    }
    SERVER_PREVIEW_WINDOW_STATE_JSON_INVALID(window_id) {
        class: Server,
        place: "미리 볼 창 상태 읽기",
        cause: "저장된 창 상태가 올바른 JSON이 아니다",
        message: "창 ID {window_id}의 저장된 상태를 읽지 못했습니다. state 인자로 상태를 직접 넘기세요.",
        fix: "state 인자로 상태를 직접 넘기세요"
    }
    SERVER_TRANSFER_EXPORT_LAYOUT_JSON_INVALID(table) {
        class: Server,
        place: "서버 자료 내보내기 배치 읽기",
        cause: "저장된 배치 항목이 올바른 JSON이 아니다",
        message: "자료를 내보내는 중 {table} 배치 항목을 읽지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_TRANSFER_EXPORT_VALUE_KIND_INVALID(app_id, key) {
        class: Server,
        place: "서버 자료 내보내기 저장값 종류 읽기",
        cause: "저장된 값의 종류를 해석하지 못했다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 종류를 내보내지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "reset_app_storage로 값을 되돌리세요"
    }
    SERVER_TRANSFER_EXPORT_VALUE_JSON_INVALID(app_id, key) {
        class: Server,
        place: "서버 자료 내보내기 저장값 읽기",
        cause: "저장된 값이 올바른 JSON이 아니다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 저장값을 JSON으로 읽지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "write_app_storage로 값을 다시 쓰거나 reset_app_storage로 되돌리세요"
    }
    SERVER_TRANSFER_IMPORT_DEFINITION_SERIALIZE_FAILED(app_id) {
        class: Server,
        place: "서버 자료 가져오기 앱 정의 변환",
        cause: "가져올 앱 정의를 JSON으로 바꾸지 못했다",
        message: "앱 ID {app_id} 정의를 가져오기 요청으로 바꾸지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_TRANSFER_IMPORT_STORED_APP_DEFINITION_JSON_INVALID(app_id) {
        class: Server,
        place: "서버 자료 가져오기 기존 앱 정의 조회",
        cause: "기존 앱 정의가 올바른 JSON이 아니다",
        message: "앱 ID {app_id}의 기존 정의를 가져오는 중 읽지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "upload_app으로 앱을 다시 올리세요"
    }
    SERVER_TRANSFER_IMPORT_LAYOUT_INVALID() {
        class: InvalidRequest,
        place: "서버 자료 가져오기 배치 검사",
        cause: "가져올 배치 변경이 올바르지 않다",
        message: "가져올 작업, 데스크톱, 창 정보가 올바르지 않습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "내보낸 자료를 다시 확인하세요"
    }
    SERVER_TRANSFER_IMPORT_DELETIONS_PRESENT() {
        class: InvalidRequest,
        place: "서버 자료 가져오기 삭제 항목 검사",
        cause: "가져올 자료에 삭제 목록이 들어 있다",
        message: "서버 간 자료 가져오기는 삭제 항목을 적용하지 않습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "자료에서 삭제 목록을 빼세요"
    }
    SERVER_TRANSFER_IMPORT_BUILTIN_APP(app_id) {
        class: InvalidRequest,
        place: "서버 자료 가져오기 기본 앱 검사",
        cause: "쉘 기본 앱을 서버 앱으로 가져오려 했다",
        message: "기본 앱 ID {app_id}: 서버 자료로 가져올 수 없습니다. 쉘과 함께 배포되는 기본 앱을 사용하세요.",
        fix: "기본 앱을 가져오기 자료에서 빼세요"
    }
    SERVER_TRANSFER_IMPORT_COLLECTION_KIND_MISMATCH(app_id, key) {
        class: InvalidRequest,
        place: "서버 자료 가져오기 문서 모음 저장값 검사",
        cause: "가져온 저장값 종류가 기본 앱의 문서 모음 선언과 다르다",
        message: "기본 앱 ID {app_id}, 저장 항목 {key}: 종류가 선언과 다릅니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "내보낸 저장값 종류를 앱 선언과 맞추세요"
    }
    SERVER_TRANSFER_IMPORT_VALUE_TOO_LARGE(app_id, key) {
        class: InvalidRequest,
        place: "서버 자료 가져오기 저장값 크기 검사",
        cause: "가져온 저장값이 허용 크기를 넘는다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 허용 크기를 넘습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "저장값을 허용 크기 안으로 줄이세요"
    }
    SERVER_TRANSFER_IMPORT_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "서버 자료 가져오기 앱 조회",
        cause: "저장값을 적용할 앱이 등록되지 않았다",
        message: "앱 ID {app_id}: 찾을 수 없어 저장값을 가져오지 못했습니다. 앱을 먼저 가져오세요.",
        fix: "앱을 먼저 가져오세요"
    }
    SERVER_TRANSFER_IMPORT_STORAGE_ENTRY_NOT_FOUND(app_id, key) {
        class: InvalidRequest,
        place: "서버 자료 가져오기 저장 항목 확인",
        cause: "저장 항목이 앱 정의에 없다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 앱 정의에 선언되어 있지 않습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "앱 정의와 내보낸 저장값을 맞추세요"
    }
    SERVER_TRANSFER_IMPORT_STORAGE_KIND_MISMATCH(app_id, key) {
        class: InvalidRequest,
        place: "서버 자료 가져오기 저장 항목 종류 확인",
        cause: "가져온 저장값 종류가 앱 정의의 저장 항목과 다르다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 가져온 값의 종류가 앱 정의와 다릅니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "앱 정의와 내보낸 저장값 종류를 맞추세요"
    }
    SERVER_TRANSFER_IMPORT_MD_NOT_STRING(app_id, key) {
        class: InvalidRequest,
        place: "서버 자료 가져오기 Markdown 저장값 검사",
        cause: "가져온 Markdown 저장값이 문자열이 아니다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 마크다운 값이 글이 아닙니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "마크다운 저장값을 글로 바꾸세요"
    }
    SERVER_TRANSFER_IMPORT_REVISION_FAILED(app_id, key) {
        class: InvalidRequest,
        place: "서버 자료 가져오기 저장값 판 계산",
        cause: "가져온 저장값의 판을 계산하지 못했다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 판을 계산하지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "내보낸 저장값을 확인하세요"
    }
    SERVER_HTTP_MCP_AUTH_REJECTED() {
        class: Server,
        place: "MCP HTTP 인증",
        cause: "요청에 유효한 MCP 인증 정보가 없다",
        message: "MCP 요청을 인증하지 못했습니다. 인증 정보를 확인한 뒤 다시 요청하세요.",
        fix: "MCP 인증 정보를 확인하세요"
    }
    SERVER_HTTP_DEVICE_AUTH_REJECTED() {
        class: Server,
        place: "기기 HTTP 인증",
        cause: "요청에 유효한 기기 인증 정보가 없다",
        message: "기기 요청을 인증하지 못했습니다. 서버 연결에서 기기를 다시 연결하세요.",
        fix: "서버 연결에서 기기를 다시 연결하세요"
    }
    SERVER_HTTP_MCP_ACCOUNT_FORBIDDEN() {
        class: NotFound,
        place: "MCP 기기 계정 접근 확인",
        cause: "인증한 기기가 MCP 계정에 속하지 않는다",
        message: "이 기기로는 MCP 요청을 할 수 없습니다. MCP 계정에 연결된 인증 정보를 사용하세요.",
        fix: "MCP 계정에 연결된 인증 정보를 사용하세요"
    }
    SERVER_HTTP_MCP_WORKSPACE_FORBIDDEN() {
        class: NotFound,
        place: "MCP 작업 접근 확인",
        cause: "요청한 작업이 연결된 계정에서 확인되지 않는다",
        message: "요청을 처리할 작업을 찾지 못했습니다. 연결된 계정의 작업 ID를 확인하세요.",
        fix: "연결된 계정의 작업 ID를 사용하세요"
    }
    SERVER_HTTP_MCP_WORKSPACE_HEADER_INVALID() {
        class: NotFound,
        place: "MCP 작업 접근 확인",
        cause: "작업 ID 헤더가 유효한 문자열이 아니다",
        message: "MCP 작업 ID 헤더를 읽지 못했습니다. 유효한 작업 ID를 넣어 다시 요청하세요.",
        fix: "유효한 작업 ID를 넣어 다시 요청하세요"
    }
    SERVER_HTTP_DEVICE_WORKSPACE_NOT_FOUND() {
        class: NotFound,
        place: "기기 요청 작업 접근 확인",
        cause: "요청한 작업이 기기 계정에서 확인되지 않는다",
        message: "요청을 처리할 작업을 찾지 못했습니다. 기기 계정의 작업 ID를 확인하세요.",
        fix: "기기 계정에 속한 작업 ID를 사용하세요"
    }
    SERVER_HTTP_BUILTIN_SPECS_ACCOUNT_FORBIDDEN() {
        class: PermissionDenied,
        place: "기본 앱 실행 설정 등록 권한 확인",
        cause: "연결 기기가 MCP 계정의 기본 앱 설정을 등록할 권한이 없다",
        message: "이 기기는 기본 앱 실행 설정을 등록할 수 없습니다. MCP 계정에 연결된 기기에서 요청하세요.",
        fix: "MCP 계정에 연결된 기기에서 요청하세요"
    }
    SERVER_DEVICE_CONNECTION_STATE_LOCK_FAILED() {
        class: Server,
        place: "기기 연결 상태 잠금",
        cause: "기기 연결 상태 잠금을 얻지 못했다",
        message: "기기 연결 상태를 읽지 못했습니다. 서버를 다시 시작해야 합니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_DEVICE_LIST_CONNECTION_STATE_LOCK_FAILED() {
        class: Server,
        place: "연결 기기 목록 상태 잠금",
        cause: "연결 기기 목록을 읽기 위한 잠금을 얻지 못했다",
        message: "연결 기기 상태를 읽지 못했습니다. 서버를 다시 시작해야 합니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_APP_PUBLISH_CONNECTION_STATE_LOCK_FAILED() {
        class: Server,
        place: "앱 게시 대상 기기 선택",
        cause: "연결 상태 잠금을 얻지 못했다",
        message: "앱을 열 연결 기기를 고르지 못했습니다. 서버를 다시 시작하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_APP_PUBLISH_LAYOUT_SYNC_STATE_LOCK_FAILED() {
        class: Server,
        place: "앱 게시 대상 기기 선택",
        cause: "배치 동기화 상태 잠금을 얻지 못했다",
        message: "앱을 열 배치 동기화 기기를 고르지 못했습니다. 서버를 다시 시작하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_APP_PUBLISH_DEVICE_SUPPORT_STATE_LOCK_FAILED() {
        class: Server,
        place: "앱 게시 대상 기기 선택",
        cause: "기기 지원 기능 상태 잠금을 얻지 못했다",
        message: "앱을 열 수 있는 기기를 고르지 못했습니다. 서버를 다시 시작하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_DEVICE_SUPPORT_STATE_LOCK_FAILED() {
        class: Server,
        place: "기기 지원 기능 상태 잠금",
        cause: "기기 지원 기능 상태 잠금을 얻지 못했다",
        message: "기기 지원 기능 상태를 읽지 못했습니다. 서버를 다시 시작해야 합니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_LAYOUT_SYNC_DEVICE_STATE_LOCK_FAILED() {
        class: Server,
        place: "배치 동기화 기기 목록 잠금",
        cause: "배치 동기화 기기 목록 잠금을 얻지 못했다",
        message: "배치 동기화 상태를 읽지 못했습니다. 서버를 다시 시작해야 합니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_STORAGE_DEVICE_STATE_LOCK_FAILED() {
        class: Server,
        place: "저장소 연결 기기 목록 잠금",
        cause: "저장소 연결 기기 목록 잠금을 얻지 못했다",
        message: "저장소 연결 상태를 읽지 못했습니다. 서버를 다시 시작해야 합니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_APP_VALUE_DEVICE_STATE_LOCK_FAILED() {
        class: Server,
        place: "앱 저장값 연결 기기 목록 잠금",
        cause: "앱 저장값 연결 기기 목록 잠금을 얻지 못했다",
        message: "앱 저장값 연결 상태를 읽지 못했습니다. 서버를 다시 시작해야 합니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_COLLECTION_DEVICE_STATE_LOCK_FAILED() {
        class: Server,
        place: "문서 모음 연결 기기 목록 잠금",
        cause: "문서 모음 연결 기기 목록 잠금을 얻지 못했다",
        message: "문서 모음 연결 상태를 읽지 못했습니다. 서버를 다시 시작해야 합니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버를 다시 시작하세요"
    }
    SERVER_APP_PUBLISH_STORED_DEFINITION_JSON_INVALID(app_id) {
        class: Server,
        place: "앱 게시 중 기존 정의 조회",
        cause: "저장된 현재 앱 정의가 올바른 JSON이 아니다",
        message: "앱 ID {app_id}의 기존 정의를 올리는 중 읽지 못했습니다. 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_PUBLISH_WINDOW_STATE_INVALID(window_id) {
        class: Server,
        place: "앱 게시 중 창 상태 읽기",
        cause: "저장된 창 상태가 앱 판 변경 자료로 해석되지 않는다",
        message: "창 ID {window_id}의 상태를 앱을 올리는 중 읽지 못했습니다. 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_APP_PUBLISH_WINDOW_STATE_SERIALIZE_FAILED(window_id) {
        class: Server,
        place: "앱 게시 중 창 상태 저장",
        cause: "변경한 창 상태를 JSON으로 바꾸지 못했다",
        message: "창 ID {window_id}의 상태를 앱을 올리는 중 저장하지 못했습니다. 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_DEVBRIDGE_BODY_INVALID() {
        class: InvalidRequest,
        place: "개발 다리 코어 요청 읽기",
        cause: "HTTP 본문이 코어 요청 형식에 맞지 않는다",
        message: "개발 다리 요청 JSON을 읽지 못했습니다. 코어 요청 형식을 확인하세요.",
        fix: "코어 요청 JSON을 확인하세요"
    }
    SERVER_DEVBRIDGE_TASK_FAILED() {
        class: Io,
        place: "개발 다리 코어 명령 실행",
        cause: "코어 명령 실행 태스크가 완료되지 않았다",
        message: "개발 다리에서 코어 명령을 실행하지 못했습니다. 코어 상태를 확인하세요.",
        fix: "코어 상태를 확인하세요"
    }
    SERVER_DEVBRIDGE_EXPORT_OFFSET_REQUIRED() {
        class: InvalidRequest,
        place: "개발 다리 파일 내보내기 쓰기",
        cause: "내보낼 파일의 쓰기 위치가 지정되지 않았다",
        message: "파일 내보내기 쓰기 위치가 필요합니다. x-ks-offset에 파일 위치를 지정하세요.",
        fix: "x-ks-offset에 파일 위치를 지정하세요"
    }
    SERVER_DEVBRIDGE_EXPORT_OFFSET_INVALID(value) {
        class: InvalidRequest,
        place: "개발 다리 파일 내보내기 쓰기",
        cause: "내보낼 파일의 쓰기 위치가 0 이상의 정수가 아니다",
        message: "파일 쓰기 위치 {value}: 0 이상의 정수가 아닙니다. x-ks-offset에 정수를 지정하세요.",
        fix: "x-ks-offset에 0 이상의 정수를 지정하세요"
    }
    SERVER_DEVBRIDGE_OPERATION_UNSUPPORTED(operation) {
        class: InvalidRequest,
        place: "개발 다리 코어 동작 선택",
        cause: "요청한 코어 동작을 개발 다리가 지원하지 않는다",
        message: "개발 다리에서 동작 ID {operation}: 실행할 수 없습니다. 지원되는 동작을 사용하세요.",
        fix: "지원되는 개발 다리 동작을 사용하세요"
    }
    SERVER_SWITCH_CANCELLED() {
        class: InvalidRequest,
        place: "서버 전환",
        cause: "서버 선택이 바뀌어 현재 전환이 취소됐다",
        message: "서버 선택이 바뀌어 전환을 마치지 못했습니다. 현재 서버를 다시 선택하세요.",
        fix: "현재 사용할 서버를 다시 선택하세요"
    }
    SERVER_SWITCH_ARCHIVE_CREATE_FAILED() {
        class: Io,
        place: "서버 전환 자료 보관",
        cause: "이전 서버 자료를 보관할 폴더를 만들지 못했다",
        message: "이전 서버 자료를 보관할 수 없습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    SERVER_SWITCH_LOCAL_UNAVAILABLE() {
        class: Unavailable,
        place: "내 PC 서버 선택",
        cause: "내장 서버가 설정되어 있지 않다",
        message: "내 PC 서버를 사용할 수 없습니다. 내장 서버가 설정된 기기에서 다시 시도하세요.",
        fix: "내장 서버 설정을 확인하세요"
    }
    SERVER_SYNC_LOCAL_UNAVAILABLE() {
        class: Unavailable,
        place: "자료 이관",
        cause: "자료를 읽을 내 PC 서버가 설정되어 있지 않다",
        message: "자료를 읽을 내 PC 서버를 사용할 수 없습니다. 내장 서버가 설정된 기기에서 다시 시도하세요.",
        fix: "내장 서버 설정을 확인하세요"
    }
    SERVER_SYNC_REMOTE_NOT_SELECTED() {
        class: InvalidRequest,
        place: "서버 간 자료 이관",
        cause: "원격 서버가 선택되어 있지 않다",
        message: "자료를 보낼 원격 서버가 선택되지 않았습니다. 원격 서버에 연결한 뒤 다시 시도하세요.",
        fix: "원격 서버에 연결하세요"
    }
    SERVER_SYNC_LAYOUT_UNREACHABLE(host) {
        class: Server,
        place: "내 PC 배치 동기화",
        cause: "배치 변경을 내 PC 서버에 보내지 못했다",
        message: "내 PC 서버 {host}에 배치를 보낼 수 없습니다. 서버와 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "내 PC 서버와 네트워크 연결을 확인하세요"
    }
    SERVER_SYNC_LAYOUT_REJECTED(host) {
        class: Server,
        place: "내 PC 배치 동기화",
        cause: "내 PC 서버가 배치 변경 요청을 실패로 응답했다",
        message: "내 PC 서버({host})가 배치 변경을 거부했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_SYNC_LAYOUT_RESPONSE_READ_FAILED(host) {
        class: Server,
        place: "내 PC 배치 동기화 응답 읽기",
        cause: "배치 동기화 응답을 읽거나 해석하지 못했다",
        message: "내 PC 서버({host})의 배치 응답을 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 쉘과 서버를 업데이트하세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 쉘과 서버를 업데이트하세요"
    }
    SERVER_SYNC_CLIENT_FAILED() {
        class: Server,
        place: "서버 간 자료 이관 준비",
        cause: "HTTP 클라이언트를 만들지 못했다",
        message: "서버 간 자료 가져오기를 준비하지 못했습니다. 쉘을 다시 시작하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    SERVER_SYNC_UNREACHABLE(host) {
        class: Server,
        place: "서버 간 자료 이관 요청",
        cause: "자료 이관 요청을 서버에 보내지 못했다",
        message: "서버 {host}에 자료 가져오기 요청을 보내지 못했습니다. 서버와 네트워크를 확인하세요.",
        fix: "서버 주소와 네트워크 연결을 확인하세요"
    }
    SERVER_SYNC_LOCAL_READ_UNREACHABLE(host) {
        class: Server,
        place: "내 PC 서버에서 자료 읽기",
        cause: "자료 읽기 요청을 내 PC 서버에 보내지 못했다",
        message: "내 PC 서버({host})에서 자료를 읽지 못했습니다. 서버와 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "내 PC 서버와 네트워크 연결을 확인하세요"
    }
    SERVER_SYNC_LOCAL_READ_REJECTED(host) {
        class: Server,
        place: "내 PC 서버에서 자료 읽기",
        cause: "내 PC 서버가 자료 읽기 요청을 실패로 응답했다",
        message: "내 PC 서버({host})가 자료 읽기 요청을 거부했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_SYNC_REJECTED(host) {
        class: Server,
        place: "서버 간 자료 이관 응답",
        cause: "서버가 자료 이관 요청을 실패로 응답했다",
        message: "서버({host})가 자료 가져오기 요청을 거부했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_SYNC_RESPONSE_INVALID(host) {
        class: Server,
        place: "서버 간 자료 이관 응답",
        cause: "서버 응답이 자료 이관 형식에 맞지 않다",
        message: "서버 {host}의 자료 가져오기 응답을 읽지 못했습니다. 쉘과 서버를 같은 판으로 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘과 서버를 같은 판으로 업데이트하세요"
    }
    SERVER_SYNC_RESPONSE_UNREACHABLE(host) {
        class: Server,
        place: "서버 간 자료 이관 응답 읽기",
        cause: "자료 이관 응답을 끝까지 읽지 못했다",
        message: "서버 {host}의 자료 가져오기 응답을 읽지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    SERVER_LAYOUT_REPORT_BODY_INVALID() {
        class: InvalidRequest,
        place: "기기 배치 보고 요청 읽기",
        cause: "요청 본문이 기기 배치 형식에 맞지 않는다",
        message: "기기 배치 보고 형식이 올바르지 않습니다. 쉘을 업데이트하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SERVER_LAYOUT_CHANGE_BODY_INVALID() {
        class: InvalidRequest,
        place: "기기 배치 변경 요청 읽기",
        cause: "요청 본문이 배치 변경 형식에 맞지 않는다",
        message: "기기 배치 변경 형식이 올바르지 않습니다. 쉘을 업데이트하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SERVER_LAYOUT_CHANGE_SHARING_ID_INVALID() {
        class: InvalidRequest,
        place: "기기 배치 변경의 공유 창 검사",
        cause: "공유 대상 창 id가 비었거나 허용 길이를 넘는다",
        message: "같이 보기 창 정보가 올바르지 않습니다. 쉘을 업데이트하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SERVER_LAYOUT_CHANGE_CONTEXT_TOO_LARGE(limit) {
        class: InvalidRequest,
        place: "기기 배치 변경의 공유 문맥 검사",
        cause: "공유 문맥 글이 허용 크기를 넘는다",
        message: "같이 보기 글이 허용 크기 {limit}보다 큽니다. 창에 보이는 글을 줄이세요.",
        fix: "창에 보이는 글을 줄이세요"
    }
    SERVER_LAYOUT_CHANGE_STATE_SERIALIZATION_FAILED() {
        class: InvalidRequest,
        place: "기기 배치 변경의 창 상태 검사",
        cause: "창 상태를 JSON으로 만들지 못했다",
        message: "창 상태를 읽을 수 있는 형식으로 만들지 못했습니다. 쉘을 업데이트하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SERVER_LAYOUT_CHANGE_STATE_TOO_LARGE(limit) {
        class: InvalidRequest,
        place: "기기 배치 변경의 창 상태 크기 검사",
        cause: "창 상태가 허용 크기를 넘는다",
        message: "창 상태가 허용 크기 {limit}보다 큽니다. 앱 정의나 앱 코드가 창 상태에 넣는 값을 줄이세요.",
        fix: "앱 정의나 앱 코드가 창 상태에 넣는 값을 줄이세요"
    }
    SERVER_LAYOUT_ENTITIES_TABLE_UNSUPPORTED() {
        class: Server,
        place: "계정 배치 정보 읽기",
        cause: "서버가 알지 못하는 배치 정보 종류를 읽으려 했다",
        message: "서버가 작업, 데스크톱, 창 정보를 읽지 못했습니다. 서버를 업데이트하세요.",
        fix: "서버를 업데이트하세요"
    }
    SERVER_LAYOUT_ENTITIES_READ_FAILED() {
        class: Server,
        place: "계정 배치 정보 읽기",
        cause: "저장된 작업, 데스크톱 또는 창 정보를 읽지 못했다",
        message: "서버에서 작업, 데스크톱, 창 정보를 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_ENTITIES_JSON_PARSE_FAILED() {
        class: Server,
        place: "계정 배치 JSON 해석",
        cause: "저장된 작업, 데스크톱 또는 창 정보가 올바른 JSON이 아니다",
        message: "저장된 작업 배치 정보의 JSON 형식이 올바르지 않습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_REPORT_DEVICE_NOT_FOUND() {
        class: Server,
        place: "기기 배치 보고 저장",
        cause: "배치를 보고한 연결 기기를 찾지 못했다",
        message: "배치를 보고한 기기를 찾지 못했습니다. 서버 연결에서 기기를 다시 연결하세요.",
        fix: "서버 연결에서 기기를 다시 연결하세요"
    }
    SERVER_LAYOUT_REPORT_SAVE_FAILED() {
        class: Server,
        place: "기기 배치 보고 저장",
        cause: "기기 배치 보고를 저장하지 못했다",
        message: "서버에 기기 배치를 저장하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_REPORT_SERIALIZATION_FAILED() {
        class: Server,
        place: "기기 배치 보고 저장",
        cause: "기기 배치를 저장 형식으로 만들지 못했다",
        message: "기기 배치를 저장 형식으로 만들지 못했습니다. 쉘을 업데이트하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SERVER_LAYOUT_REPORT_DEVICE_TRACKING_READ_FAILED() {
        class: Server,
        place: "기기 배치 보고의 동기화 대상 확인",
        cause: "배치 동기화 대상 목록을 읽지 못했다",
        message: "기기 배치 동기화 상태를 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_REPORT_TABLE_UNSUPPORTED() {
        class: Server,
        place: "기기 배치 보고 저장",
        cause: "서버가 알지 못하는 배치 보고 항목 종류를 저장하려 했다",
        message: "서버가 배치 보고 항목을 저장하지 못했습니다. 서버를 업데이트하세요.",
        fix: "서버를 업데이트하세요"
    }
    SERVER_LAYOUT_INDEX_REFRESH_FAILED() {
        class: Server,
        place: "기기별 작업 목록 갱신",
        cause: "기기 배치에서 작업 목록을 갱신하지 못했다",
        message: "서버에서 기기별 작업 목록을 갱신하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_CHANGE_DEVICE_NOT_FOUND() {
        class: Server,
        place: "기기 배치 변경 적용",
        cause: "변경을 보낸 연결 기기를 찾지 못했다",
        message: "배치 변경을 보낸 기기를 찾지 못했습니다. 서버 연결에서 기기를 다시 연결하세요.",
        fix: "서버 연결에서 기기를 다시 연결하세요"
    }
    SERVER_LAYOUT_CHANGE_APPLY_FAILED() {
        class: Server,
        place: "기기 배치 변경 적용",
        cause: "기기 배치 변경을 저장하거나 적용하지 못했다",
        message: "서버에 기기 배치 변경을 적용하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_WORKSPACE_SERIALIZATION_FAILED() {
        class: Server,
        place: "작업 배치 변경 저장",
        cause: "작업 배치를 저장 형식으로 만들지 못했다",
        message: "작업 배치를 저장 형식으로 만들지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_DESKTOP_SERIALIZATION_FAILED() {
        class: Server,
        place: "데스크톱 배치 변경 저장",
        cause: "데스크톱 배치를 저장 형식으로 만들지 못했다",
        message: "데스크톱 배치를 저장 형식으로 만들지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_WINDOW_SERIALIZATION_FAILED() {
        class: Server,
        place: "창 배치 변경 저장",
        cause: "창 배치를 저장 형식으로 만들지 못했다",
        message: "창 배치를 저장 형식으로 만들지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_CANONICAL_ENTITY_INVALID() {
        class: Server,
        place: "저장된 배치 항목 읽기",
        cause: "저장한 작업, 데스크톱 또는 창 정보를 해석하지 못했다",
        message: "서버에 저장된 배치 정보를 읽지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_CANONICAL_ENTITY_READ_FAILED() {
        class: Server,
        place: "저장된 배치 항목 조회",
        cause: "작업, 데스크톱 또는 창 저장 행을 읽지 못했다",
        message: "서버에서 배치 항목을 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_CANONICAL_ENTITY_TABLE_UNSUPPORTED() {
        class: Server,
        place: "저장된 배치 항목 조회",
        cause: "서버가 알지 못하는 배치 항목 종류를 조회하려 했다",
        message: "서버가 배치 항목을 읽지 못했습니다. 서버를 업데이트하세요.",
        fix: "서버를 업데이트하세요"
    }
    SERVER_LAYOUT_CHILD_RELATION_UNSUPPORTED() {
        class: Server,
        place: "배치 항목 관계 조회",
        cause: "서버가 알지 못하는 작업과 데스크톱 또는 창 관계를 조회하려 했다",
        message: "서버가 배치 항목의 관계를 읽지 못했습니다. 서버를 업데이트하세요.",
        fix: "서버를 업데이트하세요"
    }
    SERVER_LAYOUT_CHILD_RELATION_READ_FAILED() {
        class: Server,
        place: "배치 항목 관계 조회",
        cause: "작업, 데스크톱 또는 창의 관계를 읽지 못했다",
        message: "서버에서 배치 항목의 관계를 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_WORKSPACE_LOOKUP_FAILED() {
        class: Server,
        place: "작업 존재 확인",
        cause: "작업이 현재 계정에 있는지 확인하지 못했다",
        message: "서버에서 작업 정보를 확인하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_DESKTOP_LOOKUP_FAILED() {
        class: Server,
        place: "데스크톱 존재 확인",
        cause: "데스크톱이 현재 계정에 있는지 확인하지 못했다",
        message: "서버에서 데스크톱 정보를 확인하지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_SNAPSHOT_READ_FAILED() {
        class: Server,
        place: "기기 배치 스냅샷 읽기",
        cause: "기기 계정 또는 배치 항목을 읽지 못했다",
        message: "서버에서 기기 배치 스냅샷을 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_REPORT_LIST_FAILED() {
        class: Server,
        place: "기기 배치 보고 목록 읽기",
        cause: "저장된 기기 배치 보고를 읽지 못했다",
        message: "서버에서 기기 배치 보고 목록을 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_REPORT_LIST_JSON_PARSE_FAILED() {
        class: Server,
        place: "기기 배치 보고 JSON 해석",
        cause: "저장된 기기 배치 보고가 올바른 JSON이 아니다",
        message: "기기 배치 보고의 JSON 형식이 올바르지 않습니다. 쉘이 다음 보고를 보낼 때 새로 저장됩니다.",
        fix: "쉘이 서버에 다시 연결되면 새로 저장됩니다"
    }
    SERVER_LAYOUT_WORKSPACE_CONNECTION_STATE_READ_FAILED() {
        class: Server,
        place: "작업 상세의 기기 연결 상태 읽기",
        cause: "기기 연결 상태를 읽지 못했다",
        message: "작업에 연결된 기기 상태를 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    SERVER_LAYOUT_SYNC_STATE_READ_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 상태 읽기",
        cause: "배치 동기화 상태 파일을 읽지 못했다",
        message: "배치 동기화 상태 파일 sync.json을 읽지 못했습니다. 파일 관리자에서 열리는지 확인한 뒤 쉘을 다시 시작하세요.",
        fix: "파일 관리자에서 열리는지 확인한 뒤 쉘을 다시 시작하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_READ_NOT_FOUND() {
        class: NotFound,
        place: "로컬 배치 동기화 상태 읽기",
        cause: "동기화 상태 파일이 읽는 동안 사라졌다",
        message: "배치 동기화 상태 파일 sync.json이 읽는 사이 사라졌습니다. 쉘을 다시 시작하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_SAVE_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 상태 저장",
        cause: "배치 동기화 상태 파일을 저장하지 못했다",
        message: "배치 동기화 상태 파일 sync.json을 저장하지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_SAVE_NOT_FOUND() {
        class: NotFound,
        place: "로컬 배치 동기화 상태 저장",
        cause: "배치 동기화 상태를 저장하는 동안 저장 경로가 사라졌다",
        message: "배치 동기화 상태 파일 sync.json을 저장할 폴더가 사라졌습니다. 쉘 데이터 폴더가 있는지 확인한 뒤 쉘을 다시 시작하세요.",
        fix: "쉘 데이터 폴더가 있는지 확인한 뒤 쉘을 다시 시작하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_RECOVERY_RENAME_NOT_FOUND() {
        class: NotFound,
        place: "손상된 로컬 배치 동기화 상태 보관",
        cause: "손상된 동기화 상태 파일이 보관 중 사라졌다",
        message: "손상된 배치 동기화 상태 파일 sync.json이 옮기는 사이 사라졌습니다. 쉘을 다시 시작하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_RECOVERY_RENAME_FAILED() {
        class: Io,
        place: "손상된 로컬 배치 동기화 상태 보관",
        cause: "손상된 동기화 상태 파일을 보관 이름으로 바꾸지 못했다",
        message: "손상된 배치 동기화 상태 파일 sync.json을 다른 이름으로 옮기지 못했습니다. 파일이 읽기 전용이 아닌지 확인한 뒤 쉘을 다시 시작하세요.",
        fix: "파일이 읽기 전용이 아닌지 확인한 뒤 쉘을 다시 시작하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_TEMP_WRITE_NOT_FOUND() {
        class: NotFound,
        place: "로컬 배치 동기화 임시 파일 쓰기",
        cause: "임시 동기화 상태 파일을 쓸 경로가 없다",
        message: "배치 동기화 임시 파일을 쓸 폴더가 없습니다. 쉘 데이터 폴더가 있는지 확인한 뒤 쉘을 다시 시작하세요.",
        fix: "쉘 데이터 폴더가 있는지 확인한 뒤 쉘을 다시 시작하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_TEMP_WRITE_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 임시 파일 쓰기",
        cause: "임시 동기화 상태 파일을 쓰지 못했다",
        message: "배치 동기화 임시 파일을 쓰지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_REPLACE_NOT_FOUND() {
        class: NotFound,
        place: "로컬 배치 동기화 상태 파일 교체",
        cause: "임시 동기화 상태 파일이나 저장 폴더가 없다",
        message: "배치 동기화 상태 파일 sync.json을 바꿔 넣는 사이 임시 파일이나 폴더가 사라졌습니다. 쉘 데이터 폴더가 있는지 확인한 뒤 쉘을 다시 시작하세요.",
        fix: "쉘 데이터 폴더가 있는지 확인한 뒤 쉘을 다시 시작하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_REPLACE_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 상태 파일 교체",
        cause: "임시 동기화 상태 파일을 저장 파일로 바꾸지 못했다",
        message: "배치 동기화 상태 파일 sync.json을 새 내용으로 바꾸지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_REMOVE_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 상태 삭제",
        cause: "배치 동기화 상태 파일을 삭제하지 못했다",
        message: "배치 동기화 상태 파일 sync.json을 지우지 못했습니다. 파일이 읽기 전용이 아닌지 확인하세요.",
        fix: "파일이 읽기 전용이 아닌지 확인하세요"
    }
}
