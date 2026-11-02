use kaleidoscope_contract::CoreError;

pub(super) fn export_error(
    error: &std::io::Error,
    name: &str,
    not_found: impl FnOnce(&str) -> CoreError,
    io_error: impl FnOnce(&str) -> CoreError,
) -> CoreError {
    let mut mapped = if error.kind() == std::io::ErrorKind::NotFound {
        not_found(name)
    } else {
        io_error(name)
    };
    mapped.details.push(error.to_string());
    mapped
}

pub(super) fn input_not_owned(id: &str) -> CoreError {
    kaleidoscope_contract::errors::FILE_CLIENT_INPUT_NOT_OWNED()
        .and_details(vec![format!("client_file_id: {id}")])
}

pub(super) fn export_not_owned(id: &str) -> CoreError {
    kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_ID_NOT_OWNED()
        .and_details(vec![format!("export_id: {id}")])
}
