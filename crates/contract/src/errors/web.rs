error_catalog! { ENTRIES;
    WEB_REQUEST_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "웹 화면 요청의 창 조회",
        cause: "요청한 창이 없다",
        message: "웹 화면을 요청한 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    WEB_REQUEST_APP_NOT_FOUND() {
        class: NotFound,
        place: "웹 화면 요청의 앱 조회",
        cause: "창에 연결된 앱이 없다",
        message: "이 창의 앱이 이 쉘에 없어 웹 화면을 열 수 없습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    WEB_REQUEST_DEFINITION_NOT_FOUND() {
        class: NotFound,
        place: "웹 화면 요청의 앱 정의 조회",
        cause: "창에 적용할 앱 정의가 없다",
        message: "이 창의 앱 정의가 이 쉘에 없어 웹 화면을 열 수 없습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    WEB_REQUEST_BLOCK_MISSING() {
        class: InvalidRequest,
        place: "웹 화면 요청의 앱 정의 확인",
        cause: "앱 정의에 웹 화면 블록이 없다",
        message: "앱 정의에 웹 화면이 없어 열 수 없습니다. 웹 화면 블록을 추가하세요.",
        fix: "앱 정의에 웹 화면 블록을 추가하세요"
    }
    WEB_ATTACH_URL_INVALID() {
        class: InvalidRequest,
        place: "웹 화면 연결 주소 검사",
        cause: "웹 화면 연결 주소가 허용되지 않는 형식이다",
        message: "연결할 웹 주소가 올바르지 않습니다. HTTP 또는 HTTPS 주소를 입력하세요.",
        fix: "HTTP 또는 HTTPS 주소를 입력하세요"
    }
    WEB_NAVIGATE_URL_INVALID() {
        class: InvalidRequest,
        place: "웹 화면 이동 주소 검사",
        cause: "웹 화면 이동 주소가 허용되지 않는 형식이다",
        message: "열 웹 주소가 올바르지 않습니다. HTTP 또는 HTTPS 주소를 입력하세요.",
        fix: "HTTP 또는 HTTPS 주소를 입력하세요"
    }
    WEB_REQUEST_HOST_UNAVAILABLE() {
        class: Unavailable,
        place: "웹 화면 실행 환경 확인",
        cause: "현재 실행 환경에 Tauri 웹뷰 호스트가 없다",
        message: "이 환경에는 웹뷰가 없어 웹 화면을 열 수 없습니다. Windows 데스크톱 쉘에서 여세요.",
        fix: "웹 화면은 Windows 데스크톱 쉘에서 여세요"
    }
    WEB_HOST_URL_PARSE_FAILED() {
        class: Io,
        place: "데스크톱 웹뷰 주소 해석",
        cause: "웹뷰가 주소를 해석하지 못했다",
        message: "웹 주소를 해석하지 못했습니다. 주소 형식을 확인하세요.",
        fix: "웹 주소 형식을 확인하세요"
    }
    WEB_HOST_URL_BLOCKED() {
        class: InvalidRequest,
        place: "데스크톱 웹뷰 주소 검사",
        cause: "웹뷰에서 허용하지 않는 주소다",
        message: "이 웹 주소를 열 수 없습니다. HTTP 또는 HTTPS 공개 주소를 사용하세요.",
        fix: "HTTP 또는 HTTPS 공개 주소를 사용하세요"
    }
    WEB_HOST_VIEW_NOT_FOUND() {
        class: NotFound,
        place: "데스크톱 웹뷰 조회",
        cause: "대상 창에 연결된 웹뷰가 없다",
        message: "웹 화면을 찾지 못했습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    WEB_HOST_ATTACH_MAIN_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "웹 화면 연결",
        cause: "웹뷰를 붙일 기본 창이 없다",
        message: "웹 화면을 연결할 기본 창이 없습니다. 쉘을 다시 시작한 뒤 시도하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    WEB_HOST_ATTACH_FAILED() {
        class: Io,
        place: "데스크톱 웹뷰 연결",
        cause: "웹뷰를 만들거나 표시하지 못했다",
        message: "웹 화면을 연결하지 못했습니다. 쉘을 다시 시작한 뒤 시도하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    WEB_HOST_REGISTER_FAILED() {
        class: Io,
        place: "데스크톱 웹뷰 이벤트 등록",
        cause: "웹뷰의 이동과 제목 변경을 감지할 수 없다",
        message: "웹 화면 상태를 연결하지 못했습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    WEB_HOST_PLACE_FAILED() {
        class: Io,
        place: "데스크톱 웹뷰 배치",
        cause: "웹뷰의 위치나 크기를 바꾸지 못했다",
        message: "웹 화면을 배치하지 못했습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    WEB_HOST_NAVIGATE_FAILED() {
        class: Io,
        place: "데스크톱 웹뷰 이동",
        cause: "웹뷰가 새 주소로 이동하지 못했다",
        message: "웹 주소를 열지 못했습니다. 주소와 네트워크를 확인하세요.",
        fix: "주소와 네트워크를 확인하세요"
    }
    WEB_HOST_HISTORY_FAILED() {
        class: Io,
        place: "데스크톱 웹뷰 기록 조작",
        cause: "웹뷰의 새로고침, 뒤로, 앞으로 또는 중지 동작이 실패했다",
        message: "웹 화면 기록을 조작하지 못했습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    WEB_HOST_CAPTURE_FAILED() {
        class: Io,
        place: "데스크톱 웹뷰 캡처",
        cause: "웹뷰 화면을 캡처하지 못했다",
        message: "웹 화면을 캡처하지 못했습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    WEB_HOST_CAPTURE_MAIN_VIEW_NOT_FOUND() {
        class: NotFound,
        place: "쉘 화면 캡처",
        cause: "캡처할 쉘 웹뷰가 없다",
        message: "같이 보기에 보낼 쉘 화면을 찾지 못했습니다. 쉘을 다시 시작한 뒤 시도하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    WEB_HOST_CAPTURE_MAIN_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "쉘 화면 캡처 크기 확인",
        cause: "캡처한 쉘 화면의 배율을 확인할 창이 없다",
        message: "같이 보기에 보낼 쉘 화면의 크기를 확인하지 못했습니다. 쉘을 다시 시작한 뒤 시도하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    WEB_HOST_CAPTURE_SCALE_FAILED() {
        class: Io,
        place: "쉘 화면 캡처 크기 확인",
        cause: "쉘 창의 화면 배율을 읽지 못했다",
        message: "같이 보기에 보낼 쉘 화면의 배율을 읽지 못했습니다. 쉘을 다시 시작한 뒤 시도하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    WEB_HOST_FREEZE_MAIN_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "쉘 화면 고정",
        cause: "화면을 고정할 기본 창이 없다",
        message: "같이 보기 화면을 고정할 쉘 창이 없습니다. 쉘을 다시 시작한 뒤 시도하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    WEB_HOST_FREEZE_FAILED() {
        class: Io,
        place: "쉘 화면 고정",
        cause: "쉘 화면을 고정하지 못했다",
        message: "같이 보기 중 쉘 화면을 고정하지 못했습니다. 쉘을 다시 시작한 뒤 시도하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    WEB_HOST_UNFREEZE_FAILED() {
        class: Io,
        place: "쉘 화면 고정 해제",
        cause: "쉘 화면 고정을 해제하지 못했다",
        message: "같이 보기 뒤 쉘 화면 고정을 해제하지 못했습니다. 쉘을 다시 시작한 뒤 시도하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    WEB_HOST_DETACH_FAILED() {
        class: Io,
        place: "데스크톱 웹뷰 닫기",
        cause: "웹뷰를 닫지 못했다",
        message: "웹 화면을 닫지 못했습니다. 쉘을 다시 시작한 뒤 시도하세요.",
        fix: "쉘을 다시 시작하세요"
    }
}
