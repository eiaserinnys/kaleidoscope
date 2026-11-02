use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use kaleidoscope_contract::{
    app_storage::{validate_storage_content, StorageEntryDecl},
    errors,
    validate::parse_app_definition,
    ErrorCode,
};
use serde_json::json;

fn codes() -> Vec<&'static str> {
    errors::all().map(|entry| entry.id).collect()
}

#[test]
fn conversation_binding_errors_use_the_workspace_name_once() {
    let saved = errors::CONV_CONTEXT_SAVED_BINDING_MISMATCH("작업 1");
    assert!(saved.message.starts_with("작업 1:"));
}

fn valid_code(id: &str) -> bool {
    id.split('_').count() >= 3
        && id.split('_').all(|part| !part.is_empty())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte == b'_')
}

#[test]
fn code_format_is_uppercase_and_has_three_parts() {
    for entry in errors::all() {
        assert!(valid_code(entry.id), "{}", entry.id);
    }
    assert!(valid_code("SHELL_OPEN_FAILED"));
    for invalid in [
        "SHELL_OPEN_FAIL2",
        "SHELL__FAIL",
        "_SHELL_FAIL",
        "SHELL_FAIL_",
        "shell_open_fail",
    ] {
        assert!(!valid_code(invalid), "{invalid}");
    }
}

#[test]
fn codes_start_with_their_area_prefix() {
    for (prefix, entries) in errors::AREAS {
        for entry in *entries {
            assert!(
                entry.id.starts_with(&format!("{prefix}_")),
                "{} does not start with {prefix}",
                entry.id
            );
        }
    }
}

#[test]
fn active_and_retired_codes_are_unique() {
    let mut seen = HashSet::new();
    for entry in errors::all() {
        assert!(seen.insert(entry.id), "duplicate active code {}", entry.id);
    }
    for (id, _) in errors::retired::RETIRED {
        assert!(seen.insert(id), "duplicate retired code {id}");
    }
}

#[test]
fn catalog_metadata_is_non_empty() {
    for entry in errors::all() {
        assert!(!entry.place.trim().is_empty(), "{} place", entry.id);
        assert!(!entry.cause.trim().is_empty(), "{} cause", entry.id);
        assert!(!entry.message.trim().is_empty(), "{} message", entry.id);
        assert!(!entry.fix.trim().is_empty(), "{} fix", entry.id);
    }
}

#[test]
fn file_errors_do_not_recommend_absent_explorer_controls() {
    for entry in errors::all().filter(|entry| entry.id.starts_with("FILE_")) {
        for phrase in ["새로 고침", "폴더 선택", "목록"] {
            assert!(!entry.message.contains(phrase), "{} message", entry.id);
            assert!(!entry.fix.contains(phrase), "{} fix", entry.id);
        }
    }
}

#[test]
fn file_root_and_new_file_errors_explain_their_distinct_causes() {
    let missing_root = errors::FILE_ACCESS_ROOT_NOT_FOUND("docs");
    assert_eq!(missing_root.code, ErrorCode::NotFound);
    assert_eq!(
        missing_root.message,
        "파일 권한 docs: 선택한 폴더를 찾을 수 없습니다. 대상 폴더가 있는지 확인하고 앱을 다시 열거나 폴더를 다시 고르세요."
    );

    let changed_root = errors::FILE_ACCESS_ROOT_CHANGED("docs");
    assert_eq!(changed_root.code, ErrorCode::PathOutsideRoot);
    assert_eq!(
        changed_root.message,
        "파일 권한 docs: 선택한 위치가 폴더가 아니거나 다른 곳을 가리킵니다. 대상 폴더가 있는지 확인하고 앱을 다시 열거나 폴더를 다시 고르세요."
    );

    assert_eq!(
        errors::FILE_CREATE_FILE_OPEN_NOT_FOUND("docs/new.md").message,
        "파일 docs/new.md: 새 파일을 만들 위치를 찾지 못했습니다. 대상 폴더가 있는지 확인한 뒤 앱을 다시 열거나 폴더를 다시 고르세요."
    );
}

