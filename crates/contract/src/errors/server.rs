error_catalog! { ENTRIES;
    SERVER_SWITCH_CANCELLED() {
        class: InvalidRequest,
        place: "서버 전환",
        cause: "서버 선택이 바뀌어 현재 전환이 취소됐다",
        message: "서버 선택이 바뀌어 전환을 마치지 못했습니다. 현재 서버를 다시 선택하세요.",
        fix: "현재 사용할 서버를 다시 선택하세요"
    }
    SERVER_SWITCH_ARCHIVE_CREATE_FAILED() {
        class: Io,
        place: "서버 전환 자료 보관",
        cause: "이전 서버 자료를 보관할 폴더를 만들지 못했다",
        message: "이전 서버 자료를 보관할 수 없습니다. 디스크 공간과 폴더 권한을 확인하세요.",
        fix: "디스크 공간과 폴더 권한을 확인하세요"
    }
    SERVER_SWITCH_LOCAL_UNAVAILABLE() {
        class: Unavailable,
        place: "내 PC 서버 선택",
        cause: "내장 서버가 설정되어 있지 않다",
        message: "내 PC 서버를 사용할 수 없습니다. 내장 서버가 설정된 기기에서 다시 시도하세요.",
        fix: "내장 서버 설정을 확인하세요"
    }
    SERVER_SYNC_LOCAL_UNAVAILABLE() {
        class: Unavailable,
        place: "자료 이관",
        cause: "자료를 읽을 내 PC 서버가 설정되어 있지 않다",
        message: "자료를 읽을 내 PC 서버를 사용할 수 없습니다. 내장 서버가 설정된 기기에서 다시 시도하세요.",
        fix: "내장 서버 설정을 확인하세요"
    }
    SERVER_SYNC_REMOTE_NOT_SELECTED() {
        class: InvalidRequest,
        place: "서버 간 자료 이관",
        cause: "원격 서버가 선택되어 있지 않다",
        message: "자료를 보낼 원격 서버가 선택되지 않았습니다. 원격 서버에 연결한 뒤 다시 시도하세요.",
        fix: "원격 서버에 연결하세요"
    }
    SERVER_SYNC_LAYOUT_UNREACHABLE(host) {
        class: Server,
        place: "내 PC 배치 동기화",
        cause: "배치 변경을 내 PC 서버에 보내지 못했다",
        message: "내 PC 서버 {host}에 배치를 보낼 수 없습니다. 서버와 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "내 PC 서버와 네트워크 연결을 확인하세요"
    }
    SERVER_SYNC_LAYOUT_REJECTED(host) {
        class: Server,
        place: "내 PC 배치 동기화",
        cause: "내 PC 서버가 배치 변경 요청을 실패로 응답했다",
        message: "내 PC 서버({host})가 배치 변경을 처리하지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "내 PC 서버 상태를 확인하세요"
    }
    SERVER_SYNC_LAYOUT_RESPONSE_READ_FAILED(host) {
        class: Server,
        place: "내 PC 배치 동기화 응답 읽기",
        cause: "배치 동기화 응답을 읽거나 해석하지 못했다",
        message: "내 PC 서버({host})의 배치 응답을 읽지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 상태를 확인한 뒤 다시 시도하세요"
    }
    SERVER_SYNC_CLIENT_FAILED() {
        class: Server,
        place: "서버 간 자료 이관 준비",
        cause: "HTTP 클라이언트를 만들지 못했다",
        message: "서버 간 자료 이관을 준비하지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    SERVER_SYNC_UNREACHABLE(host) {
        class: Server,
        place: "서버 간 자료 이관 요청",
        cause: "자료 이관 요청을 서버에 보내지 못했다",
        message: "서버 {host}에 자료 이관 요청을 보내지 못했습니다. 서버와 네트워크를 확인하세요.",
        fix: "서버 주소와 네트워크 연결을 확인하세요"
    }
    SERVER_SYNC_LOCAL_READ_UNREACHABLE(host) {
        class: Server,
        place: "내 PC 서버에서 자료 읽기",
        cause: "자료 읽기 요청을 내 PC 서버에 보내지 못했다",
        message: "내 PC 서버({host})에서 자료를 읽지 못했습니다. 서버와 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "내 PC 서버와 네트워크 연결을 확인하세요"
    }
    SERVER_SYNC_LOCAL_READ_REJECTED(host) {
        class: Server,
        place: "내 PC 서버에서 자료 읽기",
        cause: "내 PC 서버가 자료 읽기 요청을 실패로 응답했다",
        message: "내 PC 서버({host})가 자료 읽기 요청을 처리하지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "내 PC 서버 상태를 확인하세요"
    }
    SERVER_SYNC_REJECTED(host) {
        class: Server,
        place: "서버 간 자료 이관 응답",
        cause: "서버가 자료 이관 요청을 실패로 응답했다",
        message: "서버({host})가 자료 이관 요청을 처리하지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 상태를 확인하세요"
    }
    SERVER_SYNC_RESPONSE_INVALID(host) {
        class: Server,
        place: "서버 간 자료 이관 응답",
        cause: "서버 응답이 자료 이관 형식에 맞지 않다",
        message: "서버 {host}의 자료 이관 응답을 읽지 못했습니다. 서버 버전을 확인한 뒤 다시 시도하세요.",
        fix: "서버 응답 형식과 버전을 확인하세요"
    }
    SERVER_SYNC_RESPONSE_UNREACHABLE(host) {
        class: Server,
        place: "서버 간 자료 이관 응답 읽기",
        cause: "자료 이관 응답을 끝까지 읽지 못했다",
        message: "서버 {host}의 자료 이관 응답을 읽지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    SERVER_LAYOUT_REPORT_BODY_INVALID() {
        class: InvalidRequest,
        place: "기기 배치 보고 요청 읽기",
        cause: "요청 본문이 기기 배치 형식에 맞지 않는다",
        message: "기기 배치 보고 형식이 올바르지 않습니다. 쉘을 업데이트한 뒤 다시 보고하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SERVER_LAYOUT_CHANGE_BODY_INVALID() {
        class: InvalidRequest,
        place: "기기 배치 변경 요청 읽기",
        cause: "요청 본문이 배치 변경 형식에 맞지 않는다",
        message: "기기 배치 변경 형식이 올바르지 않습니다. 쉘을 업데이트한 뒤 다시 보내세요.",
        fix: "쉘을 업데이트하세요"
    }
    SERVER_LAYOUT_CHANGE_SHARING_ID_INVALID(id) {
        class: InvalidRequest,
        place: "기기 배치 변경의 공유 창 검사",
        cause: "공유 대상 창 id가 비었거나 허용 길이를 넘는다",
        message: "공유 창 ID가 올바르지 않습니다: {id}. 현재 창 ID를 사용해 다시 보내세요.",
        fix: "현재 창 ID를 사용하세요"
    }
    SERVER_LAYOUT_CHANGE_CONTEXT_TOO_LARGE(max_bytes) {
        class: InvalidRequest,
        place: "기기 배치 변경의 공유 문맥 검사",
        cause: "공유 문맥 글이 허용 크기를 넘는다",
        message: "공유 문맥이 {max_bytes}바이트 제한을 넘었습니다. 글을 줄인 뒤 다시 보내세요.",
        fix: "공유 문맥 글을 허용 크기 안으로 줄이세요"
    }
    SERVER_LAYOUT_CHANGE_STATE_SERIALIZATION_FAILED() {
        class: InvalidRequest,
        place: "기기 배치 변경의 창 상태 검사",
        cause: "창 상태를 JSON으로 만들지 못했다",
        message: "창 상태를 읽을 수 있는 형식으로 만들지 못했습니다. 쉘을 업데이트한 뒤 다시 보내세요.",
        fix: "쉘을 업데이트하세요"
    }
    SERVER_LAYOUT_CHANGE_STATE_TOO_LARGE(max_bytes) {
        class: InvalidRequest,
        place: "기기 배치 변경의 창 상태 크기 검사",
        cause: "창 상태가 허용 크기를 넘는다",
        message: "창 상태가 {max_bytes}바이트 제한을 넘었습니다. 상태 항목을 줄인 뒤 다시 보내세요.",
        fix: "창 상태 항목을 허용 크기 안으로 줄이세요"
    }
    SERVER_LAYOUT_ENTITIES_TABLE_UNSUPPORTED() {
        class: Server,
        place: "계정 배치 정보 읽기",
        cause: "서버가 알지 못하는 배치 정보 종류를 읽으려 했다",
        message: "서버가 작업, 데스크톱 또는 창 정보를 읽지 못했습니다. 서버 상태를 확인하세요.",
        fix: "서버 상태를 확인하세요"
    }
    SERVER_LAYOUT_ENTITIES_READ_FAILED() {
        class: Server,
        place: "계정 배치 정보 읽기",
        cause: "저장된 작업, 데스크톱 또는 창 정보를 읽지 못했다",
        message: "서버에서 작업, 데스크톱 또는 창 정보를 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_ENTITIES_JSON_PARSE_FAILED() {
        class: Server,
        place: "계정 배치 JSON 해석",
        cause: "저장된 작업, 데스크톱 또는 창 정보가 올바른 JSON이 아니다",
        message: "저장된 작업 배치 정보의 JSON 형식이 올바르지 않습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_REPORT_DEVICE_NOT_FOUND() {
        class: Server,
        place: "기기 배치 보고 저장",
        cause: "배치를 보고한 연결 기기를 찾지 못했다",
        message: "배치를 보고한 기기를 찾지 못했습니다. 기기를 다시 연결한 뒤 보고하세요.",
        fix: "기기를 다시 연결하세요"
    }
    SERVER_LAYOUT_REPORT_SAVE_FAILED() {
        class: Server,
        place: "기기 배치 보고 저장",
        cause: "기기 배치 보고를 저장하지 못했다",
        message: "기기 배치를 저장하지 못했습니다. 서버 저장소 상태를 확인한 뒤 다시 보고하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_REPORT_SERIALIZATION_FAILED() {
        class: Server,
        place: "기기 배치 보고 저장",
        cause: "기기 배치를 저장 형식으로 만들지 못했다",
        message: "기기 배치를 저장 형식으로 만들지 못했습니다. 쉘을 업데이트한 뒤 다시 보고하세요.",
        fix: "쉘을 업데이트하세요"
    }
    SERVER_LAYOUT_REPORT_DEVICE_TRACKING_READ_FAILED() {
        class: Server,
        place: "기기 배치 보고의 동기화 대상 확인",
        cause: "배치 동기화 대상 목록을 읽지 못했다",
        message: "기기 배치 동기화 상태를 읽지 못했습니다. 서버 상태를 확인한 뒤 다시 보고하세요.",
        fix: "서버 상태를 확인하세요"
    }
    SERVER_LAYOUT_REPORT_TABLE_UNSUPPORTED() {
        class: Server,
        place: "기기 배치 보고 저장",
        cause: "서버가 알지 못하는 배치 보고 항목 종류를 저장하려 했다",
        message: "서버가 배치 보고 항목을 저장하지 못했습니다. 서버를 업데이트한 뒤 다시 보고하세요.",
        fix: "서버를 업데이트하세요"
    }
    SERVER_LAYOUT_INDEX_REFRESH_FAILED() {
        class: Server,
        place: "기기별 작업 목록 갱신",
        cause: "기기 배치에서 작업 목록을 갱신하지 못했다",
        message: "기기별 작업 목록을 갱신하지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_CHANGE_DEVICE_NOT_FOUND() {
        class: Server,
        place: "기기 배치 변경 적용",
        cause: "변경을 보낸 연결 기기를 찾지 못했다",
        message: "배치 변경을 보낸 기기를 찾지 못했습니다. 기기를 다시 연결한 뒤 변경을 보내세요.",
        fix: "기기를 다시 연결하세요"
    }
    SERVER_LAYOUT_CHANGE_APPLY_FAILED() {
        class: Server,
        place: "기기 배치 변경 적용",
        cause: "기기 배치 변경을 저장하거나 적용하지 못했다",
        message: "기기 배치 변경을 적용하지 못했습니다. 서버 저장소 상태를 확인한 뒤 다시 보내세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_WORKSPACE_SERIALIZATION_FAILED() {
        class: Server,
        place: "작업 배치 변경 저장",
        cause: "작업 배치를 저장 형식으로 만들지 못했다",
        message: "작업 배치를 저장 형식으로 만들지 못했습니다. 작업 정보를 확인한 뒤 다시 보내세요.",
        fix: "작업 정보를 확인하세요"
    }
    SERVER_LAYOUT_DESKTOP_SERIALIZATION_FAILED() {
        class: Server,
        place: "데스크톱 배치 변경 저장",
        cause: "데스크톱 배치를 저장 형식으로 만들지 못했다",
        message: "데스크톱 배치를 저장 형식으로 만들지 못했습니다. 데스크톱 정보를 확인한 뒤 다시 보내세요.",
        fix: "데스크톱 정보를 확인하세요"
    }
    SERVER_LAYOUT_WINDOW_SERIALIZATION_FAILED() {
        class: Server,
        place: "창 배치 변경 저장",
        cause: "창 배치를 저장 형식으로 만들지 못했다",
        message: "창 배치를 저장 형식으로 만들지 못했습니다. 창 정보를 확인한 뒤 다시 보내세요.",
        fix: "창 정보를 확인하세요"
    }
    SERVER_LAYOUT_CANONICAL_ENTITY_INVALID() {
        class: Server,
        place: "저장된 배치 항목 읽기",
        cause: "저장한 작업, 데스크톱 또는 창 정보를 해석하지 못했다",
        message: "서버에 저장된 배치 정보를 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_CANONICAL_ENTITY_READ_FAILED() {
        class: Server,
        place: "저장된 배치 항목 조회",
        cause: "작업, 데스크톱 또는 창 저장 행을 읽지 못했다",
        message: "서버 저장소에서 배치 항목을 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_CANONICAL_ENTITY_TABLE_UNSUPPORTED() {
        class: Server,
        place: "저장된 배치 항목 조회",
        cause: "서버가 알지 못하는 배치 항목 종류를 조회하려 했다",
        message: "서버가 배치 항목을 읽지 못했습니다. 서버 상태를 확인하세요.",
        fix: "서버 상태를 확인하세요"
    }
    SERVER_LAYOUT_CHILD_RELATION_UNSUPPORTED() {
        class: Server,
        place: "배치 항목 관계 조회",
        cause: "서버가 알지 못하는 작업과 데스크톱 또는 창 관계를 조회하려 했다",
        message: "서버가 배치 항목의 관계를 읽지 못했습니다. 서버 상태를 확인하세요.",
        fix: "서버 상태를 확인하세요"
    }
    SERVER_LAYOUT_CHILD_RELATION_READ_FAILED() {
        class: Server,
        place: "배치 항목 관계 조회",
        cause: "작업, 데스크톱 또는 창의 관계를 읽지 못했다",
        message: "서버에서 배치 항목의 관계를 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_WORKSPACE_LOOKUP_FAILED() {
        class: Server,
        place: "작업 존재 확인",
        cause: "작업이 현재 계정에 있는지 확인하지 못했다",
        message: "작업 정보를 확인하지 못했습니다. 서버 저장소 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_DESKTOP_LOOKUP_FAILED() {
        class: Server,
        place: "데스크톱 존재 확인",
        cause: "데스크톱이 현재 계정에 있는지 확인하지 못했다",
        message: "데스크톱 정보를 확인하지 못했습니다. 서버 저장소 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_SNAPSHOT_READ_FAILED() {
        class: Server,
        place: "기기 배치 스냅샷 읽기",
        cause: "기기 계정 또는 배치 항목을 읽지 못했다",
        message: "기기 배치 스냅샷을 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_REPORT_LIST_FAILED() {
        class: Server,
        place: "기기 배치 보고 목록 읽기",
        cause: "저장된 기기 배치 보고를 읽지 못했다",
        message: "기기 배치 보고 목록을 읽지 못했습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_REPORT_LIST_JSON_PARSE_FAILED() {
        class: Server,
        place: "기기 배치 보고 JSON 해석",
        cause: "저장된 기기 배치 보고가 올바른 JSON이 아니다",
        message: "기기 배치 보고의 JSON 형식이 올바르지 않습니다. 서버 저장소 상태를 확인하세요.",
        fix: "서버 저장소 상태를 확인하세요"
    }
    SERVER_LAYOUT_WORKSPACE_CONNECTION_STATE_READ_FAILED() {
        class: Server,
        place: "작업 상세의 기기 연결 상태 읽기",
        cause: "기기 연결 상태를 읽지 못했다",
        message: "작업에 연결된 기기 상태를 읽지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        fix: "서버 상태를 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_READ_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 상태 읽기",
        cause: "배치 동기화 상태 파일을 읽지 못했다",
        message: "로컬 배치 동기화 상태를 읽지 못했습니다. 파일 권한과 디스크 상태를 확인하세요.",
        fix: "파일 권한과 디스크 상태를 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_READ_NOT_FOUND() {
        class: NotFound,
        place: "로컬 배치 동기화 상태 읽기",
        cause: "동기화 상태 파일이 읽는 동안 사라졌다",
        message: "로컬 배치 동기화 상태 파일이 없습니다. 서버 연결을 새로고침한 뒤 다시 시도하세요.",
        fix: "서버 연결을 새로고침하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_SAVE_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 상태 저장",
        cause: "배치 동기화 상태 파일을 저장하지 못했다",
        message: "로컬 배치 동기화 상태를 저장하지 못했습니다. 디스크 공간과 저장 폴더 권한을 확인하세요.",
        fix: "디스크 공간과 저장 폴더 권한을 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_SAVE_NOT_FOUND() {
        class: NotFound,
        place: "로컬 배치 동기화 상태 저장",
        cause: "배치 동기화 상태를 저장하는 동안 저장 경로가 사라졌다",
        message: "로컬 배치 동기화 상태를 저장할 경로가 사라졌습니다. 서버 연결 상태를 새로고침한 뒤 다시 시도하세요.",
        fix: "서버 연결 상태를 새로고침하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_RECOVERY_RENAME_NOT_FOUND() {
        class: NotFound,
        place: "손상된 로컬 배치 동기화 상태 보관",
        cause: "손상된 동기화 상태 파일이 보관 중 사라졌다",
        message: "손상된 로컬 배치 동기화 상태 파일을 찾지 못했습니다. 서버 연결 상태를 새로고침한 뒤 다시 시도하세요.",
        fix: "서버 연결 상태를 새로고침하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_RECOVERY_RENAME_FAILED() {
        class: Io,
        place: "손상된 로컬 배치 동기화 상태 보관",
        cause: "손상된 동기화 상태 파일을 보관 이름으로 바꾸지 못했다",
        message: "손상된 로컬 배치 동기화 상태 파일을 보관하지 못했습니다. 저장 폴더 권한과 디스크 상태를 확인하세요.",
        fix: "저장 폴더 권한과 디스크 상태를 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_TEMP_WRITE_NOT_FOUND() {
        class: NotFound,
        place: "로컬 배치 동기화 임시 파일 쓰기",
        cause: "임시 동기화 상태 파일을 쓸 경로가 없다",
        message: "로컬 배치 동기화 임시 파일을 쓸 위치가 없습니다. 저장 폴더를 확인한 뒤 다시 시도하세요.",
        fix: "저장 폴더가 있는지 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_TEMP_WRITE_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 임시 파일 쓰기",
        cause: "임시 동기화 상태 파일을 쓰지 못했다",
        message: "로컬 배치 동기화 임시 파일을 쓰지 못했습니다. 디스크 공간과 저장 폴더 권한을 확인하세요.",
        fix: "디스크 공간과 저장 폴더 권한을 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_REPLACE_NOT_FOUND() {
        class: NotFound,
        place: "로컬 배치 동기화 상태 파일 교체",
        cause: "임시 동기화 상태 파일이나 저장 폴더가 없다",
        message: "로컬 배치 동기화 상태 파일을 교체할 위치가 없습니다. 저장 폴더를 확인한 뒤 다시 시도하세요.",
        fix: "저장 폴더가 있는지 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_REPLACE_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 상태 파일 교체",
        cause: "임시 동기화 상태 파일을 저장 파일로 바꾸지 못했다",
        message: "로컬 배치 동기화 상태 파일을 교체하지 못했습니다. 디스크 공간과 저장 폴더 권한을 확인하세요.",
        fix: "디스크 공간과 저장 폴더 권한을 확인하세요"
    }
    SERVER_LAYOUT_SYNC_STATE_REMOVE_FAILED() {
        class: Io,
        place: "로컬 배치 동기화 상태 삭제",
        cause: "배치 동기화 상태 파일을 삭제하지 못했다",
        message: "로컬 배치 동기화 상태를 지우지 못했습니다. 파일 권한과 디스크 상태를 확인하세요.",
        fix: "파일 권한과 디스크 상태를 확인하세요"
    }
}
