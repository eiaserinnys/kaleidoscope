use crate::{data, AppDefinition, Block, CoreError, InputKind, BUTTON_DESCRIPTION_BLOCK_SET_VERSION, INPUT_SPIN_BLOCK_SET_VERSION};

pub(crate) fn validate_input_extensions(definition: &AppDefinition) -> Result<(), CoreError> {
    let mut error = None;
    data::walk_definition_blocks(definition, &mut |pointer, block| {
        if error.is_none() {
            if let Block::Input { spin: Some(_), kind, .. } = block {
                if definition.requires.blocks < INPUT_SPIN_BLOCK_SET_VERSION {
                    error = Some(crate::errors::APP_INPUT_SPIN_VERSION_LOW(pointer, INPUT_SPIN_BLOCK_SET_VERSION, INPUT_SPIN_BLOCK_SET_VERSION));
                } else if !matches!(kind, InputKind::Number) {
                    error = Some(crate::errors::APP_INPUT_SPIN_KIND_INVALID(pointer));
                }
            }
        }
        if error.is_none()
            && definition.requires.blocks < BUTTON_DESCRIPTION_BLOCK_SET_VERSION
            && matches!(block, Block::Button { description: Some(_), .. })
        {
            error = Some(crate::errors::APP_BUTTON_DESCRIPTION_VERSION_LOW(pointer, BUTTON_DESCRIPTION_BLOCK_SET_VERSION, BUTTON_DESCRIPTION_BLOCK_SET_VERSION));
        }
    });
    error.map_or(Ok(()), Err)
}
