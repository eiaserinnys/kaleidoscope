error_catalog! { ENTRIES;
    STORECLIENT_URL_HTTPS_REQUIRED(server) {
        class: InvalidRequest, place: "스토어 주소 검사", cause: "HTTPS 주소가 아니다",
        message: "스토어 주소 {server}는 HTTPS가 아닙니다. HTTPS 주소를 입력하세요.", fix: "HTTPS 주소를 입력하세요"
    }
    STORECLIENT_URL_COMPONENT_INVALID() {
        class: InvalidRequest, place: "스토어 주소 검사", cause: "주소에 허용하지 않는 구성 요소가 있다",
        message: "스토어 주소에 사용할 수 없는 구성 요소가 있습니다. 인증정보와 쿼리를 빼고 기준 주소를 입력하세요.", fix: "기준 주소만 입력하세요"
    }
    STORECLIENT_URL_PRIVATE_ADDRESS() {
        class: PermissionDenied, place: "스토어 주소 검사", cause: "공개 인터넷 주소가 아니다",
        message: "스토어가 공개 인터넷 주소가 아닙니다. 공개 HTTPS 주소를 입력하세요.", fix: "공개 HTTPS 주소를 입력하세요"
    }
    STORECLIENT_PATH_OUTSIDE_STORE(path) {
        class: PermissionDenied, place: "스토어 경로 검사", cause: "경로가 허용된 스토어 범위를 벗어났다",
        message: "스토어 경로 {path}가 허용된 범위를 벗어났습니다. 게시자가 경로를 고쳐야 합니다.", fix: "게시자가 경로를 고쳐야 합니다"
    }
    STORECLIENT_FETCH_REDIRECT_REJECTED(target) {
        class: InvalidRequest, place: "스토어 파일 읽기", cause: "다른 주소로 이동한다",
        message: "스토어 파일 {target}이 다른 주소로 이동합니다. 이동 없이 파일을 주는 주소를 사용하세요.", fix: "이동 없는 주소를 사용하세요"
    }
    STORECLIENT_FETCH_NOT_FOUND(target) {
        class: NotFound, place: "스토어 파일 읽기", cause: "파일이 없다",
        message: "스토어에서 {target}을 찾지 못했습니다. 목록을 새로 읽거나 앱 ID와 판을 확인하세요.", fix: "앱 ID와 판을 확인하세요"
    }
    STORECLIENT_FETCH_HTTP_REJECTED(target) {
        class: Unavailable, place: "스토어 파일 읽기", cause: "서버가 요청을 거부했다",
        message: "스토어가 {target} 요청을 거부했습니다. 잠시 뒤 다시 읽으세요.", fix: "잠시 뒤 다시 읽으세요"
    }
    STORECLIENT_FETCH_TRANSPORT_FAILED(target) {
        class: Unavailable, place: "스토어 파일 읽기", cause: "네트워크 전송에 실패했다",
        message: "스토어에 연결해 {target}을 받지 못했습니다. 인터넷 연결과 주소를 확인하세요.", fix: "인터넷 연결과 주소를 확인하세요"
    }
    STORECLIENT_FETCH_TOO_LARGE(target, limit) {
        class: InvalidRequest, place: "스토어 파일 크기 검사", cause: "허용 크기를 넘었다",
        message: "스토어 파일 {target}이 허용 크기 {limit}를 넘었습니다. 게시자가 파일을 줄여야 합니다.", fix: "게시자가 파일을 줄여야 합니다"
    }
    STORECLIENT_FORMAT_UNSUPPORTED(format) {
        class: Unavailable, place: "스토어 형식 검사", cause: "지원하지 않는 새 형식이다",
        message: "스토어가 형식 {format}판입니다. 쉘을 업데이트하세요.", fix: "쉘을 업데이트하세요"
    }
    STORECLIENT_JSON_INVALID(target) {
        class: InvalidRequest, place: "스토어 JSON 읽기", cause: "파일이 형식에 맞지 않는다",
        message: "스토어 파일 {target}을 JSON 형식으로 읽지 못했습니다. 게시자가 파일을 고쳐야 합니다.", fix: "게시자가 파일을 고쳐야 합니다"
    }
    STORECLIENT_BUNDLE_SIZE_MISMATCH(path) {
        class: InvalidRequest, place: "스토어 묶음 크기 검사", cause: "실제 크기가 manifest와 다르다",
        message: "파일 {path}의 크기가 manifest와 다릅니다. 설치하지 않았습니다. 게시자에게 알리세요.", fix: "게시자에게 알리세요"
    }
    STORECLIENT_BUNDLE_HASH_MISMATCH(path) {
        class: InvalidRequest, place: "스토어 묶음 해시 검사", cause: "실제 내용이 manifest와 다르다",
        message: "파일 {path}의 내용이 manifest와 다릅니다. 설치하지 않았습니다. 게시자에게 알리세요.", fix: "게시자에게 알리세요"
    }
    STORECLIENT_BUNDLE_DECLARATION_MISMATCH() {
        class: InvalidAppDefinition, place: "스토어 묶음 선언 검사", cause: "앱 정의와 manifest 선언이 다르다",
        message: "앱 정의와 manifest 선언이 다릅니다. 게시자가 묶음을 다시 만들어야 합니다.", fix: "게시자가 묶음을 다시 만들어야 합니다"
    }
    STORECLIENT_MEDIA_QUERY_INVALID() {
        class: InvalidRequest, place: "스토어 미디어 참조 검사", cause: "server가 없거나 다른 query가 있다",
        message: "스토어 그림의 서버 정보가 올바르지 않습니다. 앱 작성자가 미디어 참조를 고쳐야 합니다.", fix: "앱 작성자가 미디어 참조를 고쳐야 합니다"
    }
    STORECLIENT_MEDIA_FORMAT_INVALID(path) {
        class: InvalidRequest, place: "스토어 미디어 형식 검사", cause: "허용하지 않는 그림 형식이다",
        message: "스토어 그림 {path}의 형식이 올바르지 않습니다. 게시자가 그림을 다시 올려야 합니다.", fix: "게시자가 그림을 다시 올려야 합니다"
    }
}
