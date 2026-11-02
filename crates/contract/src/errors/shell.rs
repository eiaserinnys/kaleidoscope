error_catalog! { ENTRIES;
    SHELL_CALL_UNEXPECTED_FAILURE(reason) {
        class: Io,
        place: "쉘 코어 호출 응답 처리",
        cause: "호출에서 코어 오류 형식이 아닌 예외가 발생했다",
        message: "쉘에서 예상하지 못한 오류가 났습니다: {reason}",
        fix: "표시된 원인을 확인하고 다시 시도하세요"
    }
}