#[test]
fn file_reviewed_errors_keep_their_existing_error_classes() {
    let cases = [
        (
            "FILE_ACCESS_ROOT_NOT_FOUND",
            errors::FILE_ACCESS_ROOT_NOT_FOUND("docs"),
            ErrorCode::NotFound,
        ),
        (
            "FILE_ACCESS_ROOT_CHANGED",
            errors::FILE_ACCESS_ROOT_CHANGED("docs"),
            ErrorCode::PathOutsideRoot,
        ),
        (
            "FILE_COPY_NAME_TAKEN",
            errors::FILE_COPY_NAME_TAKEN("copy.txt"),
            ErrorCode::Io,
        ),
        (
            "FILE_SAVE_FILE_DELETED",
            errors::FILE_SAVE_FILE_DELETED("note.md"),
            ErrorCode::Conflict,
        ),
        (
            "FILE_SAVE_REVISION_CHANGED",
            errors::FILE_SAVE_REVISION_CHANGED("note.md"),
            ErrorCode::Conflict,
        ),
        (
            "FILE_REMOVE_TRASH_BUSY",
            errors::FILE_REMOVE_TRASH_BUSY("note.md"),
            ErrorCode::FileBusy,
        ),
        (
            "FILE_CLIENT_EXPORT_TEMP_CREATE_NOT_FOUND",
            errors::FILE_CLIENT_EXPORT_TEMP_CREATE_NOT_FOUND("out.json"),
            ErrorCode::NotFound,
        ),
        (
            "FILE_CLIENT_EXPORT_CONTENT_WRITE_IO",
            errors::FILE_CLIENT_EXPORT_CONTENT_WRITE_IO("out.json"),
            ErrorCode::Io,
        ),
        (
            "FILE_CLIENT_EXPORT_FLUSH_IO",
            errors::FILE_CLIENT_EXPORT_FLUSH_IO("out.json"),
            ErrorCode::Io,
        ),
        (
            "FILE_CLIENT_EXPORT_RENAME_IO",
            errors::FILE_CLIENT_EXPORT_RENAME_IO("out.json"),
            ErrorCode::Io,
        ),
        (
            "SHELL_FILE_LIST_REPLY_INVALID",
            errors::SHELL_FILE_LIST_REPLY_INVALID(),
            ErrorCode::Io,
        ),
        (
            "SHELL_FILE_PATH_REPLY_INVALID",
            errors::SHELL_FILE_PATH_REPLY_INVALID(),
            ErrorCode::Io,
        ),
        (
            "SHELL_FILE_MOVE_REPLY_INVALID",
            errors::SHELL_FILE_MOVE_REPLY_INVALID(),
            ErrorCode::Io,
        ),
        (
            "SHELL_FILE_COPY_REPLY_INVALID",
            errors::SHELL_FILE_COPY_REPLY_INVALID(),
            ErrorCode::Io,
        ),
        (
            "SHELL_FILE_REMOVE_REPLY_INVALID",
            errors::SHELL_FILE_REMOVE_REPLY_INVALID(),
            ErrorCode::Io,
        ),
        (
            "SHELL_FILE_STORAGE_LIST_REPLY_INVALID",
            errors::SHELL_FILE_STORAGE_LIST_REPLY_INVALID(),
            ErrorCode::Io,
        ),
        (
            "SHELL_FILE_STORAGE_RENAME_REVISION_MISSING",
            errors::SHELL_FILE_STORAGE_RENAME_REVISION_MISSING(),
            ErrorCode::Io,
        ),
        (
            "SHELL_FILE_STORAGE_REMOVE_REVISION_MISSING",
            errors::SHELL_FILE_STORAGE_REMOVE_REVISION_MISSING(),
            ErrorCode::NotFound,
        ),
        (
            "SHELL_FILE_MARKDOWN_STORAGE_INVALID",
            errors::SHELL_FILE_MARKDOWN_STORAGE_INVALID("body"),
            ErrorCode::Io,
        ),
        (
            "SHELL_TREE_CONTROL_HEIGHT_MISSING",
            errors::SHELL_TREE_CONTROL_HEIGHT_MISSING(),
            ErrorCode::Io,
        ),
    ];

    for (id, error, class) in cases {
        assert_eq!(error.id.as_deref(), Some(id));
        assert_eq!(error.code, class, "{id}");
    }
}

#[test]
fn message_placeholders_match_arguments() {
    for entry in errors::all() {
        let mut remaining = entry.message;
        let mut found = Vec::new();
        while let Some(start) = remaining.find('{') {
            let after_start = &remaining[start + 1..];
            let end = after_start.find('}').expect("closing placeholder brace");
            found.push(&after_start[..end]);
            remaining = &remaining[start + end + 2..];
        }
        assert_eq!(found, entry.args, "{}", entry.id);
    }
}

