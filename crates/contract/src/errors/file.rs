error_catalog! { ENTRIES;
    FILE_CLIENT_OPEN_VERSION_LOW(version) { class: PermissionDenied, place: "권한 파일 열기 client 판 검사", cause: "앱이 파일 열기를 지원하는 client 판을 선언하지 않았다", message: "이 앱은 권한 파일 열기를 지원하지 않는 client 판을 선언했습니다. 앱 정의의 requires.modules.client를 {version} 이상으로 고치세요.", fix: "앱 정의의 client 모듈 판을 올리세요" }
    FILE_ACCESS_PERMISSION_UNDECLARED(permission) {
        class: PermissionDenied,
        place: "파일 접근 권한 검사",
        cause: "앱 정의에 파일 권한이 선언되지 않았다",
        message: "파일 권한 {permission}: 앱 정의 permissions에 선언되지 않았습니다. 앱 정의 permissions에 추가하세요.",
        fix: "앱 정의 permissions에 files 권한을 선언하세요"
    }
    FILE_WRITE_READ_ONLY_PERMISSION(permission) {
        class: PermissionDenied,
        place: "파일 쓰기 권한 검사",
        cause: "요청한 파일 권한의 접근 수준이 읽기 전용이다",
        message: "파일 권한 {permission}: 쓰기 접근이 선언되지 않았습니다. 앱 정의 permissions에서 access를 readwrite로 바꾸세요.",
        fix: "앱 정의에서 해당 권한의 access를 readwrite로 바꾸세요"
    }
    FILE_ACCESS_FOLDER_NOT_CHOSEN(permission) {
        class: NotGranted,
        place: "기기 폴더 접근 검사",
        cause: "이 앱 창에서 파일 권한의 폴더를 고르지 않았다",
        message: "파일 권한 {permission}: 아직 폴더를 고르지 않았습니다. 폴더 선택을 누르세요.",
        fix: "폴더 선택을 누르세요"
    }
    FILE_ACCESS_PC_SCOPE_FOLDER_REQUIRED(permission) {
        class: NotGranted,
        place: "기기 폴더 접근 검사",
        cause: "PC 범위 파일 권한에는 선택한 폴더가 없다",
        message: "파일 권한 {permission}: PC 범위에는 선택한 폴더가 없어 이 파일 동작을 사용할 수 없습니다. 앱 정의에서 폴더 범위 권한을 사용하세요.",
        fix: "앱 정의에서 폴더 범위 파일 권한을 사용하세요"
    }
    FILE_ACCESS_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "파일 권한 검사",
        cause: "파일 권한을 확인할 창이 없다",
        message: "파일을 다룰 앱 창이 더 이상 없습니다. 앱 열기에서 앱을 다시 여세요.",
        fix: "앱 열기에서 앱을 다시 여세요"
    }
    FILE_ACCESS_APP_VERSION_NOT_FOUND() {
        class: NotFound,
        place: "파일 권한 검사",
        cause: "창이 사용하는 앱 버전이 없다",
        message: "이 창의 앱 정의가 이 쉘에 없어 파일 권한을 확인하지 못했습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    FILE_ACCESS_PERMISSION_NOT_FILES(permission) {
        class: PermissionDenied,
        place: "파일 권한 검사",
        cause: "요청한 권한이 파일 권한이 아니다",
        message: "앱 정의 permissions의 {permission} 항목이 files 모듈이 아닙니다. 이 항목의 모듈을 files로 바꾸세요.",
        fix: "앱 정의 permissions에서 {permission}의 모듈을 files로 바꾸세요"
    }
    FILE_ACCESS_ROOT_NOT_FOUND(path) {
        class: NotFound,
        place: "선택한 폴더 검사",
        cause: "선택한 폴더 경로가 사라졌다",
        message: "선택한 폴더를 찾을 수 없습니다. 옮겨졌거나 지워졌으면 폴더를 다시 고르거나 앱을 다시 여세요. 폴더: {path}",
        fix: "폴더를 다시 고르거나 앱을 다시 여세요"
    }
    FILE_ACCESS_ROOT_CHANGED(path) {
        class: PathOutsideRoot,
        place: "선택한 폴더 검사",
        cause: "선택한 경로가 다른 위치를 가리키거나 폴더가 아니다",
        message: "선택한 폴더의 경로가 더 이상 그 폴더를 가리키지 않습니다. 폴더를 다시 고르거나 앱을 다시 여세요. 폴더: {path}",
        fix: "폴더를 다시 고르거나 앱을 다시 여세요"
    }
    FILE_LIST_DIRECTORY_IO(path) {
        class: Io,
        place: "폴더 내용 읽기",
        cause: "폴더를 읽지 못했다",
        message: "폴더 {path}: 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 폴더가 열리는지 확인하세요"
    }
    FILE_LIST_DIRECTORY_NOT_FOUND(path) {
        class: NotFound,
        place: "폴더 내용 읽기",
        cause: "읽으려는 폴더가 사라졌다",
        message: "폴더 {path}: 찾을 수 없습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_LIST_ENTRY_IO(path) {
        class: Io,
        place: "폴더 항목 정보 읽기",
        cause: "항목 정보를 읽지 못했다",
        message: "폴더 {path}: 안의 항목 정보를 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 폴더가 열리는지 확인하세요"
    }
    FILE_LIST_ENTRY_NOT_FOUND(path) {
        class: NotFound,
        place: "폴더 항목 정보 읽기",
        cause: "항목을 읽는 중 사라졌다",
        message: "폴더 {path}: 읽는 동안 항목이 사라졌습니다. 다시 시도하세요.",
        fix: "다시 시도하세요"
    }
    FILE_LIST_NAME_NOT_TEXT(path) {
        class: Io,
        place: "폴더 항목 이름 읽기",
        cause: "항목 이름이 UTF-8 문자열이 아니다",
        message: "폴더 {path}: 안에 이름을 읽을 수 없는 항목이 있습니다. 파일 관리자에서 그 항목의 이름을 바꾸세요.",
        fix: "파일 관리자에서 항목 이름을 바꾸세요"
    }
    FILE_READ_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 읽기",
        cause: "읽으려는 파일이 없다",
        message: "파일 {path}: 찾을 수 없습니다. 파일 관리자에서 파일이 있는지 확인하세요.",
        fix: "파일 관리자에서 파일이 있는지 확인하세요"
    }
    FILE_READ_IO(path) {
        class: Io,
        place: "파일 읽기",
        cause: "파일을 읽지 못했다",
        message: "파일 {path}: 읽지 못했습니다. 파일 관리자에서 파일이 열리는지 확인하세요.",
        fix: "파일 관리자에서 파일이 열리는지 확인하세요"
    }
    FILE_READ_TOO_LARGE(path, limit) {
        class: Io,
        place: "파일 크기 검사",
        cause: "파일이 읽기 한도보다 크다",
        message: "파일 {path}: 허용 크기 {limit}보다 커서 읽을 수 없습니다. 더 작은 파일을 선택하세요.",
        fix: "{limit} 이하의 파일을 선택하세요"
    }
    FILE_READ_NOT_TEXT(path) {
        class: Io,
        place: "텍스트 파일 읽기",
        cause: "파일 내용이 UTF-8 텍스트가 아니다",
        message: "파일 {path}: UTF-8 텍스트가 아닙니다. UTF-8 텍스트 파일을 선택하세요.",
        fix: "UTF-8 텍스트 파일을 선택하세요"
    }
    FILE_PATH_OUTSIDE_ROOT(path) {
        class: PathOutsideRoot,
        place: "파일 경로 검사",
        cause: "경로가 선택한 폴더 밖을 가리킨다",
        message: "경로 {path}: 선택한 폴더 밖을 가리킵니다. 선택한 폴더 안의 경로를 사용하세요.",
        fix: "선택한 폴더 안의 경로를 사용하세요"
    }
    FILE_PATH_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 경로 검사",
        cause: "경로의 파일이나 상위 폴더가 없다",
        message: "경로 {path}: 파일이나 상위 폴더를 찾을 수 없습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_PATH_IO(path) {
        class: Io,
        place: "파일 경로 검사",
        cause: "경로 정보를 확인하지 못했다",
        message: "경로 {path}: 위치 정보를 확인하지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 경로가 열리는지 확인하세요"
    }
    FILE_PATH_PROTECTED(path) {
        class: PermissionDenied,
        place: "파일 저장 위치 검사",
        cause: "경로가 kaleidoscope 내부 데이터 폴더를 가리킨다",
        message: "경로 {path}: 쉘 내부 데이터 폴더라 접근할 수 없습니다. 다른 폴더를 선택하세요.",
        fix: "쉘 내부 데이터 폴더 밖을 선택하세요"
    }
    FILE_SAVE_WRITE_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 저장 내용 기록",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 저장할 파일이 사라져 내용을 기록하지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_SAVE_WRITE_BUSY(path) {
        class: FileBusy,
        place: "파일 저장 내용 기록",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 새 내용을 저장하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_SAVE_WRITE_IO(path) {
        class: Io,
        place: "파일 저장 내용 기록",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 새 내용을 저장하지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    FILE_CREATE_FILE_OPEN_NOT_FOUND(path) {
        class: NotFound,
        place: "새 파일 열기",
        cause: "새 파일을 만들 상위 폴더가 사라졌다",
        message: "파일 {path}: 새 파일을 만들 폴더를 찾지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_CREATE_FILE_OPEN_BUSY(path) {
        class: FileBusy,
        place: "새 파일 열기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 새 파일을 열지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_CREATE_FILE_OPEN_IO(path) {
        class: Io,
        place: "새 파일 열기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 새 파일을 열지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    FILE_CREATE_FILE_CONTENT_WRITE_NOT_FOUND(path) {
        class: NotFound,
        place: "새 파일 내용 기록",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 파일이 사라져 내용을 기록하지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_CREATE_FILE_CONTENT_WRITE_BUSY(path) {
        class: FileBusy,
        place: "새 파일 내용 기록",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 내용을 기록하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_CREATE_FILE_CONTENT_WRITE_IO(path) {
        class: Io,
        place: "새 파일 내용 기록",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 내용을 기록하지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    FILE_CREATE_FOLDER_PARENT_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "새 폴더 상위 위치 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "상위 폴더 {path}: 사라져 새 폴더를 만들 수 없습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_CREATE_FOLDER_PARENT_METADATA_BUSY(path) {
        class: FileBusy,
        place: "새 폴더 상위 위치 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "상위 폴더 {path}: 다른 프로그램이 사용 중이라 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_CREATE_FOLDER_PARENT_METADATA_IO(path) {
        class: Io,
        place: "새 폴더 상위 위치 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "상위 폴더 {path}: 정보를 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_CREATE_FOLDER_CREATE_NOT_FOUND(path) {
        class: NotFound,
        place: "새 폴더 만들기",
        cause: "작업 중 대상이 사라졌다",
        message: "폴더 {path}: 상위 위치가 사라져 폴더를 만들지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_CREATE_FOLDER_CREATE_BUSY(path) {
        class: FileBusy,
        place: "새 폴더 만들기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "폴더 {path}: 다른 프로그램이 사용 중이라 폴더를 만들지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_CREATE_FOLDER_CREATE_IO(path) {
        class: Io,
        place: "새 폴더 만들기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "폴더 {path}: 만들지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    FILE_RENAME_APPLY_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 이름 바꾸기",
        cause: "작업 중 대상이 사라졌다",
        message: "항목 {path}: 이름을 바꾸기 전에 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_RENAME_APPLY_BUSY(path) {
        class: FileBusy,
        place: "파일 이름 바꾸기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "항목 {path}: 다른 프로그램이 사용 중이라 이름을 바꾸지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_RENAME_APPLY_IO(path) {
        class: Io,
        place: "파일 이름 바꾸기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "항목 {path}: 이름을 바꾸지 못했습니다. 이 항목이 읽기 전용이 아닌지 확인하세요.",
        fix: "이 항목이 읽기 전용이 아닌지 확인하세요"
    }
    FILE_MOVE_SOURCE_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 옮기기 원본 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "항목 {path}: 옮기기 전에 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_MOVE_SOURCE_METADATA_BUSY(path) {
        class: FileBusy,
        place: "파일 옮기기 원본 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "항목 {path}: 다른 프로그램이 사용 중이라 종류를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_MOVE_SOURCE_METADATA_IO(path) {
        class: Io,
        place: "파일 옮기기 원본 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "항목 {path}: 종류를 확인하지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_MOVE_APPLY_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 옮기기",
        cause: "작업 중 대상이 사라졌다",
        message: "항목 {path}: 옮길 항목이나 대상 폴더가 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_MOVE_APPLY_BUSY(path) {
        class: FileBusy,
        place: "파일 옮기기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "항목 {path}: 다른 프로그램이 사용 중이라 옮기지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_MOVE_APPLY_IO(path) {
        class: Io,
        place: "파일 옮기기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "항목 {path}: 옮기지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    FILE_COPY_SOURCE_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 복사 원본 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "항목 {path}: 복사하기 전에 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_SOURCE_METADATA_BUSY(path) {
        class: FileBusy,
        place: "파일 복사 원본 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "항목 {path}: 다른 프로그램이 사용 중이라 종류를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_SOURCE_METADATA_IO(path) {
        class: Io,
        place: "파일 복사 원본 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "항목 {path}: 종류를 확인하지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_REMOVE_PERMANENT_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 영구 삭제",
        cause: "작업 중 대상이 사라졌다",
        message: "항목 {path}: 이미 없습니다. 추가 조치는 필요하지 않습니다.",
        fix: "추가 조치는 필요하지 않습니다"
    }
    FILE_REMOVE_PERMANENT_BUSY(path) {
        class: FileBusy,
        place: "파일 영구 삭제",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "항목 {path}: 다른 프로그램이 사용 중이라 삭제하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_REMOVE_PERMANENT_IO(path) {
        class: Io,
        place: "파일 영구 삭제",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "항목 {path}: 삭제하지 못했습니다. 이 항목이 읽기 전용이 아닌지 확인하세요.",
        fix: "이 항목이 읽기 전용이 아닌지 확인하세요"
    }
    FILE_DESTINATION_FOLDER_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 작업 대상 폴더 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "대상 폴더 {path}: 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_DESTINATION_FOLDER_METADATA_BUSY(path) {
        class: FileBusy,
        place: "파일 작업 대상 폴더 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "대상 폴더 {path}: 다른 프로그램이 사용 중이라 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_DESTINATION_FOLDER_METADATA_IO(path) {
        class: Io,
        place: "파일 작업 대상 폴더 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "대상 폴더 {path}: 정보를 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_DATA_PATH_CHECK_NOT_FOUND(path) {
        class: NotFound,
        place: "쉘 데이터 폴더 보호 검사",
        cause: "작업 중 대상이 사라졌다",
        message: "쉘 데이터 폴더 {path}: 찾을 수 없어 파일 작업을 멈췄습니다. 쉘을 다시 시작하세요.",
        fix: "쉘을 다시 시작하세요"
    }
    FILE_DATA_PATH_CHECK_BUSY(path) {
        class: FileBusy,
        place: "쉘 데이터 폴더 보호 검사",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "쉘 데이터 폴더 {path}: 다른 프로그램이 사용 중이라 파일 작업을 멈췄습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_DATA_PATH_CHECK_IO(path) {
        class: Io,
        place: "쉘 데이터 폴더 보호 검사",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "쉘 데이터 폴더 {path}: 정보를 읽지 못해 파일 작업을 멈췄습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_COPY_ENTRY_SOURCE_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "복사할 항목 종류 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "항목 {path}: 복사할 항목이 사라져 종류를 확인하지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_ENTRY_SOURCE_METADATA_BUSY(path) {
        class: FileBusy,
        place: "복사할 항목 종류 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "항목 {path}: 다른 프로그램이 사용 중이라 항목 종류를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_ENTRY_SOURCE_METADATA_IO(path) {
        class: Io,
        place: "복사할 항목 종류 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "항목 {path}: 종류를 확인하지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_COPY_ENTRY_CREATE_FOLDER_NOT_FOUND(path) {
        class: NotFound,
        place: "복사 대상 폴더 만들기",
        cause: "작업 중 대상이 사라졌다",
        message: "대상 폴더 {path}: 복사 대상 위치가 사라져 폴더를 만들지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_ENTRY_CREATE_FOLDER_BUSY(path) {
        class: FileBusy,
        place: "복사 대상 폴더 만들기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "대상 폴더 {path}: 다른 프로그램이 사용 중이라 폴더를 만들지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_ENTRY_CREATE_FOLDER_IO(path) {
        class: Io,
        place: "복사 대상 폴더 만들기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "대상 폴더 {path}: 만들지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    FILE_COPY_ENTRY_READ_FOLDER_NOT_FOUND(path) {
        class: NotFound,
        place: "복사할 폴더 읽기",
        cause: "작업 중 대상이 사라졌다",
        message: "폴더 {path}: 복사할 폴더가 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_ENTRY_READ_FOLDER_BUSY(path) {
        class: FileBusy,
        place: "복사할 폴더 읽기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "폴더 {path}: 다른 프로그램이 사용 중이라 폴더를 읽지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_ENTRY_READ_FOLDER_IO(path) {
        class: Io,
        place: "복사할 폴더 읽기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "폴더 {path}: 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_COPY_ENTRY_READ_ITEM_NOT_FOUND(path) {
        class: NotFound,
        place: "복사할 폴더 항목 읽기",
        cause: "작업 중 대상이 사라졌다",
        message: "폴더 {path}: 폴더를 읽는 동안 항목이 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_ENTRY_READ_ITEM_BUSY(path) {
        class: FileBusy,
        place: "복사할 폴더 항목 읽기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "폴더 {path}: 다른 프로그램이 사용 중이라 항목을 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_ENTRY_READ_ITEM_IO(path) {
        class: Io,
        place: "복사할 폴더 항목 읽기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "폴더 {path}: 항목 정보를 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_COPY_ENTRY_OPEN_FILE_NOT_FOUND(path) {
        class: NotFound,
        place: "복사 원본 파일 열기",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 복사할 원본 파일이 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_ENTRY_OPEN_FILE_BUSY(path) {
        class: FileBusy,
        place: "복사 원본 파일 열기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 원본 파일을 열지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_ENTRY_OPEN_FILE_IO(path) {
        class: Io,
        place: "복사 원본 파일 열기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 원본 파일을 열지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_COPY_ENTRY_CREATE_FILE_NOT_FOUND(path) {
        class: NotFound,
        place: "복사 대상 파일 만들기",
        cause: "작업 중 대상이 사라졌다",
        message: "대상 파일 {path}: 복사 대상 폴더가 사라져 파일을 만들지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_ENTRY_CREATE_FILE_BUSY(path) {
        class: FileBusy,
        place: "복사 대상 파일 만들기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "대상 파일 {path}: 다른 프로그램이 사용 중이라 대상 파일을 만들지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_ENTRY_CREATE_FILE_IO(path) {
        class: Io,
        place: "복사 대상 파일 만들기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "대상 파일 {path}: 만들지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    FILE_COPY_ENTRY_WRITE_FILE_NOT_FOUND(path) {
        class: NotFound,
        place: "복사 대상 파일 내용 기록",
        cause: "작업 중 대상이 사라졌다",
        message: "대상 파일 {path}: 복사 대상 파일이 사라져 내용을 기록하지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_ENTRY_WRITE_FILE_BUSY(path) {
        class: FileBusy,
        place: "복사 대상 파일 내용 기록",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "대상 파일 {path}: 다른 프로그램이 사용 중이라 내용을 기록하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_ENTRY_WRITE_FILE_IO(path) {
        class: Io,
        place: "복사 대상 파일 내용 기록",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "대상 파일 {path}: 복사한 내용을 기록하지 못했습니다. 디스크 공간과 읽기 전용 여부를 확인하세요.",
        fix: "디스크 공간과 읽기 전용 여부를 확인하세요"
    }
    FILE_COPY_NAME_SOURCE_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "복사본 이름 정하기 원본 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "항목 {path}: 복사하기 전에 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_NAME_SOURCE_METADATA_BUSY(path) {
        class: FileBusy,
        place: "복사본 이름 정하기 원본 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "항목 {path}: 다른 프로그램이 사용 중이라 원본 종류를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_NAME_SOURCE_METADATA_IO(path) {
        class: Io,
        place: "복사본 이름 정하기 원본 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "항목 {path}: 원본 종류를 확인하지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_REVEAL_OPEN_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 위치 열기",
        cause: "작업 중 대상이 사라졌다",
        message: "항목 {path}: 사라져 위치를 열지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_REVEAL_OPEN_BUSY(path) {
        class: FileBusy,
        place: "파일 위치 열기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "항목 {path}: 다른 프로그램이 사용 중이라 위치를 열지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_REVEAL_OPEN_IO(path) {
        class: Io,
        place: "파일 위치 열기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "항목 {path}: 위치를 열지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_LINK_CHECK_BUSY(path) {
        class: FileBusy,
        place: "파일 링크 검사",
        cause: "다른 프로그램이 경로 정보를 사용 중이다",
        message: "경로 {path}: 다른 프로그램이 사용 중이라 링크 여부를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_LINK_CHECK_IO(path) {
        class: Io,
        place: "파일 링크 검사",
        cause: "경로의 링크 여부를 확인하지 못했다",
        message: "경로 {path}: 링크 여부를 확인하지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_PATH_EXISTS_CHECK_BUSY(path) {
        class: FileBusy,
        place: "파일 경로 존재 확인",
        cause: "다른 프로그램이 경로 정보를 사용 중이다",
        message: "경로 {path}: 다른 프로그램이 사용 중이라 존재 여부를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_PATH_EXISTS_CHECK_IO(path) {
        class: Io,
        place: "파일 경로 존재 확인",
        cause: "경로의 존재 여부를 확인하지 못했다",
        message: "경로 {path}: 존재 여부를 확인하지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_PATH_BUSY(path) {
        class: FileBusy,
        place: "파일 경로 확인",
        cause: "다른 프로그램이 경로 정보를 사용 중이다",
        message: "경로 {path}: 다른 프로그램이 사용 중이라 위치를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_NAME_INVALID(reason) {
        class: InvalidName,
        place: "파일 이름 검사",
        cause: "파일 시스템에서 허용하지 않는 이름이다",
        message: "파일 이름을 사용할 수 없습니다. 다른 이름을 입력하세요. 원인: {reason}",
        fix: "파일 시스템에서 허용하는 이름을 입력하세요"
    }
    FILE_CREATE_FILE_NAME_TAKEN(name) {
        class: Conflict,
        place: "파일 만들기",
        cause: "대상 위치에 같은 이름의 항목이 있다",
        message: "파일 이름 {name}: 같은 이름의 항목이 있어 만들지 못했습니다. 다른 이름을 입력하세요.",
        fix: "다른 파일 이름을 사용하세요"
    }
    FILE_CREATE_FOLDER_NAME_TAKEN(name) {
        class: Conflict,
        place: "폴더 만들기",
        cause: "대상 위치에 같은 이름의 항목이 있다",
        message: "폴더 이름 {name}: 같은 이름의 항목이 있어 만들지 못했습니다. 다른 이름을 입력하세요.",
        fix: "다른 폴더 이름을 사용하세요"
    }
    FILE_CREATE_PARENT_NOT_FOLDER(path) {
        class: InvalidRequest,
        place: "폴더 만들기 위치 검사",
        cause: "폴더를 만들 위치가 폴더가 아니다",
        message: "위치 {path}: 폴더가 아니라 새 폴더를 만들 수 없습니다. 다른 폴더를 고르세요.",
        fix: "다른 폴더를 고르세요"
    }
    FILE_SAVE_FILE_DELETED(name) {
        class: Conflict,
        place: "파일 저장",
        cause: "읽은 뒤 파일이 삭제됐다",
        message: "파일 {name}: 처음 읽은 뒤 삭제되어 저장하지 못했습니다. 덮어쓰기를 누르면 내 내용으로 다시 만듭니다.",
        fix: "덮어쓰기를 누르세요"
    }
    FILE_SAVE_REVISION_CHANGED(name) {
        class: Conflict,
        place: "파일 저장",
        cause: "읽은 뒤 파일 내용이 바뀌었다",
        message: "파일 {name}: 처음 읽은 뒤 내용이 바뀌어 저장하지 못했습니다. 다시 불러오기로 새 내용을 받거나 덮어쓰기로 내 내용을 저장하세요.",
        fix: "다시 불러오기나 덮어쓰기를 누르세요"
    }
    FILE_SAVE_READ_BUSY(name) {
        class: FileBusy,
        place: "저장 전 파일 내용 확인",
        cause: "다른 프로그램이 저장할 파일을 사용 중이다",
        message: "파일 {name}: 다른 프로그램이 사용 중이라 저장 전에 내용을 확인하지 못했습니다. 파일을 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일을 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_SAVE_READ_IO(name) {
        class: Io,
        place: "저장 전 파일 내용 확인",
        cause: "저장할 파일을 읽지 못했다",
        message: "파일 {name}: 저장 전에 내용을 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요.",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_RENAME_ROOT_DENIED() {
        class: PermissionDenied,
        place: "파일 이름 바꾸기",
        cause: "선택한 폴더 자체의 이름을 바꾸려 했다",
        message: "선택한 폴더의 이름은 바꿀 수 없습니다. 폴더 안의 항목을 선택하세요.",
        fix: "폴더 안의 항목을 선택하세요"
    }
    FILE_RENAME_NAME_TAKEN(name) {
        class: Conflict,
        place: "파일 이름 바꾸기",
        cause: "대상 위치에 같은 이름의 항목이 있다",
        message: "새 이름 {name}: 같은 이름의 항목이 있어 바꾸지 못했습니다. 다른 이름을 입력하세요.",
        fix: "다른 이름을 사용하세요"
    }
    FILE_MOVE_ROOT_DENIED() {
        class: PermissionDenied,
        place: "파일 옮기기",
        cause: "선택한 폴더 자체를 옮기려 했다",
        message: "선택한 폴더 자체는 옮길 수 없습니다. 폴더 안의 항목을 선택하세요.",
        fix: "폴더 안의 항목을 선택하세요"
    }
    FILE_MOVE_INTO_SELF(path) {
        class: InvalidRequest,
        place: "파일 옮기기 경로 검사",
        cause: "폴더를 자기 안으로 옮기려 했다",
        message: "폴더 {path}: 자기 안으로 옮길 수 없습니다. 다른 대상 폴더를 선택하세요.",
        fix: "다른 대상 폴더를 선택하세요"
    }
    FILE_MOVE_NAME_TAKEN(path) {
        class: Conflict,
        place: "파일 옮기기",
        cause: "대상 폴더에 같은 이름의 항목이 있다",
        message: "대상 항목 {path}: 같은 이름이 있어 옮기지 못했습니다. 대상 이름을 바꾸거나 다른 폴더를 선택하세요.",
        fix: "이름을 바꾸거나 다른 대상 폴더를 선택하세요"
    }
    FILE_COPY_ROOT_DENIED() {
        class: PermissionDenied,
        place: "파일 복사",
        cause: "선택한 폴더 자체를 복사하려 했다",
        message: "선택한 폴더 자체는 복사할 수 없습니다. 폴더 안의 항목을 선택하세요.",
        fix: "폴더 안의 항목을 선택하세요"
    }
    FILE_COPY_INTO_SELF(path) {
        class: InvalidRequest,
        place: "파일 복사 경로 검사",
        cause: "폴더를 자기 안으로 복사하려 했다",
        message: "폴더 {path}: 자기 안으로 복사할 수 없습니다. 다른 대상 폴더를 선택하세요.",
        fix: "다른 대상 폴더를 선택하세요"
    }
    FILE_COPY_NAME_TAKEN(path) {
        class: Io,
        place: "파일 복사",
        cause: "복사 대상에 같은 이름의 항목이 생겼다",
        message: "복사 대상 {path}: 복사 중 같은 이름이 먼저 만들어져 복사하지 못했습니다. 다른 대상 폴더를 선택해 다시 복사하세요.",
        fix: "다른 대상 폴더를 선택하세요"
    }
    FILE_DESTINATION_NOT_FOLDER(path) {
        class: InvalidRequest,
        place: "파일 작업 대상 검사",
        cause: "대상 위치가 폴더가 아니다",
        message: "대상 {path}: 폴더가 아닙니다. 다른 폴더를 대상으로 다시 시도하세요.",
        fix: "다른 폴더를 대상으로 다시 시도하세요"
    }
    FILE_REMOVE_ROOT_DENIED() {
        class: PermissionDenied,
        place: "파일 지우기",
        cause: "선택한 폴더 자체를 지우려 했다",
        message: "선택한 폴더 자체는 지울 수 없습니다. 폴더 안의 항목을 선택하세요.",
        fix: "폴더 안의 항목을 선택하세요"
    }
    FILE_REMOVE_TRASH_UNAVAILABLE(path) {
        class: TrashUnavailable,
        place: "파일 휴지통 보내기",
        cause: "시스템 휴지통으로 보낼 수 없다",
        message: "항목 {path}: 휴지통으로 보내지 못했습니다. 지우려면 영구 삭제를 선택하세요.",
        fix: "영구 삭제를 선택하세요"
    }
    FILE_REMOVE_TRASH_BUSY(path) {
        class: FileBusy,
        place: "파일 휴지통 보내기",
        cause: "다른 프로그램이 파일을 사용 중이다",
        message: "항목 {path}: 다른 프로그램이 사용 중이라 휴지통으로 보내지 못했습니다. 파일을 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일을 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_OPEN_NOT_FILE(path) {
        class: InvalidRequest,
        place: "파일 열기 대상 검사",
        cause: "열려는 경로가 파일이 아니다",
        message: "경로 {path}: 파일이 아닙니다. 파일을 선택해 다시 여세요.",
        fix: "파일을 선택하세요"
    }
    FILE_OPEN_APP_NOT_FOUND(app_id) {
        class: NotFound,
        place: "파일 열기 앱 찾기",
        cause: "파일을 열 앱이 등록되어 있지 않다",
        message: "파일을 열 앱이 더 이상 없습니다: {app_id}. 서버에서 지워졌을 수 있습니다. 앱 열기에서 앱이 있는지 확인하세요.",
        fix: "앱 열기에서 앱이 있는지 확인하세요"
    }
    FILE_OPEN_APP_VERSION_NOT_FOUND() {
        class: NotFound,
        place: "파일 열기 앱 정의 찾기",
        cause: "파일을 열 앱의 현재 정의가 없다",
        message: "파일을 열 앱의 정의가 이 쉘에 없습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    FILE_OPEN_APP_CANNOT_OPEN(app_id) {
        class: InvalidRequest,
        place: "파일 열기 확장자 검사",
        cause: "앱이 이 파일 확장자를 열도록 선언하지 않았다",
        message: "앱 ID {app_id}: 앱 정의 opens.extensions에 이 파일의 확장자가 없습니다. opens.extensions에 확장자를 더하세요.",
        fix: "앱 정의 opens.extensions에 확장자를 추가하세요"
    }
    FILE_PC_ACCESS_NOT_GRANTED(permission) {
        class: NotGranted,
        place: "내 PC 파일 권한 검사",
        cause: "이 기기에서 내 PC 파일 접근을 허용하지 않았다",
        message: "파일 권한 {permission}: 내 PC 파일 읽기가 아직 허용되지 않았습니다. 이 PC의 파일 읽기 허용을 누르세요.",
        fix: "이 PC의 파일 읽기 허용을 누르세요"
    }
    FILE_PC_ROOT_NOT_FOUND() {
        class: NotFound,
        place: "내 PC 폴더 찾기",
        cause: "내 PC에서 고른 폴더를 찾지 못했다",
        message: "내 PC 폴더를 찾을 수 없습니다. 파일 관리자에서 폴더가 있는지 확인하세요.",
        fix: "파일 관리자에서 폴더를 확인하세요"
    }
    FILE_PC_SCOPE_NOT_SUPPORTED(permission) {
        class: PermissionDenied,
        place: "내 PC 파일 권한 검사",
        cause: "파일 쓰기 요청에 내 PC 범위 권한이 쓰였다",
        message: "파일 권한 {permission}: 내 PC 범위에서는 파일을 쓸 수 없습니다. 앱 정의 permissions에서 scope를 folder로 바꾸세요.",
        fix: "앱 정의 permissions의 scope를 folder로 바꾸세요"
    }
    FILE_WRITE_REQUEST_INVALID() {
        class: InvalidRequest,
        place: "파일 쓰기 명령 확인",
        cause: "파일 쓰기 처리기에 다른 종류의 명령이 전달됐다",
        message: "파일 쓰기 명령이 쉘 안에서 잘못 전달됐습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
        fix: "쉘을 업데이트하세요"
    }
    FILE_CLIENT_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "앱 파일 창 찾기",
        cause: "앱 파일 작업을 요청한 창이 없다",
        message: "앱 파일 작업을 요청한 창이 닫혔습니다. 앱을 다시 열고 시도하세요.",
        fix: "앱을 다시 여세요"
    }
    FILE_CLIENT_APP_VERSION_NOT_FOUND() {
        class: NotFound,
        place: "앱 파일 권한 검사",
        cause: "창이 사용하는 앱 정의가 없다",
        message: "이 창의 앱 정의가 이 쉘에 없습니다. 앱 정의 가져오기로 앱을 다시 가져오세요.",
        fix: "앱 정의 가져오기로 다시 가져오거나 에이전트에게 앱을 다시 올려 달라고 하세요"
    }
    FILE_CLIENT_NOT_DECLARED() {
        class: PermissionDenied,
        place: "앱 파일 권한 검사",
        cause: "창에서 창별 파일 기능을 선언하지 않았다",
        message: "앱 정의에 client가 없어 앱 파일 기능을 쓸 수 없습니다. 앱 정의에 client를 선언하세요.",
        fix: "앱 정의에 client를 선언하세요"
    }
    FILE_CLIENT_INPUT_NOT_OWNED() {
        class: PermissionDenied,
        place: "앱 파일 입력 권한 검사",
        cause: "파일 입력이 이 창에 속하지 않는다",
        message: "이 창에서 고른 파일이 아니어서 읽을 수 없습니다. 앱 코드에서 현재 창이 고른 파일을 사용하도록 고치세요.",
        fix: "앱 코드에서 현재 창이 고른 파일을 사용하도록 고치세요"
    }
    FILE_CLIENT_PICK_NOT_FILE(name) {
        class: InvalidRequest,
        place: "앱 파일 선택 검사",
        cause: "선택한 대상이 일반 파일이 아니다",
        message: "선택한 항목 {name}: 파일이 아닙니다. 파일을 선택하세요.",
        fix: "일반 파일을 선택하세요"
    }
    FILE_CLIENT_PICK_TOO_LARGE(name, limit) {
        class: InvalidRequest,
        place: "앱 파일 크기 검사",
        cause: "선택한 파일이 읽기 한도를 넘었다",
        message: "선택한 파일 {name}: 허용 크기 {limit}보다 커서 전달할 수 없습니다. 더 작은 파일을 선택하세요.",
        fix: "{limit} 이하의 파일을 선택하세요"
    }
    FILE_CLIENT_PICK_NAME_INVALID(path) {
        class: InvalidRequest,
        place: "앱 파일 이름 읽기",
        cause: "선택한 파일 이름을 읽을 수 없다",
        message: "선택한 파일의 이름을 읽지 못했습니다. 파일 관리자에서 이름을 바꾼 뒤 다시 선택하세요. 파일: {path}",
        fix: "파일 관리자에서 이름을 바꾼 뒤 다시 선택하세요"
    }
    FILE_CLIENT_PICK_IO(path) {
        class: Io,
        place: "앱 파일 선택 정보 읽기",
        cause: "선택한 파일 정보를 읽지 못했다",
        message: "선택한 파일의 정보를 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요. 파일: {path}",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_CLIENT_PICK_NOT_FOUND(path) {
        class: NotFound,
        place: "앱 파일 선택 정보 읽기",
        cause: "선택한 뒤 파일이 사라졌다",
        message: "선택한 파일 {path}: 찾을 수 없습니다. 파일 선택 창에서 다시 선택하세요.",
        fix: "파일을 다시 선택하세요"
    }
    FILE_CLIENT_READ_NOT_FOUND(name) {
        class: NotFound,
        place: "앱 파일 읽기",
        cause: "고른 뒤 파일이 지워졌다",
        message: "선택한 파일 {name}: 찾을 수 없습니다. 파일 선택 창에서 다시 선택하세요.",
        fix: "파일을 다시 선택하세요"
    }
    FILE_CLIENT_READ_TOO_LARGE(name, limit) {
        class: InvalidRequest,
        place: "앱 파일 크기 검사",
        cause: "고른 뒤 파일 크기가 읽기 한도를 넘었다",
        message: "선택한 파일 {name}: 허용 크기 {limit}보다 커서 읽을 수 없습니다. 더 작은 파일을 선택하세요.",
        fix: "{limit} 이하의 파일을 선택하세요"
    }
    FILE_CLIENT_READ_IO(name) {
        class: Io,
        place: "앱 파일 읽기",
        cause: "선택한 파일을 읽지 못했다",
        message: "선택한 파일 {name}: 읽지 못했습니다. 파일 관리자에서 파일이 열리는지 확인하세요.",
        fix: "파일 관리자에서 파일이 열리는지 확인하세요"
    }
    FILE_CLIENT_REGISTER_NOT_FILE(path) {
        class: InvalidRequest,
        place: "앱 파일 등록 검사",
        cause: "등록할 대상이 일반 파일이 아니다",
        message: "앱에 전달할 항목 {path}: 파일이 아닙니다. 파일을 선택하세요.",
        fix: "일반 파일을 선택하세요"
    }
    FILE_CLIENT_REGISTER_TOO_LARGE(path, limit) {
        class: InvalidRequest,
        place: "앱 파일 등록 크기 검사",
        cause: "등록할 파일이 읽기 한도를 넘었다",
        message: "앱에 전달할 파일 {path}: 허용 크기 {limit}보다 커서 전달할 수 없습니다. 더 작은 파일을 선택하세요.",
        fix: "{limit} 이하의 파일을 선택하세요"
    }
    FILE_CLIENT_REGISTER_NAME_INVALID(path) {
        class: InvalidRequest,
        place: "앱 파일 등록 이름 읽기",
        cause: "등록할 파일 이름을 읽을 수 없다",
        message: "앱에 전달할 파일의 이름을 읽지 못했습니다. 파일 관리자에서 이름을 바꾼 뒤 다시 선택하세요. 파일: {path}",
        fix: "파일 관리자에서 이름을 바꾼 뒤 다시 선택하세요"
    }
    FILE_CLIENT_REGISTER_IO(path) {
        class: Io,
        place: "앱 파일 등록 정보 읽기",
        cause: "등록할 파일 정보를 읽지 못했다",
        message: "앱에 전달할 파일의 정보를 읽지 못했습니다. 파일 관리자에서 열리는지 확인하세요. 파일: {path}",
        fix: "파일 관리자에서 열리는지 확인하세요"
    }
    FILE_CLIENT_REGISTER_NOT_FOUND(path) {
        class: NotFound,
        place: "앱 파일 등록 정보 읽기",
        cause: "등록할 파일이 사라졌다",
        message: "앱에 전달할 파일 {path}: 찾을 수 없습니다. 파일 선택 창에서 다시 선택하세요.",
        fix: "파일을 다시 선택하세요"
    }
    FILE_CLIENT_EXPORT_ID_NOT_OWNED() {
        class: PermissionDenied,
        place: "앱 파일 출력 권한 검사",
        cause: "출력 대상이 이 창에 속하지 않는다",
        message: "이 창에서 시작하지 않은 파일 출력입니다. 앱 코드에서 현재 창이 시작한 파일 출력만 사용하도록 고치세요.",
        fix: "앱 코드에서 현재 창이 시작한 파일 출력만 사용하도록 고치세요"
    }
    FILE_CLIENT_EXPORT_TARGET_INVALID(name) {
        class: InvalidRequest,
        place: "앱 파일 출력 위치 확인",
        cause: "저장 대화상자가 유효한 파일 위치를 돌려주지 않았다",
        message: "파일 {name}: 저장할 위치를 확인하지 못했습니다. 내보내기를 다시 시작해 저장 위치를 고르세요.",
        fix: "내보내기를 다시 시작해 저장 위치를 고르세요"
    }
    FILE_CLIENT_EXPORT_TEMP_CREATE_IO(name) {
        class: Io,
        place: "앱 파일 내보내기 임시 파일 만들기",
        cause: "내보낼 임시 파일을 만들지 못했다",
        message: "파일 {name}: 내보낼 임시 파일을 만들지 못했습니다. 저장 위치와 디스크 공간을 확인한 뒤 다시 내보내세요.",
        fix: "저장 위치와 디스크 공간을 확인한 뒤 다시 내보내세요"
    }
    FILE_CLIENT_EXPORT_TEMP_CREATE_NOT_FOUND(name) {
        class: NotFound,
        place: "앱 파일 내보내기 임시 파일 만들기",
        cause: "내보낼 임시 파일의 저장 폴더가 없다",
        message: "파일 {name}: 저장 폴더를 찾을 수 없어 임시 파일을 만들지 못했습니다. 내보내기를 다시 시작해 저장 위치를 고르세요.",
        fix: "내보내기를 다시 시작해 저장 위치를 고르세요"
    }
    FILE_CLIENT_EXPORT_CONTENT_WRITE_IO(name) {
        class: Io,
        place: "앱 파일 내보내기 내용 쓰기",
        cause: "임시 파일에 내용을 쓰지 못했다",
        message: "파일 {name}: 내보낼 내용을 쓰지 못했습니다. 저장 위치와 디스크 공간을 확인한 뒤 다시 내보내세요.",
        fix: "저장 위치와 디스크 공간을 확인한 뒤 다시 내보내세요"
    }
    FILE_CLIENT_EXPORT_CONTENT_WRITE_NOT_FOUND(name) {
        class: NotFound,
        place: "앱 파일 내보내기 내용 쓰기",
        cause: "내용을 쓸 임시 파일이나 저장 폴더가 없다",
        message: "파일 {name}: 내용을 쓸 저장 위치를 찾지 못했습니다. 내보내기를 다시 시작해 저장 위치를 고르세요.",
        fix: "내보내기를 다시 시작해 저장 위치를 고르세요"
    }
    FILE_CLIENT_EXPORT_FLUSH_IO(name) {
        class: Io,
        place: "앱 파일 내보내기 내용 저장",
        cause: "임시 파일의 내용을 디스크에 저장하지 못했다",
        message: "파일 {name}: 내보낼 내용을 저장하지 못했습니다. 저장 위치와 디스크 공간을 확인한 뒤 다시 내보내세요.",
        fix: "저장 위치와 디스크 공간을 확인한 뒤 다시 내보내세요"
    }
    FILE_CLIENT_EXPORT_FLUSH_NOT_FOUND(name) {
        class: NotFound,
        place: "앱 파일 내보내기 내용 저장",
        cause: "내용을 저장할 임시 파일이나 저장 폴더가 없다",
        message: "파일 {name}: 내용을 저장할 위치를 찾지 못했습니다. 내보내기를 다시 시작해 저장 위치를 고르세요.",
        fix: "내보내기를 다시 시작해 저장 위치를 고르세요"
    }
    FILE_CLIENT_EXPORT_RENAME_IO(name) {
        class: Io,
        place: "앱 파일 내보내기 완료",
        cause: "완성한 임시 파일을 저장 위치로 옮기지 못했다",
        message: "파일 {name}: 완성한 파일을 저장 위치로 옮기지 못했습니다. 저장 위치와 디스크 공간을 확인한 뒤 다시 내보내세요.",
        fix: "저장 위치와 디스크 공간을 확인한 뒤 다시 내보내세요"
    }
    FILE_CLIENT_EXPORT_RENAME_NOT_FOUND(name) {
        class: NotFound,
        place: "앱 파일 내보내기 완료",
        cause: "완성한 임시 파일이나 저장 폴더가 없다",
        message: "파일 {name}: 완성한 파일을 옮길 저장 위치를 찾지 못했습니다. 내보내기를 다시 시작해 저장 위치를 고르세요.",
        fix: "내보내기를 다시 시작해 저장 위치를 고르세요"
    }
    FILE_CLIENT_EXPORT_TRUNCATE_NOT_FOUND(name) {
        class: NotFound,
        place: "앱 파일 출력 크기 조정",
        cause: "크기를 조정할 임시 파일이 없다",
        message: "파일 {name}: 내보낼 파일이 없어 크기를 조정하지 못했습니다. 파일 내보내기를 다시 시작하세요.",
        fix: "파일 내보내기를 다시 시작하세요"
    }
    FILE_CLIENT_EXPORT_CANCEL_NOT_FOUND(name) {
        class: NotFound,
        place: "앱 파일 내보내기 취소",
        cause: "취소 중 임시 파일이 없어졌다",
        message: "파일 {name}: 내보내기를 취소하는 동안 임시 파일이 이미 사라졌습니다. 추가 조치는 필요하지 않습니다.",
        fix: "추가 조치는 필요하지 않습니다"
    }
    FILE_CLIENT_EXPORT_TRUNCATE_IO(name) {
        class: Io,
        place: "앱 파일 출력 크기 조정",
        cause: "출력 파일 크기를 바꾸지 못했다",
        message: "파일 {name}: 내보내기 크기를 조정하지 못했습니다. 디스크 공간을 확인하세요.",
        fix: "디스크 공간을 확인하세요"
    }
    FILE_CLIENT_EXPORT_CANCEL_IO(name) {
        class: Io,
        place: "앱 파일 내보내기 취소",
        cause: "임시 파일을 지우지 못했다",
        message: "파일 {name}: 내보내기는 취소했지만 임시 파일을 지우지 못했습니다. 저장 폴더에서 .kaleidoscope-로 시작하는 임시 파일을 지우세요.",
        fix: "저장 폴더에서 .kaleidoscope-로 시작하는 임시 파일을 지우세요"
    }
}
