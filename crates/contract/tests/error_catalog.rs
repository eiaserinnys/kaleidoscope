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
        ErrorCode::InvalidRequest,
        ErrorCode::Unauthorized,
        ErrorCode::NotFound,
        ErrorCode::InvalidAppDefinition,
        ErrorCode::UnsupportedApp,
        ErrorCode::PermissionDenied,
        ErrorCode::NotGranted,
        ErrorCode::PathOutsideRoot,
        ErrorCode::Conflict,
        ErrorCode::LoginRequired,
        ErrorCode::BindingConflict,
        ErrorCode::Io,
        ErrorCode::Server,
        ErrorCode::Unavailable,
        ErrorCode::LocalAgentFailed,
        ErrorCode::InvalidName,
        ErrorCode::FileBusy,
        ErrorCode::TrashUnavailable,
    ]
    .map(ErrorCode::default_message);
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
            "값 전체는 boolean 형식이어야 합니다.",
        ),
        (
            json!({"type":["boolean","string"]}),
            json!(3),
            "값 전체는 boolean 또는 string 형식이어야 합니다.",
        ),
        (
            json!({"type":"object","properties":{"enabled":{"type":"boolean"}}}),
            json!({"enabled":"no"}),
            "/enabled는 boolean 형식이어야 합니다.",
        ),
        (
            json!({"type":"string","enum":["yes"]}),
            json!("no"),
            "값 전체의 값이 허용 목록에 없습니다.",
        ),
        (
            json!({"type":"string","minLength":3}),
            json!("가"),
            "값 전체의 글이 3자보다 짧습니다.",
        ),
        (
            json!({"type":"object","required":["enabled"]}),
            json!({}),
            "값 전체에 필수 필드가 없습니다: enabled.",
        ),
        (
            json!({"type":"object"}),
            json!({"extra":true}),
            "값 전체에 선언되지 않은 필드가 있습니다: extra.",
        ),
        (
            json!({"type":"array","uniqueItems":true}),
            json!([1, 1]),
            "값 전체에 중복 항목이 있습니다.",
        ),
        (
            json!({"type":"string"}),
            json!("a".repeat(kaleidoscope_contract::app_storage::STORAGE_JSON_MAX_BYTES)),
            "STORAGE_WRITE_JSON_TOO_LARGE",
        ),
    ];
    for (schema, value, expected) in cases {
        let entry: StorageEntryDecl = serde_json::from_value(json!({
            "id":"value", "key":"settings/value", "kind":"json", "schema":schema, "default":null,
            "label":"값", "presentation":"hidden"
        }))
        .unwrap();
        let error = validate_storage_content(&entry, &value).unwrap_err();
        if expected == "STORAGE_WRITE_JSON_TOO_LARGE" {
            assert_eq!(error.id.as_deref(), Some(expected));
        } else {
            assert_eq!(error.id.as_deref(), Some("STORAGE_WRITE_SCHEMA_MISMATCH"));
            assert!(error.message.contains(expected), "{}", error.message);
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
