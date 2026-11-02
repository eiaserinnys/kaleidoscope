error_catalog! { ENTRIES;
    STORAGE_WRITE_SCHEMA_MISMATCH(key, reason) {
        class: InvalidRequest,
        place: "앱 저장소 JSON 항목 쓰기",
        cause: "쓴 값이 항목에 선언된 JSON 스키마를 만족하지 않는다",
        message: "저장 항목 {key}의 값이 앱이 선언한 형식과 다릅니다: {reason}",
        fix: "reason에 나온 JSON 위치의 값이나 앱 정의 스키마를 고치세요"
    }
}
