error_catalog! { ENTRIES;
    MCP_WINDOW_CONTROL_TARGET_UNAVAILABLE(window) { class: NotFound, place: "창 제어 대상 조회", cause: "공유 대상 창이 없다", message: "{window} 창의 같이 보기 내용을 찾지 못했습니다. 창의 같이 보기를 켜고 다시 읽으세요.", fix: "창의 같이 보기를 켜고 다시 읽으세요" }
    MCP_WINDOW_CONTROL_DEVICE_OFFLINE(device) { class: Unavailable, place: "창 제어 기기 연결", cause: "기기 스트림이 종료됐다", message: "{device} 기기와 연결이 끊겨 창을 조작하지 못했습니다. 쉘을 연결한 뒤 다시 읽으세요.", fix: "쉘을 연결한 뒤 다시 읽으세요" }
    MCP_WINDOW_CONTROL_DEVICE_VERSION_UNSUPPORTED(device) { class: Unavailable, place: "창 제어 기기 판 확인", cause: "기기의 쉘이 창 제어를 지원하지 않는다", message: "{device} 기기의 쉘은 창 조작을 지원하지 않습니다. 쉘을 업데이트하세요.", fix: "쉘을 업데이트하세요" }
    MCP_WINDOW_CONTROL_VIEW_UNKNOWN(window) { class: NotFound, place: "창 제어 읽기 판 조회", cause: "서버가 읽기 판을 찾지 못했다", message: "{window} 창의 읽기 판이 만료됐습니다. read_window로 다시 읽으세요.", fix: "read_window로 다시 읽으세요" }
    MCP_WINDOW_CONTROL_BUSY(window) { class: Conflict, place: "창 제어 동시 요청", cause: "같은 창의 앞 요청이 진행 중이다", message: "{window} 창의 앞 동작이 진행 중입니다. 결과를 받은 뒤 요청하세요.", fix: "앞 요청의 결과를 받은 뒤 요청하세요" }
    MCP_WINDOW_CONTROL_TIMEOUT(window) { class: Unavailable, place: "창 제어 기기 응답 대기", cause: "응답 대기 시간이 지났다", message: "{window} 창의 기기 응답을 시간 안에 받지 못했습니다. 동작 결과를 다시 읽어 확인한 뒤 다음 요청을 보내세요.", fix: "동작 결과를 다시 읽어 확인하세요" }
    MCP_WINDOW_CONTROL_REPLY_OWNER_MISMATCH() { class: PermissionDenied, place: "창 제어 응답 소유자 확인", cause: "응답 기기나 창이 요청과 다르다", message: "이 창 제어 요청을 받은 기기와 창의 응답이 아닙니다. 요청 대상 기기에서 응답하세요.", fix: "요청 대상 기기와 창에서 응답하세요" }
    MCP_WINDOW_CONTROL_REPLY_EXPIRED() { class: NotFound, place: "창 제어 응답 대기 조회", cause: "요청을 찾지 못했거나 대기가 끝났다", message: "이 창 제어 요청의 대기가 끝났습니다. 새 요청 결과만 보내세요.", fix: "새 요청 결과만 보내세요" }
    MCP_WINDOW_CONTROL_REPLY_BODY_INVALID() { class: InvalidRequest, place: "창 제어 응답 본문 검사", cause: "응답을 계약 형식으로 읽지 못했다", message: "창 제어 응답 형식이 맞지 않습니다. 기기의 응답 계약을 확인하세요.", fix: "기기의 응답 계약을 확인하세요" }
    MCP_WINDOW_CONTROL_REPLY_TOO_LARGE(limit) { class: InvalidRequest, place: "창 제어 응답 크기 검사", cause: "응답이 허용 크기를 넘었다", message: "창 제어 응답이 허용 크기 {limit}를 넘었습니다. 화면 글과 PNG 크기를 줄이세요.", fix: "화면 글과 PNG 크기를 줄이세요" }
    MCP_WINDOW_CONTROL_TYPE_TEXT_TOO_LARGE(size) { class: InvalidRequest, place: "act_window 서버 입력 글 크기 검사", cause: "입력 글이 16KiB를 넘었다", message: "넣을 글이 {size}라 한 번에 넣을 수 있는 16KiB를 넘었습니다. 글을 나눠 mode append로 이어 넣으세요.", fix: "글을 나눠 mode append로 이어 넣으세요" }
    MCP_WINDOW_CONTROL_SCROLL_AMOUNT_OUT_OF_RANGE(amount) { class: InvalidRequest, place: "act_window 서버 스크롤 양 검사", cause: "스크롤 양이 허용 범위 밖이다", message: "스크롤 양 {amount}은 쓸 수 없습니다. 1에서 10000 사이의 CSS 픽셀 값으로 다시 요청하세요.", fix: "1에서 10000 사이의 CSS 픽셀 값으로 다시 요청하세요" }
    MCP_UPLOAD_APP_SERIALIZE_FAILED() {
        class: Server,
        place: "upload_app 입력 준비",
        cause: "앱 정의를 서버 요청용 JSON으로 만들지 못했다",
        message: "definition 값을 JSON 문자열로 바꾸지 못했습니다. definition을 JSON 객체로 넘기세요.",
        fix: "definition을 JSON 객체로 넘기세요"
    }
    MCP_GET_ASSET_NOT_FOUND(asset_id, version) {
        class: NotFound,
        place: "get_asset 자산 판 조회",
        cause: "요청한 자산 판이 없다",
        message: "자산 ID {asset_id}의 {version}판을 찾지 못했습니다. list_assets에서 판을 확인해 다시 조회하세요.",
        fix: "list_assets에서 등록된 자산 ID와 판을 확인하세요"
    }
    MCP_DELETE_APP_BUILTIN(app_id) {
        class: InvalidAppDefinition,
        place: "delete_app 기본 앱 삭제 검사",
        cause: "기본 앱은 MCP 도구에서 삭제할 수 없다",
        message: "기본 앱 ID {app_id}: delete_app으로 지울 수 없습니다. 기본 앱 정의를 고치고 쉘 새 판을 내세요.",
        fix: "kaleidoscope 리포에서 기본 앱 정의를 고치고 새 쉘 판을 내세요"
    }
    MCP_DELETE_APP_NOT_FOUND(app_id) {
        class: Server,
        place: "delete_app 앱 조회",
        cause: "삭제할 앱이 현재 계정에 없거나 이미 삭제되었다",
        message: "앱 ID {app_id}: 삭제할 앱을 찾지 못했습니다. list_apps로 현재 앱 ID를 확인하세요.",
        fix: "list_apps로 현재 앱 ID를 확인하세요"
    }
    MCP_DELETE_APP_DATABASE_FAILED(app_id) {
        class: Server,
        place: "delete_app 데이터베이스 처리",
        cause: "앱 삭제 상태를 기록하거나 연결된 창을 읽지 못했다",
        message: "앱 ID {app_id}: 서버에서 앱을 지우지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "잠시 뒤 다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    MCP_GET_APP_VERSION_NOT_FOUND(app_id, version) {
        class: NotFound,
        place: "get_app 기본 앱 판 조회",
        cause: "요청한 기본 앱 판이 현재 고정 판과 다르다",
        message: "기본 앱 ID {app_id}의 {version}판은 제공되지 않습니다. 현재 판으로 다시 조회하세요.",
        fix: "현재 기본 앱 판을 요청하세요"
    }
    MCP_GET_APP_NOT_FOUND(app_id) {
        class: Server,
        place: "get_app 앱 판 조회",
        cause: "요청한 앱 또는 판이 없다",
        message: "앱 ID {app_id}: 요청한 앱이나 판을 찾지 못했습니다. list_apps로 현재 앱 ID와 판을 확인하세요.",
        fix: "list_apps로 현재 앱 ID와 판을 확인하세요"
    }
    MCP_OPEN_APP_NOT_FOUND(app_id) {
        class: Server,
        place: "open_app 앱 조회",
        cause: "열려는 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 열 앱을 찾지 못했습니다. list_apps로 현재 앱 ID를 확인하세요.",
        fix: "list_apps로 현재 앱 ID를 확인하세요"
    }
    MCP_GET_WORKSPACE_ID_REQUIRED() {
        class: Server,
        place: "get_workspace 작업 조회",
        cause: "요청에 workspace_id가 없고 MCP 연결에도 기본 작업이 없다",
        message: "get_workspace를 실행할 workspace_id가 없습니다. list_workspaces에서 작업 ID를 확인해 지정하세요.",
        fix: "요청에 존재하는 workspace_id를 지정하세요"
    }
    MCP_GET_WORKSPACE_NOT_FOUND(workspace_id) {
        class: Server,
        place: "get_workspace 작업 조회",
        cause: "요청한 작업이 현재 계정에 없다",
        message: "작업 ID {workspace_id}: 작업을 찾지 못했습니다. list_workspaces에서 현재 작업 ID를 확인하세요.",
        fix: "현재 계정에 있는 작업 ID를 지정하세요"
    }
    MCP_GET_SHARED_VIEW_WORKSPACE_ID_REQUIRED() {
        class: Server,
        place: "get_shared_view 작업 선택",
        cause: "요청에 workspace_id가 없고 MCP 연결에도 기본 작업이 없다",
        message: "get_shared_view를 실행할 workspace_id가 없습니다. list_workspaces에서 작업 ID를 확인해 지정하세요.",
        fix: "요청에 존재하는 workspace_id를 지정하세요"
    }
    MCP_DELETE_WORKSPACE_LAST(workspace_id) {
        class: Server,
        place: "delete_workspace 마지막 작업 검사",
        cause: "요청한 작업이 계정의 마지막 작업이다",
        message: "작업 ID {workspace_id}: 계정의 마지막 작업이라 지울 수 없습니다. 다른 작업을 만든 뒤 다시 요청하세요.",
        fix: "다른 작업을 만든 뒤 삭제하세요"
    }
    MCP_DELETE_WORKSPACE_NOT_FOUND(workspace_id) {
        class: Server,
        place: "delete_workspace 작업 조회",
        cause: "요청한 작업이 현재 계정에 없다",
        message: "작업 ID {workspace_id}: 지울 작업을 찾지 못했습니다. list_workspaces에서 작업 ID를 확인하세요.",
        fix: "현재 계정에 있는 작업 ID를 지정하세요"
    }
    MCP_REVOKE_DEVICE_NOT_FOUND(device_id) {
        class: Server,
        place: "revoke_device 기기 조회",
        cause: "연결을 끊을 기기가 현재 계정에 없다",
        message: "기기 ID {device_id}: 연결된 기기를 찾지 못했습니다. list_devices에서 기기 ID를 확인하세요.",
        fix: "list_devices에 표시된 기기 ID를 지정하세요"
    }
    MCP_DELETE_CONNECTION_NOT_FOUND(name) {
        class: Server,
        place: "delete_connection 연결 조회",
        cause: "삭제할 연결이 등록되어 있지 않다",
        message: "연결 {name}: 등록된 연결을 찾지 못했습니다. list_connections에서 이름을 확인하세요.",
        fix: "list_connections에 표시된 연결 이름을 지정하세요"
    }
    MCP_STORE_UPDATE_DEVICE_REQUIRED() {
        class: NotFound,
        place: "update_app_from_store 대상 기기 선택",
        cause: "요청받을 연결 기기가 없다",
        message: "앱을 갱신할 기기를 찾지 못했습니다. 연결된 기기를 지정해 주세요.",
        fix: "list_devices에서 연결된 기기 ID를 확인해 device_id로 지정하세요"
    }
    MCP_STORE_UPDATE_DEVICE_OFFLINE(name) {
        class: Unavailable,
        place: "update_app_from_store 기기 연결 확인",
        cause: "기기 스트림이 종료됐다",
        message: "'{name}' 기기가 연결되어 있지 않습니다. 쉘을 켜고 다시 요청해 주세요.",
        fix: "쉘을 켜고 다시 요청하세요"
    }
    MCP_STORE_UPDATE_DEVICE_FORBIDDEN() {
        class: PermissionDenied,
        place: "update_app_from_store 기기 접근 확인",
        cause: "MCP 연결의 계정이나 작업이 그 기기를 쓸 수 없다",
        message: "이 MCP 연결에서는 지정한 기기에 앱 갱신을 요청할 수 없습니다. 연결된 계정과 작업의 기기를 지정해 주세요.",
        fix: "연결된 계정과 작업의 기기를 지정하세요"
    }
    MCP_STORE_UPDATE_DEVICE_VERSION_UNSUPPORTED(name) {
        class: Unavailable,
        place: "update_app_from_store 기기 판 확인",
        cause: "기기의 쉘이 스토어 갱신 요청을 지원하지 않는다",
        message: "'{name}' 기기의 쉘이 스토어 갱신 요청을 지원하지 않습니다. 쉘을 올린 뒤 다시 요청해 주세요.",
        fix: "쉘을 올린 뒤 다시 요청하세요"
    }
    MCP_STORE_UPDATE_TIMEOUT(name) {
        class: Unavailable,
        place: "update_app_from_store 기기 응답 대기",
        cause: "응답 대기 시간이 지났다",
        message: "'{name}' 기기의 앱 갱신 결과를 받지 못했습니다. 쉘의 설치 상태를 확인해 주세요.",
        fix: "쉘의 설치 상태를 확인하세요"
    }
    MCP_STORE_UPDATE_REPLY_INVALID() {
        class: InvalidRequest,
        place: "update_app_from_store 응답 본문 검사",
        cause: "응답을 계약 형식으로 읽지 못했다",
        message: "기기의 앱 갱신 응답 형식이 맞지 않습니다. 기기와 서버를 같은 지원 판으로 올려 주세요.",
        fix: "기기와 서버를 같은 지원 판으로 올리세요"
    }
    MCP_STORE_UPDATE_REPLY_DEVICE_MISMATCH() {
        class: PermissionDenied,
        place: "update_app_from_store 응답 기기 확인",
        cause: "응답 기기가 요청 대상과 다르다",
        message: "이 앱 갱신 요청을 받은 기기의 응답이 아닙니다. 요청 대상 기기에서 응답해 주세요.",
        fix: "요청 대상 기기에서 응답하세요"
    }
    MCP_STORE_UPDATE_REQUEST_UNKNOWN() {
        class: NotFound,
        place: "update_app_from_store 응답 대기 조회",
        cause: "요청을 찾지 못했거나 대기가 끝났다",
        message: "이 앱 갱신 요청의 대기가 끝났습니다. 새 요청 결과만 보내세요.",
        fix: "새 요청 결과만 보내세요"
    }
}
