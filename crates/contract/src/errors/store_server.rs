error_catalog! { ENTRIES;
    STORESERVER_START_BIND_FAILED(address) { class: Server, place: "스토어 서버 시작", cause: "주소에 바인드하지 못했다", message: "스토어 서버 주소 {address}를 열지 못했습니다. 주소와 포트가 사용 가능한지 확인하세요.", fix: "주소와 포트를 확인하세요" }
    STORESERVER_START_INVITE_FILE_FAILED() { class: Io, place: "스토어 서버 초대코드 파일 읽기", cause: "초대코드 파일을 읽지 못했거나 값이 비었다", message: "스토어 서버 초대코드 파일을 읽지 못했습니다. 파일 경로와 내용을 확인하세요.", fix: "초대코드 파일 경로와 내용을 확인하세요" }
    STORESERVER_AUTH_INVITE_INVALID() { class: Unauthorized, place: "스토어 서버 초대코드 검사", cause: "초대코드 헤더가 없거나 서버 값과 다르다", message: "스토어 서버의 초대코드가 없거나 일치하지 않습니다. 초대코드를 확인해 다시 요청하세요.", fix: "초대코드를 확인하세요" }
    STORESERVER_START_DATA_DIRECTORY_FAILED() { class: Io, place: "스토어 자료 폴더 준비", cause: "자료 폴더를 열거나 만들지 못했다", message: "스토어 자료 폴더를 준비하지 못했습니다. 경로와 쓰기 권한을 확인하세요.", fix: "자료 폴더 경로와 권한을 확인하세요" }
    STORESERVER_PUBLISH_BODY_TOO_LARGE() { class: InvalidRequest, place: "게시 요청 크기 검사", cause: "본문이 22 MiB를 넘었다", message: "게시 요청이 22 MiB를 넘습니다. 앱과 파일 크기를 줄여 다시 올리세요.", fix: "게시 요청을 22 MiB 이하로 줄이세요" }
    STORESERVER_PUBLISH_MULTIPART_INVALID() { class: InvalidRequest, place: "게시 요청 해석", cause: "multipart 형식이 올바르지 않다", message: "게시 요청의 multipart 형식이 올바르지 않습니다. 게시 도구의 요청을 확인하세요.", fix: "게시 도구의 multipart 요청을 확인하세요" }
    STORESERVER_PUBLISH_PATH_INVALID() { class: InvalidRequest, place: "게시 파일 경로 검사", cause: "파일 경로가 올바르지 않다", message: "게시 파일 경로가 올바르지 않습니다. 앱 폴더 안의 상대 경로를 사용하세요.", fix: "게시 파일 경로를 확인하세요" }
    STORESERVER_PUBLISH_FILE_DUPLICATE(path) { class: InvalidRequest, place: "게시 파일 중복 검사", cause: "같은 파일이 두 번 전달되었다", message: "게시 파일 {path}이 중복되었습니다. 한 번만 올리세요.", fix: "중복 파일을 제거하세요" }
    STORESERVER_PUBLISH_FILE_UNEXPECTED(path) { class: InvalidRequest, place: "게시 파일 목록 검사", cause: "허용하지 않는 파일이 있다", message: "게시 파일 {path}은 허용되지 않습니다. 앱 폴더에서 이 파일을 빼세요.", fix: "허용되지 않은 파일을 제거하세요" }
    STORESERVER_PUBLISH_FILE_MISSING(path) { class: InvalidRequest, place: "게시 파일 목록 검사", cause: "필요한 파일이 없다", message: "게시 파일 {path}이 없습니다. 앱 폴더에 파일을 넣어 다시 올리세요.", fix: "필요한 파일을 추가하세요" }
    STORESERVER_PUBLISH_APP_TOO_LARGE() { class: InvalidRequest, place: "앱 정의 크기 검사", cause: "app.json이 1 MiB를 넘었다", message: "app.json이 1 MiB를 넘습니다. 앱 정의를 줄여 다시 올리세요.", fix: "app.json을 1 MiB 이하로 줄이세요" }
    STORESERVER_PUBLISH_METADATA_TOO_LARGE() { class: InvalidRequest, place: "스토어 메타 크기 검사", cause: "store.json이 256 KiB를 넘었다", message: "store.json이 256 KiB를 넘습니다. 스토어 설명을 줄여 다시 올리세요.", fix: "store.json을 256 KiB 이하로 줄이세요" }
    STORESERVER_PUBLISH_ASSETS_TOO_LARGE() { class: InvalidRequest, place: "게시 자산 크기 검사", cause: "자산 합이 10 MiB를 넘었다", message: "assets 파일의 합이 10 MiB를 넘습니다. 자산 크기를 줄여 다시 올리세요.", fix: "자산 합을 10 MiB 이하로 줄이세요" }
    STORESERVER_PUBLISH_SCREENSHOT_TOO_LARGE(path) { class: InvalidRequest, place: "게시 스크린샷 크기 검사", cause: "스크린샷이 2 MiB를 넘었다", message: "스크린샷 {path}이 2 MiB를 넘습니다. 그림 크기를 줄여 다시 올리세요.", fix: "스크린샷을 2 MiB 이하로 줄이세요" }
    STORESERVER_PUBLISH_APP_JSON_INVALID() { class: InvalidAppDefinition, place: "게시 앱 정의 해석", cause: "app.json이 UTF-8 JSON이 아니다", message: "app.json을 읽지 못했습니다. UTF-8 JSON 형식으로 고쳐 다시 올리세요.", fix: "app.json의 형식을 확인하세요" }
    STORESERVER_PUBLISH_METADATA_INVALID() { class: InvalidRequest, place: "스토어 메타 해석", cause: "JSON 또는 내부 필드 형식이 올바르지 않다", message: "store.json의 JSON 또는 내부 필드 형식이 올바르지 않습니다. 스토어 메타데이터를 확인하세요.", fix: "store.json의 형식을 확인하세요" }
    STORESERVER_PUBLISH_METADATA_FIELD_MISSING(field) { class: InvalidRequest, place: "스토어 메타 필수 필드 검사", cause: "필수 필드가 없다", message: "store.json에 필수 필드 {field}가 없습니다. 스토어 메타데이터에 추가하세요.", fix: "store.json에 필수 필드를 추가하세요" }
    STORESERVER_PUBLISH_METADATA_FIELD_UNKNOWN(field) { class: InvalidRequest, place: "스토어 메타 필드 목록 검사", cause: "알 수 없는 필드가 있다", message: "store.json의 {field} 필드는 사용할 수 없습니다. 스토어 메타데이터에서 제거하세요.", fix: "알 수 없는 필드를 제거하세요" }
    STORESERVER_PUBLISH_METADATA_FIELD_TYPE_INVALID(field) { class: InvalidRequest, place: "스토어 메타 필드 형식 검사", cause: "필드의 자료형이 다르다", message: "store.json의 {field} 필드 형식이 올바르지 않습니다. 스토어 메타데이터의 필드 형식을 확인하세요.", fix: "스토어 메타데이터의 필드 형식을 확인하세요" }
    STORESERVER_PUBLISH_METADATA_SUMMARY_INVALID() { class: InvalidRequest, place: "스토어 요약 검사", cause: "summary 길이가 범위 밖이다", message: "store.json의 summary는 1~80자여야 합니다. 요약을 고치세요.", fix: "summary를 1~80자로 고치세요" }
    STORESERVER_PUBLISH_METADATA_DESCRIPTION_INVALID() { class: InvalidRequest, place: "스토어 설명 검사", cause: "description이 너무 길다", message: "store.json의 description은 4000자 이하여야 합니다. 설명을 줄이세요.", fix: "description을 줄이세요" }
    STORESERVER_PUBLISH_METADATA_CATEGORY_INVALID() { class: InvalidRequest, place: "스토어 분류 검사", cause: "category 길이가 범위 밖이다", message: "store.json의 category는 1~24자여야 합니다. 분류를 고치세요.", fix: "category를 1~24자로 고치세요" }
    STORESERVER_PUBLISH_METADATA_PUBLISHER_INVALID() { class: InvalidRequest, place: "스토어 게시자 검사", cause: "publisher가 비었다", message: "store.json의 publisher가 비었습니다. 게시자 이름을 입력하세요.", fix: "publisher를 입력하세요" }
    STORESERVER_PUBLISH_BUILTIN_ID_FORBIDDEN(id) { class: InvalidRequest, place: "게시 앱 ID 검사", cause: "기본 앱 ID다", message: "app.json의 ID {id}는 기본 앱이 사용합니다. 다른 앱 ID를 쓰세요.", fix: "다른 앱 ID를 사용하세요" }
    STORESERVER_PUBLISH_APP_ID_INVALID() { class: InvalidRequest, place: "게시 앱 ID 검사", cause: "파일 경로로 쓸 수 없는 ID다", message: "app.json의 앱 ID 형식이 올바르지 않습니다. 영문자나 숫자로 시작하고 영문자, 숫자, 점, 밑줄, 하이픈만 쓰세요.", fix: "app.json의 ID를 고치세요" }
    STORESERVER_PUBLISH_ASSET_DECLARATION_MISMATCH() { class: InvalidRequest, place: "게시 자산 선언 검사", cause: "앱 정의와 자산이 일치하지 않는다", message: "app.json과 store.json의 자산 또는 아이콘 선언이 일치하지 않습니다. 두 파일과 assets를 확인하세요.", fix: "자산과 아이콘 선언을 맞추세요" }
    STORESERVER_PUBLISH_SCREENSHOT_COUNT_INVALID() { class: InvalidRequest, place: "게시 스크린샷 개수 검사", cause: "번호가 중복되거나 다섯 장을 넘었다", message: "screenshots는 번호마다 한 장씩 다섯 장까지 올릴 수 있습니다. 중복된 번호를 고치세요.", fix: "스크린샷 번호와 개수를 확인하세요" }
    STORESERVER_PUBLISH_SCREENSHOT_FORMAT_INVALID(path) { class: InvalidRequest, place: "게시 스크린샷 형식 검사", cause: "그림 형식이 확장자와 다르다", message: "스크린샷 {path}이 표시된 PNG 또는 WebP 형식이 아닙니다. 그림을 다시 저장하세요.", fix: "스크린샷 형식을 확인하세요" }
    STORESERVER_PUBLISH_SECRET_DETECTED() { class: InvalidRequest, place: "게시 비밀값 검사", cause: "파일에서 비밀값 패턴이 발견되었다", message: "게시할 앱 파일에 비밀값으로 보이는 문자열이 있습니다. 앱 폴더에서 해당 값을 지운 뒤 다시 올리세요.", fix: "앱 파일에서 비밀값을 제거하세요" }
    STORESERVER_PUBLISH_CONNECTION_INVALID() { class: InvalidRequest, place: "게시 연결 검사", cause: "연결 선언이 잘못되었거나 권한과 다르다", message: "store.json의 연결 주소, 경로 또는 이름이 app.json의 연결 권한과 맞지 않습니다. 연결 선언을 확인하세요.", fix: "연결 선언을 확인하세요" }
    STORESERVER_PUBLISH_STAGE_WRITE_FAILED() { class: Io, place: "게시 임시 파일 저장", cause: "임시 파일을 쓰지 못했다", message: "스토어 게시 임시 파일을 쓰지 못했습니다. 자료 폴더의 권한과 남은 공간을 확인하세요.", fix: "자료 폴더를 확인하세요" }
    STORESERVER_PUBLISH_RELEASE_COMMIT_FAILED() { class: Io, place: "게시 판 확정", cause: "판 폴더를 옮기지 못했다", message: "스토어 판 파일을 확정하지 못했습니다. 자료 폴더의 권한과 남은 공간을 확인하세요.", fix: "자료 폴더를 확인하세요" }
    STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED() { class: Io, place: "스토어 색인 저장", cause: "색인을 읽거나 쓰지 못했다", message: "스토어 색인을 갱신하지 못했습니다. 자료 폴더의 색인과 쓰기 권한을 확인하세요.", fix: "색인과 자료 폴더를 확인하세요" }
    STORESERVER_READ_PATH_INVALID() { class: InvalidRequest, place: "스토어 파일 경로 검사", cause: "허용 범위 밖의 경로다", message: "스토어 파일 경로가 올바르지 않습니다. 스토어 주소와 파일 경로를 확인하세요.", fix: "스토어 파일 경로를 확인하세요" }
    STORESERVER_READ_FILE_NOT_FOUND(path) { class: NotFound, place: "스토어 파일 읽기", cause: "파일이 없다", message: "스토어 파일 {path}을 찾지 못했습니다. 앱 ID와 판을 확인하세요.", fix: "앱 ID와 판을 확인하세요" }
    STORESERVER_READ_FILE_FAILED() { class: Io, place: "스토어 파일 읽기", cause: "파일을 읽지 못했다", message: "스토어 파일을 읽지 못했습니다. 자료 폴더의 읽기 권한을 확인하세요.", fix: "자료 폴더의 권한을 확인하세요" }
}
