//! 쉘에 실리는 기본 앱. 정의를 바꾸면 같은 PR에서 판을 올리고 날짜를 고친다.
//! 새 앱은 apps/에 정의 파일을 넣고 표에 한 줄을 더한다.
//! 기본 앱 정의와 저장소 선언은 계약 검사 규칙을 따른다.

use crate::{registry::RegistryApp, validate::parse_app_definition, App, AppVersion};

pub struct BuiltinApp {
    pub id: &'static str,
    pub version: u32,
    pub updated_at: &'static str,
    pub definition_json: &'static str,
}

pub const BUILTIN_APPS: &[BuiltinApp] = &[
    BuiltinApp {
        id: "explorer",
        version: 3,
        updated_at: "2026-10-30T00:00:00Z",
        definition_json: include_str!("../../../apps/explorer.json"),
    },
    BuiltinApp {
        id: "md-editor",
        version: 2,
        updated_at: "2026-10-30T00:00:00Z",
        definition_json: include_str!("../../../apps/md-editor.json"),
    },
    BuiltinApp {
        id: "md-viewer",
        version: 1,
        updated_at: "2026-10-30T00:00:00Z",
        definition_json: include_str!("../../../apps/md-viewer.json"),
    },
    BuiltinApp {
        id: "web-browser",
        version: 1,
        updated_at: "2026-10-30T00:00:00Z",
        definition_json: include_str!("../../../apps/web-browser.json"),
    },
];

pub fn builtin_apps() -> Vec<RegistryApp> {
    BUILTIN_APPS
        .iter()
        .map(|builtin| {
            let definition = parse_app_definition(builtin.definition_json)
                .expect("기본 앱 정의가 유효해야 합니다");
            let date = builtin.updated_at.to_string();
            RegistryApp {
                app: App {
                    id: builtin.id.into(),
                    name: definition.name.clone(),
                    current_version: builtin.version,
                    created_at: date.clone(),
                    updated_at: date.clone(),
                },
                version: AppVersion {
                    app_id: builtin.id.into(),
                    version: builtin.version,
                    definition,
                    created_at: date,
                },
            }
        })
        .collect()
}

pub fn builtin_app(id: &str) -> Option<RegistryApp> {
    builtin_apps().into_iter().find(|app| app.app.id == id)
}

pub fn is_builtin(id: &str) -> bool {
    BUILTIN_APPS.iter().any(|app| app.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builtin_table_has_valid_unique_supported_definitions() {
        let mut ids = std::collections::HashSet::new();
        for app in BUILTIN_APPS {
            assert!(ids.insert(app.id));
            let definition = parse_app_definition(app.definition_json).unwrap();
            assert_eq!(definition.id, app.id);
            assert!(crate::Supported::current().renders(&definition.requires));
        }
    }
}
