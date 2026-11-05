//! 앱 정의 검사. 쉘의 코어와 오케스트레이터가 이 한 곳의 검사를 같이 쓴다.
//! 규칙은 [`AppDefinition`]의 doc 주석에 있다.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::Value;

use crate::app_storage::{self, StorageKind};
use crate::data::{self, Action, Actions, Binding, MessageKey, SourceDecl};
use crate::{
    AgentProvider, AppDefinition, Block, CoreError, FileAccess, FileRef, FilesScope, FolderRoot,
    PathValue, PermissionDecl, UrlValue,
};

/// 앱 정의 JSON 원문을 읽고 검사한다. 통과하면 정의를, 걸리면 `unsupported_app`이나
/// `invalid_app_definition`(걸린 것은 `details`)을 돌려준다.
pub fn parse_app_definition(definition_json: &str) -> Result<AppDefinition, CoreError> {
    parse_definition(definition_json, false, &crate::Supported::current())
}

/// 이미 등록된 옛 앱은 제공자가 없어도 표시할 수 있다.
pub fn parse_cached_app_definition(definition_json: &str) -> Result<AppDefinition, CoreError> {
    parse_definition(definition_json, true, &crate::Supported::current())
}

/// 지정한 쉘 지원 범위에서 앱 정의를 검사한다.
pub fn parse_app_definition_with_supported(definition_json: &str, supported: &crate::Supported) -> Result<AppDefinition, CoreError> {
    parse_definition(definition_json, false, supported)
}

fn parse_definition(definition_json: &str, cached: bool, supported: &crate::Supported) -> Result<AppDefinition, CoreError> {
    let value: Value = serde_json::from_str(definition_json)
        .map_err(|parse_error| crate::errors::APP_DEFINITION_JSON_INVALID(&parse_error))?;

    if let Some(error) = removed_local_agent_error(&value) {
        return Err(error);
    }

    if requires_unsupported(&value, supported) {
        return Err(crate::errors::APP_DEFINITION_REQUIRES_NEWER_SHELL());
    }

    if let Some(sources) = value.get("sources").and_then(Value::as_object) {
        for (name, source) in sources {
            if source.get("kind").and_then(Value::as_str) == Some("store")
                && source.get("store").and_then(Value::as_str) == Some("app")
                && source.get("id").is_none()
            {
                return Err(crate::errors::APP_STORE_SOURCE_ID_MISSING(name));
            }
        }
    }

    let uses_new_definition_fields = uses_versioned_block_fields(&value)
        || value.get("state_migrate").is_some()
        || value
            .get("opens")
            .and_then(Value::as_object)
            .is_some_and(|opens| opens.contains_key("set_state"));
    let uses_new_chat_client_fields = uses_block_set_18_chat_fields(&value);
    let uses_block_set_19_definition_fields = uses_block_set_19_definition_fields(&value);
    let uses_message_item_key = value.get("ui").is_some_and(uses_message_item_key);
    let uses_device_storage_scope = value.pointer("/client/device_storage/scope").is_some();
    let uses_new_dialog_footer_fields = value.get("ui").is_some_and(uses_dialog_footer_fields);
    let uses_new_block_set_19_fields = value.get("ui").is_some_and(uses_block_set_19_fields)
        || value
            .pointer("/settings/ui")
            .is_some_and(uses_block_set_19_fields);
    let uses_new_block_set_20_fields = value.get("ui").is_some_and(uses_block_set_20_fields)
        || value
            .pointer("/settings/ui")
            .is_some_and(uses_block_set_20_fields);
    let uses_block_set_21 = value.get("ui").is_some_and(uses_block_set_21_fields)
        || value
            .pointer("/settings/ui")
            .is_some_and(uses_block_set_21_fields);
    let definition: AppDefinition = serde_json::from_value(value)
        .map_err(|parse_error| crate::errors::APP_DEFINITION_FORMAT_INVALID(&parse_error))?;
    crate::validate_input::validate_input_extensions(&definition)?;
    crate::validate_button::validate_button_extensions(&definition)?;

    if let Some(badge) = &definition.badge {
        if definition.requires.blocks < crate::APP_BADGE_BLOCK_SET_VERSION {
            return Err(crate::errors::APP_BADGE_VERSION_LOW(crate::APP_BADGE_BLOCK_SET_VERSION, crate::APP_BADGE_BLOCK_SET_VERSION));
        }
        if let crate::AppBadge::Expr(expr) = badge {
            use jsonata_core::parser::{Lexer, Token};
            let mut lexer = Lexer::new(expr.expr.clone());
            loop {
                match lexer.next_token() {
                    Ok(Token::Variable(name)) if matches!(name.as_str(), "state" | "data" | "data_meta" | "storage" | "storage_meta" | "client" | "item" | "parent_item" | "event" | "modifiers") => {
                        return Err(crate::errors::APP_BADGE_VARIABLE_FORBIDDEN(format!("${name}")));
                    }
                    Ok(Token::Eof) | Err(_) => break,
                    _ => {}
                }
            }
        }
    }

    let mut stack_fill_error = None;
    data::walk_definition_blocks(&definition, &mut |pointer, block| {
        if stack_fill_error.is_some() { return; }
        if let Block::Stack { fill: Some(crate::StackFill::Indices(indices)), children, .. } = block {
            let version = crate::STACK_FILL_LIST_BLOCK_SET_VERSION;
            let mut seen = HashSet::new();
            stack_fill_error = if definition.requires.blocks < version {
                Some(crate::errors::APP_STACK_FILL_VERSION_LOW(pointer, version))
            } else if indices.is_empty() {
                Some(crate::errors::APP_STACK_FILL_EMPTY(pointer))
            } else if let Some(index) = indices.iter().find(|index| **index as usize >= children.len()) {
                Some(crate::errors::APP_STACK_FILL_INDEX_OUT_OF_RANGE(pointer, index, children.len()))
            } else if let Some(index) = indices.iter().find(|index| !seen.insert(**index)) {
                Some(crate::errors::APP_STACK_FILL_DUPLICATE(pointer, index))
            } else { None };
        }
    });
    if let Some(error) = stack_fill_error { return Err(error); }

    validate_store_contract(&definition)?;

    if definition.client.as_ref().and_then(|client| client.capabilities.as_ref())
        .is_some_and(|capabilities| capabilities.contains(&crate::client::ClientCapability::ReceiveMessage))
        && (definition.requires.blocks < crate::RECEIVE_MESSAGE_BLOCK_SET_VERSION
            || definition.requires.modules.get("client").copied().unwrap_or(0) < crate::RECEIVE_MESSAGE_CLIENT_VERSION)
    {
        return Err(crate::errors::APP_RECEIVE_MESSAGE_REQUIRES_VERSION(
            crate::RECEIVE_MESSAGE_BLOCK_SET_VERSION,
            crate::RECEIVE_MESSAGE_CLIENT_VERSION,
        ));
    }

    if definition.requires.blocks < crate::LIST_REMOVE_OPEN_URL_BLOCK_SET_VERSION {
        let mut remove_pointer = None;
        data::walk_definition_blocks(&definition, &mut |pointer, block| {
            if matches!(block, Block::List { on_remove: Some(_), .. }) {
                remove_pointer = Some(pointer.to_owned());
            }
        });
        if let Some(pointer) = remove_pointer {
            return Err(crate::errors::APP_LIST_ON_REMOVE_VERSION_REQUIRED(&pointer, crate::LIST_REMOVE_OPEN_URL_BLOCK_SET_VERSION));
        }
        if let Some((pointer, _)) = data::all_ui_actions(&definition).into_iter().find(|(_, action)| matches!(action, Actions::OpenUrl(_))) {
            return Err(crate::errors::APP_OPEN_URL_VERSION_REQUIRED(&pointer, crate::LIST_REMOVE_OPEN_URL_BLOCK_SET_VERSION));
        }
        if let Some((index, _)) = definition.shortcuts.iter().flatten().enumerate().find(|(_, shortcut)| matches!(shortcut.action, Actions::OpenUrl(_))) {
            return Err(crate::errors::APP_OPEN_URL_VERSION_REQUIRED(&format!("/shortcuts/{index}/action"), crate::LIST_REMOVE_OPEN_URL_BLOCK_SET_VERSION));
        }
    }

    if let Some(icon) = &definition.icon {
        if icon.version == 0 {
            return Err(crate::errors::APP_ICON_VERSION_INVALID(
                &definition.id,
                &icon.asset,
                icon.version,
            ));
        }
        match definition
            .assets
            .iter()
            .find(|asset| asset.id == icon.asset)
        {
            None => {
                return Err(crate::errors::APP_ICON_ASSET_UNDECLARED(
                    &definition.id,
                    &icon.asset,
                    icon.version,
                ))
            }
            Some(asset) if asset.version != icon.version => {
                return Err(crate::errors::APP_ICON_VERSION_MISMATCH(
                    &definition.id,
                    &icon.asset,
                    icon.version,
                    asset.version,
                ))
            }
            Some(_) => {}
        }
        if definition.requires.blocks < crate::APP_ICON_BLOCK_SET_VERSION {
            return Err(crate::errors::APP_ICON_BLOCK_SET_REQUIRED(
                &definition.id,
                &icon.asset,
                icon.version,
                crate::APP_ICON_BLOCK_SET_VERSION,
            ));
        }
    }

    let mut layout_error = None;
    data::walk_definition_blocks(&definition, &mut |pointer, block| {
        if layout_error.is_some() {
            return;
        }
        let version = crate::LAYOUT_FIELDS_BLOCK_SET_VERSION;
        layout_error = match block {
            Block::Split {
                column_below: Some(width),
                ..
            } if *width == 0 => Some(crate::errors::APP_SPLIT_COLUMN_BELOW_ZERO(pointer)),
            Block::Split {
                direction,
                column_below: Some(_),
                ..
            } if *direction != crate::SplitDirection::Row => Some(
                crate::errors::APP_SPLIT_COLUMN_BELOW_DIRECTION_INVALID(pointer),
            ),
            Block::Split {
                column_below: Some(_),
                ..
            } if definition.requires.blocks < version => Some(
                crate::errors::APP_SPLIT_COLUMN_BELOW_VERSION_REQUIRED(pointer, version),
            ),
            Block::Repeat { gap: Some(_), .. } if definition.requires.blocks < version => Some(
                crate::errors::APP_REPEAT_GAP_VERSION_REQUIRED(pointer, version),
            ),
            _ => None,
        };
    });
    if let Some(error) = layout_error {
        return Err(error);
    }

    let mut fixed_grid_item_width = None;
    data::walk_definition_blocks(&definition, &mut |pointer, block| {
        if let Block::Repeat {
            grid:
                Some(crate::RepeatGrid {
                    columns: crate::RepeatColumns::Count(_),
                    item_width: Some(_),
                }),
            ..
        } = block
        {
            fixed_grid_item_width = Some(pointer.to_owned());
        }
    });
    if let Some(pointer) = fixed_grid_item_width {
        return Err(crate::errors::APP_REPEAT_GRID_ITEM_WIDTH_FIXED_COLUMNS(
            pointer,
        ));
    }

    let mut timeline_error = None;
    data::walk_definition_blocks(&definition, &mut |pointer, block| {
        if timeline_error.is_none() {
            timeline_error = validate_timeline_contract(pointer, block, definition.requires.blocks);
        }
    });
    if let Some(error) = timeline_error {
        return Err(error);
    }

    let validation = validate(&definition);
    let missing_when_condition = validation.missing_when_condition;
    let missing_webhook_token_secret = validation.missing_webhook_token_secret;
    let mut details = validation.details;
    if uses_new_definition_fields && definition.requires.blocks < 15 {
        details.push(
            "tabs.header, tabs.keep_mounted, tabs.collapsible, folder.header, state_migrate와 opens.set_state는 블록 세트 15판이라 requires.blocks가 15 이상이어야 합니다"
                .into(),
        );
    }
    if uses_block_set_16_bindings(&definition) && definition.requires.blocks < 16 {
        details.push(
            "탭·입력 블록 라벨, dialog.close_label, dialog.cancel_label, tour.labels의 바인딩은 블록 세트 16판이라 requires.blocks가 16 이상이어야 합니다".into(),
        );
    }
    if uses_new_chat_client_fields && definition.requires.blocks < 18 {
        details.push("client.channels, chat.client와 chat.footer는 블록 세트 18판이라 requires.blocks가 18 이상이어야 합니다".into());
    }
    if uses_block_set_19_definition_fields && definition.requires.blocks < 19 {
        details.push(
            "settings와 window_title은 블록 세트 19판이라 requires.blocks가 19 이상이어야 합니다"
                .into(),
        );
    }
    if uses_message_item_key && definition.requires.blocks < 19 {
        details.push(
            "message.item은 블록 세트 19판이라 requires.blocks가 19 이상이어야 합니다".into(),
        );
    }
    if uses_block_set_18_ui_fields(&definition.ui) && definition.requires.blocks < 18 {
        details.push(
            "stack.place, select.disabled, toggle.disabled와 notice는 블록 세트 18판이라 requires.blocks가 18 이상이어야 합니다".into(),
        );
    }
    if uses_device_storage_scope && definition.requires.blocks < 18 {
        details.push("client.device_storage.scope는 블록 세트 18판이라 requires.blocks가 18 이상이어야 합니다".into());
    }
    if uses_new_dialog_footer_fields && definition.requires.blocks < 19 {
        details.push("dialog.on_confirm과 dialog.danger는 블록 세트 19판이라 requires.blocks가 19 이상이어야 합니다".into());
    }
    if uses_new_block_set_19_fields && definition.requires.blocks < 19 {
        details.push("stack.align, input.columns, button.preview, button.prefix, 동적 PropertyField.label, format swatches, properties.layout, canvas.loading, when.min_width, when.max_width는 블록 세트 19판이라 requires.blocks가 19 이상이어야 합니다".into());
    }
    if uses_new_block_set_20_fields && definition.requires.blocks < 20 {
        details.push("repeat.grid.item_width와 item_menu는 블록 세트 20판이라 requires.blocks가 20 이상이어야 합니다".into());
    }
    if uses_block_set_21 && definition.requires.blocks < 21 {
        details.push("input, select, slider, color의 label_position과 slider.show_value는 블록 세트 21판이 필요합니다".into());
    }
    if uses_device_storage_scope {
        validate_module_version(
            "client",
            4,
            &definition,
            &mut details,
            "/client/device_storage/scope",
        );
    }
    if !cached && definition.agent.is_none() {
        data::walk_definition_blocks(&definition, &mut |pointer, block| {
            if matches!(block, Block::Chat { .. }) && !block.is_client_chat() {
                details.push(format!("{pointer}: chat에는 대화 제공자가 필요합니다"));
            }
        });
    }
    if details.is_empty() {
        Ok(definition)
    } else if missing_webhook_token_secret {
        Err(crate::errors::APP_DEFINITION_WEBHOOK_TOKEN_SECRET_REQUIRED().and_details(details))
    } else if missing_when_condition {
        Err(crate::errors::APP_DEFINITION_WHEN_CONDITION_MISSING().and_details(details))
    } else {
        Err(crate::errors::APP_DEFINITION_CHECK_FAILED().and_details(details))
    }
}

/// 스토어를 쓰는 자리의 선언을 원인별 오류로 돌려준다.
fn validate_store_contract(definition: &AppDefinition) -> Result<(), CoreError> {
    let sources: Vec<_> = definition.sources.iter()
        .filter(|(_, source)| matches!(source, SourceDecl::Store(_)))
        .collect();
    let mut actions = Vec::new();
    for (pointer, group) in data::ui_actions(definition) {
        if let Actions::Many(list) = group {
            for (index, action) in list.iter().enumerate() {
                if matches!(action, Action::StoreInstall(_) | Action::StoreRemove(_)) {
                    actions.push((format!("{pointer}/{index}"), action));
                }
            }
        }
    }
    if (!sources.is_empty() || !actions.is_empty()
        || definition.permissions.iter().any(|p| matches!(p, PermissionDecl::Store { .. })))
        && definition.requires.modules.get("store").copied().unwrap_or(0) < 1
    {
        return Err(crate::errors::APP_STORE_MODULE_REQUIRED(&definition.id));
    }
    let check_permission = |location: &str, id: &str| -> Result<(), CoreError> {
        match find_permission(definition, id) {
            None => Err(crate::errors::APP_STORE_PERMISSION_UNDECLARED(location, id)),
            Some(permission) if !matches!(permission, PermissionDecl::Store { .. }) => Err(
                crate::errors::APP_STORE_PERMISSION_MISMATCH(location, id, permission.module()),
            ),
            Some(_) => Ok(()),
        }
    };
    for (name, source) in sources {
        check_permission(&format!("/sources/{}", data::escape_pointer(name)), source.permission())?;
    }
    for (location, action) in actions {
        match action {
            Action::StoreInstall(action) => {
                let spec = &action.store_install;
                check_permission(&location, &spec.permission)?;
                if let Binding::Literal(value) = &spec.release {
                    if !value.as_u64().is_some_and(|number| number > 0) {
                        return Err(crate::errors::APP_STORE_RELEASE_INVALID(
                            format!("{location}/store.install/release"), value,
                        ));
                    }
                }
            }
            Action::StoreRemove(action) => check_permission(&location, &action.store_remove.permission)?,
            _ => unreachable!(),
        }
    }
    Ok(())
}

