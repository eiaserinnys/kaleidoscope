error_catalog! { ENTRIES;
    CONN_REALTIME_SESSION_STALE() {
        class: InvalidRequest,
        place: "화면 세션 확인",
        cause: "화면이 다시 시작되거나 닫혀 이전 세션이 만료됐다",
        message: "이 앱 화면이 다시 시작되어 이전 연결을 쓸 수 없습니다. 현재 화면에서 다시 연결해 주세요.",
        fix: "현재 화면에서 다시 연결해 주세요"
    }
    CONN_REALTIME_CLIENT_PERMISSION_MISSING(permission) {
        class: PermissionDenied,
        place: "client 연결 권한 확인",
        cause: "client의 실시간 연결 허용 목록에 권한이 없다",
        message: "이 앱 client에는 연결 권한 {permission}이 없습니다. 앱 정의의 realtime_permissions를 고쳐 주세요.",
        fix: "앱 정의의 realtime_permissions를 고쳐 주세요"
    }
    CONN_REALTIME_KIND_UNSUPPORTED(kind) {
        class: Unavailable,
        place: "실시간 연결 종류 확인",
        cause: "요청한 연결 종류를 지원하지 않는다",
        message: "실시간 연결 종류 {kind}는 이 쉘에서 지원하지 않습니다. 앱을 WebSocket으로 고쳐 주세요.",
        fix: "앱을 WebSocket으로 고쳐 주세요"
    }
    CONN_REALTIME_RELAY_UNSUPPORTED(name) {
        class: Unavailable,
        place: "실시간 연결 방식 확인",
        cause: "등록된 연결이 서버 중계 방식이다",
        message: "연결 {name}은 서버 중계 방식이라 실시간으로 열 수 없습니다. 기기 로그인 연결로 등록해 주세요.",
        fix: "기기 로그인 연결로 등록해 주세요"
    }
    CONN_REALTIME_LOGIN_REQUIRED(name) {
        class: LoginRequired,
        place: "실시간 연결 로그인 확인",
        cause: "토큰이 없거나 갱신 후에도 로그인이 거부됐다",
        message: "연결 {name}에 로그인해야 합니다. 앱의 로그인 단추를 눌러 주세요.",
        fix: "앱의 로그인 단추를 눌러 주세요"
    }
    CONN_REALTIME_WINDOW_HIDDEN(name) {
        class: InvalidRequest,
        place: "실시간 연결 창 확인",
        cause: "연결을 열 창이 보이지 않는다",
        message: "지금 보이지 않는 창에서는 연결 {name}을 열 수 없습니다. 창을 다시 열어 주세요.",
        fix: "창을 다시 열어 주세요"
    }
    CONN_REALTIME_OPEN_LIMIT() {
        class: InvalidRequest,
        place: "실시간 연결 개수 확인",
        cause: "창의 연결 네 개가 이미 열렸거나 열리고 있다",
        message: "이 창에는 실시간 연결 4개가 이미 열리고 있습니다. 앱이 쓰지 않는 연결을 닫아야 합니다.",
        fix: "앱이 쓰지 않는 연결을 닫아야 합니다"
    }
    CONN_REALTIME_OPEN_RATE_LIMITED(name, seconds) {
        class: Server,
        place: "실시간 연결 요청 제한 확인",
        cause: "서버가 연결 요청을 제한했다",
        message: "연결 {name}의 서버가 요청을 잠시 제한했습니다. {seconds}초 뒤 다시 연결해 주세요.",
        fix: "안내된 시간 뒤 다시 연결해 주세요"
    }
    CONN_REALTIME_OPEN_COOLDOWN(name) {
        class: Server,
        place: "실시간 연결 재시도 확인",
        cause: "같은 세션에서 연결을 열지 못한 지 1초가 지나지 않았다",
        message: "연결 {name}을 방금 열지 못했습니다. 1초 뒤 다시 연결해 주세요.",
        fix: "1초 뒤 다시 연결해 주세요"
    }
    CONN_REALTIME_OPEN_UNREACHABLE(name, reason) {
        class: Server,
        place: "실시간 연결 서버 접속",
        cause: "서버와 네트워크 연결을 열지 못했다",
        message: "연결 {name}의 서버에 닿지 못했습니다. 네트워크와 연결 주소를 확인해 주세요. 원인: {reason}",
        fix: "네트워크와 연결 주소를 확인해 주세요"
    }
    CONN_REALTIME_OPEN_TIMEOUT(name) {
        class: Server,
        place: "실시간 연결 핸드셰이크",
        cause: "서버가 10초 안에 연결을 열지 않았다",
        message: "연결 {name}의 서버가 10초 안에 연결을 열지 않았습니다. 잠시 뒤 다시 연결해 주세요.",
        fix: "잠시 뒤 다시 연결해 주세요"
    }
    CONN_REALTIME_OPEN_REJECTED(name) {
        class: Server,
        place: "실시간 연결 핸드셰이크",
        cause: "서버가 WebSocket 열기를 거절했다",
        message: "연결 {name}의 서버가 WebSocket 열기를 거절했습니다. 연결 경로와 서버 설정을 확인해 주세요.",
        fix: "연결 경로와 서버 설정을 확인해 주세요"
    }
    CONN_REALTIME_HANDLE_MISSING() {
        class: NotFound,
        place: "실시간 연결 핸들 확인",
        cause: "해당 연결이 이미 닫혔다",
        message: "이 실시간 연결은 이미 닫혔습니다. 새로 연결해 주세요.",
        fix: "새로 연결해 주세요"
    }
    CONN_REALTIME_MESSAGE_TOO_LARGE(name) {
        class: InvalidRequest,
        place: "실시간 메시지 크기 확인",
        cause: "송수신 메시지가 8MiB를 넘는다",
        message: "연결 {name}의 메시지가 8MiB를 넘습니다. 앱에서 메시지 크기를 줄여 주세요.",
        fix: "앱에서 메시지 크기를 줄여 주세요"
    }
    CONN_REALTIME_SEND_QUEUE_FULL(name) {
        class: Server,
        place: "실시간 메시지 전송 대기열",
        cause: "전송 대기열의 크기나 개수가 한도를 넘었다",
        message: "연결 {name}으로 보낼 메시지가 쌓여 연결을 닫았습니다. 앱의 전송량을 줄이고 다시 연결해 주세요.",
        fix: "앱의 전송량을 줄이고 다시 연결해 주세요"
    }
    CONN_REALTIME_STREAM_FAILED(name, reason) {
        class: Server,
        place: "실시간 메시지 운반",
        cause: "연결이 메시지 전송이나 수신 중 끊겼다",
        message: "연결 {name}의 메시지 운반이 끊겼습니다. 다시 연결해 주세요. 원인: {reason}",
        fix: "다시 연결해 주세요"
    }
    CONN_REALTIME_ACK_INVALID(name) {
        class: InvalidRequest,
        place: "실시간 메시지 확인",
        cause: "아직 전달하지 않은 메시지를 확인하려 했다",
        message: "연결 {name}이 아직 전달하지 않은 메시지를 확인하려 했습니다. 앱 브리지를 고쳐 주세요.",
        fix: "앱 브리지를 고쳐 주세요"
    }
    CONN_REALTIME_PACKET_INVALID() {
        class: InvalidRequest,
        place: "실시간 바이트 봉투 확인",
        cause: "바이트 봉투의 길이나 메시지 형식이 잘못됐다",
        message: "실시간 연결의 바이트 봉투를 읽을 수 없습니다. 앱 브리지의 길이와 메시지 형식을 고쳐 주세요.",
        fix: "앱 브리지의 길이와 메시지 형식을 고쳐 주세요"
    }
    CONN_REALTIME_CLOSE_INVALID() {
        class: InvalidRequest,
        place: "실시간 연결 종료 확인",
        cause: "종료 코드나 사유가 WebSocket 규칙에 맞지 않는다",
        message: "연결 종료 코드나 사유가 WebSocket 규칙에 맞지 않습니다. 앱의 close 호출을 고쳐 주세요.",
        fix: "앱의 close 호출을 고쳐 주세요"
    }
}
