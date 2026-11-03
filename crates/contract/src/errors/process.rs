error_catalog! { ENTRIES;
    PROCESS_START_WINDOW_MISSING() { class: NotFound, place: "프로그램 실행", cause: "창이 없다", message: "프로그램을 실행할 창을 찾지 못했습니다. 창을 다시 여세요.", fix: "창을 다시 여세요" }
    PROCESS_START_APP_VERSION_MISSING() { class: NotFound, place: "프로그램 실행 앱 조회", cause: "창의 앱 버전이 없다", message: "프로그램을 실행할 앱 버전을 찾지 못했습니다. 앱을 다시 여세요.", fix: "앱을 다시 여세요" }
    PROCESS_START_PERMISSION_UNDECLARED(permission) { class: PermissionDenied, place: "프로그램 실행 권한", cause: "앱이 실행 권한을 선언하지 않았다", message: "실행 권한 {permission}이 앱에 선언되지 않았습니다. 앱 정의를 고치세요.", fix: "앱 정의에 실행 권한을 선언하세요" }
    PROCESS_START_CLIENT_PERMISSION_UNDECLARED(permission) { class: PermissionDenied, place: "클라이언트 실행 권한", cause: "클라이언트가 실행 권한을 선언하지 않았다", message: "클라이언트에 실행 권한 {permission}이 선언되지 않았습니다. 앱 정의를 고치세요.", fix: "client.process_permissions에 권한을 선언하세요" }
    PROCESS_START_APP_CHANGED() { class: Conflict, place: "프로그램 실행 허용", cause: "허용 대기 중 창의 앱이 바뀌었다", message: "허용을 기다리는 동안 창의 앱이 바뀌었습니다. 새 앱에서 다시 실행하세요.", fix: "새 앱에서 다시 실행하세요" }
    PROCESS_START_SERVICES_UNSUPPORTED() { class: InvalidRequest, place: "프로그램 서비스", cause: "이 판은 서비스 연결을 지원하지 않는다", message: "프로그램에 서비스 연결을 제공할 수 없습니다. 앱 정의에서 서비스를 빼고 다시 실행하세요.", fix: "서비스 요청을 빼세요" }
    PROCESS_START_COMMAND_NOT_FOUND(command) { class: NotFound, place: "프로그램 실행", cause: "명령을 찾지 못했다", message: "프로그램 {command}을 찾지 못했습니다. 이 PC에 설치되어 있는지 확인하세요.", fix: "이 PC에 설치되어 있는지 확인하세요" }
    PROCESS_START_SPAWN_NOT_FOUND(command, reason) { class: NotFound, place: "프로그램 프로세스 생성", cause: "프로그램 실행에 필요한 파일이 없다", message: "프로그램 {command}을 실행하는 데 필요한 파일을 찾지 못했습니다. 설치와 실행 환경을 확인하세요. 원인: {reason}", fix: "설치와 실행 환경을 확인하세요" }
    PROCESS_START_SPAWN_PERMISSION_DENIED(command, reason) { class: PermissionDenied, place: "프로그램 실행", cause: "운영체제가 프로그램 실행 권한을 거부했다", message: "프로그램 {command}을 실행할 권한이 없습니다. 이 PC의 실행 권한을 확인하세요. 원인: {reason}", fix: "이 PC의 실행 권한을 확인하세요" }
    PROCESS_START_SPAWN_FAILED(command, reason) { class: Io, place: "프로그램 실행", cause: "운영체제가 프로세스를 시작하지 못했다", message: "프로그램 {command}을 실행하지 못했습니다. 원인을 확인한 뒤 다시 실행하세요. 원인: {reason}", fix: "원인을 확인한 뒤 다시 실행하세요" }
    PROCESS_START_PERMISSION_CANCELLED() { class: Unavailable, place: "프로그램 실행 허용 대기", cause: "허용 요청이 닫혔다", message: "프로그램 실행 허용 요청이 닫혔습니다. 창을 다시 열고 실행하세요.", fix: "창을 다시 열고 실행하세요" }
    PROCESS_START_WORKER_STOPPED() { class: Unavailable, place: "프로그램 실행 준비", cause: "프로세스 실행기가 시작 결과를 보내지 못했다", message: "프로그램 실행기를 준비하지 못했습니다. 프로그램을 다시 실행하세요.", fix: "프로그램을 다시 실행하세요" }
    PROCESS_RESPOND_REQUEST_MISSING() { class: NotFound, place: "프로그램 실행 허용 응답", cause: "허용 요청이 없다", message: "프로그램 실행 허용 요청을 찾지 못했습니다. 프로그램을 다시 실행하세요.", fix: "프로그램을 다시 실행하세요" }
    PROCESS_RESPOND_REQUEST_CLOSED() { class: Unavailable, place: "프로그램 실행 허용 전달", cause: "실행 요청이 이미 닫혔다", message: "닫힌 프로그램 실행 요청에 허용을 전달할 수 없습니다. 프로그램을 다시 실행하세요.", fix: "프로그램을 다시 실행하세요" }
    PROCESS_READ_HANDLE_MISSING() { class: NotFound, place: "프로그램 출력 읽기", cause: "이 창의 프로세스가 없다", message: "이 창에서 프로그램 출력을 찾지 못했습니다. 프로그램을 다시 시작하세요.", fix: "프로그램을 다시 시작하세요" }
    PROCESS_READ_CURSOR_INVALID() { class: InvalidRequest, place: "프로그램 출력 읽기", cause: "출력 위치가 버퍼 범위 밖이다", message: "프로그램 출력 위치가 올바르지 않습니다. 프로그램에 다시 연결하세요.", fix: "프로그램에 다시 연결하세요" }
    PROCESS_ACK_HANDLE_MISSING() { class: NotFound, place: "프로그램 출력 확인", cause: "이 창의 프로세스가 없다", message: "이 창에서 확인할 프로그램을 찾지 못했습니다. 프로그램을 다시 시작하세요.", fix: "프로그램을 다시 시작하세요" }
    PROCESS_ACK_CURSOR_INVALID() { class: InvalidRequest, place: "프로그램 출력 확인", cause: "확인 위치가 버퍼 범위 밖이다", message: "프로그램 출력 확인 위치가 올바르지 않습니다. 프로그램에 다시 연결하세요.", fix: "프로그램에 다시 연결하세요" }
    PROCESS_WRITE_HANDLE_MISSING() { class: NotFound, place: "프로그램 입력", cause: "이 창의 프로세스가 없다", message: "이 창에서 입력할 프로그램을 찾지 못했습니다. 프로그램을 다시 시작하세요.", fix: "프로그램을 다시 시작하세요" }
    PROCESS_WRITE_INPUT_CLOSED() { class: Unavailable, place: "프로그램 입력", cause: "프로그램 입력이 닫혔다", message: "프로그램 입력이 닫혀 내용을 보낼 수 없습니다. 프로그램을 다시 시작하세요.", fix: "프로그램을 다시 시작하세요" }
    PROCESS_WRITE_HEADER_MISSING() { class: InvalidRequest, place: "프로그램 입력 헤더", cause: "checkpoint 길이 헤더가 없다", message: "프로그램 입력에 상태 길이가 빠졌습니다. 앱 코드를 확인하세요.", fix: "앱 코드의 입력 형식을 확인하세요" }
    PROCESS_WRITE_CHECKPOINT_TRUNCATED() { class: InvalidRequest, place: "프로그램 입력 상태 길이", cause: "선언한 길이보다 checkpoint가 짧다", message: "프로그램 입력에 포함된 상태가 중간에 끊겼습니다. 앱 코드를 확인하세요.", fix: "앱 코드의 입력 형식을 확인하세요" }
    PROCESS_WRITE_CHECKPOINT_JSON_INVALID() { class: InvalidRequest, place: "프로그램 입력 상태 해석", cause: "checkpoint가 올바른 JSON이 아니다", message: "프로그램 입력에 포함된 상태를 JSON으로 읽을 수 없습니다. 앱 코드를 확인하세요.", fix: "앱 코드의 checkpoint를 확인하세요" }
    PROCESS_CLOSE_INPUT_HANDLE_MISSING() { class: NotFound, place: "프로그램 입력 닫기", cause: "이 창의 프로세스가 없다", message: "이 창에서 입력을 닫을 프로그램을 찾지 못했습니다. 프로그램을 다시 시작하세요.", fix: "프로그램을 다시 시작하세요" }
    PROCESS_STOP_HANDLE_MISSING() { class: NotFound, place: "프로그램 중지", cause: "이 창의 프로세스가 없다", message: "이 창에서 중지할 프로그램을 찾지 못했습니다. 프로그램 목록을 다시 확인하세요.", fix: "프로그램 목록을 다시 확인하세요" }
}
