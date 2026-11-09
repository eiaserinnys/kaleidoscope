use crate::{AppDefinition, Block, CoreError, TREE_CHECK_BLOCK_SET_VERSION};

fn uses_check(block: &Block) -> bool {
    matches!(
        block,
        Block::Tree {
            on_check: Some(_),
            ..
        } | Block::Tree {
            default_expanded: true,
            ..
        }
    )
}

pub(crate) fn validate_tree_extensions(definition: &AppDefinition) -> Result<(), CoreError> {
    let mut root_error = None;
    crate::data::walk_definition_blocks(definition, &mut |pointer, block| {
        if root_error.is_some() || !uses_check(block) {
            return;
        }
        if let Block::Tree {
            items: None,
            root: Some(_),
            ..
        } = block
        {
            root_error = Some(crate::errors::APP_TREE_CHECK_ROOT_UNSUPPORTED(pointer));
        }
    });
    if let Some(error) = root_error {
        return Err(error);
    }
    if definition.requires.blocks < TREE_CHECK_BLOCK_SET_VERSION {
        let mut version_error = None;
        crate::data::walk_definition_blocks(definition, &mut |pointer, block| {
            if version_error.is_some() || !uses_check(block) {
                return;
            }
            version_error = Some(crate::errors::APP_TREE_CHECK_VERSION_LOW(
                pointer,
                TREE_CHECK_BLOCK_SET_VERSION,
            ));
        });
        if let Some(error) = version_error {
            return Err(error);
        }
    }
    Ok(())
}
