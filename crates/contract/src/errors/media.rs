error_catalog! { ENTRIES;
    MEDIA_LOAD_OPTIONS_INVALID(media) {
        class: InvalidRequest,
        place: "앱 창의 미디어 불러오기",
        cause: "축소 크기가 0이다",
        message: "축소 크기가 0이라 미디어를 불러오지 못했습니다. 대상 미디어: {media}. 1 이상의 크기로 다시 요청하세요.",
        fix: "축소 크기를 1 이상으로 지정하세요"
    }
    MEDIA_LOAD_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "앱 창의 미디어 불러오기",
        cause: "미디어를 요청한 창이 없다",
        message: "미디어를 요청한 창을 찾지 못했습니다. 창 ID: {window}. 창을 다시 연 뒤 시도하세요.",
        fix: "창을 다시 여세요"
    }
    MEDIA_LOAD_APP_DEFINITION_NOT_FOUND(window) {
        class: NotFound,
        place: "앱 창의 미디어 불러오기",
        cause: "창에 적용할 앱 정의가 없다",
        message: "앱 정의를 찾지 못해 미디어를 불러오지 못했습니다. 창 ID: {window}. 앱을 다시 불러온 뒤 시도하세요.",
        fix: "앱을 다시 불러오세요"
    }
    MEDIA_LOAD_ASSET_NOT_DECLARED(asset) {
        class: PermissionDenied,
        place: "앱 창의 미디어 자산 불러오기",
        cause: "앱 정의가 자산을 선언하지 않았다",
        message: "앱 정의에 미디어 자산 선언이 없습니다. 자산 ID: {asset}. 앱 정의에 자산을 선언하세요.",
        fix: "앱 정의의 자산 목록을 고치세요"
    }
    MEDIA_LOAD_ASSET_VERSION_MISMATCH(asset) {
        class: PermissionDenied,
        place: "앱 창의 미디어 자산 불러오기",
        cause: "요청한 자산 버전과 앱 정의의 버전이 다르다",
        message: "미디어 자산 요청 버전이 앱 정의와 달라 불러오지 못했습니다. 자산 ID: {asset}. 앱 정의에 등록된 버전을 사용하세요.",
        fix: "앱 정의와 같은 자산 버전을 요청하세요"
    }
    MEDIA_LOAD_BUNDLED_ASSET_MISSING(asset) {
        class: NotFound,
        place: "앱 창의 번들 미디어 자산 불러오기",
        cause: "등록된 번들 자산의 데이터가 없다",
        message: "번들 미디어 자산 데이터를 찾지 못했습니다. 자산 ID: {asset}. 앱에 포함된 자산 버전을 확인하세요.",
        fix: "앱 정의의 번들 자산 버전을 확인하세요"
    }
    MEDIA_LOAD_ASSET_DOWNLOAD_FAILED(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 다운로드",
        cause: "서버에서 자산을 받지 못했다",
        message: "미디어 자산을 서버에서 받지 못했습니다. 자산 ID: {asset}. 서버 연결과 자산 등록 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 연결과 자산 등록 상태를 확인하세요"
    }
    MEDIA_LOAD_ASSET_DOWNLOAD_SEND_FAILED(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 다운로드 요청 전송",
        cause: "서버에 자산 다운로드 요청을 보내지 못했다",
        message: "미디어 자산 다운로드 요청을 서버에 보내지 못했습니다. 자산 ID: {asset}. 서버 연결을 확인한 뒤 다시 시도하세요.",
        fix: "서버 연결을 확인하세요"
    }
    MEDIA_LOAD_ASSET_DOWNLOAD_STATUS_REJECTED(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 다운로드 응답 확인",
        cause: "서버가 미디어 자산 다운로드 요청을 거절했다",
        message: "서버가 미디어 자산 다운로드 요청을 거절했습니다. 자산 ID: {asset}. 서버에 등록된 자산 상태를 확인하세요.",
        fix: "서버에 등록된 자산 상태를 확인하세요"
    }
    MEDIA_LOAD_ASSET_DOWNLOAD_RESPONSE_READ_FAILED(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 다운로드 응답 읽기",
        cause: "서버 응답에서 자산 데이터를 읽지 못했다",
        message: "서버 응답에서 미디어 자산을 읽지 못했습니다. 자산 ID: {asset}. 다시 시도하고 문제가 계속되면 서버 상태를 확인하세요.",
        fix: "다시 시도한 뒤 서버 상태를 확인하세요"
    }
    MEDIA_LOAD_ASSET_HASH_MISMATCH(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 무결성 확인",
        cause: "다운로드한 자산의 해시가 서버가 보낸 값과 다르다",
        message: "미디어 자산이 전송 중 바뀌어 불러오지 못했습니다. 자산 ID: {asset}. 서버에 등록된 자산을 확인한 뒤 다시 시도하세요.",
        fix: "서버에 등록된 자산을 확인하세요"
    }
    MEDIA_LOAD_SERVER_NOT_CONNECTED() {
        class: Server,
        place: "앱 창의 미디어 불러오기",
        cause: "서버 연결이 완료되지 않아 미디어 자산을 받을 수 없다",
        message: "kaleidoscope 서버에 연결되어 있지 않아 미디어를 불러올 수 없습니다. 서버를 연결한 뒤 다시 시도하세요.",
        fix: "쉘의 「서버 연결」에서 서버를 연결하세요"
    }
    MEDIA_LOAD_PERMISSION_NOT_DECLARED(permission) {
        class: PermissionDenied,
        place: "앱 창의 미디어 권한 확인",
        cause: "앱 정의가 미디어 원천 권한을 선언하지 않았다",
        message: "앱 정의에 미디어 권한 선언이 없습니다. 권한 ID: {permission}. 앱 정의에 필요한 권한을 선언하세요.",
        fix: "앱 정의에 필요한 미디어 권한을 선언하세요"
    }
    MEDIA_LOAD_HTTP_PATH_FORBIDDEN(media) {
        class: PermissionDenied,
        place: "앱 창의 공개 HTTP 미디어 불러오기",
        cause: "요청 경로가 공개 HTTP 권한의 허용 목록에 없다",
        message: "미디어 {media} 경로가 앱의 공개 HTTP 허용 목록에 없어 불러오지 못했습니다. 앱 정의의 허용 경로를 고치세요.",
        fix: "앱 정의에 미디어 경로를 허용하세요"
    }
    MEDIA_LOAD_HTTP_RATE_LIMITED(media) {
        class: Unavailable,
        place: "앱 창의 공개 HTTP 미디어 요청",
        cause: "공개 HTTP 서버가 요청 횟수 제한을 적용했다",
        message: "공개 주소의 미디어 요청이 잠시 제한됐습니다. 대상 미디어: {media}. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 기다린 뒤 다시 시도하세요"
    }
    MEDIA_LOAD_SOURCE_UNSUPPORTED(media) {
        class: PermissionDenied,
        place: "앱 창의 미디어 불러오기",
        cause: "미디어에 사용할 수 없는 권한 종류다",
        message: "이 권한 종류로는 미디어를 불러올 수 없습니다. 대상: {media}. 파일, 연결 또는 공개 HTTP 권한을 사용하세요.",
        fix: "미디어 원천에 맞는 권한을 사용하세요"
    }
    MEDIA_LOAD_FILE_ROOT_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 폴더 확인",
        cause: "고른 폴더가 더 이상 없다",
        message: "고른 폴더를 찾지 못해 미디어를 불러오지 못했습니다. 파일 이름: {media}. 폴더를 다시 선택하세요.",
        fix: "파일 권한에서 폴더를 다시 선택하세요"
    }
    MEDIA_LOAD_FILE_ROOT_ACCESS_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 폴더 확인",
        cause: "고른 폴더 정보를 읽지 못했다",
        message: "고른 폴더 정보를 읽지 못해 미디어를 불러오지 못했습니다. 파일 이름: {media}. 폴더 접근 권한을 확인하세요.",
        fix: "폴더 접근 권한을 확인하세요"
    }
    MEDIA_LOAD_FILE_ROOT_INVALID(media) {
        class: PathOutsideRoot,
        place: "앱 창의 파일 미디어 폴더 확인",
        cause: "고른 폴더가 더 이상 유효한 폴더가 아니다",
        message: "고른 폴더가 유효하지 않아 미디어를 불러오지 못했습니다. 파일 이름: {media}. 폴더를 다시 선택하세요.",
        fix: "파일 권한에서 폴더를 다시 선택하세요"
    }
    MEDIA_LOAD_FILE_PATH_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "고른 폴더 안에 요청한 경로가 없다",
        message: "미디어 파일을 찾지 못했습니다. 파일 이름: {media}. 고른 폴더에서 위치를 확인하세요.",
        fix: "파일 위치와 이름을 확인하세요"
    }
    MEDIA_LOAD_FILE_PATH_OUTSIDE_ROOT(media) {
        class: PathOutsideRoot,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "미디어 경로가 고른 폴더 밖을 가리킨다",
        message: "미디어 파일 경로가 고른 폴더 밖을 가리킵니다. 파일 이름: {media}. 폴더 안의 파일을 선택하세요.",
        fix: "고른 폴더 안의 파일을 사용하세요"
    }
    MEDIA_LOAD_FILE_PATH_PROTECTED(media) {
        class: PermissionDenied,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "미디어 경로가 앱 데이터 폴더 안을 가리킨다",
        message: "앱 데이터 폴더의 파일은 미디어로 불러올 수 없습니다. 파일 이름: {media}. 고른 폴더 안의 파일을 선택하세요.",
        fix: "고른 폴더 안의 파일을 사용하세요"
    }
    MEDIA_LOAD_FILE_PATH_RESOLVE_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "미디어 파일 경로를 확인하지 못했다",
        message: "미디어 파일 경로를 확인하지 못했습니다. 파일 이름: {media}. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    MEDIA_LOAD_FILE_PATH_BUSY(media) {
        class: FileBusy,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "다른 프로그램이 미디어 파일 경로를 사용 중이다",
        message: "다른 프로그램이 미디어 파일을 사용 중입니다. 파일 이름: {media}. 사용 중인 프로그램을 닫고 다시 시도하세요.",
        fix: "파일을 사용하는 프로그램을 닫으세요"
    }
    MEDIA_LOAD_FILE_METADATA_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 확인",
        cause: "미디어 파일이 없다",
        message: "미디어 파일을 찾지 못했습니다. 파일 이름: {media}. 고른 폴더에서 위치를 확인하세요.",
        fix: "파일 위치와 이름을 확인하세요"
    }
    MEDIA_LOAD_FILE_METADATA_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 확인",
        cause: "파일 정보를 읽지 못했다",
        message: "미디어 파일 정보를 읽지 못했습니다. 파일 이름: {media}. 접근 권한을 확인한 뒤 다시 시도하세요.",
        fix: "파일 접근 권한을 확인하세요"
    }
    MEDIA_LOAD_FILE_MODIFIED_TIME_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 변경 시각 확인",
        cause: "파일의 수정 시각을 읽지 못했다",
        message: "미디어 파일의 수정 시각을 확인하지 못했습니다. 파일 이름: {media}. 파일을 다시 선택하세요.",
        fix: "파일을 다시 선택하세요"
    }
    MEDIA_LOAD_FILE_MODIFIED_TIME_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 변경 시각 확인",
        cause: "수정 시각을 확인하는 동안 파일이 없어졌다",
        message: "미디어 파일이 사라져 수정 시각을 확인하지 못했습니다. 파일 이름: {media}. 파일을 다시 선택하세요.",
        fix: "파일을 다시 선택하세요"
    }
    MEDIA_LOAD_FILE_OPEN_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 열기",
        cause: "열려는 미디어 파일이 없다",
        message: "미디어 파일을 찾지 못해 열지 못했습니다. 파일 이름: {media}. 고른 폴더에서 위치를 확인하세요.",
        fix: "파일 위치와 이름을 확인하세요"
    }
    MEDIA_LOAD_FILE_OPEN_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 열기",
        cause: "미디어 파일을 열지 못했다",
        message: "미디어 파일을 열지 못했습니다. 파일 이름: {media}. 다른 프로그램에서 사용 중인지 확인하세요.",
        fix: "파일을 사용하는 다른 프로그램을 닫고 다시 시도하세요"
    }
    MEDIA_LOAD_FILE_READ_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 읽기",
        cause: "읽는 중 미디어 파일이 없어졌다",
        message: "미디어 파일을 읽는 중 파일이 사라졌습니다. 파일 이름: {media}. 위치를 확인한 뒤 다시 시도하세요.",
        fix: "파일 위치를 확인하세요"
    }
    MEDIA_LOAD_FILE_READ_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 읽기",
        cause: "미디어 파일 내용을 읽지 못했다",
        message: "미디어 파일 내용을 읽지 못했습니다. 파일 이름: {media}. 접근 권한과 상태를 확인하세요.",
        fix: "파일 접근 권한과 상태를 확인하세요"
    }
    MEDIA_LOAD_CONNECTION_LOGIN_REQUIRED(media, connection) {
        class: NotGranted,
        place: "앱 창의 연결 미디어 요청",
        cause: "연결에 로그인하지 않았다",
        message: "미디어를 불러오려면 연결 로그인이 필요합니다. 대상 미디어: {media}. 연결 이름: {connection}. 연결에 로그인한 뒤 다시 시도하세요.",
        fix: "연결에 로그인하세요"
    }
    MEDIA_LOAD_CONNECTION_RATE_LIMITED(media, connection) {
        class: Unavailable,
        place: "앱 창의 연결 미디어 요청",
        cause: "연결 서버가 요청 횟수 제한을 적용했다",
        message: "미디어 응답 요청이 잠시 제한됐습니다. 대상 미디어: {media}. 연결 이름: {connection}. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 기다린 뒤 다시 시도하세요"
    }
    MEDIA_LOAD_CONNECTION_RESPONSE_FAILED(media, connection) {
        class: Server,
        place: "앱 창의 연결 미디어 응답 확인",
        cause: "연결 서버가 미디어 요청을 실패로 응답했다",
        message: "미디어 응답 요청이 실패했습니다. 대상 미디어: {media}. 연결 이름: {connection}. 연결 설정과 서버 상태를 확인하세요.",
        fix: "연결 설정과 서버 상태를 확인하세요"
    }
    MEDIA_LOAD_HTTP_RESPONSE_FAILED(media) {
        class: Server,
        place: "앱 창의 공개 HTTP 미디어 응답 확인",
        cause: "공개 HTTP 서버가 미디어 요청을 실패로 응답했다",
        message: "공개 주소에서 미디어 응답을 받지 못했습니다. 대상 미디어: {media}. 주소와 서버 상태를 확인하세요.",
        fix: "공개 주소와 서버 상태를 확인하세요"
    }
    MEDIA_LOAD_CONNECTION_DATA_INVALID(media, connection) {
        class: Server,
        place: "앱 창의 연결 미디어 응답 해석",
        cause: "연결 서버의 미디어 본문을 이진 데이터로 읽지 못했다",
        message: "미디어 응답을 읽지 못했습니다. 대상 미디어: {media}. 연결 이름: {connection}. 서버 응답 형식을 확인하세요.",
        fix: "서버의 미디어 응답 형식을 확인하세요"
    }
    MEDIA_LOAD_HTTP_DATA_INVALID(media) {
        class: Server,
        place: "앱 창의 공개 HTTP 미디어 응답 해석",
        cause: "공개 HTTP 미디어 본문을 이진 데이터로 읽지 못했다",
        message: "공개 주소의 미디어 응답을 읽지 못했습니다. 대상 미디어: {media}. 서버 응답 형식을 확인하세요.",
        fix: "서버의 미디어 응답 형식을 확인하세요"
    }
    MEDIA_LOAD_DATA_TOO_LARGE(media) {
        class: Io,
        place: "앱 창의 미디어 크기 확인",
        cause: "미디어가 허용 크기를 넘었다",
        message: "미디어가 허용된 크기를 넘어 불러오지 못했습니다. 대상 미디어: {media}. 더 작은 파일이나 응답을 사용하세요.",
        fix: "미디어 크기를 줄이세요"
    }
    MEDIA_RESIZE_IMAGE_DECODE_FAILED(media) {
        class: Io,
        place: "앱 창의 미디어 축소",
        cause: "축소할 이미지 데이터를 해석하지 못했다",
        message: "이미지를 읽지 못해 미디어 크기를 조정하지 못했습니다. 대상 미디어: {media}. 이미지 파일을 확인하세요.",
        fix: "이미지 파일을 확인하세요"
    }
    MEDIA_RESIZE_PNG_ENCODE_FAILED(media) {
        class: Io,
        place: "앱 창의 투명 미디어 축소 결과 저장",
        cause: "축소한 투명 이미지를 PNG로 만들지 못했다",
        message: "미디어 축소 결과를 PNG 이미지로 만들지 못했습니다. 대상 미디어: {media}. 이미지 파일을 확인한 뒤 다시 시도하세요.",
        fix: "이미지 파일을 확인하세요"
    }
    MEDIA_RESIZE_JPEG_ENCODE_FAILED(media) {
        class: Io,
        place: "앱 창의 불투명 미디어 축소 결과 저장",
        cause: "축소한 이미지를 JPEG로 만들지 못했다",
        message: "미디어 축소 결과를 JPEG 이미지로 만들지 못했습니다. 대상 미디어: {media}. 이미지 파일을 확인한 뒤 다시 시도하세요.",
        fix: "이미지 파일을 확인하세요"
    }
}
