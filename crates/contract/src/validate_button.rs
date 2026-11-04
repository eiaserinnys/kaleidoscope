use crate::{data, AppDefinition, Block, CoreError, BUTTON_VARIANT_ICON_BLOCK_SET_VERSION};
use data::Binding;

const NEW_ICONS: &[&str] = &["film", "sticker", "image-play"];

pub(crate) fn validate_button_extensions(definition: &AppDefinition) -> Result<(), CoreError> {
    if definition.requires.blocks >= BUTTON_VARIANT_ICON_BLOCK_SET_VERSION {
        return Ok(());
    }
    let mut error = None;
    data::walk_definition_blocks(definition, &mut |pointer, block| {
        if error.is_some() { return; }
        match block {
            Block::Button { variant, icon, .. } => {
                if !matches!(variant, Binding::Literal(_)) {
                    error = Some(crate::errors::APP_BUTTON_VARIANT_VERSION_LOW(pointer, BUTTON_VARIANT_ICON_BLOCK_SET_VERSION));
                } else if matches!(icon, Some(Binding::Literal(value)) if value.as_str().is_some_and(|name| NEW_ICONS.contains(&name))) {
                    error = Some(crate::errors::APP_BUTTON_ICON_VERSION_LOW(pointer, BUTTON_VARIANT_ICON_BLOCK_SET_VERSION));
                }
            }
            Block::ButtonGrid { buttons: Binding::Literal(value), .. } => {
                let has_new_icon = |item: &serde_json::Value| item.get("icon").and_then(serde_json::Value::as_str).is_some_and(|name| NEW_ICONS.contains(&name));
                if value.as_array().map_or_else(|| has_new_icon(value), |items| items.iter().any(has_new_icon)) {
                    error = Some(crate::errors::APP_BUTTON_GRID_ICON_VERSION_LOW(pointer, BUTTON_VARIANT_ICON_BLOCK_SET_VERSION));
                }
            }
            _ => {}
        }
    });
    error.map_or(Ok(()), Err)
}
