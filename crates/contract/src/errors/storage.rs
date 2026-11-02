error_catalog! { ENTRIES;
    STORAGE_WRITE_SCHEMA_MISMATCH(key, reason) {
        class: InvalidRequest,
        place: "앱 저장소 JSON 항목 쓰기",
        cause: "쓴 값이 항목에 선언된 JSON 스키마를 만족하지 않는다",
        message: "저장 항목 {key}의 값이 앱 선언과 맞지 않습니다. {reason} 값을 고쳐 다시 저장하세요.",
        fix: "앱 정의의 저장소 스키마와 저장하는 값을 대조해 고치세요"
    }
}
