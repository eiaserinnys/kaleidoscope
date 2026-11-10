//! `shell.import_app` 동작. 앱 정의 파일 하나를 골라 이 기기에 가져온다.
use std::{fs, path::Path, sync::Arc};

use kaleidoscope_contract::{
    data::FileAccept,
    errors,
    size::format_byte_limit,
    store::STORE_APP_JSON_MAX_BYTES,
    CoreError,
};

use crate::Inner;

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// 고른 파일을 읽어 앱으로 가져온다. false는 사용자가 고르기를 취소한 경우이며 호출자는
/// 나머지 동작을 실행하지 않는다. 파일 경로와 바이트는 앱에 돌려주지 않는다.
pub(crate) fn import(inner: &Arc<Inner>) -> Result<bool, CoreError> {
    if !inner.host.supports_pick_files() {
        return Err(errors::DESK_APP_IMPORT_PICKER_UNAVAILABLE());
    }
    let accept = FileAccept {
        mime: "application/json".into(),
        extensions: vec!["json".into()],
    };
    let Some(paths) = inner.host.pick_files(&[accept], false) else {
        return Ok(false);
    };
    let Some(path) = paths.into_iter().next() else {
        return Ok(false);
    };
    let name = file_name(&path);
    let metadata = fs::metadata(&path)
        .map_err(|_| errors::DESK_APP_IMPORT_FILE_READ_FAILED(&name))?;
    if !metadata.is_file() {
        return Err(errors::DESK_APP_IMPORT_FILE_READ_FAILED(&name));
    }
    if metadata.len() > STORE_APP_JSON_MAX_BYTES {
        return Err(errors::DESK_APP_IMPORT_FILE_TOO_LARGE(
            &name,
            &format_byte_limit(STORE_APP_JSON_MAX_BYTES),
        ));
    }
    let bytes = fs::read(&path).map_err(|_| errors::DESK_APP_IMPORT_FILE_READ_FAILED(&name))?;
    let definition_json = String::from_utf8(bytes)
        .map_err(|_| errors::DESK_APP_IMPORT_FILE_ENCODING_INVALID(&name))?;
    crate::link::import_app(inner, definition_json)?;
    Ok(true)
}
