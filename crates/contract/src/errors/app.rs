error_catalog! { ENTRIES;
    APP_ICON_APP_NOT_INSTALLED(app_id) { class: NotFound, place: "쉘 앱 아이콘의 앱 조회", cause: "앱이 이 기기에 없다", message: "앱 ID {app_id}: 이 기기에 설치되어 있지 않아 아이콘을 불러오지 못했습니다. 앱을 다시 설치하세요.", fix: "앱을 다시 설치하세요" }
    APP_ICON_APP_VERSION_NOT_FOUND(app_id, version) { class: NotFound, place: "쉘 앱 아이콘의 앱 판 조회", cause: "요청한 앱 판의 정의가 없다", message: "앱 ID {app_id}, {version}판: 이 기기에 해당 앱 정의가 없어 아이콘을 불러오지 못했습니다. 앱을 다시 설치하세요.", fix: "앱을 다시 설치하세요" }
    APP_STORE_MODULE_REQUIRED(app) { class: InvalidAppDefinition, place: "스토어 모듈 선언 검사", cause: "스토어를 쓰는 앱이 모듈 1판을 요구하지 않았다", message: "앱 ID {app}: 스토어를 사용하려면 requires.modules.store를 1 이상으로 선언하세요.", fix: "requires.modules.store를 1 이상으로 선언하세요" }
    APP_STORE_SOURCE_ID_MISSING(source) { class: InvalidAppDefinition, place: "스토어 앱 원천 ID 검사", cause: "앱 상세 원천에 id 바인딩이 없다", message: "스토어 원천 {source}: 앱 상세에 필요한 id가 없습니다. 앱 정의의 원천에 id 바인딩을 추가하세요.", fix: "원천에 앱 id 바인딩을 추가하세요" }
    APP_STORE_PERMISSION_UNDECLARED(location, permission) { class: InvalidAppDefinition, place: "스토어 사용 권한 선언 검사", cause: "스토어 권한이 선언되지 않았다", message: "앱 정의 {location}: 스토어 권한 {permission}이 선언되지 않았습니다. permissions에 이 권한을 추가하세요.", fix: "permissions에 스토어 권한을 추가하세요" }
    APP_STORE_PERMISSION_MISMATCH(location, permission, module) { class: InvalidAppDefinition, place: "스토어 사용 권한 종류 검사", cause: "참조한 권한이 스토어 권한이 아니다", message: "앱 정의 {location}: 권한 {permission}의 모듈이 {module}입니다. 스토어 권한 ID를 지정하세요.", fix: "스토어 권한 ID를 지정하세요" }
    APP_STORE_RELEASE_INVALID(location, value) { class: InvalidAppDefinition, place: "스토어 설치 판 검사", cause: "설치 판의 리터럴이 양의 정수가 아니다", message: "앱 정의 {location}: 설치 판 {value}은 1 이상의 정수여야 합니다. release 값을 고치세요.", fix: "release를 1 이상의 정수로 고치세요" }
    APP_RECEIVE_MESSAGE_REQUIRES_VERSION(blocks, client) {
        class: InvalidAppDefinition,
        place: "메시지 수신 능력 판 검사",
        cause: "메시지 수신 능력에 필요한 판이 선언되지 않았다",
        message: "메시지 수신 능력에 필요한 판이 선언되지 않았습니다. requires.blocks를 {blocks}, client를 {client} 이상으로 고치세요",
        fix: "메시지 수신에 필요한 블록 세트와 client 판을 선언하세요"
    }
    APP_INPUT_DATE_TIME_VERSION_LOW(at, required, required_min) { class: InvalidAppDefinition, place: "날짜와 시간 입력 블록 판 검사", cause: "날짜와 시간 입력을 지원하지 않는 블록 판", message: "{at}의 날짜와 시간 입력은 블록 세트 {required}판부터입니다. requires.blocks를 {required_min} 이상으로 고치세요.", fix: "requires.blocks를 필요한 판 이상으로 고치세요" }
    APP_INPUT_DATE_MULTILINE_INVALID(at) { class: InvalidAppDefinition, place: "날짜 입력 줄 수 검사", cause: "여러 줄 날짜 입력", message: "{at}의 날짜 입력은 한 줄이어야 합니다. multiline과 여러 줄 rows를 빼세요.", fix: "multiline과 여러 줄 rows를 빼세요" }
    APP_INPUT_TIME_MULTILINE_INVALID(at) { class: InvalidAppDefinition, place: "시간 입력 줄 수 검사", cause: "여러 줄 시간 입력", message: "{at}의 시간 입력은 한 줄이어야 합니다. multiline과 여러 줄 rows를 빼세요.", fix: "multiline과 여러 줄 rows를 빼세요" }
    APP_INPUT_DATE_STEP_UNSUPPORTED(at) { class: InvalidAppDefinition, place: "날짜 입력 간격 검사", cause: "날짜 입력에 step 선언", message: "{at}의 날짜 입력은 step을 쓰지 않습니다. step을 빼세요.", fix: "step을 빼세요" }
    APP_INPUT_DATE_BOUND_INVALID(at, field, value) { class: InvalidAppDefinition, place: "날짜 입력 범위 검사", cause: "날짜 범위 형식이나 실재 날짜가 아님", message: "{at}/{field}의 날짜 {value}를 읽을 수 없습니다. 실재 날짜를 YYYY-MM-DD로 고치세요.", fix: "실재 날짜를 YYYY-MM-DD로 고치세요" }
    APP_INPUT_TIME_BOUND_INVALID(at, field, value) { class: InvalidAppDefinition, place: "시간 입력 범위 검사", cause: "시각 범위 형식이나 값이 잘못됨", message: "{at}/{field}의 시각 {value}를 읽을 수 없습니다. 00:00부터 23:59 사이 HH:mm으로 고치세요.", fix: "시각을 HH:mm으로 고치세요" }
    APP_INPUT_TIME_STEP_INVALID(at) { class: InvalidAppDefinition, place: "시간 입력 간격 검사", cause: "분 간격이 양의 정수가 아님", message: "{at}/step은 분 단위 양의 정수여야 합니다. step을 고치거나 빼서 30분 간격을 쓰세요.", fix: "step을 양의 정수로 고치거나 빼세요" }
    APP_INPUT_OPTIONS_VERSION_LOW(at, required, required_min) { class: InvalidAppDefinition, place: "입력 선택지 블록 판 검사", cause: "선택지를 지원하지 않는 블록 판", message: "{at}의 입력 선택지는 블록 세트 {required}판부터입니다. requires.blocks를 {required_min} 이상으로 고치세요.", fix: "requires.blocks를 필요한 판 이상으로 고치세요" }
    APP_SELECT_DESCRIPTION_VERSION_LOW(at, required, required_min) { class: InvalidAppDefinition, place: "선택지 설명 블록 판 검사", cause: "선택지 설명을 지원하지 않는 블록 판", message: "{at}의 선택지 description은 블록 세트 {required}판부터입니다. requires.blocks를 {required_min} 이상으로 고치세요.", fix: "requires.blocks를 필요한 판 이상으로 고치세요" }
    APP_INPUT_OPTIONS_KIND_INVALID(at) { class: InvalidAppDefinition, place: "입력 선택지 종류 검사", cause: "텍스트나 검색이 아닌 입력에 선택지 선언", message: "{at}의 options는 text와 search 입력에서만 쓸 수 있습니다. kind를 고치거나 options를 빼세요.", fix: "kind를 고치거나 options를 빼세요" }
    APP_INPUT_OPTIONS_MULTILINE_INVALID(at) { class: InvalidAppDefinition, place: "입력 선택지 줄 수 검사", cause: "여러 줄 입력에 선택지 선언", message: "{at}의 선택지 입력은 한 줄이어야 합니다. multiline을 끄고 rows를 1 이하로 고치세요.", fix: "multiline을 끄고 rows를 1 이하로 고치세요" }
    APP_INPUT_OPTIONS_ONLY_WITHOUT_OPTIONS(at) { class: InvalidAppDefinition, place: "입력 선택지 전용 설정 검사", cause: "선택지 없이 options_only 선언", message: "{at}에 options_only가 있지만 options가 없습니다. 선택지 바인딩을 더하거나 options_only를 빼세요.", fix: "선택지 바인딩을 더하거나 options_only를 빼세요" }
    APP_INPUT_OPTIONS_ARRAY_INVALID(at, received) { class: InvalidAppDefinition, place: "입력 선택지 값 검사", cause: "자료가 배열이 아님", message: "{at}/options: 입력 선택지 자료가 배열이 아닙니다. 받은 값: {received}. 앱 정의의 options 자료를 배열로 고치세요.", fix: "앱 정의의 options 자료를 고치세요" }
    APP_INPUT_OPTIONS_ITEM_INVALID(at, index, received) { class: InvalidAppDefinition, place: "입력 선택지 값 검사", cause: "항목이 문자열도 객체도 아님", message: "{at}/options: 입력 선택지 {index}번째가 문자열도 객체도 아닙니다. 받은 값: {received}. 앱 정의의 options 항목을 문자열 또는 객체로 고치세요.", fix: "앱 정의의 options 자료를 고치세요" }
    APP_INPUT_OPTIONS_KEY_MISSING(at, index, key) { class: InvalidAppDefinition, place: "입력 선택지 값 검사", cause: "필수 키 누락", message: "{at}/options: 입력 선택지 {index}번째에 {key} 키가 없습니다. 앱 정의의 options 객체에 이 키를 문자열로 더하세요.", fix: "앱 정의의 options 자료를 고치세요" }
    APP_INPUT_OPTIONS_KEY_NOT_STRING(at, index, key, received) { class: InvalidAppDefinition, place: "입력 선택지 값 검사", cause: "키 값이 문자열이 아님", message: "{at}/options: 입력 선택지 {index}번째의 {key} 키 값이 문자열이 아닙니다. 받은 값: {received}. 앱 정의의 options 자료에서 해당 키를 문자열로 고치세요.", fix: "앱 정의의 options 자료를 고치세요" }
    APP_TIMELINE_FIELD_REQUIRED(path, field) {
        class: InvalidAppDefinition,
        place: "시간축 필수 필드 검사",
        cause: "초 단위 시간축의 필수 필드가 없다",
        message: "{path}: seconds 시간축에 {field}가 없습니다. 앱 정의에 빠진 필드를 지정하세요.",
        fix: "초 단위 시간축에 필수 필드를 지정하세요"
    }
    APP_TIMELINE_SECONDS_FIELD_FORBIDDEN(path, field, value) {
        class: InvalidAppDefinition,
        place: "초 단위 시간축 필드 검사",
        cause: "날짜 전용 필드를 초 단위 시간축에 지정했다",
        message: "{path}: seconds 시간축에 {field} 값 {value}를 쓸 수 없습니다. 날짜 전용 필드를 제거하세요.",
        fix: "초 단위 시간축에서 날짜 전용 필드를 제거하세요"
    }
    APP_TIMELINE_DATES_FIELD_FORBIDDEN(path, field, value) {
        class: InvalidAppDefinition,
        place: "날짜 단위 시간축 필드 검사",
        cause: "초 전용 필드를 날짜 단위 시간축에 지정했다",
        message: "{path}: dates 시간축에 {field} 값 {value}를 쓸 수 없습니다. 초 전용 필드를 제거하세요.",
        fix: "날짜 단위 시간축에서 초 전용 필드를 제거하세요"
    }
    APP_TIMELINE_VERSION_REQUIRED(path, version, required) {
        class: InvalidAppDefinition,
        place: "시간축 날짜 필드 판 검사",
        cause: "날짜 필드에 필요한 블록 세트 판이 낮다",
        message: "{path}: 블록 세트 {version}판은 시간축 날짜 필드를 지원하지 않습니다. requires.blocks를 {required} 이상으로 고치세요.",
        fix: "requires.blocks를 필요한 판 이상으로 지정하세요"
    }
    APP_TIMELINE_ITEM_DATE_INVALID(path, field, value) {
        class: InvalidAppDefinition,
        place: "시간축 항목 날짜 검사",
        cause: "항목 날짜가 유효한 달력 날짜가 아니다",
        message: "{path}: 항목 {field} 값 {value}는 올바른 날짜가 아닙니다. YYYY-MM-DD 형식의 실제 날짜로 고치세요.",
        fix: "항목 날짜를 실제 달력 날짜로 지정하세요"
    }
    APP_TIMELINE_ITEM_DATE_PAIR_INCOMPLETE(path, id, missing) {
        class: InvalidAppDefinition,
        place: "시간축 항목 날짜 쌍 검사",
        cause: "항목의 시작일과 끝날 중 하나만 있다",
        message: "{path}: 항목 {id}에 {missing}이 없습니다. 시작일과 끝날을 둘 다 지정하거나 둘 다 비우세요.",
        fix: "항목의 시작일과 끝날을 함께 지정하세요"
    }
    APP_TIMELINE_ITEM_DATE_REVERSED(path, id, start, end) {
        class: InvalidAppDefinition,
        place: "시간축 항목 날짜 순서 검사",
        cause: "항목 시작일이 끝날보다 늦다",
        message: "{path}: 항목 {id}의 시작일 {start}이 끝날 {end}보다 늦습니다. 날짜 순서를 고치세요.",
        fix: "항목 시작일을 끝날 이전으로 고치세요"
    }
    APP_TIMELINE_ITEM_SECONDS_INVALID(path, id, start, end) {
        class: InvalidAppDefinition,
        place: "시간축 항목 초 검사",
        cause: "초 단위 항목의 시작과 끝이 숫자가 아니다",
        message: "{path}: 항목 {id}의 start {start}, end {end}는 초 단위 숫자여야 합니다. start와 end를 숫자로 고치세요.",
        fix: "항목 시작과 끝을 초 단위 숫자로 지정하세요"
    }
    APP_TIMELINE_MARKER_DATE_INVALID(path, value) {
        class: InvalidAppDefinition,
        place: "시간축 마커 날짜 검사",
        cause: "마커 날짜가 유효한 달력 날짜가 아니다",
        message: "{path}: 마커 날짜 {value}가 올바르지 않습니다. YYYY-MM-DD 형식의 실제 날짜로 고치세요.",
        fix: "마커 날짜를 실제 달력 날짜로 지정하세요"
    }
    APP_TIMELINE_MARKER_SECONDS_INVALID(path, value) {
        class: InvalidAppDefinition,
        place: "시간축 마커 초 검사",
        cause: "초 단위 마커가 숫자가 아니다",
        message: "{path}: 마커 시간 {value}는 초 단위 숫자가 아닙니다. time을 숫자로 고치세요.",
        fix: "마커 시간을 초 단위 숫자로 지정하세요"
    }
    APP_TIMELINE_OFF_DAY_INVALID(path, value) {
        class: InvalidAppDefinition,
        place: "시간축 쉬는 날 검사",
        cause: "쉬는 날이 유효한 달력 날짜가 아니다",
        message: "{path}: off_days 값 {value}가 올바르지 않습니다. YYYY-MM-DD 형식의 실제 날짜 목록으로 고치세요.",
        fix: "쉬는 날을 실제 날짜 목록으로 지정하세요"
    }
    APP_TIMELINE_VIEWPORT_DATE_INVALID(path, field, value) {
        class: InvalidAppDefinition,
        place: "시간축 뷰포트 날짜 검사",
        cause: "뷰포트 날짜가 유효한 달력 날짜가 아니다",
        message: "{path}: viewport.{field} 값 {value}가 올바르지 않습니다. YYYY-MM-DD 형식의 실제 날짜로 고치세요.",
        fix: "뷰포트 날짜를 실제 달력 날짜로 지정하세요"
    }
    APP_TIMELINE_VIEWPORT_DATE_REVERSED(path, start, end) {
        class: InvalidAppDefinition,
        place: "시간축 뷰포트 날짜 순서 검사",
        cause: "뷰포트 시작일이 끝날보다 늦다",
        message: "{path}: viewport 시작일 {start}이 끝날 {end}보다 늦습니다. 날짜 순서를 고치세요.",
        fix: "뷰포트 시작일을 끝날 이전으로 고치세요"
    }
    APP_LIST_ON_REMOVE_VERSION_REQUIRED(pointer, version) { class: InvalidAppDefinition, place: "목록 빼기 판 검사", cause: "목록 빼기 동작에 필요한 블록 판보다 낮다", message: "목록 {pointer}의 on_remove는 블록 세트 {version}판 이상이 필요합니다. 앱 정의의 requires.blocks를 고치세요.", fix: "requires.blocks를 필요한 판 이상으로 고치세요" }
    APP_OPEN_URL_VERSION_REQUIRED(pointer, version) { class: InvalidAppDefinition, place: "주소 열기 동작 판 검사", cause: "주소 열기 동작에 필요한 블록 판보다 낮다", message: "동작 {pointer}의 open_url은 블록 세트 {version}판 이상이 필요합니다. 앱 정의의 requires.blocks를 고치세요.", fix: "requires.blocks를 필요한 판 이상으로 고치세요" }
    APP_ICON_VERSION_INVALID(app_id, asset, version) {
        class: InvalidAppDefinition,
        place: "앱 아이콘 자산 판 검사",
        cause: "아이콘 자산의 판이 0이다",
        message: "앱 ID {app_id}, 아이콘 자산 {asset} {version}판: 자산 판은 1 이상이어야 합니다. SVG, PNG 또는 WebP 자산의 판을 고치세요.",
        fix: "아이콘 자산 판을 1 이상으로 지정하세요"
    }
    APP_ICON_ASSET_UNDECLARED(app_id, asset, version) {
        class: InvalidAppDefinition,
        place: "앱 아이콘 자산 선언 검사",
        cause: "아이콘 자산 ID가 assets에 없다",
        message: "앱 ID {app_id}, 아이콘 자산 {asset} {version}판: assets에 선언되지 않았습니다. SVG, PNG 또는 WebP 자산의 같은 판을 assets에 추가하세요.",
        fix: "아이콘 자산과 판을 assets에 선언하세요"
    }
    APP_ICON_VERSION_MISMATCH(app_id, asset, version, declared_version) {
        class: InvalidAppDefinition,
        place: "앱 아이콘 자산 선언 판 대조",
        cause: "아이콘 자산의 판이 assets에 선언한 판과 다르다",
        message: "앱 ID {app_id}, 아이콘 자산 {asset} {version}판: assets에는 {declared_version}판이 선언되어 있습니다. SVG, PNG 또는 WebP 자산의 두 판을 같게 고치세요.",
        fix: "아이콘과 assets의 자산 판을 같게 지정하세요"
    }
    APP_ICON_BLOCK_SET_REQUIRED(app_id, asset, version, required) {
        class: InvalidAppDefinition,
        place: "앱 아이콘 블록 세트 판 검사",
        cause: "아이콘을 쓰는 앱이 필요한 블록 세트 판보다 낮게 선언했다",
        message: "앱 ID {app_id}, 아이콘 자산 {asset} {version}판: SVG, PNG 또는 WebP 아이콘은 블록 세트 {required}판 이상이 필요합니다. requires.blocks를 고치세요.",
        fix: "requires.blocks를 필요한 판 이상으로 지정하세요"
    }
    APP_INPUT_SPIN_VERSION_LOW(at, required, required_min) {
        class: InvalidAppDefinition,
        place: "숫자 스핀 블록 판 확인",
        cause: "스핀을 지원하지 않는 블록 세트 판이다",
        message: "{at}의 input.spin은 블록 세트 {required}판부터입니다. requires.blocks를 {required_min} 이상으로 고치세요.",
        fix: "requires.blocks를 필요한 판 이상으로 고치세요"
    }
    APP_INPUT_SPIN_KIND_INVALID(at) {
        class: InvalidAppDefinition,
        place: "숫자 스핀 입력 종류 확인",
        cause: "숫자 입력이 아닌 곳에 spin을 지정했다",
        message: "{at}의 spin은 숫자 입력에서만 쓸 수 있습니다. kind를 number로 바꾸거나 spin을 빼세요.",
        fix: "kind를 number로 바꾸거나 spin을 빼세요"
    }
    APP_BUTTON_DESCRIPTION_VERSION_LOW(at, required, required_min) {
        class: InvalidAppDefinition,
        place: "단추 설명 블록 판 확인",
        cause: "단추 설명을 지원하지 않는 블록 세트 판이다",
        message: "{at}의 button.description은 블록 세트 {required}판부터입니다. requires.blocks를 {required_min} 이상으로 고치세요.",
        fix: "requires.blocks를 필요한 판 이상으로 고치세요"
    }
    APP_INSTRUCTIONS_WINDOW_NOT_FOUND() { class: NotFound, place: "지침 읽기 창", cause: "앱 창이 없다", message: "지침을 읽을 앱 창이 없습니다. 앱을 다시 여세요.", fix: "앱을 다시 여세요" }
    APP_INSTRUCTIONS_CAPABILITY_UNDECLARED() { class: PermissionDenied, place: "지침 읽기 권한", cause: "앱이 지침 기능을 선언하지 않았다", message: "앱이 지침 읽기 기능을 선언하지 않았습니다. 앱 정의의 client.capabilities를 고치세요.", fix: "client.capabilities에 instructions를 선언하세요" }
    APP_INSTRUCTIONS_KIND_UNKNOWN(kind) { class: InvalidRequest, place: "지침 종류", cause: "지원하지 않는 지침 종류다", message: "지침 종류 {kind}를 찾지 못했습니다. 앱 코드에서 app_authoring을 사용하세요.", fix: "앱 코드에서 app_authoring을 사용하세요" }
    APP_PREVIEW_BUILTIN_APP_UNSUPPORTED(app_id) {
        class: UnsupportedApp,
        place: "기본 앱 미리 보기",
        cause: "기본 앱은 원격 미리 보기 대상이 아니다",
        message: "기본 앱 ID {app_id}: 이 도구에서는 미리 볼 수 없습니다. 로컬 시험 쉘에서 확인하세요.",
        fix: "로컬 시험 쉘에서 기본 앱을 미리 보세요"
    }
    APP_PREVIEW_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "앱 미리 보기",
        cause: "미리 볼 앱이 계정에 없다",
        message: "앱 ID {app_id}: 찾을 수 없어 미리 보지 못했습니다. list_apps로 현재 ID를 확인하세요.",
        fix: "list_apps로 현재 앱 ID를 확인하세요"
    }
    APP_PREVIEW_DEFINITION_SERIALIZE_FAILED() {
        class: Server,
        place: "앱 정의 미리 보기 입력 변환",
        cause: "받은 앱 정의 값을 JSON으로 바꾸지 못했다",
        message: "definition 값을 JSON 문자열로 바꾸지 못했습니다. definition을 JSON 객체로 넘기세요.",
        fix: "definition을 JSON 객체로 넘기세요"
    }
    APP_PREVIEW_STORAGE_KIND_SERIALIZE_FAILED(app_id, key) {
        class: Server,
        place: "앱 미리 보기 저장 항목 종류 읽기",
        cause: "앱 저장 항목 종류를 JSON 값으로 바꾸지 못했다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 서버가 저장 종류를 읽지 못했습니다. 서버 로그에서 이 오류 코드를 찾으세요.",
        fix: "서버 로그에서 이 오류 코드를 찾으세요"
    }
    APP_PREVIEW_STORAGE_VALUE_JSON_INVALID(app_id, key) {
        class: Server,
        place: "앱 미리 보기 저장값 JSON 읽기",
        cause: "저장된 앱 값이 올바른 JSON이 아니다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 저장된 값이 JSON이 아니라 읽지 못했습니다. write_app_storage로 값을 다시 쓰거나 reset_app_storage로 되돌리세요.",
        fix: "write_app_storage로 다시 쓰거나 reset_app_storage로 되돌리세요"
    }
    APP_PREVIEW_ARGUMENTS_INVALID() {
        class: InvalidRequest,
        place: "앱 미리 보기 요청 확인",
        cause: "앱 ID와 앱 정의를 동시에 주거나 둘 다 주지 않았다",
        message: "앱 미리 보기에는 app_id 또는 definition 중 하나만 필요합니다. 하나만 지정해 다시 요청하세요.",
        fix: "app_id 또는 definition 하나만 지정하세요"
    }
    APP_PREVIEW_MAX_CHARS_INVALID(value) {
        class: InvalidRequest,
        place: "앱 미리 보기 결과 크기 확인",
        cause: "결과 글자 수 제한이 허용 범위를 벗어났다",
        message: "미리 보기 결과 제한 값 {value}: 1부터 20000 사이여야 합니다. 허용 범위 안의 값을 지정하세요.",
        fix: "1부터 20000 사이의 값을 지정하세요"
    }
    APP_PREVIEW_WINDOW_NOT_REPORTED(window_id) {
        class: InvalidRequest,
        place: "보고된 창 미리 보기",
        cause: "기기에서 보고한 창 상태가 없다",
        message: "창 ID {window_id}: 서버에 보고된 상태가 없어 미리 보지 못했습니다. 그 창을 연 쉘이 서버에 연결됐는지 확인하거나 state 인자로 상태를 직접 넘기세요.",
        fix: "쉘 연결을 확인하거나 state 인자로 창 상태를 넘기세요"
    }
    APP_PREVIEW_WINDOW_NOT_FOUND(window_id, app_id) {
        class: NotFound,
        place: "앱 창 상태 조회",
        cause: "현재 계정의 창과 보고된 배치에서 창을 찾지 못했다",
        message: "창 ID {window_id}: 현재 계정의 작업과 보고된 배치에 없어 앱 ID {app_id}의 저장값을 미리 보지 못했습니다. get_workspace로 창 ID를 확인하세요.",
        fix: "get_workspace로 창 ID를 확인하세요"
    }
    APP_PREVIEW_WINDOW_APP_MISMATCH(window_id, app_id) {
        class: InvalidRequest,
        place: "앱 창 미리 보기 확인",
        cause: "창이 미리 볼 앱과 연결되어 있지 않다",
        message: "창 ID {window_id}: 앱 ID {app_id}에 속하지 않습니다. 해당 앱의 창 ID를 지정하세요.",
        fix: "해당 앱의 창 ID를 지정하세요"
    }
    APP_PREVIEW_WORKSPACE_WINDOW_MISMATCH(workspace_id, window_workspace_id) {
        class: InvalidRequest,
        place: "앱 미리 보기 작업 확인",
        cause: "지정한 작업이 창에 연결된 작업과 다르다",
        message: "요청한 작업 ID: {workspace_id}, 창에 연결된 작업 ID: {window_workspace_id}. 두 작업이 다릅니다. 창에 연결된 작업 ID를 지정하세요.",
        fix: "창에 연결된 작업 ID를 지정하세요"
    }
    APP_PREVIEW_WORKSPACE_NOT_FOUND(workspace_id) {
        class: NotFound,
        place: "앱 미리 보기 작업 조회",
        cause: "현재 계정에 속한 작업이 없다",
        message: "작업 ID {workspace_id}: 찾을 수 없어 앱 저장값을 미리 볼 수 없습니다. 현재 계정의 작업 ID를 지정하세요.",
        fix: "현재 계정의 작업 ID를 지정하세요"
    }
    APP_PREVIEW_WORKSPACE_REQUIRED(app_id, key) {
        class: InvalidRequest,
        place: "작업 전용 저장값 미리 보기",
        cause: "앱이 사용하는 작업 전용 저장값에 작업 ID가 필요하다",
        message: "앱 ID {app_id}, 저장 항목 {key}: 작업별 값이라 workspace_id 또는 window_id가 필요합니다. 작업이나 창을 지정하세요.",
        fix: "workspace_id 또는 window_id를 지정하세요"
    }
    APP_BUILTIN_SPEC_APP_ID_INVALID(app_id) {
        class: InvalidRequest,
        place: "기본 앱 실행 설정 검사",
        cause: "설정의 앱 ID가 기본 앱 ID가 아니다",
        message: "서버가 모르는 기본 앱 ID입니다: {app_id}. 쉘이 서버보다 새 판일 수 있습니다. 서버를 업데이트하세요.",
        fix: "서버를 업데이트하세요"
    }
    APP_BUILTIN_SPEC_VERSION_INVALID(app_id, version) {
        class: InvalidRequest,
        place: "기본 앱 실행 설정 판 검사",
        cause: "기본 앱 실행 설정의 판이 0이다",
        message: "기본 앱 ID {app_id}: 쉘이 보낸 실행 설정의 판이 올바르지 않습니다. 쉘을 업데이트하세요. 받은 판: {version}",
        fix: "쉘을 업데이트하세요"
    }
    APP_BUILTIN_SPEC_STORAGE_SERIALIZE_FAILED(app_id) {
        class: Server,
        place: "기본 앱 저장소 설정 저장",
        cause: "저장소 설정을 JSON으로 바꾸지 못했다",
        message: "기본 앱 ID {app_id}의 저장소 설정을 서버 저장 형식으로 바꾸지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    APP_BUILTIN_SPEC_WORKER_SERIALIZE_FAILED(app_id) {
        class: Server,
        place: "기본 앱 워커 설정 저장",
        cause: "워커 설정을 JSON으로 바꾸지 못했다",
        message: "기본 앱 ID {app_id}의 워커 설정을 서버 저장 형식으로 바꾸지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    APP_BUILTIN_SPEC_STORAGE_JSON_INVALID(app_id) {
        class: Server,
        place: "기본 앱 저장소 설정 읽기",
        cause: "저장된 저장소 설정이 올바른 JSON이 아니다",
        message: "기본 앱 ID {app_id}: 서버에 저장된 저장소 설정을 읽지 못했습니다. 쉘을 다시 시작해 설정을 다시 등록하세요.",
        fix: "쉘을 다시 시작해 설정을 다시 등록하세요"
    }
    APP_BUILTIN_SPEC_WORKER_JSON_INVALID(app_id) {
        class: Server,
        place: "기본 앱 워커 설정 읽기",
        cause: "저장된 워커 설정이 올바른 JSON이 아니다",
        message: "기본 앱 ID {app_id}: 서버에 저장된 워커 설정을 읽지 못했습니다. 쉘을 다시 시작해 설정을 다시 등록하세요.",
        fix: "쉘을 다시 시작해 설정을 다시 등록하세요"
    }
    APP_BUILTIN_SPEC_RECORD_INVALID(app_id) {
        class: Server,
        place: "기본 앱 실행 설정 읽기",
        cause: "저장된 기본 앱 설정이 앱 실행 설정 형식에 맞지 않는다",
        message: "기본 앱 ID {app_id}: 서버에 저장된 실행 설정을 읽지 못했습니다. 쉘을 다시 시작해 설정을 다시 등록하세요.",
        fix: "쉘을 다시 시작해 설정을 다시 등록하세요"
    }
    APP_BUILTIN_SPEC_FILE_READ_NOT_FOUND(app_id) {
        class: Server,
        place: "기본 앱 정의 파일 읽기",
        cause: "기본 앱 정의 파일이 읽는 동안 사라졌다",
        message: "기본 앱 정의 파일 {app_id}.json을 찾지 못했습니다. kaleidoscope 리포의 apps 폴더를 확인하세요.",
        fix: "kaleidoscope 리포의 apps 폴더에 정의 파일을 두세요"
    }
    APP_BUILTIN_SPEC_FILE_READ_FAILED(app_id) {
        class: Server,
        place: "기본 앱 정의 파일 읽기",
        cause: "기본 앱 정의 파일을 읽지 못했다",
        message: "기본 앱 정의 파일 {app_id}.json을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    APP_BUILTIN_SPEC_FILE_ID_MISMATCH(app_id, declared_id) {
        class: InvalidAppDefinition,
        place: "기본 앱 정의 파일 ID 확인",
        cause: "파일 이름의 앱 ID와 정의 안의 ID가 다르다",
        message: "기본 앱 ID {app_id}: 파일 정의의 앱 ID는 {declared_id}입니다. 파일 이름과 앱 정의의 ID를 같게 고치세요.",
        fix: "파일 이름과 앱 정의의 ID를 같게 고치세요"
    }
    APP_BUILTIN_SPEC_NOT_FOUND(app_id) {
        class: NotFound,
        place: "기본 앱 실행 설정 조회",
        cause: "기본 앱 실행 설정이 등록되지 않았다",
        message: "기본 앱 ID {app_id}: 서버에 실행 설정이 없습니다. 이 앱이 들어 있는 쉘을 서버에 연결한 뒤 다시 시도하세요.",
        fix: "이 기본 앱이 들어 있는 쉘을 서버에 연결하세요"
    }
    APP_BUILTIN_STORAGE_ENTRY_NOT_DECLARED(app_id, key) {
        class: InvalidRequest,
        place: "기본 앱 저장 항목 조회",
        cause: "요청한 저장 항목이 기본 앱 정의에 없다",
        message: "기본 앱 ID {app_id}, 저장 항목 {key}: 선언되지 않았습니다. 선언된 저장 항목을 사용하세요.",
        fix: "기본 앱 정의에 선언된 저장 항목을 사용하세요"
    }
    APP_BUILTIN_COLLECTION_NOT_DECLARED(app_id, key) {
        class: InvalidRequest,
        place: "기본 앱 문서 모음 조회",
        cause: "요청한 문서 모음이 기본 앱 정의에 없다",
        message: "기본 앱 ID {app_id}, 문서 모음 {key}: 선언되지 않았습니다. 선언된 문서 모음을 사용하세요.",
        fix: "기본 앱 정의에 선언된 문서 모음을 사용하세요"
    }
    APP_BUILTIN_COLLECTION_KEY_INVALID(app_id, key) {
        class: InvalidRequest,
        place: "기본 앱 문서 키 확인",
        cause: "저장 키가 선언된 문서 모음 아래의 문서 키가 아니다",
        message: "기본 앱 ID {app_id}, 저장 키 {key}: 문서 모음 아래에 있지 않습니다. 문서 모음 경로와 문서 이름을 확인하세요.",
        fix: "문서 모음 아래의 문서 키를 사용하세요"
    }
    APP_PUBLISH_BUILTIN_APP_FORBIDDEN(app_id) {
        class: InvalidAppDefinition,
        place: "기본 앱 올리기",
        cause: "쉘과 함께 배포하는 기본 앱을 서버에 올리려 했다",
        message: "기본 앱 ID {app_id}: 서버에 올릴 수 없습니다. kaleidoscope 리포의 apps 폴더에서 고친 뒤 쉘 새 판으로 내세요.",
        fix: "kaleidoscope 리포의 apps 폴더에서 기본 앱을 수정하세요"
    }
    APP_BUILTIN_STORAGE_KEY_MISMATCH(app_id, key) {
        class: InvalidRequest,
        place: "기본 앱 저장 항목 키 확인",
        cause: "요청한 저장 키가 선언의 ID, 키 또는 작업 키와 맞지 않는다",
        message: "기본 앱 ID {app_id}, 저장 키 {key}: 선언된 저장 항목과 일치하지 않습니다. 앱 정의의 항목 ID와 키를 확인하세요.",
        fix: "앱 정의에 선언된 저장 항목 ID 또는 키를 사용하세요"
    }
    APP_DEFINITION_JSON_INVALID(reason) {
        class: InvalidAppDefinition,
        place: "앱 정의 JSON 읽기",
        cause: "JSON 문법이 올바르지 않다",
        message: "앱 정의 JSON의 문법이 틀렸습니다. 문법을 고친 뒤 다시 시도하세요. 원인: {reason}",
        fix: "앱 정의의 JSON 문법을 고치세요"
    }
    APP_DEFINITION_FORMAT_INVALID(reason) {
        class: InvalidAppDefinition,
        place: "앱 정의 구조 읽기",
        cause: "JSON 값이 앱 정의 형식에 맞지 않는다",
        message: "앱 정의의 필드나 값이 형식에 맞지 않습니다. 원인에 나온 필드를 고친 뒤 다시 시도하세요. 원인: {reason}",
        fix: "원인에 나온 필드를 고치세요"
    }
    APP_DEFINITION_CHECK_FAILED() {
        class: InvalidAppDefinition,
        place: "앱 정의 의미 검사",
        cause: "앱 정의가 권한, 상태, 바인딩 또는 블록 검사에 걸렸다",
        message: "앱 정의가 검사를 통과하지 못했습니다. 함께 표시된 항목을 고친 뒤 다시 시도하세요.",
        fix: "함께 표시된 항목과 JSON 경로를 고치세요"
    }
    APP_REPEAT_GRID_ITEM_WIDTH_FIXED_COLUMNS(pointer) {
        class: InvalidAppDefinition,
        place: "repeat 격자 칸 폭 검사",
        cause: "repeat.grid.item_width가 자동 열 수가 아닌 고정 열 수와 함께 쓰였다",
        message: "{pointer}: repeat.grid.item_width는 grid.columns가 auto일 때만 쓸 수 있습니다. 고정 열 수를 유지하려면 item_width를 지우세요.",
        fix: "{pointer}/grid/item_width를 지우거나 {pointer}/grid/columns를 auto로 바꾸세요"
    }
    APP_SPLIT_COLUMN_BELOW_DIRECTION_INVALID(pointer) {
        class: InvalidAppDefinition,
        place: "split 반응형 방향 검사",
        cause: "column_below를 column 방향 split에 썼다",
        message: "{pointer}: split.column_below는 direction이 row인 split에만 씁니다. 앱 정의의 direction을 row로 바꾸거나 column_below를 지우세요.",
        fix: "앱 정의의 direction을 row로 바꾸거나 column_below를 지우세요"
    }
    APP_SPLIT_COLUMN_BELOW_ZERO(pointer) {
        class: InvalidAppDefinition,
        place: "split 반응형 폭 검사",
        cause: "column_below에 0을 썼다",
        message: "{pointer}: split.column_below는 0보다 커야 합니다. 앱 정의에서 양수로 바꾸세요.",
        fix: "앱 정의의 column_below를 양수로 바꾸세요"
    }
    APP_SPLIT_COLUMN_BELOW_VERSION_REQUIRED(pointer, version) {
        class: InvalidAppDefinition,
        place: "split 반응형 방향 판 검사",
        cause: "column_below를 쓰는 앱의 블록 세트 요구 판이 낮다",
        message: "{pointer}: split.column_below에는 블록 세트 {version}판 이상이 필요합니다. 앱 정의의 requires.blocks를 올리세요.",
        fix: "앱 정의의 requires.blocks를 {version} 이상으로 올리세요"
    }
    APP_REPEAT_GAP_VERSION_REQUIRED(pointer, version) {
        class: InvalidAppDefinition,
        place: "repeat 간격 판 검사",
        cause: "repeat.gap을 쓰는 앱의 블록 세트 요구 판이 낮다",
        message: "{pointer}: repeat.gap에는 블록 세트 {version}판 이상이 필요합니다. 앱 정의의 requires.blocks를 올리세요.",
        fix: "앱 정의의 requires.blocks를 {version} 이상으로 올리세요"
    }
    APP_DEFINITION_WHEN_CONDITION_MISSING() {
        class: InvalidAppDefinition,
        place: "앱 정의 when 조건 검사",
        cause: "when 블록에 조건이 하나도 없다",
        message: "when 블록에는 value, min_width, max_width 중 하나 이상이 필요합니다. 조건을 추가한 뒤 다시 시도하세요.",
        fix: "when 블록에 value, min_width, max_width 중 하나 이상을 지정하세요"
    }
    APP_DEFINITION_WEBHOOK_TOKEN_SECRET_REQUIRED() {
        class: InvalidAppDefinition,
        place: "앱 정의 웹훅 토큰 시크릿 검사",
        cause: "worker.webhook에 token_secret이 없다",
        message: "/worker/webhook/token_secret: 웹훅에는 호출 토큰을 담을 워커 시크릿을 반드시 지정해야 합니다. worker.secrets에 시크릿을 선언하고 /worker/webhook/token_secret에 그 id를 지정하세요.",
        fix: "worker.secrets에 시크릿을 선언하고 /worker/webhook/token_secret에 그 id를 지정하세요"
    }
    APP_DEFINITION_REQUIRES_NEWER_SHELL() {
        class: UnsupportedApp,
        place: "앱 정의 호환성 검사",
        cause: "앱 정의가 이 쉘이나 서버에서 지원하지 않는 블록 또는 모듈 판을 요구한다",
        message: "앱 정의의 requires가 이 쉘이나 서버보다 새 판을 요구합니다. 쉘에서 가져왔다면 쉘을, 서버에 올렸다면 서버를 업데이트하세요. 또는 앱 정의의 requires를 낮추세요.",
        fix: "낡은 쪽을 업데이트하거나 앱 정의의 requires를 낮추세요"
    }
    APP_DEFINITION_REMOVED_LOCAL_AGENT_MODULE() {
        class: InvalidAppDefinition,
        place: "앱 정의의 모듈 선언 검사",
        cause: "requires.modules에 제거된 local_agent 모듈이 있다",
        message: "requires.modules.local_agent는 제거되었습니다. 실행은 process 모듈로 선언하고 대화 화면은 chat.client 모드로 바꾸세요.",
        fix: "requires.modules에서 local_agent를 지우고 process 모듈과 chat.client를 사용하세요"
    }
    APP_DEFINITION_REMOVED_LOCAL_AGENT_PERMISSION() {
        class: InvalidAppDefinition,
        place: "앱 정의의 권한 선언 검사",
        cause: "permissions에 제거된 local_agent 권한이 있다",
        message: "permissions[].module=local_agent 권한은 제거되었습니다. 실행은 process 모듈로 선언하고 대화 화면은 chat.client 모드로 바꾸세요.",
        fix: "local_agent 권한을 지우고 process 모듈과 chat.client를 사용하세요"
    }
    APP_DEFINITION_REMOVED_CHAT_LOCAL_FIELDS() {
        class: InvalidAppDefinition,
        place: "앱 정의 chat 블록 검사",
        cause: "chat 블록에 제거된 기기 실행 필드가 있다",
        message: "chat.permission, root, agents, selected, on_select 실행 필드는 제거되었습니다. 실행은 process 모듈로 선언하고 대화 화면은 chat.client 모드로 바꾸세요.",
        fix: "옛 chat 실행 필드를 지우고 process 모듈과 chat.client를 사용하세요"
    }
    APP_DEFINITION_REMOVED_AGENT_SESSION_BLOCK() {
        class: InvalidAppDefinition,
        place: "앱 정의 블록 이름 검사",
        cause: "ui에 제거된 agent_session 블록 별칭이 있다",
        message: "ui.type=agent_session 블록은 제거되었습니다. process 모듈과 chat.client를 쓰는 chat 블록으로 정의하세요.",
        fix: "agent_session을 chat.client 모드의 chat 블록으로 바꾸세요"
    }
    APP_BUTTON_VARIANT_VERSION_LOW(pointer, version) {
        class: InvalidAppDefinition,
        place: "단추 강조 바인딩 판 검사",
        cause: "단추 강조 바인딩을 지원하지 않는 블록 세트 판이다",
        message: "{pointer}의 button.variant 바인딩은 블록 세트 {version}판 이상이 필요합니다. 앱 정의의 requires.blocks를 올리세요.",
        fix: "앱 정의의 requires.blocks를 {version} 이상으로 올리세요"
    }
    APP_BUTTON_ICON_VERSION_LOW(pointer, version) {
        class: InvalidAppDefinition,
        place: "단추 아이콘 판 검사",
        cause: "단추 아이콘을 지원하지 않는 블록 세트 판이다",
        message: "{pointer}의 button.icon은 블록 세트 {version}판 이상이 필요합니다. 앱 정의의 requires.blocks를 올리세요.",
        fix: "앱 정의의 requires.blocks를 {version} 이상으로 올리세요"
    }
    APP_BUTTON_GRID_ICON_VERSION_LOW(pointer, version) {
        class: InvalidAppDefinition,
        place: "단추 격자 아이콘 판 검사",
        cause: "단추 격자 아이콘을 지원하지 않는 블록 세트 판이다",
        message: "{pointer}의 button_grid.buttons 아이콘은 블록 세트 {version}판 이상이 필요합니다. 앱 정의의 requires.blocks를 올리세요.",
        fix: "앱 정의의 requires.blocks를 {version} 이상으로 올리세요"
    }
    APP_IMPORT_SERVER_NOT_CONNECTED() {
        class: Server,
        place: "쉘의 앱 가져오기",
        cause: "서버 연결이 완료되지 않아 앱 가져오기 요청을 보낼 수 없다",
        message: "kaleidoscope 서버에 연결되어 있지 않아 앱을 가져올 수 없습니다. 서버를 연결한 뒤 다시 시도하세요.",
        fix: "쉘의 「서버 연결」에서 서버를 연결하세요"
    }
}
