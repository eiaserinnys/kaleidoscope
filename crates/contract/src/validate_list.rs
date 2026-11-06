use crate::{data::{self, Binding}, AppDefinition, Block, CoreError, ListLayout, ListSelection, LIST_ICON_WIDTH_BLOCK_SET_VERSION, LIST_MULTIPLE_BLOCK_SET_VERSION};
use serde_json::Value;

pub(crate) fn validate_list_extensions(definition: &AppDefinition) -> Result<(), CoreError> {
    let mut error = None;
    data::walk_definition_blocks(definition, &mut |pointer, block| {
        if error.is_some() { return; }
        let Block::List { items, grouped, layout, item_width, selection, selected, on_select, on_activate, .. } = block else { return; };
        if *selection == ListSelection::Multiple {
            if definition.requires.blocks < LIST_MULTIPLE_BLOCK_SET_VERSION {
                error = Some(crate::errors::APP_LIST_MULTIPLE_VERSION_LOW(pointer, LIST_MULTIPLE_BLOCK_SET_VERSION));
                return;
            }
            if !matches!(selected, Some(Binding::State(state)) if definition.state.contains_key(&state.state)) || on_select.is_none() {
                error = Some(crate::errors::APP_LIST_MULTIPLE_SELECTED_INVALID(pointer));
                return;
            }
        }
        if on_activate.is_some() && definition.requires.blocks < LIST_MULTIPLE_BLOCK_SET_VERSION {
            error = Some(crate::errors::APP_LIST_ACTIVATE_VERSION_LOW(pointer, LIST_MULTIPLE_BLOCK_SET_VERSION));
            return;
        }
        if item_width.is_some() {
            if *layout != ListLayout::Grid {
                error = Some(crate::errors::APP_LIST_ITEM_WIDTH_LAYOUT_INVALID(pointer));
                return;
            }
            if definition.requires.blocks < LIST_ICON_WIDTH_BLOCK_SET_VERSION {
                error = Some(crate::errors::APP_LIST_ITEM_WIDTH_VERSION_LOW(pointer, LIST_ICON_WIDTH_BLOCK_SET_VERSION));
                return;
            }
        }
        let Binding::Literal(value) = items else { return; };
        let mut check_item = |item: &Value| {
            if item.get("selectable").is_some() && definition.requires.blocks < LIST_MULTIPLE_BLOCK_SET_VERSION {
                error = Some(crate::errors::APP_LIST_ACTIVATE_VERSION_LOW(pointer, LIST_MULTIPLE_BLOCK_SET_VERSION));
                return;
            }
            let Some(icon) = item.get("icon") else { return; };
            if error.is_some() { return; }
            if definition.requires.blocks < LIST_ICON_WIDTH_BLOCK_SET_VERSION {
                error = Some(crate::errors::APP_LIST_ICON_VERSION_LOW(pointer, LIST_ICON_WIDTH_BLOCK_SET_VERSION));
            } else if icon.as_str().is_none_or(|name| !data::ICON_NAMES.contains(&name)) {
                error = Some(crate::errors::APP_LIST_ICON_NAME_INVALID(pointer, icon));
            }
        };
        let each = |value: &Value, callback: &mut dyn FnMut(&Value)| {
            if let Some(values) = value.as_array() { values.iter().for_each(callback); }
            else { callback(value); }
        };
        if *grouped {
            each(value, &mut |group| {
                if let Some(items) = group.get("items") { each(items, &mut check_item); }
            });
        } else {
            each(value, &mut check_item);
        }
    });
    error.map_or(Ok(()), Err)
}