fn valid_calendar_date(value: &Value) -> bool {
    let Some(text) = value.as_str() else { return false };
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-'
        || bytes.iter().enumerate().any(|(i, b)| i != 4 && i != 7 && !b.is_ascii_digit())
    {
        return false;
    }
    let year: u32 = text[..4].parse().unwrap_or(0);
    let month: u32 = text[5..7].parse().unwrap_or(0);
    let day: u32 = text[8..].parse().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    year > 0 && day > 0 && day <= days
}

fn display_optional<T: serde::Serialize>(value: &Option<T>) -> Option<String> {
    value.as_ref().map(|value| serde_json::to_string(value).expect("시간축 필드 직렬화"))
}

fn validate_timeline_contract(path: &str, block: &Block, version: u32) -> Option<CoreError> {
    use crate::{TimelineLanes, TimelineScale};
    let Block::Timeline {
        scale, lanes, today, off_days, duration, position, tracks, markers, ticks, snap,
        on_seek, viewport, ..
    } = block else { return None };
    let dates = matches!(scale, Some(TimelineScale::Dates));
    let literal_tracks = match tracks { Binding::Literal(value) => value.as_array(), _ => None };
    let new_track_fields = literal_tracks.is_some_and(|tracks| tracks.iter().any(|track| {
        track.get("meta").is_some() || track.get("image").is_some()
            || track.get("items").and_then(Value::as_array).is_some_and(|items| items.iter().any(|item| item.get("muted").is_some()))
    }));
    if version < crate::TIMELINE_DATES_BLOCK_SET_VERSION
        && (scale.is_some() || lanes.is_some() || today.is_some() || off_days.is_some() || new_track_fields)
    {
        return Some(crate::errors::APP_TIMELINE_VERSION_REQUIRED(path, version, crate::TIMELINE_DATES_BLOCK_SET_VERSION));
    }
    if dates {
        for (field, value) in [
            ("duration", display_optional(duration)), ("position", display_optional(position)), ("on_seek", display_optional(on_seek)),
            ("ticks", display_optional(ticks)), ("snap", display_optional(snap)),
        ] {
            if let Some(value) = value {
                return Some(crate::errors::APP_TIMELINE_DATES_FIELD_FORBIDDEN(path, field, value));
            }
        }
    } else {
        for (field, present) in [("duration", duration.is_some()), ("position", position.is_some())] {
            if !present { return Some(crate::errors::APP_TIMELINE_FIELD_REQUIRED(path, field)); }
        }
        for (field, value) in [
            ("today", display_optional(today)), ("off_days", display_optional(off_days)),
            ("lanes", lanes.filter(|value| *value != TimelineLanes::Single).map(|value| format!("{value:?}"))),
        ] {
            if let Some(value) = value {
                return Some(crate::errors::APP_TIMELINE_SECONDS_FIELD_FORBIDDEN(path, field, value));
            }
        }
    }
    if let Some(tracks) = literal_tracks {
        for track in tracks {
            if dates && track.get("waveform").is_some_and(|v| !v.is_null()) {
                return Some(crate::errors::APP_TIMELINE_DATES_FIELD_FORBIDDEN(path, "waveform", track["waveform"].to_string()));
            }
            if let Some(items) = track.get("items").and_then(Value::as_array) {
                for item in items {
                    let id = item.get("id").and_then(Value::as_str).unwrap_or("");
                    let start = item.get("start").filter(|value| !value.is_null());
                    let end = item.get("end").filter(|value| !value.is_null());
                    if dates {
                        if start.is_some() != end.is_some() {
                            return Some(crate::errors::APP_TIMELINE_ITEM_DATE_PAIR_INCOMPLETE(path, id, if start.is_none() { "start" } else { "end" }));
                        }
                        for (field, value) in [("start", start), ("end", end)] {
                            if let Some(value) = value {
                                if !valid_calendar_date(value) {
                                    return Some(crate::errors::APP_TIMELINE_ITEM_DATE_INVALID(path, field, value));
                                }
                            }
                        }
                        if let (Some(start), Some(end)) = (start, end) {
                            if start.as_str() > end.as_str() {
                                return Some(crate::errors::APP_TIMELINE_ITEM_DATE_REVERSED(path, id, start, end));
                            }
                        }
                    } else if start.and_then(Value::as_f64).is_none() || end.and_then(Value::as_f64).is_none() {
                        return Some(crate::errors::APP_TIMELINE_ITEM_SECONDS_INVALID(path, id, start.unwrap_or(&Value::Null), end.unwrap_or(&Value::Null)));
                    }
                }
            }
        }
    }
    if let Some(Binding::Literal(value)) = markers {
        if let Some(markers) = value.as_array() {
            for marker in markers {
                let time = marker.get("time").unwrap_or(&Value::Null);
                if dates && !valid_calendar_date(time) {
                    return Some(crate::errors::APP_TIMELINE_MARKER_DATE_INVALID(path, time));
                }
                if !dates && time.as_f64().is_none() {
                    return Some(crate::errors::APP_TIMELINE_MARKER_SECONDS_INVALID(path, time));
                }
            }
        }
    }
    if dates {
        if let Some(Binding::Literal(value)) = off_days {
            match value.as_array() {
                Some(days) => for day in days {
                    if !valid_calendar_date(day) { return Some(crate::errors::APP_TIMELINE_OFF_DAY_INVALID(path, day)); }
                },
                None => return Some(crate::errors::APP_TIMELINE_OFF_DAY_INVALID(path, value)),
            }
        }
        if let Some(Binding::Literal(value)) = viewport {
            for field in ["start", "end"] {
                let date = value.get(field).unwrap_or(&Value::Null);
                if !valid_calendar_date(date) {
                    return Some(crate::errors::APP_TIMELINE_VIEWPORT_DATE_INVALID(path, field, date));
                }
            }
            if value["start"].as_str() > value["end"].as_str() {
                return Some(crate::errors::APP_TIMELINE_VIEWPORT_DATE_REVERSED(path, &value["start"], &value["end"]));
            }
        }
    }
    None
}

fn removed_local_agent_error(value: &Value) -> Option<CoreError> {
    if value.pointer("/requires/modules/local_agent").is_some() {
        return Some(crate::errors::APP_DEFINITION_REMOVED_LOCAL_AGENT_MODULE());
    }
    if value
        .get("permissions")
        .and_then(Value::as_array)
        .is_some_and(|permissions| {
            permissions.iter().any(|permission| {
                permission.get("module").and_then(Value::as_str) == Some("local_agent")
            })
        })
    {
        return Some(crate::errors::APP_DEFINITION_REMOVED_LOCAL_AGENT_PERMISSION());
    }
    removed_block_error(value.get("ui")?)
}

fn removed_block_error(value: &Value) -> Option<CoreError> {
    match value {
        Value::Object(object) => {
            match object.get("type").and_then(Value::as_str) {
                Some("agent_session") => {
                    return Some(crate::errors::APP_DEFINITION_REMOVED_AGENT_SESSION_BLOCK());
                }
                Some("chat")
                    if ["permission", "root", "agents", "selected", "on_select"]
                        .iter()
                        .any(|field| object.contains_key(*field)) =>
                {
                    return Some(crate::errors::APP_DEFINITION_REMOVED_CHAT_LOCAL_FIELDS());
                }
                _ => {}
            }
            object
                .iter()
                .filter(|(key, _)| !matches!(key.as_str(), "value" | "items" | "buttons"))
                .find_map(|(_, child)| removed_block_error(child))
        }
        Value::Array(values) => values.iter().find_map(removed_block_error),
        _ => None,
    }
}

/// 권한 id → 그 권한의 모듈 이름. 새 버전으로 옮긴 창의 고른 폴더를 이어 쓸지 가를 때 쓴다.
pub fn permission_modules(definition: &AppDefinition) -> BTreeMap<String, String> {
    definition
        .permissions
        .iter()
        .map(|permission| (permission.id().to_string(), permission.module().to_string()))
        .collect()
}

/// JSONata 식 하나를 읽어 본다. 읽지 못하면 사람이 읽는 까닭을 돌려준다.
pub fn parse_expr(expr: &str) -> Result<(), String> {
    jsonata_core::parser::parse(expr)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn requires_unsupported(value: &Value, supported: &crate::Supported) -> bool {
    let Some(requires) = value.get("requires").and_then(Value::as_object) else {
        return false;
    };
    if requires
        .get("blocks")
        .and_then(Value::as_u64)
        .is_some_and(|blocks| blocks > supported.blocks as u64)
    {
        return true;
    }
    let Some(modules) = requires.get("modules").and_then(Value::as_object) else {
        return false;
    };
    modules.iter().any(|(name, version)| {
        let Some(supported_version) = supported.modules.get(name)
        else {
            return true;
        };
        version
            .as_u64()
            .is_some_and(|required| required > *supported_version as u64)
    })
}

fn uses_versioned_block_fields(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            let uses_field = match object.get("type").and_then(Value::as_str) {
                Some("tabs") => {
                    object.contains_key("header")
                        || object.contains_key("keep_mounted")
                        || object.contains_key("collapsible")
                }
                Some("folder") => object.contains_key("header"),
                _ => false,
            };
            uses_field || object.values().any(uses_versioned_block_fields)
        }
        Value::Array(values) => values.iter().any(uses_versioned_block_fields),
        _ => false,
    }
}

fn uses_block_set_18_chat_fields(value: &Value) -> bool {
    let client_channels = value
        .get("client")
        .and_then(Value::as_object)
        .is_some_and(|client| client.contains_key("channels"));
    client_channels || value.get("ui").is_some_and(uses_chat_client_fields)
}

fn uses_block_set_19_definition_fields(value: &Value) -> bool {
    value.get("settings").is_some() || value.get("window_title").is_some()
}

fn uses_chat_client_fields(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            (object.get("type").and_then(Value::as_str) == Some("chat")
                && (object.contains_key("client") || object.contains_key("footer")))
                || object.values().any(uses_chat_client_fields)
        }
        Value::Array(values) => values.iter().any(uses_chat_client_fields),
        _ => false,
    }
}

fn uses_block_set_16_bindings(definition: &AppDefinition) -> bool {
    let mut uses_new_binding = false;
    data::walk_definition_blocks(definition, &mut |_, block| {
        let needs_block_set_16 =
            |binding: &Binding| !matches!(binding, Binding::Literal(Value::String(_)));
        uses_new_binding |= match block {
            Block::Tabs { tabs, .. } => tabs.iter().any(|tab| needs_block_set_16(&tab.label)),
            Block::Toggle { label, .. } => needs_block_set_16(label),
            Block::Slider { label, .. } | Block::Color { label, .. } => {
                label.as_ref().is_some_and(needs_block_set_16)
            }
            Block::Input {
                label, placeholder, ..
            }
            | Block::Select {
                label, placeholder, ..
            } => {
                label.as_ref().is_some_and(needs_block_set_16)
                    || placeholder.as_ref().is_some_and(needs_block_set_16)
            }
            Block::Dialog {
                close_label,
                cancel_label,
                ..
            } => {
                close_label.as_ref().is_some_and(needs_block_set_16)
                    || cancel_label.as_ref().is_some_and(needs_block_set_16)
            }
            Block::Tour { labels, .. } => labels.as_ref().is_some_and(|labels| {
                [&labels.previous, &labels.next, &labels.done, &labels.skip]
                    .into_iter()
                    .flatten()
                    .any(needs_block_set_16)
            }),
            _ => false,
        };
    });
    uses_new_binding
}

fn uses_block_set_18_ui_fields(ui: &Block) -> bool {
    let mut uses_new_field = false;
    data::walk_blocks(ui, "/ui", &mut |_, block| {
        uses_new_field |= match block {
            Block::Stack { place, .. } => place.is_some(),
            Block::Select { disabled, .. } | Block::Toggle { disabled, .. } => disabled.is_some(),
            Block::Notice { .. } => true,
            _ => false,
        };
    });
    uses_new_field
}

fn uses_dialog_footer_fields(ui: &Value) -> bool {
    match ui {
        Value::Object(object) => {
            let is_footer_field = object
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind == "dialog")
                && (object.contains_key("on_confirm") || object.contains_key("danger"));
            is_footer_field || object.values().any(uses_dialog_footer_fields)
        }
        Value::Array(values) => values.iter().any(uses_dialog_footer_fields),
        _ => false,
    }
}

fn uses_block_set_19_fields(ui: &Value) -> bool {
    match ui {
        Value::Object(object) => {
            let uses_field = match object.get("type").and_then(Value::as_str) {
                Some("stack") => object.contains_key("align"),
                Some("input") => object.contains_key("columns"),
                Some("button") => object.contains_key("preview") || object.contains_key("prefix"),
                Some("properties") => {
                    object.contains_key("layout")
                        || object
                            .get("fields")
                            .and_then(Value::as_array)
                            .is_some_and(|fields| {
                                fields.iter().any(|field| {
                                    field.get("label").is_some_and(|label| !label.is_string())
                                        || field.get("format").and_then(Value::as_str)
                                            == Some("swatches")
                                })
                            })
                }
                Some("canvas") => object.contains_key("loading"),
                Some("when") => {
                    object.contains_key("min_width") || object.contains_key("max_width")
                }
                _ => false,
            };
            uses_field || object.values().any(uses_block_set_19_fields)
        }
        Value::Array(values) => values.iter().any(uses_block_set_19_fields),
        _ => false,
    }
}

fn uses_block_set_20_fields(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            (object.get("type").and_then(Value::as_str) == Some("repeat")
                && object
                    .get("grid")
                    .and_then(Value::as_object)
                    .is_some_and(|grid| grid.contains_key("item_width")))
                || (matches!(
                    object.get("type").and_then(Value::as_str),
                    Some("list" | "table" | "tree" | "feed" | "thread")
                ) && object.contains_key("item_menu"))
                || object.values().any(uses_block_set_20_fields)
        }
        Value::Array(values) => values.iter().any(uses_block_set_20_fields),
        _ => false,
    }
}

fn uses_block_set_21_fields(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            (matches!(
                object.get("type").and_then(Value::as_str),
                Some("input" | "select" | "slider" | "color")
            ) && object.contains_key("label_position"))
                || (object.get("type").and_then(Value::as_str) == Some("slider")
                    && object.contains_key("show_value"))
                || object.values().any(uses_block_set_21_fields)
        }
        Value::Array(values) => values.iter().any(uses_block_set_21_fields),
        _ => false,
    }
}

fn uses_message_item_key(ui: &Value) -> bool {
    match ui {
        Value::Object(object) => {
            let item_message = object
                .get("message")
                .and_then(Value::as_object)
                .is_some_and(|message| message.len() == 1 && message.contains_key("item"));
            item_message || object.values().any(uses_message_item_key)
        }
        Value::Array(values) => values.iter().any(uses_message_item_key),
        _ => false,
    }
}

struct ValidationResult {
    details: Vec<String>,
    missing_when_condition: bool,
    missing_webhook_token_secret: bool,
}

