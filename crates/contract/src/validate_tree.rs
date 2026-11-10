use crate::data::Binding;
use crate::{
    AppDefinition, Block, CoreError, TREE_CHECK_BLOCK_SET_VERSION, TREE_EDIT_MOVE_BLOCK_SET_VERSION,
    TREE_EMPTY_TEXT_BLOCK_SET_VERSION,
};

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

fn items_editing(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Array(items) => items.iter().any(items_editing),
        serde_json::Value::Object(map) => {
            map.get("editing").and_then(serde_json::Value::as_bool) == Some(true)
                || map.get("children").is_some_and(items_editing)
        }
        _ => false,
    }
}

fn uses_edit_move(block: &Block) -> bool {
    match block {
        Block::Tree {
            items,
            on_edit,
            on_edit_cancel,
            on_move,
            ..
        } => {
            on_edit.is_some()
                || on_edit_cancel.is_some()
                || on_move.is_some()
                || matches!(items, Some(Binding::Literal(value)) if items_editing(value))
        }
        Block::Section {
            menu,
            editing,
            on_edit,
            on_edit_cancel,
            ..
        } => menu.is_some() || editing.is_some() || on_edit.is_some() || on_edit_cancel.is_some(),
        _ => false,
    }
}

fn uses_empty_text(block: &Block) -> bool {
    matches!(
        block,
        Block::Tree {
            empty_text: Some(_),
            ..
        }
    )
}

fn uses_edit_move_actions(block: &Block) -> bool {
    matches!(
        block,
        Block::Tree {
            on_edit: Some(_),
            ..
        } | Block::Tree {
            on_edit_cancel: Some(_),
            ..
        } | Block::Tree {
            on_move: Some(_),
            ..
        }
    )
}

pub(crate) fn validate_tree_extensions(definition: &AppDefinition) -> Result<(), CoreError> {
    let mut root_error = None;
    crate::data::walk_definition_blocks(definition, &mut |pointer, block| {
        if root_error.is_some() {
            return;
        }
        if uses_check(block) {
            if let Block::Tree {
                items: None,
                root: Some(_),
                ..
            } = block
            {
                root_error = Some(crate::errors::APP_TREE_CHECK_ROOT_UNSUPPORTED(pointer));
            }
        }
        if root_error.is_none() && uses_edit_move_actions(block) {
            if let Block::Tree {
                items: None,
                root: Some(_),
                ..
            } = block
            {
                root_error = Some(crate::errors::APP_TREE_EDIT_MOVE_ROOT_UNSUPPORTED(pointer));
            }
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
    if definition.requires.blocks < TREE_EDIT_MOVE_BLOCK_SET_VERSION {
        let mut version_error = None;
        crate::data::walk_definition_blocks(definition, &mut |pointer, block| {
            if version_error.is_some() || !uses_edit_move(block) {
                return;
            }
            version_error = Some(match block {
                Block::Section { .. } => crate::errors::APP_SECTION_EDIT_MENU_VERSION_LOW(
                    pointer,
                    TREE_EDIT_MOVE_BLOCK_SET_VERSION,
                ),
                _ => crate::errors::APP_TREE_EDIT_MOVE_VERSION_LOW(
                    pointer,
                    TREE_EDIT_MOVE_BLOCK_SET_VERSION,
                ),
            });
        });
        if let Some(error) = version_error {
            return Err(error);
        }
    }
    if definition.requires.blocks < TREE_EMPTY_TEXT_BLOCK_SET_VERSION {
        let mut version_error = None;
        crate::data::walk_definition_blocks(definition, &mut |pointer, block| {
            if version_error.is_some() || !uses_empty_text(block) {
                return;
            }
            version_error = Some(crate::errors::APP_TREE_EMPTY_TEXT_VERSION_LOW(
                pointer,
                TREE_EMPTY_TEXT_BLOCK_SET_VERSION,
            ));
        });
        if let Some(error) = version_error {
            return Err(error);
        }
    }
    Ok(())
}
