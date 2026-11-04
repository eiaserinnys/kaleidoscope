use crate::{
    data::{self, Binding},
    AppDefinition, Block, CoreError, InputKind, BUTTON_DESCRIPTION_BLOCK_SET_VERSION,
    INPUT_OPTIONS_BLOCK_SET_VERSION, INPUT_SPIN_BLOCK_SET_VERSION,
};
use serde_json::Value;

fn has_description(value: &Value) -> bool {
    match value {
        Value::Array(values) => values.iter().any(has_description),
        Value::Object(object) => {
            object.contains_key("description") || object.get("options").is_some_and(has_description)
        }
        _ => false,
    }
}

fn short_value(value: &Value) -> String {
    value.to_string().chars().take(120).collect()
}

fn validate_options(at: &str, value: &Value) -> Option<CoreError> {
    let Some(entries) = value.as_array() else {
        return Some(crate::errors::APP_INPUT_OPTIONS_ARRAY_INVALID(
            at,
            short_value(value),
        ));
    };
    for (index, entry) in entries.iter().enumerate() {
        if entry.is_string() {
            continue;
        }
        let Some(object) = entry.as_object() else {
            return Some(crate::errors::APP_INPUT_OPTIONS_ITEM_INVALID(
                at,
                index + 1,
                short_value(entry),
            ));
        };
        for key in ["value", "label", "description"] {
            match object.get(key) {
                None if key == "description" => {}
                None => {
                    return Some(crate::errors::APP_INPUT_OPTIONS_KEY_MISSING(
                        at,
                        index + 1,
                        key,
                    ))
                }
                Some(value) if !value.is_string() => {
                    return Some(crate::errors::APP_INPUT_OPTIONS_KEY_NOT_STRING(
                        at,
                        index + 1,
                        key,
                        short_value(value),
                    ))
                }
                _ => {}
            }
        }
    }
    None
}

pub(crate) fn validate_input_extensions(definition: &AppDefinition) -> Result<(), CoreError> {
    let mut error = None;
    data::walk_definition_blocks(definition, &mut |pointer, block| {
        if error.is_some() {
            return;
        }
        let required = INPUT_OPTIONS_BLOCK_SET_VERSION;
        error = match block {
            Block::Button {
                description: Some(_),
                ..
            } if definition.requires.blocks < BUTTON_DESCRIPTION_BLOCK_SET_VERSION => {
                Some(crate::errors::APP_BUTTON_DESCRIPTION_VERSION_LOW(
                    pointer,
                    BUTTON_DESCRIPTION_BLOCK_SET_VERSION,
                    BUTTON_DESCRIPTION_BLOCK_SET_VERSION,
                ))
            }
            Block::Input {
                spin,
                options,
                options_only,
                kind,
                multiline,
                rows,
                ..
            } => {
                if spin.is_some() && definition.requires.blocks < INPUT_SPIN_BLOCK_SET_VERSION {
                    Some(crate::errors::APP_INPUT_SPIN_VERSION_LOW(
                        pointer,
                        INPUT_SPIN_BLOCK_SET_VERSION,
                        INPUT_SPIN_BLOCK_SET_VERSION,
                    ))
                } else if spin.is_some() && !matches!(kind, InputKind::Number) {
                    Some(crate::errors::APP_INPUT_SPIN_KIND_INVALID(pointer))
                } else if (options.is_some() || options_only.is_some())
                    && definition.requires.blocks < required
                {
                    Some(crate::errors::APP_INPUT_OPTIONS_VERSION_LOW(
                        pointer, required, required,
                    ))
                } else if options_only.is_some() && options.is_none() {
                    Some(crate::errors::APP_INPUT_OPTIONS_ONLY_WITHOUT_OPTIONS(
                        pointer,
                    ))
                } else if options.is_some() && !matches!(kind, InputKind::Text | InputKind::Search)
                {
                    Some(crate::errors::APP_INPUT_OPTIONS_KIND_INVALID(pointer))
                } else if options.is_some() && (*multiline || rows.is_some_and(|rows| rows > 1)) {
                    Some(crate::errors::APP_INPUT_OPTIONS_MULTILINE_INVALID(pointer))
                } else if let Some(Binding::Literal(value)) = options {
                    validate_options(pointer, value)
                } else {
                    None
                }
            }
            Block::Select {
                options: Binding::Literal(value),
                ..
            } if definition.requires.blocks < required && has_description(value) => Some(
                crate::errors::APP_SELECT_DESCRIPTION_VERSION_LOW(pointer, required, required),
            ),
            _ => None,
        };
    });
    error.map_or(Ok(()), Err)
}