#[test]
fn messages_do_not_use_generic_or_disallowed_phrases() {
    let defaults = [
        "요청 값이 빠졌거나 올바르지 않습니다. 요청 내용을 확인한 뒤 다시 시도하세요.",
        "인증 정보를 확인하지 못했습니다. 로그인 상태와 인증 정보를 확인하세요.",
        "요청한 대상에 접근할 수 없습니다. 대상 ID와 계정 범위를 확인하세요.",
        "앱 정의를 등록하지 못했습니다. 필수 값과 선언된 기능을 확인하세요.",
        "앱이 현재 쉘에서 지원하지 않는 블록이나 모듈 버전을 요구합니다. 쉘을 업데이트하세요.",
        "요청한 앱 권한이 선언되지 않았거나 접근 수준이 부족합니다. 앱 권한과 요청 동작을 확인하세요.",
        "이 기기에서 아직 필요한 폴더를 선택하지 않았습니다. 권한에 쓸 폴더를 고르세요.",
        "요청한 경로가 허용된 폴더 밖에 있습니다. 선택한 폴더 안의 경로를 사용하세요.",
        "파일이 읽은 뒤 바뀌었거나 같은 이름의 파일이 있습니다. 최신 상태를 확인하세요.",
        "대화 제공자에 로그인해야 합니다. 계정 연결을 완료한 뒤 다시 시도하세요.",
        "저장된 대화 참조가 제공자의 대화와 다릅니다. 대화 연결을 다시 확인하세요.",
        "파일 작업을 마치지 못했습니다. 파일 형식과 접근 권한을 확인하세요.",
        "서버 요청을 처리하지 못했습니다. 서버 상태를 확인한 뒤 다시 시도하세요.",
        "이 쉘에서는 쓸 수 없는 기능입니다.",
        "로컬 에이전트와 통신할 수 없습니다.",
        "쓸 수 없는 파일 이름입니다.",
        "다른 프로그램에서 사용 중입니다. 닫은 뒤 다시 시도하세요.",
        "파일을 휴지통으로 보낼 수 없습니다.",
    ];
    for entry in errors::all() {
        assert!(
            !defaults.contains(&entry.message),
            "{} repeats an ErrorCode default",
            entry.id
        );
        for forbidden in [
            "`",
            "명령을 처리할 수 없습니다",
            "요청한 항목을 찾을 수 없습니다",
            "이거나 ",
            "·",
            "―",
        ] {
            assert!(
                !entry.message.contains(forbidden),
                "{} contains {forbidden}",
                entry.id
            );
        }
    }
}

#[test]
fn storage_schema_mismatch_message_includes_validation_reason() {
    let error = errors::STORAGE_WRITE_SCHEMA_MISMATCH(
        "settings.theme",
        "JSON path /color: expected string",
    );
    assert_eq!(error.id.as_deref(), Some("STORAGE_WRITE_SCHEMA_MISMATCH"));
    assert_eq!(
        error.message,
        "저장 항목 settings.theme의 값이 앱 선언과 맞지 않습니다. JSON path /color: expected string 값을 고쳐 다시 저장하세요."
    );
    assert!(error.details.is_empty());
}

#[test]
fn app_definition_parse_errors_show_reason_and_next_step_once() {
    for (definition, id, beginning, ending) in [
        (
            "{",
            "APP_DEFINITION_JSON_INVALID",
            "앱 정의 JSON을 읽지 못했습니다: ",
            ". JSON 문법을 고친 뒤 다시 올리세요.",
        ),
        (
            "{}",
            "APP_DEFINITION_FORMAT_INVALID",
            "앱 정의의 형식이 올바르지 않습니다: ",
            ". 해당 필드를 고친 뒤 다시 올리세요.",
        ),
    ] {
        let error = parse_app_definition(definition).unwrap_err();
        assert_eq!(error.id.as_deref(), Some(id));
        assert!(error.message.starts_with(beginning), "{}", error.message);
        assert!(error.message.ends_with(ending), "{}", error.message);
        assert!(error.details.is_empty(), "{error:?}");
    }
}