fn validate(definition: &AppDefinition) -> ValidationResult {
    let mut details = Vec::new();
    let mut missing_when_condition = false;
    let mut missing_webhook_token_secret = false;
    if !valid_id(&definition.id) {
        details.push(format!("앱 id가 올바르지 않습니다: {}", definition.id));
    }
    if definition.name.trim().is_empty() {
        details.push("앱 이름이 비어 있습니다".into());
    }

    for (key, expression) in &definition.state_migrate {
        validate_state_key(key, definition, &mut details, "state_migrate");
        if let Err(error) = parse_expr(expression) {
            details.push(format!(
                "state_migrate.{key}: JSONata 식을 읽을 수 없습니다: {error}"
            ));
        }
    }

    if !definition.assets.is_empty() {
        validate_module_version("assets", 1, definition, &mut details, "/assets");
        let mut ids = HashSet::new();
        for asset in &definition.assets {
            if !valid_id(&asset.id) || asset.version == 0 || !ids.insert(&asset.id) {
                details.push(format!(
                    "자산 id 또는 판이 올바르지 않거나 중복됩니다: {}",
                    asset.id
                ));
            }
        }
    }

    let mut permission_ids = HashSet::new();
    for permission in &definition.permissions {
        if !valid_id(permission.id())
            && !(matches!(permission, PermissionDecl::Profiler { .. })
                && valid_permission_id(permission.id()))
        {
            details.push(format!("권한 id가 올바르지 않습니다: {}", permission.id()));
        }
        if !permission_ids.insert(permission.id()) {
            details.push(format!("권한 id가 겹칩니다: {}", permission.id()));
        }
        let module = permission.module();
        if !definition.requires.modules.contains_key(module) {
            details.push(format!(
                "권한 {}가 사용하는 {module} 모듈을 requires.modules에 선언해야 합니다",
                permission.id()
            ));
        }
        if let PermissionDecl::Files {
            scope: FilesScope::Pc,
            access,
            ..
        } = permission
        {
            if definition
                .requires
                .modules
                .get("files")
                .copied()
                .unwrap_or(0)
                < 2
            {
                details.push(format!(
                    "권한 {}의 scope는 files 모듈 2판이라 requires.modules.files가 2 이상이어야 합니다",
                    permission.id()
                ));
            }
            if *access != FileAccess::Read {
                details.push(format!(
                    "권한 {}는 scope가 pc라 access가 read여야 합니다",
                    permission.id()
                ));
            }
        }
        if let PermissionDecl::Process { id, command: Some(command), .. } = permission {
            if definition.requires.modules.get("process").copied().unwrap_or(0) < 2 {
                details.push(format!("권한 {id}의 command는 process 모듈 2판이라 requires.modules.process가 2 이상이어야 합니다"));
            }
            if !(1..=260).contains(&command.chars().count()) || command.trim() != command || command.chars().any(char::is_control) {
                details.push(format!("권한 {id}의 command는 앞뒤 공백과 제어 문자 없이 1~260자여야 합니다"));
            }
        }
        if let PermissionDecl::Connection { connection, .. } = permission {
            if !valid_id(connection) {
                details.push(format!(
                    "권한 {}의 연결 이름은 소문자, 숫자, - 1~64자여야 합니다: {connection}",
                    permission.id()
                ));
            }
        }
        if let PermissionDecl::Http {
            base_url, paths, access, ..
        } = permission
        {
            if *access == FileAccess::Readwrite {
                validate_module_version("http", 3, definition, &mut details, &format!("권한 {}", permission.id()));
            }
            if !valid_https_origin(base_url) {
                details.push(format!(
                    "권한 {}의 주소는 공개 HTTPS origin이어야 합니다",
                    permission.id()
                ));
            }
            if paths.is_empty() || paths.iter().any(|path| !valid_public_http_path(path)) {
                details.push(format!(
                    "권한 {}의 경로가 올바르지 않습니다",
                    permission.id()
                ));
            }
        }
    }

    if let Some(opens) = &definition.opens {
        if definition.requires.blocks < 3 {
            details.push("opens는 블록 세트 3판이라 requires.blocks가 3 이상이어야 합니다".into());
        }
        if opens.extensions.is_empty() {
            details.push("opens.extensions에 확장자가 하나 이상 있어야 합니다".into());
        }
        for extension in &opens.extensions {
            if !valid_extension(extension) {
                details.push(format!(
                    "opens.extensions의 확장자는 점 없이 소문자와 숫자 1~16자여야 합니다: {extension}"
                ));
            }
        }
        validate_permission(&opens.permission, definition, &mut details, "opens");
        if find_permission(definition, &opens.permission).is_some_and(is_pc_scope) {
            details.push(format!(
                "opens: 권한 {}는 scope가 pc라 opens에 쓸 수 없습니다(여는 앱은 폴더 하나를 받는다)",
                opens.permission
            ));
        }
        validate_state_key(&opens.state, definition, &mut details, "opens");
        for key in opens.set_state.keys() {
            validate_state_key(key, definition, &mut details, "opens.set_state");
            if key == &opens.state {
                details.push(format!(
                    "opens.set_state: 경로 상태 키 {}와 겹칠 수 없습니다",
                    opens.state
                ));
            }
        }
    }

    if let Some(storage) = &definition.storage {
        if definition.requires.blocks < 6 {
            details.push(
                "storage 선언은 블록 세트 6판이라 requires.blocks가 6 이상이어야 합니다".into(),
            );
        }
        let minimum_storage_version = if storage.entries.iter().any(|entry| entry.collection) {
            3
        } else if storage
            .entries
            .iter()
            .any(|entry| entry.description.is_some() || entry.choices.is_some())
        {
            2
        } else {
            1
        };
        validate_module_version(
            "storage",
            minimum_storage_version,
            definition,
            &mut details,
            "/storage",
        );
        details.extend(app_storage::validate_storage_decl(storage));
    }
    if let Some(agent) = &definition.agent {
        validate_agent_provider(agent, definition, &mut details);
    }

    validate_v14_definition(definition, &mut details);
    validate_worker(definition, &mut details, &mut missing_webhook_token_secret);
    validate_sources(definition, &mut details);
    validate_client(definition, &mut details);

    let mut web_views = 0;
    let mut when_pointers = Vec::new();
    let mut named_blocks = Vec::new();
    let mut repeat_templates: Vec<String> = Vec::new();
    data::walk_definition_blocks(definition, &mut |pointer, block| {
        if let Block::When {
            value,
            min_width,
            max_width,
            ..
        } = block
        {
            when_pointers.push(pointer.to_owned());
            if value.is_none() && min_width.is_none() && max_width.is_none() {
                missing_when_condition = true;
                details.push(format!(
                    "{pointer}: when에는 value, min_width, max_width 중 하나 이상이 필요합니다"
                ));
            }
        }
        if matches!(block, Block::Repeat { .. }) {
            repeat_templates.push(format!("{pointer}/template"));
        }
        if matches!(block, Block::ButtonGrid { .. })
            && repeat_templates.iter().any(|template| {
                pointer == template.as_str()
                    || pointer
                        .strip_prefix(template)
                        .is_some_and(|rest| rest.starts_with('/'))
            })
        {
            details.push(format!(
                "{pointer}: repeat 안에는 button_grid를 둘 수 없습니다. button을 사용하세요"
            ));
        }
        if let Block::Canvas {
            surface: Binding::Literal(value),
            ..
        } = block
        {
            match value.as_str() {
                Some(name) if !name.trim().is_empty() => {
                    named_blocks.push((false, name.to_owned(), pointer.to_owned()));
                }
                _ => details.push(format!("{pointer}: canvas 표면 이름이 비었거나 중복됩니다")),
            }
        }
        if let Block::Anchor { id, .. } = block {
            if id.trim().is_empty() {
                details.push(format!("{pointer}: anchor id가 비었거나 중복됩니다: {id}"));
            } else {
                named_blocks.push((true, id.clone(), pointer.to_owned()));
            }
        }
        if matches!(block, Block::WebView { .. }) {
            web_views += 1;
        }
        validate_block(block, definition, &mut details, pointer);
    });
    let named_blocks: Vec<_> = named_blocks
        .into_iter()
        .map(|(is_anchor, name, pointer)| {
            let when_ancestors = when_pointers
                .iter()
                .filter(|when_pointer| {
                    let child_pointer = format!("{when_pointer}/child");
                    pointer == child_pointer
                        || pointer
                            .strip_prefix(&child_pointer)
                            .is_some_and(|rest| rest.starts_with('/'))
                })
                .cloned()
                .collect::<Vec<_>>();
            (is_anchor, name, pointer, when_ancestors)
        })
        .collect();
    let mut earlier_scopes: HashMap<(bool, String), Vec<Vec<String>>> = HashMap::new();
    for (is_anchor, name, pointer, when_ancestors) in named_blocks {
        let earlier = earlier_scopes.entry((is_anchor, name.clone())).or_default();
        let duplicate = earlier.iter().any(|prior_when_ancestors| {
            when_ancestors.starts_with(prior_when_ancestors)
                || prior_when_ancestors.starts_with(&when_ancestors)
        });
        if duplicate {
            if is_anchor {
                details.push(format!(
                    "{pointer}: anchor id가 비었거나 중복됩니다: {name}"
                ));
            } else {
                details.push(format!("{pointer}: canvas 표면 이름이 비었거나 중복됩니다"));
            }
        }
        earlier.push(when_ancestors);
    }
    if web_views > 1 {
        details.push(format!(
            "web_view는 정의에 하나까지 둘 수 있습니다(지금 {web_views}개)"
        ));
    }

    for (pointer, actions) in data::all_ui_actions(definition) {
        validate_actions(actions, definition, &mut details, &pointer);
    }
    for (pointer, binding) in data::all_ui_bindings(definition) {
        validate_ui_binding(binding, definition, &mut details, &pointer);
    }
    validate_exprs(definition, &mut details);
    ValidationResult {
        details,
        missing_when_condition,
        missing_webhook_token_secret,
    }
}

fn validate_v14_definition(definition: &AppDefinition, details: &mut Vec<String>) {
    if (definition.shortcuts.is_some()
        || definition.messages.is_some()
        || definition.locale.is_some())
        && definition.requires.blocks < 14
    {
        details.push("shortcuts, messages와 locale은 블록 세트 14판이 필요합니다".into());
    }
    if definition.shortcuts.is_some() {
        validate_module_version("client", 2, definition, details, "/shortcuts");
    }
    let mut shortcuts = HashSet::new();
    for (index, shortcut) in definition.shortcuts.iter().flatten().enumerate() {
        let mut modifiers: Vec<String> = shortcut
            .modifiers
            .iter()
            .map(|m| format!("{m:?}"))
            .collect();
        modifiers.sort();
        modifiers.dedup();
        if !shortcuts.insert((shortcut.code.clone(), modifiers)) {
            details.push(format!(
                "/shortcuts: 단축키가 중복됩니다: {}",
                shortcut.code
            ));
        }
        validate_actions(
            &shortcut.action,
            definition,
            details,
            &format!("/shortcuts/{index}/action"),
        );
    }
    if definition.messages.is_some() || definition.locale.is_some() {
        match &definition.locale {
            Some(locale) => {
                validate_state_key(&locale.state, definition, details, "/locale/state");
                let language = definition.state.get(&locale.state).and_then(Value::as_str);
                if !language.is_some_and(|language| {
                    definition
                        .messages
                        .as_ref()
                        .is_some_and(|messages| messages.contains_key(language))
                }) {
                    details.push(
                        "/locale/state: 기본 언어에 해당하는 messages 사전이 필요합니다".into(),
                    );
                }
            }
            None => details.push("/locale: messages의 기본 언어 상태가 필요합니다".into()),
        }
        if let Some(dictionaries) = &definition.messages {
            let keys: HashSet<&String> = dictionaries
                .values()
                .flat_map(|messages| messages.keys())
                .collect();
            for (language, messages) in dictionaries {
                for key in &keys {
                    if !messages.contains_key(*key) {
                        details.push(format!("/messages/{language}: 번역 키가 없습니다: {key}"));
                    }
                }
            }
        }
    }
}

fn validate_client(definition: &AppDefinition, details: &mut Vec<String>) {
    let Some(client) = &definition.client else {
        return;
    };
    validate_module_version("client", 1, definition, details, "/client");
    if let Some(permissions) = &client.realtime_permissions {
        use crate::realtime::{
            REALTIME_BLOCK_SET_VERSION, REALTIME_CLIENT_VERSION, REALTIME_CONNECTION_VERSION,
        };
        validate_module_version(
            "client",
            REALTIME_CLIENT_VERSION,
            definition,
            details,
            "/client/realtime_permissions",
        );
        validate_module_version(
            "connection",
            REALTIME_CONNECTION_VERSION,
            definition,
            details,
            "/client/realtime_permissions",
        );
        if definition.requires.blocks < REALTIME_BLOCK_SET_VERSION {
            details.push(format!("/client/realtime_permissions: 블록 세트 {REALTIME_BLOCK_SET_VERSION}판이 필요합니다"));
        }
        let mut seen = HashSet::new();
        for permission in permissions {
            if !seen.insert(permission) {
                details.push(format!(
                    "/client/realtime_permissions: 중복 권한 {permission}"
                ));
            }
            match definition.permissions.iter().find(|item| item.id() == permission) {
                Some(crate::PermissionDecl::Connection { access: crate::FileAccess::Readwrite, .. }) => {},
                _ => details.push(format!("/client/realtime_permissions: 읽기와 쓰기가 가능한 연결 권한이 필요합니다: {permission}")),
            }
        }
    }
    if client.capabilities.as_ref().is_some_and(|capabilities| {
        capabilities.iter().any(|capability| {
            matches!(
                capability,
                crate::client::ClientCapability::Instructions
                    | crate::client::ClientCapability::ContextCapture
            )
        })
    }) {
        validate_module_version("client", 4, definition, details, "/client/capabilities");
        if definition.requires.blocks < 18 {
            details.push(
                "/client/capabilities: 지침과 같이 보기 준비는 블록 세트 18판이 필요합니다".into(),
            );
        }
    }
    if let Some(permissions) = &client.process_permissions {
        validate_module_version(
            "client",
            3,
            definition,
            details,
            "/client/process_permissions",
        );
        validate_module_version(
            "process",
            1,
            definition,
            details,
            "/client/process_permissions",
        );
        if definition.requires.blocks < 17 {
            details.push("/client/process_permissions: 블록 세트 17판이 필요합니다".into());
        }
        for permission in permissions {
            validate_permission_module(
                permission,
                "process",
                definition,
                details,
                "/client/process_permissions",
            );
        }
    }
    if client.http_permissions.is_some()
        || client.device_storage.is_some()
        || client.capabilities.is_some()
    {
        validate_module_version("client", 2, definition, details, "/client");
        if definition.requires.blocks < 14 {
            details.push("/client: 새 필드는 블록 세트 14판이 필요합니다".into());
        }
    }
    if let Some(permissions) = &client.http_permissions {
        validate_module_version("http", 2, definition, details, "/client/http_permissions");
        for permission in permissions {
            validate_permission_module(
                permission,
                "http",
                definition,
                details,
                "/client/http_permissions",
            );
        }
    }

    if !definition.assets.iter().any(|asset| asset == &client.entry) {
        details.push("/client/entry: 선언된 자산과 판이 일치해야 합니다".into());
    }
    for name in client
        .inputs
        .keys()
        .chain(client.outputs.keys())
        .chain(client.channels.iter())
        .chain(client.actions.iter())
        .chain(client.commands.keys())
    {
        if !data::valid_source_name(name) {
            details.push(format!("/client: 이름이 올바르지 않습니다: {name}"));
        }
    }
    let mut channels = HashSet::new();
    for channel in &client.channels {
        if !channels.insert(channel) {
            details.push(format!("/client/channels: 채널 이름이 겹칩니다: {channel}"));
        }
    }
    if !client.channels.is_empty() && definition.requires.blocks < 18 {
        details.push("/client/channels: 블록 세트 18판이 필요합니다".into());
    }
    if !client.channels.is_empty() {
        validate_module_version("client", 4, definition, details, "/client/channels");
    }
    for (name, value) in &client.inputs {
        let at = format!("/client/inputs/{name}");
        validate_binding_shape(value, definition, details, &at);
        if let Binding::Expr(expr) = value {
            if uses_var(&expr.expr, "$event") || uses_var(&expr.expr, "$item") {
                details.push(format!("{at}: $event와 $item은 쓸 수 없습니다"));
            }
        }
    }
    for (name, actions) in &client.commands {
        let at = format!("/client/commands/{name}");
        if data::local_actions(actions) {
            details.push(format!("{at}: 클라이언트 동작을 쓸 수 없습니다"));
        } else {
            validate_actions(actions, definition, details, &at);
        }
    }
    for key in &client.state_keys {
        validate_state_key(key, definition, details, "/client/state_keys");
    }
    for entry in &client.storage_entries {
        if !definition
            .storage
            .as_ref()
            .is_some_and(|storage| storage.entries.iter().any(|item| &item.id == entry))
        {
            details.push(format!(
                "/client/storage_entries: 선언되지 않은 저장 항목입니다: {entry}"
            ));
        }
    }
}

