error_catalog! { ENTRIES;
    FILE_ACCESS_PERMISSION_UNDECLARED(permission) {
        class: PermissionDenied,
        place: "파일 접근 권한 검사",
        cause: "앱 정의에 파일 권한이 선언되지 않았다",
        message: "파일 권한 {permission}: 앱 정의 permissions에 선언되지 않았습니다. 앱 정의 permissions에 추가하세요.",
        fix: "앱 정의의 files 권한 목록을 확인하세요"
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
        message: "파일 권한 {permission}: 이 기기에서 사용할 폴더가 없습니다. 앱에서 ‘폴더 선택’을 눌러 지정하세요.",
        fix: "앱에서 ‘폴더 선택’을 눌러 지정하세요"
    }
    FILE_ACCESS_WINDOW_NOT_FOUND() {
        class: NotFound,
        place: "파일 권한 검사",
        cause: "파일 권한을 확인할 창이 없다",
        message: "파일 권한을 확인할 앱 창이 없습니다. 파일을 다시 여세요.",
        fix: "앱을 다시 여세요"
    }
    FILE_ACCESS_APP_VERSION_NOT_FOUND() {
        class: NotFound,
        place: "파일 권한 검사",
        cause: "창이 사용하는 앱 버전이 없다",
        message: "앱 창의 현재 정의를 찾을 수 없습니다. 앱 레지스트리에 현재 앱 정의를 등록하세요.",
        fix: "앱 레지스트리에 현재 앱 정의를 등록하세요"
    }
    FILE_ACCESS_PERMISSION_NOT_FILES(permission) {
        class: PermissionDenied,
        place: "파일 권한 검사",
        cause: "요청한 권한이 파일 권한이 아니다",
        message: "앱 정의 permissions의 {permission} 항목이 files 모듈이 아닙니다. 이 항목의 모듈을 files로 바꾸세요.",
        fix: "앱 정의 permissions에서 {permission}의 모듈을 files로 바꾸세요"
    }
    FILE_ACCESS_ROOT_CHANGED(permission) {
        class: NotFound,
        place: "선택한 폴더 검사",
        cause: "선택한 폴더가 더는 같은 위치의 폴더가 아니다",
        message: "파일 권한 {permission}: 선택한 폴더가 바뀌었거나 더는 폴더가 아닙니다. 앱에서 ‘폴더 선택’을 눌러 다시 지정하세요.",
        fix: "앱에서 ‘폴더 선택’을 눌러 다시 지정하세요"
    }
    FILE_LIST_DIRECTORY_IO(path) {
        class: Io,
        place: "파일 목록 읽기",
        cause: "폴더를 읽지 못했다",
        message: "폴더 {path}: 파일 목록을 읽지 못했습니다. 파일 목록에서 새로 고침을 선택하세요.",
        fix: "파일 목록에서 새로 고침을 선택하세요"
    }
    FILE_LIST_DIRECTORY_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 목록 읽기",
        cause: "목록을 읽으려는 폴더가 사라졌다",
        message: "폴더 {path}: 찾을 수 없습니다. 파일 목록에서 새로 고침을 선택하세요.",
        fix: "파일 목록에서 새로 고침을 선택하세요"
    }
    FILE_LIST_ENTRY_IO(path) {
        class: Io,
        place: "파일 목록 항목 읽기",
        cause: "목록 항목 정보를 읽지 못했다",
        message: "폴더 {path}: 안의 항목 정보를 읽지 못했습니다. 파일 목록에서 새로 고침을 선택하세요.",
        fix: "파일 목록에서 새로 고침을 선택하세요"
    }
    FILE_LIST_ENTRY_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 목록 항목 읽기",
        cause: "목록을 읽는 중 폴더가 사라졌다",
        message: "폴더 {path}: 읽는 동안 바뀌었습니다. 파일 목록에서 새로 고침을 선택하세요.",
        fix: "파일 목록에서 새로 고침을 선택하세요"
    }
    FILE_LIST_NAME_NOT_TEXT(path) {
        class: Io,
        place: "파일 목록 항목 이름 읽기",
        cause: "항목 이름이 UTF-8 문자열이 아니다",
        message: "폴더 {path}: 안에 이름을 읽을 수 없는 항목이 있습니다. 파일 관리자에서 그 항목의 이름을 바꾸세요.",
        fix: "파일 관리자에서 항목 이름을 바꾸세요"
    }
    FILE_READ_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 읽기",
        cause: "읽으려는 파일이 없다",
        message: "파일 {path}: 찾을 수 없습니다. 파일 목록에서 새로 고침을 선택한 뒤 파일을 다시 여세요.",
        fix: "파일 목록에서 새로 고침을 선택한 뒤 파일을 다시 여세요"
    }
    FILE_READ_IO(path) {
        class: Io,
        place: "파일 읽기",
        cause: "파일을 읽지 못했다",
        message: "파일 {path}: 읽지 못했습니다. 파일 관리자에서 파일이 열리는지 확인하세요.",
        fix: "파일 접근 권한을 확인하세요"
    }
    FILE_READ_TOO_LARGE(path) {
        class: Io,
        place: "파일 크기 검사",
        cause: "파일이 읽기 한도보다 크다",
        message: "파일 {path}: 5MB를 넘어 읽을 수 없습니다. 더 작은 파일을 선택하세요.",
        fix: "5MB 이하의 파일을 선택하세요"
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
        message: "경로 {path}: 파일이나 상위 폴더를 찾을 수 없습니다. 경로가 올바른지 확인하세요.",
        fix: "경로가 올바른지 확인하세요"
    }
    FILE_PATH_IO(path) {
        class: Io,
        place: "파일 경로 검사",
        cause: "경로 정보를 확인하지 못했다",
        message: "경로 {path}: 위치 정보를 확인하지 못했습니다. 파일 경로와 접근 가능 여부를 확인하세요.",
        fix: "파일 경로와 접근 가능 여부를 확인하세요"
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
        message: "파일 {path}: 새 내용을 저장하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_CREATE_FILE_OPEN_NOT_FOUND(path) {
        class: NotFound,
        place: "새 파일 열기",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 파일이 이미 없어 새 파일을 열지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
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
        message: "파일 {path}: 새 파일을 열지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "파일 {path}: 내용을 기록하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_CREATE_FOLDER_PARENT_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "새 폴더 상위 위치 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "상위 폴더 {path}: 상위 폴더가 사라져 새 폴더를 만들 수 없습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_CREATE_FOLDER_PARENT_METADATA_BUSY(path) {
        class: FileBusy,
        place: "새 폴더 상위 위치 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "상위 폴더 {path}: 다른 프로그램이 사용 중이라 상위 폴더를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_CREATE_FOLDER_PARENT_METADATA_IO(path) {
        class: Io,
        place: "새 폴더 상위 위치 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "상위 폴더 {path}: 상위 폴더 정보를 읽지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "폴더 {path}: 폴더를 만들지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_RENAME_APPLY_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 이름 바꾸기",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 이름을 바꿀 파일이 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_RENAME_APPLY_BUSY(path) {
        class: FileBusy,
        place: "파일 이름 바꾸기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 이름을 바꾸지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_RENAME_APPLY_IO(path) {
        class: Io,
        place: "파일 이름 바꾸기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 이름을 바꾸지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_MOVE_SOURCE_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 옮기기 원본 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 옮길 파일이 사라져 종류를 확인하지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_MOVE_SOURCE_METADATA_BUSY(path) {
        class: FileBusy,
        place: "파일 옮기기 원본 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 파일 종류를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_MOVE_SOURCE_METADATA_IO(path) {
        class: Io,
        place: "파일 옮기기 원본 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 파일 종류를 확인하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_MOVE_APPLY_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 옮기기",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 옮길 파일이나 대상 폴더가 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_MOVE_APPLY_BUSY(path) {
        class: FileBusy,
        place: "파일 옮기기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 파일을 옮기지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_MOVE_APPLY_IO(path) {
        class: Io,
        place: "파일 옮기기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 파일을 옮기지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_COPY_SOURCE_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 복사 원본 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 복사할 파일이 사라져 종류를 확인하지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_SOURCE_METADATA_BUSY(path) {
        class: FileBusy,
        place: "파일 복사 원본 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 파일 종류를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_SOURCE_METADATA_IO(path) {
        class: Io,
        place: "파일 복사 원본 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 파일 종류를 확인하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_REMOVE_PERMANENT_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 영구 삭제",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 삭제할 파일이 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_REMOVE_PERMANENT_BUSY(path) {
        class: FileBusy,
        place: "파일 영구 삭제",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 파일을 삭제하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_REMOVE_PERMANENT_IO(path) {
        class: Io,
        place: "파일 영구 삭제",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 파일을 삭제하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_DESTINATION_FOLDER_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 작업 대상 폴더 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "대상 폴더 {path}: 대상 폴더가 사라졌습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_DESTINATION_FOLDER_METADATA_BUSY(path) {
        class: FileBusy,
        place: "파일 작업 대상 폴더 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "대상 폴더 {path}: 다른 프로그램이 사용 중이라 대상 폴더를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_DESTINATION_FOLDER_METADATA_IO(path) {
        class: Io,
        place: "파일 작업 대상 폴더 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "대상 폴더 {path}: 대상 폴더 정보를 읽지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_DATA_PATH_CHECK_NOT_FOUND(path) {
        class: NotFound,
        place: "쉘 데이터 폴더 보호 검사",
        cause: "작업 중 대상이 사라졌다",
        message: "경로 {path}: 쉘 데이터 폴더를 찾을 수 없어 접근 범위를 확인하지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_DATA_PATH_CHECK_BUSY(path) {
        class: FileBusy,
        place: "쉘 데이터 폴더 보호 검사",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "경로 {path}: 다른 프로그램이 사용 중이라 접근 범위를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_DATA_PATH_CHECK_IO(path) {
        class: Io,
        place: "쉘 데이터 폴더 보호 검사",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "경로 {path}: 쉘 데이터 폴더 정보를 확인하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "항목 {path}: 항목 종류를 확인하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "대상 폴더 {path}: 폴더를 만들지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "폴더 {path}: 폴더 내용을 읽지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "폴더 {path}: 항목 정보를 읽지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "파일 {path}: 원본 파일을 열지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "대상 파일 {path}: 대상 파일을 만들지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "대상 파일 {path}: 복사한 내용을 기록하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_COPY_NAME_SOURCE_METADATA_NOT_FOUND(path) {
        class: NotFound,
        place: "복사본 이름 정하기 원본 확인",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 복사할 파일이 사라져 이름을 정하지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_COPY_NAME_SOURCE_METADATA_BUSY(path) {
        class: FileBusy,
        place: "복사본 이름 정하기 원본 확인",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 원본 종류를 확인하지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_COPY_NAME_SOURCE_METADATA_IO(path) {
        class: Io,
        place: "복사본 이름 정하기 원본 확인",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 원본 종류를 확인하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
    }
    FILE_REVEAL_OPEN_NOT_FOUND(path) {
        class: NotFound,
        place: "파일 위치 열기",
        cause: "작업 중 대상이 사라졌다",
        message: "파일 {path}: 파일이 사라져 위치를 열지 못했습니다. 파일 관리자에서 경로를 확인하세요.",
        fix: "파일 관리자에서 경로를 확인하세요"
    }
    FILE_REVEAL_OPEN_BUSY(path) {
        class: FileBusy,
        place: "파일 위치 열기",
        cause: "다른 프로그램이 대상에 접근하고 있다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 파일 위치를 열지 못했습니다. 파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일이나 폴더를 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_REVEAL_OPEN_IO(path) {
        class: Io,
        place: "파일 위치 열기",
        cause: "파일 시스템 작업을 마치지 못했다",
        message: "파일 {path}: 파일 위치를 열지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "경로 {path}: 링크 여부를 확인하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "경로 {path}: 존재 여부를 확인하지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "폴더 {path} 안에 새 폴더를 만들 수 없습니다. 파일 목록에서 폴더를 선택하세요.",
        fix: "폴더를 선택하세요"
    }
    FILE_SAVE_FILE_DELETED(name) {
        class: Conflict,
        place: "파일 저장",
        cause: "읽은 뒤 파일이 삭제됐다",
        message: "파일 {name}: 처음 읽은 뒤 삭제되어 저장하지 못했습니다. 덮어쓰기를 선택해 파일을 다시 저장하세요.",
        fix: "파일을 다시 읽고 수정한 뒤 저장하세요"
    }
    FILE_SAVE_REVISION_CHANGED(name) {
        class: Conflict,
        place: "파일 저장",
        cause: "읽은 뒤 파일 내용이 바뀌었다",
        message: "파일 {name}: 처음 읽은 뒤 내용이 바뀌어 저장하지 못했습니다. 다시 불러온 뒤 수정하고 저장하거나 덮어쓰기를 선택하세요.",
        fix: "파일을 다시 읽고 수정한 뒤 저장하세요"
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
        message: "파일 {name}: 저장 전에 내용을 읽지 못했습니다. 파일 위치와 접근 권한을 확인하세요.",
        fix: "파일 위치와 접근 권한을 확인하세요"
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
        message: "대상 {path}: 폴더가 아닙니다. 파일 목록에서 폴더를 선택하세요.",
        fix: "대상 폴더를 선택하세요"
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
        message: "파일 {path}: 휴지통으로 보내지 못했습니다. 이 항목을 지우려면 영구 삭제를 선택하세요.",
        fix: "영구 삭제를 선택하세요"
    }
    FILE_REMOVE_TRASH_BUSY(path) {
        class: FileBusy,
        place: "파일 휴지통 보내기",
        cause: "다른 프로그램이 파일을 사용 중이다",
        message: "파일 {path}: 다른 프로그램이 사용 중이라 휴지통으로 보내지 못했습니다. 파일을 사용하는 프로그램을 닫고 다시 시도하세요.",
        fix: "파일을 사용하는 프로그램을 닫고 다시 시도하세요"
    }
    FILE_OPEN_NOT_FILE(path) {
        class: InvalidRequest,
        place: "파일 열기 대상 검사",
        cause: "열려는 경로가 파일이 아니다",
        message: "경로 {path}: 파일이 아닙니다. 파일을 선택해 다시 여세요.",
        fix: "파일을 선택하세요"
    }
    FILE_OPEN_APP_NOT_FOUND() {
        class: NotFound,
        place: "파일 열기 앱 찾기",
        cause: "파일을 열 앱이 등록되어 있지 않다",
        message: "파일을 열 앱이 등록되어 있지 않습니다. 앱 레지스트리에 해당 앱을 등록하세요.",
        fix: "앱 레지스트리에 파일을 열 앱을 등록하세요"
    }
    FILE_OPEN_APP_VERSION_NOT_FOUND() {
        class: NotFound,
        place: "파일 열기 앱 정의 찾기",
        cause: "파일을 열 앱의 현재 정의가 없다",
        message: "파일을 열 앱의 현재 정의를 찾을 수 없습니다. 앱 레지스트리에 현재 앱 정의를 등록하세요.",
        fix: "앱 레지스트리에 현재 앱 정의를 등록하세요"
    }
    FILE_OPEN_APP_CANNOT_OPEN() {
        class: InvalidRequest,
        place: "파일 열기 확장자 검사",
        cause: "앱이 이 파일 확장자를 열도록 선언하지 않았다",
        message: "앱 정의 opens.extensions에 이 파일의 확장자가 없습니다. 앱 정의에 지원 확장자를 추가하세요.",
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
        message: "파일 쓰기 요청 형식이 올바르지 않습니다. 쉘을 최신 판으로 업데이트하세요.",
        fix: "쉘을 최신 판으로 업데이트하세요"
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
        message: "앱의 현재 정의를 찾을 수 없습니다. 앱 레지스트리에 현재 버전을 등록하세요.",
        fix: "앱 레지스트리에 현재 앱 버전을 등록하세요"
    }
    FILE_CLIENT_NOT_DECLARED() {
        class: PermissionDenied,
        place: "앱 파일 권한 검사",
        cause: "창에서 창별 파일 기능을 선언하지 않았다",
        message: "앱 정의 client에 파일 입력과 출력을 선언하지 않았습니다. 앱 정의의 client 설정을 고치세요.",
        fix: "앱 정의 client에 파일 입력과 출력을 선언하세요"
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
    FILE_CLIENT_PICK_TOO_LARGE(name) {
        class: InvalidRequest,
        place: "앱 파일 크기 검사",
        cause: "선택한 파일이 읽기 한도를 넘었다",
        message: "선택한 파일 {name}: 20MB를 넘어 전달할 수 없습니다. 더 작은 파일을 선택하세요.",
        fix: "20MB 이하의 파일을 선택하세요"
    }
    FILE_CLIENT_PICK_NAME_INVALID(path) {
        class: InvalidRequest,
        place: "앱 파일 이름 읽기",
        cause: "선택한 파일 이름을 읽을 수 없다",
        message: "선택한 파일 이름을 읽지 못했습니다. 파일 경로: {path}. 파일 관리자에서 파일 이름을 확인하세요.",
        fix: "파일 관리자에서 파일 이름을 확인하세요"
    }
    FILE_CLIENT_PICK_IO(path) {
        class: Io,
        place: "앱 파일 선택 정보 읽기",
        cause: "선택한 파일 정보를 읽지 못했다",
        message: "선택한 파일 정보를 읽지 못했습니다. 파일 경로: {path}. 파일 관리자에서 파일이 열리는지 확인하세요.",
        fix: "파일 관리자에서 파일을 확인하세요"
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
    FILE_CLIENT_READ_TOO_LARGE(name) {
        class: InvalidRequest,
        place: "앱 파일 크기 검사",
        cause: "고른 뒤 파일 크기가 읽기 한도를 넘었다",
        message: "선택한 파일 {name}: 20MB를 넘어 읽을 수 없습니다. 더 작은 파일을 선택하세요.",
        fix: "20MB 이하의 파일을 선택하세요"
    }
    FILE_CLIENT_READ_IO(name) {
        class: Io,
        place: "앱 파일 읽기",
        cause: "선택한 파일을 읽지 못했다",
        message: "선택한 파일 {name}: 읽지 못했습니다. 파일 관리자에서 파일이 열리는지 확인하세요.",
        fix: "파일 접근 권한을 확인하세요"
    }
    FILE_CLIENT_REGISTER_NOT_FILE(path) {
        class: InvalidRequest,
        place: "앱 파일 등록 검사",
        cause: "등록할 대상이 일반 파일이 아니다",
        message: "앱에 전달할 항목 {path}: 파일이 아닙니다. 파일을 선택하세요.",
        fix: "일반 파일을 선택하세요"
    }
    FILE_CLIENT_REGISTER_TOO_LARGE(path) {
        class: InvalidRequest,
        place: "앱 파일 등록 크기 검사",
        cause: "등록할 파일이 읽기 한도를 넘었다",
        message: "앱에 전달할 파일 {path}: 20MB를 넘어 전달할 수 없습니다. 더 작은 파일을 선택하세요.",
        fix: "20MB 이하의 파일을 선택하세요"
    }
    FILE_CLIENT_REGISTER_NAME_INVALID(path) {
        class: InvalidRequest,
        place: "앱 파일 등록 이름 읽기",
        cause: "등록할 파일 이름을 읽을 수 없다",
        message: "앱에 전달할 파일 이름을 읽지 못했습니다. 파일 경로: {path}. 파일 관리자에서 파일 이름을 확인하세요.",
        fix: "파일 관리자에서 파일 이름을 확인하세요"
    }
    FILE_CLIENT_REGISTER_IO(path) {
        class: Io,
        place: "앱 파일 등록 정보 읽기",
        cause: "등록할 파일 정보를 읽지 못했다",
        message: "앱에 전달할 파일 정보를 읽지 못했습니다. 파일 경로: {path}. 파일 관리자에서 파일이 열리는지 확인하세요.",
        fix: "파일 관리자에서 파일을 확인하세요"
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
        message: "파일 {name}: 저장할 위치를 확인하지 못했습니다. 파일 선택 창에서 저장 위치를 다시 선택하세요.",
        fix: "저장 위치를 다시 선택하세요"
    }
    FILE_CLIENT_EXPORT_TEMP_CREATE_IO(name) {
        class: Io,
        place: "앱 파일 내보내기 임시 파일 만들기",
        cause: "내보낼 임시 파일을 만들지 못했다",
        message: "파일 {name}: 내보낼 임시 파일을 만들지 못했습니다. 저장 위치와 저장 공간을 확인한 뒤 다시 내보내세요.",
        fix: "저장 위치와 저장 공간을 확인한 뒤 다시 내보내세요"
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
        message: "파일 {name}: 내보낼 내용을 쓰지 못했습니다. 저장 위치와 저장 공간을 확인한 뒤 다시 내보내세요.",
        fix: "저장 위치와 저장 공간을 확인한 뒤 다시 내보내세요"
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
        message: "파일 {name}: 내보낼 내용을 저장하지 못했습니다. 저장 위치와 저장 공간을 확인한 뒤 다시 내보내세요.",
        fix: "저장 위치와 저장 공간을 확인한 뒤 다시 내보내세요"
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
        message: "파일 {name}: 완성한 파일을 저장 위치로 옮기지 못했습니다. 저장 위치와 저장 공간을 확인한 뒤 다시 내보내세요.",
        fix: "저장 위치와 저장 공간을 확인한 뒤 다시 내보내세요"
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
        message: "파일 {name}: 내보내기를 취소하는 동안 임시 파일이 이미 사라졌습니다. 취소한 내보내기는 정리된 상태입니다.",
        fix: "취소한 내보내기는 정리된 상태입니다"
    }
    FILE_CLIENT_EXPORT_TRUNCATE_IO(name) {
        class: Io,
        place: "앱 파일 출력 크기 조정",
        cause: "출력 파일 크기를 바꾸지 못했다",
        message: "파일 {name}: 내보내기 크기를 조정하지 못했습니다. 저장 공간을 확인하세요.",
        fix: "저장 공간을 확인하세요"
    }
    FILE_CLIENT_EXPORT_CANCEL_IO(name) {
        class: Io,
        place: "앱 파일 내보내기 취소",
        cause: "임시 파일을 지우지 못했다",
        message: "파일 {name} 내보내기를 취소했지만 임시 파일을 지우지 못했습니다. 파일 내보내기를 다시 시작하세요.",
        fix: "파일 내보내기를 다시 시작하세요"
    }
}
