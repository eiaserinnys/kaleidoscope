use crate::{data, AppDefinition, Block, CoreError, BUTTON_DESCRIPTION_BLOCK_SET_VERSION};

pub(crate) fn validate_input_extensions(definition: &AppDefinition) -> Result<(), CoreError> {
    let mut error = None;
    data::walk_definition_blocks(definition, &mut |pointer, block| {
        if error.is_none()
            && definition.requires.blocks < BUTTON_DESCRIPTION_BLOCK_SET_VERSION
            && matches!(block, Block::Button { description: Some(_), .. })
        {
            error = Some(crate::errors::APP_BUTTON_DESCRIPTION_VERSION_LOW(pointer, BUTTON_DESCRIPTION_BLOCK_SET_VERSION, BUTTON_DESCRIPTION_BLOCK_SET_VERSION));
        }
    });
    error.map_or(Ok(()), Err)
}