fn validate_ui_binding(
    binding: &Binding,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    if matches!(
        binding,
        Binding::Item(_)
            | Binding::ParentItem(_)
            | Binding::Message(crate::data::MessageRef {
                message: MessageKey::Item(_)
            })
    ) {
        let menu_confirm_body = at.strip_suffix("/confirm/body").is_some_and(|entry| {
            entry.rsplit_once('/').is_some_and(|(menu, index)| {
                menu.ends_with("/item_menu")
                    && !index.is_empty()
                    && index.bytes().all(|byte| byte.is_ascii_digit())
            })
        });
        if matches!(binding, Binding::Item(_) | Binding::ParentItem(_))
            && (menu_confirm_body
                || at
                    .strip_suffix("/copy_text")
                    .is_some_and(is_item_menu_action)
                || at.strip_suffix("/open_url").is_some_and(is_item_menu_action))
        {
            return;
        }
        if at.ends_with("/save_file/suggested_name") {
            details.push(format!("{at}: 항목 바인딩은 동작의 값에 쓸 수 없습니다"));
            return;
        }
        let mut depth = 0;
        data::walk_definition_blocks(definition, &mut |pointer, block| {
            if matches!(block, Block::Repeat { .. }) {
                let template = format!("{pointer}/template");
                if at == template || at.starts_with(&format!("{template}/")) {
                    depth += 1;
                }
            }
        });
        let needed = if matches!(binding, Binding::ParentItem(_)) {
            2
        } else {
            1
        };
        if depth < needed {
            let name = if needed == 2 { "parent_item" } else { "item" };
            details.push(format!(
                "{at}: {name}은 해당 repeat.template 범위에서만 쓸 수 있습니다"
            ));
        }
        if definition.requires.blocks < 14 {
            details.push(format!("{at}: 항목 바인딩은 블록 세트 14판이 필요합니다"));
        }
        let message_item = matches!(
            binding,
            Binding::Message(crate::data::MessageRef {
                message: MessageKey::Item(_)
            })
        );
        if message_item && definition.requires.blocks < 19 {
            details.push(format!("{at}: message.item은 블록 세트 19판이 필요합니다"));
        }
        if message_item && definition.messages.is_none() {
            details.push("/messages: message.item에는 언어별 messages 사전이 필요합니다".into());
            if definition.locale.is_none() {
                details.push("/locale: message.item에는 기본 언어 상태가 필요합니다".into());
            }
        }
        return;
    }
    if let Binding::Message(reference) = binding {
        if definition.requires.blocks < 14 {
            details.push(format!("{at}: message는 블록 세트 14판이 필요합니다"));
        }
        if let MessageKey::Key(key) = &reference.message {
            if definition.messages.as_ref().is_none_or(|messages| {
                messages.is_empty()
                    || messages
                        .values()
                        .any(|dictionary| !dictionary.contains_key(key))
            }) {
                details.push(format!("{at}: 모든 언어에 메시지 키가 필요합니다: {key}"));
            }
        }
        return;
    }
    if let Binding::Client(reference) = binding {
        let can_read_client_output = at == "/ui"
            || at.starts_with("/ui/")
            || at == "/settings/available"
            || at == "/settings/ui"
            || at.starts_with("/settings/ui/")
            || matches!(at, "/window_title/title" | "/window_title/meta");
        if !can_read_client_output
            || definition.requires.blocks < 12
            || definition
                .requires
                .modules
                .get("client")
                .copied()
                .unwrap_or(0)
                < 1
            || !definition
                .client
                .as_ref()
                .is_some_and(|client| client.outputs.contains_key(&reference.client))
        {
            details.push(format!(
                "{at}: 선언되지 않은 클라이언트 출력입니다: {}",
                reference.client
            ));
        }
    } else {
        validate_binding_shape(binding, definition, details, at);
    }
}

fn validate_control_binding(
    binding: &Binding,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    if matches!(
        binding,
        Binding::State(_) | Binding::Client(_) | Binding::Item(_) | Binding::ParentItem(_)
    ) {
        validate_ui_binding(binding, definition, details, at);
    } else {
        details.push(format!("{at}: 상태나 클라이언트 출력 바인딩이 필요합니다"));
    }
}

fn validate_worker(
    definition: &AppDefinition,
    details: &mut Vec<String>,
    missing_webhook_token_secret: &mut bool,
) {
    use crate::worker::*;
    if definition.worker.is_some() || data::ui_uses_worker_action(definition) {
        validate_module_version("worker", 1, definition, details, "/worker");
    }
    let Some(worker) = &definition.worker else {
        return;
    };
    if worker.code.trim().is_empty() || worker.code.len() > WORKER_CODE_MAX_BYTES {
        details.push("/worker/code: 코드가 비었거나 너무 큽니다".into());
    }
    if worker
        .timeout_secs
        .is_some_and(|t| t == 0 || t > WORKER_TIMEOUT_MAX_SECS)
    {
        details.push("/worker/timeout_secs: 실행 시간 범위가 올바르지 않습니다".into());
    }
    let entries = definition
        .storage
        .as_ref()
        .map(|s| s.entries.as_slice())
        .unwrap_or_default();
    if let Some(schedule) = &worker.schedule {
        if !(WORKER_SCHEDULE_MIN_SECS..=WORKER_SCHEDULE_MAX_SECS).contains(&schedule.interval_secs)
            || schedule
                .jitter_secs
                .is_some_and(|j| j > schedule.interval_secs)
        {
            details.push("/worker/schedule: 주기 또는 지연 범위가 올바르지 않습니다".into());
        }
        if !entries.iter().any(|entry| {
            entry.id == schedule.enabled_entry
                && !entry.key.contains("{workspace_id}")
                && entry.kind == StorageKind::Json
                && entry.default == Value::Bool(false)
        }) {
            details.push("/worker/schedule/enabled_entry: 기본값이 false인 불리언 json 저장 항목이어야 합니다".into());
        }
    }
    if let Some(webhook) = &worker.webhook {
        if let Some(id) = &webhook.enabled_entry {
            if !entries.iter().any(|entry| {
                entry.id == *id
                    && !entry.key.contains("{workspace_id}")
                    && entry.kind == StorageKind::Json
                    && entry.default == Value::Bool(false)
            }) {
                details.push("/worker/webhook/enabled_entry: 기본값이 false인 불리언 json 저장 항목이어야 합니다".into());
            }
        }
        if webhook.token_secret.trim().is_empty() {
            *missing_webhook_token_secret = true;
            details.push("/worker/webhook/token_secret: 호출 토큰을 담을 워커 시크릿을 반드시 지정해야 합니다".into());
        } else if !worker
            .secrets
            .iter()
            .any(|secret| secret.id == webhook.token_secret)
        {
            details.push("/worker/webhook/token_secret: 선언된 시크릿이어야 합니다".into());
        }
    }
    let mut targets = HashSet::new();
    for target in &worker.calls {
        if !valid_id(target) || target == &definition.id || !targets.insert(target) {
            details.push(format!(
                "/worker/calls: 대상 id가 올바르지 않거나 중복됩니다: {target}"
            ));
        }
    }
    let mut seen = HashSet::new();
    for id in &worker.watch_entries {
        if !seen.insert(id) || !entries.iter().any(|entry| &entry.id == id) {
            details.push(format!(
                "/worker/watch_entries: 없는 항목이거나 중복됩니다: {id}"
            ));
        }
    }
    seen.clear();
    for id in &worker.actions {
        if !(valid_id(id) || data::valid_source_name(id)) || !seen.insert(id) {
            details.push(format!(
                "/worker/actions: id가 올바르지 않거나 중복됩니다: {id}"
            ));
        }
    }
    seen.clear();
    for secret in &worker.secrets {
        if !(valid_id(&secret.id) || data::valid_source_name(&secret.id))
            || !seen.insert(&secret.id)
        {
            details.push(format!(
                "/worker/secrets: id가 올바르지 않거나 중복됩니다: {}",
                secret.id
            ));
        }
    }
}

fn validate_sources(definition: &AppDefinition, details: &mut Vec<String>) {
    if definition.sources.is_empty() {
        return;
    }
    if definition.requires.blocks < 4 {
        details.push("sources는 블록 세트 4판이라 requires.blocks가 4 이상이어야 합니다".into());
    }
    for (name, source) in &definition.sources {
        let at = format!("/sources/{}", data::escape_pointer(name));
        if !data::valid_source_name(name) {
            details.push(format!(
                "{at}: 원천 이름은 소문자로 시작하고 소문자, 숫자, _ 1~32자여야 합니다: {name}"
            ));
        }
        let module = match source {
            SourceDecl::Request { .. }
                if matches!(
                    find_permission(definition, source.permission()),
                    Some(PermissionDecl::Profiler { .. })
                ) =>
            {
                "profiler"
            }
            SourceDecl::Request { .. }
                if matches!(
                    find_permission(definition, source.permission()),
                    Some(PermissionDecl::Http { .. })
                ) =>
            {
                "http"
            }
            SourceDecl::Request { .. } => "connection",
            SourceDecl::Store(_) => "store",
            SourceDecl::File { .. } | SourceDecl::Folder { .. } => "files",
        };
        validate_permission_module(source.permission(), module, definition, details, &at);
        if source
            .refresh_secs()
            .is_some_and(|secs| secs < data::SOURCE_REFRESH_MIN_SECS)
        {
            details.push(format!(
                "{at}: refresh_secs는 {} 이상이어야 합니다",
                data::SOURCE_REFRESH_MIN_SECS
            ));
        }
        match source {
            SourceDecl::Store(_) => {
                for (field, binding) in data::source_bindings(source) { validate_binding_shape(binding, definition, details, &format!("{at}/{field}")); }
            }
            SourceDecl::Request {
                path, query, page, ..
            } => {
                if let Some(page) = page {
                    if definition.requires.blocks < 22 {
                        details.push(format!("{at}/page: 쪽 넘김은 블록 세트 22판이라 requires.blocks가 22 이상이어야 합니다"));
                    }
                    if page.param.is_empty() {
                        details.push(format!("{at}/page/param: 다음 쪽 query 키를 입력하세요"));
                    } else if query.contains_key(&page.param) {
                        details.push(format!(
                            "{at}/page/param: query에 이미 있는 키입니다: {}",
                            page.param
                        ));
                    }
                    if !page.items.is_empty() && page.items.split('.').any(str::is_empty) {
                        details.push(format!(
                            "{at}/page/items: 점으로 이은 경로에 빈 부분을 둘 수 없습니다"
                        ));
                    }
                    if let Err(reason) = parse_expr(&page.next) {
                        details.push(format!(
                            "{at}/page/next: 올바른 JSONata 식을 입력하세요. 원인: {reason}"
                        ));
                    }
                }
                validate_binding_shape(path, definition, details, &format!("{at}/path"));
                if let Binding::Literal(Value::String(path)) = path {
                    if !valid_request_path(path) {
                        details.push(format!(
                            "{at}/path: 연결 경로는 /로 시작하고 .. 이나 \\ 없이 연결 주소 아래를 가리켜야 합니다: {path}"
                        ));
                    }
                    if let Some(PermissionDecl::Http { paths, .. }) =
                        find_permission(definition, source.permission())
                    {
                        if !allowed_public_http_path(paths, path) {
                            details.push(format!(
                                "{at}/path: 공개 HTTPS 권한에 선언되지 않은 경로입니다"
                            ));
                        }
                    }
                }
                for (key, value) in query {
                    validate_binding_shape(
                        value,
                        definition,
                        details,
                        &format!("{at}/query/{}", data::escape_pointer(key)),
                    );
                }
            }
            SourceDecl::File { path, .. } => {
                validate_binding_shape(path, definition, details, &format!("{at}/path"));
                if let Binding::Literal(Value::String(path)) = path {
                    if !valid_relative_path(path, false) {
                        details.push(format!("{at}/path: 고른 폴더 밖 경로를 요구합니다: {path}"));
                    }
                }
            }
            SourceDecl::Folder {
                dir, extensions, ..
            } => {
                if let Some(dir) = dir {
                    validate_binding_shape(dir, definition, details, &format!("{at}/dir"));
                    if let Binding::Literal(Value::String(dir)) = dir {
                        if !valid_relative_path(dir, true) {
                            details
                                .push(format!("{at}/dir: 고른 폴더 밖 경로를 요구합니다: {dir}"));
                        }
                    }
                }
                for extension in extensions {
                    if !valid_extension(extension) {
                        details.push(format!(
                            "{at}: extensions의 확장자는 점 없이 소문자와 숫자 1~16자여야 합니다: {extension}"
                        ));
                    }
                }
            }
        }
    }
}

fn validate_agent_provider(
    agent: &AgentProvider,
    definition: &AppDefinition,
    details: &mut Vec<String>,
) {
    let at = "/agent";
    if definition.requires.blocks < 6 {
        details.push(
            "agent provider는 블록 세트 6판이라 requires.blocks가 6 이상이어야 합니다".into(),
        );
    }
    validate_module_version("agent", 3, definition, details, at);
    validate_module_version("connection", 2, definition, details, at);
    validate_module_version("storage", 1, definition, details, at);
    validate_permission_module(&agent.permission, "connection", definition, details, at);
    match find_permission(definition, &agent.permission) {
        Some(PermissionDecl::Connection { access, .. }) if *access == FileAccess::Readwrite => {}
        Some(_) => details.push(format!(
            "{at}/permission은 readwrite connection 권한이어야 합니다"
        )),
        None => {}
    }
    if !valid_request_path(&agent.base_path) {
        details.push(format!(
            "{at}/base_path는 /로 시작하는 안전한 연결 경로여야 합니다"
        ));
    }

    let storage = definition.storage.as_ref();
    if let Some(storage) = storage {
        let thread_entry = storage
            .entries
            .iter()
            .find(|entry| entry.id == agent.thread_entry);
        match thread_entry {
            Some(entry)
                if entry.kind == StorageKind::Json && entry.key.contains("{workspace_id}") => {}
            Some(_) => details.push(format!(
                "{at}/thread_entry는 workspace_id 키를 가진 json 저장 항목이어야 합니다"
            )),
            None => details.push(format!(
                "{at}/thread_entry가 storage 선언에 없습니다: {}",
                agent.thread_entry
            )),
        }
    } else {
        details.push(format!(
            "{at}/thread_entry를 검사하려면 storage 선언이 필요합니다"
        ));
    }

    let fields = [
        ("namespace", &agent.namespace),
        ("profile", &agent.profile),
        ("collection", &agent.collection),
        ("model_order", &agent.model_order),
        ("selected_model", &agent.selected_model),
        ("title_template", &agent.title_template),
        (
            "initial_instruction_template",
            &agent.initial_instruction_template,
        ),
        ("instructions_template", &agent.instructions_template),
    ];
    for (field, binding) in fields {
        let pointer = format!("{at}/{field}");
        validate_binding_shape(binding, definition, details, &pointer);
        let window_dependent = match binding {
            Binding::State(_) => true,
            Binding::Expr(expr) => agent_expr_uses_runtime_variable(&expr.expr),
            Binding::Client(_)
            | Binding::Item(_)
            | Binding::ParentItem(_)
            | Binding::Message(_) => true,
            Binding::Literal(_) => false,
        };
        if window_dependent {
            details.push(format!(
                "{pointer}: 대화 설정은 창마다 다를 수 없으니 저장소 항목으로 선언하라"
            ));
        }
        if let Some(value) = static_binding_value(binding, definition) {
            if matches!(
                field,
                "title_template" | "initial_instruction_template" | "instructions_template"
            ) {
                if let Some(template) = value.as_str() {
                    if let Err(reason) = validate_workspace_template(template) {
                        details.push(format!("{pointer}: {reason}"));
                    }
                }
            }
            if field == "namespace" && value.as_str().is_some_and(str::is_empty) {
                details.push(format!("{pointer}는 비어 있을 수 없습니다"));
            }
            if field == "model_order" {
                if let Some(models) = value.as_array() {
                    let mut seen = HashSet::new();
                    if models.is_empty() {
                        details.push(format!("{pointer}는 하나 이상의 model id가 필요합니다"));
                    }
                    for model in models {
                        let Some(model) = model.as_str() else {
                            details.push(format!("{pointer}의 model id는 문자열이어야 합니다"));
                            continue;
                        };
                        if model.is_empty() || !seen.insert(model) {
                            details
                                .push(format!("{pointer}의 model id가 비었거나 겹칩니다: {model}"));
                        }
                    }
                }
            }
        }
    }
}

fn agent_expr_uses_runtime_variable(expr: &str) -> bool {
    use jsonata_core::parser::{Lexer, Token};
    let mut lexer = Lexer::new(expr.to_owned());
    loop {
        match lexer.next_token() {
            Ok(Token::Variable(name))
                if matches!(name.as_str(), "state" | "data" | "event" | "item") =>
            {
                return true
            }
            Ok(Token::Eof) | Err(_) => return false,
            _ => {}
        }
    }
}

