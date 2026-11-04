//! 창을 만들지 않고 설치된 앱 판의 아이콘 선언을 읽는다.
use std::sync::Arc;
use crate::{app_commands, Inner};
use kaleidoscope_contract::{data::MediaData, errors, CoreError};
use super::get_asset;

pub(crate) fn get(inner: &Arc<Inner>, app_id: &str, app_version: u32) -> Result<Option<MediaData>, CoreError> {
    let icon = {
        let state = inner.state.lock().unwrap();
        if !state.shared.apps.iter().any(|app| app.id == app_id) {
            return Err(errors::APP_ICON_APP_NOT_INSTALLED(app_id));
        }
        let definition = app_commands::definition_for(&state.shared, app_id, app_version)
            .ok_or_else(|| errors::APP_ICON_APP_VERSION_NOT_FOUND(app_id, app_version))?;
        let Some(icon) = definition.icon else { return Ok(None) };
        let declared = definition.assets.iter().find(|asset| asset.id == icon.asset)
            .ok_or_else(|| errors::APP_ICON_ASSET_UNDECLARED(app_id, &icon.asset, icon.version))?;
        if declared.version != icon.version {
            return Err(errors::APP_ICON_VERSION_MISMATCH(app_id, &icon.asset, icon.version, declared.version));
        }
        icon
    };
    get_asset(inner, &icon.asset, icon.version, None).map(Some)
}

