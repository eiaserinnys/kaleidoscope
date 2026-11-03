pub const RETIRED: &[(&str, &str)] = &[
    (
        "CONN_RELAY_WRITE_DENIED",
        "앱 권한과 연결 설정의 쓰기 거절을 분리했다",
    ),
    (
        "STORAGE_SERVER_REQUEST_FAILED",
        "저장소 요청의 전송, 상태, 읽기 실패를 분리했다",
    ),
    (
        "SERVER_DATABASE_OPERATION_FAILED",
        "저장소 동작마다 별도 코드로 분리했다",
    ),
    (
        "CONV_CONTEXT_ADOPTION_CONFLICT",
        "도달하지 못하는 분기를 제거하고 기존 응답 분류를 유지했다",
    ),
];
