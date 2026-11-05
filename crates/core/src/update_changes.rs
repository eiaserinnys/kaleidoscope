use kaleidoscope_contract::UpdateChanges;
use semver::Version;
use serde_json::Value;

/// 매니페스트에서 현재 판 이후부터 받은 판까지의 변경 내역을 고른다.
pub fn update_changes(raw: &Value, current: &str, target: &str) -> Vec<UpdateChanges> {
    let (Ok(current), Ok(target)) = (Version::parse(current), Version::parse(target)) else {
        return Vec::new();
    };
    let Some(entries) = raw.get("changes").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut changes = Vec::new();
    for entry in entries {
        let Some(version_text) = entry.get("version").and_then(Value::as_str) else {
            continue;
        };
        let Ok(version) = Version::parse(version_text) else {
            continue;
        };
        if version <= current || version > target || changes.iter().any(|(v, _)| *v == version) {
            continue;
        }
        let Some(items) = entry.get("items").and_then(Value::as_array) else {
            continue;
        };
        let Some(items) = items
            .iter()
            .map(|item| item.as_str().map(str::trim))
            .collect::<Option<Vec<_>>>()
        else {
            continue;
        };
        let items = items
            .into_iter()
            .filter(|item| !item.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if !items.is_empty() {
            changes.push((
                version,
                UpdateChanges {
                    version: version_text.into(),
                    items,
                },
            ));
        }
    }
    changes.sort_by(|a, b| b.0.cmp(&a.0));
    changes.into_iter().map(|(_, change)| change).collect()
}

#[cfg(test)]
mod tests {
    use super::update_changes;
    use serde_json::json;

    #[test]
    fn filters_range_and_sorts_newest_first() {
        let raw = json!({"changes": [
            {"version":"0.5.0", "items":["다섯"]},
            {"version":"0.3.0", "items":["셋"]},
            {"version":"0.4.0", "items":["넷"]},
            {"version":"0.6.0", "items":["여섯"]},
            {"version":"0.5.0", "items":["중복"]}
        ]});
        let result = update_changes(&raw, "0.3.0", "0.5.0");
        assert_eq!(
            result
                .iter()
                .map(|v| v.version.as_str())
                .collect::<Vec<_>>(),
            ["0.5.0", "0.4.0"]
        );
        assert_eq!(result[0].items, ["다섯"]);
    }

    #[test]
    fn missing_changes_are_empty() {
        assert!(update_changes(&json!({}), "0.1.0", "0.2.0").is_empty());
        assert!(update_changes(&json!({"changes": {}}), "0.1.0", "0.2.0").is_empty());
    }

    #[test]
    fn skips_invalid_entries_and_blank_items() {
        let raw = json!({"changes": [
            {"version":"잘못됨", "items":["내용"]},
            {"version":"0.2.0", "items":["내용", 3]},
            {"version":"0.2.0", "items":["  "]},
            {"version":"0.2.0", "items":[" 내용 ", "  "]}
        ]});
        let result = update_changes(&raw, "0.1.0", "0.2.0");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].items, ["내용"]);
    }
}
