error_catalog! { ENTRIES;
    SHELL_THREAD_READ_INVALID(name) {
        class: InvalidRequest,
        place: "HTML 문서 커멘트 읽기",
        cause: "thread.json을 JSON으로 읽을 수 없거나 커멘트 문서 구조가 올바르지 않다",
        message: "문서 {name}의 thread.json 형식이 올바르지 않습니다. 파일을 고쳐 다시 저장하세요.",
        fix: "thread.json 파일을 고쳐 다시 저장하세요"
    }
    SHELL_CALL_UNEXPECTED_FAILURE(reason) {
        class: Io,
        place: "쉘 코어 호출 응답 처리",
        cause: "호출에서 코어 오류 형식이 아닌 예외가 발생했다",
        message: "쉘에서 예상하지 못한 오류가 났습니다: {reason}",
        fix: "표시된 원인을 확인하고 다시 시도하세요"
    }
}
