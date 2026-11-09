error_catalog! { ENTRIES;
    CONV_CONTEXT_PROVIDER_MISSING() {
        class: InvalidRequest,
        place: "대화 설정 불러오기",
        cause: "앱에 대화 제공자 설정이 없다",
        message: "앱 정의에 대화 제공자가 없습니다. 앱 정의에 agent를 선언하세요.",
        fix: "앱 정의에 agent를 선언하세요"
    }
    CONV_CONTEXT_PERMISSION_MISSING() {
        class: PermissionDenied,
        place: "대화 제공자 연결 확인",
        cause: "앱에 읽기·쓰기 연결 권한이 없다",
        message: "대화 제공자 연결 권한이 앱 정의에 쓰기로 선언되지 않았습니다. agent.permission이 가리키는 권한의 access를 readwrite로 선언하세요.",
        fix: "agent.permission이 가리키는 권한의 access를 readwrite로 선언하세요"
    }
    CONV_CONTEXT_LINK_MISSING() {
        class: Unavailable,
        place: "대화 설정 불러오기",
        cause: "서버 연결 정보가 없다",
        message: "대화를 열 서버 연결 정보가 없습니다. 서버 연결에서 서버를 다시 연결하세요.",
        fix: "서버 연결에서 서버를 다시 연결하세요"
    }
    CONV_CONTEXT_PROVIDER_NOT_OAUTH() {
        class: InvalidRequest,
        place: "대화 제공자 연결 확인",
        cause: "대화 제공자 연결이 OAuth가 아니다",
        message: "대화 제공자 연결은 기기 로그인 방식이어야 합니다. 앱 정의 agent.permission이 OAuth 연결을 가리키게 고치세요.",
        fix: "앱 정의 agent.permission이 OAuth 연결을 가리키게 고치세요"
    }
    CONV_CONTEXT_CONNECTION_MISSING(connection) {
        class: Unavailable,
        place: "대화 제공자 연결 복원",
        cause: "저장된 제공자 연결이 없다",
        message: "대화 제공자 연결 {connection}: 찾을 수 없습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "set_connection으로 연결을 등록하고 앱 정의의 연결 이름을 확인하세요"
    }
    CONV_HTTP_RESTORE_CONNECTION_NOT_OAUTH(connection) {
        class: PermissionDenied,
        place: "대화 제공자 연결 복원",
        cause: "저장된 제공자 연결이 OAuth 방식이 아니다",
        message: "대화 제공자 연결 {connection}: 기기 로그인 방식이 아닙니다. 앱 정의 agent.permission이 OAuth 연결을 가리키게 고치세요.",
        fix: "앱 정의 agent.permission이 OAuth 연결을 가리키게 고치세요"
    }
    CONV_HTTP_RESTORE_CONNECTION_NOT_WRITABLE(connection) {
        class: PermissionDenied,
        place: "대화 제공자 연결 복원",
        cause: "제공자 연결에 쓰기 권한이 없다",
        message: "대화 제공자 연결 {connection}: 읽기 전용입니다. set_connection에서 writable을 켜세요.",
        fix: "set_connection에서 writable을 켜세요"
    }
    CONV_CONTEXT_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "대화 창 열기",
        cause: "대상 창이 없다",
        message: "대화 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    CONV_CONTEXT_DESKTOP_NOT_FOUND() {
        class: NotFound,
        place: "대화 작업 확인",
        cause: "창이 속한 데스크톱이 없다",
        message: "대화 창이 속한 데스크톱이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    CONV_CONTEXT_WORKSPACE_NOT_FOUND() {
        class: NotFound,
        place: "대화 작업 확인",
        cause: "데스크톱이 속한 작업이 없다",
        message: "대화 창이 속한 작업이 더 이상 없습니다. 작업 메뉴에서 남은 작업을 고르세요.",
        fix: "작업 메뉴에서 남은 작업을 고르세요"
    }
    CONV_CONTEXT_APP_NOT_FOUND(app) {
        class: NotFound,
        place: "대화 앱 확인",
        cause: "창의 앱 버전을 찾을 수 없다",
        message: "대화 앱 {app}: 이 창이 쓰는 판의 정의가 이 쉘에 없습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    CONV_CONTEXT_BINDING_INVALID(field, reason) {
        class: InvalidRequest,
        place: "대화 설정 읽기",
        cause: "대화 설정 값의 식을 계산할 수 없다",
        message: "대화 설정 {field}: 식을 계산하지 못했습니다. 앱 설정이나 앱 정의 agent의 값을 고치세요. 원인: {reason}",
        fix: "앱 설정이나 앱 정의 agent의 값을 고치세요"
    }
    CONV_CONTEXT_MODELS_MISSING() {
        class: NotFound,
        place: "대화 모델 목록 불러오기",
        cause: "제공자가 모델 목록을 반환하지 않았다",
        message: "대화 제공자가 모델 목록을 보내지 않았습니다. 다시 시도를 누르고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "제공자 연결과 프로필 설정을 확인하세요"
    }
    CONV_CONTEXT_THREAD_ENTRY_INVALID() {
        class: InvalidRequest,
        place: "저장된 대화 연결 읽기",
        cause: "저장된 대화 참조에 대화 식별자가 없다",
        message: "저장된 대화 연결이 손상돼 대화를 열 수 없습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "저장된 대화 연결을 다시 설정하세요"
    }
    CONV_CONTEXT_SAVED_BINDING_MISMATCH(workspace) {
        class: BindingConflict,
        place: "저장된 대화 연결 확인",
        cause: "저장된 대화 연결의 작업 정보가 현재 설정과 다르다",
        message: "작업 이름 {workspace}: 저장된 대화 연결 정보가 현재 설정과 맞지 않습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    CONV_CONTEXT_ADOPTED_THREAD_MISMATCH() {
        class: BindingConflict,
        place: "기존 대화 연결 복구",
        cause: "제공자가 요청한 대화와 다른 대화를 반환했다",
        message: "저장된 대화와 제공자가 돌려준 대화가 다릅니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    CONV_CONTEXT_ADOPTION_NOT_FOUND(workspace) {
        class: NotFound,
        place: "기존 대화 연결 복구",
        cause: "저장된 제공자 대화가 더 이상 없다",
        message: "작업 이름 {workspace}: 연결된 제공자 대화를 찾을 수 없습니다. 새 대화를 시작하세요.",
        fix: "새 대화를 시작하세요"
    }
    CONV_CONTEXT_ATTACHED_NOT_FOUND(workspace) {
        class: NotFound,
        place: "연결한 대화 읽기",
        cause: "연결한 제공자 대화가 더 이상 없다",
        message: "작업 이름 {workspace}: 연결한 대화를 제공자에서 찾지 못했습니다. 대화 바꾸기로 연결을 풀고 다시 고르세요.",
        fix: "대화 바꾸기로 연결을 풀고 다시 고르세요"
    }
    CONV_CONTEXT_VALUE_MISSING(field) {
        class: InvalidRequest,
        place: "대화 설정 읽기",
        cause: "필수 설정 값이 문자열이 아니다",
        message: "대화 설정 {field}: 글자 값이 없습니다. 앱 설정에 값을 입력하세요.",
        fix: "앱 설정에 글자 값을 입력하세요"
    }
    CONV_CONTEXT_VALUE_EMPTY(field) {
        class: InvalidRequest,
        place: "대화 설정 읽기",
        cause: "필수 설정 값이 비어 있다",
        message: "대화 설정 {field}: 값이 비어 있습니다. 앱 설정에 값을 입력하세요.",
        fix: "앱 설정에 값을 입력하세요"
    }
    CONV_SELECTION_CREATE_NOT_FOUND(workspace) {
        class: NotFound,
        place: "대화 만들기",
        cause: "제공자가 새 대화를 만들지 않았다",
        message: "작업 이름 {workspace}: 제공자가 대화를 만들지 않았습니다. 시작을 다시 누르고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "제공자 연결을 확인하세요"
    }
    CONV_SELECTION_BINDING_CONFLICT(workspace) {
        class: BindingConflict,
        place: "대화 만들기",
        cause: "동시에 저장된 대화가 새 대화와 다르다",
        message: "작업 이름 {workspace}: 다른 대화가 이미 연결되어 있습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    CONV_SELECTION_MODEL_ORDER_INVALID() {
        class: InvalidRequest,
        place: "대화 모델 설정 읽기",
        cause: "모델 목록이 비었거나 중복되거나 문자열이 아니다",
        message: "대화 모델 목록을 쓸 수 없습니다. 앱 설정의 모델 목록에 빈 값과 중복 없이 모델 이름을 적으세요.",
        fix: "앱 설정의 모델 목록을 고치세요"
    }
    CONV_SELECTION_MODEL_EMPTY() {
        class: InvalidRequest,
        place: "대화 모델 전환",
        cause: "요청한 모델 이름이 비었다",
        message: "요청한 대화 모델 이름이 비어 있습니다. 사용 가능한 모델을 선택하세요.",
        fix: "사용 가능한 모델을 선택하세요"
    }
    CONV_SELECTION_TEMPLATE_INVALID(field, reason) {
        class: InvalidRequest,
        place: "대화 문구 설정 확인",
        cause: "대화 문구 틀이 유효하지 않다",
        message: "대화 설정 {field}의 문구 틀이 올바르지 않습니다. 앱 설정을 고치세요. 원인: {reason}",
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
        message: "작업 이름 {workspace}: 전환할 대화가 없습니다. 먼저 대화를 만드세요.",
        fix: "먼저 대화를 만드세요"
    }
    CONV_SELECTION_MODEL_UPDATE_TARGET_MISSING() {
        class: NotFound,
        place: "대화 모델 갱신",
        cause: "모델 목록 확인 뒤 대화 갱신 요청에서 대화를 찾지 못했다",
        message: "모델을 바꾸려는 대화가 더 이상 없습니다. 다시 시도하세요.",
        fix: "다시 시도하세요"
    }
    CONV_SELECTION_MODEL_PATCH_THREAD_MISMATCH() {
        class: BindingConflict,
        place: "대화 모델 갱신",
        cause: "모델 갱신에서 제공자가 다른 대화를 반환했다",
        message: "모델을 바꾸는 중 제공자가 다른 대화를 돌려줬습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    CONV_SELECTION_PROFILE_SWITCH_THREAD_MISMATCH() {
        class: BindingConflict,
        place: "대화 프로필 전환",
        cause: "프로필 전환에서 제공자가 다른 대화를 반환했다",
        message: "프로필을 바꾸는 중 제공자가 다른 대화를 돌려줬습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    CONV_SELECTION_PROFILE_MISSING() {
        class: InvalidRequest,
        place: "대화 프로필 전환",
        cause: "프로필 변경에 필요한 대상 프로필이 없다",
        message: "바꿀 대화 프로필을 확인할 수 없습니다. 프로필을 선택한 뒤 다시 시도하세요.",
        fix: "대화 프로필을 선택하세요"
    }
    CONV_ATTACH_ALREADY_BOUND(workspace) {
        class: BindingConflict,
        place: "기존 대화 연결",
        cause: "이 작업에 이미 대화가 저장되어 있다",
        message: "작업 이름 {workspace}: 이미 연결된 대화가 있습니다. 대화 바꾸기로 연결을 푼 뒤 다시 연결하세요.",
        fix: "대화 바꾸기로 연결을 푸세요"
    }
    CONV_ATTACH_NOT_FOUND() {
        class: NotFound,
        place: "기존 대화 연결",
        cause: "고른 대화를 제공자가 찾지 못했다",
        message: "고른 대화를 제공자에서 찾지 못했습니다. 대화 목록을 다시 열고 다른 대화를 고르세요.",
        fix: "대화 목록을 다시 열고 다시 고르세요"
    }
    CONV_ATTACH_CONFLICT() {
        class: Conflict,
        place: "기존 대화 연결",
        cause: "고른 대화가 이미 다른 곳에 연결되어 있다",
        message: "고른 대화가 이미 다른 곳에 연결되어 있습니다. 대화 목록을 다시 열고 다른 대화를 고르세요.",
        fix: "다른 대화를 고르세요"
    }
    CONV_SWITCH_ATTACHED() {
        class: InvalidRequest,
        place: "대화 프로필 전환",
        cause: "연결한 대화의 프로필이나 모델을 바꾸려 했다",
        message: "연결한 대화의 프로필이나 모델은 이 창에서 바꿀 수 없습니다. 대화 바꾸기로 연결을 푼 뒤 새 대화를 시작하세요.",
        fix: "대화 바꾸기로 연결을 푸세요"
    }
    CONV_RECONCILE_REQUEST_INVALID() {
        class: InvalidRequest,
        place: "대화 설정 재적용",
        cause: "대화 설정 명령이 아니다",
        message: "대화 설정 명령이 쉘 안에서 잘못 전달됐습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    CONV_RECONCILE_BINDING_INVALID(workspace) {
        class: BindingConflict,
        place: "대화 연결 정합화",
        cause: "저장된 대화 연결에 식별자가 없다",
        message: "작업 이름 {workspace}: 저장된 대화 연결이 손상됐습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    CONV_RECONCILE_BINDING_CONFLICT(workspace) {
        class: BindingConflict,
        place: "대화 연결 정합화",
        cause: "저장된 대화 연결의 작업 정보가 현재 작업과 다르다",
        message: "작업 이름 {workspace}: 저장된 대화 연결 정보가 현재 제공자 대화와 다릅니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "에이전트에게 이 오류 코드를 전하세요"
    }
    CONV_RECONCILE_THREAD_LIST_MISSING() {
        class: NotFound,
        place: "대화 목록 정합화",
        cause: "제공자가 대화 목록을 반환하지 않았다",
        message: "대화 제공자가 대화 목록을 보내지 않았습니다. 다시 시도를 누르고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "제공자 연결과 프로필 설정을 확인하세요"
    }
    CONV_RECONCILE_THREAD_MISSING() {
        class: NotFound,
        place: "대화 정합화",
        cause: "목록에 있는 제공자 대화가 조회되지 않는다",
        message: "제공자 대화 목록에 있는 대화를 불러오지 못했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "제공자에서 대화가 남아 있는지 확인하세요"
    }
    CONV_RECONCILE_NAMESPACE_CONFLICT() {
        class: BindingConflict,
        place: "대화 목록 정합화",
        cause: "제공자 대화의 작업 공간 이름이 요청과 다르다",
        message: "제공자가 다른 작업의 대화를 돌려줬습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "대화 제공자 연결 설정을 확인하세요"
    }
    CONV_RECONCILE_ARCHIVE_NOT_FOUND() {
        class: NotFound,
        place: "이전 작업 대화 보관",
        cause: "보관 요청한 대화를 제공자가 찾지 못했다",
        message: "이전 작업의 대화를 제공자에서 찾지 못해 보관하지 못했습니다. 이미 지워졌을 수 있습니다. 추가 조치는 필요하지 않습니다.",
        fix: "추가 조치는 필요하지 않습니다"
    }
    CONV_RECONCILE_BOUND_THREAD_MISSING() {
        class: NotFound,
        place: "대화 연결 정합화",
        cause: "저장된 연결이 가리키는 대화가 목록에 없다",
        message: "저장된 대화가 제공자 목록에 없습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "대화 연결을 확인하세요"
    }
    CONV_RECONCILE_TEMPLATE_INVALID(field, reason) {
        class: InvalidRequest,
        place: "대화 설정 적용",
        cause: "대화 문구 틀이 유효하지 않다",
        message: "대화 설정 {field}의 문구 틀이 올바르지 않습니다. 앱 설정을 고치세요. 원인: {reason}",
        fix: "문구 틀의 변수와 형식을 확인하세요"
    }
    CONV_RECONCILE_MODEL_ORDER_INVALID() {
        class: InvalidRequest,
        place: "대화 설정 적용",
        cause: "모델 순서 설정이 비었거나 중복됐다",
        message: "대화 모델 순서를 쓸 수 없습니다. 앱 설정의 모델 목록에 빈 값과 중복 없이 모델 이름을 적으세요.",
        fix: "앱 설정의 모델 목록을 고치세요"
    }
    CONV_RECONCILE_FINGERPRINT_INVALID() {
        class: InvalidRequest,
        place: "대화 설정 변경 확인",
        cause: "대화 설정을 비교할 수 있게 직렬화하지 못했다",
        message: "대화 설정 변경 내용을 비교하지 못했습니다. 앱 설정 값을 확인한 뒤 다시 저장하세요.",
        fix: "앱 설정 값을 확인하세요"
    }
    CONV_RECONCILE_PATCH_NOT_FOUND() {
        class: NotFound,
        place: "제공자 대화 설정 갱신",
        cause: "설정 갱신 중 대화를 찾지 못했다",
        message: "설정을 적용할 대화를 제공자에서 찾지 못했습니다. 다시 시도하세요.",
        fix: "다시 시도하세요"
    }
    CONV_SEND_REQUEST_ID_MISSING() {
        class: InvalidRequest,
        place: "대화 메시지 보내기",
        cause: "요청 식별자가 비었다",
        message: "대화 요청 ID가 비어 있습니다. 쉘을 업데이트한 뒤 다시 보내세요.",
        fix: "쉘을 업데이트하세요"
    }
    CONV_SEND_MESSAGE_EMPTY() {
        class: InvalidRequest,
        place: "대화 메시지 보내기",
        cause: "글과 첨부가 모두 비었다",
        message: "대화 글과 첨부가 모두 비어 있습니다. 글을 쓰거나 첨부를 추가하세요.",
        fix: "글을 쓰거나 첨부를 추가하세요"
    }
    CONV_SEND_MESSAGE_TOO_LONG(limit) {
        class: InvalidRequest,
        place: "대화 메시지 보내기",
        cause: "글자 수가 대화 메시지 한도를 넘었다",
        message: "대화 글이 허용 길이 {limit}자를 넘었습니다. 글을 줄여 다시 보내세요.",
        fix: "글을 줄여 다시 보내세요"
    }
    CONV_SEND_ATTACHMENT_COUNT_EXCEEDED(limit) {
        class: InvalidRequest,
        place: "대화 메시지 보내기",
        cause: "첨부 개수가 대화 메시지 한도를 넘었다",
        message: "대화 첨부 수가 허용 개수 {limit}개를 넘었습니다. 첨부 수를 줄여 다시 보내세요.",
        fix: "첨부 수를 줄여 다시 보내세요"
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
    CONV_SEND_ATTACHMENT_TOO_LARGE(limit) {
        class: InvalidRequest,
        place: "대화 첨부 보내기",
        cause: "첨부 하나가 허용 크기를 넘었다",
        message: "대화 첨부 하나가 허용 크기 {limit}보다 큽니다. 더 작은 파일을 첨부하세요.",
        fix: "더 작은 파일을 첨부하세요"
    }
    CONV_SEND_ATTACHMENTS_TOO_LARGE(limit) {
        class: InvalidRequest,
        place: "대화 첨부 보내기",
        cause: "첨부 전체가 허용 크기를 넘었다",
        message: "대화 첨부의 전체 크기가 허용 크기 {limit}보다 큽니다. 파일 수나 크기를 줄이세요.",
        fix: "첨부 파일 수나 크기를 줄이세요"
    }
    CONV_SEND_ALREADY_ACTIVE() {
        class: Conflict,
        place: "대화 메시지 보내기",
        cause: "같은 요청이 이미 전송 중이다",
        message: "같은 대화 메시지가 이미 전송 중입니다. 전송이 끝난 뒤 확인하세요.",
        fix: "전송이 끝난 뒤 대화를 확인하세요"
    }
    CONV_SEND_REQUEST_ID_CONTENT_MISMATCH() {
        class: Conflict,
        place: "대화 메시지 다시 보내기",
        cause: "같은 요청 식별자가 다른 본문에 이미 사용됐다",
        message: "이미 보낸 요청과 내용이 달라 보내지 못했습니다. 글을 다시 보내세요.",
        fix: "글을 다시 보내세요"
    }
    CONV_SEND_PREVIOUS_REQUEST_FAILED() {
        class: Conflict,
        place: "대화 메시지 다시 보내기",
        cause: "같은 요청 식별자의 이전 전송이 실패했다",
        message: "이전 전송이 실패한 요청입니다. 글을 다시 보내세요.",
        fix: "글을 다시 보내세요"
    }
    CONV_SEND_PENDING_DIRECTORY_WRITE() {
        class: Io,
        place: "대화 초안 보관",
        cause: "전송 전 대화 초안을 저장할 폴더를 만들지 못했다",
        message: "보낼 글을 이 기기에 임시 저장하지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    CONV_SEND_PENDING_FILE_READ() {
        class: Io,
        place: "대화 초안 복구",
        cause: "보관한 대화 초안 파일을 읽지 못했다",
        message: "임시 저장한 글을 읽지 못했습니다. 글을 다시 써서 보내세요.",
        fix: "글을 다시 써서 보내세요"
    }
    CONV_SEND_PENDING_FILE_INVALID() {
        class: Io,
        place: "대화 초안 복구",
        cause: "보관한 대화 초안의 형식이 잘못됐다",
        message: "임시 저장한 글이 손상됐습니다. 글을 다시 써서 보내세요.",
        fix: "글을 다시 써서 보내세요"
    }
    CONV_SEND_REPLY_LOST(workspace) {
        class: Unavailable,
        place: "대화 메시지 전송 확인",
        cause: "전송을 맡은 작업 스레드가 결과를 돌려주지 않았다",
        message: "작업 이름 {workspace}: 대화 전송 결과를 확인하지 못했습니다. 대화에 글이 올라왔는지 확인한 뒤 다시 보내세요.",
        fix: "대화에 글이 올라왔는지 확인한 뒤 다시 보내세요"
    }
    CONV_SEND_THREAD_NOT_FOUND(workspace) {
        class: NotFound,
        place: "대화 메시지 보내기",
        cause: "메시지를 보낼 제공자 대화가 없다",
        message: "작업 이름 {workspace}: 메시지를 보낼 대화가 없습니다. 새 대화를 시작한 뒤 다시 보내세요.",
        fix: "새 대화를 시작한 뒤 다시 보내세요"
    }
    CONV_SEND_RECEIPT_NOT_ACCEPTED(workspace) {
        class: Server,
        place: "대화 메시지 접수 확인",
        cause: "제공자가 메시지를 접수하지 않았다",
        message: "작업 이름 {workspace}: 대화 제공자가 메시지를 접수하지 않았습니다. 입력창에 돌아온 글을 다시 보내세요.",
        fix: "입력창에 돌아온 글을 다시 보내세요"
    }
    CONV_SEND_PROVIDER_ERROR_MISSING(workspace) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자 실패 응답에 원인 설명이 없다",
        message: "작업 이름 {workspace}: 대화 제공자가 메시지를 거부했지만 이유를 보내지 않았습니다. 잠시 뒤 다시 보내고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "제공자 연결을 확인하세요"
    }
    CONV_SEND_PROVIDER_INVALID_REQUEST(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 메시지 내용을 요청 형식에 맞지 않는다고 거부했다",
        message: "작업 이름 {workspace}: 대화 제공자가 메시지를 받지 않았습니다. 글과 첨부를 확인해 다시 보내세요. 원인: {reason}",
        fix: "글과 첨부를 확인해 다시 보내세요"
    }
    CONV_SEND_PROVIDER_LOGIN_REQUIRED(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 로그인을 요구했다",
        message: "작업 이름 {workspace}: 대화 제공자 로그인이 필요합니다. 제공자에 로그인한 뒤 다시 보내세요. 원인: {reason}",
        fix: "대화 제공자에 로그인하세요"
    }
    CONV_SEND_PROVIDER_FORBIDDEN(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 현재 계정의 권한을 거부했다",
        message: "작업 이름 {workspace}: 대화 제공자가 이 계정의 요청을 거부했습니다. 제공자 계정이 이 기능을 쓸 수 있는지 확인하세요. 원인: {reason}",
        fix: "제공자 계정이 이 기능을 쓸 수 있는지 확인하세요"
    }
    CONV_SEND_PROVIDER_NOT_FOUND(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 연결된 대화를 찾지 못했다",
        message: "작업 이름 {workspace}: 대화 제공자가 연결된 대화를 찾지 못했습니다. 새 대화를 시작한 뒤 다시 보내세요. 원인: {reason}",
        fix: "새 대화를 시작한 뒤 다시 보내세요"
    }
    CONV_SEND_PROVIDER_CONFLICT(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 메시지 상태 충돌로 거부했다",
        message: "작업 이름 {workspace}: 대화 제공자가 현재 상태에서 메시지를 받지 않았습니다. 잠시 뒤 다시 보내세요. 원인: {reason}",
        fix: "잠시 뒤 다시 보내세요"
    }
    CONV_SEND_PROVIDER_ATTACHMENT_LIMIT(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "첨부가 제공자 한도를 넘었다",
        message: "작업 이름 {workspace}: 첨부가 제공자 한도를 넘었습니다. 첨부 수나 크기를 줄이세요. 원인: {reason}",
        fix: "첨부 수나 크기를 줄이세요"
    }
    CONV_SEND_PROVIDER_MODEL_UNAVAILABLE(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 선택한 모델을 사용할 수 없다고 했다",
        message: "작업 이름 {workspace}: 선택한 대화 모델을 사용할 수 없습니다. 사용 가능한 모델을 선택하세요. 원인: {reason}",
        fix: "사용 가능한 대화 모델을 선택하세요"
    }
    CONV_SEND_PROVIDER_UNAVAILABLE(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 요청을 처리할 수 없다고 했다",
        message: "작업 이름 {workspace}: 대화 제공자가 지금 요청을 받을 수 없습니다. 잠시 뒤 다시 보내세요. 원인: {reason}",
        fix: "잠시 뒤 다시 보내세요"
    }
    CONV_SEND_PROVIDER_PENDING(workspace, reason) {
        class: Server,
        place: "대화 메시지 전송",
        cause: "제공자가 메시지 처리가 끝나지 않았다고 했다",
        message: "작업 이름 {workspace}: 대화 제공자가 아직 메시지를 처리하고 있습니다. 응답이 올 때까지 기다리세요. 원인: {reason}",
        fix: "응답이 올 때까지 기다리세요"
    }
    CONV_SEND_PENDING_TIMEOUT(workspace) {
        class: Server,
        place: "대화 응답 대기",
        cause: "제공자가 계속 pending으로 응답해 제한 시간 안에 끝나지 않았다",
        message: "작업 이름 {workspace}: 대화 제공자가 제한 시간 안에 처리를 끝내지 않았습니다. 잠시 뒤 대화에 응답이 왔는지 확인하세요.",
        fix: "잠시 뒤 대화에 응답이 왔는지 확인하세요"
    }
    CONV_HTTP_PROVIDER_UNAVAILABLE(provider) {
        class: Unavailable,
        place: "대화 제공자 연결 확인",
        cause: "앱에 설정된 제공자 연결이 없다",
        message: "대화 제공자 연결 {provider}: 사용할 수 없습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "앱의 제공자 연결 설정을 확인하세요"
    }
    CONV_HTTP_PERMISSION_DENIED(provider) {
        class: PermissionDenied,
        place: "대화 제공자 요청 검증",
        cause: "제공자 요청이 앱 권한 범위를 벗어났다",
        message: "대화 제공자 {provider}: 앱 정의가 이 요청을 허용하지 않습니다. 앱 정의 permissions의 access와 연결의 허용 경로를 확인하세요.",
        fix: "앱 정의 permissions의 access와 연결의 허용 경로를 확인하세요"
    }
    CONV_HTTP_PATH_INVALID(path) {
        class: PermissionDenied,
        place: "대화 제공자 요청 경로 확인",
        cause: "요청 경로가 앱 연결 허용 범위에 없다",
        message: "대화 제공자 요청 경로 {path}: 연결의 허용 경로에 없습니다. set_connection으로 허용 경로를 더하세요.",
        fix: "set_connection으로 허용 경로를 더하세요"
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
        message: "대화 제공자 {host}의 응답을 읽지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.",
        fix: "네트워크를 확인한 뒤 다시 시도하세요"
    }
    CONV_HTTP_RESPONSE_INVALID(provider, reason) {
        class: Server,
        place: "대화 제공자 응답 해석",
        cause: "제공자 응답이 약속한 JSON 형식이 아니다",
        message: "대화 제공자 {provider}의 응답을 읽을 수 없습니다. 에이전트에게 이 오류 코드를 전하세요. 원인: {reason}",
        fix: "제공자가 쉘이 아는 형식으로 응답하는지 확인하세요"
    }
    CONV_HTTP_REQUEST_FAILED(host) {
        class: Server,
        place: "대화 제공자 요청 전송",
        cause: "제공자에 요청을 보내지 못했다",
        message: "대화 제공자 {host}: 요청을 보내지 못했습니다. 네트워크와 제공자 주소를 확인하세요.",
        fix: "네트워크와 제공자 주소를 확인하세요"
    }
    CONV_HTTP_STATUS_LOGIN_REQUIRED(provider, reason) {
        class: LoginRequired,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 로그인을 요구하는 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}: 로그인이 필요합니다. 제공자에 로그인한 뒤 다시 시도하세요. 원인: {reason}",
        fix: "대화 제공자에 로그인하세요"
    }
    CONV_HTTP_STATUS_FORBIDDEN(provider, reason) {
        class: PermissionDenied,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 권한 거부 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}: 이 요청을 허용하지 않았습니다. 제공자 계정이 이 기능을 쓸 수 있는지 확인하세요. 원인: {reason}",
        fix: "제공자 계정이 이 기능을 쓸 수 있는지 확인하세요"
    }
    CONV_HTTP_STATUS_NOT_FOUND(provider, reason) {
        class: NotFound,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 대상을 찾지 못하는 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}: 요청한 대상을 찾지 못했습니다. 대화나 모델을 다시 고르세요. 원인: {reason}",
        fix: "대화나 모델을 다시 고르세요"
    }
    CONV_HTTP_STATUS_CONFLICT(provider, reason) {
        class: Conflict,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 충돌 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}: 현재 상태에서 요청을 받지 않았습니다. 잠시 뒤 다시 시도하세요. 원인: {reason}",
        fix: "잠시 뒤 다시 시도하세요"
    }
    CONV_HTTP_STATUS_INVALID_REQUEST(provider, reason) {
        class: InvalidRequest,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 요청 거부 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}: 요청 내용을 받지 않았습니다. 대화 설정과 첨부를 확인하세요. 원인: {reason}",
        fix: "대화 설정과 첨부를 확인하세요"
    }
    CONV_HTTP_STATUS_SERVER(provider, reason) {
        class: Server,
        place: "대화 제공자 응답 확인",
        cause: "제공자가 요청을 처리하지 못하는 HTTP 상태를 반환했다",
        message: "대화 제공자 {provider}: 지금 요청을 받을 수 없습니다. 잠시 뒤 다시 시도하세요. 원인: {reason}",
        fix: "잠시 뒤 다시 시도하세요"
    }
    CONV_HTTP_ATTACHMENT_TOO_LARGE(limit) {
        class: InvalidRequest,
        place: "대화 첨부 받기",
        cause: "제공자 첨부가 허용 크기를 넘었다",
        message: "제공자 첨부가 허용 크기 {limit}보다 커서 받지 못했습니다. 더 작은 첨부를 열어 보세요.",
        fix: "더 작은 첨부를 선택하세요"
    }
    CONV_HTTP_LOGIN_INFO_MISSING(provider) {
        class: LoginRequired,
        place: "대화 제공자 로그인 확인",
        cause: "기기 로그인 정보가 없다",
        message: "대화 제공자 {provider}: 기기 로그인이 필요합니다. 제공자에 로그인하세요.",
        fix: "대화 제공자에 로그인하세요"
    }
    CONV_HTTP_LOGIN_REFRESH_FAILED(provider) {
        class: LoginRequired,
        place: "대화 제공자 로그인 갱신",
        cause: "기존 기기 자격으로 로그인이 만료됐고 새 자격을 얻지 못했다",
        message: "대화 제공자 {provider}: 로그인 자격을 갱신하지 못했습니다. 제공자에 다시 로그인하세요.",
        fix: "대화 제공자에 다시 로그인하세요"
    }
    CONV_HTTP_LOGIN_REFRESH_REJECTED(provider) {
        class: LoginRequired,
        place: "갱신된 대화 제공자 로그인 확인",
        cause: "제공자가 갱신된 로그인 자격도 거부했다",
        message: "대화 제공자 {provider}: 갱신한 로그인 자격이 거부됐습니다. 제공자에 다시 로그인하세요.",
        fix: "대화 제공자에 로그인하세요"
    }
    CONV_CONVERSATION_REQUEST_INVALID() {
        class: InvalidRequest,
        place: "대화 명령 확인",
        cause: "대화 모듈에서 처리할 수 없는 명령이다",
        message: "대화 명령이 쉘 안에서 잘못 전달됐습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
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
        message: "작업 이름 {workspace}: 연결된 대화가 없습니다. 다시 시도를 누르거나 새 대화를 시작하세요.",
        fix: "다시 시도를 누르거나 새 대화를 시작하세요"
    }
    CONV_CONVERSATION_ATTACHMENT_THREAD_NOT_FOUND(workspace) {
        class: NotFound,
        place: "대화 첨부 열기",
        cause: "첨부가 속한 대화를 찾지 못했다",
        message: "작업 이름 {workspace}: 첨부가 속한 대화를 찾지 못했습니다. 이 창을 닫고 앱을 다시 여세요.",
        fix: "이 창을 닫고 앱을 다시 여세요"
    }
    CONV_CONVERSATION_ATTACHMENT_WRITE_FAILED(name) {
        class: Io,
        place: "대화 첨부 저장",
        cause: "내려받은 첨부를 기기에 저장하지 못했다",
        message: "대화 첨부 {name}: 이 기기에 저장하지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    CONV_CONVERSATION_ATTACHMENT_OPEN_FAILED(name) {
        class: Io,
        place: "대화 첨부 열기",
        cause: "기본 앱으로 첨부를 열지 못했다",
        message: "대화 첨부 {name}: 열지 못했습니다. 파일을 저장한 뒤 직접 열어 보세요.",
        fix: "파일을 저장한 뒤 직접 여세요"
    }
    CONV_CONVERSATION_FEATURE_UNAVAILABLE() {
        class: Unavailable,
        place: "대화 기능 실행",
        cause: "현재 실행 환경에서 요청 기능을 제공하지 않는다",
        message: "이 쉘에서는 이 대화 기능을 사용할 수 없습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    CONV_CONVERSATION_MODELS_MISSING() {
        class: NotFound,
        place: "대화 모델 목록 불러오기",
        cause: "제공자가 모델 목록을 반환하지 않았다",
        message: "대화 제공자가 모델 목록을 보내지 않았습니다. 다시 시도를 누르고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "제공자 연결과 프로필 설정을 확인하세요"
    }
    CONV_CONVERSATION_PROFILES_MISSING() {
        class: NotFound,
        place: "대화 프로필 목록 불러오기",
        cause: "제공자가 프로필 목록을 반환하지 않았다",
        message: "대화 제공자가 프로필 목록을 보내지 않았습니다. 다시 시도를 누르고, 계속되면 에이전트에게 이 오류 코드를 전하세요.",
        fix: "제공자 연결과 프로필 설정을 확인하세요"
    }
    CONV_CONVERSATION_HISTORY_NOT_FOUND() {
        class: NotFound,
        place: "대화 기록 불러오기",
        cause: "제공자가 대화 기록을 반환하지 않았다",
        message: "대화 기록을 찾을 수 없습니다. 다시 시도를 누르세요.",
        fix: "다시 시도를 누르세요"
    }
    CONV_STREAM_LOGIN_REQUIRED(name) {
        class: LoginRequired,
        place: "대화 스트림 연결",
        cause: "제공자 연결에 다시 로그인이 필요하다",
        message: "대화 제공자 연결 {name}: 로그인이 필요합니다. 로그인한 뒤 대화를 다시 여세요.",
        fix: "제공자 연결에 로그인하세요"
    }
    CONV_STREAM_PERMISSION_DENIED(name) {
        class: PermissionDenied,
        place: "대화 스트림 연결",
        cause: "제공자가 대화 이벤트 읽기를 거부했다",
        message: "대화 제공자 연결 {name}: 제공자가 대화 이벤트 읽기를 거부했습니다. 에이전트에게 이 오류 코드를 전하세요.",
        fix: "제공자 계정과 연결 설정을 확인하세요"
    }
}
