error_catalog! { ENTRIES;
    DESK_WORKSPACE_RENAME_NOT_FOUND(workspace_id) {
        class: NotFound,
        place: "작업 이름 바꾸기",
        cause: "이름을 바꿀 작업이 현재 상태에 없다",
        message: "이름을 바꿀 작업이 더 이상 없습니다. 다른 기기에서 지웠을 수 있습니다. 작업 메뉴에서 남은 작업을 고르세요.",
        fix: "작업 메뉴에서 남은 작업을 고르세요"
    }
    DESK_WORKSPACE_DELETE_LAST() {
        class: InvalidRequest,
        place: "작업 삭제",
        cause: "마지막 작업을 지우려 했다",
        message: "마지막 작업은 지울 수 없습니다. 새 작업을 먼저 만드세요.",
        fix: "새 작업을 만든 뒤 삭제하세요"
    }
    DESK_WORKSPACE_DELETE_NOT_FOUND(workspace_id) {
        class: NotFound,
        place: "작업 삭제",
        cause: "지우려는 작업이 현재 상태에 없다",
        message: "지울 작업이 이미 없습니다. 다른 기기에서 지웠을 수 있습니다. 추가 조치는 필요하지 않습니다.",
        fix: "추가 조치는 필요하지 않습니다"
    }
    DESK_WORKSPACE_DELETE_ACTIVE_DESKTOP_MISSING(workspace_name) {
        class: NotFound,
        place: "작업 삭제 뒤 활성 데스크톱 선택",
        cause: "남은 작업에 활성 데스크톱이 없다",
        message: "작업 이름 {workspace_name}: 데스크톱이 없어 이 작업으로 옮겨 갈 수 없습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    DESK_WORKSPACE_ACTIVATE_NOT_FOUND(workspace_id) {
        class: NotFound,
        place: "작업 전환",
        cause: "전환할 작업이 현재 상태에 없다",
        message: "전환할 작업이 더 이상 없습니다. 다른 기기에서 지웠을 수 있습니다. 작업 메뉴에서 남은 작업을 고르세요.",
        fix: "작업 메뉴에서 남은 작업을 고르세요"
    }
    DESK_WORKSPACE_ACTIVATE_DESKTOP_MISSING(workspace_name) {
        class: NotFound,
        place: "작업 전환",
        cause: "전환할 작업에 데스크톱이 없다",
        message: "작업 이름 {workspace_name}: 데스크톱이 없어 전환할 수 없습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    DESK_DESKTOP_CREATE_WORKSPACE_NOT_FOUND(workspace_id) {
        class: NotFound,
        place: "데스크톱 만들기",
        cause: "데스크톱을 만들 작업이 없다",
        message: "데스크톱을 만들 작업이 더 이상 없습니다. 다른 기기에서 지웠을 수 있습니다. 작업 메뉴에서 남은 작업을 고르세요.",
        fix: "작업 메뉴에서 남은 작업을 고르세요"
    }
    DESK_DESKTOP_RENAME_NOT_FOUND(desktop_id) {
        class: NotFound,
        place: "데스크톱 이름 바꾸기",
        cause: "이름을 바꿀 데스크톱이 현재 상태에 없다",
        message: "이름을 바꿀 데스크톱이 더 이상 없습니다. 다른 기기에서 지웠을 수 있습니다. 남은 데스크톱 탭을 고르세요.",
        fix: "남은 데스크톱 탭을 고르세요"
    }
    DESK_DESKTOP_DELETE_NOT_FOUND(desktop_id) {
        class: NotFound,
        place: "데스크톱 삭제",
        cause: "지우려는 데스크톱이 현재 상태에 없다",
        message: "지울 데스크톱이 이미 없습니다. 다른 기기에서 지웠을 수 있습니다. 추가 조치는 필요하지 않습니다.",
        fix: "추가 조치는 필요하지 않습니다"
    }
    DESK_DESKTOP_DELETE_LAST() {
        class: InvalidRequest,
        place: "데스크톱 삭제",
        cause: "마지막 데스크톱을 지우려 했다",
        message: "마지막 데스크톱은 지울 수 없습니다. 새 데스크톱을 먼저 만드세요.",
        fix: "새 데스크톱을 만든 뒤 삭제하세요"
    }
    DESK_DESKTOP_DELETE_REPLACEMENT_MISSING(workspace_name) {
        class: NotFound,
        place: "데스크톱 삭제 뒤 활성 데스크톱 선택",
        cause: "지운 데스크톱을 대신할 데스크톱이 없다",
        message: "작업 이름 {workspace_name}: 지운 뒤 옮겨 갈 데스크톱이 없습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    DESK_DESKTOP_ACTIVATE_NOT_FOUND(desktop_id) {
        class: NotFound,
        place: "데스크톱 전환",
        cause: "전환할 데스크톱이 현재 상태에 없다",
        message: "전환할 데스크톱이 더 이상 없습니다. 다른 기기에서 지웠을 수 있습니다. 남은 데스크톱 탭을 고르세요.",
        fix: "남은 데스크톱 탭을 고르세요"
    }
    DESK_WINDOW_OPEN_DESKTOP_NOT_FOUND(desktop_id) {
        class: NotFound,
        place: "앱 창 열기",
        cause: "창을 열 데스크톱이 현재 상태에 없다",
        message: "창을 열 데스크톱이 더 이상 없습니다. 다른 기기에서 지웠을 수 있습니다. 남은 데스크톱 탭을 고른 뒤 앱을 다시 여세요.",
        fix: "남은 데스크톱 탭을 고른 뒤 앱을 다시 여세요"
    }
    DESK_WINDOW_OPEN_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "앱 창 열기",
        cause: "열 앱이 현재 상태에 없다",
        message: "열려는 앱이 더 이상 없습니다: {app_id}. 서버에서 지워졌을 수 있습니다. 앱 열기에서 남은 앱을 고르세요.",
        fix: "앱 열기에서 남은 앱을 고르세요"
    }
    DESK_WINDOW_OPEN_APP_VERSION_NOT_FOUND(app_id, version) {
        class: NotFound,
        place: "앱 창 열기",
        cause: "열 앱의 현재 버전 정의가 없다",
        message: "앱 {app_name}의 {version}판 정의가 이 쉘에 없어 창을 열지 못했습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    DESK_WINDOW_SET_RECT_NOT_FOUND(window_id) {
        class: NotFound,
        place: "창 크기와 위치 변경",
        cause: "크기나 위치를 바꿀 창이 현재 상태에 없다",
        message: "크기와 위치를 바꿀 창이 더 이상 없습니다. 다른 기기에서 닫았을 수 있습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DESK_WINDOW_RAISE_NOT_FOUND(window_id) {
        class: NotFound,
        place: "창 앞으로 가져오기",
        cause: "앞으로 가져올 창이 현재 상태에 없다",
        message: "앞으로 가져올 창이 더 이상 없습니다. 다른 기기에서 닫았을 수 있습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DESK_WINDOW_MINIMIZE_NOT_FOUND(window_id) {
        class: NotFound,
        place: "창 최소화",
        cause: "최소화할 창이 현재 상태에 없다",
        message: "최소화할 창이 더 이상 없습니다. 다른 기기에서 닫았을 수 있습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DESK_WINDOW_MAXIMIZE_NOT_FOUND(window_id) {
        class: NotFound,
        place: "창 최대화",
        cause: "최대화할 창이 현재 상태에 없다",
        message: "최대화할 창이 더 이상 없습니다. 다른 기기에서 닫았을 수 있습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DESK_WINDOW_RESTORE_NOT_FOUND(window_id) {
        class: NotFound,
        place: "창 원래 크기로 복원",
        cause: "복원할 창이 현재 상태에 없다",
        message: "복원할 창이 더 이상 없습니다. 다른 기기에서 닫았을 수 있습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DESK_WINDOW_CLOSE_NOT_FOUND(window_id) {
        class: NotFound,
        place: "창 닫기",
        cause: "닫을 창이 현재 상태에 없다",
        message: "닫을 창이 이미 없습니다. 다른 기기에서 닫았을 수 있습니다. 추가 조치는 필요하지 않습니다.",
        fix: "추가 조치는 필요하지 않습니다"
    }
    DESK_WINDOW_STATE_WINDOW_NOT_FOUND(window_id) {
        class: NotFound,
        place: "창 상태 쓰기",
        cause: "상태를 쓸 창이 현재 상태에 없다",
        message: "상태를 저장할 창이 더 이상 없습니다. 다른 기기에서 닫았을 수 있습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    DESK_WINDOW_STATE_APP_VERSION_NOT_FOUND(app_id, version) {
        class: NotFound,
        place: "창 상태 쓰기",
        cause: "창에서 사용하는 앱 버전 정의가 없다",
        message: "앱 {app_id}의 {version}판 정의가 이 쉘에 없어 창 상태를 저장하지 못했습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    DESK_WINDOW_STATE_KEY_NOT_DECLARED(window_id, key) {
        class: InvalidRequest,
        place: "창 상태 키 검사",
        cause: "창 상태에 앱 정의가 선언하지 않은 키가 있다",
        message: "앱 ID {app_id}, 상태 키 {key}: 앱 정의 state에 없습니다. 앱 정의 state에 이 키를 더하세요.",
        fix: "앱 정의 state에 이 키를 더하세요"
    }
    DESK_WINDOW_STATE_SERIALIZATION_FAILED(window_id) {
        class: InvalidRequest,
        place: "창 상태 쓰기",
        cause: "창 상태를 JSON으로 만들 수 없다",
        message: "앱 ID {app_id}: 창 상태를 JSON으로 바꾸지 못했습니다. 앱 코드가 창 상태에 넣는 값을 고치세요.",
        fix: "앱 코드가 창 상태에 넣는 값을 고치세요"
    }
    DESK_WINDOW_STATE_TOO_LARGE(window_id, max_bytes) {
        class: InvalidRequest,
        place: "창 상태 크기 검사",
        cause: "창 상태가 허용 크기를 넘는다",
        message: "앱 ID {app_id}: 창 상태가 허용 크기 {limit}보다 큽니다. 앱 정의나 앱 코드가 창 상태에 넣는 값을 줄이세요.",
        fix: "앱 정의나 앱 코드가 창 상태에 넣는 값을 줄이세요"
    }
    DESK_LINK_COMMAND_UNHANDLED() {
        class: Server,
        place: "서버 연결 명령 전달",
        cause: "서버 연결 명령이 연결 처리기에 전달되지 않았다",
        message: "서버 연결 명령이 쉘 안에서 처리기에 전달되지 않았습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    DESK_STATE_COMMAND_UNHANDLED() {
        class: InvalidRequest,
        place: "작업 상태 명령 전달",
        cause: "작업 상태 처리기가 명령을 받지 않았다",
        message: "작업 상태 명령이 쉘 안에서 처리기에 전달되지 않았습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    DESK_LOCAL_LINK_READ_FAILED() {
        class: Io,
        place: "기기 연결 정보 읽기",
        cause: "기기 연결 정보 파일을 읽지 못했다",
        message: "서버 연결 정보 파일을 읽지 못했습니다. 파일 관리자에서 열리는지 확인한 뒤 쉘을 다시 시작하세요. 파일: {path}",
        fix: "파일 관리자에서 파일이 열리는지 확인하세요"
    }
    DESK_LOCAL_LINK_REMOVE_FAILED() {
        class: Io,
        place: "기기 연결 정보 삭제",
        cause: "기기 연결 정보 파일을 삭제하지 못했다",
        message: "서버 연결 정보 파일을 지우지 못했습니다. 파일이 읽기 전용이 아닌지 확인한 뒤 다시 시도하세요. 파일: {path}",
        fix: "파일이 읽기 전용이 아닌지 확인하세요"
    }
    DESK_LOCAL_STATE_READ_FAILED() {
        class: Io,
        place: "로컬 상태 읽기",
        cause: "상태 파일을 읽지 못했다",
        message: "쉘 데이터 파일을 읽지 못했습니다. 파일 관리자에서 열리는지 확인한 뒤 쉘을 다시 시작하세요. 파일: {path}",
        fix: "파일 관리자에서 파일이 열리는지 확인하세요"
    }
    DESK_LOCAL_STATE_RECOVERY_RENAME_NOT_FOUND() {
        class: NotFound,
        place: "손상된 로컬 상태 보관",
        cause: "상태 파일이 보관 중 사라졌다",
        message: "손상된 쉘 데이터 파일을 옮기는 사이에 파일이 사라졌습니다. 쉘을 다시 시작하세요. 파일: {path}",
        fix: "쉘을 다시 시작하세요"
    }
    DESK_LOCAL_STATE_RECOVERY_RENAME_FAILED() {
        class: Io,
        place: "손상된 로컬 상태 보관",
        cause: "상태 파일을 보관 이름으로 바꾸지 못했다",
        message: "손상된 쉘 데이터 파일을 다른 이름으로 옮기지 못했습니다. 파일이 읽기 전용이 아닌지 확인한 뒤 쉘을 다시 시작하세요. 파일: {path}",
        fix: "파일이 읽기 전용이 아닌지 확인한 뒤 쉘을 다시 시작하세요"
    }
    DESK_LOCAL_STATE_SERIALIZE_FAILED() {
        class: Io,
        place: "로컬 상태 저장",
        cause: "로컬 상태를 JSON으로 만들지 못했다",
        message: "쉘 데이터를 파일 형식으로 바꾸지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    DESK_LOCAL_STATE_TEMP_WRITE_NOT_FOUND() {
        class: NotFound,
        place: "로컬 상태 임시 파일 쓰기",
        cause: "임시 상태 파일을 쓰는 경로가 없다",
        message: "쉘 데이터를 저장할 폴더가 없습니다. 폴더가 있는지 확인한 뒤 다시 시도하세요. 폴더: {dir}",
        fix: "쉘 데이터 폴더가 있는지 확인하세요"
    }
    DESK_LOCAL_STATE_TEMP_WRITE_FAILED() {
        class: Io,
        place: "로컬 상태 임시 파일 쓰기",
        cause: "임시 상태 파일을 쓰지 못했다",
        message: "쉘 데이터 임시 파일을 쓰지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인한 뒤 다시 시도하세요. 폴더: {dir}",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    DESK_LOCAL_STATE_REPLACE_NOT_FOUND() {
        class: NotFound,
        place: "로컬 상태 파일 교체",
        cause: "임시 상태 파일이나 저장 폴더가 없다",
        message: "쉘 데이터 파일을 바꿔 넣는 사이에 임시 파일이나 폴더가 사라졌습니다. 폴더가 있는지 확인한 뒤 다시 시도하세요. 폴더: {dir}",
        fix: "쉘 데이터 폴더가 있는지 확인하세요"
    }
    DESK_LOCAL_STATE_REPLACE_FAILED() {
        class: Io,
        place: "로컬 상태 파일 교체",
        cause: "임시 상태 파일을 저장 파일로 바꾸지 못했다",
        message: "쉘 데이터 파일을 새 내용으로 바꾸지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인한 뒤 다시 시도하세요. 파일: {path}",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    DESK_DATA_DIRECTORY_CREATE_NOT_FOUND() {
        class: NotFound,
        place: "로컬 데이터 폴더 준비",
        cause: "데이터 폴더를 만들 경로가 없다",
        message: "쉘 데이터 폴더를 만들 위치가 없습니다. 경로를 확인한 뒤 쉘을 다시 시작하세요. 폴더: {path}",
        fix: "데이터 폴더 경로가 있는지 확인하세요"
    }
    DESK_DATA_DIRECTORY_CREATE_FAILED() {
        class: Io,
        place: "로컬 데이터 폴더 준비",
        cause: "데이터 폴더를 만들지 못했다",
        message: "쉘 데이터 폴더를 만들지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인한 뒤 쉘을 다시 시작하세요. 폴더: {path}",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    DESK_CLIENT_BINARY_REQUEST_INVALID() {
        class: InvalidRequest,
        place: "공개 HTTPS 파일 요청 읽기",
        cause: "요청 본문이 필요한 권한, 주소, 쿼리 형식에 맞지 않는다",
        message: "앱이 http.read에 넘긴 값의 형식이 틀렸습니다. permission과 path는 글이고 query는 객체여야 합니다. 앱 코드를 고치세요.",
        fix: "앱 코드의 http.read 호출 값을 고치세요"
    }
    DESK_CLIENT_BINARY_OPERATION_UNKNOWN(operation) {
        class: InvalidRequest,
        place: "클라이언트 이진 데이터 동작 선택",
        cause: "요청한 이진 데이터 동작을 코어가 지원하지 않는다",
        message: "쉘이 모르는 파일 전송 종류입니다: {operation}. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    DESK_EXTERNAL_OPEN_URL_INVALID() {
        class: InvalidRequest,
        place: "외부 주소 열기",
        cause: "주소를 URL 형식으로 읽을 수 없다",
        message: "이 링크의 주소를 읽을 수 없어 열지 못했습니다. 문서의 링크를 http 또는 https 주소로 고치세요.",
        fix: "문서의 링크를 http 또는 https 주소로 고치세요"
    }
    DESK_EXTERNAL_OPEN_SCHEME_UNSUPPORTED() {
        class: InvalidRequest,
        place: "외부 주소 열기",
        cause: "http와 https가 아닌 주소를 열려 했다",
        message: "이 링크는 웹 주소가 아니라 열 수 없습니다: {scheme}. 문서의 링크를 http 또는 https 주소로 고치세요.",
        fix: "문서의 링크를 http 또는 https 주소로 고치세요"
    }
    DESK_EXTERNAL_OPEN_WINDOW_NOT_FOUND(window_id) {
        class: NotFound,
        place: "창에서 외부 주소 열기",
        cause: "요청에 지정한 창이 현재 상태에 없다",
        message: "링크를 누른 창이 더 이상 없어 외부 주소를 열지 못했습니다. 앱을 다시 연 뒤 링크를 누르세요.",
        fix: "앱을 다시 연 뒤 링크를 누르세요"
    }
    DESK_EXTERNAL_OPEN_HANDLER_NOT_FOUND() {
        class: NotFound,
        place: "기본 브라우저에서 외부 주소 열기",
        cause: "기본 브라우저를 찾지 못했다",
        message: "외부 주소를 열 기본 브라우저를 찾지 못했습니다. 기본 브라우저를 설치하거나 지정하세요.",
        fix: "기본 브라우저를 설치하거나 지정하세요"
    }
    DESK_EXTERNAL_OPEN_FAILED() {
        class: Io,
        place: "기본 브라우저에서 외부 주소 열기",
        cause: "기본 브라우저에서 주소를 열지 못했다",
        message: "기본 브라우저에서 외부 주소를 열지 못했습니다. 기본 브라우저가 실행되는지 확인한 뒤 링크를 다시 누르세요.",
        fix: "기본 브라우저가 실행되는지 확인하세요"
    }
    DESK_UPDATE_STATUS_UNAVAILABLE() {
        class: Unavailable,
        place: "업데이트 재시작",
        cause: "업데이트 기능을 이 쉘에서 사용할 수 없다",
        message: "이 쉘에서는 업데이트를 설치할 수 없습니다. 업데이트를 지원하는 설치본에서 다시 시도하세요.",
        fix: "업데이트를 지원하는 설치본을 사용하세요"
    }
    DESK_UPDATE_RESTART_NOT_READY() {
        class: InvalidRequest,
        place: "업데이트 재시작",
        cause: "설치할 업데이트가 준비되지 않았다",
        message: "설치할 새 판이 아직 준비되지 않았습니다. 새 판을 받았다는 표시가 뜨면 그 메뉴에서 다시 시작해서 업데이트를 누르세요.",
        fix: "새 판 표시가 뜨면 다시 시작해서 업데이트를 누르세요"
    }
    DESK_UPDATE_INSTALLER_UNAVAILABLE() {
        class: Unavailable,
        place: "업데이트 설치 시작",
        cause: "쉘에 업데이트 설치 기능이 없다",
        message: "이 설치본에서는 업데이트를 시작할 수 없습니다. 업데이트 기능이 포함된 설치본을 사용하세요.",
        fix: "업데이트 기능이 포함된 설치본을 사용하세요"
    }
    DESK_UPDATE_INSTALL_FAILED() {
        class: Io,
        place: "업데이트 설치",
        cause: "준비된 업데이트를 설치하지 못했다",
        message: "업데이트를 설치하지 못했습니다. 디스크 공간을 확인한 뒤 쉘을 다시 시작하세요. 쉘이 새 판을 다시 받습니다.",
        fix: "디스크 공간을 확인한 뒤 쉘을 다시 시작하세요"
    }
    DESK_FOLDER_PICK_PC_SCOPE_INVALID() {
        class: InvalidRequest,
        place: "기기 폴더 선택",
        cause: "내 PC 범위 권한을 폴더 선택 대화상자로 허용하려 했다",
        message: "파일 권한 {permission}: 내 PC 범위라 폴더를 골라 허용할 수 없습니다. 앱의 탐색기에서 이 PC의 파일 읽기 허용을 누르세요.",
        fix: "탐색기가 없는 앱이면 앱 정의 permissions의 scope를 고치세요"
    }
    DESK_FOLDER_PICK_PATH_NOT_FOUND() {
        class: NotFound,
        place: "선택한 폴더 확인",
        cause: "선택한 폴더를 찾지 못했다",
        message: "선택한 폴더가 사라졌습니다. 폴더를 다시 선택하세요.",
        fix: "폴더를 다시 선택하세요"
    }
    DESK_FOLDER_PICK_PATH_READ_FAILED() {
        class: Io,
        place: "선택한 폴더 확인",
        cause: "선택한 폴더의 실제 경로를 읽지 못했다",
        message: "선택한 폴더의 경로를 읽지 못했습니다. 파일 관리자에서 폴더가 열리는지 확인하세요.",
        fix: "파일 관리자에서 폴더가 열리는지 확인하세요"
    }
    DESK_FOLDER_PICK_NOT_DIRECTORY() {
        class: Io,
        place: "선택한 폴더 확인",
        cause: "선택한 경로가 폴더가 아니다",
        message: "선택한 경로가 폴더가 아닙니다. 폴더를 다시 선택하세요.",
        fix: "폴더를 다시 선택하세요"
    }
    DESK_PC_ACCESS_WINDOW_NOT_FOUND(window_id) {
        class: NotFound,
        place: "내 PC 접근 허용",
        cause: "내 PC 접근을 허용할 창이 현재 상태에 없다",
        message: "내 PC 접근을 허용할 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 연 뒤 허용하세요.",
        fix: "앱 열기에서 앱을 다시 연 뒤 허용하세요"
    }
    DESK_PC_ACCESS_APP_VERSION_NOT_FOUND(app_name, app_id, version) {
        class: NotFound,
        place: "내 PC 접근 허용",
        cause: "창에서 사용하는 앱 버전 정의가 없다",
        message: "앱 {app_name}의 {version}판 정의가 이 쉘에 없어 내 PC 권한을 확인하지 못했습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    DESK_PC_ACCESS_PERMISSION_UNDECLARED(permission) {
        class: InvalidRequest,
        place: "내 PC 접근 권한 검사",
        cause: "앱 정의에 내 PC 범위의 파일 권한이 없다",
        message: "파일 권한 {permission}: 앱 정의 permissions에 scope pc로 선언되지 않았습니다. 앱 정의에서 이 권한의 scope를 pc로 고치세요.",
        fix: "앱 정의에서 이 권한의 scope를 pc로 고치세요"
    }
    DESK_APP_IMPORT_BUILTIN() {
        class: InvalidAppDefinition,
        place: "기본 앱 가져오기",
        cause: "기본 앱 정의를 사용자 앱으로 가져오려 했다",
        message: "기본 앱 ID {app_id}: 커스텀 앱으로 가져올 수 없습니다. 앱 정의의 id를 바꾸거나, 기본 앱이면 kaleidoscope 리포에서 고친 뒤 쉘을 업데이트하세요.",
        fix: "앱 정의의 id를 바꾸거나 kaleidoscope 리포의 기본 앱 정의를 고치세요"
    }
    DESK_APP_IMPORT_UNSUPPORTED_SHELL() {
        class: UnsupportedApp,
        place: "앱 정의 호환성 검사",
        cause: "앱 정의가 이 쉘에서 지원하지 않는 블록이나 모듈 판을 요구한다",
        message: "앱이 이 쉘에서 지원하지 않는 기능을 요구합니다. 쉘을 업데이트한 뒤 다시 가져오세요.",
        fix: "쉘을 업데이트하세요"
    }
}
