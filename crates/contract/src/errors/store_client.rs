error_catalog! { ENTRIES;
    STORECLIENT_INDEX_SERVER_INVALID() {
        class: InvalidRequest, place: "스토어 목록 원천 입력", cause: "서버 주소가 문자열이 아니다",
        message: "스토어 목록의 서버 주소가 문자열이 아닙니다. 앱 작성자가 서버 값을 확인해야 합니다.", fix: "앱 작성자가 서버 값을 확인해야 합니다"
    }
    STORECLIENT_DETAIL_SERVER_INVALID() {
        class: InvalidRequest, place: "스토어 상세 원천 입력", cause: "서버 주소가 문자열이 아니다",
        message: "스토어 상세의 서버 주소가 문자열이 아닙니다. 앱 작성자가 서버 값을 확인해야 합니다.", fix: "앱 작성자가 서버 값을 확인해야 합니다"
    }
    STORECLIENT_DETAIL_ID_INVALID() {
        class: InvalidRequest, place: "스토어 상세 원천 입력", cause: "앱 ID가 문자열이 아니다",
        message: "스토어 상세의 앱 ID가 문자열이 아닙니다. 앱 작성자가 앱 ID 값을 확인해야 합니다.", fix: "앱 작성자가 앱 ID 값을 확인해야 합니다"
    }
    STORECLIENT_INSTALL_PERMISSION_UNDECLARED(permission) {
        class: PermissionDenied, place: "스토어 설치", cause: "스토어 권한 미선언",
        message: "앱 설치 권한 {permission}이 선언되지 않았습니다. 앱 작성자가 스토어 권한을 선언해야 합니다.", fix: "앱 작성자가 스토어 권한을 선언해야 합니다"
    }
    STORECLIENT_REMOVE_PERMISSION_UNDECLARED(permission) {
        class: PermissionDenied, place: "스토어 삭제", cause: "스토어 권한 미선언",
        message: "앱 삭제 권한 {permission}이 선언되지 않았습니다. 앱 작성자가 스토어 권한을 선언해야 합니다.", fix: "앱 작성자가 스토어 권한을 선언해야 합니다"
    }
    STORECLIENT_INSTALL_SERVER_INVALID() {
        class: InvalidRequest, place: "스토어 설치 입력", cause: "서버 주소가 문자열이 아니다",
        message: "설치할 스토어 주소가 문자열이 아닙니다. 앱 작성자가 서버 값을 확인해야 합니다.", fix: "앱 작성자가 서버 값을 확인해야 합니다"
    }
    STORECLIENT_INSTALL_ID_INVALID() {
        class: InvalidRequest, place: "스토어 설치 입력", cause: "앱 ID가 문자열이 아니다",
        message: "설치할 앱 ID가 문자열이 아닙니다. 앱 작성자가 앱 ID 값을 확인해야 합니다.", fix: "앱 작성자가 앱 ID 값을 확인해야 합니다"
    }
    STORECLIENT_INSTALL_RELEASE_INVALID() {
        class: InvalidRequest, place: "스토어 설치 입력", cause: "릴리스 판이 양의 정수가 아니다",
        message: "설치할 릴리스 판이 양의 정수가 아닙니다. 앱 작성자가 릴리스 값을 확인해야 합니다.", fix: "앱 작성자가 릴리스 값을 확인해야 합니다"
    }
    STORECLIENT_REMOVE_ID_INVALID() {
        class: InvalidRequest, place: "스토어 삭제 입력", cause: "앱 ID가 문자열이 아니다",
        message: "삭제할 앱 ID가 문자열이 아닙니다. 앱 작성자가 앱 ID 값을 확인해야 합니다.", fix: "앱 작성자가 앱 ID 값을 확인해야 합니다"
    }
    STORECLIENT_INSTALL_INCOMPATIBLE(app) {
        class: Unavailable, place: "스토어 설치 호환성 검사", cause: "앱이 더 새 쉘을 요구한다",
        message: "{app} 앱은 더 새 쉘이 필요합니다. 쉘을 업데이트한 뒤 설치하세요.", fix: "쉘을 업데이트하세요"
    }
    STORECLIENT_INSTALL_LOCAL_MODIFIED(app) {
        class: InvalidRequest, place: "스토어 설치 수정본 검사", cause: "설치 후 앱이 수정되었다",
        message: "{app} 앱을 설치한 뒤 수정했습니다. 수정본을 보존하려고 업데이트를 멈췄습니다.", fix: "수정본을 확인하세요"
    }
    STORECLIENT_INSTALL_WINDOW_MISSING() {
        class: NotFound, place: "스토어 설치 창 검사", cause: "요청한 창이 없다",
        message: "설치를 요청한 창을 찾지 못했습니다. 앱 창을 다시 열고 설치하세요.", fix: "앱 창을 다시 여세요"
    }
    STORECLIENT_REMOVE_WINDOW_MISSING() {
        class: NotFound, place: "스토어 삭제 창 검사", cause: "요청한 창이 없다",
        message: "삭제를 요청한 창을 찾지 못했습니다. 앱 창을 다시 열고 삭제하세요.", fix: "앱 창을 다시 여세요"
    }
    STORECLIENT_REMOVE_APP_MISSING(app) {
        class: NotFound, place: "스토어 삭제 대상 검사", cause: "활성 앱이 없다",
        message: "삭제할 {app} 앱을 찾지 못했습니다. 앱 목록을 다시 확인하세요.", fix: "앱 목록을 다시 확인하세요"
    }
    STORECLIENT_INSTALL_SERVER_DISCONNECTED() {
        class: Unavailable, place: "스토어 설치 서버 연결", cause: "레지스트리가 연결되지 않았다",
        message: "앱을 설치할 서버에 연결되지 않았습니다. 서버에 연결한 뒤 다시 설치하세요.", fix: "서버에 연결하세요"
    }
    STORECLIENT_REMOVE_SERVER_DISCONNECTED() {
        class: Unavailable, place: "스토어 삭제 서버 연결", cause: "레지스트리가 연결되지 않았다",
        message: "앱을 삭제할 서버에 연결되지 않았습니다. 서버에 연결한 뒤 다시 삭제하세요.", fix: "서버에 연결하세요"
    }
    STORECLIENT_INSTALL_REQUEST_EXPIRED() {
        class: NotFound, place: "스토어 설치 동의 응답", cause: "대기 중인 요청이 없다",
        message: "설치 동의 요청이 만료되었습니다. 앱에서 설치를 다시 시작하세요.", fix: "설치를 다시 시작하세요"
    }
    STORECLIENT_INSTALL_WINDOW_MISMATCH() {
        class: PermissionDenied, place: "스토어 설치 동의 응답", cause: "요청한 창과 응답 창이 다르다",
        message: "설치 동의가 요청한 창과 다릅니다. 설치를 시작한 창에서 응답하세요.", fix: "설치를 시작한 창에서 응답하세요"
    }
    STORECLIENT_INSTALL_DIGEST_MISMATCH() {
        class: InvalidRequest, place: "스토어 설치 동의 응답", cause: "확인한 묶음의 digest가 다르다",
        message: "확인한 앱 묶음이 설치 요청과 다릅니다. 설치를 다시 시작하세요.", fix: "설치를 다시 시작하세요"
    }
    STORECLIENT_INSTALL_RESPONSE_CLOSED() {
        class: Unavailable, place: "스토어 설치 동의 응답", cause: "설치 대기가 종료되었다",
        message: "설치 대기가 끝나 동의를 전달하지 못했습니다. 설치를 다시 시작하세요.", fix: "설치를 다시 시작하세요"
    }
    STORECLIENT_INSTALL_CONTEXT_CHANGED() {
        class: InvalidRequest, place: "스토어 설치 동의 후 검사", cause: "요청 앱이 바뀌었다",
        message: "설치 동의 중 요청한 앱이 바뀌었습니다. 앱에서 설치를 다시 시작하세요.", fix: "설치를 다시 시작하세요"
    }
    STORECLIENT_INSTALL_REGISTRY_FAILED(reason) {
        class: Unavailable, place: "스토어 설치 서버 요청", cause: "서버 통신이 실패했다",
        message: "앱 설치 요청을 서버에 전달하지 못했습니다. 서버 연결을 확인하세요. 원인: {reason}", fix: "서버 연결을 확인하세요"
    }
    STORECLIENT_REMOVE_REGISTRY_FAILED(reason) {
        class: Unavailable, place: "스토어 삭제 서버 요청", cause: "서버 통신이 실패했다",
        message: "앱 삭제 요청을 서버에 전달하지 못했습니다. 서버 연결을 확인하세요. 원인: {reason}", fix: "서버 연결을 확인하세요"
    }
    STORECLIENT_SOURCE_PERMISSION_UNDECLARED(permission) {
        class: PermissionDenied, place: "스토어 원천 읽기", cause: "스토어 권한이 선언되지 않았다",
        message: "스토어 원천의 권한 {permission}이 선언되지 않았습니다. 앱 작성자가 스토어 권한을 선언해야 합니다.", fix: "앱 작성자가 스토어 권한을 선언해야 합니다"
    }
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