fn validate_module_version(
    module: &str,
    minimum: u32,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    if definition
        .requires
        .modules
        .get(module)
        .copied()
        .unwrap_or(0)
        < minimum
    {
        details.push(format!(
            "{at}: {module} 모듈 {minimum}판을 requires.modules에 선언해야 합니다"
        ));
    }
}

fn static_binding_value<'a>(
    binding: &'a Binding,
    definition: &'a AppDefinition,
) -> Option<&'a Value> {
    match binding {
        Binding::Literal(value) => Some(value),
        Binding::State(reference) => definition.state.get(&reference.state),
        Binding::Client(_) | Binding::Item(_) | Binding::ParentItem(_) | Binding::Message(_) => {
            None
        }
        Binding::Expr(expr) => {
            let reference = expr.expr.strip_prefix("$storage.")?;
            if reference.is_empty() || reference.contains('.') || reference.contains('[') {
                return None;
            }
            definition
                .storage
                .as_ref()?
                .entries
                .iter()
                .find(|entry| entry.id == reference)
                .map(|entry| &entry.default)
        }
    }
}

/// 작업 제목과 지시 템플릿은 지원하는 작업 자리표시자만 쓴다.
pub fn validate_workspace_template(template: &str) -> Result<(), &'static str> {
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let after_open = &rest[open + 1..];
        let Some(close) = after_open.find('}') else {
            return Err("닫히지 않은 template 자리표시자가 있습니다");
        };
        let placeholder = &after_open[..close];
        if !matches!(placeholder, "workspace.id" | "workspace.name") {
            return Err("template은 {workspace.id}와 {workspace.name}만 쓸 수 있습니다");
        }
        rest = &after_open[close + 1..];
    }
    if rest.contains('}') {
        return Err("짝이 맞지 않는 template 괄호가 있습니다");
    }
    Ok(())
}

/// 모든 식을 읽어 보고, 원천 참조와 원천 값 자리의 변수 규칙을 본다.
fn validate_exprs(definition: &AppDefinition, details: &mut Vec<String>) {
    let mut has_expr = false;
    for (pointer, expr) in data::all_exprs(definition) {
        has_expr = true;
        if let Err(error) = parse_expr(expr) {
            details.push(format!("{pointer}: 식을 읽을 수 없습니다: {error}"));
            continue;
        }
        for name in data::data_refs(expr) {
            if !definition.sources.contains_key(&name) {
                details.push(format!(
                    "{pointer}: 식이 없는 원천을 읽습니다: $data.{name}"
                ));
            }
        }
        for name in data::data_meta_refs(expr) {
            if !definition.sources.contains_key(&name) {
                details.push(format!(
                    "{pointer}: 식이 없는 원천 메타데이터를 읽습니다: $data_meta.{name}"
                ));
            }
        }
        for entry in data::storage_refs(expr) {
            let storage_entry = definition
                .storage
                .as_ref()
                .and_then(|storage| storage.entries.iter().find(|item| item.id == entry));
            if storage_entry.is_none() {
                details.push(format!(
                    "{pointer}: 식이 없는 저장 항목을 읽습니다: $storage.{entry}"
                ));
            } else if storage_entry.is_some_and(|item| item.collection) {
                details.push(format!(
                    "{pointer}: 문서 모음은 $storage 식에 포함되지 않습니다: $storage.{entry}"
                ));
            }
        }
        for field in data::storage_meta_refs(expr) {
            if field != "bucket_id" {
                details.push(format!(
                    "{pointer}: $storage_meta에 없는 필드입니다: {field}"
                ));
            }
        }
        if pointer.starts_with("/sources/")
            && ["$data_meta", "$event", "$item"]
                .iter()
                .any(|var| uses_var(expr, var))
        {
            details.push(format!(
                "{pointer}: 원천의 값 자리 식은 $state, $storage, $data만 볼 수 있습니다($data_meta, $event, $item 불가)"
            ));
        }
        if pointer.starts_with("/sources/") && has_untracked_data_access(expr) {
            details.push(format!(
                "{pointer}: 원천의 값 자리 식에서 다른 원천은 $data.이름 꼴로만 읽을 수 있습니다"
            ));
        }
    }
    if let Err(cycle) = data::source_topological_order(&definition.sources) {
        details.push(format!(
            "/sources/{}: 원천 참조가 순환합니다: {}",
            data::escape_pointer(&cycle[0]),
            cycle.join(" -> ")
        ));
    }
    if has_expr && definition.requires.blocks < 4 {
        details.push("식(expr)은 블록 세트 4판이라 requires.blocks가 4 이상이어야 합니다".into());
    }
}

/// 원천 식의 모든 `$data` 변수가 정적 원천 이름을 가리키는지 검사한다.
fn has_untracked_data_access(expr: &str) -> bool {
    let bytes = expr.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\'' || bytes[i] == b'"' {
            let quote = bytes[i];
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i = (i + 2).min(bytes.len());
                    continue;
                }
                if bytes[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if bytes[i..].starts_with(b"$data") {
            let end = i + 5;
            if bytes
                .get(end)
                .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
            {
                i = end;
                continue;
            }
            if bytes.get(end) != Some(&b'.')
                || !bytes.get(end + 1).is_some_and(u8::is_ascii_lowercase)
            {
                return true;
            }
            i = end + 1;
            continue;
        }
        i += 1;
    }
    false
}

/// 식에 변수가 이름 그대로 나오는가(`$data`가 `$database`에 걸리지 않게 뒤 글자를 본다).
fn uses_var(expr: &str, var: &str) -> bool {
    expr.match_indices(var).any(|(index, _)| {
        expr[index + var.len()..]
            .chars()
            .next()
            .is_none_or(|next| !(next.is_alphanumeric() || next == '_'))
    })
}

/// 리터럴 바인딩이 바인딩 꼴을 잘못 쓴 것(`{"state": 1}`, `{"expr": 1}`, `{"state": "a", "x": 1}`)이 아닌지.
/// 상태 바인딩의 키는 선언되어 있는지.
fn validate_binding_shape(
    binding: &Binding,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    match binding {
        Binding::State(reference) => validate_state_key(&reference.state, definition, details, at),
        Binding::Expr(_) => {}
        Binding::Client(_) => details.push(format!(
            "{at}: 이 자리에는 클라이언트 바인딩을 쓸 수 없습니다"
        )),
        Binding::Item(_) | Binding::ParentItem(_) | Binding::Message(_) => details.push(format!(
            "{at}: 이 자리에는 화면 전용 바인딩을 쓸 수 없습니다"
        )),
        Binding::Literal(Value::Object(object))
            if object.contains_key("state")
                || object.contains_key("expr")
                || object.contains_key("client")
                || object.contains_key("item")
                || object.contains_key("parent_item")
                || object.contains_key("message") =>
        {
            details.push(format!(
                "{at}: 바인딩 모양이 틀렸습니다. 상태는 {{\"state\": \"키\"}}, 식은 {{\"expr\": \"식\"}} 하나만 씁니다"
            ));
        }
        Binding::Literal(_) => {}
    }
}

fn validate_actions(
    actions: &Actions,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    match actions {
        Actions::One(set) => validate_state_key(&set.set_state, definition, details, at),
        Actions::Client(action) => {
            validate_client_action(&action.client, definition, details, at, false)
        }
        Actions::PickFiles(action) => {
            validate_client_action(&action.pick_files.client, definition, details, at, true)
        }
        Actions::SaveFile(action) => {
            validate_client_action(&action.save_file.client, definition, details, at, true);
            validate_ui_binding(
                &action.save_file.suggested_name,
                definition,
                details,
                &format!("{at}/save_file/suggested_name"),
            );
        }
        Actions::CopyText(action) => {
            validate_copy_text_location(definition, details, at);
            validate_item_menu_copy_text(&action.copy_text, details, at);
            if definition.requires.blocks < 18 {
                details.push(
                    "글 복사 동작은 블록 세트 18판이라 requires.blocks가 18 이상이어야 합니다"
                        .into(),
                );
            }
            validate_ui_binding(
                &action.copy_text,
                definition,
                details,
                &format!("{at}/copy_text"),
            );
        }
        Actions::OpenUrl(action) => {
            if is_item_menu_action(at) && matches!(action.open_url, Binding::Expr(_)) {
                details.push(format!("{at}: item_menu의 open_url은 {{\"item\":\"필드\"}}로 항목 값을 가리키세요. 식은 행마다 계산하지 않습니다"));
            }
            validate_ui_binding(&action.open_url, definition, details, &format!("{at}/open_url"));
        }
        Actions::Many(list) => {
            if list.is_empty() {
                details.push(format!("{at}: 동작 목록이 비어 있습니다"));
            }
            for (index, action) in list.iter().enumerate() {
                let at = format!("{at}/{index}");
                match action {
                    Action::StoreInstall(action) => {
                        let spec = &action.store_install;
                        for (field, binding) in [("server", &spec.server), ("id", &spec.id), ("release", &spec.release)] {
                            validate_binding_shape(binding, definition, details, &format!("{at}/store.install/{field}"));
                        }
                    }
                    Action::StoreRemove(action) => {
                        let spec = &action.store_remove;
                        validate_binding_shape(&spec.id, definition, details, &format!("{at}/store.remove/id"));
                    }
                    Action::Client(action) => {
                        if list.len() != 1 {
                            details.push(format!("{at}: 클라이언트 동작은 단독으로 써야 합니다"));
                        }
                        validate_client_action(&action.client, definition, details, &at, false);
                    }
                    Action::PickFiles(action) => {
                        if list.len() != 1 {
                            details.push(format!("{at}: 파일 동작은 단독으로 써야 합니다"));
                        }
                        validate_client_action(
                            &action.pick_files.client,
                            definition,
                            details,
                            &at,
                            true,
                        );
                    }
                    Action::SaveFile(action) => {
                        if list.len() != 1 {
                            details.push(format!("{at}: 파일 동작은 단독으로 써야 합니다"));
                        }
                        validate_client_action(
                            &action.save_file.client,
                            definition,
                            details,
                            &at,
                            true,
                        );
                        validate_ui_binding(
                            &action.save_file.suggested_name,
                            definition,
                            details,
                            &format!("{at}/save_file/suggested_name"),
                        );
                    }
                    Action::CopyText(action) => {
                        validate_copy_text_location(definition, details, &at);
                        validate_item_menu_copy_text(&action.copy_text, details, &at);
                        if list.len() != 1 {
                            details.push(format!("{at}: 글 복사 동작은 단독으로 써야 합니다"));
                        }
                        if definition.requires.blocks < 18 {
                            details.push(
                                "글 복사 동작은 블록 세트 18판이라 requires.blocks가 18 이상이어야 합니다"
                                    .into(),
                            );
                        }
                        validate_ui_binding(
                            &action.copy_text,
                            definition,
                            details,
                            &format!("{at}/copy_text"),
                        );
                    }
                    Action::Worker(worker) => {
                        if !definition
                            .worker
                            .as_ref()
                            .is_some_and(|decl| decl.actions.contains(&worker.worker.action))
                        {
                            details.push(format!(
                                "{at}: 선언되지 않은 워커 동작입니다: {}",
                                worker.worker.action
                            ));
                        }
                        if let Some(args) = &worker.worker.args {
                            validate_binding_shape(
                                args,
                                definition,
                                details,
                                &format!("{at}/worker/args"),
                            );
                        }
                    }
                    Action::SetState(set) => {
                        validate_state_key(&set.set_state, definition, details, &at);
                        if let Some(value) = &set.value {
                            validate_binding_shape(
                                value,
                                definition,
                                details,
                                &format!("{at}/value"),
                            );
                        }
                    }
                    Action::Refresh(refresh) => {
                        for name in &refresh.refresh {
                            if !definition.sources.contains_key(name) {
                                details
                                    .push(format!("{at}: 없는 원천을 다시 받으려 합니다: {name}"));
                            }
                        }
                    }
                    Action::SetStorage(set_storage) => {
                        if !definition.requires.modules.contains_key("storage") {
                            details.push(format!("{at}: set_storage가 사용하는 storage 모듈을 requires.modules에 선언해야 합니다"));
                        }
                        let spec = &set_storage.set_storage;
                        let storage_entry = definition.storage.as_ref().and_then(|storage| {
                            storage.entries.iter().find(|entry| entry.id == spec.entry)
                        });
                        match storage_entry {
                            Some(entry) if entry.collection => match &spec.doc {
                                None => details.push(format!(
                                    "{at}: 문서 모음에 쓰려면 doc이 필요합니다: {}",
                                    spec.entry
                                )),
                                Some(crate::StringOrStateRef::String(doc)) => {
                                    if !crate::app_storage::valid_collection_doc(doc) {
                                        details.push(format!(
                                            "{at}: set_storage의 doc 경로가 올바르지 않습니다"
                                        ));
                                    }
                                }
                                Some(crate::StringOrStateRef::State(state)) => {
                                    validate_state_key(&state.state, definition, details, &at);
                                }
                            },
                            Some(_) if spec.doc.is_some() => details.push(format!(
                                "{at}: 고정 저장 항목에는 doc을 쓸 수 없습니다: {}",
                                spec.entry
                            )),
                            Some(_) => {}
                            None => details
                                .push(format!("{at}: 없는 저장 항목에 씁니다: {}", spec.entry)),
                        }
                        if let Some(value) = &spec.value {
                            validate_binding_shape(
                                value,
                                definition,
                                details,
                                &format!("{at}/set_storage/value"),
                            );
                        }
                    }
                    Action::Call(call) => {
                        let call = &call.call;
                        let module = if matches!(
                            find_permission(definition, &call.permission),
                            Some(PermissionDecl::Profiler { .. })
                        ) {
                            "profiler"
                        } else if matches!(
                            find_permission(definition, &call.permission),
                            Some(PermissionDecl::Http { .. })
                        ) {
                            "http"
                        } else {
                            "connection"
                        };
                        validate_permission_module(
                            &call.permission,
                            module,
                            definition,
                            details,
                            &at,
                        );
                        if module == "http" && call.method != data::HttpMethod::Get {
                            details.push(format!("{at}: 공개 HTTPS 권한 {}의 부르기 동작은 GET만 됩니다. 쓰기는 client의 http.request로 하세요", call.permission));
                        } else if call.method != data::HttpMethod::Get
                            && find_permission(definition, &call.permission).is_some_and(
                                |permission| permission.access() != FileAccess::Readwrite,
                            )
                        {
                            details.push(format!(
                                "{at}: {} 부르기는 권한 {}가 readwrite여야 합니다",
                                call.method.as_str(),
                                call.permission
                            ));
                        }
                        if module == "http" && call.body.is_some() {
                            details.push(format!(
                                "{at}: 공개 HTTPS 요청에는 본문을 사용할 수 없습니다"
                            ));
                        }
                        validate_binding_shape(
                            &call.path,
                            definition,
                            details,
                            &format!("{at}/call/path"),
                        );
                        if let Binding::Literal(Value::String(path)) = &call.path {
                            if !valid_request_path(path) {
                                details.push(format!(
                                    "{at}/call/path: 연결 경로는 /로 시작하고 .. 이나 \\ 없이 연결 주소 아래를 가리켜야 합니다: {path}"
                                ));
                            }
                        }
                        for (key, value) in &call.query {
                            validate_binding_shape(
                                value,
                                definition,
                                details,
                                &format!("{at}/call/query/{}", data::escape_pointer(key)),
                            );
                        }
                        if let Some(body) = &call.body {
                            validate_binding_shape(
                                body,
                                definition,
                                details,
                                &format!("{at}/call/body"),
                            );
                        }
                    }
                }
            }
        }
    }
}

fn item_menu_block_pointer(at: &str) -> Option<&str> {
    let action_pointer = match at.rsplit_once('/') {
        Some((parent, index)) if index.bytes().all(|byte| byte.is_ascii_digit()) => parent,
        _ => at,
    };
    action_pointer
        .strip_suffix("/on_select")
        .and_then(|pointer| {
            let (menu_pointer, index) = pointer.rsplit_once('/')?;
            if index.is_empty() || !index.bytes().all(|byte| byte.is_ascii_digit()) {
                return None;
            }
            menu_pointer.strip_suffix("/item_menu")
        })
}

fn is_item_menu_action(at: &str) -> bool {
    item_menu_block_pointer(at).is_some()
}

