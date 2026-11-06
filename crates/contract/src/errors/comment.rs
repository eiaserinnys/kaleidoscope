error_catalog! { ENTRIES;
    COMMENT_CLIENT_NOT_CONNECTED() { class: Unavailable, place: "커멘트 서버 연결", cause: "서버에 연결되지 않았다", message: "서버에 연결되어 있지 않아 커멘트를 사용할 수 없습니다. 서버에 연결한 뒤 다시 시도하세요.", fix: "서버에 연결한 뒤 다시 시도하세요" }
    COMMENT_CLIENT_REQUEST_SEND_FAILED() { class: Server, place: "커멘트 서버 요청 전송", cause: "서버에 요청을 보내지 못했다", message: "커멘트 요청을 서버에 보내지 못했습니다. 서버 연결을 확인한 뒤 다시 시도하세요.", fix: "서버 연결을 확인한 뒤 다시 시도하세요" }
    COMMENT_CLIENT_RESPONSE_STATUS_FAILED() { class: Server, place: "커멘트 서버 응답 확인", cause: "서버가 요청을 처리하지 못했다", message: "서버가 커멘트 요청을 처리하지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.", fix: "서버 상태를 확인한 뒤 다시 시도하세요" }
    COMMENT_CLIENT_RESPONSE_READ_FAILED() { class: Server, place: "커멘트 서버 응답 읽기", cause: "서버 응답을 읽지 못했다", message: "서버의 커멘트 응답을 읽지 못했습니다. 서버와 쉘을 확인한 뒤 다시 시도하세요.", fix: "서버와 쉘을 확인한 뒤 다시 시도하세요" }
    COMMENT_CREATE_APP_ID_EMPTY() { class: InvalidRequest, place: "커멘트 생성 앱 식별", cause: "앱 이름표가 비었다", message: "커멘트를 저장할 앱 이름표가 비어 있습니다. 앱 창을 다시 열고 남겨 주세요.", fix: "앱 창을 다시 여세요" }
    COMMENT_CREATE_TEXT_EMPTY() { class: InvalidRequest, place: "커멘트 생성 본문 검사", cause: "커멘트 내용이 비었다", message: "커멘트 내용이 비어 있습니다. 고칠 내용을 적어 주세요.", fix: "고칠 내용을 적어 주세요" }
    COMMENT_CREATE_TEXT_TOO_LONG(limit) { class: InvalidRequest, place: "커멘트 생성 본문 검사", cause: "커멘트가 글자 수 한도를 넘었다", message: "커멘트가 {limit}를 넘습니다. 내용을 줄여 주세요.", fix: "내용을 줄여 주세요" }
    COMMENT_CREATE_ANCHOR_INVALID(field) { class: InvalidRequest, place: "커멘트 생성 자리 검사", cause: "자리 정보의 필드가 올바르지 않다", message: "커멘트 자리 정보의 {field}가 올바르지 않습니다. 창에서 자리를 다시 골라 주세요.", fix: "창에서 자리를 다시 골라 주세요" }
    COMMENT_CREATE_BODY_TOO_LARGE(limit) { class: InvalidRequest, place: "커멘트 생성 자료 크기 검사", cause: "자리와 본문의 JSON이 한도를 넘었다", message: "커멘트 자리와 내용이 {limit}를 넘습니다. 고른 글을 줄여 주세요.", fix: "고른 글을 줄여 주세요" }
    COMMENT_CREATE_ID_CONFLICT() { class: Conflict, place: "커멘트 생성 식별자 검사", cause: "같은 식별자에 다른 내용이 있다", message: "같은 커멘트 번호에 다른 내용이 저장돼 있습니다. 목록을 다시 읽어 주세요.", fix: "목록을 다시 읽어 주세요" }
    COMMENT_GET_NOT_FOUND(id) { class: NotFound, place: "커멘트 상세 조회", cause: "커멘트가 없다", message: "커멘트 {id}를 찾을 수 없습니다. 삭제되었는지 목록을 다시 읽어 주세요.", fix: "목록을 다시 읽어 주세요" }
    COMMENT_REPLY_THREAD_NOT_FOUND(id) { class: NotFound, place: "커멘트 답글 대상 조회", cause: "답할 커멘트가 없다", message: "답할 커멘트 {id}를 찾을 수 없습니다. 삭제되었는지 목록을 다시 읽어 주세요.", fix: "목록을 다시 읽어 주세요" }
    COMMENT_REPLY_TEXT_EMPTY() { class: InvalidRequest, place: "커멘트 답글 본문 검사", cause: "답글 내용이 비었다", message: "답글 내용이 비어 있습니다. 답할 내용을 적어 주세요.", fix: "답할 내용을 적어 주세요" }
    COMMENT_REPLY_TEXT_TOO_LONG(limit) { class: InvalidRequest, place: "커멘트 답글 본문 검사", cause: "답글이 글자 수 한도를 넘었다", message: "답글이 {limit}를 넘습니다. 내용을 줄여 주세요.", fix: "내용을 줄여 주세요" }
    COMMENT_REPLY_ID_CONFLICT() { class: Conflict, place: "커멘트 답글 식별자 검사", cause: "같은 답글 식별자에 다른 내용이 있다", message: "같은 답글 번호에 다른 내용이 저장돼 있습니다. 커멘트를 다시 읽어 주세요.", fix: "커멘트를 다시 읽어 주세요" }
    COMMENT_RESOLVE_NOT_FOUND(id) { class: NotFound, place: "커멘트 해결 대상 조회", cause: "해결 상태를 바꿀 커멘트가 없다", message: "해결 상태를 바꿀 커멘트 {id}를 찾을 수 없습니다. 목록을 다시 읽어 주세요.", fix: "목록을 다시 읽어 주세요" }
    COMMENT_IMAGE_NOT_FOUND() { class: NotFound, place: "커멘트 그림 조회", cause: "커멘트에 그림이 없다", message: "이 커멘트에는 저장한 그림이 없습니다. 자리 글을 확인해 주세요.", fix: "자리 글을 확인해 주세요" }
    COMMENT_CREATE_IMAGE_TOO_LARGE(limit) { class: InvalidRequest, place: "커멘트 그림 크기 검사", cause: "그림이 허용 크기를 넘었다", message: "커멘트 그림이 {limit}를 넘습니다. 그림을 빼고 저장해 주세요.", fix: "그림을 빼고 저장해 주세요" }
    COMMENT_CREATE_IMAGE_INVALID() { class: InvalidRequest, place: "커멘트 그림 형식 검사", cause: "그림을 PNG로 읽지 못했다", message: "커멘트 그림을 PNG로 읽을 수 없습니다. 자리를 다시 골라 찍어 주세요.", fix: "자리를 다시 골라 찍어 주세요" }
    COMMENT_CAPTURE_WINDOW_NOT_FOUND() { class: NotFound, place: "커멘트 그림 대상 창 조회", cause: "그림을 찍을 창이 없다", message: "그림을 찍을 창이 닫혔습니다. 앱 창을 다시 열어 주세요.", fix: "앱 창을 다시 열어 주세요" }
    COMMENT_CAPTURE_IMAGE_UNAVAILABLE() { class: Unavailable, place: "커멘트 그림 캡처", cause: "기기가 창 그림 캡처를 지원하지 않는다", message: "이 기기에서는 창 그림을 찍을 수 없습니다. 그림 없이 커멘트를 남길 수 있습니다.", fix: "그림 없이 커멘트를 남기세요" }
    COMMENT_CAPTURE_FREEZE_FAILED() { class: Io, place: "커멘트 그림 화면 고정", cause: "캡처할 화면을 고정하지 못했다", message: "창 그림을 찍기 위한 화면 고정에 실패했습니다. 자리를 다시 골라 주세요.", fix: "자리를 다시 골라 주세요" }
    COMMENT_LIST_CURSOR_INVALID() { class: InvalidRequest, place: "커멘트 목록 커서 검사", cause: "목록 커서를 읽지 못했다", message: "커멘트 목록의 이어 볼 위치가 올바르지 않습니다. 목록을 처음부터 다시 읽어 주세요.", fix: "목록을 처음부터 다시 읽어 주세요" }
    COMMENT_CREATE_STORAGE_FAILED(reason) { class: Server, place: "커멘트 생성 저장", cause: "서버 저장소에 커멘트를 쓰지 못했다", message: "서버가 커멘트를 저장하지 못했습니다. 잠시 뒤 다시 저장해 주세요. 원인: {reason}", fix: "잠시 뒤 다시 저장해 주세요" }
    COMMENT_REPLY_STORAGE_FAILED(reason) { class: Server, place: "커멘트 답글 저장", cause: "서버 저장소에 답글을 쓰지 못했다", message: "서버가 커멘트 답글을 저장하지 못했습니다. 잠시 뒤 다시 저장해 주세요. 원인: {reason}", fix: "잠시 뒤 다시 저장해 주세요" }
    COMMENT_RESOLVE_STORAGE_FAILED(reason) { class: Server, place: "커멘트 해결 상태 저장", cause: "서버 저장소에 해결 상태를 쓰지 못했다", message: "서버가 커멘트의 해결 상태를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요. 원인: {reason}", fix: "잠시 뒤 다시 시도해 주세요" }
    COMMENT_DELETE_STORAGE_FAILED(reason) { class: Server, place: "커멘트 삭제 저장", cause: "서버 저장소에서 커멘트를 지우지 못했다", message: "서버가 커멘트를 지우지 못했습니다. 잠시 뒤 다시 지워 주세요. 원인: {reason}", fix: "잠시 뒤 다시 지워 주세요" }
    COMMENT_MARK_READ_STORAGE_FAILED(reason) { class: Server, place: "커멘트 읽음 상태 저장", cause: "서버 저장소에 읽음 상태를 쓰지 못했다", message: "서버가 커멘트의 읽음 상태를 저장하지 못했습니다. 커멘트를 다시 열어 주세요. 원인: {reason}", fix: "커멘트를 다시 열어 주세요" }
    COMMENT_MARK_SENT_STORAGE_FAILED(reason) { class: Server, place: "커멘트 보냄 상태 저장", cause: "서버 저장소에 보냄 상태를 쓰지 못했다", message: "서버가 커멘트의 보냄 상태를 저장하지 못했습니다. 목록을 다시 확인해 주세요. 원인: {reason}", fix: "목록을 다시 확인해 주세요" }
    COMMENT_MARK_SENT_NOT_FOUND(id) { class: NotFound, place: "커멘트 보냄 대상 조회", cause: "보냄 상태를 바꿀 커멘트가 없다", message: "보냄 상태를 바꿀 커멘트 {id}를 찾을 수 없습니다. 목록을 다시 읽어 주세요.", fix: "목록을 다시 읽어 주세요" }
    COMMENT_MARK_READ_NOT_FOUND(id) { class: NotFound, place: "커멘트 읽음 대상 조회", cause: "읽음 상태를 바꿀 커멘트가 없다", message: "읽음 상태를 바꿀 커멘트 {id}를 찾을 수 없습니다. 목록을 다시 읽어 주세요.", fix: "목록을 다시 읽어 주세요" }
}