#[test]
fn storage_validation_reasons_identify_value_and_fixable_cause() {
    let cases = [
        (
            json!({"type":"boolean"}),
            json!("no"),
            Err("값 전체는 boolean 형식이어야 합니다."),
        ),
        (
            json!({"type":["boolean","string"]}),
            json!(3),
            Err("값 전체는 boolean 또는 string 형식이어야 합니다."),
        ),
        (
            json!({"type":"object","properties":{"enabled":{"type":"boolean"}}}),
            json!({"enabled":"no"}),
            Err("/enabled는 boolean 형식이어야 합니다."),
        ),
        (
            json!({"type":"string","enum":["yes"]}),
            json!("no"),
            Err("값 전체의 값이 허용 목록에 없습니다."),
        ),
        (
            json!({"type":"string","minLength":3}),
            json!("가"),
            Err("값 전체의 글이 3자보다 짧습니다."),
        ),
        (
            json!({"type":"object","required":["enabled"]}),
            json!({}),
            Err("값 전체에 필수 필드가 없습니다: enabled."),
        ),
        (
            json!({"type":"object"}),
            json!({"extra":true}),
            Err("값 전체에 선언되지 않은 필드가 있습니다: extra."),
        ),
        (
            json!({"type":"array","uniqueItems":true}),
            json!([1, 1]),
            Err("값 전체에 중복 항목이 있습니다."),
        ),
        (
            json!({"type":"string"}),
            json!("a".repeat(kaleidoscope_contract::app_storage::STORAGE_JSON_MAX_BYTES)),
            Ok((
                "STORAGE_WRITE_JSON_TOO_LARGE",
                "저장 항목 settings/value의 JSON 값이 1048576바이트를 넘습니다. 값을 줄인 뒤 다시 저장하세요.",
            )),
        ),
    ];
    for (schema, value, expected) in cases {
        let entry: StorageEntryDecl = serde_json::from_value(json!({
            "id":"value", "key":"settings/value", "kind":"json", "schema":schema, "default":null,
            "label":"값", "presentation":"hidden"
        }))
        .unwrap();
        let error = validate_storage_content(&entry, &value).unwrap_err();
        match expected {
            Ok((expected_id, expected_message)) => {
                assert_eq!(error.id.as_deref(), Some(expected_id));
                assert_eq!(error.message, expected_message);
            }
            Err(expected_reason) => {
                assert_eq!(error.id.as_deref(), Some("STORAGE_WRITE_SCHEMA_MISMATCH"));
                assert!(error.message.contains(expected_reason), "{}", error.message);
            }
        }
    }
}

#[test]
fn disconnected_server_codes_distinguish_app_import_and_media_loading() {
    let entries = errors::all().map(|entry| entry.id).collect::<HashSet<_>>();
    assert!(entries.contains("APP_IMPORT_SERVER_NOT_CONNECTED"));
    assert!(entries.contains("MEDIA_LOAD_SERVER_NOT_CONNECTED"));
}

#[test]
fn codes_are_used_outside_catalog_and_shell_types_are_generated() {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("workspace root")
        .to_path_buf();
    let roots = ["crates", "app/src-tauri/src", "app/src", "ui/src"].map(|root| repo.join(root));
    let mut source = String::new();
    for root in roots {
        collect_source(&root, &repo, &mut source);
    }
    for id in codes() {
        assert!(
            source.contains(id),
            "{} is not used outside the catalog",
            id
        );
    }

    let Ok(output_dir) = std::env::var("TS_RS_EXPORT_DIR") else {
        return;
    };
    let mut generated = String::from("// 생성물이다. `cargo test -p kaleidoscope-contract`가 crates/contract/src/errors/shell.rs에서 만든다. 손으로 고치지 않는다.\nimport type { CoreError } from \"./contract\";\n\n");
    for entry in errors::shell::ENTRIES {
        let args = entry
            .args
            .iter()
            .map(|arg| format!("{arg}: string"))
            .collect::<Vec<_>>()
            .join("; ");
        let params = if entry.args.is_empty() {
            "()".to_string()
        } else {
            format!("(args: {{ {args} }})")
        };
        let mut message = entry.message.to_string();
        for arg in entry.args {
            message = message.replace(&format!("{{{arg}}}"), &format!("${{args.{arg}}}"));
        }
        let class = serde_json::to_string(&entry.class).unwrap();
        let id = entry.id;
        generated.push_str(&format!("export const {id} = {params}: CoreError => ({{ id: \"{id}\", code: {class}, message: `{message}`, details: [] }});\n"));
    }
    fs::write(Path::new(&output_dir).join("shell-errors.ts"), generated)
        .expect("write shell error wrappers");
}

fn collect_source(path: &Path, repo: &Path, output: &mut String) {
    if path.is_dir() {
        for entry in fs::read_dir(path).expect("read source directory") {
            collect_source(&entry.expect("read source entry").path(), repo, output);
        }
        return;
    }
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|ext| !["rs", "ts", "tsx", "css"].contains(&ext))
    {
        return;
    }
    let relative = path
        .strip_prefix(repo)
        .expect("source is in repository")
        .to_string_lossy();
    if relative.starts_with("crates/contract/src/errors/")
        || relative.starts_with("ui/src/contract/")
    {
        return;
    }
    output.push_str(&fs::read_to_string(path).expect("read source file"));
}
