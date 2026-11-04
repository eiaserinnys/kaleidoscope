error_catalog! { ENTRIES;
    REGISTRYINSTALL_EXPECTED_VERSION_CONFLICT(app_id) {
        class: Conflict, place: "설치·삭제 판 확인", cause: "앱의 현재 판이 요청한 판과 다르다",
        message: "앱 {app_id}의 현재 판이 바뀌어 처리하지 못했습니다. 앱 목록을 새로 고친 뒤 다시 시도하세요.", fix: "앱 목록을 새로 고치세요"
    }
    REGISTRYINSTALL_ORIGIN_CONFLICT(app_id) {
        class: Conflict, place: "설치 출처 확인", cause: "같은 ID의 앱이 개인 앱이거나 출처가 다르다",
        message: "앱 {app_id}의 ID를 다른 앱이 사용하고 있어 설치하지 못했습니다. 기존 앱과 설치 출처를 확인하세요.", fix: "기존 앱과 출처를 확인하세요"
    }
    REGISTRYINSTALL_LOCAL_MODIFIED(app_id) {
        class: Conflict, place: "설치 수정 확인", cause: "설치한 앱이 이후 수정되었다",
        message: "앱 {app_id}이 설치 후 수정되어 업데이트를 보류했습니다. 수정한 내용을 확인하세요.", fix: "수정한 내용을 확인하세요"
    }
    REGISTRYINSTALL_RELEASE_DIGEST_CONFLICT(app_id) {
        class: Conflict, place: "설치 배포판 확인", cause: "같은 배포판의 매니페스트가 다르다",
        message: "앱 {app_id}의 같은 배포판 내용이 달라 설치하지 못했습니다. 스토어 게시자에게 확인하세요.", fix: "스토어 게시자에게 확인하세요"
    }
    REGISTRYINSTALL_RELEASE_DOWNGRADE(app_id) {
        class: Conflict, place: "설치 배포판 순서 확인", cause: "기존 배포판보다 낮다",
        message: "앱 {app_id}의 이전 배포판은 설치할 수 없습니다. 현재 판 이상의 배포판을 선택하세요.", fix: "현재 판 이상을 선택하세요"
    }
    REGISTRYINSTALL_MANIFEST_DIGEST_MISMATCH(app_id) {
        class: InvalidRequest, place: "설치 매니페스트 해시 검사", cause: "허용한 해시와 매니페스트 바이트가 다르다",
        message: "앱 {app_id}의 매니페스트가 허용한 내용과 달라 설치하지 못했습니다. 스토어에서 다시 받아 확인하세요.", fix: "스토어에서 다시 받으세요"
    }
    REGISTRYINSTALL_MANIFEST_ENCODING_INVALID(app_id) {
        class: InvalidRequest, place: "설치 매니페스트 디코딩", cause: "매니페스트의 base64 인코딩이 올바르지 않다",
        message: "앱 {app_id}의 매니페스트 인코딩을 읽을 수 없습니다. 스토어에서 다시 받아 설치하세요.", fix: "스토어에서 다시 받으세요"
    }
    REGISTRYINSTALL_MANIFEST_TOO_LARGE(app_id) {
        class: InvalidRequest, place: "설치 매니페스트 크기 제한", cause: "매니페스트가 1 MiB를 넘었다",
        message: "앱 {app_id}의 매니페스트가 1 MiB를 넘어 설치하지 못했습니다. 스토어 게시자에게 크기를 줄여 달라고 요청하세요.", fix: "게시자가 매니페스트 크기를 줄여야 합니다"
    }
    REGISTRYINSTALL_MANIFEST_FORMAT_UNSUPPORTED(app_id) {
        class: InvalidRequest, place: "설치 매니페스트 판 검사", cause: "지원하지 않는 매니페스트 형식이다",
        message: "앱 {app_id}의 매니페스트 형식을 지원하지 않아 설치하지 못했습니다. 쉘을 업데이트하세요.", fix: "쉘을 업데이트하세요"
    }
    REGISTRYINSTALL_APP_JSON_INVALID(app_id) {
        class: InvalidRequest, place: "설치 앱 정의 읽기", cause: "앱 정의가 JSON이 아니다",
        message: "앱 {app_id}의 정의를 JSON으로 읽을 수 없습니다. 스토어 게시자에게 확인하세요.", fix: "스토어 게시자에게 확인하세요"
    }
    REGISTRYINSTALL_APP_TOO_LARGE(app_id) {
        class: InvalidRequest, place: "설치 앱 정의 크기 제한", cause: "앱 정의가 1 MiB를 넘었다",
        message: "앱 {app_id}의 정의가 1 MiB를 넘어 설치하지 못했습니다. 스토어 게시자에게 크기를 줄여 달라고 요청하세요.", fix: "게시자가 앱 정의 크기를 줄여야 합니다"
    }
    REGISTRYINSTALL_APP_SIZE_MISMATCH(app_id) {
        class: InvalidRequest, place: "설치 앱 정의 크기 검사", cause: "앱 정의 크기가 매니페스트와 다르다",
        message: "앱 {app_id}의 정의 크기가 매니페스트와 달라 설치하지 못했습니다. 스토어에서 다시 받으세요.", fix: "스토어에서 다시 받으세요"
    }
    REGISTRYINSTALL_APP_DIGEST_MISMATCH(app_id) {
        class: InvalidRequest, place: "설치 앱 정의 해시 검사", cause: "앱 정의의 해시가 매니페스트와 다르다",
        message: "앱 {app_id}의 정의 내용이 매니페스트와 달라 설치하지 못했습니다. 스토어에서 다시 받으세요.", fix: "스토어에서 다시 받으세요"
    }
    REGISTRYINSTALL_ASSET_ENCODING_INVALID(app_id, asset) {
        class: InvalidRequest, place: "설치 자산 디코딩", cause: "자산의 base64 인코딩이 올바르지 않다",
        message: "앱 {app_id}의 자산 {asset} 인코딩을 읽을 수 없습니다. 스토어에서 다시 받아 설치하세요.", fix: "스토어에서 다시 받으세요"
    }
    REGISTRYINSTALL_ASSETS_TOO_LARGE(app_id) {
        class: InvalidRequest, place: "설치 자산 크기 제한", cause: "자산 크기 합계가 10 MiB를 넘었다",
        message: "앱 {app_id}의 자산 합계가 10 MiB를 넘어 설치하지 못했습니다. 스토어 게시자에게 크기를 줄여 달라고 요청하세요.", fix: "게시자가 자산 크기를 줄여야 합니다"
    }
    REGISTRYINSTALL_ASSET_SIZE_MISMATCH(app_id, asset) {
        class: InvalidRequest, place: "설치 자산 크기 검사", cause: "자산 크기가 매니페스트와 다르다",
        message: "앱 {app_id}의 자산 {asset} 크기가 매니페스트와 달라 설치하지 못했습니다. 스토어에서 다시 받으세요.", fix: "스토어에서 다시 받으세요"
    }
    REGISTRYINSTALL_ASSET_DIGEST_MISMATCH(app_id, asset) {
        class: InvalidRequest, place: "설치 자산 해시 검사", cause: "자산의 해시가 매니페스트와 다르다",
        message: "앱 {app_id}의 자산 {asset} 내용이 매니페스트와 달라 설치하지 못했습니다. 스토어에서 다시 받으세요.", fix: "스토어에서 다시 받으세요"
    }
    REGISTRYINSTALL_DECLARATION_MISMATCH(app_id) {
        class: InvalidRequest, place: "설치 선언 검사", cause: "매니페스트와 앱 정의 또는 자산 선언이 다르다",
        message: "앱 {app_id}의 매니페스트와 앱 선언이 달라 설치하지 못했습니다. 스토어 게시자에게 확인하세요.", fix: "스토어 게시자에게 확인하세요"
    }
    REGISTRYINSTALL_MANIFEST_INVALID(app_id) {
        class: InvalidRequest, place: "설치 매니페스트 읽기", cause: "매니페스트 JSON 형식이 올바르지 않다",
        message: "앱 {app_id}의 매니페스트를 읽을 수 없어 설치하지 못했습니다. 스토어 게시자에게 확인하세요.", fix: "스토어 게시자에게 확인하세요"
    }
    REGISTRYINSTALL_NOT_STORE_APP(app_id) {
        class: InvalidRequest, place: "기기 앱 삭제", cause: "스토어에서 설치한 앱이 아니다",
        message: "앱 {app_id}은 스토어에서 설치한 앱이 아니어서 이곳에서 삭제할 수 없습니다. 앱의 원래 관리 방법으로 삭제하세요.", fix: "앱의 원래 관리 방법을 사용하세요"
    }
    REGISTRYINSTALL_DATABASE_FAILED(app_id) {
        class: Server, place: "설치 출처 저장", cause: "설치 정보 데이터베이스를 읽거나 쓰지 못했다",
        message: "앱 {app_id}의 설치 정보를 저장하거나 읽지 못했습니다. 잠시 뒤 다시 시도하세요.", fix: "잠시 뒤 다시 시도하세요"
    }
}
