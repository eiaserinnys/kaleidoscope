error_catalog! { ENTRIES;
    STORECLIENT_INDEXES_SERVERS_INVALID(position) { class: InvalidRequest, place: "여러 스토어 목록 원천 입력", cause: "서버 목록이 문자열 배열이 아니다", message: "스토어 서버 목록의 {position}은 문자열 배열 또는 그 항목이 아닙니다. 앱 작성자가 서버 목록 값을 확인해야 합니다.", fix: "앱 작성자가 서버 목록을 문자열 배열로 고쳐야 합니다" }
    STORECLIENT_SERVER_ALLOW_ADDRESS_INVALID() { class: InvalidRequest, place: "스토어 서버 허용 입력", cause: "서버 주소가 문자열이 아니다", message: "허용할 스토어 주소가 문자열이 아닙니다. 앱 작성자가 서버 값을 확인해야 합니다.", fix: "앱 작성자가 서버 값을 확인해야 합니다" }
    STORECLIENT_SERVER_ALLOW_WINDOW_MISSING() { class: NotFound, place: "스토어 서버 허용 창 검사", cause: "요청한 창을 찾을 수 없다", message: "스토어 연결을 요청한 창을 찾지 못했습니다. 앱 창을 다시 열고 연결하세요.", fix: "앱 창을 다시 여세요" }
    STORECLIENT_SERVER_ALLOW_PERMISSION_UNDECLARED(permission) { class: PermissionDenied, place: "스토어 서버 허용 권한 검사", cause: "스토어 권한이 선언되지 않았다", message: "스토어 연결 권한 {permission}이 선언되지 않았습니다. 앱 작성자가 스토어 권한을 선언해야 합니다.", fix: "앱 작성자가 스토어 권한을 선언해야 합니다" }
    STORECLIENT_SERVER_ALLOW_CONTEXT_CHANGED() { class: InvalidRequest, place: "스토어 서버 허용 문맥 검사", cause: "요청 창이나 서버 연결이 바뀌었다", message: "스토어 연결을 묻는 동안 앱이나 서버 연결이 바뀌었습니다. 앱에서 연결을 다시 요청하세요.", fix: "앱에서 연결을 다시 요청하세요" }
    STORECLIENT_SERVER_ALLOW_REQUEST_EXPIRED() { class: NotFound, place: "스토어 서버 허용 응답", cause: "대기 중인 요청이 없다", message: "스토어 연결 요청이 만료되었습니다. 앱에서 연결을 다시 요청하세요.", fix: "앱에서 연결을 다시 요청하세요" }
    STORECLIENT_SERVER_ALLOW_WINDOW_MISMATCH() { class: PermissionDenied, place: "스토어 서버 허용 응답 창 검사", cause: "요청 창과 응답 창이 다르다", message: "스토어 연결 응답이 요청한 창과 다릅니다. 연결을 요청한 창에서 응답하세요.", fix: "연결을 요청한 창에서 응답하세요" }
    STORECLIENT_SERVER_ALLOW_TARGET_MISMATCH() { class: InvalidRequest, place: "스토어 서버 허용 응답 주소 검사", cause: "응답 주소가 요청 주소와 다르다", message: "확인한 스토어 주소가 요청 주소와 다릅니다. 앱에서 연결을 다시 요청하세요.", fix: "앱에서 연결을 다시 요청하세요" }
    STORECLIENT_SERVER_ALLOW_SAVE_FAILED() { class: Unavailable, place: "스토어 서버 허용 저장", cause: "기기 설정 저장에 실패했다", message: "스토어 연결 허용을 이 PC에 저장하지 못했습니다. 저장 공간과 파일 권한을 확인한 뒤 다시 연결하세요.", fix: "저장 공간과 파일 권한을 확인하세요" }

    STORECLIENT_INSTALL_REQUEST_TOO_LARGE(app, size) {
        class: InvalidRequest, place: "스토어 설치 요청 전송", cause: "프록시가 설치 요청 크기를 거절했다",
        message: "“{app}” 설치 요청 {size}를 서버가 크기 초과로 받지 않았습니다. 서버나 그 앞 프록시의 요청 크기 한도를 이 요청보다 크게 늘린 뒤 다시 설치하세요.", fix: "서버나 프록시의 요청 크기 한도를 늘린 뒤 다시 설치하세요"
    }

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
        message: "{app} 앱을 설치한 뒤 수정했습니다. 수정본을 보관한 뒤 삭제하고 다시 설치하세요.", fix: "수정본을 보관한 뒤 삭제하고 다시 설치하세요"
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
    STORECLIENT_REMOVE_CUSTOM_OFFLINE() {
        class: Unavailable, place: "커스텀 앱 삭제 연결 검사", cause: "서버 연결이 끊긴 기기에서 로컬 삭제를 요청했다",
        message: "서버 연결이 끊긴 동안에는 커스텀 앱을 지울 수 없습니다. 서버에 연결한 뒤 다시 지우세요.", fix: "서버에 연결한 뒤 다시 지우세요"
    }
    STORECLIENT_REMOVE_BUILTIN(app) {
        class: InvalidRequest, place: "커스텀 앱 삭제 대상 검사", cause: "기본 앱 ID다",
        message: "기본 앱 ID {app}: 지울 수 없습니다. 기본 앱은 쉘에 포함되어 있습니다.", fix: "쉘 업데이트로 기본 앱을 바꾸세요"
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
    STORECLIENT_URL_COMPONENT_INVALID() {
        class: InvalidRequest, place: "스토어 주소 검사", cause: "주소에 허용하지 않는 구성 요소가 있다",
        message: "스토어 주소에 사용할 수 없는 구성 요소가 있습니다. 인증정보와 쿼리를 빼고 기준 주소를 입력하세요.", fix: "기준 주소만 입력하세요"
    }
    STORECLIENT_SERVER_PERMISSION_REQUIRED(server) {
        class: PermissionDenied, place: "스토어 서버 접근 검사", cause: "이 기기에서 주소 접근을 허용하지 않았다",
        message: "스토어 {server}에 접근하려면 이 기기에서 주소를 허용해야 합니다. 스토어 접근 허용을 확인하세요.", fix: "스토어 접근을 허용하세요"
    }
    STORECLIENT_PATH_OUTSIDE_STORE(path) {
        class: PermissionDenied, place: "스토어 경로 검사", cause: "경로가 허용된 스토어 범위를 벗어났다",
        message: "스토어 경로 {path}가 허용된 범위를 벗어났습니다. 게시자가 경로를 고쳐야 합니다.", fix: "게시자가 경로를 고쳐야 합니다"
    }
    STORECLIENT_FETCH_REDIRECT_REJECTED(target) {
        class: InvalidRequest, place: "스토어 파일 읽기", cause: "다른 주소로 이동한다",
        message: "스토어 파일 {target}이 다른 주소로 이동합니다. 이동 없이 파일을 주는 주소를 사용하세요.", fix: "이동 없는 주소를 사용하세요"
    }
    STORECLIENT_FETCH_INVITE_REQUIRED(server, target) {
        class: Unauthorized, place: "스토어 파일 읽기", cause: "초대코드가 필요한 스토어에 초대코드를 보내지 않았다",
        message: "스토어 {server}는 초대코드가 있어야 {target}을 줍니다. 앱스토어 설정에 이 스토어 주소와 초대코드를 더하세요.", fix: "앱스토어 설정에 스토어 주소와 초대코드를 더하세요"
    }
    STORECLIENT_FETCH_INVITE_REJECTED(target) {
        class: Unauthorized, place: "스토어 파일 읽기", cause: "보낸 초대코드가 맞지 않는다",
        message: "스토어가 보낸 초대코드를 받지 않아 {target} 요청을 거부했습니다. 앱스토어 설정에서 이 스토어의 초대코드를 확인하세요.", fix: "스토어 초대코드를 확인하세요"
    }
    STORECLIENT_FETCH_NOT_FOUND(target) {
        class: NotFound, place: "스토어 파일 읽기", cause: "파일이 없다",
        message: "스토어에서 {target}을 찾지 못했습니다. 목록을 새로 읽거나 앱 ID와 판을 확인하세요.", fix: "앱 ID와 판을 확인하세요"
    }
    STORECLIENT_FETCH_HTTP_REJECTED() {
        class: Unavailable, place: "스토어 파일 읽기", cause: "서버가 요청을 거부했다",
        message: "스토어가 요청을 거부했습니다. 잠시 뒤 다시 받으세요.", fix: "잠시 뒤 다시 받으세요"
    }
    STORECLIENT_FETCH_TRANSPORT_FAILED() {
        class: Unavailable, place: "스토어 파일 읽기", cause: "네트워크 전송에 실패했다",
        message: "스토어에 연결하지 못했습니다. 네트워크 연결과 스토어 주소를 확인하세요.", fix: "네트워크 연결과 스토어 주소를 확인하세요"
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

    STORECLIENT_UPDATE_APP_MISSING(id) {
        class: NotFound, place: "스토어 갱신 대상 검사", cause: "앱이 이 기기에 설치되어 있지 않다",
        message: "'{id}' 앱이 이 기기에 설치되어 있지 않습니다. 앱을 올린 스토어 주소를 store_url에 지정해 주세요.", fix: "앱을 올린 스토어 주소를 store_url에 지정하세요"
    }
    STORECLIENT_UPDATE_STORE_REQUIRED(id) {
        class: InvalidRequest, place: "스토어 갱신 출처 검사", cause: "앱에 스토어 출처가 없다",
        message: "'{id}' 앱은 스토어 출처가 없습니다. 올려 둔 스토어 주소를 store_url에 지정해 주세요.", fix: "앱을 올린 스토어 주소를 store_url에 지정하세요"
    }
    STORECLIENT_UPDATE_REQUEST_EXPIRED() {
        class: NotFound, place: "스토어 갱신 요청 만료 검사", cause: "요청 유효 시간이 지났다",
        message: "앱 갱신 요청의 유효 시간이 지났습니다. 다시 요청해 주세요.", fix: "다시 요청하세요"
    }
    STORECLIENT_UPDATE_BUILTIN(id) {
        class: InvalidAppDefinition, place: "스토어 갱신 기본 앱 검사", cause: "쉘에 포함된 기본 앱이다",
        message: "'{id}'은 쉘에 포함된 기본 앱입니다. 쉘을 업데이트해 주세요.", fix: "쉘을 업데이트하세요"
    }
    STORECLIENT_INSTALL_OWNER_MISMATCH() {
        class: PermissionDenied, place: "스토어 설치 동의 응답 소유자 검사", cause: "응답한 소유자가 요청과 다르다",
        message: "설치 동의 응답이 요청한 소유자와 다릅니다. 동의를 시작한 화면에서 응답하세요.", fix: "동의를 시작한 화면에서 응답하세요"
    }
}
