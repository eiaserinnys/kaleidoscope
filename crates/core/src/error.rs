use kaleidoscope_contract::{CoreError, ErrorCode};

pub(crate) fn make(code: ErrorCode) -> CoreError {
    CoreError::new(code)
}

pub(crate) fn with_message(code: ErrorCode, message: &str) -> CoreError {
    CoreError {
        message: message.to_string(),
        code,
        details: Vec::new(),
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
