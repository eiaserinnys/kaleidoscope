use std::env;
use std::process;

use kaleidoscope_contract::errors;

fn cell(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

fn main() {
    let selected = env::args().nth(1);
    if let Some(area) = selected.as_deref() {
        if !errors::AREAS.iter().any(|(prefix, _)| *prefix == area) {
            eprintln!(
                "영역은 {} 가운데 하나여야 합니다",
                errors::AREAS
                    .iter()
                    .map(|(prefix, _)| *prefix)
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            process::exit(2);
        }
    }

    for (prefix, entries) in errors::AREAS {
        if selected.as_deref().is_some_and(|area| area != *prefix) {
            continue;
        }
        println!("## {prefix}\n");
        println!("| 코드 | 장소 | 원인 | 화면 문구 | 고치는 법 | 분류 |");
        println!("| --- | --- | --- | --- | --- | --- |");
        for entry in *entries {
            let class = serde_json::to_value(entry.class)
                .expect("error class serializes")
                .as_str()
                .expect("error class is a string")
                .to_owned();
            println!(
                "| {} | {} | {} | {} | {} | {} |",
                cell(entry.id),
                cell(entry.place),
                cell(entry.cause),
                cell(entry.message),
                cell(entry.fix),
                cell(&class),
            );
        }
        for (id, reason) in errors::retired::RETIRED
            .iter()
            .filter(|(id, _)| id.starts_with(&format!("{prefix}_")))
        {
            println!(
                "| {} | 폐지 | {} | 폐지된 코드 | 다시 사용하지 않습니다 | - |",
                cell(id),
                cell(reason)
            );
        }
        println!();
    }
}