fn validate_item_menu_copy_text(binding: &Binding, details: &mut Vec<String>, at: &str) {
    if is_item_menu_action(at) && matches!(binding, Binding::Expr(_)) {
        details.push(format!("{at}: item_menu의 copy_text는 {{\"item\":\"필드\"}}로 항목 값을 가리키세요. 식은 행마다 계산하지 않습니다"));
    }
}

fn validate_copy_text_location(definition: &AppDefinition, details: &mut Vec<String>, at: &str) {
    let is_item_menu = item_menu_block_pointer(at).is_some_and(|pointer| {
        serde_json::to_value(definition)
            .ok()
            .and_then(|value| value.pointer(pointer).cloned())
            .and_then(|block| block.get("type").and_then(Value::as_str).map(str::to_owned))
            .is_some_and(|kind| matches!(kind.as_str(), "list" | "table" | "tree" | "feed"))
    });
    if is_item_menu {
        return;
    }
    let block_pointer = at.strip_suffix("/on_click").or_else(|| {
        let (action_pointer, index) = at.rsplit_once('/')?;
        if !index.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        action_pointer.strip_suffix("/on_click")
    });
    let Some(ui_pointer) = block_pointer.and_then(|pointer| pointer.strip_prefix("/ui")) else {
        details.push(format!(
            "{at}: copy_text는 아이콘이 있는 단추의 on_click 또는 항목 메뉴의 on_select에만 쓸 수 있습니다"
        ));
        return;
    };
    let has_icon = serde_json::to_value(&definition.ui)
        .ok()
        .and_then(|ui| {
            if ui_pointer.is_empty() {
                Some(ui)
            } else {
                ui.pointer(ui_pointer).cloned()
            }
        })
        .is_some_and(|block| {
            block.get("type").and_then(Value::as_str) == Some("button")
                && block.get("icon").is_some_and(|icon| !icon.is_null())
        });
    if !has_icon {
        details.push(format!(
            "{at}: copy_text는 아이콘이 있는 단추의 on_click 또는 항목 메뉴의 on_select에만 쓸 수 있습니다"
        ));
    }
}

fn validate_client_action(
    name: &str,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
    file: bool,
) {
    let click = at.ends_with("/on_click") || at.ends_with("/on_click/0");
    if !(at.starts_with("/ui/")
        || at.starts_with("/settings/ui/")
        || (!file && at.starts_with("/shortcuts/")))
        || (file && !click)
        || definition.requires.blocks < 12
        || definition
            .requires
            .modules
            .get("client")
            .copied()
            .unwrap_or(0)
            < 1
        || !definition
            .client
            .as_ref()
            .is_some_and(|client| client.actions.iter().any(|action| action == name))
    {
        details.push(format!(
            "{at}: 선언되지 않았거나 사용할 수 없는 클라이언트 동작입니다: {name}"
        ));
    }
}

fn valid_extension(value: &str) -> bool {
    (1..=16).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

/// 정의에 직접 적은 웹 주소의 규칙. `http://`나 `https://`로 시작하고 그 뒤가 비어 있지 않으며 공백이 없다.
pub fn valid_web_url(url: &str) -> bool {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    rest.is_some_and(|rest| !rest.is_empty() && !url.chars().any(char::is_whitespace))
}

/// 공개 HTTPS 요청에 쓸 origin만 허용한다.
pub fn valid_https_origin(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    let Some(url::Host::Domain(host)) = url.host() else {
        return false;
    };
    let authority_and_path = value.split_once("://").map(|(_, rest)| rest).unwrap_or("");
    let raw_path = authority_and_path
        .find('/')
        .map(|index| &authority_and_path[index..])
        .unwrap_or("");
    url.scheme() == "https"
        && !host.eq_ignore_ascii_case("localhost")
        && !host.to_ascii_lowercase().ends_with(".localhost")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.path() == "/"
        && (raw_path.is_empty() || raw_path == "/")
        && url.query().is_none()
        && url.fragment().is_none()
        && !value.chars().any(char::is_whitespace)
}

/// 공개 요청에서는 URL 인코딩으로 경로 구분자나 점을 우회할 수 없다.
pub fn valid_public_http_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    valid_request_path(path)
        && !["%25", "%2e", "%2f", "%5c"]
            .iter()
            .any(|encoded| lower.contains(encoded))
}

/// 선언된 공개 HTTPS 경로가 요청 경로를 허용하는지 확인한다.
pub fn allowed_public_http_path(paths: &[String], path: &str) -> bool {
    if !valid_public_http_path(path) {
        return false;
    }
    paths.iter().any(|allowed| {
        allowed == path
            || (allowed.len() > 1 && allowed.ends_with('/') && path.starts_with(allowed.as_str()))
    })
}

/// 연결 경로의 규칙(정의에 적은 것, 식이 낸 것, 코어와 서버가 실행 때 보는 것 모두).
/// `/`로 시작하고, `?`와 `#`를 담지 않으며(쿼리는 `query`로), `\`와 공백이 없다. `//`로 시작하지 않는다(다른 호스트로
/// 읽힐 수 있어서). 빈 조각(`/a//b`)은 허락하지 않는다. `/`만은 허락한다.
/// 조각은 점만으로 된 것(`.`, `..`)이 아니어야 한다. 조각 안의 퍼센트 인코딩 `%2e`(점), `%2f`(`/`), `%5c`(`\`)를
/// 풀어 본 결과(대소문자 무시)에 `.`이나 `..` 조각이 생겨도 거부한다(`%2e.`, `.%2e`, `%2e%2e`, `..%2fadmin` 등).
/// URL 파서나 원천 앞의 웹 서버(nginx 등)가 이것을 풀고 정규화해 연결 주소나 허용 경로 밖으로 나갈 수 있어서다.
/// 점이 끼지 않은 인코딩 `/`(예: `narrative%2Fa.yaml` 같은 식별자)는 받는다. NUL(`%00`)은 거부한다.
pub fn valid_request_path(path: &str) -> bool {
    if path == "/" {
        return true;
    }
    let Some(rest) = path.strip_prefix('/') else {
        return false;
    };
    if path.contains(['?', '#', '\\']) || path.chars().any(char::is_whitespace) {
        return false;
    }
    if path.to_ascii_lowercase().contains("%00") {
        return false;
    }
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    !rest.is_empty()
        && rest.split('/').all(|part| {
            let decoded = part
                .to_ascii_lowercase()
                .replace("%2e", ".")
                .replace("%2f", "/")
                .replace("%5c", "/");
            !part.is_empty()
                && decoded
                    .split('/')
                    .all(|piece| piece != "." && piece != "..")
        })
}

fn valid_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn valid_permission_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-' || *byte == b'_'
        })
}

