error_catalog! { ENTRIES;
    SERVER_CALL_NOT_CONNECTED() {
        class: Server,
        place: "코어의 서버 기능 호출",
        cause: "서버 연결 정보가 없어 요청을 보낼 수 없다",
        message: "kaleidoscope 서버에 연결되어 있지 않아 요청을 보낼 수 없습니다. 서버를 연결한 뒤 다시 시도하세요.",
        fix: "상단 서버 메뉴에서 서버를 연결하세요"
    }
}
