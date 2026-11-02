error_catalog! { ENTRIES;
    WORKER_SCHEDULE_ACCOUNT_LIST_DATABASE_FAILED() {
        class: Server,
        place: "워커 주기 실행 계정 조회",
        cause: "서버 저장소의 SQL 작업이 실패했다",
        message: "워커 주기 실행에 필요한 계정 목록을 서버 저장소에서 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    WORKER_WEBHOOK_SECRET_READ_DATABASE_FAILED(app) {
        class: Server,
        place: "워커 웹훅 인증 정보 조회",
        cause: "서버 저장소의 SQL 작업이 실패했다",
        message: "앱 {app}: 웹훅 인증 정보를 서버 저장소에서 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    WORKER_WEBHOOK_REQUEST_UNAVAILABLE() {
        class: Server,
        place: "웹훅 요청 처리",
        cause: "웹훅 요청을 처리하는 서버 작업을 마치지 못했다",
        message: "웹훅 요청을 처리하지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 상태를 확인하세요"
    }
    WORKER_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "워커 정의 조회",
        cause: "워커를 사용할 앱이 현재 레지스트리에 없다",
        message: "앱 ID {app_id}: 워커를 사용할 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 시도하세요.",
        fix: "현재 레지스트리에 있는 앱 ID를 사용하세요"
    }
    WORKER_DEFINITION_MISSING(app_id) {
        class: InvalidRequest,
        place: "워커 정의 조회",
        cause: "앱에 워커 정의가 없다",
        message: "앱 ID {app_id}: 워커가 선언되지 않았습니다. 워커를 선언한 앱에서 다시 요청하세요.",
        fix: "워커를 선언한 앱을 지정하세요"
    }
    WORKER_SECRET_NOT_DECLARED(app_id, secret_id) {
        class: InvalidRequest,
        place: "워커 시크릿 설정",
        cause: "요청한 시크릿이 워커 선언에 없다",
        message: "앱 ID {app_id}의 시크릿 {secret_id}: 워커에 선언되지 않았습니다. 선언된 시크릿 ID를 지정하세요.",
        fix: "앱 워커에 선언된 시크릿 ID를 사용하세요"
    }
    WORKER_SECRET_EMPTY(app_id, secret_id) {
        class: InvalidRequest,
        place: "워커 시크릿 설정",
        cause: "시크릿 값이 비어 있다",
        message: "앱 ID {app_id}의 시크릿 {secret_id}: 값이 비어 있습니다. 값을 입력해 다시 저장하세요.",
        fix: "비어 있지 않은 시크릿 값을 입력하세요"
    }
    WORKER_SECRET_TOO_LARGE(app_id, secret_id, max_bytes) {
        class: InvalidRequest,
        place: "워커 시크릿 설정",
        cause: "시크릿 값이 허용 바이트 수를 넘는다",
        message: "앱 ID {app_id}의 시크릿 {secret_id}: 값이 {max_bytes}바이트를 넘습니다. 값을 줄여 다시 저장하세요.",
        fix: "시크릿 값을 허용 크기 안으로 줄이세요"
    }
    WORKER_SECRET_ENV_REFERENCE_FORBIDDEN(app_id, secret_id) {
        class: InvalidRequest,
        place: "워커 시크릿 설정",
        cause: "시크릿 값에 환경변수 참조 문법이 들어 있다",
        message: "앱 ID {app_id}의 시크릿 {secret_id}: 환경변수 참조는 저장할 수 없습니다. 실제 값을 입력해 다시 저장하세요.",
        fix: "환경변수 참조 대신 실제 시크릿 값을 입력하세요"
    }
    WORKER_SECRET_SAVE_DATABASE_FAILED(app_id, secret_id) {
        class: Server,
        place: "워커 시크릿 저장",
        cause: "시크릿 값을 데이터베이스에 저장하지 못했다",
        message: "앱 ID {app_id}의 시크릿 {secret_id}: 데이터베이스에 저장하지 못했습니다. 잠시 뒤 다시 저장하세요.",
        fix: "데이터베이스 상태를 확인하고 다시 저장하세요"
    }
    WORKER_SECRET_LIST_DATABASE_FAILED(app_id, secret_id) {
        class: Server,
        place: "워커 시크릿 설정 조회",
        cause: "시크릿 설정을 데이터베이스에서 읽지 못했다",
        message: "앱 ID {app_id}의 시크릿 {secret_id}: 설정을 데이터베이스에서 읽지 못했습니다. 잠시 뒤 다시 조회하세요.",
        fix: "데이터베이스 상태를 확인하고 다시 조회하세요"
    }
    WORKER_SECRET_DELETE_DATABASE_FAILED(app_id, secret_id) {
        class: Server,
        place: "워커 시크릿 삭제",
        cause: "시크릿 설정을 데이터베이스에서 지우지 못했다",
        message: "앱 ID {app_id}의 시크릿 {secret_id}: 설정을 지우지 못했습니다. 잠시 뒤 다시 삭제하세요.",
        fix: "데이터베이스 상태를 확인하고 다시 삭제하세요"
    }
    WORKER_RUN_WORKSPACE_CHECK_DATABASE_FAILED(app_id) {
        class: Server,
        place: "워커 실행 전 작업 확인",
        cause: "작업 소유자를 확인할 데이터베이스 트랜잭션을 시작하지 못했다",
        message: "앱 ID {app_id}: 워커 실행에 필요한 작업 정보를 확인하지 못했습니다. 잠시 뒤 다시 실행하세요.",
        fix: "데이터베이스 상태를 확인하고 워커를 다시 실행하세요"
    }
    WORKER_RUN_SECRET_READ_DATABASE_FAILED(app_id, secret_id) {
        class: Server,
        place: "워커 실행 시크릿 조회",
        cause: "실행할 워커의 시크릿 설정을 데이터베이스에서 읽지 못했다",
        message: "앱 ID {app_id}의 시크릿 {secret_id}: 워커 실행에 필요한 설정을 읽지 못했습니다. 잠시 뒤 다시 실행하세요.",
        fix: "데이터베이스 상태를 확인하고 워커를 다시 실행하세요"
    }
    WORKER_ACTION_NOT_DECLARED(app_id, action) {
        class: InvalidRequest,
        place: "워커 동작 호출",
        cause: "요청한 동작이 워커 선언에 없다",
        message: "앱 ID {app_id}의 동작 {action}: 워커에 선언되지 않았습니다. 선언된 동작을 지정해 다시 호출하세요.",
        fix: "앱 워커에 선언된 동작을 지정하세요"
    }
    WORKER_RUN_WAIT_TIMEOUT(app_id) {
        class: Server,
        place: "워커 실행 대기",
        cause: "실행 차례를 기다리다 호출 기한이 지났다",
        message: "앱 ID {app_id}: 앞선 워커 실행이 끝나기 전에 대기 시간이 초과되었습니다. 잠시 뒤 다시 실행하세요.",
        fix: "앞선 실행이 끝난 뒤 다시 호출하세요"
    }
    WORKER_STATE_DIR_CREATE_FAILED(app_id) {
        class: Server,
        place: "워커 상태 폴더 준비",
        cause: "워커 상태 폴더를 만들지 못했다",
        message: "앱 ID {app_id}: 워커 상태 폴더를 만들지 못했습니다. 서버 저장 경로의 공간과 권한을 확인하세요.",
        fix: "서버 저장 경로의 디스크 공간과 쓰기 권한을 확인하세요"
    }
    WORKER_INPUT_SERIALIZE_FAILED(app_id) {
        class: Server,
        place: "워커 입력 준비",
        cause: "워커에 전달할 입력을 JSON으로 만들지 못했다",
        message: "앱 ID {app_id}: 워커 입력을 준비하지 못했습니다. 앱의 입력과 저장값을 확인하세요.",
        fix: "앱 워커의 입력과 저장값을 확인하세요"
    }
    WORKER_CODE_DIR_CREATE_FAILED(app_id) {
        class: Server,
        place: "워커 코드 준비",
        cause: "임시 코드 폴더를 만들지 못했다",
        message: "앱 ID {app_id}: 워커 코드 폴더를 준비하지 못했습니다. 서버 임시 저장 공간을 확인하세요.",
        fix: "서버 임시 저장 공간과 권한을 확인하세요"
    }
    WORKER_CODE_FILE_WRITE_FAILED(app_id) {
        class: Server,
        place: "워커 코드 준비",
        cause: "워커 실행 파일을 임시 폴더에 쓰지 못했다",
        message: "앱 ID {app_id}: 워커 실행 파일을 준비하지 못했습니다. 서버 임시 저장 공간을 확인하세요.",
        fix: "서버 임시 저장 공간과 권한을 확인하세요"
    }
    WORKER_OUTPUT_STATUS_FAILED(app_id, stderr) {
        class: Server,
        place: "워커 실행 결과 확인",
        cause: "워커 프로세스가 실패 상태로 끝났다",
        message: "앱 ID {app_id}: 워커 실행이 실패했습니다. stderr: {stderr}. 워커 코드를 확인하세요.",
        fix: "전달된 stderr를 확인하고 워커 코드를 고치세요"
    }
    WORKER_OUTPUT_PARSE_FAILED(app_id) {
        class: Server,
        place: "워커 출력 해석",
        cause: "워커 표준 출력에서 JSON 결과를 읽지 못했다",
        message: "앱 ID {app_id}: 워커 출력을 JSON으로 읽지 못했습니다. 워커가 유효한 JSON을 출력하도록 고치세요.",
        fix: "워커 표준 출력이 유효한 JSON인지 확인하세요"
    }
    WORKER_OUTPUT_NOT_OBJECT(app_id) {
        class: Server,
        place: "워커 출력 형식 확인",
        cause: "워커 출력 JSON이 객체가 아니다",
        message: "앱 ID {app_id}: 워커 결과가 JSON 객체가 아닙니다. 객체를 출력하도록 워커 코드를 고치세요.",
        fix: "워커가 JSON 객체를 출력하도록 고치세요"
    }
    WORKER_OUTPUT_STORAGE_NOT_OBJECT(app_id) {
        class: Server,
        place: "워커 저장 변경 해석",
        cause: "워커의 set_storage 값이 객체가 아니다",
        message: "앱 ID {app_id}: 워커의 set_storage 결과가 객체가 아닙니다. 항목별 값이 든 객체를 출력하도록 고치세요.",
        fix: "set_storage에 항목 ID와 값을 담은 객체를 넣으세요"
    }
    WORKER_PROCESS_START_FAILED() {
        class: Server,
        place: "워커 프로세스 시작",
        cause: "Python 워커 프로세스를 시작하지 못했다",
        message: "Python 워커를 시작하지 못했습니다. 서버의 Python 실행 환경을 확인하세요.",
        fix: "서버에서 Python 실행 파일을 사용할 수 있는지 확인하세요"
    }
    WORKER_PROCESS_STDOUT_MISSING() {
        class: Server,
        place: "워커 출력 연결",
        cause: "워커 프로세스의 표준 출력 연결이 없다",
        message: "워커 표준 출력을 읽을 수 없습니다. 서버의 프로세스 실행 설정을 확인하세요.",
        fix: "서버의 워커 표준 출력 연결을 확인하세요"
    }
    WORKER_PROCESS_STDERR_MISSING() {
        class: Server,
        place: "워커 오류 출력 연결",
        cause: "워커 프로세스의 표준 오류 연결이 없다",
        message: "워커 오류 출력을 읽을 수 없습니다. 서버의 프로세스 실행 설정을 확인하세요.",
        fix: "서버의 워커 표준 오류 연결을 확인하세요"
    }
    WORKER_PROCESS_TIMEOUT() {
        class: Server,
        place: "워커 프로세스 실행",
        cause: "정해진 실행 기한 안에 워커가 끝나지 않았다",
        message: "워커 실행 시간이 초과되었습니다. 워커 작업량이나 실행 제한을 확인하세요.",
        fix: "워커 작업량을 줄이거나 실행 제한 안에 끝나도록 고치세요"
    }
    WORKER_PROCESS_IO_FAILED() {
        class: Server,
        place: "워커 프로세스 통신",
        cause: "워커 입력 또는 출력을 주고받다 실패했다",
        message: "워커 실행 중 입력과 출력을 처리하지 못했습니다. 서버 프로세스 상태를 확인하세요.",
        fix: "서버 프로세스 상태와 워커 입력을 확인하세요"
    }
    WORKER_WEBHOOK_WORKER_MISSING(app_id) {
        class: NotFound,
        place: "워커 웹훅 조회",
        cause: "앱에 워커 정의가 없다",
        message: "앱 ID {app_id}: 워커가 없어 웹훅을 받을 수 없습니다. 워커를 선언한 앱으로 요청하세요.",
        fix: "워커를 선언한 앱의 웹훅 주소를 사용하세요"
    }
    WORKER_WEBHOOK_NOT_CONFIGURED(app_id) {
        class: NotFound,
        place: "워커 웹훅 조회",
        cause: "워커에 웹훅 트리거가 선언되지 않았다",
        message: "앱 ID {app_id}: 웹훅 트리거가 없습니다. 웹훅을 선언한 앱으로 요청하세요.",
        fix: "웹훅 트리거를 선언한 앱의 주소를 사용하세요"
    }
    WORKER_WEBHOOK_DISABLED(app_id) {
        class: InvalidRequest,
        place: "워커 웹훅 사용 상태 확인",
        cause: "웹훅 사용 항목이 true가 아니다",
        message: "앱 ID {app_id}: 웹훅이 꺼져 있어 요청을 처리하지 않았습니다. 앱 저장소에서 사용 항목을 켜세요.",
        fix: "웹훅 사용 항목을 true로 저장하세요"
    }
    WORKER_WEBHOOK_SECRET_NOT_CONFIGURED(app_id, secret_id) {
        class: Unauthorized,
        place: "워커 웹훅 시크릿 설정 확인",
        cause: "웹훅이 사용할 시크릿 값이 서버에 저장되지 않았거나 비어 있다",
        message: "앱 ID {app_id}의 웹훅 시크릿 {secret_id}: 서버에 값이 설정되지 않았습니다. 워커 시크릿 설정에 값을 저장한 뒤 다시 요청하세요.",
        fix: "워커 시크릿 설정에 값을 저장하세요"
    }
    WORKER_WEBHOOK_TOKEN_INVALID(app_id) {
        class: Unauthorized,
        place: "워커 웹훅 인증",
        cause: "요청을 웹훅 인증할 수 없다",
        message: "앱 ID {app_id}: 웹훅 인증에 실패했습니다. 인증값을 확인해 다시 요청하세요.",
        fix: "인증값을 확인한 뒤 다시 요청하세요"
    }
    WORKER_WEBHOOK_BODY_ENCODING_INVALID(app_id) {
        class: InvalidRequest,
        place: "워커 웹훅 본문 읽기",
        cause: "요청 본문이 UTF-8이 아니다",
        message: "앱 ID {app_id}: 웹훅 본문을 UTF-8로 읽지 못했습니다. UTF-8 본문을 보내세요.",
        fix: "요청 본문을 UTF-8로 인코딩하세요"
    }
    WORKER_WEBHOOK_DEFER_ACTION_MISSING(app_id) {
        class: InvalidRequest,
        place: "웹훅 후속 동작 확인",
        cause: "후속 실행 결과에 동작 이름이 없다",
        message: "앱 ID {app_id}: 웹훅 후속 실행에 동작 이름이 없습니다. 워커 결과에 선언된 action을 넣으세요.",
        fix: "후속 실행에 선언된 action을 지정하세요"
    }
    WORKER_WEBHOOK_DEFER_ACTION_UNDECLARED(app_id, action) {
        class: InvalidRequest,
        place: "웹훅 후속 동작 확인",
        cause: "후속 실행 동작이 워커 선언에 없다",
        message: "앱 ID {app_id}의 후속 동작 {action}: 워커에 선언되지 않았습니다. 선언된 동작으로 고치세요.",
        fix: "앱 워커에 선언된 동작을 사용하세요"
    }
    WORKER_WEBHOOK_STATUS_INVALID(app_id) {
        class: InvalidRequest,
        place: "웹훅 응답 상태 확인",
        cause: "워커가 반환한 HTTP 상태가 유효하지 않다",
        message: "앱 ID {app_id}: 워커가 유효하지 않은 웹훅 응답 상태를 반환했습니다. 100에서 999 사이의 상태를 지정하세요.",
        fix: "유효한 HTTP 상태 코드를 지정하세요"
    }
    WORKER_WEBHOOK_HEADER_NAME_INVALID(app_id) {
        class: InvalidRequest,
        place: "웹훅 응답 헤더 이름 확인",
        cause: "워커가 반환한 헤더 이름을 HTTP 헤더로 쓸 수 없다",
        message: "앱 ID {app_id}: 워커가 유효하지 않은 웹훅 응답 헤더 이름을 반환했습니다. HTTP 헤더 이름을 고치세요.",
        fix: "유효한 HTTP 헤더 이름을 사용하세요"
    }
    WORKER_WEBHOOK_HEADER_VALUE_INVALID(app_id) {
        class: InvalidRequest,
        place: "웹훅 응답 헤더 값 확인",
        cause: "워커가 반환한 헤더 값을 HTTP 헤더로 쓸 수 없다",
        message: "앱 ID {app_id}: 워커가 유효하지 않은 웹훅 응답 헤더 값을 반환했습니다. HTTP 헤더 값을 고치세요.",
        fix: "유효한 HTTP 헤더 값을 사용하세요"
    }
    WORKER_BRIDGE_BIND_FAILED() {
        class: Server,
        place: "워커 호출 다리 시작",
        cause: "로컬 호출 다리 주소를 열지 못했다",
        message: "워커 호출 다리를 시작하지 못했습니다. 서버의 로컬 네트워크 상태를 확인하세요.",
        fix: "서버에서 로컬 주소를 열 수 있는지 확인하세요"
    }
    WORKER_BRIDGE_ADDRESS_FAILED() {
        class: Server,
        place: "워커 호출 다리 주소 확인",
        cause: "열린 호출 다리의 주소를 읽지 못했다",
        message: "워커 호출 다리 주소를 확인하지 못했습니다. 서버 네트워크 상태를 확인하세요.",
        fix: "서버의 로컬 네트워크 상태를 확인하세요"
    }
    WORKER_BRIDGE_TOKEN_INVALID() {
        class: Unauthorized,
        place: "워커 호출 다리 인증",
        cause: "요청의 bearer token이 현재 워커 호출 다리의 토큰과 다르다",
        message: "워커 호출 다리 인증에 실패했습니다. 워커가 받은 인증 정보로 다시 요청하세요.",
        fix: "현재 워커 실행에서 받은 인증 정보를 사용하세요"
    }
    WORKER_BRIDGE_APP_UNDECLARED(app_id) {
        class: InvalidRequest,
        place: "워커 간 호출 권한 확인",
        cause: "호출 대상 앱이 워커의 calls 목록에 없다",
        message: "앱 ID {app_id}: 이 워커가 호출하도록 선언되지 않았습니다. 앱 정의의 calls 목록을 고치세요.",
        fix: "호출 대상 앱을 워커의 calls 목록에 선언하세요"
    }
    WORKER_BRIDGE_APP_RECURSIVE(app_id) {
        class: InvalidRequest,
        place: "워커 간 호출 순환 확인",
        cause: "호출 대상 앱이 현재 실행 경로에 이미 있다",
        message: "앱 ID {app_id}: 현재 워커 호출 경로에 이미 있어 다시 호출할 수 없습니다. calls 구성을 고치세요.",
        fix: "순환하지 않도록 워커 calls 구성을 고치세요"
    }
    WORKER_BRIDGE_CALL_DEPTH_EXCEEDED(app_id) {
        class: InvalidRequest,
        place: "워커 간 호출 깊이 확인",
        cause: "워커 간 호출이 허용된 깊이에 도달했다",
        message: "앱 ID {app_id}: 워커 간 호출이 허용된 깊이를 넘었습니다. 호출 단계를 줄이세요.",
        fix: "워커 간 호출 단계를 줄이세요"
    }
    WORKER_BRIDGE_READ_ENTRY_REQUIRED(app_id) {
        class: InvalidRequest,
        place: "워커 간 저장값 읽기 요청",
        cause: "read 요청에 entry_id가 없다",
        message: "앱 ID {app_id}: 저장값을 읽으려면 entry_id가 필요합니다. 읽을 항목 ID를 지정하세요.",
        fix: "선언된 저장 항목의 entry_id를 지정하세요"
    }
    WORKER_BRIDGE_CALL_ACTION_REQUIRED(app_id) {
        class: InvalidRequest,
        place: "워커 간 동작 호출 요청",
        cause: "call 요청에 action이 없다",
        message: "앱 ID {app_id}: 워커 동작을 호출하려면 action이 필요합니다. 선언된 동작을 지정하세요.",
        fix: "앱 워커에 선언된 action을 지정하세요"
    }
    WORKER_BRIDGE_KIND_UNKNOWN(kind) {
        class: InvalidRequest,
        place: "워커 호출 다리 요청 확인",
        cause: "요청 kind가 read 또는 call이 아니다",
        message: "워커 호출 종류 {kind}: read 또는 call이 아닙니다. 지원하는 종류로 다시 요청하세요.",
        fix: "kind에 read 또는 call을 지정하세요"
    }
}
