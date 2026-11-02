error_catalog! { ENTRIES;
    AGENT_CONTEXT_WINDOW_NOT_FOUND(window_id) {
        class: NotFound,
        place: "에이전트 창 설정 조회",
        cause: "에이전트 창이 현재 배치에 없다",
        message: "창 ID {window_id}: 에이전트 대화창을 찾지 못했습니다. 창 목록을 새로 불러오세요.",
        fix: "창 목록을 새로 불러오세요"
    }
    AGENT_CONTEXT_DESKTOP_NOT_FOUND(desktop_id) {
        class: NotFound,
        place: "에이전트 작업 조회",
        cause: "에이전트 창의 데스크톱이 현재 배치에 없다",
        message: "데스크톱 ID {desktop_id}: 에이전트 창의 작업을 찾지 못했습니다. 창을 다시 여세요.",
        fix: "창을 다시 여세요"
    }
    AGENT_CONTEXT_APP_VERSION_NOT_FOUND(app_id, version) {
        class: NotFound,
        place: "에이전트 앱 설정 조회",
        cause: "창에서 사용하는 앱 버전이 없다",
        message: "앱 ID {app_id}, 버전 {version}: 에이전트 설정을 찾지 못했습니다. 앱을 다시 가져오세요.",
        fix: "앱을 다시 가져오세요"
    }
    AGENT_SPEC_INVALID(reason) {
        class: InvalidRequest,
        place: "에이전트 설정 검사",
        cause: "선택한 에이전트 설정이 유효하지 않다",
        message: "에이전트 설정이 올바르지 않습니다. {reason} 설정을 고친 뒤 다시 선택하세요.",
        fix: "앱 정의의 에이전트 설정을 고치세요"
    }
    AGENT_ATTACH_CONTROLLER_NOT_FOUND(window_id) {
        class: NotFound,
        place: "에이전트 대화창 연결",
        cause: "연결할 창의 에이전트 실행기가 없다",
        message: "창 ID {window_id}: 에이전트 실행기를 찾지 못했습니다. 대화창을 다시 여세요.",
        fix: "대화창을 다시 여세요"
    }
    AGENT_ATTACH_CONTEXT_INVALID() {
        class: InvalidRequest,
        place: "에이전트 대화창 연결",
        cause: "창 앱에 에이전트 대화창 설정이 없다",
        message: "이 창의 앱에 에이전트 대화창 설정이 없습니다. 에이전트 대화 블록을 앱 정의에 추가하세요.",
        fix: "앱 정의에 에이전트 대화 블록을 추가하세요"
    }
    AGENT_ALLOW_CONTEXT_INVALID() {
        class: InvalidRequest,
        place: "에이전트 실행 허용",
        cause: "창 앱에 에이전트 대화창 설정이 없다",
        message: "이 창의 앱에 에이전트 대화창 설정이 없습니다. 앱 정의를 확인한 뒤 다시 시도하세요.",
        fix: "앱 정의의 에이전트 대화 설정을 확인하세요"
    }
    AGENT_ALLOW_REQUEST_STALE() {
        class: InvalidRequest,
        place: "에이전트 실행 허용",
        cause: "허용할 실행 요청이 현재 상태와 다르다",
        message: "현재 에이전트 실행 요청을 확인할 수 없습니다. 요청을 새로 열고 다시 허용하세요.",
        fix: "에이전트 실행 요청을 새로 여세요"
    }
    AGENT_SEND_CONTEXT_INVALID() {
        class: InvalidRequest,
        place: "에이전트 메시지 전송",
        cause: "창 앱에 에이전트 대화창 설정이 없다",
        message: "이 창의 앱에 에이전트 대화창 설정이 없습니다. 앱 정의를 확인한 뒤 다시 보내세요.",
        fix: "앱 정의의 에이전트 대화 설정을 확인하세요"
    }
    AGENT_ATTACHMENT_CONTEXT_INVALID() {
        class: InvalidRequest,
        place: "에이전트 첨부 파일 조회",
        cause: "창 앱에 에이전트 대화창 설정이 없다",
        message: "이 창의 앱에 에이전트 대화창 설정이 없습니다. 앱 정의를 확인한 뒤 다시 여세요.",
        fix: "앱 정의의 에이전트 대화 설정을 확인하세요"
    }
    AGENT_ATTACHMENT_HISTORY_MISSING(item_id, attachment_id) {
        class: NotFound,
        place: "에이전트 첨부 열기",
        cause: "대화 기록에 첨부 파일 이름이 없다",
        message: "대화 항목 {item_id}에서 첨부 {attachment_id}의 이름을 찾지 못했습니다. 대화를 새로 불러오세요.",
        fix: "대화를 새로 불러오세요"
    }
    AGENT_ATTACHMENT_OPEN_DIR_NOT_FOUND(reason) {
        class: NotFound,
        place: "에이전트 첨부 열기",
        cause: "첨부 파일을 둘 폴더를 찾지 못했다",
        message: "에이전트 첨부를 열 폴더를 찾지 못했습니다. 기기 저장 공간을 확인한 뒤 다시 여세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_ATTACHMENT_OPEN_DIR_FAILED(reason) {
        class: Io,
        place: "에이전트 첨부 열기",
        cause: "첨부 파일을 둘 폴더를 만들지 못했다",
        message: "에이전트 첨부를 열 폴더를 만들지 못했습니다. 기기 저장 공간을 확인한 뒤 다시 여세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_ATTACHMENT_OPEN_WRITE_NOT_FOUND(reason) {
        class: NotFound,
        place: "에이전트 첨부 열기",
        cause: "첨부 파일을 저장할 위치를 찾지 못했다",
        message: "에이전트 첨부를 저장할 위치를 찾지 못했습니다. 기기 저장 공간을 확인한 뒤 다시 여세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_ATTACHMENT_OPEN_WRITE_FAILED(reason) {
        class: Io,
        place: "에이전트 첨부 열기",
        cause: "첨부 파일을 저장하지 못했다",
        message: "에이전트 첨부를 저장하지 못했습니다. 기기 저장 공간을 확인한 뒤 다시 여세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_ATTACHMENT_OPEN_NOT_FOUND(reason) {
        class: NotFound,
        place: "에이전트 첨부 열기",
        cause: "기본 앱에서 첨부 파일을 열지 못했다",
        message: "기본 앱에서 에이전트 첨부 파일을 찾지 못했습니다. 파일이 있는지 확인한 뒤 다시 여세요. {reason}",
        fix: "첨부 파일이 있는지 확인하세요"
    }
    AGENT_ATTACHMENT_OPEN_FAILED(reason) {
        class: Io,
        place: "에이전트 첨부 열기",
        cause: "기본 앱에서 첨부 파일을 열지 못했다",
        message: "기본 앱에서 에이전트 첨부 파일을 열지 못했습니다. 기본 앱을 확인한 뒤 다시 여세요. {reason}",
        fix: "첨부 파일을 열 기본 앱을 확인하세요"
    }
    AGENT_COMMAND_UNKNOWN() {
        class: InvalidRequest,
        place: "에이전트 명령 실행",
        cause: "지원하지 않는 에이전트 명령이 전달됐다",
        message: "지원하지 않는 에이전트 명령입니다. 화면을 새로 불러온 뒤 다시 시도하세요.",
        fix: "화면을 새로 불러오세요"
    }
    AGENT_PROMPT_SEND_PHASE_INVALID() {
        class: InvalidRequest,
        place: "에이전트 메시지 전송",
        cause: "에이전트가 메시지를 받을 수 있는 상태가 아니다",
        message: "에이전트가 준비되지 않아 메시지를 보낼 수 없습니다. 준비가 끝난 뒤 다시 보내세요.",
        fix: "에이전트가 준비된 뒤 메시지를 다시 보내세요"
    }
    AGENT_PROMPT_SEND_CHANNEL_CLOSED() {
        class: LocalAgentFailed,
        place: "에이전트 메시지 전송",
        cause: "에이전트 실행기가 명령 채널을 닫았다",
        message: "에이전트 실행기가 메시지 전송을 중단했습니다. 실행기를 다시 시작한 뒤 보내세요.",
        fix: "에이전트 실행기를 다시 시작하세요"
    }
    AGENT_PROMPT_SEND_REPLY_CLOSED() {
        class: LocalAgentFailed,
        place: "에이전트 메시지 전송",
        cause: "에이전트 실행기가 전송 결과를 돌려주지 않았다",
        message: "에이전트가 메시지 전송 결과를 돌려주지 않았습니다. 실행기를 다시 시작한 뒤 보내세요.",
        fix: "에이전트 실행기를 다시 시작하세요"
    }
    AGENT_PERMISSION_REPLY_SAVE_FAILED(reason) {
        class: Io,
        place: "에이전트 권한 응답",
        cause: "권한 응답을 기록하지 못했다",
        message: "에이전트 권한 응답을 기록하지 못했습니다. 기기 저장 공간을 확인한 뒤 다시 선택하세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_PERMISSION_REPLY_REQUEST_NOT_FOUND(request_id) {
        class: InvalidRequest,
        place: "에이전트 권한 응답",
        cause: "응답할 권한 요청이 더 이상 대기 중이지 않다",
        message: "에이전트 권한 요청 ID {request_id}: 더 이상 대기 중이지 않습니다. 새 요청이 오면 다시 선택하세요.",
        fix: "새 권한 요청이 오면 선택하세요"
    }
    AGENT_PERMISSION_REPLY_OPTION_NOT_FOUND(option_id) {
        class: InvalidRequest,
        place: "에이전트 권한 응답",
        cause: "요청에 선택한 권한 선택지가 없다",
        message: "에이전트 권한 선택지 ID {option_id}: 현재 요청에 없습니다. 요청에 표시된 선택지를 누르세요.",
        fix: "요청에 표시된 선택지를 누르세요"
    }
    AGENT_CONTROL_UPDATE_CHANNEL_CLOSED() {
        class: LocalAgentFailed,
        place: "에이전트 설정 변경",
        cause: "에이전트 실행기가 설정 변경 명령을 받지 못했다",
        message: "에이전트 실행기가 설정 변경을 중단했습니다. 실행기를 다시 시작한 뒤 바꾸세요.",
        fix: "에이전트 실행기를 다시 시작하세요"
    }
    AGENT_CONTROL_UPDATE_PHASE_INVALID() {
        class: InvalidRequest,
        place: "에이전트 설정 변경",
        cause: "에이전트가 설정을 바꿀 수 있는 상태가 아니다",
        message: "에이전트가 준비되지 않아 설정을 바꿀 수 없습니다. 준비가 끝난 뒤 다시 선택하세요.",
        fix: "에이전트가 준비된 뒤 설정을 바꾸세요"
    }
    AGENT_CONTROL_UPDATE_ID_NOT_FOUND(control_id) {
        class: InvalidRequest,
        place: "에이전트 설정 변경",
        cause: "요청한 설정 항목이 없다",
        message: "에이전트 설정 ID {control_id}: 현재 선택할 수 없습니다. 설정 목록을 새로 불러온 뒤 다시 선택하세요.",
        fix: "설정 목록을 새로 불러온 뒤 다시 선택하세요"
    }
    AGENT_CONTROL_UPDATE_VALUE_INVALID(control_id) {
        class: InvalidRequest,
        place: "에이전트 설정 변경",
        cause: "선택한 값이 해당 설정의 선택지와 다르다",
        message: "에이전트 설정 ID {control_id}: 선택한 값이 현재 항목과 맞지 않습니다. 표시된 선택지에서 다시 고르세요.",
        fix: "표시된 선택지에서 다시 고르세요"
    }
    AGENT_AUTHENTICATE_PHASE_INVALID() {
        class: InvalidRequest,
        place: "에이전트 로그인",
        cause: "에이전트가 로그인 요청을 기다리고 있지 않다",
        message: "에이전트가 로그인 요청을 기다리고 있지 않습니다. 로그인 요청이 표시되면 다시 선택하세요.",
        fix: "에이전트가 로그인 요청을 표시하면 선택하세요"
    }
    AGENT_AUTHENTICATE_METHOD_NOT_FOUND(method_id) {
        class: InvalidRequest,
        place: "에이전트 로그인",
        cause: "요청한 로그인 방법이 선택지에 없다",
        message: "에이전트 로그인 방법 ID {method_id}: 현재 선택할 수 없습니다. 화면에 표시된 로그인 방법에서 다시 고르세요.",
        fix: "화면에 표시된 로그인 방법에서 다시 고르세요"
    }
    AGENT_AUTHENTICATE_CHANNEL_CLOSED() {
        class: LocalAgentFailed,
        place: "에이전트 로그인",
        cause: "에이전트 실행기가 로그인 명령을 받지 못했다",
        message: "에이전트 실행기가 로그인 요청을 중단했습니다. 실행기를 다시 시작한 뒤 로그인하세요.",
        fix: "에이전트 실행기를 다시 시작하세요"
    }
    AGENT_RETRY_UNAVAILABLE() {
        class: InvalidRequest,
        place: "에이전트 재시작",
        cause: "에이전트가 실패 상태가 아니다",
        message: "실패한 에이전트가 없어 다시 시작할 수 없습니다. 현재 상태를 확인하세요.",
        fix: "에이전트 상태를 확인하세요"
    }
    AGENT_RETRY_CHANNEL_CLOSED() {
        class: LocalAgentFailed,
        place: "에이전트 재시작",
        cause: "에이전트 실행기가 다시 시작 명령을 받지 못했다",
        message: "에이전트 실행기가 다시 시작 요청을 받지 못했습니다. 대화창을 다시 여세요.",
        fix: "에이전트 대화창을 다시 여세요"
    }
    AGENT_REQUEST_CONTROLLER_MISSING(window_id) {
        class: InvalidRequest,
        place: "에이전트 명령 연결",
        cause: "창에 연결된 에이전트 실행기가 없다",
        message: "창 ID {window_id}: 에이전트 실행기가 연결되지 않았습니다. 대화창을 다시 여세요.",
        fix: "대화창을 다시 여세요"
    }
    AGENT_REQUEST_GENERATION_STALE(window_id) {
        class: InvalidRequest,
        place: "에이전트 명령 연결",
        cause: "명령의 실행 세대가 현재 실행기와 다르다",
        message: "창 ID {window_id}: 에이전트 실행 상태가 바뀌었습니다. 대화창을 새로 불러온 뒤 다시 시도하세요.",
        fix: "대화창을 새로 불러오세요"
    }
    AGENT_REQUEST_WORKER_MISSING(window_id) {
        class: InvalidRequest,
        place: "에이전트 명령 연결",
        cause: "창에 실행 중인 에이전트 워커가 없다",
        message: "창 ID {window_id}: 실행 중인 에이전트가 없습니다. 대화창을 다시 여세요.",
        fix: "대화창을 다시 여세요"
    }
    AGENT_PROMPT_REQUEST_ID_MISSING() {
        class: InvalidRequest,
        place: "에이전트 메시지 검사",
        cause: "메시지 식별자가 비어 있다",
        message: "메시지 식별자가 비어 있습니다. 메시지를 다시 보내세요.",
        fix: "메시지를 다시 보내세요"
    }
    AGENT_PROMPT_CONTENT_EMPTY() {
        class: InvalidRequest,
        place: "에이전트 메시지 검사",
        cause: "글과 첨부 파일이 모두 비어 있다",
        message: "에이전트에 보낼 글과 첨부 파일이 없습니다. 글이나 파일을 추가해 보내세요.",
        fix: "글이나 파일을 추가하세요"
    }
    AGENT_PROMPT_TEXT_TOO_LONG(max_chars) {
        class: InvalidRequest,
        place: "에이전트 메시지 검사",
        cause: "메시지 글자 수가 제한을 넘었다",
        message: "에이전트 메시지가 {max_chars}자를 넘었습니다. 글을 줄인 뒤 다시 보내세요.",
        fix: "메시지 글을 줄이세요"
    }
    AGENT_PROMPT_TOO_MANY_ATTACHMENTS(max_count) {
        class: InvalidRequest,
        place: "에이전트 메시지 검사",
        cause: "첨부 파일 수가 제한을 넘었다",
        message: "에이전트 메시지는 첨부 파일을 {max_count}개까지만 보낼 수 있습니다. 파일 수를 줄이세요.",
        fix: "첨부 파일 수를 줄이세요"
    }
    AGENT_PROMPT_ATTACHMENT_NAME_EMPTY() {
        class: InvalidRequest,
        place: "에이전트 첨부 검사",
        cause: "첨부 파일 이름이 비어 있다",
        message: "첨부 파일 이름이 비어 있습니다. 파일을 다시 선택하세요.",
        fix: "첨부 파일을 다시 선택하세요"
    }
    AGENT_PROMPT_ATTACHMENT_ENCODING_INVALID() {
        class: InvalidRequest,
        place: "에이전트 첨부 검사",
        cause: "첨부 파일 데이터가 올바른 Base64 형식이 아니다",
        message: "첨부 파일 데이터를 읽지 못했습니다. 파일을 다시 선택해 보내세요.",
        fix: "파일을 다시 선택하세요"
    }
    AGENT_PROMPT_ATTACHMENT_TOO_LARGE(max_bytes) {
        class: InvalidRequest,
        place: "에이전트 첨부 검사",
        cause: "첨부 파일 하나가 허용 크기를 넘었다",
        message: "에이전트 첨부 파일 하나가 {max_bytes}바이트를 넘었습니다. 파일 크기를 줄이세요.",
        fix: "첨부 파일 크기를 줄이세요"
    }
    AGENT_PROMPT_ATTACHMENTS_TOTAL_TOO_LARGE(max_bytes) {
        class: InvalidRequest,
        place: "에이전트 첨부 검사",
        cause: "첨부 파일의 합계가 허용 크기를 넘었다",
        message: "에이전트 첨부 파일 합계가 {max_bytes}바이트를 넘었습니다. 파일 수나 크기를 줄이세요.",
        fix: "첨부 파일 수나 크기를 줄이세요"
    }
    AGENT_PROMPT_ATTACHMENT_DECODE_FAILED() {
        class: InvalidRequest,
        place: "에이전트 메시지 구성",
        cause: "첨부 파일 데이터를 디코딩하지 못했다",
        message: "에이전트 메시지에 첨부 파일을 넣지 못했습니다. 파일을 다시 선택해 보내세요.",
        fix: "파일을 다시 선택하세요"
    }
    AGENT_PROMPT_ATTACHMENT_PATH_INVALID() {
        class: Io,
        place: "에이전트 첨부 연결",
        cause: "기기 파일 경로를 에이전트가 읽을 주소로 바꾸지 못했다",
        message: "에이전트가 첨부 파일을 읽을 주소를 만들지 못했습니다. 파일을 다시 선택해 보내세요.",
        fix: "파일을 다시 선택하세요"
    }
    AGENT_PROMPT_RECORD_APPEND_FAILED(reason) {
        class: Io,
        place: "에이전트 메시지 기록",
        cause: "메시지 기록을 저장하지 못했다",
        message: "에이전트 메시지를 기록하지 못했습니다. 기기 저장 공간을 확인한 뒤 다시 보내세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_RECORD_DIRECTORY_NOT_FOUND(reason) {
        class: NotFound,
        place: "에이전트 기록 저장",
        cause: "기록을 저장할 폴더를 찾지 못했다",
        message: "에이전트 기록을 저장할 폴더를 찾지 못했습니다. 기기 저장 공간을 확인하세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_RECORD_DIRECTORY_CREATE_FAILED(reason) {
        class: Io,
        place: "에이전트 기록 저장",
        cause: "기록을 저장할 폴더를 만들지 못했다",
        message: "에이전트 기록을 저장할 폴더를 만들지 못했습니다. 기기 저장 공간을 확인하세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_ATTACHMENT_DATA_INVALID() {
        class: InvalidRequest,
        place: "에이전트 첨부 저장",
        cause: "첨부 파일 데이터가 올바른 Base64 형식이 아니다",
        message: "첨부 파일 데이터를 읽지 못했습니다. 파일을 다시 선택하세요.",
        fix: "파일을 다시 선택하세요"
    }
    AGENT_ATTACHMENT_DIRECTORY_NOT_FOUND(reason) {
        class: NotFound,
        place: "에이전트 첨부 저장",
        cause: "첨부 파일을 저장할 폴더를 찾지 못했다",
        message: "에이전트 첨부를 저장할 폴더를 찾지 못했습니다. 기기 저장 공간을 확인하세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_ATTACHMENT_DIRECTORY_CREATE_FAILED(reason) {
        class: Io,
        place: "에이전트 첨부 저장",
        cause: "첨부 파일을 저장할 폴더를 만들지 못했다",
        message: "에이전트 첨부를 저장할 폴더를 만들지 못했습니다. 기기 저장 공간을 확인하세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_ATTACHMENT_WRITE_NOT_FOUND(reason) {
        class: NotFound,
        place: "에이전트 첨부 저장",
        cause: "첨부 파일을 저장할 위치를 찾지 못했다",
        message: "에이전트 첨부를 저장할 위치를 찾지 못했습니다. 기기 저장 공간을 확인하세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_ATTACHMENT_WRITE_FAILED(reason) {
        class: Io,
        place: "에이전트 첨부 저장",
        cause: "첨부 파일을 저장하지 못했다",
        message: "에이전트 첨부를 저장하지 못했습니다. 기기 저장 공간을 확인하세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_ATTACHMENT_NOT_FOUND(item_id, attachment_id) {
        class: NotFound,
        place: "에이전트 첨부 파일 조회",
        cause: "대화 기록에 첨부 파일이 없다",
        message: "대화 항목 {item_id}에서 첨부 {attachment_id} 정보를 찾지 못했습니다. 대화를 새로 불러오세요.",
        fix: "대화를 새로 불러오세요"
    }
    AGENT_ATTACHMENT_READ_NOT_FOUND(reason) {
        class: NotFound,
        place: "에이전트 첨부 파일 읽기",
        cause: "기록된 첨부 파일이 기기에 없다",
        message: "기록된 에이전트 첨부 파일을 찾지 못했습니다. 대화를 새로 불러오세요. {reason}",
        fix: "대화를 새로 불러오세요"
    }
    AGENT_ATTACHMENT_READ_FAILED(reason) {
        class: Io,
        place: "에이전트 첨부 파일 읽기",
        cause: "기록된 첨부 파일을 읽지 못했다",
        message: "기록된 에이전트 첨부 파일을 읽지 못했습니다. 기기 저장 공간을 확인하세요. {reason}",
        fix: "기기 저장 공간을 확인하세요"
    }
    AGENT_PROMPT_SEND_NOT_READY() {
        class: InvalidRequest,
        place: "에이전트 메시지 전송",
        cause: "에이전트가 메시지를 받을 수 있는 상태가 아니다",
        message: "에이전트가 준비되지 않아 메시지를 보낼 수 없습니다. 준비가 끝난 뒤 다시 보내세요.",
        fix: "에이전트가 준비된 뒤 메시지를 다시 보내세요"
    }
    AGENT_PERMISSION_RESPONSE_NOT_FOUND() {
        class: InvalidRequest,
        place: "에이전트 권한 응답",
        cause: "대기 중인 권한 요청이 없다",
        message: "응답할 에이전트 권한 요청이 없습니다. 새 요청이 오면 다시 선택하세요.",
        fix: "새 권한 요청이 오면 선택하세요"
    }
    AGENT_PROMPT_QUEUE_UNAVAILABLE() {
        class: LocalAgentFailed,
        place: "에이전트 메시지 대기열",
        cause: "실행 중인 에이전트가 메시지를 처리하지 못했다",
        message: "에이전트가 메시지를 처리하지 못했습니다. 실행기를 다시 시작한 뒤 보내세요.",
        fix: "에이전트 실행기를 다시 시작하세요"
    }
    AGENT_START_COMMAND_NOT_FOUND(command, reason) {
        class: LocalAgentFailed,
        place: "에이전트 실행 시작",
        cause: "설정한 실행 명령을 찾지 못했다",
        message: "에이전트 실행 명령을 찾지 못했습니다: {command}. 앱 설정에서 설치된 명령 위치를 확인하세요. {reason}",
        fix: "앱 설정에서 에이전트 실행 명령을 확인하세요"
    }
    AGENT_START_PROCESS_FAILED(agent, command, reason) {
        class: LocalAgentFailed,
        place: "에이전트 실행 시작",
        cause: "에이전트 프로세스를 시작하지 못했다",
        message: "에이전트 {agent} 프로세스를 시작하지 못했습니다. 실행 명령: {command}. 기기 권한도 확인하세요. {reason}",
        fix: "실행 명령과 기기 권한을 확인하세요"
    }
    AGENT_ACP_PROTOCOL_FAILED(agent, reason) {
        class: LocalAgentFailed,
        place: "에이전트 ACP 응답 처리",
        cause: "에이전트가 보낸 ACP 응답을 처리하지 못했다",
        message: "에이전트 {agent}의 응답을 처리하지 못했습니다. 에이전트 설정과 출력을 확인하세요. {reason}",
        fix: "에이전트 설정과 출력을 확인하세요"
    }
    AGENT_LOGIN_AUTHENTICATE_FAILED(agent, reason) {
        class: LoginRequired,
        place: "에이전트 로그인",
        cause: "에이전트가 로그인 요청을 거부했다",
        message: "에이전트 {agent} 로그인이 완료되지 않았습니다. 에이전트에서 로그인을 마친 뒤 다시 시도하세요. {reason}",
        fix: "에이전트에서 로그인을 마치세요"
    }
}
