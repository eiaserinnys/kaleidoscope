//! 앱 정의 검사. 쉘의 코어와 오케스트레이터가 이 한 곳의 검사를 같이 쓴다.
//! 규칙은 [`AppDefinition`]의 doc 주석에 있다.

use std::collections::{BTreeMap, HashSet};

use serde_json::Value;

use crate::{
    AppDefinition, Block, CoreError, ErrorCode, FileAccess, PathValue, PermissionDecl, UrlValue,
    BLOCK_SET_VERSION, MODULE_VERSIONS,
};

/// 앱 정의 JSON 원문을 읽고 검사한다. 통과하면 정의를, 걸리면 `unsupported_app`이나
/// `invalid_app_definition`(걸린 것은 `details`)을 돌려준다.
pub fn parse_app_definition(definition_json: &str) -> Result<AppDefinition, CoreError> {
    let value: Value = serde_json::from_str(definition_json).map_err(|parse_error| {
        CoreError::with_details(
            ErrorCode::InvalidAppDefinition,
            vec![format!("앱 정의 JSON을 읽을 수 없습니다: {parse_error}")],
        )
    })?;

    if requires_unsupported(&value) {
        return Err(CoreError::new(ErrorCode::UnsupportedApp));
    }

    let definition: AppDefinition = serde_json::from_value(value).map_err(|parse_error| {
        CoreError::with_details(
            ErrorCode::InvalidAppDefinition,
            vec![format!("앱 정의 형식이 올바르지 않습니다: {parse_error}")],
        )
    })?;

    let details = validate(&definition);
    if details.is_empty() {
        Ok(definition)
    } else {
        Err(CoreError::with_details(
            ErrorCode::InvalidAppDefinition,
            details,
        ))
    }
}

/// 권한 id → 그 권한의 모듈 이름. 새 버전으로 옮긴 창의 고른 폴더를 이어 쓸지 가를 때 쓴다.
pub fn permission_modules(definition: &AppDefinition) -> BTreeMap<String, String> {
    definition
        .permissions
        .iter()
        .map(|permission| (permission.id().to_string(), "files".to_string()))
        .collect()
}

fn requires_unsupported(value: &Value) -> bool {
    let Some(requires) = value.get("requires").and_then(Value::as_object) else {
        return false;
    };
    if requires
        .get("blocks")
        .and_then(Value::as_u64)
        .is_some_and(|blocks| blocks > BLOCK_SET_VERSION as u64)
    {
        return true;
    }
    let Some(modules) = requires.get("modules").and_then(Value::as_object) else {
        return false;
    };
    modules.iter().any(|(name, version)| {
        let Some((_, supported_version)) = MODULE_VERSIONS.iter().find(|(known, _)| known == name)
        else {
            return true;
        };
        version
            .as_u64()
            .is_some_and(|required| required > *supported_version as u64)
    })
}

fn validate(definition: &AppDefinition) -> Vec<String> {
    let mut details = Vec::new();
    if !valid_id(&definition.id) {
        details.push(format!("앱 id가 올바르지 않습니다: {}", definition.id));
    }
    if definition.name.trim().is_empty() {
        details.push("앱 이름이 비어 있습니다".into());
    }

    let mut permission_ids = HashSet::new();
    for permission in &definition.permissions {
        if !valid_id(permission.id()) {
            details.push(format!("권한 id가 올바르지 않습니다: {}", permission.id()));
        }
        if !permission_ids.insert(permission.id()) {
            details.push(format!("권한 id가 겹칩니다: {}", permission.id()));
        }
        if !definition.requires.modules.contains_key("files") {
            details.push(format!(
                "권한 {}가 사용하는 files 모듈을 requires.modules에 선언해야 합니다",
                permission.id()
            ));
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
        validate_state_key(&opens.state, definition, &mut details, "opens");
    }

    validate_block(&definition.ui, definition, &mut details, "ui");
    let web_views = count_blocks(&definition.ui, &|block| matches!(block, Block::WebView { .. }));
    if web_views > 1 {
        details.push(format!("web_view는 정의에 하나까지 둘 수 있습니다(지금 {web_views}개)"));
    }
    details
}

fn count_blocks(block: &Block, matches: &dyn Fn(&Block) -> bool) -> usize {
    let own = usize::from(matches(block));
    match block {
        Block::Split { children, .. } => {
            own + children
                .iter()
                .map(|child| count_blocks(child, matches))
                .sum::<usize>()
        }
        _ => own,
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

fn valid_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn validate_block(block: &Block, definition: &AppDefinition, details: &mut Vec<String>, at: &str) {
    let introduced_in = block.introduced_in();
    if definition.requires.blocks < introduced_in {
        details.push(format!(
            "{at}: 이 블록은 블록 세트 {introduced_in}판이라 requires.blocks가 {introduced_in} 이상이어야 합니다"
        ));
    }
    match block {
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
            for (index, child) in children.iter().enumerate() {
                validate_block(
                    child,
                    definition,
                    details,
                    &format!("{at}.children[{index}]"),
                );
            }
        }
        Block::FileTree {
            root,
            selected,
            on_select,
            ..
        } => {
            validate_permission(&root.permission, definition, details, at);
            validate_state_key(&selected.state, definition, details, at);
            validate_state_key(&on_select.set_state, definition, details, at);
        }
        Block::MarkdownEditor { file } => {
            validate_permission(&file.permission, definition, details, at);
            let access = definition
                .permissions
                .iter()
                .find(|permission| permission.id() == file.permission)
                .map(|permission| match permission {
                    PermissionDecl::Files { access, .. } => *access,
                });
            if access.is_some_and(|access| access != FileAccess::Readwrite) {
                details.push(format!(
                    "{at}: markdown_editor 권한 {}는 readwrite여야 합니다",
                    file.permission
                ));
            }
            validate_file_path(&file.path, definition, details, at);
        }
        Block::MarkdownView { file } => {
            validate_permission(&file.permission, definition, details, at);
            validate_file_path(&file.path, definition, details, at);
        }
        Block::AgentChat {} => {
            if !definition.requires.modules.contains_key("agent") {
                details.push(format!(
                    "{at}: agent_chat이 사용하는 agent 모듈을 requires.modules에 선언해야 합니다"
                ));
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
        Block::Explorer { root } => {
            validate_permission(&root.permission, definition, details, at);
        }
    }
}

fn validate_permission(
    permission_id: &str,
    definition: &AppDefinition,
    details: &mut Vec<String>,
    at: &str,
) {
    if !definition
        .permissions
        .iter()
        .any(|permission| permission.id() == permission_id)
    {
        details.push(format!(
            "{at}: 선언되지 않은 권한을 가리킵니다: {permission_id}"
        ));
    }
}

fn validate_state_key(key: &str, definition: &AppDefinition, details: &mut Vec<String>, at: &str) {
    if !definition.state.contains_key(key) {
        details.push(format!("{at}: 선언되지 않은 상태 키를 가리킵니다: {key}"));
    }
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
