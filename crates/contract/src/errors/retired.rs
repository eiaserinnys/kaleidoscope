pub const RETIRED: &[(&str, &str)] = &[
    (
        "AGENT_CONTEXT_WINDOW_NOT_FOUND",
        "일반 process 실행 경로의 PROCESS_START_WINDOW_MISSING 코드로 통합했다",
    ),
    (
        "AGENT_CONTEXT_DESKTOP_NOT_FOUND",
        "일반 process 실행 경로의 PROCESS_START_DESKTOP_MISSING 코드로 통합했다",
    ),
    (
        "AGENT_CONTEXT_APP_VERSION_NOT_FOUND",
        "일반 process 실행 경로의 PROCESS_START_APP_VERSION_MISSING 코드로 통합했다",
    ),
    ("AGENT_SPEC_INVALID", "옛 쉘 에이전트 실행 경로를 제거했다"),
    (
        "AGENT_ATTACH_CONTROLLER_NOT_FOUND",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_ATTACH_CONTEXT_INVALID",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_ALLOW_CONTEXT_INVALID",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_ALLOW_REQUEST_STALE",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_SEND_CONTEXT_INVALID",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_CONTEXT_INVALID",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_HISTORY_MISSING",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_OPEN_DIR_NOT_FOUND",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_OPEN_DIR_FAILED",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_OPEN_WRITE_NOT_FOUND",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_OPEN_WRITE_FAILED",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_OPEN_NOT_FOUND",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_OPEN_FAILED",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_COMMAND_UNKNOWN",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_PROMPT_SEND_PHASE_INVALID",
        "옛 쉘 대화 프로토콜을 제거했다",
    ),
    (
        "AGENT_PROMPT_SEND_CHANNEL_CLOSED",
        "일반 process 실행 경로의 PROCESS_WRITE_INPUT_CLOSED 코드로 통합했다",
    ),
    (
        "AGENT_PROMPT_SEND_REPLY_CLOSED",
        "일반 process 실행 경로의 PROCESS_WRITE_INPUT_CLOSED 코드로 통합했다",
    ),
    (
        "AGENT_PERMISSION_REPLY_SAVE_FAILED",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_PERMISSION_REPLY_REQUEST_NOT_FOUND",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_PERMISSION_REPLY_OPTION_NOT_FOUND",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_CONTROL_UPDATE_CHANNEL_CLOSED",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_CONTROL_UPDATE_PHASE_INVALID",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_CONTROL_UPDATE_ID_NOT_FOUND",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_CONTROL_UPDATE_VALUE_INVALID",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_AUTHENTICATE_PHASE_INVALID",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_AUTHENTICATE_METHOD_NOT_FOUND",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_AUTHENTICATE_CHANNEL_CLOSED",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_RETRY_UNAVAILABLE",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_RETRY_CHANNEL_CLOSED",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_REQUEST_CONTROLLER_MISSING",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_REQUEST_GENERATION_STALE",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_REQUEST_WORKER_MISSING",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_PROMPT_REQUEST_ID_MISSING",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_PROMPT_CONTENT_EMPTY",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_PROMPT_TEXT_TOO_LONG",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_PROMPT_TOO_MANY_ATTACHMENTS",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_PROMPT_ATTACHMENT_NAME_EMPTY",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_PROMPT_ATTACHMENT_ENCODING_INVALID",
        "옛 쉘 대화 프로토콜을 제거했다",
    ),
    (
        "AGENT_PROMPT_ATTACHMENT_TOO_LARGE",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_PROMPT_ATTACHMENTS_TOTAL_TOO_LARGE",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_PROMPT_ATTACHMENT_DECODE_FAILED",
        "옛 쉘 대화 프로토콜을 제거했다",
    ),
    (
        "AGENT_PROMPT_ATTACHMENT_PATH_INVALID",
        "옛 쉘 대화 프로토콜을 제거했다",
    ),
    (
        "AGENT_PROMPT_RECORD_APPEND_FAILED",
        "대화 기록을 앱의 창 저장소로 옮기며 쉘 기록 코드를 제거했다",
    ),
    (
        "AGENT_RECORD_DIRECTORY_NOT_FOUND",
        "대화 기록을 앱의 창 저장소로 옮기며 쉘 기록 코드를 제거했다",
    ),
    (
        "AGENT_RECORD_DIRECTORY_CREATE_FAILED",
        "대화 기록을 앱의 창 저장소로 옮기며 쉘 기록 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_DATA_INVALID",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_DIRECTORY_NOT_FOUND",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_DIRECTORY_CREATE_FAILED",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_WRITE_NOT_FOUND",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_WRITE_FAILED",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_NOT_FOUND",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_ATTACHMENT_READ_NOT_FOUND",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_ATTACHMENT_READ_FAILED",
        "첨부 처리를 앱 자산의 창 저장소로 옮기며 쉘 코드를 제거했다",
    ),
    (
        "AGENT_PROMPT_SEND_NOT_READY",
        "앱 자산 apps/agent-client/src/errors.ts로 옮겼으며 같은 id를 유지한다",
    ),
    (
        "AGENT_PERMISSION_RESPONSE_NOT_FOUND",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_PROMPT_QUEUE_UNAVAILABLE",
        "옛 쉘 대화 프로토콜을 제거했다",
    ),
    (
        "AGENT_START_COMMAND_NOT_FOUND",
        "일반 process 실행 경로의 PROCESS_START_COMMAND_NOT_FOUND 코드로 통합했다",
    ),
    (
        "AGENT_START_PROCESS_FAILED",
        "일반 process 실행 경로의 PROCESS_START_SPAWN_FAILED 코드로 통합했다",
    ),
    (
        "AGENT_ACP_PROTOCOL_FAILED",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "AGENT_LOGIN_AUTHENTICATE_FAILED",
        "옛 쉘 에이전트 실행 경로를 제거했다",
    ),
    (
        "SHELL_AGENT_SESSION_ATTACH_REPLY_INVALID",
        "옛 로컬 실행 모듈을 제거해 쉘 전용 응답 코드를 없앴다",
    ),
    (
        "SHELL_AGENT_SESSION_ATTACHMENT_REPLY_INVALID",
        "옛 로컬 실행 모듈을 제거해 쉘 전용 응답 코드를 없앴다",
    ),
    (
        "SHELL_AGENT_SESSION_FAILURE_DETAILS_MISSING",
        "옛 로컬 실행 모듈을 제거해 쉘 전용 응답 코드를 없앴다",
    ),
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
