error_catalog! { ENTRIES;
    CONV_CONTEXT_PROVIDER_MISSING() {
        class: InvalidRequest,
        place: "대화 설정 불러오기",
        cause: "앱에 대화 제공자 설정이 없다",
        message: "앱에 대화 제공자가 설정되지 않았습니다. 앱 설정에서 대화 제공자를 지정하세요.",
        fix: "앱의 대화 제공자 설정을 확인하세요"
    }
    CONV_CONTEXT_PERMISSION_MISSING() {
        class: PermissionDenied,
        place: "대화 제공자 연결 확인",
        cause: "앱에 읽기·쓰기 연결 권한이 없다",
        message: "대화 제공자 연결 권한이 앱에 선언되지 않았습니다. 앱 설정에서 제공자 연결을 허용하세요.",
        fix: "앱 권한에 대화 제공자 연결을 선언하세요"
    }
    CONV_CONTEXT_LINK_MISSING() {
        class: Unavailable,
        place: "대화 설정 불러오기",
        cause: "서버 연결 정보가 없다",
        message: "대화를 열 서버 연결 정보가 없습니다. 서버 연결을 다시 설정하세요.",
        fix: "서버 연결을 확인하세요"
    }
    CONV_CONTEXT_PROVIDER_NOT_OAUTH() {
        class: InvalidRequest,
        place: "대화 제공자 연결 확인",
        cause: "대화 제공자 연결이 OAuth가 아니다",
        message: "대화 제공자 연결은 기기 로그인 방식이어야 합니다. OAuth 연결을 선택하세요.",
        fix: "OAuth 연결을 선택하세요"
    }
    CONV_CONTEXT_CONNECTION_MISSING(connection) {
        class: Unavailable,
        place: "대화 제공자 연결 복원",
        cause: "저장된 제공자 연결이 없다",
        message: "대화 제공자 연결 {connection}을 찾을 수 없습니다. 연결 설정을 확인하세요.",
        fix: "앱에 지정한 연결 이름을 확인하세요"
    }
    CONV_CONTEXT_CONNECTION_NOT_WRITABLE(connection) {
        class: PermissionDenied,
        place: "대화 제공자 연결 복원",
        cause: "제공자 연결에 쓰기 권한이 없다",
        message: "대화 제공자 연결 {connection}은 읽기 전용입니다. 쓰기가 허용된 연결을 선택하세요.",
        fix: "연결의 쓰기 권한을 확인하세요"
    }
    CONV_CONTEXT_WINDOW_NOT_FOUND(window) {
        class: NotFound,
        place: "대화 창 열기",
        cause: "대상 창이 없다",
        message: "대화 창 {window}을 찾을 수 없습니다. 창 목록을 새로고침하세요.",
        fix: "창 목록을 새로고침하세요"
    }
    CONV_CONTEXT_DESKTOP_NOT_FOUND(desktop) {
        class: NotFound,
        place: "대화 작업 확인",
        cause: "창이 속한 데스크톱이 없다",
        message: "대화 창의 데스크톱 {desktop}을 찾을 수 없습니다. 작업 배치를 다시 불러오세요.",
        fix: "작업 배치를 다시 불러오세요"
    }
    CONV_CONTEXT_WORKSPACE_NOT_FOUND(workspace) {
        class: NotFound,
        place: "대화 작업 확인",
        cause: "데스크톱이 속한 작업이 없다",
        message: "대화 작업 {workspace}을 찾을 수 없습니다. 작업 목록을 다시 불러오세요.",
        fix: "작업 목록을 다시 불러오세요"
    }
    CONV_CONTEXT_APP_NOT_FOUND(app) {
        class: NotFound,
        place: "대화 앱 확인",
        cause: "창의 앱 버전을 찾을 수 없다",
        message: "대화 앱 {app}의 지정된 버전을 찾을 수 없습니다. 앱 목록을 새로고침하세요.",
        fix: "앱 목록을 새로고침하세요"
    }
    CONV_CONTEXT_BINDING_INVALID(field, reason) {
        class: InvalidRequest,
        place: "대화 설정 읽기",
        cause: "대화 설정 값의 식을 계산할 수 없다",
        message: "대화 설정 {field}을 계산하지 못했습니다: {reason}. 앱 설정의 값을 고치세요.",
        fix: "앱 설정의 대화 값을 고치세요"
    }
    CONV_CONTEXT_MODELS_MISSING() {
        class: NotFound,
        place: "대화 모델 목록 불러오기",
        cause: "제공자가 모델 목록을 반환하지 않았다",
        message: "대화 제공자가 모델 목록을 찾지 못했습니다. 제공자 설정을 확인한 뒤 다시 불러오세요.",
        fix: "제공자 설정을 확인하세요"
    }
    CONV_CONTEXT_THREAD_ENTRY_INVALID() {
        class: InvalidRequest,
        place: "저장된 대화 연결 읽기",
        cause: "저장된 대화 참조에 대화 식별자가 없다",
        message: "저장된 대화 연결에 제공자 대화 식별자가 없습니다. 대화 설정을 확인하고 다시 연결하세요.",
        fix: "저장된 대화 연결을 다시 설정하세요"
    }
    CONV_CONTEXT_THREAD_BINDING_CONFLICT(workspace) {
        class: BindingConflict,
        place: "저장된 대화 연결 확인",
        cause: "저장소와 제공자가 가리키는 대화가 다르다",
        message: "작업 {workspace}의 저장된 대화가 제공자의 대화와 일치하지 않습니다. 연결 설정을 확인하세요.",
        fix: "작업의 대화 연결 설정을 확인하세요"
    }
    CONV_CONTEXT_ADOPTION_NOT_FOUND(workspace) {
        class: NotFound,
        place: "기존 대화 연결 복구",
        cause: "저장된 제공자 대화가 더 이상 없다",
        message: "작업 {workspace}에 연결된 제공자 대화를 찾을 수 없습니다. 대화 연결을 새로 시작하세요.",
        fix: "새 대화를 시작하세요"
    }
    CONV_CONTEXT_VALUE_MISSING(field) {
        class: InvalidRequest,
        place: "대화 설정 읽기",
        cause: "필수 설정 값이 문자열이 아니다",
        message: "대화 설정 {field}에 글자 값이 없습니다. 앱 설정에 값을 입력하세요.",
        fix: "앱 설정에 글자 값을 입력하세요"
    }
    CONV_CONTEXT_VALUE_EMPTY(field) {
        class: InvalidRequest,
        place: "대화 설정 읽기",
        cause: "필수 설정 값이 비어 있다",
        message: "대화 설정 {field}이 비어 있습니다. 앱 설정에 값을 입력하세요.",
        fix: "앱 설정에 값을 입력하세요"
    }
    CONV_SELECTION_CREATE_NOT_FOUND(workspace) {
        class: NotFound,
        place: "대화 만들기",
        cause: "제공자가 새 대화를 만들지 않았다",
        message: "작업 {workspace}의 대화를 제공자가 만들지 않았습니다. 제공자 상태를 확인한 뒤 다시 시도하세요.",
        fix: "제공자 상태를 확인한 뒤 다시 시도하세요"
    }
    CONV_SELECTION_BINDING_CONFLICT(workspace) {
        class: BindingConflict,
        place: "대화 만들기",
        cause: "동시에 저장된 대화가 새 대화와 다르다",
        message: "작업 {workspace}에 다른 대화가 이미 연결되어 있습니다. 대화를 새로고침하세요.",
        fix: "대화를 새로고침하세요"
    }
    CONV_SELECTION_MODEL_ORDER_INVALID() {
        class: InvalidRequest,
        place: "대화 모델 설정 읽기",
        cause: "모델 목록이 비었거나 중복되거나 문자열이 아니다",
        message: "대화 모델 목록이 비었거나 중복 항목을 포함합니다. 앱 설정의 모델 목록을 고치세요.",
        fix: "앱 설정의 모델 목록을 고치세요"
    }
    CONV_SELECTION_TEMPLATE_INVALID(field, reason) {
        class: InvalidRequest,
        place: "대화 문구 설정 확인",
        cause: "대화 문구 틀이 유효하지 않다",
        message: "대화 설정 {field}의 문구 틀이 올바르지 않습니다: {reason}. 앱 설정을 고치세요.",
        fix: "문구 틀의 변수와 형식을 확인하세요"
    }
    CONV_SELECTION_PROFILE_EMPTY() {
        class: InvalidRequest,
        place: "대화 프로필 전환",
        cause: "요청한 프로필 이름이 비었다",
        message: "바꿀 대화 프로필 이름이 비어 있습니다. 목록에서 프로필을 선택하세요.",
        fix: "대화 프로필을 선택하세요"
    }
    CONV_SELECTION_THREAD_NOT_FOUND(workspace) {
        class: NotFound,
        place: "대화 전환",
        cause: "전환할 현재 대화가 없다",
        message: "작업 {workspace}에 전환할 대화가 없습니다. 먼저 대화를 만드세요.",
        fix: "먼저 대화를 만드세요"
    }
    CONV_SELECTION_MODEL_NOT_FOUND(model) {
        class: NotFound,
        place: "대화 모델 전환",
        cause: "갱신된 모델 목록에서 선택한 모델이 없다",
        message: "대화 모델 {model}을 제공자에서 찾을 수 없습니다. 사용 가능한 모델을 선택하세요.",
        fix: "사용 가능한 모델을 선택하세요"
    }
    CONV_SELECTION_THREAD_MISMATCH(workspace) {
        class: BindingConflict,
        place: "대화 전환",
        cause: "제공자가 다른 대화를 반환했다",
        message: "작업 {workspace}의 대화 전환에서 다른 대화가 반환됐습니다. 대화를 새로고침하세요.",
        fix: "대화를 새로고침하세요"
    }
    CONV_SELECTION_PROFILE_MISSING() {
        class: InvalidRequest,
        place: "대화 프로필 전환",
        cause: "프로필 변경에 필요한 대상 프로필이 없다",
        message: "바꿀 대화 프로필을 확인할 수 없습니다. 프로필을 선택한 뒤 다시 시도하세요.",
        fix: "대화 프로필을 선택하세요"
    }
    CONV_RECONCILE_REQUEST_INVALID() {
        class: InvalidRequest,
        place: "대화 설정 재적용",
        cause: "대화 설정 명령이 아니다",
        message: "대화 설정 재적용에 사용할 수 없는 명령입니다. 대화 설정 화면에서 다시 시도하세요.",
        fix: "대화 설정 화면에서 다시 시도하세요"
    }
    CONV_RECONCILE_BINDING_INVALID(workspace) {
        class: BindingConflict,
        place: "대화 연결 정합화",
        cause: "저장된 대화 연결에 식별자가 없다",
        message: "작업 {workspace}의 저장된 대화 연결에 제공자 식별자가 없습니다. 대화 연결을 다시 설정하세요.",
        fix: "작업의 대화 연결을 다시 설정하세요"
    }
    CONV_RECONCILE_BINDING_CONFLICT(workspace) {
        class: BindingConflict,
        place: "대화 연결 정합화",
        cause: "저장된 대화 연결의 작업 정보가 현재 작업과 다르다",
        message: "작업 {workspace}의 저장된 대화 연결 정보가 현재 제공자 대화와 다릅니다. 연결 설정을 확인하세요.",
        fix: "작업의 대화 연결 설정을 확인하세요"
    }
    CONV_RECONCILE_THREAD_LIST_MISSING() {
        class: NotFound,
        place: "대화 목록 정합화",
        cause: "제공자가 대화 목록을 반환하지 않았다",
        message: "대화 제공자가 대화 목록을 찾지 못했습니다. 제공자 설정을 확인하세요.",
        fix: "제공자 설정을 확인하세요"
    }
    CONV_RECONCILE_THREAD_MISSING(thread) {
        class: NotFound,
        place: "대화 정합화",
        cause: "목록에 있는 제공자 대화가 조회되지 않는다",
        message: "제공자 대화 {thread}을 불러오지 못했습니다. 제공자에서 대화가 남아 있는지 확인하세요.",
        fix: "제공자에서 대화가 남아 있는지 확인하세요"
    }
    CONV_RECONCILE_NAMESPACE_CONFLICT() {
        class: BindingConflict,
        place: "대화 목록 정합화",
        cause: "제공자 대화의 작업 공간 이름이 요청과 다르다",
        message: "제공자가 다른 작업 공간의 대화를 반환했습니다. 제공자 연결 설정을 확인하세요.",
        fix: "대화 제공자 연결 설정을 확인하세요"
    }
    CONV_RECONCILE_ARCHIVE_NOT_FOUND(thread) {
        class: NotFound,
        place: "이전 작업 대화 보관",
        cause: "보관 요청한 대화를 제공자가 찾지 못했다",
        message: "이전 작업의 대화 {thread}을 제공자에서 찾지 못해 보관하지 못했습니다. 대화 목록을 새로고침하세요.",
        fix: "대화 목록을 새로고침하세요"
    }
    CONV_RECONCILE_BOUND_THREAD_MISSING(workspace) {
        class: NotFound,
        place: "대화 연결 정합화",
        cause: "저장된 연결이 가리키는 대화가 목록에 없다",
        message: "작업 {workspace}에 저장된 제공자 대화가 목록에 없습니다. 대화 연결을 확인하세요.",
        fix: "대화 연결을 확인하세요"
    }
    CONV_RECONCILE_TEMPLATE_INVALID(field, reason) {
        class: InvalidRequest,
        place: "대화 설정 적용",
        cause: "대화 문구 틀이 유효하지 않다",
        message: "대화 설정 {field}의 문구 틀이 올바르지 않습니다: {reason}. 앱 설정을 고치세요.",
        fix: "문구 틀의 변수와 형식을 확인하세요"
    }
    CONV_RECONCILE_MODEL_ORDER_INVALID() {
        class: InvalidRequest,
        place: "대화 설정 적용",
        cause: "모델 순서 설정이 비었거나 중복됐다",
        message: "대화 모델 순서가 비었거나 중복 항목을 포함합니다. 앱 설정의 모델 목록을 고치세요.",
        fix: "앱 설정의 모델 목록을 고치세요"
    }
    CONV_RECONCILE_FINGERPRINT_INVALID() {
        class: InvalidRequest,
        place: "대화 설정 변경 확인",
        cause: "대화 설정을 비교할 수 있게 직렬화하지 못했다",
        message: "대화 설정 변경 내용을 비교하지 못했습니다. 앱 설정 값을 확인한 뒤 다시 저장하세요.",
        fix: "앱 설정 값을 확인하세요"
    }
    CONV_RECONCILE_PATCH_NOT_FOUND(thread) {
        class: NotFound,
        place: "제공자 대화 설정 갱신",
        cause: "설정 갱신 중 대화를 찾지 못했다",
        message: "제공자 대화 {thread}을 찾지 못해 설정을 적용하지 못했습니다. 대화 목록을 새로고침하세요.",
        fix: "대화 목록을 새로고침하세요"
    }
    CONV_SEND_REQUEST_INVALID() {
        class: InvalidRequest,
        place: "대화 메시지 보내기",
        cause: "메시지 또는 첨부가 요청 한도나 형식에 맞지 않는다",
        message: "대화 메시지나 첨부가 보낼 수 있는 형식과 크기에 맞지 않습니다. 글과 첨부를 확인하세요.",
        fix: "메시지와 첨부의 형식과 크기를 확인하세요"
    }
    CONV_SEND_ATTACHMENT_NAME_EMPTY() {
        class: InvalidRequest,
        place: "대화 첨부 보내기",
        cause: "첨부 이름이 비어 있다",
        message: "대화 첨부에 파일 이름이 없습니다. 이름을 확인하고 다시 첨부하세요.",
        fix: "파일 이름을 확인하세요"
    }
    CONV_SEND_ATTACHMENT_ENCODING_INVALID() {
        class: InvalidRequest,
        place: "대화 첨부 보내기",
        cause: "첨부 데이터를 읽을 수 있는 형식으로 받지 못했다",
        message: "대화 첨부 데이터를 읽을 수 없습니다. 파일을 다시 첨부하세요.",
        fix: "파일을 다시 첨부하세요"
    }
    CONV_SEND_ATTACHMENT_TOO_LARGE() {
        class: InvalidRequest,
        place: "대화 첨부 보내기",
        cause: "첨부 하나가 허용 크기를 넘었다",
        message: "대화 첨부 하나가 허용 크기를 넘었습니다. 더 작은 파일을 첨부하세요.",
        fix: "더 작은 파일을 첨부하세요"
    }
    CONV_SEND_ATTACHMENTS_TOO_LARGE() {
        class: InvalidRequest,
        place: "대화 첨부 보내기",
        cause: "첨부 전체가 허용 크기를 넘었다",
        message: "대화 첨부의 전체 크기가 허용량을 넘었습니다. 파일 수나 크기를 줄이세요.",
        fix: "첨부 파일 수나 크기를 줄이세요"
    }
    CONV_SEND_ALREADY_ACTIVE() {
        class: Conflict,
        place: "대화 메시지 보내기",
        cause: "같은 요청이 이미 전송 중이다",
        message: "같은 대화 메시지가 이미 전송 중입니다. 전송이 끝난 뒤 확인하세요.",
        fix: "전송이 끝난 뒤 대화를 확인하세요"
    }
    CONV_SEND_REQUEST_ID_CONFLICT() {
        class: Conflict,
        place: "대화 메시지 다시 보내기",
        cause: "같은 요청 식별자가 다른 본문에 이미 사용됐다",
        message: "이 대화 요청 식별자가 다른 글이나 첨부에 이미 사용됐습니다. 새 메시지로 다시 보내세요.",
        fix: "새 메시지로 다시 보내세요"
    }
    CONV_SEND_PENDING_DIRECTORY_WRITE() {
        class: Io,
        place: "대화 초안 보관",
        cause: "전송 전 대화 초안을 저장할 폴더를 만들지 못했다",
        message: "보내기 전 대화 초안을 이 기기에 보관하지 못했습니다. 저장 공간과 권한을 확인하세요.",
        fix: "저장 공간과 폴더 권한을 확인하세요"
    }
    CONV_SEND_PENDING_FILE_READ() {
        class: Io,
        place: "대화 초안 복구",
        cause: "보관한 대화 초안 파일을 읽지 못했다",
        message: "보관한 대화 초안을 읽지 못했습니다. 저장 공간과 파일 권한을 확인하세요.",
        fix: "파일 권한과 저장 공간을 확인하세요"
    }
    CONV_SEND_PENDING_FILE_INVALID() {
        class: Io,
        place: "대화 초안 복구",
        cause: "보관한 대화 초안의 형식이 잘못됐다",
        message: "보관한 대화 초안의 내용을 읽을 수 없습니다. 초안을 지우고 메시지를 다시 작성하세요.",
        fix: "읽을 수 없는 초안을 지우고 다시 작성하세요"
    }
    CONV_SEND_REPLY_LOST(workspace) {
        class: Unavailable,
        place: "대화 메시지 전송 확인",
        cause: "전송을 맡은 작업 스레드가 결과를 돌려주지 않았다",
        message: "작업 {workspace}의 대화 전송 결과를 확인하지 못했습니다. 초안이 남아 있는지 확인하세요.",
        fix: "대화 화면의 보관 초안을 확인하세요"
    }
    CONV_SEND_THREAD_NOT_FOUND(workspace) {
        class: NotFound,
        place: "대화 메시지 보내기",
        cause: "메시지를 보낼 제공자 대화가 없다",
        message: "작업 {workspace}에 메시지를 보낼 대화가 없습니다. 대화를 다시 불러오세요.",
        fix: "대화를 다시 불러오세요"
    }
    CONV_SEND_RECEIPT_NOT_ACCEPTED(workspace) {
        class: Server,
        place: "대화 메시지 접수 확인",
        cause: "제공자가 메시지를 접수하지 않았다",
        message: "작업 {workspace}의 대화 제공자가 메시지를 접수하지 않았습니다. 보관 초안에서 다시 보내세요.",
        fix: "보관 초안에서 메시지를 다시 보내세요"
    }
    CONV_SEND_PROVIDER_ERROR_MISSING(workspace) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자 실패 응답에 원인 설명이 없다",
        message: "작업 {workspace}의 대화 제공자가 메시지를 거부했지만 이유를 보내지 않았습니다. 제공자 상태를 확인하세요.",
        fix: "제공자 상태를 확인하세요"
    }
    CONV_SEND_PROVIDER_INVALID_REQUEST(workspace, reason) {
        class: InvalidRequest,
        place: "대화 메시지 전송",
        cause: "제공자가 메시지 내용을 요청 형식에 맞지 않는다고 거부했다",
        message: "작업 {workspace}의 대화 제공자가 메시지를 받지 않았습니다: {reason}. 글과 첨부를 확인해 다시 보내세요.",
        fix: "글과 첨부를 확인해 다시 보내세요"
    }
    CONV_SEND_PROVIDER_LOGIN_REQUIRED(workspace, reason) {
        class: LoginRequired,
        place: "대화 메시지 전송",
        cause: "제공자가 로그인을 요구했다",
        message: "작업 {workspace}의 대화 제공자 로그인이 필요합니다: {reason}. 제공자에 로그인한 뒤 다시 보내세요.",
        fix: "대화 제공자에 로그인하세요"
    }
    CONV_SEND_PROVIDER_FORBIDDEN(workspace, reason) {
        class: PermissionDenied,
        place: "대화 메시지 전송",
        cause: "제공자가 현재 계정의 권한을 거부했다",
        message: "작업 {workspace}의 대화 제공자가 계정 권한을 거부했습니다: {reason}. 계정 권한을 확인하세요.",
        fix: "대화 제공자 계정의 권한을 확인하세요"
    }
    CONV_SEND_PROVIDER_NOT_FOUND(workspace, reason) {
        class: NotFound,
        place: "대화 메시지 전송",
        cause: "제공자가 연결된 대화를 찾지 못했다",
        message: "작업 {workspace}의 대화 제공자가 연결된 대화를 찾지 못했습니다: {reason}. 대화를 다시 불러오세요.",
        fix: "대화를 다시 불러오세요"
    }
    CONV_SEND_PROVIDER_CONFLICT(workspace, reason) {
        class: Conflict,
        place: "대화 메시지 전송",
        cause: "제공자가 메시지 상태 충돌로 거부했다",
        message: "작업 {workspace}의 대화 제공자가 현재 상태에서 메시지를 받지 않았습니다: {reason}. 대화를 새로고침한 뒤 다시 보내세요.",
        fix: "대화를 새로고침한 뒤 다시 보내세요"
    }
    CONV_SEND_PROVIDER_ATTACHMENT_LIMIT(workspace, reason) {
        class: InvalidRequest,
        place: "대화 메시지 전송",
        cause: "제공자가 첨부 한도를 넘었다고 거부했다",
        message: "작업 {workspace}의 대화 제공자가 첨부 한도를 초과했습니다: {reason}. 첨부 수나 크기를 줄이세요.",
        fix: "첨부 수나 크기를 줄이세요"
    }
    CONV_SEND_PROVIDER_MODEL_UNAVAILABLE(workspace, reason) {
        class: Unavailable,
        place: "대화 메시지 전송",
        cause: "제공자가 선택한 모델을 사용할 수 없다고 했다",
        message: "작업 {workspace}의 대화 모델을 사용할 수 없습니다: {reason}. 사용 가능한 모델을 선택하세요.",
        fix: "사용 가능한 대화 모델을 선택하세요"
    }
    CONV_SEND_PROVIDER_UNAVAILABLE(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 요청을 처리할 수 없다고 했다",
        message: "작업 {workspace}의 대화 제공자가 요청을 처리하지 못했습니다: {reason}. 잠시 뒤 다시 보내세요.",
        fix: "잠시 뒤 다시 보내세요"
    }
    CONV_SEND_PROVIDER_PENDING(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 메시지 처리가 끝나지 않았다고 했다",
        message: "작업 {workspace}의 대화 제공자가 아직 메시지를 처리하고 있습니다: {reason}. 잠시 뒤 대화를 새로고침하세요.",
        fix: "잠시 뒤 대화를 새로고침하세요"
    }
    CONV_SEND_PENDING_TIMEOUT(workspace) {
        class: Server,
        place: "대화 응답 대기",
        cause: "제공자가 계속 pending으로 응답해 제한 시간 안에 끝나지 않았다",
        message: "작업 {workspace}의 대화 제공자가 제한 시간 안에 처리를 끝내지 않았습니다. 잠시 뒤 대화를 다시 불러오세요.",
        fix: "잠시 뒤 대화를 다시 불러오세요"
    }
    CONV_HTTP_PROVIDER_UNAVAILABLE(provider) {
        class: Unavailable,
        place: "대화 제공자 연결 확인",
        cause: "앱에 설정된 제공자 연결이 없다",
        message: "대화 제공자 연결 {provider}을 사용할 수 없습니다. 앱의 연결 설정을 확인하세요.",
        fix: "앱의 제공자 연결 설정을 확인하세요"
    }
    CONV_HTTP_PERMISSION_DENIED(provider) {
        class: PermissionDenied,
        place: "대화 제공자 요청 검증",
        cause: "제공자 요청이 앱 권한 범위를 벗어났다",
        message: "대화 제공자 {provider}에 요청할 권한이 없습니다. 앱의 연결 경로와 쓰기 권한을 확인하세요.",
        fix: "앱의 연결 경로와 쓰기 권한을 확인하세요"
    }
    CONV_HTTP_PATH_INVALID(path) {
        class: PermissionDenied,
        place: "대화 제공자 요청 경로 확인",
        cause: "요청 경로가 앱 연결 허용 범위에 없다",
        message: "대화 제공자 요청 경로 {path}는 앱에서 허용되지 않았습니다. 앱의 연결 경로를 확인하세요.",
        fix: "앱에서 허용한 연결 경로를 확인하세요"
    }
    CONV_HTTP_BODY_INVALID() {
        class: InvalidRequest,
        place: "대화 제공자 요청 만들기",
        cause: "대화 요청 본문을 직렬화하지 못했다",
        message: "대화 제공자에 보낼 요청을 만들지 못했습니다. 앱 설정 값을 확인하세요.",
        fix: "앱 설정 값을 확인하세요"
    }
    CONV_HTTP_RESPONSE_READ_FAILED(host) {
        class: Server,
        place: "대화 제공자 응답 읽기",
        cause: "제공자 응답을 네트워크에서 읽지 못했다",
        message: "대화 제공자 {host}의 응답을 읽지 못했습니다. 네트워크와 제공자 상태를 확인하세요.",
        fix: "네트워크와 제공자 상태를 확인하세요"
    }
    CONV_HTTP_RESPONSE_INVALID(provider, reason) {
        class: Server,
        place: "대화 제공자 응답 해석",
        cause: "제공자 응답이 약속한 JSON 형식이 아니다",
        message: "대화 제공자 {provider}의 응답을 읽을 수 없습니다: {reason}. 제공자 상태를 확인하세요.",
        fix: "제공자 상태를 확인하세요"
    }
    CONV_HTTP_REQUEST_FAILED(host) {
        class: Server,
        place: "대화 제공자 요청 전송",
        cause: "제공자에 요청을 보내지 못했다",
        message: "대화 제공자 {host}에 요청하지 못했습니다. 네트워크와 제공자 주소를 확인하세요.",
        fix: "네트워크와 제공자 주소를 확인하세요"
    }
    CONV_HTTP_STATUS_LOGIN_REQUIRED(provider) {
        class: LoginRequired,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 로그인을 요구하는 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}에서 로그인이 필요합니다. 제공자에 로그인한 뒤 다시 시도하세요.",
        fix: "대화 제공자에 로그인하세요"
    }
    CONV_HTTP_STATUS_FORBIDDEN(provider) {
        class: PermissionDenied,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 권한 거부 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}가 이 요청을 허용하지 않았습니다. 계정 권한을 확인하세요.",
        fix: "대화 제공자 계정의 권한을 확인하세요"
    }
    CONV_HTTP_STATUS_NOT_FOUND(provider) {
        class: NotFound,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 대상을 찾지 못하는 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}에서 요청한 대상을 찾지 못했습니다. 대화나 모델 설정을 확인하세요.",
        fix: "대화와 모델 설정을 확인하세요"
    }
    CONV_HTTP_STATUS_CONFLICT(provider) {
        class: Conflict,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 충돌 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}가 현재 상태에서 요청을 처리하지 않았습니다. 대화를 새로고침하세요.",
        fix: "대화를 새로고침하세요"
    }
    CONV_HTTP_STATUS_INVALID_REQUEST(provider) {
        class: InvalidRequest,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 요청 거부 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}가 요청 내용을 받지 않았습니다. 대화 설정과 첨부를 확인하세요.",
        fix: "대화 설정과 첨부를 확인하세요"
    }
    CONV_HTTP_STATUS_SERVER(provider) {
        class: Server,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 요청을 처리하지 못하는 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}가 요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.",
        fix: "잠시 뒤 다시 시도하세요"
    }
    CONV_HTTP_ATTACHMENT_TOO_LARGE() {
        class: InvalidRequest,
        place: "대화 첨부 받기",
        cause: "제공자 첨부가 허용 크기를 넘었다",
        message: "제공자 첨부가 이 앱의 허용 크기를 넘었습니다. 더 작은 첨부를 열어 보세요.",
        fix: "더 작은 첨부를 선택하세요"
    }
    CONV_HTTP_LOGIN_REQUIRED(provider) {
        class: LoginRequired,
        place: "대화 제공자 로그인 확인",
        cause: "기기 로그인 정보가 없거나 갱신된 자격도 거부됐다",
        message: "대화 제공자 {provider}에 기기 로그인이 필요합니다. 제공자에 로그인하세요.",
        fix: "대화 제공자에 로그인하세요"
    }
    CONV_CONVERSATION_REQUEST_INVALID() {
        class: InvalidRequest,
        place: "대화 명령 확인",
        cause: "대화 모듈에서 처리할 수 없는 명령이다",
        message: "이 명령은 대화 기능에서 처리할 수 없습니다. 대화 화면에서 다시 시도하세요.",
        fix: "대화 화면에서 다시 시도하세요"
    }
    CONV_CONVERSATION_PROFILE_MISSING() {
        class: InvalidRequest,
        place: "대화 시작 화면 구성",
        cause: "앱 설정에서 시작 프로필을 찾지 못했다",
        message: "대화를 시작할 프로필이 설정되지 않았습니다. 앱 설정에서 프로필을 지정하세요.",
        fix: "앱 설정에서 대화 프로필을 지정하세요"
    }
    CONV_CONVERSATION_THREAD_NOT_FOUND(workspace) {
        class: NotFound,
        place: "대화 기록 불러오기",
        cause: "작업에 연결된 대화가 없다",
        message: "작업 {workspace}에 연결된 대화가 없습니다. 대화를 다시 불러오거나 새로 만드세요.",
        fix: "대화를 다시 불러오거나 새로 만드세요"
    }
    CONV_CONVERSATION_ATTACHMENT_THREAD_NOT_FOUND(workspace) {
        class: NotFound,
        place: "대화 첨부 열기",
        cause: "첨부가 속한 대화를 찾지 못했다",
        message: "작업 {workspace}에서 첨부가 속한 대화를 찾지 못했습니다. 대화 기록을 새로고침하세요.",
        fix: "대화 기록을 새로고침하세요"
    }
    CONV_CONVERSATION_ATTACHMENT_WRITE_FAILED(name) {
        class: Io,
        place: "대화 첨부 저장",
        cause: "내려받은 첨부를 기기에 저장하지 못했다",
        message: "대화 첨부 {name}을 이 기기에 저장하지 못했습니다. 저장 공간과 권한을 확인하세요.",
        fix: "저장 공간과 폴더 권한을 확인하세요"
    }
    CONV_CONVERSATION_ATTACHMENT_OPEN_FAILED(name) {
        class: Io,
        place: "대화 첨부 열기",
        cause: "기본 앱으로 첨부를 열지 못했다",
        message: "대화 첨부 {name}을 열지 못했습니다. 파일을 저장한 뒤 직접 열어 보세요.",
        fix: "파일을 저장한 뒤 직접 여세요"
    }
    CONV_CONVERSATION_FEATURE_UNAVAILABLE() {
        class: Unavailable,
        place: "대화 기능 실행",
        cause: "현재 실행 환경에서 요청 기능을 제공하지 않는다",
        message: "현재 실행 환경에서 이 대화 기능을 사용할 수 없습니다. 지원되는 앱에서 다시 시도하세요.",
        fix: "지원되는 앱에서 다시 시도하세요"
    }
    CONV_CONVERSATION_MODELS_MISSING() {
        class: NotFound,
        place: "대화 모델 목록 불러오기",
        cause: "제공자가 모델 목록을 반환하지 않았다",
        message: "대화 제공자가 모델 목록을 보내지 않았습니다. 제공자 설정을 확인하세요.",
        fix: "제공자 설정을 확인하세요"
    }
    CONV_CONVERSATION_PROFILES_MISSING() {
        class: NotFound,
        place: "대화 프로필 목록 불러오기",
        cause: "제공자가 프로필 목록을 반환하지 않았다",
        message: "대화 제공자가 프로필 목록을 보내지 않았습니다. 제공자 설정을 확인하세요.",
        fix: "제공자 설정을 확인하세요"
    }
    CONV_CONVERSATION_HISTORY_NOT_FOUND(thread) {
        class: NotFound,
        place: "대화 기록 불러오기",
        cause: "제공자가 대화 기록을 반환하지 않았다",
        message: "제공자 대화 {thread}의 기록을 찾을 수 없습니다. 대화를 다시 불러오세요.",
        fix: "대화를 다시 불러오세요"
    }
}
