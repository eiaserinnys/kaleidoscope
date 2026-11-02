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
    SHELL_IPC_OPERATION_HEADER_INVALID() {
        class: InvalidRequest,
        place: "쉘 이진 요청 종류 확인",
        cause: "요청 종류 정보가 없거나 올바른 문자열이 아니다",
        message: "쉘 이진 요청 종류를 읽지 못했습니다. 요청을 다시 보내세요.",
        fix: "쉘 요청을 다시 보내세요"
    }
    SHELL_IPC_WINDOW_HEADER_INVALID() {
        class: InvalidRequest,
        place: "쉘 이진 요청 창 정보 확인",
        cause: "창 정보가 없거나 올바른 문자열이 아니다",
        message: "쉘 이진 요청의 창 정보를 읽지 못했습니다. 요청을 다시 보내세요.",
        fix: "쉘 요청을 다시 보내세요"
    }
    SHELL_IPC_HANDLE_HEADER_INVALID() {
        class: InvalidRequest,
        place: "쉘 이진 요청 대상 정보 확인",
        cause: "요청 대상 정보가 없거나 올바른 문자열이 아니다",
        message: "쉘 이진 요청의 대상 정보를 읽지 못했습니다. 요청을 다시 보내세요.",
        fix: "쉘 요청을 다시 보내세요"
    }
    SHELL_IPC_BODY_INVALID() {
        class: InvalidRequest,
        place: "쉘 이진 IPC 본문 확인",
        cause: "요청 본문이 raw 이진 데이터가 아니다",
        message: "쉘 이진 요청의 본문이 올바른 형식이 아닙니다. 이진 데이터를 다시 보내세요.",
        fix: "raw 이진 본문을 보내세요"
    }
    SHELL_IPC_EXPORT_OFFSET_INVALID() {
        class: InvalidRequest,
        place: "쉘 파일 내보내기 위치 확인",
        cause: "파일 쓰기에 필요한 위치가 없거나 숫자로 읽히지 않는다",
        message: "파일 내보내기 위치 정보가 없거나 올바르지 않아 쓸 수 없습니다. 내보내기를 다시 시작하세요.",
        fix: "내보내기를 다시 시작하세요"
    }
    SHELL_IPC_OPERATION_UNSUPPORTED() {
        class: InvalidRequest,
        place: "쉘 이진 요청 종류 확인",
        cause: "요청 종류가 지원되는 이진 작업이 아니다",
        message: "쉘에서 지원하지 않는 이진 작업입니다. 파일 읽기, 내보내기, HTTP 읽기 또는 Blob 저장을 사용하세요.",
        fix: "지원되는 이진 작업을 사용하세요"
    }
    SHELL_IPC_CORE_TASK_INTERRUPTED() {
        class: Io,
        place: "쉘 코어 요청 실행",
        cause: "백그라운드 코어 작업이 중단되었다",
        message: "쉘 코어 작업이 중단되어 요청을 마치지 못했습니다. 다시 시도하세요.",
        fix: "요청을 다시 시도하세요"
    }
    SHELL_IPC_BYTES_TASK_INTERRUPTED() {
        class: Io,
        place: "쉘 이진 IPC 작업 실행",
        cause: "백그라운드 이진 작업이 중단되었다",
        message: "쉘 이진 작업이 중단되어 요청을 마치지 못했습니다. 다시 시도하세요.",
        fix: "요청을 다시 시도하세요"
    }
}
