use crate::{AppDefinition, CoreError, CLIENT_FILE_OPEN_VERSION, FILE_DROP_BLOCK_SET_VERSION};

pub(crate) fn validate_file_drop(definition: &AppDefinition) -> Result<(), CoreError> {
    let Some(drop) = &definition.file_drop else {
        return Ok(());
    };
    if definition.requires.blocks < FILE_DROP_BLOCK_SET_VERSION {
        return Err(crate::errors::APP_FILE_DROP_BLOCK_SET_VERSION_LOW(
            FILE_DROP_BLOCK_SET_VERSION,
        ));
    }
    if definition
        .requires
        .modules
        .get("client")
        .copied()
        .unwrap_or(0)
        < CLIENT_FILE_OPEN_VERSION
    {
        return Err(crate::errors::APP_FILE_DROP_CLIENT_VERSION_LOW(
            CLIENT_FILE_OPEN_VERSION,
        ));
    }
    let client = definition
        .client
        .as_ref()
        .ok_or_else(crate::errors::APP_FILE_DROP_CLIENT_REQUIRED)?;
    if !client.actions.contains(&drop.client) {
        return Err(crate::errors::APP_FILE_DROP_ACTION_UNDECLARED(&drop.client));
    }
    Ok(())
}