fn validate_block(block: &Block, definition: &AppDefinition, details: &mut Vec<String>, at: &str) {
    let introduced_in = block.introduced_in();
    if definition.requires.blocks < introduced_in {
        details.push(format!(
            "{at}: {} 블록은 블록 세트 {introduced_in}판이라 requires.blocks가 {introduced_in} 이상이어야 합니다",
            block.type_name()
        ));
    }
    let item_menu = match block {
        Block::List { item_menu, .. }
        | Block::Table { item_menu, .. }
        | Block::Tree { item_menu, .. }
        | Block::Feed { item_menu, .. } => item_menu.as_ref(),
        _ => None,
    };
    if let Some(entries) = item_menu {
        for (index, entry) in entries.iter().enumerate() {
            if entry.label.trim().is_empty() {
                details.push(format!(
                    "{at}/item_menu/{index}/label: 메뉴 항목의 이름이 비어 있습니다"
                ));
            }
        }
    }
    let uses_v14_fields = match block {
        Block::Canvas { surface, .. } => !matches!(surface, Binding::Literal(Value::String(_))),
        Block::Timeline {
            viewport,
            on_viewport,
            controls,
            ..
        } => viewport.is_some() || on_viewport.is_some() || controls.is_some(),
        Block::Stack { wrap, .. } => wrap.is_some(),
        Block::Slider { value, .. } => {
            let initial = match value {
                Binding::Client(reference) => definition
                    .client
                    .as_ref()
                    .and_then(|client| client.outputs.get(&reference.client))
                    .map(|output| &output.default),
                _ => static_binding_value(value, definition),
            };
            initial.is_some_and(|value| {
                serde_json::from_value::<crate::client::Clock>(value.clone()).is_ok()
            })
        }
        Block::Section { actions, .. } => actions.is_some(),
        Block::Text {
            format,
            on_click,
            on_double_click,
            ..
        } => {
            matches!(format, crate::DisplayTextFormat::Time)
                || on_click.is_some()
                || on_double_click.is_some()
        }
        Block::Input {
            min,
            max,
            step,
            format,
            commit,
            focus,
            on_cancel,
            ..
        } => {
            min.is_some()
                || max.is_some()
                || step.is_some()
                || format.is_some()
                || commit.is_some()
                || focus.is_some()
                || on_cancel.is_some()
        }
        Block::Button {
            variant, pressed, ..
        } => matches!(variant, Binding::Literal(value) if value.as_str() == Some("chip")) || pressed.is_some(),
        _ => false,
    };
    if uses_v14_fields && definition.requires.blocks < 14 {
        details.push(format!("{at}: 새 필드는 블록 세트 14판이 필요합니다"));
    }
    match block {
        Block::Repeat { key, grid, .. } => {
            if key.trim().is_empty() {
                details.push(format!("{at}: repeat.key가 필요합니다"));
            }
            if matches!(
                grid,
                Some(crate::RepeatGrid {
                    columns: crate::RepeatColumns::Count(0),
                    ..
                })
            ) {
                details.push(format!("{at}: repeat grid.columns는 양수여야 합니다"));
            }
        }
        Block::Progress { max, .. } => {
            if !max.is_finite() || *max <= 0.0 {
                details.push(format!("{at}: progress max는 양수여야 합니다"));
            }
        }
        Block::When { .. } | Block::Dialog { .. } | Block::Tour { .. } | Block::Anchor { .. } => {}
        Block::Canvas { aspect_ratio, .. } => {
            if definition.client.is_none() {
                details.push(format!("{at}: canvas에는 client 선언이 필요합니다"));
            }
            if matches!(aspect_ratio, Some(Binding::Literal(value)) if value.as_f64().is_none_or(|ratio| !ratio.is_finite() || ratio <= 0.0))
            {
                details.push(format!("{at}: aspect_ratio는 유한한 양수여야 합니다"));
            }
        }
        Block::Timeline {
            duration,
            tracks,
            markers,
            ..
        } => {
            if let Some(Binding::Literal(value)) = duration {
                if value
                    .as_f64()
                    .is_none_or(|number| !number.is_finite() || number < 0.0)
                {
                    details.push(format!("{at}: duration은 유한한 0 이상의 수여야 합니다"));
                }
            }
            let mut ids = HashSet::new();
            if let Binding::Literal(value) = tracks {
                match serde_json::from_value::<Vec<crate::client::TimelineTrack>>(value.clone()) {
                    Ok(tracks) => {
                        for track in tracks {
                            if let Some(waveform) = &track.waveform {
                                let invalid_bound = |value: f64| !value.is_finite() || value < 0.0;
                                if waveform
                                    .peaks
                                    .iter()
                                    .any(|peak| !peak.is_finite() || !(0.0..=1.0).contains(peak))
                                    || waveform.start.is_some_and(invalid_bound)
                                    || waveform.end.is_some_and(invalid_bound)
                                    || waveform
                                        .start
                                        .zip(waveform.end)
                                        .is_some_and(|(start, end)| start > end)
                                {
                                    details.push(format!(
                                        "{at}: 파형의 값 또는 시간이 올바르지 않습니다"
                                    ));
                                }
                            }
                            if track.id.is_empty() || !ids.insert(track.id) {
                                details.push(format!("{at}: 트랙 id가 비었거나 중복됩니다"));
                            }
                            for item in track.items {
                                let invalid_seconds = match (&item.start, &item.end) {
                                    (Some(crate::client::TimelineTime::Seconds(start)), Some(crate::client::TimelineTime::Seconds(end))) => {
                                        !start.is_finite() || !end.is_finite() || *start < 0.0 || start > end
                                    }
                                    _ => false,
                                };
                                if item.id.is_empty()
                                    || !ids.insert(item.id)
                                    || invalid_seconds
                                {
                                    details.push(format!(
                                        "{at}: 구간 id 또는 시간이 올바르지 않습니다"
                                    ));
                                }
                            }
                        }
                    }
                    Err(_) => details.push(format!("{at}: 트랙 형식이 올바르지 않습니다")),
                }
            }
            if let Some(Binding::Literal(value)) = markers {
                match serde_json::from_value::<Vec<crate::client::TimelineMarker>>(value.clone()) {
                    Ok(markers) => {
                        for marker in markers {
                            let invalid_seconds = matches!(marker.time, crate::client::TimelineTime::Seconds(time) if !time.is_finite() || time < 0.0);
                            if marker.id.is_empty()
                                || !ids.insert(marker.id)
                                || invalid_seconds
                            {
                                details
                                    .push(format!("{at}: 마커 id 또는 시간이 올바르지 않습니다"));
                            }
                        }
                    }
                    Err(_) => details.push(format!("{at}: 마커 형식이 올바르지 않습니다")),
                }
            }
        }
        Block::Sandbox {
            asset,
            file,
            document,
            value,
            height,
            state_keys,
            storage_entries,
            ..
        } => {
            if [
                asset.is_some(),
                file.is_some(),
                document.is_some(),
                value.is_some(),
            ]
            .into_iter()
            .filter(|present| *present)
            .count()
                != 1
            {
                details.push(format!("{at}: sandbox 블록은 asset, file, document, value 가운데 꼭 하나만 가져야 합니다"));
            }
            if let Some(asset_id) = asset {
                if !definition.assets.iter().any(|decl| &decl.id == asset_id) {
                    details.push(format!("{at}: 선언되지 않은 자산입니다: {asset_id}"));
                }
            }
            if let Some(file) = file {
                validate_file_ref(file, definition, details, at);
            }
            if let Some(document) = document {
                validate_markdown_binding(
                    &None,
                    &Some(document.clone()),
                    false,
                    definition,
                    details,
                    at,
                );
            }
            if let Some(value) = value {
                validate_ui_binding(value, definition, details, &format!("{at}/value"));
            }
            if height.is_some_and(|h| !(120..=2400).contains(&h)) {
                details.push(format!("{at}: sandbox의 height는 120부터 2400까지입니다"));
            }
            for key in state_keys {
                validate_state_key(key, definition, details, at);
            }
            if !storage_entries.is_empty() {
                validate_module_version("storage", 1, definition, details, at);
                for entry in storage_entries {
                    if !definition
                        .storage
                        .as_ref()
                        .is_some_and(|storage| storage.entries.iter().any(|decl| &decl.id == entry))
                    {
                        details.push(format!("{at}: 선언되지 않은 저장 항목입니다: {entry}"));
                    }
                }
            }
        }
        Block::Slider {
            value,
            min,
            max,
            step,
            ..
        } => {
            if !matches!(value, Binding::Literal(clock) if serde_json::from_value::<crate::client::Clock>(clock.clone()).is_ok())
            {
                validate_control_binding(value, definition, details, at);
            }
            if !min.is_finite() || !max.is_finite() || min >= max {
                details.push(format!("{at}: slider의 min과 max가 올바르지 않습니다"));
            }
            if step.is_some_and(|s| !s.is_finite() || s <= 0.0) {
                details.push(format!("{at}: slider의 step은 0보다 커야 합니다"));
            }
        }
        Block::Color {
            value, disabled, ..
        } => {
            validate_control_binding(value, definition, details, at);
            if disabled.is_some() && definition.requires.blocks < 12 {
                details.push(format!(
                    "{at}: color.disabled는 blocks 12 이상이 필요합니다"
                ));
            }
        }
        Block::Map {
            points, selected, ..
        } => {
            if let Some(selected) = selected {
                validate_state_key(&selected.state, definition, details, at);
            }
            if let data::Binding::Literal(value) = points {
                match serde_json::from_value::<Vec<data::MapPoint>>(value.clone()) {
                    Ok(points)
                        if points.iter().all(|point| {
                            point.lat.is_finite()
                                && (-90.0..=90.0).contains(&point.lat)
                                && point.lng.is_finite()
                                && (-180.0..=180.0).contains(&point.lng)
                                && point
                                    .size
                                    .is_none_or(|size| size.is_finite() && size >= 0.0)
                        }) => {}
                    _ => details.push(format!(
                        "{at}/points: 지도 지점 또는 좌표가 올바르지 않습니다"
                    )),
                }
            }
        }
        Block::Metrics { items, columns } => {
            if columns.is_some_and(|columns| !(1..=8).contains(&columns)) {
                details.push(format!("{at}: metrics columns는 1부터 8까지입니다"));
            }
            if let data::Binding::Literal(value) = items {
                match serde_json::from_value::<Vec<data::MetricItem>>(value.clone()) {
                    Ok(items) => {
                        for item in items {
                            if let Some(media) = item.image {
                                validate_media_asset(&media, definition, details, at);
                            }
                        }
                    }
                    Err(_) => details.push(format!("{at}: metrics items 형식이 올바르지 않습니다")),
                }
            }
        }
        Block::ButtonGrid {
            columns, buttons, ..
        } => {
            if !(1..=8).contains(columns) {
                details.push(format!("{at}: button_grid columns는 1부터 8까지입니다"));
            } else if let data::Binding::Literal(value) = buttons {
                if let Err(error) = data::validate_button_grid_items(value, u32::from(*columns)) {
                    details.push(format!("{at}: {error}"));
                }
            }
        }
        Block::Chart { kind, series, .. } => {
            if let data::Binding::Literal(value) = series {
                match serde_json::from_value::<Vec<data::ChartSeries>>(value.clone()) {
                    Err(_) => details.push(format!("{at}: chart series 형식이 올바르지 않습니다")),
                    Ok(series) if *kind == crate::ChartKind::Candlestick => {
                        if series.iter().flat_map(|s| &s.points).any(|p| {
                            match (p.open, p.high, p.low, p.close) {
                                (Some(o), Some(h), Some(l), Some(c)) => {
                                    ![o, h, l, c].iter().all(|v| v.is_finite())
                                        || l > o.min(c)
                                        || h < o.max(c)
                                        || l > h
                                }
                                _ => true,
                            }
                        }) {
                            details.push(format!("{at}: candlestick chart 점에는 올바른 open, high, low, close 수치가 필요합니다"));
                        }
                    }
                    _ => {}
                }
            }
        }
        Block::Split {
            sizes, children, ..
        } => {
            if children.len() < 2 {
                details.push(format!("{at}: split에는 자식 블록이 둘 이상 필요합니다"));
            }
            if let Some(sizes) = sizes {
                if sizes.len() != children.len() {
                    details.push(format!("{at}: split sizes 개수가 children과 다릅니다"));
                }
                if sizes.iter().any(|size| *size <= 0.0) {
                    details.push(format!("{at}: split sizes는 모두 0보다 커야 합니다"));
                }
            }
        }
        Block::Tree {
            items,
            root,
            extensions,
            selected,
            on_select,
            ..
        } => match (items, root) {
            (Some(items), None) => {
                if !extensions.is_empty() {
                    details.push(format!("{at}: 데이터 tree에는 extensions를 쓸 수 없습니다"));
                }
                validate_ui_binding(items, definition, details, &format!("{at}/items"));
                if let Some(selected) = selected {
                    validate_state_key(&selected.state, definition, details, at);
                }
            }
            (None, Some(root)) => {
                validate_permission_declared_module(
                    &root.permission,
                    "files",
                    definition,
                    details,
                    at,
                );
                match find_permission(definition, &root.permission) {
                    Some(PermissionDecl::Files {
                        scope: FilesScope::Folder,
                        ..
                    }) => {}
                    Some(PermissionDecl::Files { .. }) => details.push(format!(
                        "{at}: 폴더 tree의 root 권한은 folder 범위여야 합니다"
                    )),
                    Some(_) => details.push(format!("{at}: tree의 root는 files 권한이어야 합니다")),
                    None => {}
                }
                for extension in extensions {
                    if !valid_extension(extension) {
                        details.push(format!("{at}: extensions의 확장자는 점 없이 소문자와 숫자 1~16자여야 합니다: {extension}"));
                    }
                }
                match (selected, on_select) {
                    (Some(selected), Some(Actions::One(on_select))) => {
                        validate_state_key(&selected.state, definition, details, at);
                        validate_state_key(&on_select.set_state, definition, details, at);
                    }
                    _ => details.push(format!(
                        "{at}: 폴더 tree에는 selected와 단일 on_select가 필요합니다"
                    )),
                }
            }
            _ => details.push(format!(
                "{at}: tree 블록은 items와 root 가운데 꼭 하나만 가져야 합니다"
            )),
        },
        Block::Folder {
            root,
            extensions,
            selected,
            ..
        } => {
            match root {
                FolderRoot::Files { permission } => {
                    validate_permission_declared_module(
                        permission, "files", definition, details, at,
                    );
                    match find_permission(definition, permission) {
                        Some(PermissionDecl::Files {
                            scope: FilesScope::Folder,
                            ..
                        }) => {}
                        Some(PermissionDecl::Files { .. }) => details.push(format!(
                            "{at}: folder의 파일 root 권한은 folder 범위여야 합니다"
                        )),
                        Some(_) => {
                            details.push(format!("{at}: folder의 root는 files 권한이어야 합니다"))
                        }
                        None => {}
                    }
                    for extension in extensions {
                        if !valid_extension(extension) {
                            details.push(format!("{at}: extensions의 확장자는 점 없이 소문자와 숫자 1~16자여야 합니다: {extension}"));
                        }
                    }
                }
                FolderRoot::Collection { entry } => {
                    validate_module_version("storage", 3, definition, details, at);
                    match definition
                        .storage
                        .as_ref()
                        .and_then(|storage| storage.entries.iter().find(|item| item.id == *entry))
                    {
                        Some(storage_entry) if storage_entry.collection => {}
                        Some(_) => details.push(format!(
                            "{at}: folder의 storage root는 문서 모음이어야 합니다"
                        )),
                        None => details.push(format!(
                            "{at}: 선언되지 않은 storage 문서 모음입니다: {entry}"
                        )),
                    }
                    for extension in extensions {
                        if !valid_extension(extension) {
                            details.push(format!("{at}: extensions의 확장자는 점 없이 소문자와 숫자 1~16자여야 합니다: {extension}"));
                        }
                    }
                }
            }
            if let Some(selected) = selected {
                validate_state_key(&selected.state, definition, details, at);
            }
        }
        Block::Markdown {
            file,
            document,
            value,
            read_only,
        } => match (file, document, value) {
            (Some(file), None, None) => {
                validate_file_ref(file, definition, details, at);
                if !*read_only
                    && find_permission(definition, &file.permission)
                        .is_some_and(|permission| permission.access() != FileAccess::Readwrite)
                {
                    details.push(format!(
                        "{at}: markdown 파일 권한 {}는 readwrite여야 합니다",
                        file.permission
                    ));
                }
            }
            (None, Some(document), None) => {
                validate_markdown_binding(
                    &None,
                    &Some(document.clone()),
                    false,
                    definition,
                    details,
                    at,
                );
            }
            (None, None, Some(value)) => {
                validate_ui_binding(value, definition, details, &format!("{at}/value"))
            }
            _ => details.push(format!(
                "{at}: markdown 블록은 file, document, value 가운데 꼭 하나만 가져야 합니다"
            )),
        },
        Block::Code {
            value,
            file,
            read_only,
            ..
        } => match (value, file) {
            (Some(value), None) => {
                validate_ui_binding(value, definition, details, &format!("{at}/value"))
            }
            (None, Some(file)) => {
                validate_file_ref(file, definition, details, at);
                if !*read_only
                    && find_permission(definition, &file.permission)
                        .is_some_and(|permission| permission.access() != FileAccess::Readwrite)
                {
                    details.push(format!(
                        "{at}: code 파일 권한 {}는 readwrite여야 합니다",
                        file.permission
                    ));
                }
            }
            _ => details.push(format!("{at}: code는 value와 file 가운데 꼭 하나를 씁니다")),
        },
        Block::HtmlView {
            document,
            file,
            value,
            selected_doc,
            on_select_doc,
            selected_revision,
            on_select_revision,
        } => match (document, file, value) {
            (Some(document), None, None) => {
                validate_module_version("storage", 3, definition, details, at);
                let entry = definition.storage.as_ref().and_then(|storage| {
                    storage
                        .entries
                        .iter()
                        .find(|entry| entry.id == document.entry)
                });
                match entry {
                    Some(entry) if entry.kind == StorageKind::Md && entry.collection => {}
                    Some(_) => details.push(format!(
                        "{at}: html_view는 md 문서 모음이 필요합니다: {}",
                        document.entry
                    )),
                    None => details.push(format!(
                        "{at}: document가 storage 선언에 없습니다: {}",
                        document.entry
                    )),
                }
                for key in [
                    selected_doc.as_ref().map(|value| &value.state),
                    on_select_doc.as_ref().map(|value| &value.set_state),
                    selected_revision.as_ref().map(|value| &value.state),
                    on_select_revision.as_ref().map(|value| &value.set_state),
                ]
                .into_iter()
                .flatten()
                {
                    validate_state_key(key, definition, details, at);
                }
            }
            (None, Some(file), None) => {
                validate_file_ref(file, definition, details, at);
                if selected_doc.is_some()
                    || on_select_doc.is_some()
                    || selected_revision.is_some()
                    || on_select_revision.is_some()
                {
                    details.push(format!("{at}: file이나 value를 쓰는 html_view에는 문서/리비전 선택 상태를 둘 수 없습니다"));
                }
            }
            (None, None, Some(value)) => {
                validate_ui_binding(value, definition, details, &format!("{at}/value"));
                if selected_doc.is_some()
                    || on_select_doc.is_some()
                    || selected_revision.is_some()
                    || on_select_revision.is_some()
                {
                    details.push(format!("{at}: file이나 value를 쓰는 html_view에는 문서/리비전 선택 상태를 둘 수 없습니다"));
                }
            }
            _ => details.push(format!(
                "{at}: html_view 블록은 document, file, value 가운데 꼭 하나만 가져야 합니다"
            )),
        },
        Block::Chat {
            client: chat_client,
            footer,
            loading,
        } => {
            if let Some(loading) = loading {
                validate_ui_binding(loading, definition, details, &format!("{at}/loading"));
            }
            if let Some(chat_client) = chat_client {
                if definition.agent.is_some() {
                    details.push(format!(
                        "{at}: chat.client은 앱의 대화 제공자 설정과 함께 쓸 수 없습니다"
                    ));
                }
                validate_module_version("client", 4, definition, details, at);
                let Some(client) = &definition.client else {
                    details.push(format!(
                        "{at}: chat.client에는 앱 정의의 client가 필요합니다"
                    ));
                    return;
                };
                if !client
                    .channels
                    .iter()
                    .any(|channel| channel == &chat_client.channel)
                {
                    details.push(format!(
                        "{at}/client/channel: 선언되지 않은 client 채널입니다: {}",
                        chat_client.channel
                    ));
                }
                for (field, action) in [
                    ("on_send", &chat_client.on_send),
                    ("on_cancel", &chat_client.on_cancel),
                    ("on_attachment", &chat_client.on_attachment),
                ] {
                    if !client.actions.iter().any(|declared| declared == action) {
                        details.push(format!("{at}/client/{field}: client.actions에 선언되지 않은 동작입니다: {action}"));
                    }
                }
            } else if footer.is_some() {
                details.push(format!(
                    "{at}: chat.footer에는 chat.client 연결이 필요합니다"
                ));
            } else {
                if !definition.requires.modules.contains_key("agent") {
                    details.push(format!(
                        "{at}: chat이 사용하는 agent 모듈을 requires.modules에 선언해야 합니다"
                    ));
                }
            }
        }
        Block::WebView {
            url, on_navigate, ..
        } => {
            if !definition.requires.modules.contains_key("web") {
                details.push(format!(
                    "{at}: web_view가 사용하는 web 모듈을 requires.modules에 선언해야 합니다"
                ));
            }
            match url {
                UrlValue::State(reference) => {
                    validate_state_key(&reference.state, definition, details, at)
                }
                UrlValue::Literal(url) => {
                    if !valid_web_url(url) {
                        details.push(format!(
                            "{at}: web_view 주소는 http:// 나 https:// 로 시작하고 공백이 없어야 합니다: {url}"
                        ));
                    }
                }
            }
            if let Some(on_navigate) = on_navigate {
                validate_state_key(&on_navigate.set_state, definition, details, at);
            }
        }
        Block::Explorer {
            root,
            folder,
            on_folder,
            view,
            on_view,
        } => {
            // 탐색기의 root만 scope: pc 권한을 가리킬 수 있다(계약 14판).
            validate_permission_declared_module(&root.permission, "files", definition, details, at);
            let reads = [folder, view]
                .into_iter()
                .flatten()
                .map(|reference| &reference.state);
            let writes = [on_folder, on_view]
                .into_iter()
                .flatten()
                .map(|reference| &reference.set_state);
            let keys: Vec<&String> = reads.chain(writes).collect();
            if !keys.is_empty() && definition.requires.blocks < 5 {
                details.push(format!(
                    "{at}: explorer의 folder, on_folder, view, on_view는 블록 세트 5판이라 requires.blocks가 5 이상이어야 합니다"
                ));
            }
            for key in keys {
                validate_state_key(key, definition, details, at);
            }
        }
        Block::Stack { fill, children, .. } => {
            if children.is_empty() {
                details.push(format!("{at}: stack에는 자식 블록이 하나 이상 필요합니다"));
            }
            if matches!(fill, Some(crate::StackFill::Index(index)) if *index as usize >= children.len()) {
                details.push(format!("{at}: stack의 fill이 자식 수를 넘습니다"));
            }
        }
        Block::Tabs {
            tabs,
            header,
            collapsible,
            selected,
            on_change,
            ..
        } => {
            if *collapsible && !*header {
                details.push(format!(
                    "{at}: tabs.collapsible은 header가 있을 때만 쓸 수 있습니다"
                ));
            }
            if tabs.is_empty() {
                details.push(format!("{at}: tabs에는 탭이 하나 이상 필요합니다"));
            }
            for tab in tabs {
                if matches!(&tab.label, Binding::Literal(Value::String(label)) if label.trim().is_empty())
                {
                    details.push(format!("{at}: 탭 이름이 비어 있습니다"));
                }
            }
            if let Some(selected) = selected {
                validate_state_key(&selected.state, definition, details, at);
            }
            if let Some(on_change) = on_change {
                validate_state_key(&on_change.set_state, definition, details, at);
            }
        }
        Block::Toolbar { start, end } => {
            for child in start.iter().chain(end) {
                if !matches!(
                    child,
                    Block::Input { .. }
                        | Block::Select { .. }
                        | Block::Slider { .. }
                        | Block::Color { .. }
                        | Block::Toggle { .. }
                        | Block::Button { .. }
                        | Block::Text { .. }
                ) {
                    details.push(format!(
                        "{at}: toolbar에는 input, select, slider, color, toggle, button, text만 둡니다({})",
                        child.type_name()
                    ));
                }
            }
        }
        Block::List { selected, layout, .. } => {
            if *layout == crate::ListLayout::Icons && definition.requires.blocks < crate::LIST_ICONS_BLOCK_SET_VERSION {
                let version = crate::LIST_ICONS_BLOCK_SET_VERSION;
                details.push(format!("{at}: list의 icons 배치는 블록 세트 {version}판 이상이 필요합니다"));
            }
            if let Some(selected) = selected {
                validate_control_binding(selected, definition, details, at);
            }
        }
        Block::Feed {
            columns,
            copy,
            collapsible,
            selected,
            ..
        } => {
            if (*columns || *copy) && definition.requires.blocks < 7 {
                details.push(format!(
                    "{at}: feed의 columns, copy는 블록 세트 7판이라 requires.blocks가 7 이상이어야 합니다"
                ));
            }
            if *collapsible && definition.requires.blocks < 10 {
                details.push(format!(
                    "{at}: feed의 collapsible은 블록 세트 10판이라 requires.blocks가 10 이상이어야 합니다"
                ));
            }
            if let Some(selected) = selected {
                validate_state_key(&selected.state, definition, details, at);
            }
        }
        Block::Table {
            columns,
            sort,
            selected,
            selection,
            row_header,
            on_select,
            ..
        } => {
            let static_columns = match columns {
                crate::TableColumns::Static(columns) => Some(columns),
                crate::TableColumns::Bound(_) => None,
            };
            let cell = *selection == crate::TableSelection::Cell;
            let uses_grid = static_columns.is_none()
                || cell
                || row_header.is_some()
                || static_columns.is_some_and(|columns| {
                    columns.iter().any(|column| {
                        column.format == crate::CellFormat::Content || column.max_lines.is_some()
                    })
                });
            if uses_grid && definition.requires.blocks < crate::TABLE_GRID_BLOCK_SET_VERSION {
                let version = crate::TABLE_GRID_BLOCK_SET_VERSION;
                details.push(format!(
                    "{at}: table의 동적 열과 칸 격자는 블록 세트 {version}판 이상이 필요합니다"
                ));
            }
            if cell && (selected.is_none() || on_select.is_none()) {
                details.push(format!(
                    "{at}: table 칸 선택에는 selected와 on_select가 필요합니다"
                ));
            }
            if !cell && row_header.is_some() {
                details.push(format!(
                    "{at}: table의 row_header는 칸 선택에서만 쓸 수 있습니다"
                ));
            }
            if cell && sort.is_some() {
                details.push(format!("{at}: table 칸 선택에는 sort를 쓸 수 없습니다"));
            }
            if definition.requires.blocks < 9
                && static_columns.is_some_and(|columns| {
                    columns.iter().any(|c| {
                        matches!(
                            c.format,
                            crate::CellFormat::Delta | crate::CellFormat::Sparkline
                        )
                    })
                })
            {
                details.push(format!("{at}: table의 delta, sparkline 열 형식은 블록 세트 9판이라 requires.blocks가 9 이상이어야 합니다"));
            }
            if static_columns.is_some_and(|columns| columns.is_empty()) {
                details.push(format!("{at}: table에는 열이 하나 이상 필요합니다"));
            }
            let mut fields = HashSet::new();
            for column in static_columns.into_iter().flatten() {
                if !fields.insert(column.field.as_str()) {
                    details.push(format!(
                        "{at}: table 열의 field가 겹칩니다: {}",
                        column.field
                    ));
                }
                if column.max_lines.is_some_and(|lines| {
                    !(1..=3).contains(&lines) || column.format != crate::CellFormat::Content
                }) {
                    details.push(format!(
                        "{at}: table 열 {}의 max_lines는 content에서 1부터 3까지입니다",
                        column.field
                    ));
                }
            }
            if let (Some(columns), Some(header)) = (static_columns, row_header) {
                if !columns.first().is_some_and(|column| {
                    column.field == *header && column.format == crate::CellFormat::Text
                }) {
                    details.push(format!(
                        "{at}: table의 row_header는 첫 text 열이어야 합니다: {header}"
                    ));
                }
                if cell && columns.len() < 2 {
                    details.push(format!(
                        "{at}: table 칸 선택에는 데이터 열이 하나 이상 필요합니다"
                    ));
                }
            }
            let initial = match columns {
                crate::TableColumns::Bound(Binding::State(reference)) => {
                    definition.state.get(&reference.state)
                }
                crate::TableColumns::Bound(Binding::Client(reference)) => definition
                    .client
                    .as_ref()
                    .and_then(|client| client.outputs.get(&reference.client))
                    .map(|output| &output.default),
                _ => None,
            };
            if let Some(initial) = initial.filter(|value| !value.is_null()) {
                let entries = match initial {
                    Value::Array(values) => values.clone(),
                    value => vec![value.clone()],
                };
                if !entries.is_empty() {
                    match serde_json::from_value::<Vec<crate::Column>>(Value::Array(entries)) {
                        Ok(columns) => {
                            let mut initial_fields = HashSet::new();
                            for column in &columns {
                                if !initial_fields.insert(&column.field) {
                                    details.push(format!(
                                        "{at}/columns: table 열의 field가 겹칩니다: {}",
                                        column.field
                                    ));
                                }
                                if column.max_lines.is_some_and(|lines| {
                                    !(1..=3).contains(&lines)
                                        || column.format != crate::CellFormat::Content
                                }) {
                                    details.push(format!("{at}/columns: table 열 {}의 max_lines는 content에서 1부터 3까지입니다", column.field));
                                }
                            }
                            if let Some(header) = row_header {
                                if !columns.first().is_some_and(|column| {
                                    column.field == *header
                                        && column.format == crate::CellFormat::Text
                                }) {
                                    details.push(format!("{at}/columns: table의 row_header는 첫 text 열이어야 합니다: {header}"));
                                }
                                if cell && columns.len() < 2 {
                                    details.push(format!("{at}/columns: table 칸 선택에는 데이터 열이 하나 이상 필요합니다"));
                                }
                            }
                        }
                        Err(_) => details.push(format!(
                            "{at}/columns: table 열의 초기값이 열 형식과 다릅니다"
                        )),
                    }
                }
            }
            if let Some(sort) = sort {
                if static_columns.is_some() && !fields.contains(sort.field.as_str()) {
                    details.push(format!(
                        "{at}: sort의 field가 열에 없습니다: {}",
                        sort.field
                    ));
                }
            }
            if let Some(selected) = selected {
                validate_control_binding(selected, definition, details, at);
            }
        }
        Block::Properties { fields, .. } => {
            if fields.is_empty() {
                details.push(format!("{at}: properties에는 줄이 하나 이상 필요합니다"));
            }
        }
        Block::Input {
            value,
            read_only,
            rows,
            columns,
            label,
            ..
        } => {
            validate_control_binding(value, definition, details, at);
            if let Some(read_only) = read_only {
                validate_control_binding(read_only, definition, details, at);
                if definition.requires.blocks < crate::INPUT_READ_ONLY_BLOCK_SET_VERSION {
                    details.push(format!(
                        "{at}: input.read_only는 blocks {} 이상이 필요합니다",
                        crate::INPUT_READ_ONLY_BLOCK_SET_VERSION
                    ));
                }
            }
            if label.is_some() && definition.requires.blocks < 12 {
                details.push(format!("{at}: input.label은 blocks 12 이상이 필요합니다"));
            }
            if let Some(rows) = rows {
                if !(1..=20).contains(rows) {
                    details.push(format!("{at}: input의 rows는 1부터 20까지입니다"));
                }
                if definition.requires.blocks < 11 {
                    details.push(format!("{at}: input.rows는 blocks 11 이상이 필요합니다"));
                }
            }
            if columns.is_some_and(|columns| columns == 0) {
                details.push(format!("{at}: input.columns는 양수여야 합니다"));
            }
        }
        Block::Select {
            value,
            label,
            options,
            disabled,
            ..
        } => {
            validate_control_binding(value, definition, details, at);
            if let Some(disabled) = disabled {
                validate_control_binding(disabled, definition, details, at);
            }
            let grouped = matches!(options, Binding::Literal(Value::Array(items)) if items.iter().any(|item| item.get("name").is_some() && item.get("options").is_some()));
            if (label.is_some() || grouped) && definition.requires.blocks < 12 {
                details.push(format!(
                    "{at}: select.label과 묶음 선택지는 blocks 12 이상이 필요합니다"
                ));
            }
        }
        Block::Toggle {
            value, disabled, ..
        } => {
            validate_control_binding(value, definition, details, at);
            if let Some(disabled) = disabled {
                validate_control_binding(disabled, definition, details, at);
            }
        }
        Block::Notice {
            message,
            error_id,
            actions,
            ..
        } => {
            validate_ui_binding(message, definition, details, at);
            if let Some(error_id) = error_id {
                validate_ui_binding(error_id, definition, details, at);
            }
            for (index, action) in actions.iter().enumerate() {
                let action_at = format!("{at}/actions/{index}");
                validate_ui_binding(&action.label, definition, details, &action_at);
                validate_actions(
                    &action.on_click,
                    definition,
                    details,
                    &format!("{action_at}/on_click"),
                );
            }
        }
        Block::Button {
            label,
            icon,
            variant,
            preview,
            ..
        } => {
            validate_ui_binding(variant, definition, details, &format!("{at}/variant"));
            if let Binding::Literal(value) = variant {
                if serde_json::from_value::<crate::ButtonVariant>(value.clone()).is_err() {
                    details.push(format!("{at}/variant: 단추 강조 이름이 올바르지 않습니다"));
                }
            }
            if definition.requires.blocks < 12
                && (!matches!(label, Binding::Literal(_))
                    || icon
                        .as_ref()
                        .is_some_and(|value| !matches!(value, Binding::Literal(_))))
            {
                details.push(format!(
                    "{at}: button의 동적 label과 icon은 blocks 12 이상이 필요합니다"
                ));
            }
            if let Binding::Literal(value) = label {
                if value.as_str().is_none_or(|text| text.trim().is_empty()) {
                    details.push(format!("{at}: button의 label이 비어 있습니다"));
                }
            }
            if let Some(Binding::Literal(value)) = icon {
                if value
                    .as_str()
                    .is_none_or(|name| !data::ICON_NAMES.contains(&name))
                {
                    details.push(format!("{at}: 쉘에 없는 아이콘입니다: {value}"));
                }
            }
            if let Some(preview) = preview {
                match preview.as_ref() {
                    Block::Image { .. }
                    | Block::Canvas {
                        on_pointer: None, ..
                    } => {}
                    Block::Canvas { .. } => details.push(format!(
                        "{at}/preview: canvas 미리보기는 on_pointer 없이 읽기 전용이어야 합니다"
                    )),
                    _ => details.push(format!(
                        "{at}/preview: button.preview는 canvas 또는 image여야 합니다"
                    )),
                }
            }
        }
        Block::Image { src, .. } | Block::Media { src, .. } => {
            if let Binding::Literal(value) = src {
                if !value.is_null() {
                    match serde_json::from_value::<data::MediaRef>(value.clone()) {
                        Ok(media) => validate_media_asset(&media, definition, details, at),
                        Err(_) => {
                            details.push(format!("{at}: 미디어 참조 형식이 올바르지 않습니다"))
                        }
                    }
                }
            }
        }
        Block::Section { .. } | Block::Text { .. } => {}
    }
}

