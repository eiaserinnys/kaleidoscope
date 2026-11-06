use crate::{data, AppDefinition, Block, CoreError, BUTTON_VARIANT_ICON_BLOCK_SET_VERSION};
use data::Binding;

const NEW_ICONS: &[&str] = &["film", "sticker", "image-play"];
const LIST_ICONS: &[&str] = &["scaling", "rotate-cw-square", "crop", "grid-2x2", "shrink", "package", "image-down", "file-output", "arrow-right-left", "pipette", "paint-bucket", "blend", "stamp", "scan-text", "qr-code"];

pub(crate) fn validate_button_extensions(definition: &AppDefinition) -> Result<(), CoreError> {
    let mut row_error = None;
    data::walk_definition_blocks(definition, &mut |pointer, block| {
        if row_error.is_some() { return; }
        if let Block::Button { variant: Binding::Literal(value), icon_only, preview, .. } = block {
            if value.as_str() == Some("row") {
                row_error = if definition.requires.blocks < crate::ROW_WINDOW_SIZE_BLOCK_SET_VERSION {
                    Some(crate::errors::APP_BUTTON_ROW_VERSION_LOW(pointer, crate::ROW_WINDOW_SIZE_BLOCK_SET_VERSION))
                } else if *icon_only {
                    Some(crate::errors::APP_BUTTON_ROW_ICON_ONLY(pointer))
                } else if preview.is_some() {
                    Some(crate::errors::APP_BUTTON_ROW_PREVIEW(pointer))
                } else { None };
            }
        }
    });
    if let Some(error) = row_error { return Err(error); }
    let mut error = None;
    data::walk_definition_blocks(definition, &mut |pointer, block| {
        if error.is_some() { return; }
        match block {
            Block::Button { variant, icon, .. } => {
                if definition.requires.blocks < BUTTON_VARIANT_ICON_BLOCK_SET_VERSION && !matches!(variant, Binding::Literal(_)) {
                    error = Some(crate::errors::APP_BUTTON_VARIANT_VERSION_LOW(pointer, BUTTON_VARIANT_ICON_BLOCK_SET_VERSION));
                } else if let Some(Binding::Literal(value)) = icon {
                    if let Some(name) = value.as_str() {
                        let version = if LIST_ICONS.contains(&name) { crate::LIST_ICON_WIDTH_BLOCK_SET_VERSION }
                            else if NEW_ICONS.contains(&name) { BUTTON_VARIANT_ICON_BLOCK_SET_VERSION }
                            else if data::EXTENDED_ICONS.contains(&name) { crate::EXTENDED_ICON_BLOCK_SET_VERSION } else { 0 };
                        if definition.requires.blocks < version {
                            error = Some(crate::errors::APP_BUTTON_ICON_VERSION_LOW(pointer, version));
                        }
                    }
                }
            }
            Block::ButtonGrid { buttons: Binding::Literal(value), .. } => {
                let version = |item: &serde_json::Value| match item.get("icon").and_then(serde_json::Value::as_str) {
                    Some(name) if LIST_ICONS.contains(&name) => crate::LIST_ICON_WIDTH_BLOCK_SET_VERSION,
                    Some(name) if NEW_ICONS.contains(&name) => BUTTON_VARIANT_ICON_BLOCK_SET_VERSION,
                    Some(name) if data::EXTENDED_ICONS.contains(&name) => crate::EXTENDED_ICON_BLOCK_SET_VERSION,
                    _ => 0,
                };
                let required = value.as_array().map_or_else(|| version(value), |items| items.iter().map(version).max().unwrap_or(0));
                if definition.requires.blocks < required {
                    error = Some(crate::errors::APP_BUTTON_GRID_ICON_VERSION_LOW(pointer, required));
                }
            }
            _ => {}
        }
    });
    error.map_or(Ok(()), Err)
}
