error_catalog! { ENTRIES;
    MEDIA_STREAM_LISTEN_FAILED(reason) {
        class: Unavailable, place: "미디어 전송 소켓 시작", cause: "루프백 소켓을 열지 못했다",
        message: "이 PC에서 미디어 전송을 시작하지 못했습니다. 재생을 다시 시도해 주세요. 원인: {reason}",
        fix: "재생을 다시 시도하세요"
    }
    MEDIA_STREAM_RUNTIME_START_FAILED(reason) {
        class: Unavailable, place: "미디어 전송 실행기 시작", cause: "실행기를 만들지 못했다",
        message: "미디어 전송 실행기를 시작하지 못했습니다. 파일을 다시 열어 주세요. 원인: {reason}",
        fix: "파일을 다시 여세요"
    }
    MEDIA_STREAM_SERVER_STOPPED(reason) {
        class: Unavailable, place: "미디어 전송 서버", cause: "서버 실행이 중단됐다",
        message: "이 PC의 미디어 전송이 중단되었습니다. 쉘을 다시 시작해 주세요. 원인: {reason}",
        fix: "쉘을 다시 시작하세요"
    }
    MEDIA_STREAM_ORIGIN_NOT_CONFIGURED() {
        class: Unavailable, place: "미디어 전송 출처 설정", cause: "쉘 출처가 설정되지 않았다",
        message: "쉘에 미디어 전송 출처가 설정되지 않았습니다. 쉘을 다시 시작해 주세요.",
        fix: "쉘을 다시 시작하세요"
    }
    MEDIA_STREAM_ORIGIN_REJECTED() {
        class: PermissionDenied, place: "미디어 전송 출처 확인", cause: "요청 출처가 쉘 출처와 다르다",
        message: "이 페이지에는 폴더 미디어를 읽을 권한이 없습니다. 쉘의 재생 블록에서 열어 주세요.",
        fix: "쉘의 재생 블록에서 여세요"
    }
    MEDIA_STREAM_HANDLE_INVALID() {
        class: NotFound, place: "미디어 재생 정보 조회", cause: "재생 정보가 없거나 해제됐다",
        message: "이 파일의 재생 주소가 만료되었습니다. 파일을 다시 열어 주세요.",
        fix: "파일을 다시 여세요"
    }
    MEDIA_STREAM_HANDLE_OWNER_MISMATCH() {
        class: PermissionDenied, place: "미디어 재생 정보 소유 확인", cause: "다른 창의 재생 정보다",
        message: "다른 창의 재생 정보를 사용할 수 없습니다. 이 창에서 파일을 다시 열어 주세요.",
        fix: "이 창에서 파일을 다시 여세요"
    }
    MEDIA_STREAM_AUTHORITY_CHANGED() {
        class: Conflict, place: "미디어 전송 권한 재확인", cause: "창의 앱이나 폴더 권한 또는 연결이 바뀌었다",
        message: "파일을 읽던 권한이나 연결이 바뀌었습니다. 폴더를 다시 선택하고 파일을 열어 주세요.",
        fix: "폴더를 다시 선택하고 파일을 여세요"
    }
    MEDIA_STREAM_FILE_NOT_REGULAR(path) {
        class: InvalidRequest, place: "미디어 전송 파일 종류 확인", cause: "일반 파일이 아니다",
        message: "「{path}」은 재생할 파일이 아닙니다. 소리나 영상 파일을 골라 주세요.",
        fix: "소리나 영상 파일을 고르세요"
    }
    MEDIA_STREAM_FILE_CHANGED(path) {
        class: Conflict, place: "미디어 전송 파일 재확인", cause: "원본 파일이 바뀌었다",
        message: "재생하던 「{path}」 파일이 바뀌었습니다. 파일을 다시 열어 주세요.",
        fix: "파일을 다시 여세요"
    }
    MEDIA_STREAM_RANGE_INVALID() {
        class: InvalidRequest, place: "미디어 전송 구간 해석", cause: "구간 문법이나 숫자가 잘못됐다",
        message: "요청한 재생 구간을 읽을 수 없습니다. 파일을 다시 열어 주세요.",
        fix: "파일을 다시 여세요"
    }
    MEDIA_STREAM_RANGE_UNSATISFIABLE(path) {
        class: InvalidRequest, place: "미디어 전송 구간 확인", cause: "구간이 파일 범위 밖이다",
        message: "「{path}」에 요청한 재생 구간이 없습니다. 파일을 다시 열어 주세요.",
        fix: "파일을 다시 여세요"
    }
    MEDIA_STREAM_SEEK_FAILED(path, reason) {
        class: Io, place: "미디어 전송 파일 위치 이동", cause: "파일에서 요청한 위치로 이동하지 못했다",
        message: "「{path}」의 재생 위치로 이동하지 못했습니다. 파일을 다시 열어 주세요. 원인: {reason}",
        fix: "파일을 다시 여세요"
    }
    MEDIA_LOAD_OPTIONS_INVALID(media) {
        class: InvalidRequest,
        place: "앱 창의 미디어 불러오기",
        cause: "축소 크기가 0이다",
        message: "축소 크기가 0이라 미디어를 불러오지 못했습니다. 1 이상의 크기로 다시 요청하세요. 미디어: {media}",
        fix: "축소 크기를 1 이상으로 지정하세요"
    }
    MEDIA_LOAD_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 창의 미디어 불러오기",
        cause: "미디어를 요청한 창이 없다",
        message: "미디어를 요청한 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    MEDIA_LOAD_APP_DEFINITION_NOT_FOUND() {
        class: NotFound,
        place: "앱 창의 미디어 불러오기",
        cause: "창에 적용할 앱 정의가 없다",
        message: "이 창의 앱 정의가 이 쉘에 없어 미디어를 불러오지 못했습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    MEDIA_LOAD_ASSET_NOT_DECLARED(asset) {
        class: PermissionDenied,
        place: "앱 창의 미디어 자산 불러오기",
        cause: "앱 정의가 자산을 선언하지 않았다",
        message: "앱 정의에 미디어 자산 선언이 없습니다. 앱 정의에 자산을 선언하세요. 자산: {asset}",
        fix: "앱 정의의 자산 목록을 고치세요"
    }
    MEDIA_LOAD_ASSET_VERSION_MISMATCH(asset) {
        class: PermissionDenied,
        place: "앱 창의 미디어 자산 불러오기",
        cause: "요청한 자산 버전과 앱 정의의 버전이 다르다",
        message: "미디어 자산의 요청 판이 앱 정의와 달라 불러오지 못했습니다. 앱 정의에 등록된 판을 사용하세요. 자산: {asset}",
        fix: "앱 정의와 같은 자산 판을 요청하세요"
    }
    MEDIA_LOAD_BUNDLED_ASSET_MISSING(asset) {
        class: NotFound,
        place: "앱 창의 번들 미디어 자산 불러오기",
        cause: "등록된 번들 자산의 데이터가 없다",
        message: "번들 미디어 자산 데이터를 찾지 못했습니다. 앱에 포함된 자산 판을 확인하세요. 자산: {asset}",
        fix: "앱 정의의 번들 자산 판을 확인하세요"
    }
    MEDIA_LOAD_ASSET_DOWNLOAD_FAILED(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 다운로드",
        cause: "서버에서 자산을 받지 못했다",
        message: "미디어 자산을 서버에서 받지 못했습니다. 서버 연결을 확인한 뒤 다시 시도하세요. 자산: {asset}",
        fix: "서버 연결과 자산 등록 상태를 확인하세요"
    }
    MEDIA_LOAD_ASSET_DOWNLOAD_SEND_FAILED(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 다운로드 요청 전송",
        cause: "서버에 자산 다운로드 요청을 보내지 못했다",
        message: "미디어 자산 다운로드 요청을 서버에 보내지 못했습니다. 서버 연결을 확인한 뒤 다시 시도하세요. 자산: {asset}",
        fix: "서버 연결을 확인하세요"
    }
    MEDIA_LOAD_ASSET_DOWNLOAD_STATUS_REJECTED(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 다운로드 응답 확인",
        cause: "서버가 미디어 자산 다운로드 요청을 거절했다",
        message: "서버가 미디어 자산 다운로드 요청을 거절했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요. 자산: {asset}",
        fix: "서버에 등록된 자산 상태를 확인하세요"
    }
    MEDIA_LOAD_ASSET_DOWNLOAD_RESPONSE_READ_FAILED(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 다운로드 응답 읽기",
        cause: "서버 응답에서 자산 데이터를 읽지 못했다",
        message: "서버 응답에서 미디어 자산을 읽지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요. 자산: {asset}",
        fix: "다시 시도하고, 계속되면 서버 로그에서 이 오류 코드를 찾으세요"
    }
    MEDIA_LOAD_ASSET_HASH_MISMATCH(asset) {
        class: Server,
        place: "앱 창의 미디어 자산 무결성 확인",
        cause: "다운로드한 자산의 해시가 서버가 보낸 값과 다르다",
        message: "미디어 자산이 전송 중 바뀌어 불러오지 못했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요. 자산: {asset}",
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
        message: "앱 정의에 미디어 권한 선언이 없습니다. 앱 정의 permissions에 필요한 권한을 선언하세요. 권한: {permission}",
        fix: "앱 정의 permissions에 필요한 미디어 권한을 선언하세요"
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
        message: "공개 주소의 미디어 요청이 잠시 제한됐습니다. 잠시 뒤 다시 시도하세요. 미디어: {media}",
        fix: "잠시 기다린 뒤 다시 시도하세요"
    }
    MEDIA_LOAD_SOURCE_UNSUPPORTED(media) {
        class: PermissionDenied,
        place: "앱 창의 미디어 불러오기",
        cause: "미디어에 사용할 수 없는 권한 종류다",
        message: "이 권한 종류로는 미디어를 불러올 수 없습니다. 앱 정의에서 파일, 연결, 공개 HTTP 권한 가운데 하나를 쓰세요. 미디어: {media}",
        fix: "앱 정의에서 미디어 원천에 맞는 권한을 쓰세요"
    }
    MEDIA_LOAD_FILE_ROOT_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 폴더 확인",
        cause: "고른 폴더가 더 이상 없다",
        message: "선택한 폴더를 찾지 못해 미디어를 불러오지 못했습니다. 폴더를 다시 선택하세요. 파일: {media}",
        fix: "폴더를 다시 선택하세요"
    }
    MEDIA_LOAD_FILE_ROOT_ACCESS_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 폴더 확인",
        cause: "고른 폴더 정보를 읽지 못했다",
        message: "선택한 폴더 정보를 읽지 못해 미디어를 불러오지 못했습니다. 파일 관리자에서 폴더가 열리는지 확인하세요. 파일: {media}",
        fix: "파일 관리자에서 폴더가 열리는지 확인하세요"
    }
    MEDIA_LOAD_FILE_ROOT_INVALID(media) {
        class: PathOutsideRoot,
        place: "앱 창의 파일 미디어 폴더 확인",
        cause: "고른 폴더가 더 이상 유효한 폴더가 아니다",
        message: "선택한 폴더가 유효하지 않아 미디어를 불러오지 못했습니다. 폴더를 다시 선택하세요. 파일: {media}",
        fix: "폴더를 다시 선택하세요"
    }
    MEDIA_LOAD_FILE_PATH_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "고른 폴더 안에 요청한 경로가 없다",
        message: "미디어 파일을 찾지 못했습니다. 선택한 폴더에서 위치를 확인하세요. 파일: {media}",
        fix: "파일 위치와 이름을 확인하세요"
    }
    MEDIA_LOAD_FILE_PATH_OUTSIDE_ROOT(media) {
        class: PathOutsideRoot,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "미디어 경로가 고른 폴더 밖을 가리킨다",
        message: "미디어 파일 경로가 선택한 폴더 밖을 가리킵니다. 폴더 안의 파일을 선택하세요. 파일: {media}",
        fix: "선택한 폴더 안의 파일을 사용하세요"
    }
    MEDIA_LOAD_FILE_PATH_PROTECTED(media) {
        class: PermissionDenied,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "미디어 경로가 앱 데이터 폴더 안을 가리킨다",
        message: "쉘 데이터 폴더의 파일은 미디어로 불러올 수 없습니다. 선택한 폴더 안의 파일을 선택하세요. 파일: {media}",
        fix: "선택한 폴더 안의 파일을 사용하세요"
    }
    MEDIA_LOAD_FILE_PATH_RESOLVE_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "미디어 파일 경로를 확인하지 못했다",
        message: "미디어 파일 경로를 확인하지 못했습니다. 파일 관리자에서 열리는지 확인하세요. 파일: {media}",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    MEDIA_LOAD_FILE_PATH_BUSY(media) {
        class: FileBusy,
        place: "앱 창의 파일 미디어 경로 확인",
        cause: "다른 프로그램이 미디어 파일 경로를 사용 중이다",
        message: "다른 프로그램이 미디어 파일을 사용 중입니다. 사용 중인 프로그램을 닫고 다시 시도하세요. 파일: {media}",
        fix: "파일을 사용하는 프로그램을 닫으세요"
    }
    MEDIA_LOAD_FILE_METADATA_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 확인",
        cause: "미디어 파일이 없다",
        message: "미디어 파일을 찾지 못했습니다. 선택한 폴더에서 위치를 확인하세요. 파일: {media}",
        fix: "파일 위치와 이름을 확인하세요"
    }
    MEDIA_LOAD_FILE_METADATA_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 확인",
        cause: "파일 정보를 읽지 못했다",
        message: "미디어 파일 정보를 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요. 파일: {media}",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    MEDIA_LOAD_FILE_MODIFIED_TIME_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 변경 시각 확인",
        cause: "파일의 수정 시각을 읽지 못했다",
        message: "미디어 파일의 수정 시각을 확인하지 못했습니다. 파일을 다시 선택하세요. 파일: {media}",
        fix: "파일을 다시 선택하세요"
    }
    MEDIA_LOAD_FILE_MODIFIED_TIME_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 변경 시각 확인",
        cause: "수정 시각을 확인하는 동안 파일이 없어졌다",
        message: "미디어 파일이 사라져 수정 시각을 확인하지 못했습니다. 파일을 다시 선택하세요. 파일: {media}",
        fix: "파일을 다시 선택하세요"
    }
    MEDIA_LOAD_FILE_OPEN_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 열기",
        cause: "열려는 미디어 파일이 없다",
        message: "미디어 파일을 찾지 못해 열지 못했습니다. 선택한 폴더에서 위치를 확인하세요. 파일: {media}",
        fix: "파일 위치와 이름을 확인하세요"
    }
    MEDIA_LOAD_FILE_OPEN_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 열기",
        cause: "미디어 파일을 열지 못했다",
        message: "미디어 파일을 열지 못했습니다. 다른 프로그램에서 사용 중인지 확인하세요. 파일: {media}",
        fix: "파일을 사용하는 다른 프로그램을 닫고 다시 시도하세요"
    }
    MEDIA_LOAD_FILE_READ_NOT_FOUND(media) {
        class: NotFound,
        place: "앱 창의 파일 미디어 읽기",
        cause: "읽는 중 미디어 파일이 없어졌다",
        message: "미디어 파일을 읽는 중 파일이 사라졌습니다. 위치를 확인한 뒤 다시 시도하세요. 파일: {media}",
        fix: "파일 위치를 확인하세요"
    }
    MEDIA_LOAD_FILE_READ_FAILED(media) {
        class: Io,
        place: "앱 창의 파일 미디어 읽기",
        cause: "미디어 파일 내용을 읽지 못했다",
        message: "미디어 파일 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요. 파일: {media}",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    MEDIA_LOAD_CONNECTION_LOGIN_REQUIRED(media, connection) {
        class: NotGranted,
        place: "앱 창의 연결 미디어 요청",
        cause: "연결에 로그인하지 않았다",
        message: "미디어를 불러오려면 연결 로그인이 필요합니다. 연결에 로그인한 뒤 다시 시도하세요. 미디어: {media}, 연결: {connection}",
        fix: "연결에 로그인하세요"
    }
    MEDIA_LOAD_CONNECTION_RATE_LIMITED(media, connection) {
        class: Unavailable,
        place: "앱 창의 연결 미디어 요청",
        cause: "연결 서버가 요청 횟수 제한을 적용했다",
        message: "미디어 응답 요청이 잠시 제한됐습니다. 잠시 뒤 다시 시도하세요. 미디어: {media}, 연결: {connection}",
        fix: "잠시 기다린 뒤 다시 시도하세요"
    }
    MEDIA_LOAD_CONNECTION_RESPONSE_FAILED(media, connection) {
        class: Server,
        place: "앱 창의 연결 미디어 응답 확인",
        cause: "연결 서버가 미디어 요청을 실패로 응답했다",
        message: "연결된 서버가 미디어 요청을 거절했습니다. 잠시 뒤 다시 시도하고, 계속되면 에이전트에게 이 오류 코드를 전하세요. 미디어: {media}, 연결: {connection}",
        fix: "list_connections로 연결 설정을 확인하세요"
    }
    MEDIA_LOAD_HTTP_RESPONSE_FAILED(media) {
        class: Server,
        place: "앱 창의 공개 HTTP 미디어 응답 확인",
        cause: "공개 HTTP 서버가 미디어 요청을 실패로 응답했다",
        message: "공개 주소에서 미디어 응답을 받지 못했습니다. 앱 정의의 주소가 맞는지 확인하세요. 미디어: {media}",
        fix: "앱 정의의 공개 주소가 맞는지 확인하세요"
    }
    MEDIA_LOAD_CONNECTION_DATA_INVALID(media, connection) {
        class: Server,
        place: "앱 창의 연결 미디어 응답 해석",
        cause: "연결 서버의 미디어 본문을 이진 데이터로 읽지 못했다",
        message: "미디어 응답을 읽지 못했습니다. 서버 응답 형식을 확인하세요. 미디어: {media}, 연결: {connection}",
        fix: "서버의 미디어 응답 형식을 확인하세요"
    }
    MEDIA_LOAD_HTTP_DATA_INVALID(media) {
        class: Server,
        place: "앱 창의 공개 HTTP 미디어 응답 해석",
        cause: "공개 HTTP 미디어 본문을 이진 데이터로 읽지 못했다",
        message: "공개 주소의 미디어 응답을 읽지 못했습니다. 서버 응답 형식을 확인하세요. 미디어: {media}",
        fix: "서버의 미디어 응답 형식을 확인하세요"
    }
    MEDIA_LOAD_DATA_TOO_LARGE(limit, media) {
        class: Io,
        place: "앱 창의 미디어 크기 확인",
        cause: "미디어가 허용 크기를 넘었다",
        message: "미디어가 허용 크기 {limit}보다 커서 불러오지 못했습니다. 더 작은 파일이나 응답을 사용하세요. 미디어: {media}",
        fix: "미디어 크기를 줄이세요"
    }
    MEDIA_RESIZE_IMAGE_DECODE_FAILED(media) {
        class: Io,
        place: "앱 창의 미디어 축소",
        cause: "축소할 이미지 데이터를 해석하지 못했다",
        message: "이미지를 읽지 못해 미디어 크기를 조정하지 못했습니다. 이미지 파일을 확인하세요. 미디어: {media}",
        fix: "이미지 파일을 확인하세요"
    }
    MEDIA_RESIZE_PNG_ENCODE_FAILED(media) {
        class: Io,
        place: "앱 창의 투명 미디어 축소 결과 저장",
        cause: "축소한 투명 이미지를 PNG로 만들지 못했다",
        message: "미디어 축소 결과를 PNG 이미지로 만들지 못했습니다. 이미지 파일을 확인한 뒤 다시 시도하세요. 미디어: {media}",
        fix: "이미지 파일을 확인하세요"
    }
    MEDIA_RESIZE_JPEG_ENCODE_FAILED(media) {
        class: Io,
        place: "앱 창의 불투명 미디어 축소 결과 저장",
        cause: "축소한 이미지를 JPEG로 만들지 못했다",
        message: "미디어 축소 결과를 JPEG 이미지로 만들지 못했습니다. 이미지 파일을 확인한 뒤 다시 시도하세요. 미디어: {media}",
        fix: "이미지 파일을 확인하세요"
    }
}