fn validate_media_asset(
    media: &data::MediaRef,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    if let data::MediaRef::Asset(asset) = media {
        if !definition
            .assets
            .iter()
            .any(|decl| decl.id == asset.asset && asset.version.is_none_or(|v| v == decl.version))
        {
            details.push(format!(
                "{at}: 선언되지 않은 자산 또는 판입니다: {}",
                asset.asset
            ));
        }
    }
}

fn find_permission<'a>(definition: &'a AppDefinition, id: &str) -> Option<&'a PermissionDecl> {
    definition
        .permissions
        .iter()
        .find(|permission| permission.id() == id)
}

fn validate_markdown_binding(
    file: &Option<FileRef>,
    document: &Option<crate::DocumentRef>,
    editable: bool,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    match (file, document) {
        (Some(file), None) => {
            validate_file_ref(file, definition, details, at);
            if editable
                && find_permission(definition, &file.permission)
                    .is_some_and(|permission| permission.access() != FileAccess::Readwrite)
            {
                details.push(format!(
                    "{at}: markdown 파일 권한 {}는 readwrite여야 합니다",
                    file.permission
                ));
            }
        }
        (None, Some(document)) => {
            let entry = definition.storage.as_ref().and_then(|storage| {
                storage
                    .entries
                    .iter()
                    .find(|entry| entry.id == document.entry)
            });
            match entry {
                Some(entry) if entry.kind == StorageKind::Md => {
                    validate_document_ref(document, entry, definition, details, at);
                }
                Some(_) => details.push(format!(
                    "{at}: document는 md 저장 항목이어야 합니다: {}",
                    document.entry
                )),
                None => details.push(format!(
                    "{at}: document가 storage 선언에 없습니다: {}",
                    document.entry
                )),
            }
            validate_module_version("storage", 1, definition, details, at);
        }
        (Some(_), Some(_)) => details.push(format!("{at}: file과 document를 함께 쓸 수 없습니다")),
        (None, None) => details.push(format!("{at}: file과 document 가운데 하나가 필요합니다")),
    }
}

fn validate_document_ref(
    document: &crate::DocumentRef,
    entry: &crate::app_storage::StorageEntryDecl,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    match (entry.collection, &document.doc) {
        (true, None) => details.push(format!(
            "{at}: document 모음에는 doc이 필요합니다: {}",
            document.entry
        )),
        (false, Some(_)) => details.push(format!(
            "{at}: 고정 document에는 doc을 쓸 수 없습니다: {}",
            document.entry
        )),
        (true, Some(crate::StringOrStateRef::String(doc))) => {
            if !crate::app_storage::valid_collection_doc(doc) {
                details.push(format!("{at}: document의 doc 경로가 올바르지 않습니다"));
            }
        }
        (true, Some(crate::StringOrStateRef::State(state))) => {
            validate_state_key(&state.state, definition, details, at);
        }
        (false, None) => {}
    }
}

fn validate_permission(
    permission_id: &str,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    if find_permission(definition, permission_id).is_none() {
        details.push(format!(
            "{at}: 선언되지 않은 권한을 가리킵니다: {permission_id}"
        ));
    }
}

fn is_pc_scope(permission: &PermissionDecl) -> bool {
    matches!(
        permission,
        PermissionDecl::Files {
            scope: FilesScope::Pc,
            ..
        }
    )
}

/// 권한이 선언되어 있고 그 모듈이 `module`인지. `files` 권한이면 `scope: pc`가 아니어야 한다
/// (그 범위는 `explorer`의 root만 쓴다, 계약 14판).
fn validate_permission_module(
    permission_id: &str,
    module: &str,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    validate_permission_declared_module(permission_id, module, definition, details, at);
    if find_permission(definition, permission_id).is_some_and(is_pc_scope) {
        details.push(format!(
            "{at}: 권한 {permission_id}는 scope가 pc라 explorer의 root에만 쓸 수 있습니다"
        ));
    }
}

/// 권한이 선언되어 있고 그 모듈이 `module`인지만 본다.
fn validate_permission_declared_module(
    permission_id: &str,
    module: &str,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    match find_permission(definition, permission_id) {
        None => details.push(format!(
            "{at}: 선언되지 않은 권한을 가리킵니다: {permission_id}"
        )),
        Some(permission) if permission.module() != module => details.push(format!(
            "{at}: 권한 {permission_id}는 {module} 권한이어야 합니다(지금 {})",
            permission.module()
        )),
        Some(_) => {}
    }
}

fn validate_state_key(key: &str, definition: &AppDefinition, details: &mut Vec<String>, at: &str) {
    if !definition.state.contains_key(key) {
        details.push(format!("{at}: 선언되지 않은 상태 키를 가리킵니다: {key}"));
    }
}

fn validate_file_ref(
    file: &FileRef,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    validate_permission_module(&file.permission, "files", definition, details, at);
    validate_file_path(&file.path, definition, details, at);
}

fn validate_file_path(
    path: &PathValue,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    if let PathValue::State(reference) = path {
        validate_state_key(&reference.state, definition, details, at);
    } else if let PathValue::Literal(path) = path {
        if !valid_relative_path(path, false) {
            details.push(format!("{at}: 고른 폴더 밖 경로를 요구합니다: {path}"));
        }
    }
}

/// [`crate::FileRef`]의 경로 규칙. `allow_root`면 빈 문자열(고른 폴더 자체)을 허락한다.
pub fn valid_relative_path(path: &str, allow_root: bool) -> bool {
    if path.is_empty() {
        return allow_root;
    }
    if path.contains('\\') || path.contains(':') || path.contains('\0') {
        return false;
    }
    path.split('/')
        .all(|part| !part.is_empty() && part != "." && part != "..")
}

#[cfg(test)]
mod profiler_permission_tests {
    use super::parse_app_definition;
    use serde_json::json;

    #[test]
    fn underscore_permission_requires_profiler_module() {
        let mut definition = json!({"id":"sample","name":"시험","requires":{"blocks":4,"modules":{"profiler":1}},"permissions":[{"module":"profiler","id":"core_profiler","label":"성능"}],"ui":{"type":"text","value":"시험"}});
        assert!(parse_app_definition(&definition.to_string()).is_ok());
        definition["requires"]["modules"] = json!({"files":1});
        definition["permissions"][0] =
            json!({"module":"files","id":"core_profiler","label":"파일","access":"read"});
        assert!(parse_app_definition(&definition.to_string()).is_err());
    }

    #[test]
    fn storage_collection_requires_module_version_three() {
        let mut definition = json!({
            "id":"collection-version",
            "name":"문서 모음",
            "requires":{"blocks":6,"modules":{"storage":3}},
            "storage":{"entries":[{
                "id":"documents",
                "key":"documents",
                "kind":"md",
                "collection":true,
                "default":"",
                "label":"문서",
                "presentation":"hidden"
            }]},
            "ui":{"type":"text","value":"문서"}
        });
        assert!(parse_app_definition(&definition.to_string()).is_ok());

        definition["requires"]["modules"]["storage"] = json!(1);
        assert!(parse_app_definition(&definition.to_string()).is_err());
    }
}
