error_catalog! { ENTRIES;
    DATA_CLIENT_HTTP_REQUEST_WINDOW_NOT_FOUND() { class: NotFound, place: "HTTP 요청 창 확인", cause: "요청할 창이 없다", message: "HTTP 요청을 보낼 창이 없습니다. 앱을 다시 여세요.", fix: "앱을 다시 여세요" }
    DATA_CLIENT_HTTP_REQUEST_APP_NOT_FOUND(app) { class: NotFound, place: "HTTP 요청 앱 확인", cause: "앱 정의가 없다", message: "앱 {app}의 정의가 없어 HTTP 요청을 보낼 수 없습니다. 앱을 다시 가져오세요.", fix: "앱을 다시 가져오세요" }
    DATA_CLIENT_HTTP_REQUEST_CLIENT_PERMISSION_DENIED(permission) { class: PermissionDenied, place: "HTTP 요청 클라이언트 권한 확인", cause: "클라이언트에 권한이 없다", message: "HTTP 권한 {permission}이 client.http_permissions에 없습니다. 앱 정의에 이 권한을 추가하세요.", fix: "client.http_permissions에 권한을 추가하세요" }
    DATA_CLIENT_HTTP_REQUEST_PERMISSION_INVALID(permission) { class: PermissionDenied, place: "HTTP 요청 권한 종류 확인", cause: "HTTP 권한이 아니다", message: "권한 {permission}은 HTTP 권한이 아닙니다. 앱 정의의 permissions를 확인하세요.", fix: "앱 정의의 permissions를 확인하세요" }
    DATA_CLIENT_HTTP_REQUEST_MODULE_VERSION(permission) { class: PermissionDenied, place: "HTTP 요청 모듈 판 확인", cause: "http 모듈이 3판보다 낮다", message: "HTTP 권한 {permission}으로 요청하려면 requires.modules.http를 3으로 올리세요.", fix: "requires.modules.http를 3으로 올리세요" }
    DATA_CLIENT_HTTP_REQUEST_WRITE_DENIED(permission) { class: PermissionDenied, place: "HTTP 요청 쓰기 권한 확인", cause: "읽기 전용 권한으로 쓰기를 요청했다", message: "HTTP 권한 {permission}으로 쓰려면 권한에 \"access\": \"readwrite\"를 두세요.", fix: "앱 정의의 권한에 access: readwrite를 두세요" }
    DATA_CLIENT_HTTP_REQUEST_GET_BODY() { class: InvalidRequest, place: "HTTP GET 본문 확인", cause: "GET 요청에 본문이 있다", message: "HTTP GET 요청에는 본문을 넣을 수 없습니다. 앱 코드에서 body를 빼세요.", fix: "앱 코드에서 body를 빼세요" }
    DATA_CLIENT_HTTP_REQUEST_HEADERS_TOO_MANY() { class: InvalidRequest, place: "HTTP 요청 헤더 수 확인", cause: "헤더가 32개를 넘는다", message: "HTTP 요청 헤더는 32개까지 보낼 수 있습니다. 앱 코드의 headers를 줄이세요.", fix: "앱 코드의 headers를 줄이세요" }
    DATA_CLIENT_HTTP_REQUEST_HEADER_NAME_INVALID(name) { class: InvalidRequest, place: "HTTP 요청 헤더 이름 확인", cause: "헤더 이름이 올바르지 않다", message: "HTTP 헤더 이름 {name}이 올바르지 않습니다. 앱 코드의 headers를 고치세요.", fix: "앱 코드의 headers를 고치세요" }
    DATA_CLIENT_HTTP_REQUEST_HEADER_VALUE_INVALID(name) { class: InvalidRequest, place: "HTTP 요청 헤더 값 확인", cause: "헤더 값이 올바르지 않다", message: "HTTP 헤더 {name}의 값이 올바르지 않습니다. 앱 코드의 headers를 고치세요.", fix: "앱 코드의 headers를 고치세요" }
    DATA_CLIENT_HTTP_REQUEST_HEADER_VALUE_TOO_LARGE(name) { class: InvalidRequest, place: "HTTP 요청 헤더 값 크기 확인", cause: "헤더 값이 8KiB를 넘는다", message: "HTTP 헤더 {name}의 값이 8KiB를 넘습니다. 앱 코드의 헤더 값을 줄이세요.", fix: "앱 코드의 헤더 값을 줄이세요" }
    DATA_CLIENT_HTTP_REQUEST_HEADER_FORBIDDEN(name) { class: PermissionDenied, place: "HTTP 요청 금지 헤더 확인", cause: "인증 또는 전송 계층 헤더다", message: "HTTP 헤더 {name}은 앱에서 보낼 수 없습니다. 앱 코드의 headers에서 빼세요.", fix: "앱 코드의 headers에서 해당 헤더를 빼세요" }
    DATA_CLIENT_HTTP_REQUEST_BODY_TOO_LARGE(limit) { class: InvalidRequest, place: "HTTP 요청 본문 크기 확인", cause: "요청 본문이 제한보다 크다", message: "HTTP 요청 본문은 {limit}까지 보낼 수 있습니다. 앱 코드에서 본문 크기를 줄이세요.", fix: "앱 코드에서 본문 크기를 줄이세요" }
    DATA_CLIENT_HTTP_REQUEST_ADDRESS_INVALID(path) { class: PermissionDenied, place: "HTTP 요청 주소 확인", cause: "주소나 경로가 허용되지 않았다", message: "HTTP 경로 {path}는 허용되지 않습니다. 앱 정의의 공개 HTTPS 주소와 paths를 확인하세요.", fix: "앱 정의의 base_url과 paths를 확인하세요" }
    DATA_CLIENT_HTTP_REQUEST_PRIVATE_ADDRESS(path) { class: PermissionDenied, place: "HTTP 요청 DNS 확인", cause: "DNS가 공개 주소가 아닌 값을 돌려줬다", message: "HTTP 경로 {path}의 서버가 공개 주소가 아닙니다. 앱 정의의 base_url을 확인하세요.", fix: "앱 정의의 base_url을 확인하세요" }
    DATA_CLIENT_HTTP_REQUEST_TRANSPORT_FAILED(path) { class: Server, place: "HTTP 요청 전송", cause: "서버에 요청하거나 응답을 읽지 못했다", message: "HTTP 경로 {path}에 요청을 보내거나 응답을 읽지 못했습니다. 주소와 네트워크를 확인하세요.", fix: "주소와 네트워크를 확인하세요" }
    DATA_CLIENT_HTTP_REQUEST_RESPONSE_TOO_LARGE(limit) { class: InvalidRequest, place: "HTTP 응답 크기 확인", cause: "응답이 제한보다 크다", message: "HTTP 응답이 {limit}를 넘습니다. 앱에서 더 작은 응답을 요청하세요.", fix: "앱에서 더 작은 응답을 요청하세요" }
    DATA_RUNTIME_MORE_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "다음 쪽을 받을 창 확인",
        cause: "원천이 속한 창이 없다",
        message: "다음 쪽을 받을 창이 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_RUNTIME_MORE_SOURCE_NOT_PAGED(source) {
        class: InvalidRequest,
        place: "다음 쪽을 받을 원천 확인",
        cause: "원천에 쪽 넘김 선언이 없다",
        message: "원천 {source}에 쪽 넘김 선언이 없습니다. 앱 정의의 원천에 page를 선언하세요.",
        fix: "앱 정의의 원천에 page를 선언하세요"
    }
    DATA_SOURCE_PAGE_NEXT_FAILED(source, reason) {
        class: InvalidRequest,
        place: "다음 쪽 식 계산",
        cause: "다음 쪽 값을 계산하지 못했다",
        message: "원천 {source}의 다음 쪽 식을 계산하지 못했습니다. 앱 정의의 page.next를 고치세요. 원인: {reason}",
        fix: "앱 정의의 page.next를 고치세요"
    }
    DATA_SOURCE_PAGE_NEXT_INVALID(source, kind) {
        class: InvalidRequest,
        place: "다음 쪽 식 결과 검사",
        cause: "다음 쪽 식이 문자열이나 숫자가 아닌 값을 냈다",
        message: "원천 {source}의 다음 쪽 식이 사용할 수 없는 {kind} 값을 냈습니다. 앱 정의의 page.next를 고치세요.",
        fix: "앱 정의의 page.next를 고치세요"
    }
    DATA_SOURCE_PAGE_ITEMS_NOT_ARRAY(source, path) {
        class: InvalidRequest,
        place: "쪽 응답의 항목 배열 검사",
        cause: "지정한 항목 위치가 배열이 아니다",
        message: "원천 {source}의 항목 위치 {path}가 배열이 아닙니다. 앱 정의의 page.items와 응답 형식을 확인하세요.",
        fix: "앱 정의의 page.items와 응답 형식을 확인하세요"
    }
    DATA_SOURCE_MORE_LOGIN_REQUIRED(source, permission) {
        class: NotGranted,
        place: "다음 쪽 요청 로그인 확인",
        cause: "연결에 다시 로그인해야 한다",
        message: "원천 {source}의 다음 쪽을 받으려면 {permission} 연결에 다시 로그인하세요.",
        fix: "연결에 다시 로그인하세요"
    }
    DATA_SOURCE_MORE_RATE_LIMITED(source, time) {
        class: Server,
        place: "다음 쪽 요청 한도 확인",
        cause: "요청 한도로 기다려야 한다",
        message: "원천 {source}의 요청 한도에 도달했습니다. {time} 이후 다시 받기를 누르세요.",
        fix: "표시된 시간 이후 다시 받기를 누르세요"
    }
    DATA_PREVIEW_PUBLIC_REQUEST_FAILED(source) {
        class: Server,
        place: "미리 보기 공개 원천 요청",
        cause: "공개 원천 요청 또는 응답 읽기에 실패했다",
        message: "원천 {source}: 미리 보기에서 공개 원천을 읽지 못했습니다. 원천 주소가 맞는지, 그 서버가 응답하는지 확인하세요.",
        fix: "원천 주소가 맞는지, 그 서버가 응답하는지 확인하세요"
    }
    DATA_PREVIEW_PUBLIC_STATUS_FAILED(source) {
        class: Server,
        place: "미리 보기 공개 원천 응답",
        cause: "공개 원천 서버가 성공이 아닌 상태를 응답했다",
        message: "원천 {source}: 미리 보기에서 서버가 성공 응답을 보내지 않았습니다. 앱 정의의 원천 주소가 맞는지 확인하세요.",
        fix: "앱 정의의 원천 주소가 맞는지 확인하세요"
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
        message: "연결 {connection}: 서버에 등록되지 않아 원천을 미리 볼 수 없습니다. set_connection으로 연결을 등록하세요.",
        fix: "set_connection으로 연결을 등록하세요"
    }
    DATA_PREVIEW_RELAY_STATUS_FAILED(source) {
        class: Server,
        place: "미리 보기 연결 원천 응답",
        cause: "연결된 서버가 성공이 아닌 상태를 응답했다",
        message: "원천 {source}: 미리 보기에서 연결된 서버가 성공 응답을 보내지 않았습니다. list_connections로 연결 설정을 확인하세요.",
        fix: "list_connections로 연결 설정을 확인하세요"
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
        message: "바인딩 경로 {pointer}: 미리 보기 계산 결과가 없습니다. 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    DATA_SOURCE_PLAN_INVALID(source, reason) {
        class: InvalidRequest,
        place: "데이터 원천 계획 검사",
        cause: "원천 선언에서 실행할 수 없는 계획이 만들어졌다",
        message: "원천 {source}의 선언을 실행할 수 없습니다. 앱 정의의 원천 이름과 설정을 고치세요. 원인: {reason}",
        fix: "앱 정의의 원천 이름과 설정을 고치세요"
    }
    DATA_SOURCE_FILE_NOT_FOUND(source, path) {
        class: NotFound,
        place: "파일 원천 열기",
        cause: "원천 파일이 선택한 폴더에 없다",
        message: "원천 {source}: 선택한 폴더에 파일이 없습니다. 파일 위치와 이름을 확인하세요. 파일: {path}",
        fix: "선택한 폴더에 파일이 있는지 확인하세요"
    }
    DATA_SOURCE_FILE_OPEN_FAILED(source, path) {
        class: Io,
        place: "파일 원천 열기",
        cause: "원천 파일을 열 수 없다",
        message: "원천 {source}: 파일을 열지 못했습니다. 파일 관리자에서 열리는지 확인하세요. 파일: {path}",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    DATA_SOURCE_FILE_READ_FAILED(source, path) {
        class: Io,
        place: "파일 원천 읽기",
        cause: "원천 파일 내용을 읽을 수 없다",
        message: "원천 {source}: 파일 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요. 파일: {path}",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    DATA_SOURCE_FILE_READ_NOT_FOUND(source, path) {
        class: NotFound,
        place: "파일 원천 읽기",
        cause: "읽는 중 원천 파일이 사라졌다",
        message: "원천 {source}: 읽는 동안 파일이 사라졌습니다. 파일 관리자에서 경로를 확인하세요. 파일: {path}",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    DATA_SOURCE_FILE_TOO_LARGE(source, limit, path) {
        class: Io,
        place: "파일 원천 읽기",
        cause: "원천 파일이 허용 크기를 넘었다",
        message: "원천 {source}: 파일이 허용 크기 {limit}보다 큽니다. 더 작은 파일을 지정하세요. 파일: {path}",
        fix: "더 작은 파일을 지정하세요"
    }
    DATA_SOURCE_FILE_JSON_INVALID(source, path) {
        class: Io,
        place: "JSON 파일 원천 해석",
        cause: "원천 파일 내용이 JSON 형식이 아니다",
        message: "원천 {source}: 파일 내용이 올바른 JSON이 아닙니다. 파일을 올바른 JSON으로 고치세요. 파일: {path}",
        fix: "파일 내용을 올바른 JSON으로 고치세요"
    }
    DATA_SOURCE_FILE_TEXT_INVALID(source, path) {
        class: Io,
        place: "텍스트 파일 원천 해석",
        cause: "원천 파일 내용이 UTF-8 텍스트가 아니다",
        message: "원천 {source}: 파일 내용이 UTF-8 텍스트가 아닙니다. 파일을 UTF-8로 저장하세요. 파일: {path}",
        fix: "파일을 UTF-8로 저장하세요"
    }
    DATA_SOURCE_FOLDER_NOT_FOUND(source, path) {
        class: NotFound,
        place: "폴더 원천 읽기",
        cause: "원천 폴더가 선택한 폴더에 없다",
        message: "원천 {source}: 선택한 폴더에서 이 폴더를 찾지 못했습니다. 폴더 위치와 이름을 확인하세요. 폴더: {path}",
        fix: "선택한 폴더에 폴더가 있는지 확인하세요"
    }
    DATA_SOURCE_FOLDER_READ_FAILED(source, path) {
        class: Io,
        place: "폴더 원천 읽기",
        cause: "원천 폴더 내용을 읽을 수 없다",
        message: "원천 {source}: 폴더 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요. 폴더: {path}",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    DATA_SOURCE_FOLDER_ENTRY_NOT_FOUND(source, path) {
        class: NotFound,
        place: "폴더 원천 항목 읽기",
        cause: "원천 폴더의 항목이 읽는 중 사라졌다",
        message: "원천 {source}: 읽는 동안 항목이 사라졌습니다. 다시 받기를 누르세요. 폴더: {path}",
        fix: "다시 받기를 누르세요"
    }
    DATA_SOURCE_FOLDER_ENTRY_READ_FAILED(source, path) {
        class: Io,
        place: "폴더 원천 항목 읽기",
        cause: "원천 폴더의 항목 정보를 읽을 수 없다",
        message: "원천 {source}: 폴더 안의 항목 정보를 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요. 폴더: {path}",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    DATA_SOURCE_RESPONSE_JSON_INVALID(source) {
        class: Io,
        place: "JSON 응답 원천 해석",
        cause: "원천 응답이 JSON 형식이 아니다",
        message: "원천 {source}: 응답이 JSON 형식이 아닙니다. 원천 주소와 응답 형식을 확인하세요.",
        fix: "원천 주소와 응답 형식을 확인하세요"
    }
    DATA_SOURCE_RESPONSE_NOT_FOUND(target) {
        class: Server,
        place: "데이터 원천 응답 확인",
        cause: "서버가 요청한 자료를 찾지 못했다",
        message: "{target}의 서버가 자료를 찾지 못했습니다. 앱 정의의 원천 주소를 확인하세요.",
        fix: "앱 정의의 원천 주소를 확인하세요"
    }
    DATA_SOURCE_RESPONSE_DENIED(target) {
        class: Server,
        place: "데이터 원천 응답 확인",
        cause: "서버가 자료 읽기를 거부했다",
        message: "{target}의 서버가 자료를 읽을 권한이 없다고 응답했습니다. 연결 설정이나 로그인을 확인하세요.",
        fix: "연결 설정이나 로그인을 확인하세요"
    }
    DATA_SOURCE_RESPONSE_SERVER_ERROR(target, reason) {
        class: Server,
        place: "데이터 원천 응답 확인",
        cause: "원천 서버에 오류가 발생했다",
        message: "{target}의 서버에 오류가 나서 자료를 받지 못했습니다. 잠시 뒤 다시 받기를 누르세요. 원인: {reason}",
        fix: "잠시 뒤 다시 받기를 누르세요"
    }
    DATA_SOURCE_RESPONSE_STATUS_FAILED(target, reason) {
        class: Server,
        place: "데이터 원천 응답 확인",
        cause: "원천 서버가 성공이 아닌 HTTP 상태를 응답했다",
        message: "{target}의 서버가 성공 응답을 보내지 않아 자료를 받지 못했습니다. 다시 받기를 누르고, 계속되면 에이전트에게 이 오류 코드를 전하세요. 원인: {reason}",
        fix: "다시 받기를 누르고, 계속되면 에이전트에게 이 오류 코드를 전하세요"
    }
    DATA_BINDING_EXPR_FAILED() {
        class: InvalidRequest,
        place: "데이터 바인딩 식 계산",
        cause: "바인딩 위치의 JSONata 식을 계산할 수 없다",
        message: "화면에 표시할 값을 계산하지 못했습니다. 입력값을 확인하거나 에이전트에게 앱 정의의 식을 고쳐 달라고 요청하세요",
        fix: "입력값을 확인하거나 에이전트에게 앱 정의의 식을 고쳐 달라고 요청하세요"
    }
    DATA_ACT_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 동작 실행",
        cause: "동작을 실행할 창이 없다",
        message: "앱 동작을 실행할 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_ACT_STATE_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 동작 상태 변경",
        cause: "상태를 바꾸려는 앱 창이 없다",
        message: "상태를 바꿀 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_ACT_STORAGE_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 동작 저장 항목 쓰기",
        cause: "저장 항목을 쓰려는 앱 창이 없다",
        message: "저장 항목을 쓸 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_ACT_BUTTON_GRID_EXPR_NOT_READY() {
        class: InvalidRequest,
        place: "단추 묶음 동작 실행",
        cause: "단추 목록 식의 결과가 준비되지 않았다",
        message: "단추 목록이 아직 준비되지 않았습니다. 잠시 뒤 다시 누르세요.",
        fix: "잠시 뒤 다시 누르세요"
    }
    DATA_ACT_BUTTON_GRID_BINDING_UNSUPPORTED(pointer) {
        class: InvalidRequest,
        place: "단추 묶음 동작 실행",
        cause: "단추 목록에 동작에서 지원하지 않는 바인딩을 사용했다",
        message: "단추 묶음 {pointer}: 동작에서 이 목록 연결을 쓸 수 없습니다. 앱 정의에서 목록을 고정값, 상태, 식 가운데 하나로 지정하세요.",
        fix: "단추 목록 연결을 고정값, 상태 또는 식으로 바꾸세요"
    }
    DATA_ACT_BUTTON_GRID_INVALID(pointer, reason) {
        class: InvalidRequest,
        place: "단추 묶음 동작 검사",
        cause: "단추 목록 항목이 선언된 형식과 맞지 않는다",
        message: "단추 묶음 {pointer}의 목록 항목이 앱 정의와 맞지 않습니다. 앱 정의의 목록 항목과 열 수를 고치세요. 원인: {reason}",
        fix: "앱 정의의 목록 항목과 열 수를 고치세요"
    }
    DATA_ACT_BUTTON_GRID_EVENT_INVALID(pointer) {
        class: InvalidRequest,
        place: "단추 묶음 선택 처리",
        cause: "선택한 단추 키가 문자열이 아니다",
        message: "단추 묶음 {pointer}에서 선택값을 읽지 못했습니다. 단추를 다시 선택하세요.",
        fix: "단추를 다시 선택하세요"
    }
    DATA_ACT_BUTTON_GRID_KEY_NOT_FOUND(key) {
        class: InvalidRequest,
        place: "단추 묶음 선택 처리",
        cause: "선택한 키와 일치하는 단추가 없다",
        message: "누른 단추가 목록에 더 이상 없습니다: {key}. 바뀐 목록에서 다시 누르세요.",
        fix: "바뀐 목록에서 다시 누르세요"
    }
    DATA_ACT_BUTTON_GRID_KEY_DISABLED(key) {
        class: InvalidRequest,
        place: "단추 묶음 선택 처리",
        cause: "선택한 단추가 비활성화되어 있다",
        message: "누른 단추는 지금 쓸 수 없습니다: {key}. 활성화된 단추를 누르세요.",
        fix: "활성화된 단추를 누르세요"
    }
    DATA_ACT_ACTION_NOT_FOUND(pointer) {
        class: InvalidRequest,
        place: "앱 동작 조회",
        cause: "요청한 위치에 실행할 동작이 없다",
        message: "앱 정의의 동작 경로 {pointer}: 실행할 동작이 없습니다. 동작을 연결한 뒤 다시 시도하세요.",
        fix: "앱 정의에서 동작 연결을 확인하세요"
    }
    DATA_ACT_ACTION_WINDOW_MISSING() {
        class: InvalidRequest,
        place: "앱 동작 조회",
        cause: "동작을 조회하는 사이 앱 창이 사라졌다",
        message: "동작을 찾는 사이 창이 사라졌습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_ACT_ACTION_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 동작 요청 확인",
        cause: "동작 요청을 받은 앱 창이 없다",
        message: "동작을 받을 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
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
        message: "동작 경로 {pointer}의 계산이나 검사가 실패했습니다. 앱 정의의 동작 설정과 입력값을 확인하세요. 원인: {reason}",
        fix: "앱 정의의 동작 설정과 입력값을 확인하세요"
    }
    DATA_SHELL_OPEN_APP_ID_INVALID(value) {
        class: InvalidRequest,
        place: "쉘 열기 동작 실행",
        cause: "app_id 바인딩이 비어 있지 않은 문자열을 내지 않았다",
        message: "쉘 열기 동작의 앱 ID가 올바르지 않습니다. 앱 정의의 app_id 바인딩이 비어 있지 않은 문자열을 내도록 고치세요. 받은 값: {value}",
        fix: "app_id 바인딩이 비어 있지 않은 문자열을 내도록 고치세요"
    }
    DATA_SHELL_SHORTCUT_APP_ID_INVALID(value) {
        class: InvalidRequest,
        place: "쉘 바탕화면 아이콘 동작 실행",
        cause: "app_id 바인딩이 비어 있지 않은 문자열을 내지 않았다",
        message: "쉘 바탕화면 아이콘 동작의 앱 ID가 올바르지 않습니다. 앱 정의의 app_id 바인딩이 비어 있지 않은 문자열을 내도록 고치세요. 받은 값: {value}",
        fix: "app_id 바인딩이 비어 있지 않은 문자열을 내도록 고치세요"
    }
    DATA_SHELL_ACT_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "쉘 동작 실행",
        cause: "동작을 실행하는 앱 창이 없다",
        message: "쉘 동작을 실행할 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_ACT_WORKER_WINDOW_NOT_FOUND(action) {
        class: NotFound,
        place: "서버 작업 동작 실행",
        cause: "동작을 실행할 창이 없다",
        message: "워커 동작 {action}: 실행할 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_ACT_WORKER_DESKTOP_NOT_FOUND(action) {
        class: NotFound,
        place: "서버 작업 동작 실행",
        cause: "동작을 실행할 작업 공간이 없다",
        message: "워커 동작 {action}: 창이 속한 데스크톱이 없어 실행하지 못했습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_ACT_WORKER_SERVER_NOT_CONNECTED(action) {
        class: Unavailable,
        place: "서버 작업 동작 실행",
        cause: "서버 작업에 필요한 서버 연결이 끊겼다",
        message: "워커 동작 {action}: 서버에 연결되어 있지 않습니다. 서버를 연결한 뒤 다시 시도하세요.",
        fix: "서버를 연결하세요"
    }
    DATA_ACT_WORKER_LINK_MISSING(action) {
        class: Unavailable,
        place: "서버 작업 동작 실행",
        cause: "서버 작업에 필요한 연결 정보가 없다",
        message: "워커 동작 {action}: 이 기기의 서버 연결 정보가 없습니다. 서버를 다시 연결하세요.",
        fix: "서버를 다시 연결하세요"
    }
    DATA_ACT_WORKER_UNREACHABLE(action) {
        class: Server,
        place: "서버 작업 요청 전송",
        cause: "서버에 작업 요청을 보내지 못했다",
        message: "워커 동작 {action}: 서버에 요청을 보내지 못했습니다. 서버 주소와 네트워크를 확인하세요.",
        fix: "서버 주소와 네트워크를 확인하세요"
    }
    DATA_ACT_WORKER_REJECTED(action) {
        class: Server,
        place: "서버 작업 동작 실행",
        cause: "서버가 작업 요청을 거부했다",
        message: "워커 동작 {action}: 서버가 요청을 거부했습니다. 앱 정의의 worker 설정을 확인하세요.",
        fix: "앱 정의의 worker 설정을 확인하세요"
    }
    DATA_ACT_WORKER_RESPONSE_READ_FAILED(action) {
        class: Server,
        place: "워커 동작 응답 읽기",
        cause: "워커 동작의 서버 응답을 읽지 못했다",
        message: "워커 동작 {action}: 서버 응답을 읽지 못했습니다. 동작은 실행됐을 수 있으니 결과를 확인한 뒤 다시 시도하세요.",
        fix: "결과를 확인한 뒤 다시 시도하세요"
    }
    DATA_ACT_WORKER_UNAUTHORIZED(action) {
        class: Server,
        place: "서버 작업 동작 실행",
        cause: "서버가 기기 인증을 거부했다",
        message: "워커 동작 {action}: 서버가 이 기기의 인증을 거부했습니다. 서버 연결에서 기기를 다시 연결하세요.",
        fix: "서버 연결에서 기기를 다시 연결하세요"
    }
    DATA_ACT_WORKER_NOT_FOUND(action) {
        class: Server,
        place: "서버 작업 동작 실행",
        cause: "서버에 요청한 작업이 없다",
        message: "워커 동작 {action}: 서버에 등록된 동작이 없습니다. 앱 정의의 worker 설정을 확인하세요.",
        fix: "앱 정의의 worker 설정을 확인하세요"
    }
    DATA_ACT_STATE_KEY_NOT_DECLARED(key) {
        class: InvalidRequest,
        place: "앱 동작 상태 변경",
        cause: "동작이 앱에 선언되지 않은 상태 키를 바꾸려 했다",
        message: "앱 동작의 상태 키 {key}: 앱 정의 state에 없습니다. 앱 정의 state에 이 키를 더하세요.",
        fix: "앱 정의 state에 이 키를 더하세요"
    }
    DATA_ACT_STATE_TOO_LARGE(limit) {
        class: InvalidRequest,
        place: "앱 동작 상태 변경",
        cause: "상태 변경 뒤 창 상태가 허용 크기를 넘었다",
        message: "앱 동작으로 바꾼 창 상태가 허용 크기 {limit}보다 큽니다. 앱 정의의 동작이 창 상태에 넣는 값을 줄이세요.",
        fix: "앱 정의의 동작이 창 상태에 넣는 값을 줄이세요"
    }
    DATA_ACT_CALL_LOGIN_REQUIRED(permission) {
        class: NotGranted,
        place: "앱 연결 동작 실행",
        cause: "연결 동작을 실행할 권한에 기기 로그인이 필요하다",
        message: "연결 권한 {permission}: 이 기기에 로그인하지 않아 요청을 보내지 못했습니다. 연결에 로그인하세요.",
        fix: "이 기기에서 연결에 로그인하세요"
    }
    DATA_ACT_CALL_RATE_LIMITED(permission) {
        class: Unavailable,
        place: "앱 연결 동작 실행",
        cause: "연결 서버가 요청 한도를 넘었다고 응답했다",
        message: "연결 권한 {permission}: 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    DATA_RUNTIME_ATTACH_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "데이터 화면 연결",
        cause: "연결할 앱 창이 없다",
        message: "데이터를 연결할 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_RUNTIME_ATTACH_APP_NOT_FOUND() {
        class: NotFound,
        place: "데이터 화면 연결",
        cause: "창의 앱 정의가 없다",
        message: "이 창의 앱 정의가 이 쉘에 없어 데이터를 표시할 수 없습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    DATA_RUNTIME_DORMANT_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "데이터 화면 상태 변경",
        cause: "상태를 바꿀 앱 창이 없다",
        message: "데이터 화면 상태를 바꿀 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_READ_RUNTIME_NOT_FOUND() {
        class: NotFound,
        place: "동작 시점의 현재 값 읽기",
        cause: "값을 읽을 창의 데이터 연결이 없다",
        message: "이 창의 데이터 연결이 끝나 현재 값을 읽을 수 없습니다. 창을 다시 열어 주세요.",
        fix: "창을 다시 여세요"
    }
    DATA_RUNTIME_REFRESH_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "데이터 원천 새로고침",
        cause: "원천을 새로고침할 앱 창이 없다",
        message: "원천을 다시 받을 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
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
        message: "프로파일러 임시 폴더를 만들지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    DATA_PROFILER_DESKTOP_NOT_FOUND() {
        class: NotFound,
        place: "프로파일러 벤치마크 실행",
        cause: "벤치마크를 실행할 데스크톱이 없다",
        message: "프로파일러 벤치마크를 실행할 데스크톱을 찾지 못했습니다. 데스크톱 탭을 고른 뒤 벤치마크를 다시 실행하세요.",
        fix: "데스크톱 탭을 고른 뒤 벤치마크를 다시 실행하세요"
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
    DATA_CLIENT_BLOB_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 파일 보관",
        cause: "파일을 보관할 앱 창이 없다",
        message: "파일을 보관할 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_CLIENT_BLOB_APP_NOT_FOUND(app) {
        class: NotFound,
        place: "앱 파일 보관",
        cause: "창의 앱 정의가 없다",
        message: "앱 {app}의 정의가 이 쉘에 없어 파일을 보관할 수 없습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    DATA_CLIENT_BLOB_STORAGE_NOT_DECLARED(app) {
        class: PermissionDenied,
        place: "앱 파일 보관",
        cause: "앱이 기기 파일 보관을 선언하지 않았다",
        message: "앱 {app}: 앱 정의 client에 device_storage가 없어 파일을 보관할 수 없습니다. 앱 정의에 client.device_storage를 선언하세요.",
        fix: "앱 정의에 client.device_storage를 선언하세요"
    }
    DATA_CLIENT_BLOB_KEY_INVALID(key) {
        class: InvalidRequest,
        place: "앱 파일 보관 키 검사",
        cause: "보관 키가 상대 경로 형식이 아니다",
        message: "보관 키 {key}: 올바른 상대 경로가 아닙니다. 앱 코드에서 .과 .. 경로 조각을 없애세요.",
        fix: "앱 코드에서 .과 .. 경로 조각을 없애세요"
    }
    DATA_CLIENT_BLOB_PREFIX_DENIED(key, app) {
        class: PermissionDenied,
        place: "앱 파일 보관 키 검사",
        cause: "보관 키가 앱에 허용된 접두어로 시작하지 않는다",
        message: "보관 키 {key}: 앱 {app}에 허용되지 않은 파일 위치입니다. 앱 정의 client.device_storage.prefixes에 더하거나 허용된 접두어로 시작하는 키를 쓰세요.",
        fix: "앱 정의 client.device_storage.prefixes에 더하거나 허용된 접두어로 시작하는 키를 쓰세요"
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
        message: "보관 키 {key}에 넣을 원본 파일을 열지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    DATA_CLIENT_BLOB_INPUT_INVALID() {
        class: InvalidRequest,
        place: "앱 파일 보관 요청 검사",
        cause: "파일과 바이트 중 하나를 지정하지 않았다",
        message: "앱 파일 보관 요청에는 파일 또는 파일 내용 하나만 지정해야 합니다. 앱 코드를 고치세요.",
        fix: "앱 코드를 고치세요"
    }
    DATA_CLIENT_BLOB_PARENT_INVALID(key) {
        class: InvalidRequest,
        place: "앱 파일 보관 위치 확인",
        cause: "보관 파일의 상위 폴더를 정할 수 없다",
        message: "보관 키 {key}의 저장 위치를 정하지 못했습니다. 앱 코드의 보관 키를 고치세요.",
        fix: "앱 코드의 보관 키를 고치세요"
    }
    DATA_CLIENT_BLOB_DIR_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 보관 폴더 만들기",
        cause: "보관 폴더의 상위 위치가 없다",
        message: "보관 키 {key}의 상위 폴더를 찾지 못했습니다. 쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요.",
        fix: "쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요"
    }
    DATA_CLIENT_BLOB_DIR_CREATE_FAILED(key) {
        class: Io,
        place: "앱 파일 보관 폴더 만들기",
        cause: "보관 폴더를 만들 수 없다",
        message: "보관 키 {key}의 폴더를 만들지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    DATA_CLIENT_BLOB_TEMP_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 임시 보관",
        cause: "임시 파일을 만들 위치가 없다",
        message: "보관 키 {key}의 임시 파일 위치를 찾지 못했습니다. 쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요.",
        fix: "쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요"
    }
    DATA_CLIENT_BLOB_TEMP_CREATE_FAILED(key) {
        class: Io,
        place: "앱 파일 임시 보관",
        cause: "임시 파일을 만들 수 없다",
        message: "보관 키 {key}의 임시 파일을 만들지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    DATA_CLIENT_BLOB_COPY_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 내용 복사",
        cause: "파일 내용을 읽거나 쓸 위치가 없다",
        message: "보관 키 {key}의 파일 내용을 복사할 위치를 찾지 못했습니다. 쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요.",
        fix: "쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요"
    }
    DATA_CLIENT_BLOB_COPY_FAILED(key) {
        class: Io,
        place: "앱 파일 내용 복사",
        cause: "파일 내용을 복사할 수 없다",
        message: "보관 키 {key}에 파일 내용을 복사하지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    DATA_CLIENT_BLOB_TOO_LARGE(key, limit) {
        class: InvalidRequest,
        place: "앱 파일 보관 크기 검사",
        cause: "보관할 파일이 허용 크기를 넘었다",
        message: "보관 키 {key}에 넣을 파일이 허용 크기 {limit}보다 큽니다. 더 작은 파일을 선택하세요.",
        fix: "더 작은 파일을 선택하세요"
    }
    DATA_CLIENT_BLOB_FLUSH_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 임시 보관 완료",
        cause: "임시 파일을 마무리할 위치가 없다",
        message: "보관 키 {key}의 임시 파일을 마무리할 위치를 찾지 못했습니다. 쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요.",
        fix: "쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요"
    }
    DATA_CLIENT_BLOB_FLUSH_FAILED(key) {
        class: Io,
        place: "앱 파일 임시 보관 완료",
        cause: "임시 파일 내용을 디스크에 반영할 수 없다",
        message: "보관 키 {key}의 파일을 마무리하지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    DATA_CLIENT_BLOB_RENAME_NOT_FOUND(key) {
        class: NotFound,
        place: "앱 파일 보관 완료",
        cause: "임시 파일이나 보관 위치가 없다",
        message: "보관 키 {key}의 임시 파일이나 보관 위치가 사라졌습니다. 쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요.",
        fix: "쉘 데이터 폴더가 있는지 확인한 뒤 다시 시도하세요"
    }
    DATA_CLIENT_BLOB_RENAME_FAILED(key) {
        class: Io,
        place: "앱 파일 보관 완료",
        cause: "임시 파일을 보관 위치로 옮길 수 없다",
        message: "보관 키 {key}의 파일을 보관 위치로 옮기지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    DATA_CLIENT_BLOB_REMOVE_FAILED(key) {
        class: Io,
        place: "앱 파일 삭제",
        cause: "보관 파일을 삭제할 수 없다",
        message: "보관 키 {key}의 파일을 삭제하지 못했습니다. 이 항목이 읽기 전용이 아닌지 확인하세요.",
        fix: "이 항목이 읽기 전용이 아닌지 확인하세요"
    }
    DATA_CLIENT_BLOB_LIST_READ_FAILED(prefix) {
        class: Io,
        place: "앱 파일 목록 조회",
        cause: "보관 폴더 목록을 읽을 수 없다",
        message: "보관 위치 {prefix}의 파일 목록을 읽지 못했습니다. 파일 관리자에서 쉘 데이터 폴더가 열리는지 확인하세요.",
        fix: "파일 관리자에서 쉘 데이터 폴더가 열리는지 확인하세요"
    }
    DATA_CLIENT_BLOB_LIST_ENTRY_NOT_FOUND(prefix) {
        class: NotFound,
        place: "앱 파일 목록 항목 읽기",
        cause: "목록을 읽는 중 파일 항목이 사라졌다",
        message: "보관 위치 {prefix}의 파일 목록을 읽는 동안 항목이 사라졌습니다. 다시 시도하세요.",
        fix: "다시 시도하세요"
    }
    DATA_CLIENT_BLOB_LIST_ENTRY_READ_FAILED(prefix) {
        class: Io,
        place: "앱 파일 목록 항목 읽기",
        cause: "파일 목록 항목 정보를 읽을 수 없다",
        message: "보관 위치 {prefix}의 파일 항목 정보를 읽지 못했습니다. 파일 관리자에서 쉘 데이터 폴더가 열리는지 확인하세요.",
        fix: "파일 관리자에서 쉘 데이터 폴더가 열리는지 확인하세요"
    }
    DATA_CLIENT_BLOB_LIST_KIND_NOT_FOUND(prefix) {
        class: NotFound,
        place: "앱 파일 목록 항목 종류 확인",
        cause: "파일 목록 항목이 확인 중 사라졌다",
        message: "보관 위치 {prefix}의 파일 종류를 확인하는 동안 항목이 사라졌습니다. 다시 시도하세요.",
        fix: "다시 시도하세요"
    }
    DATA_CLIENT_BLOB_LIST_KIND_READ_FAILED(prefix) {
        class: Io,
        place: "앱 파일 목록 항목 종류 확인",
        cause: "파일 항목의 종류를 확인할 수 없다",
        message: "보관 위치 {prefix}의 파일 종류를 확인하지 못했습니다. 파일 관리자에서 쉘 데이터 폴더가 열리는지 확인하세요.",
        fix: "파일 관리자에서 쉘 데이터 폴더가 열리는지 확인하세요"
    }
    DATA_CLIENT_HTTP_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "공개 HTTPS 읽기",
        cause: "요청을 보낼 앱 창이 없다",
        message: "공개 HTTPS 요청을 보낼 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DATA_CLIENT_HTTP_APP_NOT_FOUND(app) {
        class: NotFound,
        place: "공개 HTTPS 읽기",
        cause: "창의 앱 정의가 없다",
        message: "앱 {app}의 정의가 이 쉘에 없어 공개 HTTPS 내용을 읽지 못했습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    DATA_CLIENT_HTTP_CLIENT_PERMISSION_DENIED(permission) {
        class: PermissionDenied,
        place: "공개 HTTPS 권한 확인",
        cause: "앱 클라이언트에 공개 HTTPS 권한이 선언되지 않았다",
        message: "HTTP 권한 {permission}: 앱 정의 client.http_permissions에 없습니다. client.http_permissions에 이 값을 더하세요.",
        fix: "앱 정의 client.http_permissions에 이 값을 더하세요"
    }
    DATA_CLIENT_HTTP_APP_PERMISSION_DENIED(permission) {
        class: PermissionDenied,
        place: "공개 HTTPS 권한 확인",
        cause: "앱에 요청한 공개 HTTPS 권한이 선언되지 않았다",
        message: "HTTP 권한 {permission}: 앱 정의 permissions에 없습니다. 앱 정의 permissions에 선언하세요.",
        fix: "앱 정의 permissions에 선언하세요"
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
        message: "공개 HTTPS 서버가 성공 응답을 보내지 않아 내용을 읽지 못했습니다. 앱 코드의 주소가 맞는지 확인하세요. 경로: {path}",
        fix: "앱 코드의 주소가 맞는지 확인하세요"
    }
    DATA_HTTP_CLIENT_BUILD_FAILED() {
        class: Server,
        place: "HTTP 요청 준비",
        cause: "HTTP 클라이언트를 만들 수 없다",
        message: "HTTP 요청을 준비하지 못했습니다. 쉘을 다시 시작하고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "쉘을 다시 시작하세요"
    }
}
