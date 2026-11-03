error_catalog! { ENTRIES;
    CONN_SETTING_SAVE_DATABASE_FAILED(name) {
        class: Server,
        place: "연결 설정 저장",
        cause: "서버 저장소의 SQL 작업이 실패했다",
        message: "연결 {name}: 설정을 서버 저장소에 저장하지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    CONN_SETTING_DELETE_DATABASE_FAILED(name) {
        class: Server,
        place: "연결 설정 삭제",
        cause: "서버 저장소의 SQL 작업이 실패했다",
        message: "연결 {name}: 설정을 서버 저장소에서 지우지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    CONN_SETTING_READ_DATABASE_FAILED(name) {
        class: Server,
        place: "연결 설정 읽기",
        cause: "서버 저장소의 SQL 작업이 실패했다",
        message: "연결 {name}: 설정을 서버 저장소에서 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    CONN_SETTING_LIST_DATABASE_FAILED() {
        class: Server,
        place: "연결 설정 목록 조회",
        cause: "서버 저장소의 SQL 작업이 실패했다",
        message: "연결 목록을 서버 저장소에서 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    CONN_PAIR_APPROVE_DATABASE_FAILED() {
        class: Server,
        place: "기기 연결 승인",
        cause: "서버 저장소의 SQL 작업이 실패했다",
        message: "기기 연결을 승인하면서 기기 정보를 서버 저장소에 저장하지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    CONN_LINK_START_URL_INVALID() {
        class: InvalidRequest,
        place: "서버 연결 시작",
        cause: "서버 주소가 비어 있거나 허용된 주소 형식이 아니다",
        message: "서버 주소가 올바르지 않아 연결을 시작하지 못했습니다. HTTP 또는 HTTPS 주소를 입력하세요.",
        fix: "쿼리나 사용자 정보가 없는 HTTP 또는 HTTPS 서버 주소를 입력하세요"
    }
    CONN_LINK_START_UNREACHABLE(host) {
        class: Server,
        place: "서버 연결 시작",
        cause: "연결 요청을 서버에 보내지 못했다",
        message: "kaleidoscope 서버({host})에 연결할 수 없습니다. 서버 주소와 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "서버 주소와 네트워크 연결을 확인하세요"
    }
    CONN_LINK_START_REJECTED(host) {
        class: Server,
        place: "서버 연결 시작",
        cause: "서버가 연결 시작 요청을 실패로 응답했다",
        message: "kaleidoscope 서버({host})가 연결 요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "서버 상태를 확인한 뒤 다시 시도하세요"
    }
    CONN_LINK_START_RESPONSE_READ_FAILED(host) {
        class: Server,
        place: "서버 연결 시작 응답 읽기",
        cause: "연결 시작 응답을 읽거나 해석하지 못했다",
        message: "kaleidoscope 서버({host})의 연결 응답을 읽지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 상태를 확인한 뒤 다시 시도하세요"
    }
    CONN_LINK_IMPORT_UNREACHABLE(host) {
        class: Server,
        place: "연결된 서버에서 앱 가져오기",
        cause: "앱 가져오기 요청을 서버에 보내지 못했다",
        message: "kaleidoscope 서버({host})에 연결할 수 없어 앱을 가져오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 연결 상태를 확인하세요"
    }
    CONN_LINK_IMPORT_REJECTED(host) {
        class: Server,
        place: "연결된 서버에서 앱 가져오기",
        cause: "서버가 앱 가져오기 요청을 실패로 응답했다",
        message: "kaleidoscope 서버({host})가 앱 가져오기 요청을 처리하지 못했습니다. 앱과 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "앱 정의와 서버 상태를 확인하세요"
    }
    CONN_LINK_IMPORT_RESPONSE_READ_FAILED(host) {
        class: Server,
        place: "연결된 서버의 앱 가져오기 응답 읽기",
        cause: "앱 가져오기 응답을 읽거나 해석하지 못했다",
        message: "kaleidoscope 서버({host})의 앱 응답을 읽지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 상태를 확인한 뒤 다시 시도하세요"
    }
    CONN_LINK_IMPORT_UNAUTHORIZED(host) {
        class: Server,
        place: "연결된 서버에서 앱 가져오기",
        cause: "서버가 기기 인증을 거부했다",
        message: "kaleidoscope 서버({host})가 이 기기의 인증을 거부했습니다. 기기를 다시 연결한 뒤 앱을 가져오세요.",
        fix: "기기를 다시 연결하세요"
    }
    CONN_LINK_IMPORT_NOT_FOUND(host) {
        class: Server,
        place: "연결된 서버에서 앱 가져오기",
        cause: "서버에 요청한 앱이 없다",
        message: "kaleidoscope 서버 {host}에서 요청한 앱을 찾지 못했습니다. 앱을 다시 게시한 뒤 가져오세요.",
        fix: "서버에 앱이 게시되어 있는지 확인하세요"
    }
    CONN_REQUEST_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 연결 요청",
        cause: "요청을 보낸 앱 창이 없다",
        message: "연결 요청을 보낼 앱 창을 찾지 못했습니다. 창을 다시 연 뒤 시도하세요.",
        fix: "앱 창을 다시 여세요"
    }
    CONN_REQUEST_APP_NOT_FOUND() {
        class: NotFound,
        place: "앱 연결 요청",
        cause: "창에 연결된 앱 정의가 없다",
        message: "연결 요청에 필요한 앱 정보를 찾지 못했습니다. 앱을 다시 불러온 뒤 시도하세요.",
        fix: "앱을 다시 불러오세요"
    }
    CONN_REQUEST_HTTP_READ_ONLY() {
        class: PermissionDenied,
        place: "공개 HTTP 요청",
        cause: "읽기 전용 연결에서 읽기 외 요청을 보냈다",
        message: "이 연결은 읽기 전용이라 요청을 보낼 수 없습니다. 읽기 요청으로 다시 시도하세요.",
        fix: "읽기 요청만 사용하세요"
    }
    CONN_REQUEST_PUBLIC_HTTP_FAILED() {
        class: Server,
        place: "공개 HTTP 요청",
        cause: "공개 주소 요청이 실패했다",
        message: "공개 주소에 요청을 보내지 못했습니다. 주소와 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "주소와 네트워크 연결을 확인하세요"
    }
    CONN_REQUEST_PUBLIC_TEXT_INVALID() {
        class: Server,
        place: "공개 HTTP 응답 읽기",
        cause: "응답 본문이 UTF-8이 아니다",
        message: "공개 주소의 응답을 글자로 읽지 못했습니다. 응답 형식을 확인한 뒤 다시 시도하세요.",
        fix: "응답이 UTF-8 형식인지 확인하세요"
    }
    CONN_REQUEST_RELAY_DISCONNECTED(connection) {
        class: Server,
        place: "연결 요청 중계",
        cause: "연결된 서버 정보가 없다",
        message: "연결 {connection} 요청을 보낼 서버가 연결되어 있지 않습니다. 서버를 연결한 뒤 다시 시도하세요.",
        fix: "서버 연결을 완료하세요"
    }
    CONN_REQUEST_RELAY_UNREACHABLE(connection, host) {
        class: Server,
        place: "연결 요청 중계",
        cause: "요청을 서버에 보내지 못했다",
        message: "연결 {connection}의 서버 {host}에 닿지 못했습니다. 서버 연결과 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "서버 연결과 네트워크를 확인하세요"
    }
    CONN_REQUEST_RELAY_REJECTED(connection, host) {
        class: Server,
        place: "연결 요청 중계",
        cause: "서버가 연결 요청을 실패로 응답했다",
        message: "연결 {connection}의 서버({host})가 요청을 처리하지 못했습니다. 연결 설정과 서버 상태를 확인하세요.",
        fix: "연결 설정과 서버 상태를 확인하세요"
    }
    CONN_REQUEST_RELAY_RESPONSE_READ_FAILED(connection, host) {
        class: Server,
        place: "연결 요청 중계 응답 읽기",
        cause: "연결 요청 응답을 읽거나 해석하지 못했다",
        message: "연결 {connection}의 서버({host}) 응답을 읽지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.",
        fix: "연결 상태를 확인한 뒤 다시 시도하세요"
    }
    CONN_REQUEST_OAUTH_CLIENT_FAILED(connection) {
        class: Server,
        place: "OAuth 연결 요청 준비",
        cause: "HTTP 클라이언트를 준비하지 못했다",
        message: "연결 {connection}의 요청을 준비하지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    CONN_REQUEST_OAUTH_METHOD_INVALID(connection) {
        class: Server,
        place: "OAuth 연결 요청 준비",
        cause: "요청 방식이 HTTP 방식으로 올바르지 않다",
        message: "연결 {connection} 요청의 방식이 올바르지 않습니다. 앱 요청을 확인한 뒤 다시 시도하세요.",
        fix: "앱의 요청 방식을 확인하세요"
    }
    CONN_REQUEST_OAUTH_UNREACHABLE(connection, host) {
        class: Server,
        place: "OAuth 연결 요청",
        cause: "요청을 원격 서버에 보내지 못했다",
        message: "연결 {connection}의 서버 {host}에 연결할 수 없습니다. 연결 주소와 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "연결 주소와 네트워크를 확인하세요"
    }
    CONN_REQUEST_OAUTH_RESPONSE_READ_FAILED(connection, host) {
        class: Server,
        place: "OAuth 연결 응답 읽기",
        cause: "서버 응답을 끝까지 읽지 못했다",
        message: "연결 {connection}의 서버 {host} 응답을 읽지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    CONN_REQUEST_OAUTH_RESPONSE_TEXT_INVALID(connection) {
        class: Server,
        place: "OAuth 연결 응답 읽기",
        cause: "응답 본문이 UTF-8이 아니다",
        message: "연결 {connection}의 응답을 글자로 읽지 못했습니다. 서버 응답 형식을 확인하세요.",
        fix: "서버 응답 형식을 확인하세요"
    }
    CONN_REQUEST_OAUTH_RESPONSE_TOO_LARGE(connection) {
        class: Io,
        place: "OAuth 연결 응답 읽기",
        cause: "응답이 허용 크기를 넘었다",
        message: "연결 {connection}의 응답이 너무 커서 읽지 못했습니다. 더 작은 응답을 요청하세요.",
        fix: "요청 범위를 줄여 응답 크기를 낮추세요"
    }
    CONN_REQUEST_SERVER_RESPONSE_FAILED() {
        class: Server,
        place: "연결 요청 응답 확인",
        cause: "원격 서버가 요청을 실패로 응답했다",
        message: "원격 연결 요청이 실패했습니다. 연결 설정과 서버 상태를 확인하세요.",
        fix: "연결 설정과 서버 상태를 확인하세요"
    }
    CONN_REQUEST_RELAY_METHOD_INVALID(connection) {
        class: InvalidRequest,
        place: "연결 중계 요청",
        cause: "HTTP 요청 방식이 올바르지 않다",
        message: "연결 {connection} 요청 방식이 올바르지 않습니다. 앱의 HTTP 요청 방식을 고치세요.",
        fix: "앱의 HTTP 요청 방식을 확인하세요"
    }
    CONN_RELAY_REQUEST_BODY_INVALID() {
        class: InvalidRequest,
        place: "연결 중계 요청 읽기",
        cause: "요청 본문이 올바른 형식이 아니다",
        message: "연결 요청 내용을 읽지 못했습니다. 앱의 요청 형식을 확인하세요.",
        fix: "앱의 연결 요청 형식을 확인하세요"
    }
    CONN_LOGIN_OAUTH_CLIENT_FAILED(connection) {
        class: Server,
        place: "연결 로그인 준비",
        cause: "OAuth 요청용 HTTP 클라이언트를 만들지 못했다",
        message: "연결 {connection} 로그인 요청을 준비하지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    CONN_LOGIN_OAUTH_URL_INVALID(connection) {
        class: Server,
        place: "연결 로그인 준비",
        cause: "저장된 OAuth 서버 주소가 올바르지 않다",
        message: "연결 {connection}의 OAuth 서버 주소가 올바르지 않습니다. 연결 설정을 확인하세요.",
        fix: "OAuth 발급자와 서버 주소를 확인하세요"
    }
    CONN_LOGIN_OAUTH_DISCOVERY_UNREACHABLE(connection, host) {
        class: Server,
        place: "연결 로그인 서버 확인",
        cause: "OAuth 서버 확인 요청을 보내지 못했다",
        message: "연결 {connection}의 OAuth 서버 {host}에 연결할 수 없습니다. 주소와 네트워크를 확인하세요.",
        fix: "OAuth 서버 주소와 네트워크를 확인하세요"
    }
    CONN_LOGIN_OAUTH_DISCOVERY_REJECTED(connection, host) {
        class: Server,
        place: "연결 로그인 서버 확인",
        cause: "OAuth 서버 확인 요청이 실패로 응답했다",
        message: "연결 {connection}의 OAuth 서버({host})가 서버 정보를 제공하지 않았습니다. 서버 주소와 상태를 확인하세요.",
        fix: "OAuth 서버 주소와 상태를 확인하세요"
    }
    CONN_LOGIN_OAUTH_METADATA_INVALID(connection, host) {
        class: Server,
        place: "연결 로그인 서버 확인",
        cause: "OAuth 서버 정보 응답을 읽지 못했다",
        message: "연결 {connection}의 OAuth 서버 {host} 정보를 읽지 못했습니다. 서버 설정을 확인하세요.",
        fix: "OAuth 서버의 discovery 응답을 확인하세요"
    }
    CONN_LOGIN_OAUTH_METHOD_UNSUPPORTED(connection) {
        class: Server,
        place: "연결 로그인 준비",
        cause: "OAuth 서버가 S256 코드 검증을 지원하지 않는다",
        message: "연결 {connection}의 OAuth 서버가 필요한 코드 검증 방식을 지원하지 않습니다. 서버 설정을 확인하세요.",
        fix: "서버에서 PKCE S256을 지원하는지 확인하세요"
    }
    CONN_LOGIN_BROWSER_UNAVAILABLE(connection) {
        class: Unavailable,
        place: "연결 로그인 브라우저 열기",
        cause: "기기에서 브라우저를 열 수 없다",
        message: "연결 {connection} 로그인을 위해 브라우저를 열 수 없습니다. 기기의 브라우저 설정을 확인하세요.",
        fix: "기본 브라우저 설정을 확인하세요"
    }
    CONN_LOGIN_BROWSER_OPEN_FAILED(connection) {
        class: Server,
        place: "연결 로그인 브라우저 열기",
        cause: "OAuth 로그인 페이지를 열지 못했다",
        message: "연결 {connection}의 로그인 페이지를 열지 못했습니다. 기본 브라우저를 확인하고 다시 시도하세요.",
        fix: "기본 브라우저를 확인하세요"
    }
    CONN_LOGIN_CALLBACK_TIMEOUT(connection) {
        class: InvalidRequest,
        place: "연결 로그인 확인",
        cause: "정해진 시간 안에 로그인을 마치지 않았다",
        message: "연결 {connection} 로그인이 시간 안에 끝나지 않았습니다. 브라우저에서 인증을 마친 뒤 다시 시도하세요.",
        fix: "브라우저에서 로그인을 마치세요"
    }
    CONN_LOGIN_CALLBACK_INVALID(connection) {
        class: Server,
        place: "연결 로그인 확인",
        cause: "로그인 결과를 확인하지 못했다",
        message: "연결 {connection} 로그인 결과를 확인하지 못했습니다. 다시 로그인하세요.",
        fix: "다시 로그인하세요"
    }
    CONN_LOGIN_CALLBACK_LISTENER_FAILED(connection) {
        class: Server,
        place: "연결 로그인 확인 준비",
        cause: "기기에서 로그인 확인용 로컬 주소를 열지 못했다",
        message: "연결 {connection} 로그인 확인 주소를 열지 못했습니다. 기기의 네트워크 설정을 확인하세요.",
        fix: "기기의 로컬 네트워크 사용 권한을 확인하세요"
    }
    CONN_LOGIN_CLIENT_REGISTER_UNREACHABLE(connection, host) {
        class: Server,
        place: "연결 로그인 등록",
        cause: "OAuth 클라이언트 등록 요청을 보내지 못했다",
        message: "연결 {connection}의 OAuth 서버 {host}에 클라이언트를 등록하지 못했습니다. 주소와 네트워크를 확인하세요.",
        fix: "OAuth 서버 주소와 네트워크를 확인하세요"
    }
    CONN_LOGIN_CLIENT_REGISTER_REJECTED(connection, host) {
        class: Server,
        place: "연결 로그인 등록",
        cause: "OAuth 서버가 클라이언트 등록을 거부했다",
        message: "연결 {connection}의 OAuth 서버({host})가 클라이언트 등록을 거부했습니다. 서버 설정을 확인하세요.",
        fix: "OAuth 서버의 클라이언트 등록 설정을 확인하세요"
    }
    CONN_LOGIN_CLIENT_REGISTER_RESPONSE_INVALID(connection, host) {
        class: Server,
        place: "연결 로그인 등록",
        cause: "OAuth 클라이언트 등록 응답에 클라이언트 식별자가 없다",
        message: "연결 {connection}의 OAuth 서버({host})가 올바르지 않은 등록 결과를 보냈습니다. 서버 설정을 확인하세요.",
        fix: "OAuth 서버의 등록 응답을 확인하세요"
    }
    CONN_LOGIN_CODE_EXCHANGE_UNREACHABLE(connection, host) {
        class: Server,
        place: "연결 로그인 코드 교환",
        cause: "로그인 코드를 토큰으로 교환하지 못했다",
        message: "연결 {connection}의 OAuth 서버 {host}에 로그인 결과를 전달하지 못했습니다. 네트워크를 확인하고 다시 로그인하세요.",
        fix: "네트워크를 확인한 뒤 다시 로그인하세요"
    }
    CONN_LOGIN_CODE_EXCHANGE_REJECTED(connection, host) {
        class: Server,
        place: "연결 로그인 코드 교환",
        cause: "OAuth 서버가 로그인 코드 교환을 거부했다",
        message: "연결 {connection}의 OAuth 서버({host})가 로그인을 완료하지 못했습니다. 다시 로그인하세요.",
        fix: "다시 로그인하세요"
    }
    CONN_LOGIN_CODE_EXCHANGE_RESPONSE_INVALID(connection, host) {
        class: Server,
        place: "연결 로그인 코드 교환",
        cause: "OAuth 서버가 올바른 토큰 응답을 보내지 않았다",
        message: "연결 {connection}의 OAuth 서버 {host}에서 토큰 응답을 읽지 못했습니다. 서버 설정을 확인하세요.",
        fix: "OAuth 서버의 토큰 응답을 확인하세요"
    }
    CONN_LOGIN_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "연결 로그인",
        cause: "로그인을 시작한 앱 창이 없다",
        message: "로그인을 시작할 앱 창을 찾지 못했습니다. 창을 다시 연 뒤 시도하세요.",
        fix: "앱 창을 다시 여세요"
    }
    CONN_LOGIN_APP_NOT_FOUND() {
        class: NotFound,
        place: "연결 로그인",
        cause: "창에 연결된 앱 정의가 없다",
        message: "로그인에 필요한 앱 정보를 찾지 못했습니다. 앱을 다시 불러온 뒤 시도하세요.",
        fix: "앱을 다시 불러오세요"
    }
    CONN_LOGIN_PERMISSION_MISSING() {
        class: PermissionDenied,
        place: "연결 로그인",
        cause: "앱에 연결 로그인 권한이 없다",
        message: "이 앱에는 연결 로그인 권한이 없습니다. 앱 권한을 확인하세요.",
        fix: "앱의 연결 권한을 확인하세요"
    }
    CONN_LOGIN_CONNECTION_MISSING() {
        class: InvalidRequest,
        place: "연결 로그인",
        cause: "앱에 선언된 연결 정보가 설정되어 있지 않다",
        message: "로그인할 연결 설정을 찾지 못했습니다. 연결을 설정한 뒤 다시 시도하세요.",
        fix: "연결을 설정하세요"
    }
    CONN_LOGIN_NOT_OAUTH() {
        class: InvalidRequest,
        place: "연결 로그인",
        cause: "선택한 연결이 OAuth 연결이 아니다",
        message: "선택한 연결은 OAuth 로그인을 지원하지 않습니다. OAuth 연결을 선택하세요.",
        fix: "OAuth 연결을 선택하세요"
    }
    CONN_LOGIN_ALREADY_RUNNING(connection) {
        class: InvalidRequest,
        place: "연결 로그인",
        cause: "같은 연결의 로그인이 이미 진행 중이다",
        message: "연결({connection})은 이미 로그인 중입니다. 진행 중인 로그인이 끝난 뒤 다시 시도하세요.",
        fix: "진행 중인 로그인 창에서 인증을 마치세요"
    }
    CONN_AUTHORIZE_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "연결 권한 확인",
        cause: "요청한 앱 창이 없다",
        message: "연결 권한을 확인할 앱 창을 찾지 못했습니다. 창을 다시 연 뒤 시도하세요.",
        fix: "앱 창을 다시 여세요"
    }
    CONN_AUTHORIZE_APP_NOT_FOUND() {
        class: NotFound,
        place: "연결 권한 확인",
        cause: "창에 연결된 앱 정의가 없다",
        message: "연결 권한을 확인할 앱 정보를 찾지 못했습니다. 앱을 다시 불러오세요.",
        fix: "앱을 다시 불러오세요"
    }
    CONN_AUTHORIZE_PERMISSION_MISSING() {
        class: PermissionDenied,
        place: "연결 권한 확인",
        cause: "앱에 요청된 연결 권한이 없다",
        message: "이 앱에는 요청한 연결 권한이 없습니다. 앱 권한을 확인하세요.",
        fix: "앱의 연결 권한을 확인하세요"
    }
    CONN_AUTHORIZE_READ_ONLY() {
        class: PermissionDenied,
        place: "연결 권한 확인",
        cause: "읽기 전용 권한으로 쓰기 요청을 했다",
        message: "이 연결은 읽기 전용이라 변경 요청을 보낼 수 없습니다. 읽기 요청을 사용하세요.",
        fix: "읽기 요청을 사용하세요"
    }
    CONN_AUTHORIZE_CONNECTION_MISSING(connection) {
        class: Server,
        place: "연결 권한 확인",
        cause: "앱이 선언한 연결 설정이 없다",
        message: "연결 {connection} 설정을 찾지 못했습니다. 연결을 설정한 뒤 다시 시도하세요.",
        fix: "연결 설정을 추가하세요"
    }
    CONN_AUTHORIZE_PATH_DENIED(connection) {
        class: PermissionDenied,
        place: "연결 경로 확인",
        cause: "요청 경로가 연결의 허용 범위 밖이다",
        message: "연결 {connection}에서 이 경로에 접근할 수 없습니다. 허용된 경로를 사용하세요.",
        fix: "연결 설정의 허용 경로를 확인하세요"
    }
    CONN_AUTHORIZE_WRITE_DENIED(connection) {
        class: PermissionDenied,
        place: "연결 권한 확인",
        cause: "연결이 쓰기를 허용하지 않는다",
        message: "연결({connection})은 쓰기를 허용하지 않습니다. 읽기 요청을 사용하세요.",
        fix: "읽기 요청을 사용하세요"
    }
    CONN_RELAY_PERMISSION_MISSING(connection) {
        class: PermissionDenied,
        place: "연결 중계 권한 확인",
        cause: "앱에 해당 연결 권한이 없다",
        message: "앱에 연결 {connection} 권한이 없어 서버가 요청을 중계하지 않았습니다. 앱의 연결 권한을 확인하세요.",
        fix: "앱의 연결 권한을 확인하세요"
    }
    CONN_REGISTRY_STORAGE_RESPONSE_INVALID() {
        class: Unavailable,
        place: "앱 저장소 응답 확인",
        cause: "찾을 수 없음 응답이 등록된 오류 형식이 아니다",
        message: "앱 저장소 서버가 저장 항목 오류를 알 수 없는 형식으로 보냈습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "앱 저장소 서버 상태를 확인하세요"
    }
    CONN_RELAY_CONNECTION_NOT_FOUND(connection) {
        class: Server,
        place: "연결 중계 설정 조회",
        cause: "요청한 연결 설정이 없다",
        message: "연결 {connection} 설정을 찾지 못했습니다. 연결을 설정한 뒤 다시 시도하세요.",
        fix: "연결 설정을 추가하세요"
    }
    CONN_RELAY_INVALID_KIND(connection) {
        class: InvalidRequest,
        place: "연결 중계 설정 확인",
        cause: "요청한 연결이 중계 방식이 아니다",
        message: "연결({connection})은 서버 중계를 사용하지 않습니다. 올바른 연결을 선택하세요.",
        fix: "서버 중계 연결을 선택하세요"
    }
    CONN_RELAY_WRITE_DENIED(connection) {
        class: PermissionDenied,
        place: "연결 중계 권한 확인",
        cause: "앱 또는 연결이 쓰기를 허용하지 않는다",
        message: "연결({connection})은 쓰기를 허용하지 않습니다. 읽기 요청을 사용하세요.",
        fix: "읽기 요청을 사용하세요"
    }
    CONN_RELAY_PATH_INVALID(connection) {
        class: InvalidRequest,
        place: "연결 중계 경로 확인",
        cause: "요청 경로가 올바르지 않거나 허용 범위 밖이다",
        message: "연결 {connection}에서 요청한 경로를 사용할 수 없습니다. 허용된 경로를 확인하세요.",
        fix: "연결 설정의 허용 경로를 확인하세요"
    }
    CONN_RELAY_URL_INVALID(connection) {
        class: Server,
        place: "연결 중계 주소 구성",
        cause: "연결 주소와 요청 경로로 올바른 주소를 만들지 못했다",
        message: "연결 {connection}의 주소를 만들지 못했습니다. 연결 주소와 경로를 확인하세요.",
        fix: "연결 주소와 경로 설정을 확인하세요"
    }
    CONN_RELAY_CLIENT_FAILED(connection) {
        class: Server,
        place: "연결 중계 요청 준비",
        cause: "HTTP 요청 클라이언트를 준비하지 못했다",
        message: "연결 {connection} 요청을 준비하지 못했습니다. 연결 설정을 확인한 뒤 다시 시도하세요.",
        fix: "연결 설정을 확인하세요"
    }
    CONN_RELAY_HEADER_NAME_INVALID(connection) {
        class: Server,
        place: "연결 중계 헤더 이름 읽기",
        cause: "연결 헤더 이름이 올바르지 않다",
        message: "연결 {connection}의 헤더 이름이 올바르지 않습니다. 연결 헤더 설정을 고치세요.",
        fix: "연결 헤더 이름을 고치세요"
    }
    CONN_RELAY_HEADER_VALUE_INVALID(connection) {
        class: Server,
        place: "연결 중계 헤더 값 읽기",
        cause: "연결 헤더 값 형식이 올바르지 않다",
        message: "연결 {connection}의 헤더 값 형식이 올바르지 않습니다. 연결 헤더 설정을 고치세요.",
        fix: "연결 헤더 값을 고치세요"
    }
    CONN_RELAY_ENV_HEADER_UNSUPPORTED(connection) {
        class: Server,
        place: "연결 중계 헤더 읽기",
        cause: "연결 헤더에서 환경변수 참조를 사용했다",
        message: "연결 {connection}의 헤더에 환경변수 참조를 사용할 수 없습니다. 헤더 값을 직접 설정하세요.",
        fix: "헤더에서 환경변수 참조를 제거하세요"
    }
    CONN_RELAY_UNREACHABLE(connection, host) {
        class: Server,
        place: "연결 중계 요청",
        cause: "연결 요청을 원천 서버에 보내지 못했다",
        message: "연결 {connection}의 서버 {host}에 닿지 못했습니다. 주소와 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "주소와 네트워크 연결을 확인하세요"
    }
    CONN_RELAY_RESPONSE_READ_FAILED(connection, host) {
        class: Server,
        place: "연결 중계 응답 읽기",
        cause: "원천 서버 응답을 끝까지 읽지 못했다",
        message: "연결 {connection}의 서버 {host} 응답을 읽지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    CONN_RELAY_RESPONSE_TOO_LARGE(connection) {
        class: InvalidRequest,
        place: "연결 중계 응답 읽기",
        cause: "응답이 허용 크기를 넘었다",
        message: "연결 {connection}의 응답이 너무 커서 읽지 못했습니다. 더 작은 응답을 요청하세요.",
        fix: "요청 범위를 줄여 응답 크기를 낮추세요"
    }
    CONN_RELAY_TIMEOUT(connection, host) {
        class: Server,
        place: "연결 중계 요청",
        cause: "원천 서버가 제한 시간 안에 응답하지 않았다",
        message: "연결 {connection}의 서버 {host} 응답 시간이 지났습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 상태를 확인한 뒤 다시 시도하세요"
    }
    CONN_PAIR_START_NAME_INVALID() {
        class: InvalidRequest,
        place: "기기 연결 시작",
        cause: "기기 이름이 허용된 길이가 아니다",
        message: "기기 이름은 1자 이상 100자 이하여야 합니다. 이름을 고친 뒤 다시 시도하세요.",
        fix: "기기 이름을 1~100자로 입력하세요"
    }
    CONN_PAIR_START_LIMIT_REACHED() {
        class: Server,
        place: "기기 연결 시작",
        cause: "승인 대기 중인 연결 수가 한도에 도달했다",
        message: "승인 대기 중인 기기 연결이 많아 새 연결을 시작하지 못했습니다. 대기 중인 연결을 마친 뒤 다시 시도하세요.",
        fix: "대기 중인 기기 연결을 마치거나 취소하세요"
    }
    CONN_PAIR_POLL_CODE_NOT_FOUND() {
        class: Server,
        place: "기기 연결 상태 확인",
        cause: "연결 코드가 없거나 만료됐다",
        message: "기기 연결 코드가 없거나 만료됐습니다. 쉘에서 연결을 다시 시작하세요.",
        fix: "쉘에서 연결을 다시 시작하세요"
    }
    CONN_PAIR_APPROVE_CODE_NOT_FOUND() {
        class: Server,
        place: "기기 연결 승인",
        cause: "연결 코드가 없거나 만료됐다",
        message: "기기 연결 코드를 찾지 못했거나 만료됐습니다. 쉘에서 연결을 다시 시작하게 하세요.",
        fix: "쉘에서 연결을 다시 시작하세요"
    }
    CONN_SETTING_HEADER_REFERENCE() {
        class: InvalidRequest,
        place: "연결 설정 저장",
        cause: "헤더 값에 지원하지 않는 환경변수 참조가 있다",
        message: "연결 헤더에 환경변수 참조를 사용할 수 없습니다. 헤더 값을 직접 설정하세요.",
        fix: "헤더에서 환경변수 참조를 제거하세요"
    }
    CONN_SETTING_SERIALIZE_FAILED() {
        class: Server,
        place: "연결 설정 저장",
        cause: "연결 설정을 저장 형식으로 만들지 못했다",
        message: "연결 설정을 저장하지 못했습니다. 설정 값을 확인한 뒤 다시 시도하세요.",
        fix: "연결 설정 값을 확인하세요"
    }
    CONN_SETTING_PATHS_INVALID() {
        class: Server,
        place: "연결 경로 설정 읽기",
        cause: "저장된 연결 경로 목록을 읽지 못했다",
        message: "연결의 허용 경로 설정을 읽지 못했습니다. 연결 설정을 다시 저장하세요.",
        fix: "연결 허용 경로를 다시 저장하세요"
    }
    CONN_SETTING_HEADERS_INVALID() {
        class: Server,
        place: "연결 헤더 설정 읽기",
        cause: "저장된 연결 헤더를 읽지 못했다",
        message: "연결 헤더 설정을 읽지 못했습니다. 연결 헤더를 다시 저장하세요.",
        fix: "연결 헤더를 다시 저장하세요"
    }
    CONN_SETTING_LIST_PATHS_INVALID() {
        class: Server,
        place: "연결 목록의 경로 설정 읽기",
        cause: "목록에 든 연결의 허용 경로를 읽지 못했다",
        message: "연결 목록의 허용 경로 설정을 읽지 못했습니다. 연결 설정을 다시 저장하세요.",
        fix: "연결 허용 경로를 다시 저장하세요"
    }
    CONN_SETTING_LIST_HEADERS_INVALID() {
        class: Server,
        place: "연결 목록의 헤더 설정 읽기",
        cause: "목록에 든 연결의 헤더를 읽지 못했다",
        message: "연결 목록의 헤더 설정을 읽지 못했습니다. 연결 설정을 다시 저장하세요.",
        fix: "연결 헤더를 다시 저장하세요"
    }
    CONN_SETTING_KIND_INVALID() {
        class: Server,
        place: "연결 종류 읽기",
        cause: "저장된 연결 종류를 알 수 없다",
        message: "저장된 연결 종류를 읽지 못했습니다. 연결을 다시 설정하세요.",
        fix: "연결을 다시 설정하세요"
    }
    CONN_SETTING_NAME_INVALID() {
        class: InvalidRequest,
        place: "연결 설정 확인",
        cause: "연결 이름 형식이 올바르지 않다",
        message: "연결 이름은 영문 소문자, 숫자, 하이픈으로 1~64자여야 합니다. 이름을 고쳐 다시 시도하세요.",
        fix: "연결 이름을 영문 소문자, 숫자, 하이픈으로 입력하세요"
    }
    CONN_SETTING_URL_INVALID() {
        class: InvalidRequest,
        place: "연결 설정 확인",
        cause: "연결 주소가 허용된 주소 형식이 아니다",
        message: "연결 주소가 올바르지 않습니다. HTTPS 주소 또는 로컬 HTTP 주소를 입력하세요.",
        fix: "HTTPS 주소 또는 로컬 HTTP 주소를 입력하세요"
    }
    CONN_SETTING_PATH_INVALID() {
        class: InvalidRequest,
        place: "연결 경로 설정 확인",
        cause: "허용 경로가 올바른 요청 경로가 아니다",
        message: "연결의 허용 경로가 올바르지 않습니다. 슬래시로 시작하는 경로를 입력하세요.",
        fix: "허용 경로를 고치세요"
    }
    CONN_SETTING_RELAY_OAUTH_FIELDS_INVALID() {
        class: InvalidRequest,
        place: "중계 연결 설정 확인",
        cause: "중계 연결에 OAuth 전용 설정을 함께 지정했다",
        message: "중계 연결에는 OAuth 발급자, 범위, 리소스를 설정할 수 없습니다. 해당 설정을 비우세요.",
        fix: "OAuth 전용 설정을 비우세요"
    }
    CONN_SETTING_OAUTH_HEADERS_INVALID() {
        class: InvalidRequest,
        place: "OAuth 연결 설정 확인",
        cause: "OAuth 연결에 중계 전용 헤더를 지정했다",
        message: "OAuth 연결에는 사용자 지정 중계 헤더를 설정할 수 없습니다. 헤더 설정을 비우세요.",
        fix: "사용자 지정 헤더 설정을 비우세요"
    }
    CONN_SETTING_HEADER_NAME_INVALID() {
        class: InvalidRequest,
        place: "연결 헤더 설정 확인",
        cause: "헤더 이름이 올바르지 않다",
        message: "연결 헤더 이름이 올바르지 않습니다. HTTP 헤더 이름을 고치세요.",
        fix: "HTTP 헤더 이름을 고치세요"
    }
    CONN_SETTING_HEADER_RESERVED() {
        class: InvalidRequest,
        place: "연결 헤더 설정 확인",
        cause: "연결이 관리하는 헤더 이름을 지정했다",
        message: "연결에서 직접 설정할 수 없는 헤더 이름입니다. 다른 헤더 이름을 사용하세요.",
        fix: "host, content-length, connection, transfer-encoding 외의 이름을 사용하세요"
    }
    CONN_SETTING_HEADER_VALUE_INVALID() {
        class: InvalidRequest,
        place: "연결 헤더 설정 확인",
        cause: "헤더 값에 허용되지 않는 문자가 있다",
        message: "연결 헤더 값이 올바르지 않습니다. HTTP 헤더 값으로 사용할 수 있는 문자를 입력하세요.",
        fix: "헤더 값을 고치세요"
    }
}
