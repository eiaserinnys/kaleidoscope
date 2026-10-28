use kaleidoscope_contract::{CoreError, ErrorCode};

pub(crate) fn make(code: ErrorCode) -> CoreError {
    CoreError {
        message: message(code).to_string(),
        code,
        details: Vec::new(),
    }
}

pub(crate) fn with_details(code: ErrorCode, details: Vec<String>) -> CoreError {
    CoreError {
        message: message(code).to_string(),
        code,
        details,
    }
}

pub(crate) fn io_error(error: &std::io::Error) -> CoreError {
    let code = if error.kind() == std::io::ErrorKind::NotFound {
        ErrorCode::NotFound
    } else {
        ErrorCode::Io
    };
    make(code)
}

pub(crate) fn message(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::InvalidRequest => "명령을 처리할 수 없습니다.",
        ErrorCode::NotFound => "요청한 항목을 찾을 수 없습니다.",
        ErrorCode::InvalidAppDefinition => "앱 정의가 유효하지 않습니다.",
        ErrorCode::UnsupportedApp => "앱이 지원되지 않는 블록이나 모듈 버전을 요구합니다.",
        ErrorCode::PermissionDenied => "앱에 선언되지 않았거나 쓰기가 허용되지 않은 권한입니다.",
        ErrorCode::NotGranted => "이 기기에서 폴더를 선택해야 합니다.",
        ErrorCode::PathOutsideRoot => "고른 폴더 밖의 경로입니다.",
        ErrorCode::Conflict => "파일이 읽은 뒤 바뀌었거나 이미 존재합니다.",
        ErrorCode::Io => "파일을 읽거나 쓸 수 없습니다.",
    }
}
