error_catalog! { ENTRIES;
    DATA_PREVIEW_PUBLIC_REQUEST_FAILED(source) {
        class: Server,
        place: "미리 보기 공개 원천 요청",
        cause: "공개 원천 요청 또는 응답 읽기에 실패했다",
        message: "원천 {source}: 미리 보기에서 공개 원천을 읽지 못했습니다. 원천 주소와 서버 상태를 확인하세요.",
        fix: "원천 주소와 서버 상태를 확인하세요"
    }
    DATA_PREVIEW_PUBLIC_STATUS_FAILED(source) {
        class: Server,
        place: "미리 보기 공개 원천 응답",
        cause: "공개 원천 서버가 성공이 아닌 상태를 응답했다",
        message: "원천 {source}: 미리 보기에서 서버가 성공 응답을 보내지 않았습니다. 원천 서버 상태를 확인하세요.",
        fix: "원천 서버 상태를 확인하세요"
    }
    DATA_PREVIEW_PUBLIC_JSON_INVALID(source) {
        class: Io,
        place: "미리 보기 공개 원천 JSON 해석",
        cause: "공개 원천 응답이 JSON 형식이 아니다",
        message: "원천 {source}: 미리 보기 응답이 JSON 형식이 아닙니다. 원천 응답 형식을 확인하세요.",
        fix: "원천 응답 형식을 확인하세요"
    }
    DATA_PREVIEW_PUBLIC_TEXT_INVALID(source) {
        class: Io,
        place: "미리 보기 공개 원천 텍스트 해석",
        cause: "공개 원천 응답이 UTF-8 텍스트가 아니다",
        message: "원천 {source}: 미리 보기 응답이 UTF-8 텍스트가 아닙니다. 원천 응답 형식을 확인하세요.",
        fix: "원천 응답 형식을 확인하세요"
    }
    DATA_PREVIEW_PERMISSION_NOT_FOUND(permission) {
        class: InvalidRequest,
        place: "미리 보기 원천 권한 확인",
        cause: "원천에 지정한 권한 선언을 찾지 못했다",
        message: "원천 권한 {permission}: 앱 정의에서 찾지 못했습니다. 앱 정의의 권한 선언을 고치세요.",
        fix: "앱 정의의 권한 선언을 고치세요"
    }
    DATA_PREVIEW_CONNECTION_NOT_FOUND(connection) {
        class: NotFound,
        place: "미리 보기 원천 연결 조회",
        cause: "서버에 원천 연결이 등록되지 않았다",
        message: "연결 {connection}: 서버에 등록되지 않아 원천을 미리 볼 수 없습니다. 연결 설정을 확인하세요.",
        fix: "연결 설정을 확인하세요"
    }
    DATA_PREVIEW_RELAY_STATUS_FAILED(source) {
        class: Server,
        place: "미리 보기 연결 원천 응답",
        cause: "연결된 서버가 성공이 아닌 상태를 응답했다",
        message: "원천 {source}: 미리 보기에서 서버가 성공 응답을 보내지 않았습니다. 연결과 서버 상태를 확인하세요.",
        fix: "연결과 서버 상태를 확인하세요"
    }
    DATA_PREVIEW_RELAY_JSON_INVALID(source) {
        class: Io,
        place: "미리 보기 연결 원천 JSON 해석",
        cause: "연결된 서버의 응답이 JSON 형식이 아니다",
        message: "원천 {source}: 미리 보기 응답이 JSON 형식이 아닙니다. 원천 응답 형식을 확인하세요.",
        fix: "원천 응답 형식을 확인하세요"
    }
    DATA_PREVIEW_BINDING_RESULT_MISSING(pointer) {
        class: InvalidRequest,
        place: "미리 보기 바인딩 결과 조회",
        cause: "계산한 바인딩 결과가 없다",
        message: "바인딩 경로 {pointer}: 미리 보기 계산 결과가 없습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    DATA_SOURCE_PLAN_INVALID(source, reason) {
        class: InvalidRequest,
        place: "데이터 원천 계획 검사",
        cause: "원천 선언에서 실행할 수 없는 계획이 만들어졌다",
        message: "원천 {source}: {reason}. 원천 선언의 이름과 설정을 확인하세요.",
        fix: "원천 이름과 설정을 확인하세요"
    }
    DATA_SOURCE_FILE_NOT_FOUND(source, path) {
        class: NotFound,
        place: "파일 원천 열기",
        cause: "원천 파일이 선택한 폴더에 없다",
        message: "원천 {source}의 파일 경로는 {path}입니다. 선택한 폴더에 파일이 없어 읽지 못했습니다. 파일 위치와 이름을 확인하세요.",
        fix: "선택한 폴더에 파일이 있는지 확인하세요"
    }
    DATA_SOURCE_FILE_OPEN_FAILED(source, path) {
        class: Io,
        place: "파일 원천 열기",
        cause: "원천 파일을 열 수 없다",
        message: "원천 {source}의 파일 경로는 {path}입니다. 파일을 열지 못했습니다. 파일 권한과 상태를 확인하세요.",
        fix: "파일 권한과 상태를 확인하세요"
    }
    DATA_SOURCE_FILE_READ_FAILED(source, path) {
        class: Io,
        place: "파일 원천 읽기",
        cause: "원천 파일 내용을 읽을 수 없다",
        message: "원천 {source}의 파일 경로는 {path}입니다. 파일 내용을 읽지 못했습니다. 파일 상태와 권한을 확인하세요.",
        fix: "파일 상태와 권한을 확인하세요"
    }
    DATA_SOURCE_FILE_READ_NOT_FOUND(source, path) {
        class: NotFound,
        place: "파일 원천 읽기",
        cause: "읽는 중 원천 파일이 사라졌다",
        message: "원천 {source}의 파일 경로는 {path}입니다. 읽는 중 파일을 찾지 못했습니다. 파일 위치와 상태를 확인하세요.",
        fix: "파일 위치와 상태를 확인하세요"
    }
    DATA_SOURCE_FILE_TOO_LARGE(source, path) {
        class: Io,
        place: "파일 원천 읽기",
        cause: "원천 파일이 허용 크기를 넘었다",
        message: "원천 {source}의 파일 경로는 {path}입니다. 파일이 너무 커서 읽지 못했습니다. 더 작은 파일을 지정하세요.",
        fix: "더 작은 파일을 지정하세요"
    }
    DATA_SOURCE_FILE_JSON_INVALID(source, path) {
        class: Io,
        place: "JSON 파일 원천 해석",
        cause: "원천 파일 내용이 JSON 형식이 아니다",
        message: "원천 {source}의 파일 경로는 {path}입니다. 내용이 올바른 JSON이 아니어서 읽지 못했습니다. 파일을 올바른 JSON으로 고치세요.",
        fix: "파일 내용을 올바른 JSON으로 고치세요"
    }
    DATA_SOURCE_FILE_TEXT_INVALID(source, path) {
        class: Io,
        place: "텍스트 파일 원천 해석",
        cause: "원천 파일 내용이 UTF-8 텍스트가 아니다",
        message: "원천 {source}의 파일 경로는 {path}입니다. 내용이 UTF-8 텍스트가 아닙니다. 파일을 UTF-8로 저장하세요.",
        fix: "파일을 UTF-8로 저장하세요"
    }
    DATA_SOURCE_FOLDER_NOT_FOUND(source, path) {
        class: NotFound,
        place: "폴더 원천 읽기",
        cause: "원천 폴더가 선택한 폴더에 없다",
        message: "원천 {source}의 폴더 경로는 {path}입니다. 선택한 폴더에서 이 폴더를 찾지 못했습니다. 폴더 위치와 이름을 확인하세요.",
        fix: "선택한 폴더에 폴더가 있는지 확인하세요"
    }
    DATA_SOURCE_FOLDER_READ_FAILED(source, path) {
        class: Io,
        place: "폴더 원천 읽기",
        cause: "원천 폴더 내용을 읽을 수 없다",
        message: "원천 {source}의 폴더 경로는 {path}입니다. 폴더 내용을 읽지 못했습니다. 폴더 권한과 상태를 확인하세요.",
        fix: "폴더 권한과 상태를 확인하세요"
    }
    DATA_SOURCE_FOLDER_ENTRY_NOT_FOUND(source, path) {
        class: NotFound,
        place: "폴더 원천 항목 읽기",
        cause: "원천 폴더의 항목이 읽는 중 사라졌다",
        message: "원천 {source}의 폴더 항목 경로는 {path}입니다. 읽는 중 항목이 사라졌습니다. 폴더를 다시 읽으세요.",
        fix: "폴더를 다시 읽으세요"
    }
    DATA_SOURCE_FOLDER_ENTRY_READ_FAILED(source, path) {
        class: Io,
        place: "폴더 원천 항목 읽기",
        cause: "원천 폴더의 항목 정보를 읽을 수 없다",
        message: "원천 {source}의 폴더 항목 {path} 정보를 읽지 못했습니다. 폴더 상태를 확인하세요.",
        fix: "폴더 상태를 확인하세요"
    }
    DATA_SOURCE_RESPONSE_JSON_INVALID(source) {
        class: Io,
        place: "JSON 응답 원천 해석",
        cause: "원천 응답이 JSON 형식이 아니다",
        message: "원천 {source}: 응답이 JSON 형식이 아닙니다. 원천 주소와 응답 형식을 확인하세요.",
        fix: "원천 주소와 응답 형식을 확인하세요"
    }
    DATA_SOURCE_RESPONSE_STATUS_FAILED(source, path) {
        class: Server,
        place: "데이터 원천 응답 확인",
        cause: "원천 서버가 성공이 아닌 HTTP 상태를 응답했다",
        message: "원천 {source}의 요청 경로는 {path}입니다. 서버가 성공 응답을 보내지 않아 원천을 읽지 못했습니다. 주소와 서버 상태를 확인하세요.",
        fix: "원천 서버 상태와 주소를 확인하세요"
    }
    DATA_BINDING_EXPR_FAILED(pointer, reason) {
        class: InvalidRequest,
        place: "데이터 바인딩 식 계산",
        cause: "바인딩 위치의 JSONata 식을 계산할 수 없다",
        message: "바인딩 경로 {pointer}의 JSONata 식 계산에 실패했습니다. 식과 입력값을 확인하세요. 원인: {reason}",
        fix: "표시된 바인딩의 식을 고치세요"
    }
    DATA_ACT_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "앱 동작 실행",
        cause: "동작을 실행할 창이 없다",
        message: "창 식별자 {window}: 앱 동작을 실행할 창을 찾지 못했습니다. 창을 다시 연 뒤 시도하세요.",
        fix: "앱 창을 다시 여세요"
    }
    DATA_ACT_STATE_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "앱 동작 상태 변경",
        cause: "상태를 바꾸려는 앱 창이 없다",
        message: "창 식별자 {window}: 상태를 바꿀 앱 창을 찾지 못했습니다. 창을 다시 열고 동작을 실행하세요.",
        fix: "앱 창을 다시 열고 동작을 실행하세요"
    }
    DATA_ACT_STORAGE_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "앱 동작 저장 항목 쓰기",
        cause: "저장 항목을 쓰려는 앱 창이 없다",
        message: "창 식별자 {window}: 저장 항목을 쓸 앱 창을 찾지 못했습니다. 창을 다시 열고 동작을 실행하세요.",
        fix: "앱 창을 다시 열고 동작을 실행하세요"
    }
    DATA_ACT_BUTTON_GRID_EXPR_NOT_READY(pointer) {
        class: InvalidRequest,
        place: "단추 묶음 동작 실행",
        cause: "단추 목록 식의 결과가 준비되지 않았다",
        message: "단추 묶음 {pointer}의 목록이 준비되지 않아 동작을 실행하지 못했습니다. 목록 원천을 다시 불러오세요.",
        fix: "단추 목록을 다시 불러오세요"
    }
    DATA_ACT_BUTTON_GRID_BINDING_UNSUPPORTED(pointer) {
        class: InvalidRequest,
        place: "단추 묶음 동작 실행",
        cause: "단추 목록에 동작에서 지원하지 않는 바인딩을 사용했다",
        message: "단추 묶음 {pointer}의 목록 연결을 처리할 수 없습니다. 목록을 고정값, 상태 또는 식으로 지정하세요.",
        fix: "단추 목록 연결을 고정값, 상태 또는 식으로 바꾸세요"
    }
    DATA_ACT_BUTTON_GRID_INVALID(pointer, reason) {
        class: InvalidRequest,
        place: "단추 묶음 동작 검사",
        cause: "단추 목록 항목이 선언된 형식과 맞지 않는다",
        message: "단추 묶음 {pointer}: {reason}. 목록 항목과 열 수를 확인하세요.",
        fix: "단추 목록 항목과 열 수를 확인하세요"
    }
    DATA_ACT_BUTTON_GRID_EVENT_INVALID(pointer) {
        class: InvalidRequest,
        place: "단추 묶음 선택 처리",
        cause: "선택한 단추 키가 문자열이 아니다",
        message: "단추 묶음 {pointer}에서 선택값을 읽지 못했습니다. 단추를 다시 선택하세요.",
        fix: "단추를 다시 선택하세요"
    }
    DATA_ACT_BUTTON_GRID_KEY_NOT_FOUND(pointer, key) {
        class: InvalidRequest,
        place: "단추 묶음 선택 처리",
        cause: "선택한 키와 일치하는 단추가 없다",
        message: "단추 묶음 경로 {pointer}의 선택 키 {key}: 목록에 없어 동작하지 않았습니다. 목록을 새로고침한 뒤 다시 선택하세요.",
        fix: "목록을 새로고침한 뒤 다시 선택하세요"
    }
    DATA_ACT_BUTTON_GRID_KEY_DISABLED(pointer, key) {
        class: InvalidRequest,
        place: "단추 묶음 선택 처리",
        cause: "선택한 단추가 비활성화되어 있다",
        message: "단추 묶음 경로 {pointer}의 선택 키 {key}: 비활성 항목이라 동작할 수 없습니다. 활성화된 항목을 선택하세요.",
        fix: "활성화된 항목을 선택하세요"
    }
    DATA_ACT_ACTION_NOT_FOUND(pointer) {
        class: InvalidRequest,
        place: "앱 동작 조회",
        cause: "요청한 위치에 실행할 동작이 없다",
        message: "앱 정의의 동작 경로 {pointer}: 실행할 동작이 없습니다. 동작을 연결한 뒤 다시 시도하세요.",
        fix: "앱 정의에서 동작 연결을 확인하세요"
    }
    DATA_ACT_ACTION_WINDOW_MISSING(window) {
        class: InvalidRequest,
        place: "앱 동작 조회",
        cause: "동작을 조회하는 사이 앱 창이 사라졌다",
        message: "창 식별자 {window}: 동작을 조회하는 중 창이 사라졌습니다. 창을 다시 연 뒤 동작을 시도하세요.",
        fix: "앱 창을 다시 열고 동작을 시도하세요"
    }
    DATA_ACT_ACTION_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "앱 동작 요청 확인",
        cause: "동작 요청을 받은 앱 창이 없다",
        message: "창 식별자 {window}: 동작 요청을 받은 앱 창이 없습니다. 창을 다시 열고 동작을 시도하세요.",
        fix: "앱 창을 다시 열고 동작을 시도하세요"
    }
    DATA_ACT_BUTTON_GRID_SERIALIZE_FAILED(pointer) {
        class: InvalidRequest,
        place: "단추 묶음 동작 실행",
        cause: "선택한 단추를 동작 입력으로 변환할 수 없다",
        message: "단추 묶음 {pointer}의 선택값을 전달하지 못했습니다. 단추 목록 항목을 확인하세요.",
        fix: "단추 목록 항목을 확인하세요"
    }
    DATA_ACT_STEP_INVALID(pointer, reason) {
        class: InvalidRequest,
        place: "앱 동작 계산과 검사",
        cause: "동작 단계의 계산이나 검증이 실패했다",
        message: "동작 경로 {pointer}: 계산 또는 검증에 실패했습니다. 원인: {reason}. 동작 설정과 입력값을 확인하세요.",
        fix: "해당 동작의 설정과 입력값을 확인하세요"
    }
    DATA_ACT_WORKER_WINDOW_NOT_FOUND(window, action) {
        class: NotFound,
        place: "서버 작업 동작 실행",
        cause: "동작을 실행할 창이 없다",
        message: "창 식별자 {window}, 서버 작업 {action}: 실행할 창을 찾지 못했습니다. 창을 다시 연 뒤 시도하세요.",
        fix: "앱 창을 다시 여세요"
    }
    DATA_ACT_WORKER_DESKTOP_NOT_FOUND(window, action) {
        class: NotFound,
        place: "서버 작업 동작 실행",
        cause: "동작을 실행할 작업 공간이 없다",
        message: "창 식별자 {window}, 서버 작업 {action}: 작업 공간을 찾지 못해 실행하지 못했습니다. 작업 공간을 다시 여세요.",
        fix: "작업 공간을 다시 여세요"
    }
    DATA_ACT_WORKER_SERVER_NOT_CONNECTED(action) {
        class: Unavailable,
        place: "서버 작업 동작 실행",
        cause: "서버 작업에 필요한 서버 연결이 끊겼다",
        message: "서버 작업 {action}: 서버에 연결되어 있지 않습니다. 서버를 연결한 뒤 다시 시도하세요.",
        fix: "서버를 연결하세요"
    }
    DATA_ACT_WORKER_LINK_MISSING(action) {
        class: Unavailable,
        place: "서버 작업 동작 실행",
        cause: "서버 작업에 필요한 연결 정보가 없다",
        message: "서버 작업 {action}: 연결 정보가 없습니다. 서버를 다시 연결하세요.",
        fix: "서버를 다시 연결하세요"
    }
    DATA_ACT_WORKER_UNREACHABLE(action) {
        class: Server,
        place: "서버 작업 요청 전송",
        cause: "서버에 작업 요청을 보내지 못했다",
        message: "서버 작업 {action}: 요청을 보내지 못했습니다. 서버 주소와 네트워크를 확인하세요.",
        fix: "서버 주소와 네트워크를 확인하세요"
    }
    DATA_ACT_WORKER_REJECTED(action) {
        class: Server,
        place: "서버 작업 동작 실행",
        cause: "서버가 작업 요청을 거부했다",
        message: "서버 작업 {action}: 서버가 요청을 거부했습니다. 작업 설정과 서버 상태를 확인하세요.",
        fix: "작업 설정과 서버 상태를 확인하세요"
    }
    DATA_ACT_WORKER_RESPONSE_READ_FAILED(action) {
        class: Server,
        place: "서버 작업 응답 읽기",
        cause: "서버 작업 응답을 읽지 못했다",
        message: "서버 작업 {action}: 응답을 읽지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 상태를 확인한 뒤 다시 시도하세요"
    }
    DATA_ACT_WORKER_UNAUTHORIZED(action) {
        class: Server,
        place: "서버 작업 동작 실행",
        cause: "서버가 기기 인증을 거부했다",
        message: "서버 작업 {action}: 기기 인증을 거부했습니다. 기기를 다시 연결하세요.",
        fix: "기기를 다시 연결하세요"
    }
    DATA_ACT_WORKER_NOT_FOUND(action) {
        class: Server,
        place: "서버 작업 동작 실행",
        cause: "서버에 요청한 작업이 없다",
        message: "서버 작업 {action}: 등록된 작업을 찾지 못했습니다. 앱의 작업 설정을 확인하세요.",
        fix: "앱의 작업 설정을 확인하세요"
    }
    DATA_ACT_STATE_KEY_NOT_DECLARED(key) {
        class: InvalidRequest,
        place: "앱 동작 상태 변경",
        cause: "동작이 앱에 선언되지 않은 상태 키를 바꾸려 했다",
        message: "앱 동작에서 상태 키 {key}: 앱에 선언되지 않은 키입니다. 앱 상태에 선언하세요.",
        fix: "앱 상태에 키를 선언하세요"
    }
    DATA_ACT_STATE_TOO_LARGE() {
        class: InvalidRequest,
        place: "앱 동작 상태 변경",
        cause: "상태 변경 뒤 창 상태가 허용 크기를 넘었다",
        message: "앱 동작으로 바꾼 창 상태가 너무 큽니다. 상태에 저장하는 내용을 줄이세요.",
        fix: "창 상태에 저장하는 내용을 줄이세요"
    }
    DATA_ACT_CALL_LOGIN_REQUIRED(permission) {
        class: NotGranted,
        place: "앱 연결 동작 실행",
        cause: "연결 동작을 실행할 권한에 기기 로그인이 필요하다",
        message: "연결 권한 식별자 {permission}: 이 기기에 로그인하지 않아 요청을 보내지 못했습니다. 연결에 로그인하세요.",
        fix: "이 기기에서 연결에 로그인하세요"
    }
    DATA_ACT_CALL_RATE_LIMITED(permission) {
        class: Unavailable,
        place: "앱 연결 동작 실행",
        cause: "연결 서버가 요청 한도를 넘었다고 응답했다",
        message: "연결 권한 식별자 {permission}: 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    DATA_RUNTIME_ATTACH_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "데이터 화면 연결",
        cause: "연결할 앱 창이 없다",
        message: "창 식별자 {window}: 데이터 화면을 연결할 창을 찾지 못했습니다. 창을 다시 여세요.",
        fix: "앱 창을 다시 여세요"
    }
    DATA_RUNTIME_ATTACH_APP_NOT_FOUND(window) {
        class: NotFound,
        place: "데이터 화면 연결",
        cause: "창의 앱 정의가 없다",
        message: "창 식별자 {window}: 앱 정의를 찾지 못해 데이터를 표시할 수 없습니다. 앱을 다시 불러오세요.",
        fix: "앱을 다시 불러오세요"
    }
    DATA_RUNTIME_DORMANT_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "데이터 화면 상태 변경",
        cause: "상태를 바꿀 앱 창이 없다",
        message: "창 식별자 {window}: 데이터 화면 상태를 바꿀 창을 찾지 못했습니다. 창을 다시 여세요.",
        fix: "앱 창을 다시 여세요"
    }
    DATA_RUNTIME_REFRESH_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "데이터 원천 새로고침",
        cause: "원천을 새로고침할 앱 창이 없다",
        message: "창 식별자 {window}: 원천을 새로고침할 창을 찾지 못했습니다. 창을 다시 여세요.",
        fix: "앱 창을 다시 여세요"
    }
    DATA_PROFILER_BODY_NOT_ALLOWED() {
        class: InvalidRequest,
        place: "프로파일러 요청 검사",
        cause: "프로파일러 요청에 본문이 포함되었다",
        message: "프로파일러 요청은 본문을 받지 않습니다. 요청 본문을 비우세요.",
        fix: "요청 본문을 비우세요"
    }
    DATA_PROFILER_ROUTE_NOT_FOUND(path) {
        class: InvalidRequest,
        place: "프로파일러 요청 검사",
        cause: "요청한 프로파일러 경로를 지원하지 않는다",
        message: "프로파일러 경로 {path}: 지원하지 않는 주소입니다. 지원되는 경로를 사용하세요.",
        fix: "프로파일러 앱의 지원 경로를 사용하세요"
    }
    DATA_PROFILER_METHOD_NOT_ALLOWED(path, method, allowed) {
        class: InvalidRequest,
        place: "프로파일러 요청 메서드 검사",
        cause: "지원하는 경로에 허용되지 않은 메서드로 요청했다",
        message: "프로파일러 경로 {path}: {method} 메서드로 처리할 수 없습니다. {allowed} 메서드로 요청하세요.",
        fix: "프로파일러 경로에 지원되는 메서드를 사용하세요"
    }
    DATA_PROFILER_TEMP_DIR_NOT_FOUND() {
        class: NotFound,
        place: "프로파일러 임시 폴더 만들기",
        cause: "임시 폴더의 상위 위치가 없다",
        message: "프로파일러 임시 폴더 위치를 찾지 못했습니다. 기기의 임시 폴더를 확인하세요.",
        fix: "기기의 임시 폴더를 확인하세요"
    }
    DATA_PROFILER_TEMP_DIR_CREATE_FAILED() {
        class: Io,
        place: "프로파일러 임시 폴더 만들기",
        cause: "임시 폴더를 만들 수 없다",
        message: "프로파일러 임시 폴더를 만들지 못했습니다. 디스크 공간과 권한을 확인하세요.",
        fix: "디스크 공간과 권한을 확인하세요"
    }
    DATA_PROFILER_DESKTOP_NOT_FOUND() {
        class: NotFound,
        place: "프로파일러 벤치마크 실행",
        cause: "벤치마크를 실행할 데스크톱이 없다",
        message: "프로파일러 벤치마크를 실행할 데스크톱을 찾지 못했습니다. 데스크톱을 다시 불러오세요.",
        fix: "데스크톱을 다시 불러오세요"
    }
    DATA_PROFILER_STATE_REPLY_INVALID() {
        class: InvalidRequest,
        place: "프로파일러 벤치마크 실행",
        cause: "코어가 상태 조회 대신 다른 응답을 돌려줬다",
        message: "프로파일러가 벤치마크 상태를 가져오지 못했습니다. 프로파일러를 다시 실행하세요.",
        fix: "프로파일러를 다시 실행하세요"
    }
    DATA_PROFILER_WINDOW_REPLY_INVALID() {
        class: InvalidRequest,
        place: "프로파일러 벤치마크 실행",
        cause: "코어가 창 열기 대신 다른 응답을 돌려줬다",
        message: "프로파일러가 벤치마크 창을 열지 못했습니다. 프로파일러를 다시 실행하세요.",
        fix: "프로파일러를 다시 실행하세요"
    }
    DATA_CLIENT_BLOB_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "앱 파일 보관",
        cause: "파일을 보관할 앱 창이 없다",
        message: "창 식별자 {window}: 파일을 보관할 창을 찾지 못했습니다. 앱 창을 다시 여세요.",
        fix: "앱 창을 다시 여세요"
    }
    DATA_CLIENT_BLOB_APP_NOT_FOUND(app) {
        class: NotFound,
        place: "앱 파일 보관",
        cause: "창의 앱 정의가 없다",
        message: "앱 {app}의 정의를 찾지 못해 파일을 보관할 수 없습니다. 앱을 다시 불러오세요.",
        fix: "앱을 다시 불러오세요"
    }
    DATA_CLIENT_BLOB_STORAGE_NOT_DECLARED(app) {
        class: PermissionDenied,
        place: "앱 파일 보관",
        cause: "앱이 기기 파일 보관을 선언하지 않았다",
        message: "앱 {app}에는 기기 파일 보관 권한이 없습니다. 파일 보관을 선언한 앱을 사용하세요.",
        fix: "앱의 파일 보관 선언을 확인하세요"
    }
    DATA_CLIENT_BLOB_KEY_INVALID(key) {
        class: InvalidRequest,
        place: "앱 파일 보관 키 검사",
        cause: "보관 키가 상대 경로 형식이 아니다",
        message: "보관 키 {key}: 올바른 상대 경로가 아닙니다. .과 .. 경로 조각을 없애세요.",
        fix: "상대 경로를 쓰고 .과 .. 경로 조각을 없애세요"
    }
    DATA_CLIENT_BLOB_PREFIX_DENIED(key, app) {
        class: PermissionDenied,
        place: "앱 파일 보관 키 검사",
        cause: "보관 키가 앱에 허용된 접두어로 시작하지 않는다",
        message: "보관 키 {key}: 앱 {app}에 허용되지 않은 파일 위치입니다. 앱에 허용된 파일 위치를 사용하세요.",
        fix: "앱 정의의 허용 파일 위치를 확인하세요"
    }
    DATA_CLIENT_BLOB_INPUT_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 보관 입력 열기",
        cause: "보관할 원본 파일이 없다",
        message: "보관 키 {key}에 넣을 원본 파일을 찾지 못했습니다. 파일을 다시 선택하세요.",
        fix: "원본 파일을 다시 선택하세요"
    }
    DATA_CLIENT_BLOB_INPUT_OPEN_FAILED(key) {
        class: Io,
        place: "앱 파일 보관 입력 열기",
        cause: "보관할 원본 파일을 열 수 없다",
        message: "보관 키 {key}에 넣을 원본 파일을 열지 못했습니다. 파일 권한과 상태를 확인하세요.",
        fix: "파일 권한과 상태를 확인하세요"
    }
    DATA_CLIENT_BLOB_INPUT_INVALID() {
        class: InvalidRequest,
        place: "앱 파일 보관 요청 검사",
        cause: "파일과 바이트 중 하나를 지정하지 않았다",
        message: "보관할 파일 또는 바이트를 하나 지정해야 합니다. 둘 중 하나만 선택하세요.",
        fix: "파일 또는 바이트 중 하나만 지정하세요"
    }
    DATA_CLIENT_BLOB_PARENT_INVALID(key) {
        class: InvalidRequest,
        place: "앱 파일 보관 위치 확인",
        cause: "보관 파일의 상위 폴더를 정할 수 없다",
        message: "보관 키 {key}의 저장 위치를 정하지 못했습니다. 보관 키를 확인하세요.",
        fix: "보관 키를 확인하세요"
    }
    DATA_CLIENT_BLOB_DIR_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 보관 폴더 만들기",
        cause: "보관 폴더의 상위 위치가 없다",
        message: "보관 키 {key}의 상위 폴더를 찾지 못했습니다. 앱의 보관 위치를 확인하세요.",
        fix: "앱의 보관 위치를 확인하세요"
    }
    DATA_CLIENT_BLOB_DIR_CREATE_FAILED(key) {
        class: Io,
        place: "앱 파일 보관 폴더 만들기",
        cause: "보관 폴더를 만들 수 없다",
        message: "보관 키 {key}의 폴더를 만들지 못했습니다. 디스크 공간과 권한을 확인하세요.",
        fix: "디스크 공간과 권한을 확인하세요"
    }
    DATA_CLIENT_BLOB_TEMP_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 임시 보관",
        cause: "임시 파일을 만들 위치가 없다",
        message: "보관 키 {key}의 임시 파일 위치를 찾지 못했습니다. 앱의 보관 위치를 확인하세요.",
        fix: "앱의 보관 위치를 확인하세요"
    }
    DATA_CLIENT_BLOB_TEMP_CREATE_FAILED(key) {
        class: Io,
        place: "앱 파일 임시 보관",
        cause: "임시 파일을 만들 수 없다",
        message: "보관 키 {key}의 임시 파일을 만들지 못했습니다. 디스크 공간과 권한을 확인하세요.",
        fix: "디스크 공간과 권한을 확인하세요"
    }
    DATA_CLIENT_BLOB_COPY_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 내용 복사",
        cause: "파일 내용을 읽거나 쓸 위치가 없다",
        message: "보관 키 {key}의 파일 내용을 복사할 위치를 찾지 못했습니다. 보관 위치를 확인하세요.",
        fix: "보관 위치를 확인하세요"
    }
    DATA_CLIENT_BLOB_COPY_FAILED(key) {
        class: Io,
        place: "앱 파일 내용 복사",
        cause: "파일 내용을 복사할 수 없다",
        message: "보관 키 {key}에 파일 내용을 복사하지 못했습니다. 파일과 디스크 상태를 확인하세요.",
        fix: "파일과 디스크 상태를 확인하세요"
    }
    DATA_CLIENT_BLOB_TOO_LARGE(key) {
        class: InvalidRequest,
        place: "앱 파일 보관 크기 검사",
        cause: "보관할 파일이 허용 크기를 넘었다",
        message: "보관 키 {key}에 넣을 파일이 512MiB를 넘습니다. 더 작은 파일을 선택하세요.",
        fix: "더 작은 파일을 선택하세요"
    }
    DATA_CLIENT_BLOB_FLUSH_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 임시 보관 완료",
        cause: "임시 파일을 마무리할 위치가 없다",
        message: "보관 키 {key}의 임시 파일을 마무리할 위치를 찾지 못했습니다. 보관 위치를 확인하세요.",
        fix: "보관 위치를 확인하세요"
    }
    DATA_CLIENT_BLOB_FLUSH_FAILED(key) {
        class: Io,
        place: "앱 파일 임시 보관 완료",
        cause: "임시 파일 내용을 디스크에 반영할 수 없다",
        message: "보관 키 {key}의 파일을 마무리하지 못했습니다. 디스크 공간과 상태를 확인하세요.",
        fix: "디스크 공간과 상태를 확인하세요"
    }
    DATA_CLIENT_BLOB_RENAME_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 보관 완료",
        cause: "임시 파일이나 보관 위치가 없다",
        message: "보관 키 {key}의 파일을 보관 위치로 옮기지 못했습니다. 보관 위치를 확인하세요.",
        fix: "보관 위치를 확인하세요"
    }
    DATA_CLIENT_BLOB_RENAME_FAILED(key) {
        class: Io,
        place: "앱 파일 보관 완료",
        cause: "임시 파일을 보관 위치로 옮길 수 없다",
        message: "보관 키 {key}의 파일을 보관 위치로 옮기지 못했습니다. 파일과 디스크 상태를 확인하세요.",
        fix: "파일과 디스크 상태를 확인하세요"
    }
    DATA_CLIENT_BLOB_REMOVE_FAILED(key) {
        class: Io,
        place: "앱 파일 삭제",
        cause: "보관 파일을 삭제할 수 없다",
        message: "보관 키 {key}의 파일을 삭제하지 못했습니다. 파일 권한과 상태를 확인하세요.",
        fix: "파일 권한과 상태를 확인하세요"
    }
    DATA_CLIENT_BLOB_LIST_READ_FAILED(prefix) {
        class: Io,
        place: "앱 파일 목록 조회",
        cause: "보관 폴더 목록을 읽을 수 없다",
        message: "보관 위치 {prefix}의 파일 목록을 읽지 못했습니다. 폴더 권한과 상태를 확인하세요.",
        fix: "폴더 권한과 상태를 확인하세요"
    }
    DATA_CLIENT_BLOB_LIST_ENTRY_NOT_FOUND(prefix) {
        class: NotFound,
        place: "앱 파일 목록 항목 읽기",
        cause: "목록을 읽는 중 파일 항목이 사라졌다",
        message: "보관 위치 {prefix}의 파일 목록 항목을 찾지 못했습니다. 목록을 다시 조회하세요.",
        fix: "파일 목록을 다시 조회하세요"
    }
    DATA_CLIENT_BLOB_LIST_ENTRY_READ_FAILED(prefix) {
        class: Io,
        place: "앱 파일 목록 항목 읽기",
        cause: "파일 목록 항목 정보를 읽을 수 없다",
        message: "보관 위치 {prefix}의 파일 항목 정보를 읽지 못했습니다. 폴더 상태를 확인하세요.",
        fix: "폴더 상태를 확인하세요"
    }
    DATA_CLIENT_BLOB_LIST_KIND_NOT_FOUND(prefix) {
        class: NotFound,
        place: "앱 파일 목록 항목 종류 확인",
        cause: "파일 목록 항목이 확인 중 사라졌다",
        message: "보관 위치 {prefix}의 파일 항목을 찾지 못했습니다. 목록을 다시 조회하세요.",
        fix: "파일 목록을 다시 조회하세요"
    }
    DATA_CLIENT_BLOB_LIST_KIND_READ_FAILED(prefix) {
        class: Io,
        place: "앱 파일 목록 항목 종류 확인",
        cause: "파일 항목의 종류를 확인할 수 없다",
        message: "보관 위치 {prefix}의 파일 종류를 확인하지 못했습니다. 폴더 상태를 확인하세요.",
        fix: "폴더 상태를 확인하세요"
    }
    DATA_CLIENT_HTTP_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "공개 HTTPS 읽기",
        cause: "요청을 보낼 앱 창이 없다",
        message: "창 식별자 {window}: 공개 HTTPS 요청을 보낼 창을 찾지 못했습니다. 앱 창을 다시 여세요.",
        fix: "앱 창을 다시 여세요"
    }
    DATA_CLIENT_HTTP_APP_NOT_FOUND(app) {
        class: NotFound,
        place: "공개 HTTPS 읽기",
        cause: "창의 앱 정의가 없다",
        message: "앱 {app}의 정의를 찾지 못해 공개 HTTPS 내용을 읽지 못했습니다. 앱을 다시 불러오세요.",
        fix: "앱을 다시 불러오세요"
    }
    DATA_CLIENT_HTTP_CLIENT_PERMISSION_DENIED(permission) {
        class: PermissionDenied,
        place: "공개 HTTPS 권한 확인",
        cause: "앱 클라이언트에 공개 HTTPS 권한이 선언되지 않았다",
        message: "HTTP 권한 식별자 {permission}: 앱 클라이언트에 선언되지 않았습니다. 앱 권한 설정을 확인하세요.",
        fix: "앱의 공개 HTTPS 권한 선언을 확인하세요"
    }
    DATA_CLIENT_HTTP_APP_PERMISSION_DENIED(permission) {
        class: PermissionDenied,
        place: "공개 HTTPS 권한 확인",
        cause: "앱에 요청한 공개 HTTPS 권한이 선언되지 않았다",
        message: "HTTP 권한 식별자 {permission}: 앱에 선언되지 않았습니다. 앱 권한 설정을 확인하세요.",
        fix: "앱의 공개 HTTPS 권한 선언을 확인하세요"
    }
    DATA_CLIENT_HTTP_READ_FAILED(path) {
        class: Server,
        place: "공개 HTTPS 내용 읽기",
        cause: "공개 HTTPS 주소에 요청을 보내거나 응답을 읽지 못했다",
        message: "공개 HTTPS 경로 {path}의 내용을 읽지 못했습니다. 주소와 네트워크를 확인하세요.",
        fix: "주소와 네트워크 연결을 확인하세요"
    }
    DATA_CLIENT_HTTP_STATUS_FAILED(path) {
        class: Server,
        place: "공개 HTTPS 응답 확인",
        cause: "공개 HTTPS 서버가 성공이 아닌 HTTP 상태를 응답했다",
        message: "공개 HTTPS 요청 경로는 {path}입니다. 서버가 성공 응답을 보내지 않아 내용을 읽지 못했습니다. 주소와 서버 상태를 확인하세요.",
        fix: "주소와 서버 상태를 확인하세요"
    }
    DATA_HTTP_CLIENT_BUILD_FAILED() {
        class: Server,
        place: "HTTP 요청 준비",
        cause: "HTTP 클라이언트를 만들 수 없다",
        message: "HTTP 요청을 준비하지 못했습니다. 앱을 다시 시작하고 문제가 계속되면 관리자에게 알리세요.",
        fix: "앱을 다시 시작하세요"
    }
}
