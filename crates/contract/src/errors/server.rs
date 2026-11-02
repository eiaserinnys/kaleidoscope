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
}
