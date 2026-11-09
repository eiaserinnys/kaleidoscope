//! 기기 전역 화면 테마의 저장. 서버를 바꿀 때 통째로 갈아 끼우는 상태 파일(`state.json`, `device.json`)과
//! 따로 두어, 어느 서버에 붙든 같은 테마를 쓴다.
use std::path::Path;

use kaleidoscope_contract::{CoreError, ThemePreference};

const FILE: &str = "theme.json";

pub(crate) fn load(data_dir: &Path) -> Result<ThemePreference, CoreError> {
    crate::storage::load_file(&data_dir.join(FILE), FILE)
}

pub(crate) fn save(data_dir: &Path, theme: ThemePreference) -> Result<(), CoreError> {
    crate::storage::save_atomic(&data_dir.join(FILE), &theme)
}
