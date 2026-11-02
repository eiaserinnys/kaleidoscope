error_catalog! { ENTRIES;
    APP_DEFINITION_JSON_INVALID(reason) {
        class: InvalidAppDefinition,
        place: "앱 정의 JSON 읽기",
        cause: "JSON 문법이 올바르지 않다",
        message: "앱 정의 JSON을 읽지 못했습니다: {reason}",
        fix: "앱 정의의 JSON 구문을 고친 뒤 다시 올리세요"
    }
    APP_DEFINITION_FORMAT_INVALID(reason) {
        class: InvalidAppDefinition,
        place: "앱 정의 구조 읽기",
        cause: "JSON 값이 앱 정의 형식에 맞지 않는다",
        message: "앱 정의의 형식이 올바르지 않습니다: {reason}",
        fix: "안내된 필드와 값을 고친 뒤 다시 올리세요"
    }
    APP_DEFINITION_CHECK_FAILED() {
        class: InvalidAppDefinition,
        place: "앱 정의 의미 검사",
        cause: "앱 정의가 권한, 상태, 바인딩 또는 블록 검사에 걸렸다",
        message: "앱 정의가 검사에 걸렸습니다. 아래 항목을 고친 뒤 다시 올리세요.",
        fix: "아래 항목과 JSON 경로를 고쳐 다시 올리세요"
    }
    APP_DEFINITION_REQUIRES_NEWER_SHELL() {
        class: UnsupportedApp,
        place: "앱 정의 호환성 검사",
        cause: "앱 정의가 이 쉘에서 지원하지 않는 블록 또는 모듈 판을 요구한다",
        message: "앱 정의가 이 쉘보다 새 기능을 요구합니다. 쉘을 업데이트한 뒤 다시 올리세요.",
        fix: "쉘을 업데이트하거나 앱 정의의 요구 판을 낮추세요"
    }
}
