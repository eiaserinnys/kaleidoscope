error_catalog! { ENTRIES;
    MEDIA_LOAD_SERVER_NOT_CONNECTED() {
        class: Server,
        place: "앱 창의 미디어 불러오기",
        cause: "서버 연결이 완료되지 않아 미디어 자산을 받을 수 없다",
        message: "kaleidoscope 서버에 연결되어 있지 않아 미디어를 불러올 수 없습니다. 서버를 연결한 뒤 다시 시도하세요.",
        fix: "쉘의 「서버 연결」에서 서버를 연결하세요"
    }
}
