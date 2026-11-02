use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use kaleidoscope_contract::{errors, ErrorCode};

fn codes() -> Vec<&'static str> {
    errors::all().map(|entry| entry.id).collect()
}

#[test]
fn code_format_is_uppercase_and_has_three_parts() {
    for entry in errors::all() {
        assert!(entry.id.split('_').count() >= 3, "{}", entry.id);
        assert!(
            entry
                .id
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'),
            "{}",
            entry.id
        );
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
