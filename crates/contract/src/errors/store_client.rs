error_catalog! { ENTRIES;
    STORECLIENT_URL_HTTPS_REQUIRED() { class: InvalidRequest, place: "주소의 HTTPS 확인", cause: "HTTPS가 아니다", message: "스토어 주소가 HTTPS가 아닙니다. https 주소를 입력하세요.", fix: "https 주소를 입력하세요" }
    STORECLIENT_URL_COMPONENT_INVALID() { class: InvalidRequest, place: "주소 구성 확인", cause: "인증정보나 쿼리 등 허용하지 않는 부분이 있다", message: "스토어 주소에 사용할 수 없는 부분이 있습니다. 인증정보, 쿼리와 fragment를 빼고 기준 주소를 입력하세요.", fix: "기준 주소를 입력하세요" }
    STORECLIENT_URL_PRIVATE_ADDRESS() { class: PermissionDenied, place: "주소 공개 여부 확인", cause: "공개 인터넷 주소가 아니다", message: "스토어가 공개 인터넷 주소가 아닙니다. 공개 HTTPS 주소를 입력하세요.", fix: "공개 HTTPS 주소를 입력하세요" }
    STORECLIENT_PATH_OUTSIDE_STORE() { class: PermissionDenied, place: "묶음 경로 확인", cause: "경로가 스토어 범위를 벗어났다", message: "묶음 경로가 스토어 범위를 벗어났습니다. 게시자가 묶음 경로를 고쳐야 합니다.", fix: "게시자가 묶음 경로를 고치세요" }
    STORECLIENT_FETCH_REDIRECT_REJECTED() { class: InvalidRequest, place: "파일 이동 확인", cause: "다른 주소로 이동한다", message: "스토어 파일이 다른 주소로 이동합니다. 이동 없이 파일을 주는 스토어 주소를 사용하세요.", fix: "이동 없는 주소를 사용하세요" }
    STORECLIENT_FETCH_NOT_FOUND(target) { class: NotFound, place: "파일 조회", cause: "파일이 없다", message: "스토어에서 {target}을 찾지 못했습니다. 목록을 새로 읽거나 앱 ID와 판을 확인하세요.", fix: "목록과 앱 ID, 판을 확인하세요" }
    STORECLIENT_FETCH_HTTP_REJECTED(target) { class: Unavailable, place: "파일 HTTP 요청", cause: "스토어가 요청을 거부했다", message: "스토어가 {target} 요청을 거부했습니다. 잠시 뒤 다시 읽으세요.", fix: "잠시 뒤 다시 읽으세요" }
    STORECLIENT_FETCH_TRANSPORT_FAILED(target) { class: Unavailable, place: "파일 연결", cause: "스토어에 연결하지 못했다", message: "스토어에 연결해 {target}을 받지 못했습니다. 인터넷 연결과 주소를 확인하세요.", fix: "인터넷 연결과 주소를 확인하세요" }
    STORECLIENT_FETCH_TOO_LARGE(target, limit) { class: InvalidRequest, place: "파일 크기 확인", cause: "허용 크기를 넘었다", message: "{target}이 허용 크기 {limit}를 넘었습니다. 게시자가 묶음을 줄여야 합니다.", fix: "게시자가 묶음을 줄이세요" }
    STORECLIENT_FORMAT_UNSUPPORTED(format) { class: Unavailable, place: "형식 판 확인", cause: "지원하지 않는 형식 판이다", message: "스토어 형식 {format}판을 지원하지 않습니다. 쉘을 업데이트하세요.", fix: "쉘을 업데이트하세요" }
    STORECLIENT_JSON_INVALID(target) { class: InvalidRequest, place: "JSON 읽기", cause: "올바른 스토어 JSON이 아니다", message: "{target}을 스토어 JSON 형식으로 읽지 못했습니다. 게시자가 파일을 고쳐야 합니다.", fix: "게시자가 파일을 고치세요" }
    STORECLIENT_BUNDLE_SIZE_MISMATCH(file) { class: InvalidRequest, place: "묶음 크기 대조", cause: "파일 크기가 manifest와 다르다", message: "파일 {file} 크기가 manifest와 달라 설치하지 않았습니다. 게시자에게 알리세요.", fix: "게시자에게 알리세요" }
    STORECLIENT_BUNDLE_HASH_MISMATCH(file) { class: InvalidRequest, place: "묶음 해시 대조", cause: "파일 내용이 manifest와 다르다", message: "파일 {file} 내용이 manifest와 달라 설치하지 않았습니다. 게시자에게 알리세요.", fix: "게시자에게 알리세요" }
    STORECLIENT_BUNDLE_DECLARATION_MISMATCH() { class: InvalidAppDefinition, place: "묶음 선언 대조", cause: "앱 정의와 manifest 선언이 다르다", message: "앱 정의와 manifest 선언이 다릅니다. 게시자가 묶음을 다시 만들어야 합니다.", fix: "게시자가 묶음을 다시 만드세요" }
    STORECLIENT_INSTALL_INCOMPATIBLE() { class: Unavailable, place: "설치 호환성 확인", cause: "앱이 요구하는 모듈 또는 블록 판을 지원하지 않는다", message: "이 앱이 요구하는 모듈이나 블록 판을 지원하지 않습니다. 쉘을 업데이트하세요.", fix: "쉘을 업데이트하세요" }
    STORECLIENT_INSTALL_LOCAL_MODIFIED() { class: Conflict, place: "설치 수정 여부 확인", cause: "설치 후 앱이 수정되었다", message: "설치 후 수정한 앱이라 업데이트를 보류했습니다. 수정본을 보관한 뒤 삭제하고 다시 설치하세요.", fix: "수정본을 보관한 뒤 삭제하고 다시 설치하세요" }
}
