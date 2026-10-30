//! 앱 정의 검사. 쉘의 코어와 오케스트레이터가 이 한 곳의 검사를 같이 쓴다.
//! 규칙은 [`AppDefinition`]의 doc 주석에 있다.

use std::collections::{BTreeMap, HashSet};

use serde_json::Value;

use crate::app_storage::{self, StorageKind};
use crate::data::{self, Action, Actions, Binding, SourceDecl};
use crate::{
    AgentProvider, AppDefinition, Block, CoreError, ErrorCode, FileAccess, FileRef, PathValue,
    PermissionDecl, UrlValue, BLOCK_SET_VERSION, MODULE_VERSIONS,
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
        .map(|permission| (permission.id().to_string(), permission.module().to_string()))
        .collect()
}

/// JSONata 식 하나를 읽어 본다. 읽지 못하면 사람이 읽는 까닭을 돌려준다.
pub fn parse_expr(expr: &str) -> Result<(), String> {
    jsonata_core::parser::parse(expr)
        .map(|_| ())
        .map_err(|error| error.to_string())
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
        let module = permission.module();
        if !definition.requires.modules.contains_key(module) {
            details.push(format!(
                "권한 {}가 사용하는 {module} 모듈을 requires.modules에 선언해야 합니다",
                permission.id()
            ));
        }
        if let PermissionDecl::Connection { connection, .. } = permission {
            if !valid_id(connection) {
                details.push(format!(
                    "권한 {}의 연결 이름은 소문자, 숫자, - 1~64자여야 합니다: {connection}",
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
        validate_state_key(&opens.state, definition, &mut details, "opens");
    }

    if let Some(storage) = &definition.storage {
        if definition.requires.blocks < 6 {
            details.push(
                "storage 선언은 블록 세트 6판이라 requires.blocks가 6 이상이어야 합니다".into(),
            );
        }
        let minimum_storage_version = if storage
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

    validate_sources(definition, &mut details);

    let mut web_views = 0;
    data::walk_blocks(&definition.ui, "/ui", &mut |pointer, block| {
        if matches!(block, Block::WebView { .. }) {
            web_views += 1;
        }
        validate_block(block, definition, &mut details, pointer);
    });
    if web_views > 1 {
        details.push(format!(
            "web_view는 정의에 하나까지 둘 수 있습니다(지금 {web_views}개)"
        ));
    }

    for (pointer, actions) in data::ui_actions(definition) {
        validate_actions(actions, definition, &mut details, &pointer);
    }
    for (pointer, binding) in data::ui_bindings(definition) {
        validate_binding_shape(binding, definition, &mut details, &pointer);
    }
    validate_exprs(definition, &mut details);
    details
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
            SourceDecl::Request { .. } => "connection",
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
            SourceDecl::Request { path, query, .. } => {
                validate_binding_shape(path, definition, details, &format!("{at}/path"));
                if let Binding::Literal(Value::String(path)) = path {
                    if !valid_request_path(path) {
                        details.push(format!(
                            "{at}/path: 연결 경로는 /로 시작하고 .. 이나 \\ 없이 연결 주소 아래를 가리켜야 합니다: {path}"
                        ));
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

fn validate_workspace_template(template: &str) -> Result<(), &'static str> {
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
        for entry in data::storage_refs(expr) {
            if definition
                .storage
                .as_ref()
                .is_none_or(|storage| !storage.entries.iter().any(|item| item.id == entry))
            {
                details.push(format!(
                    "{pointer}: 식이 없는 저장 항목을 읽습니다: $storage.{entry}"
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
            && ["$data", "$event", "$item"]
                .iter()
                .any(|var| uses_var(expr, var))
        {
            details.push(format!(
                "{pointer}: 원천의 값 자리 식은 $state와 $storage만 볼 수 있습니다($data, $event, $item 불가)"
            ));
        }
    }
    if has_expr && definition.requires.blocks < 4 {
        details.push("식(expr)은 블록 세트 4판이라 requires.blocks가 4 이상이어야 합니다".into());
    }
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
        Binding::Literal(Value::Object(object))
            if object.contains_key("state") || object.contains_key("expr") =>
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
        Actions::Many(list) => {
            if list.is_empty() {
                details.push(format!("{at}: 동작 목록이 비어 있습니다"));
            }
            for (index, action) in list.iter().enumerate() {
                let at = format!("{at}/{index}");
                match action {
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
                        match definition.storage.as_ref().and_then(|storage| {
                            storage.entries.iter().find(|entry| entry.id == spec.entry)
                        }) {
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
                        validate_permission_module(
                            &call.permission,
                            "connection",
                            definition,
                            details,
                            &at,
                        );
                        if call.method != data::HttpMethod::Get
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

fn validate_block(block: &Block, definition: &AppDefinition, details: &mut Vec<String>, at: &str) {
    let introduced_in = block.introduced_in();
    if definition.requires.blocks < introduced_in {
        details.push(format!(
            "{at}: {} 블록은 블록 세트 {introduced_in}판이라 requires.blocks가 {introduced_in} 이상이어야 합니다",
            block.type_name()
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
        }
        Block::FileTree {
            root,
            selected,
            on_select,
            ..
        } => {
            validate_permission_module(&root.permission, "files", definition, details, at);
            validate_state_key(&selected.state, definition, details, at);
            validate_state_key(&on_select.set_state, definition, details, at);
        }
        Block::MarkdownEditor { file, document } => {
            validate_markdown_binding(file, document, true, definition, details, at);
        }
        Block::CodeEditor { file, .. } => {
            validate_file_ref(file, definition, details, at);
            if find_permission(definition, &file.permission)
                .is_some_and(|permission| permission.access() != FileAccess::Readwrite)
            {
                details.push(format!(
                    "{at}: {} 권한 {}는 readwrite여야 합니다",
                    block.type_name(),
                    file.permission
                ));
            }
        }
        Block::MarkdownView { file, document } => {
            validate_markdown_binding(file, document, false, definition, details, at);
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
        Block::Explorer {
            root,
            folder,
            on_folder,
            view,
            on_view,
        } => {
            validate_permission_module(&root.permission, "files", definition, details, at);
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
            if fill.is_some_and(|fill| fill as usize >= children.len()) {
                details.push(format!("{at}: stack의 fill이 자식 수를 넘습니다"));
            }
        }
        Block::Tabs {
            tabs,
            selected,
            on_change,
        } => {
            if tabs.is_empty() {
                details.push(format!("{at}: tabs에는 탭이 하나 이상 필요합니다"));
            }
            for tab in tabs {
                if tab.label.trim().is_empty() {
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
                        | Block::Toggle { .. }
                        | Block::Button { .. }
                        | Block::Text { .. }
                ) {
                    details.push(format!(
                        "{at}: toolbar에는 input, select, toggle, button, text만 둡니다({})",
                        child.type_name()
                    ));
                }
            }
        }
        Block::List { selected, .. }
        | Block::Tree { selected, .. }
        | Block::Feed { selected, .. } => {
            if let Some(selected) = selected {
                validate_state_key(&selected.state, definition, details, at);
            }
        }
        Block::Table {
            columns,
            sort,
            selected,
            ..
        } => {
            if columns.is_empty() {
                details.push(format!("{at}: table에는 열이 하나 이상 필요합니다"));
            }
            let mut fields = HashSet::new();
            for column in columns {
                if !fields.insert(column.field.as_str()) {
                    details.push(format!(
                        "{at}: table 열의 field가 겹칩니다: {}",
                        column.field
                    ));
                }
            }
            if let Some(sort) = sort {
                if !fields.contains(sort.field.as_str()) {
                    details.push(format!(
                        "{at}: sort의 field가 열에 없습니다: {}",
                        sort.field
                    ));
                }
            }
            if let Some(selected) = selected {
                validate_state_key(&selected.state, definition, details, at);
            }
        }
        Block::Properties { fields } => {
            if fields.is_empty() {
                details.push(format!("{at}: properties에는 줄이 하나 이상 필요합니다"));
            }
        }
        Block::Input { value, .. } | Block::Select { value, .. } | Block::Toggle { value, .. } => {
            validate_state_key(&value.state, definition, details, at);
        }
        Block::Button { label, icon, .. } => {
            if label.trim().is_empty() {
                details.push(format!("{at}: button의 label이 비어 있습니다"));
            }
            if let Some(icon) = icon {
                if !data::ICON_NAMES.contains(&icon.as_str()) {
                    details.push(format!("{at}: 쉘에 없는 아이콘입니다: {icon}"));
                }
            }
        }
        Block::CodeView { value, file, .. } => match (value, file) {
            (Some(_), None) => {}
            (None, Some(file)) => validate_file_ref(file, definition, details, at),
            _ => details.push(format!(
                "{at}: code_view는 value와 file 가운데 꼭 하나를 씁니다"
            )),
        },
        Block::Section { .. } | Block::Text { .. } | Block::Image { .. } | Block::Media { .. } => {}
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
                    "{at}: markdown_editor 파일 권한 {}는 readwrite여야 합니다",
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
                Some(entry) if entry.kind == StorageKind::Md => {}
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

/// 권한이 선언되어 있고 그 모듈이 `module`인지.
fn validate_permission_module(
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
