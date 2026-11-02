error_catalog! { ENTRIES;
    ASSET_UPLOAD_ID_EMPTY() {
        class: InvalidRequest,
        place: "자산 업로드 검사",
        cause: "자산 ID가 비어 있다",
        message: "자산 ID가 비어 있어 등록하지 못했습니다. ID를 입력한 뒤 다시 올리세요.",
        fix: "자산 ID를 입력하세요"
    }
    ASSET_UPLOAD_ID_TOO_LONG() {
        class: InvalidRequest,
        place: "자산 업로드 검사",
        cause: "자산 ID가 허용 길이를 넘었다",
        message: "자산 ID가 64자를 넘어 등록하지 못했습니다. 64자 이하로 줄여 다시 올리세요.",
        fix: "자산 ID를 64자 이하로 줄이세요"
    }
    ASSET_UPLOAD_ID_INVALID() {
        class: InvalidRequest,
        place: "자산 업로드 검사",
        cause: "자산 ID에 허용하지 않는 문자가 있다",
        message: "자산 ID에는 영문 소문자, 숫자, 하이픈만 쓸 수 있습니다. ID를 고쳐 다시 올리세요.",
        fix: "자산 ID의 문자를 고치세요"
    }
    ASSET_UPLOAD_ID_RESERVED() {
        class: InvalidRequest,
        place: "자산 업로드 검사",
        cause: "자산 ID가 번들 자산 전용 이름을 사용한다",
        message: "자산 ID가 번들 자산 이름과 겹쳐 등록하지 못했습니다. 다른 ID를 사용하세요.",
        fix: "builtin-으로 시작하지 않는 ID를 사용하세요"
    }
    ASSET_UPLOAD_VERSION_INVALID() {
        class: InvalidRequest,
        place: "자산 업로드 검사",
        cause: "자산 버전이 0이다",
        message: "자산 버전은 1 이상이어야 합니다. 버전을 고쳐 다시 올리세요.",
        fix: "자산 버전을 1 이상으로 지정하세요"
    }
    ASSET_UPLOAD_SOURCE_REQUIRED() {
        class: InvalidRequest,
        place: "자산 업로드 검사",
        cause: "자산 출처가 비어 있다",
        message: "자산 출처를 입력하지 않아 등록하지 못했습니다. 출처를 적어 다시 올리세요.",
        fix: "자산 출처를 입력하세요"
    }
    ASSET_UPLOAD_LICENSE_REQUIRED() {
        class: InvalidRequest,
        place: "자산 업로드 검사",
        cause: "자산 라이선스가 비어 있다",
        message: "자산 라이선스를 입력하지 않아 등록하지 못했습니다. 라이선스를 적어 다시 올리세요.",
        fix: "자산 라이선스를 입력하세요"
    }
    ASSET_UPLOAD_ENCODING_TOO_LARGE(asset) {
        class: InvalidRequest,
        place: "자산 업로드 크기 검사",
        cause: "인코딩된 자산 데이터가 허용 크기를 넘었다",
        message: "인코딩 데이터가 허용 크기를 넘어 등록하지 못했습니다. 자산 ID: {asset}. 파일 크기를 줄이세요.",
        fix: "자산 파일 크기를 줄이세요"
    }
    ASSET_UPLOAD_ENCODING_INVALID(asset) {
        class: InvalidRequest,
        place: "자산 업로드 데이터 해석",
        cause: "자산 데이터가 Base64 형식이 아니다",
        message: "데이터가 Base64 형식이 아니어서 자산을 등록하지 못했습니다. 자산 ID: {asset}. 파일을 다시 인코딩해 올리세요.",
        fix: "자산 데이터를 Base64로 인코딩하세요"
    }
    ASSET_UPLOAD_BYTES_TOO_LARGE(asset) {
        class: InvalidRequest,
        place: "자산 업로드 크기 검사",
        cause: "디코딩한 자산 데이터가 허용 크기를 넘었다",
        message: "파일 크기가 허용 범위를 넘어 자산을 등록하지 못했습니다. 자산 ID: {asset}. 더 작은 파일을 올리세요.",
        fix: "자산 파일 크기를 줄이세요"
    }
    ASSET_UPLOAD_HASH_MISMATCH(asset) {
        class: InvalidRequest,
        place: "자산 업로드 무결성 검사",
        cause: "자산 데이터의 SHA-256 값이 업로드 값과 다르다",
        message: "SHA-256 값이 데이터와 맞지 않아 자산을 등록하지 못했습니다. 자산 ID: {asset}. 해시를 다시 계산하세요.",
        fix: "자산 데이터의 SHA-256 값을 다시 계산하세요"
    }
    ASSET_UPLOAD_JAVASCRIPT_ENCODING_INVALID(asset) {
        class: InvalidRequest,
        place: "JavaScript 자산 검사",
        cause: "JavaScript 자산이 UTF-8 텍스트가 아니다",
        message: "JavaScript 자산을 UTF-8 텍스트로 읽지 못했습니다. 자산 ID: {asset}. 파일 인코딩을 고쳐 다시 올리세요.",
        fix: "JavaScript 파일을 UTF-8로 저장하세요"
    }
    ASSET_UPLOAD_FONT_FORMAT_MISMATCH(asset, format) {
        class: InvalidRequest,
        place: "폰트 자산 검사",
        cause: "폰트 파일의 서명이 선언한 형식과 다르다",
        message: "폰트 데이터가 선언한 형식과 맞지 않습니다. 자산 ID: {asset}. 선언된 형식: {format}. 형식이 맞는 파일을 올리세요.",
        fix: "선언한 형식과 같은 폰트 파일을 올리세요"
    }
    ASSET_UPLOAD_HTML_ENCODING_INVALID(asset) {
        class: InvalidRequest,
        place: "HTML 자산 검사",
        cause: "HTML 자산이 UTF-8 텍스트가 아니다",
        message: "HTML 자산을 UTF-8 텍스트로 읽지 못했습니다. 자산 ID: {asset}. 파일 인코딩을 고쳐 다시 올리세요.",
        fix: "HTML 파일을 UTF-8로 저장하세요"
    }
    ASSET_UPLOAD_HTML_EMPTY(asset) {
        class: InvalidRequest,
        place: "HTML 자산 검사",
        cause: "HTML 자산에 내용이 없다",
        message: "HTML 자산에 내용이 없어 등록하지 못했습니다. 자산 ID: {asset}. 페이지 내용을 넣어 다시 올리세요.",
        fix: "HTML 내용을 입력하세요"
    }
    ASSET_UPLOAD_SVG_ENCODING_INVALID(asset) {
        class: InvalidRequest,
        place: "SVG 자산 검사",
        cause: "SVG 자산이 UTF-8 텍스트가 아니다",
        message: "SVG 자산을 UTF-8 텍스트로 읽지 못했습니다. 자산 ID: {asset}. 파일 인코딩을 고쳐 다시 올리세요.",
        fix: "SVG 파일을 UTF-8로 저장하세요"
    }
    ASSET_UPLOAD_SVG_XML_INVALID(asset) {
        class: InvalidRequest,
        place: "SVG 자산 XML 검사",
        cause: "SVG 문서가 올바른 XML 형식이 아니다",
        message: "SVG 자산의 XML을 읽지 못했습니다. 자산 ID: {asset}. XML 문법을 고쳐 다시 올리세요.",
        fix: "SVG XML 문법을 고치세요"
    }
    ASSET_UPLOAD_SVG_ROOT_INVALID(asset) {
        class: InvalidRequest,
        place: "SVG 자산 루트 검사",
        cause: "SVG 문서의 첫 요소가 svg가 아니다",
        message: "SVG 자산에 svg 루트 요소가 없습니다. 자산 ID: {asset}. 루트 요소를 고쳐 다시 올리세요.",
        fix: "문서 첫 요소를 svg로 고치세요"
    }
    ASSET_UPLOAD_SVG_MULTIPLE_ROOTS(asset) {
        class: InvalidRequest,
        place: "SVG 자산 루트 검사",
        cause: "SVG 문서에 최상위 요소가 여럿 있다",
        message: "SVG 자산에 최상위 요소가 여럿 있습니다. 자산 ID: {asset}. 하나의 svg 요소 안에 내용을 넣으세요.",
        fix: "모든 SVG 내용을 하나의 svg 요소에 넣으세요"
    }
    ASSET_UPLOAD_SVG_ELEMENT_FORBIDDEN(asset) {
        class: InvalidRequest,
        place: "SVG 자산 요소 검사",
        cause: "SVG에 실행되거나 삽입되는 허용하지 않은 요소가 있다",
        message: "SVG 자산에 허용하지 않는 실행 요소가 있습니다. 자산 ID: {asset}. 해당 요소를 제거하세요.",
        fix: "SVG에서 실행 요소를 제거하세요"
    }
    ASSET_UPLOAD_SVG_ATTRIBUTE_FORBIDDEN(asset) {
        class: InvalidRequest,
        place: "SVG 자산 속성 검사",
        cause: "SVG 속성에 실행 가능한 값이 있다",
        message: "SVG 자산에 실행 가능한 속성이 있습니다. 자산 ID: {asset}. 스크립트와 외부 주소를 제거하세요.",
        fix: "SVG에서 실행 가능한 속성을 제거하세요"
    }
    ASSET_UPLOAD_SVG_EXTERNAL_REFERENCE(asset) {
        class: InvalidRequest,
        place: "SVG 자산 참조 검사",
        cause: "SVG가 문서 밖의 자원을 참조한다",
        message: "SVG 자산이 외부 자원을 참조합니다. 자산 ID: {asset}. 문서 안의 요소만 참조하도록 고치세요.",
        fix: "SVG 외부 참조를 내부 조각 참조로 바꾸세요"
    }
    ASSET_UPLOAD_SVG_DECLARATION_FORBIDDEN(asset) {
        class: InvalidRequest,
        place: "SVG 자산 선언 검사",
        cause: "SVG에 외부 선언이 있다",
        message: "SVG 자산에 허용하지 않는 외부 선언이 있습니다. 자산 ID: {asset}. 외부 선언을 제거하세요.",
        fix: "SVG에서 외부 선언을 제거하세요"
    }
    ASSET_UPLOAD_SVG_STRUCTURE_INVALID(asset) {
        class: InvalidRequest,
        place: "SVG 자산 구조 검사",
        cause: "SVG 요소의 열고 닫는 구조가 맞지 않는다",
        message: "SVG 자산의 요소 구조가 완전하지 않습니다. 자산 ID: {asset}. 태그 짝을 고쳐 다시 올리세요.",
        fix: "SVG의 여는 태그와 닫는 태그를 맞추세요"
    }
    ASSET_UPLOAD_IMAGE_FORMAT_MISMATCH(asset, format) {
        class: InvalidRequest,
        place: "이미지 자산 형식 검사",
        cause: "이미지 파일 형식이 선언한 형식과 다르다",
        message: "이미지 데이터가 선언한 형식과 맞지 않습니다. 자산 ID: {asset}. 선언된 형식: {format}. 형식이 맞는 파일을 올리세요.",
        fix: "선언한 형식과 같은 이미지 파일을 올리세요"
    }
    ASSET_UPLOAD_IMAGE_DECODE_FAILED(asset, format) {
        class: InvalidRequest,
        place: "이미지 자산 디코딩",
        cause: "이미지 파일의 내용을 읽지 못했다",
        message: "이미지 자산을 선언한 그림 형식으로 읽지 못했습니다. 자산 ID: {asset}. 형식: {format}. 파일이 손상되지 않았는지 확인하세요.",
        fix: "이미지 파일을 확인하세요"
    }
    ASSET_REGISTER_VERSION_CONFLICT(asset, version) {
        class: Conflict,
        place: "자산 버전 등록",
        cause: "이미 등록된 ID와 버전에 다른 자산 내용이 올라왔다",
        message: "같은 자산 ID와 판에 다른 내용이 이미 등록되어 있습니다. 자산 ID: {asset}. 판: {version}. 새 판을 사용하세요.",
        fix: "새 자산 버전을 등록하세요"
    }
    ASSET_REGISTER_TRANSACTION_BEGIN_FAILED(asset) {
        class: Server,
        place: "자산 등록 트랜잭션 시작",
        cause: "자산 등록을 위한 데이터베이스 트랜잭션을 열지 못했다",
        message: "미디어 자산 등록을 시작하지 못했습니다. 자산 ID: {asset}. 잠시 뒤 다시 올리세요.",
        fix: "잠시 뒤 자산을 다시 올리세요"
    }
    ASSET_REGISTER_TRANSACTION_COMMIT_FAILED(asset) {
        class: Server,
        place: "자산 등록 트랜잭션 저장",
        cause: "자산 등록 트랜잭션을 저장하지 못했다",
        message: "미디어 자산 등록을 저장하지 못했습니다. 자산 ID: {asset}. 자산 목록을 확인한 뒤 다시 올리세요.",
        fix: "자산 목록을 확인한 뒤 다시 올리세요"
    }
    ASSET_REGISTER_EXISTING_LOOKUP_FAILED(asset, version) {
        class: Server,
        place: "자산 등록 중 기존 판 조회",
        cause: "같은 자산 판이 등록되어 있는지 확인하지 못했다",
        message: "같은 자산 ID와 판의 기존 등록을 확인하지 못했습니다. 자산 ID: {asset}. 판: {version}. 잠시 뒤 다시 올리세요.",
        fix: "잠시 뒤 자산을 다시 올리세요"
    }
    ASSET_REGISTER_INSERT_FAILED(asset, version) {
        class: Server,
        place: "자산 버전 데이터 저장",
        cause: "미디어 자산 데이터를 데이터베이스에 넣지 못했다",
        message: "미디어 자산 데이터를 저장하지 못했습니다. 자산 ID: {asset}. 판: {version}. 잠시 뒤 다시 올리세요.",
        fix: "잠시 뒤 자산을 다시 올리세요"
    }
    ASSET_LIST_PREPARE_FAILED() {
        class: Server,
        place: "자산 목록 조회 준비",
        cause: "자산 목록 조회를 준비하지 못했다",
        message: "자산 목록 조회를 준비하지 못했습니다. 잠시 뒤 다시 불러오세요.",
        fix: "잠시 뒤 자산 목록을 다시 불러오세요"
    }
    ASSET_LIST_QUERY_FAILED() {
        class: Server,
        place: "자산 목록 조회 실행",
        cause: "데이터베이스에서 자산 목록을 가져오지 못했다",
        message: "데이터베이스에서 자산 목록을 가져오지 못했습니다. 잠시 뒤 다시 불러오세요.",
        fix: "잠시 뒤 자산 목록을 다시 불러오세요"
    }
    ASSET_LIST_ROW_READ_FAILED() {
        class: Server,
        place: "자산 목록 항목 읽기",
        cause: "데이터베이스에서 자산 목록 항목을 읽지 못했다",
        message: "자산 목록 항목을 읽지 못했습니다. 잠시 뒤 다시 불러오세요.",
        fix: "잠시 뒤 자산 목록을 다시 불러오세요"
    }
    ASSET_APP_DEPENDENCY_LOOKUP_FAILED(asset, version) {
        class: Server,
        place: "앱 등록 중 자산 의존성 조회",
        cause: "앱이 참조하는 자산 판을 데이터베이스에서 확인하지 못했다",
        message: "앱이 참조하는 자산을 확인하지 못했습니다. 자산 ID: {asset}. 판: {version}. 잠시 뒤 앱을 다시 올리세요.",
        fix: "잠시 뒤 앱을 다시 올리세요"
    }
    ASSET_APP_CLIENT_ENTRY_LOOKUP_FAILED(asset, version) {
        class: Server,
        place: "앱 등록 중 클라이언트 진입 자산 조회",
        cause: "클라이언트 진입 자산 판을 데이터베이스에서 확인하지 못했다",
        message: "앱 클라이언트 진입 자산을 확인하지 못했습니다. 자산 ID: {asset}. 판: {version}. 잠시 뒤 앱을 다시 올리세요.",
        fix: "잠시 뒤 앱을 다시 올리세요"
    }
    ASSET_DOWNLOAD_LOOKUP_FAILED(asset, version) {
        class: Server,
        place: "기기의 자산 다운로드 항목 조회",
        cause: "다운로드할 자산 판을 데이터베이스에서 읽지 못했다",
        message: "다운로드할 자산을 읽지 못했습니다. 자산 ID: {asset}. 판: {version}. 잠시 뒤 다시 요청하세요.",
        fix: "잠시 뒤 자산을 다시 요청하세요"
    }
    ASSET_TRANSFER_LOOKUP_FAILED(asset, version) {
        class: Server,
        place: "가져올 자산의 기존 판 조회",
        cause: "자산을 가져오기 전에 기존 판을 확인하지 못했다",
        message: "가져올 자산의 기존 등록을 확인하지 못했습니다. 자산 ID: {asset}. 판: {version}. 잠시 뒤 다시 가져오세요.",
        fix: "잠시 뒤 자산을 다시 가져오세요"
    }
    ASSET_APP_DEPENDENCY_NOT_FOUND(asset, version) {
        class: InvalidAppDefinition,
        place: "앱 정의의 자산 의존성 확인",
        cause: "앱 정의가 등록되지 않은 자산 버전을 참조한다",
        message: "앱 정의가 참조하는 자산이 등록되어 있지 않습니다. 자산 ID: {asset}. 판: {version}. 자산을 등록한 뒤 다시 올리세요.",
        fix: "앱이 참조하는 자산 버전을 등록하세요"
    }
    ASSET_APP_CLIENT_ENTRY_NOT_FOUND(asset, version) {
        class: InvalidAppDefinition,
        place: "앱 클라이언트 진입 자산 확인",
        cause: "클라이언트 진입 자산이 등록되지 않았다",
        message: "앱 클라이언트 진입 자산을 찾지 못했습니다. 자산 ID: {asset}. 판: {version}. 자산을 등록한 뒤 다시 올리세요.",
        fix: "클라이언트 진입 자산을 등록하세요"
    }
    ASSET_APP_CLIENT_ENTRY_FORMAT_INVALID(asset, version) {
        class: InvalidAppDefinition,
        place: "앱 클라이언트 진입 자산 형식 확인",
        cause: "클라이언트 진입 자산이 JavaScript 형식이 아니다",
        message: "앱 클라이언트 진입 자산이 JavaScript 형식이 아닙니다. 자산 ID: {asset}. 판: {version}. JavaScript 자산을 지정하세요.",
        fix: "JavaScript 형식의 클라이언트 진입 자산을 지정하세요"
    }
    ASSET_DOWNLOAD_NOT_FOUND(asset, version) {
        class: NotFound,
        place: "기기의 자산 다운로드",
        cause: "요청한 자산 버전이 등록되어 있지 않다",
        message: "자산 버전을 찾지 못했습니다. 자산 ID: {asset}. 판: {version}. 서버에 등록되어 있는지 확인하세요.",
        fix: "요청한 자산 버전을 서버에 등록하세요"
    }
}
