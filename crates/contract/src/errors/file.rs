error_catalog! { ENTRIES;
    FILE_ACCESS_PERMISSION_UNDECLARED(permission) {
        class: PermissionDenied,
        place: "파일 접근 권한 검사",
        cause: "앱 정의에 파일 권한이 선언되지 않았다",
        message: "파일 권한 {permission}이 앱 정의에 없습니다. 앱 정의에 권한을 선언한 뒤 다시 시도하세요.",
        fix: "앱 정의의 files 권한 목록을 확인하세요"
    }
    FILE_WRITE_READ_ONLY_PERMISSION(permission) {
        class: PermissionDenied,
        place: "파일 쓰기 권한 검사",
        cause: "요청한 파일 권한의 접근 수준이 읽기 전용이다",
        message: "파일 권한 {permission}은 읽기 전용이라 쓸 수 없습니다. 앱 정의에서 읽기 쓰기 권한을 선언하세요.",
        fix: "앱 정의에서 해당 권한의 access를 readwrite로 바꾸세요"
    }
    FILE_ACCESS_FOLDER_NOT_CHOSEN(permission) {
        class: NotGranted,
        place: "기기 폴더 접근 검사",
        cause: "이 앱 창에서 파일 권한의 폴더를 고르지 않았다",
        message: "파일 권한 {permission}의 폴더를 이 기기에서 고르지 않았습니다. 앱에서 폴더를 선택하세요.",
        fix: "앱의 폴더 선택 단추를 눌러 접근할 폴더를 고르세요"
    }
}
