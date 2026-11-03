error_catalog! { ENTRIES;
    SHARE_SET_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "같이 보기 켜기와 끄기",
        cause: "같이 보기를 바꿀 창이 없다",
        message: "같이 보기 대상 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    SHARE_SET_DESKTOP_NOT_FOUND(window) {
        class: NotFound,
        place: "같이 보기 데스크톱 조회",
        cause: "대상 창이 속한 데스크톱이 없다",
        message: "같이 보기 대상 창이 속한 데스크톱이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요. 창: {window}",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    SHARE_VIEW_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "같이 보기 내용 등록",
        cause: "내용을 보낼 대상 창이 없다",
        message: "같이 보기 대상 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요. 창: {window}",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    SHARE_VIEW_TEXT_TOO_LARGE(window) {
        class: InvalidRequest,
        place: "같이 보기 글 크기 확인",
        cause: "대상 창의 글이 허용 크기를 넘었다",
        message: "같이 보기 글이 허용 크기 {limit}보다 커서 보내지 못했습니다. 창에 보이는 글을 줄인 뒤 다시 보내세요. 창: {window}",
        fix: "창에 보이는 글을 줄이세요"
    }
    SHARE_VIEW_IMAGE_TOO_LARGE(window) {
        class: InvalidRequest,
        place: "같이 보기 이미지 크기 확인",
        cause: "대상 창의 이미지 데이터가 허용 크기를 넘었다",
        message: "같이 보기 이미지가 허용 크기 {limit}보다 커서 보내지 못했습니다. 창 크기를 줄인 뒤 다시 보내세요. 창: {window}",
        fix: "창 크기를 줄이세요"
    }
    SHARE_CAPTURE_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "같이 보기 대상 창 캡처",
        cause: "캡처할 대상 창의 웹 화면이 없다",
        message: "같이 보기 대상 창의 화면을 찾지 못했습니다. 이 창을 닫고 앱을 다시 여세요. 창: {window}",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    SHARE_CAPTURE_FAILED(window) {
        class: Io,
        place: "같이 보기 대상 창 캡처",
        cause: "대상 창의 화면을 캡처하지 못했다",
        message: "같이 보기 대상 창의 화면을 캡처하지 못했습니다. 이 창을 닫고 앱을 다시 여세요. 창: {window}",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    SHARE_UPLOAD_BODY_INVALID(window) {
        class: InvalidRequest,
        place: "같이 보기 업로드 본문 확인",
        cause: "업로드 본문을 같이 보기 자료로 읽지 못했다",
        message: "서버가 같이 보기 내용을 읽지 못했습니다. 쉘과 서버를 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘과 서버를 업데이트하세요"
    }
    SHARE_UPLOAD_WORKSPACE_INVALID(app) {
        class: InvalidRequest,
        place: "같이 보기 업로드 작업 공간 확인",
        cause: "같이 보기 작업 공간 ID가 비어 있다",
        message: "작업 정보가 비어 있어 {app} 화면을 같이 보기에 올리지 못했습니다. 작업 메뉴에서 작업을 고르세요.",
        fix: "작업 메뉴에서 작업을 고르세요"
    }
    SHARE_UPLOAD_TEXT_TOO_LARGE(app) {
        class: InvalidRequest,
        place: "같이 보기 업로드 글 크기 확인",
        cause: "같이 보기 글이 허용 크기를 넘었다",
        message: "{app} 화면의 같이 보기 글이 허용 크기를 넘어 올리지 못했습니다. 글을 줄여 다시 보내세요.",
        fix: "같이 보기 글을 줄이세요"
    }
    SHARE_UPLOAD_WORKSPACE_NOT_FOUND(app) {
        class: NotFound,
        place: "같이 보기 업로드 권한 확인",
        cause: "기기가 업로드 대상 작업 공간을 소유하지 않는다",
        message: "서버에서 {app} 화면의 작업을 찾지 못해 같이 보기에 올리지 못했습니다. 작업 메뉴에서 다른 작업을 고른 뒤 다시 시도하세요.",
        fix: "작업 메뉴에서 다른 작업을 고르세요"
    }
    SHARE_UPLOAD_STATE_WRITE_FAILED(app) {
        class: Server,
        place: "같이 보기 업로드 저장",
        cause: "서버의 같이 보기 저장 상태를 잠그지 못했다",
        message: "서버가 {app} 화면의 같이 보기 내용을 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    SHARE_LIST_STATE_READ_FAILED() {
        class: Server,
        place: "같이 보기 목록 조회",
        cause: "서버의 같이 보기 목록 상태를 잠그지 못했다",
        message: "서버가 같이 보기 목록을 읽지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
}
