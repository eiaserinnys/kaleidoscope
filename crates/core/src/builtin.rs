//! 쉘이 함께 싣는 자산의 원본.

use kaleidoscope_contract::assets::AssetMeta;
use kaleidoscope_contract::{
    builtin::BUILTIN_IDENTITIES, registry::RegistryApp, validate::parse_app_definition, App,
    AppVersion,
};
use serde::Deserialize;

const APPS: &[(&str, &str)] = &[
    ("profiler", include_str!("../../../apps/profiler.json")),
    ("agent", include_str!("../../../apps/agent.json")),
    ("explorer", include_str!("../../../apps/explorer.json")),
    ("md-editor", include_str!("../../../apps/md-editor.json")),
    (
        "html-report",
        include_str!("../../../apps/html-report.json"),
    ),
    (
        "web-browser",
        include_str!("../../../apps/web-browser.json"),
    ),
    ("calculator", include_str!("../../../apps/calculator.json")),
    ("weather", include_str!("../../../apps/weather.json")),
    ("store", include_str!("../../../apps/store.json")),
];

pub fn builtin_apps() -> Vec<RegistryApp> {
    BUILTIN_IDENTITIES
        .iter()
        .map(|identity| {
            let json = APPS
                .iter()
                .find(|(id, _)| *id == identity.id)
                .expect("기본 앱 정의")
                .1;
            let definition = parse_builtin_definition(json).expect("유효한 기본 앱 정의");
            let date = identity.updated_at.to_string();
            RegistryApp {
                app: App {
                    origin: None,
                    installed_version: None,
                    id: identity.id.into(),
                    name: definition.name.clone(),
                    current_version: identity.version,
                    created_at: date.clone(),
                    updated_at: date.clone(),
                },
                version: AppVersion {
                    app_id: identity.id.into(),
                    version: identity.version,
                    definition,
                    created_at: date,
                },
            }
        })
        .collect()
}

fn parse_builtin_definition(
    json: &str,
) -> Result<kaleidoscope_contract::AppDefinition, kaleidoscope_contract::CoreError> {
    let definition = parse_app_definition(json)?;
    if let Some(icon) = &definition.icon {
        let format =
            kaleidoscope_contract::builtin::bundled_asset_format(&icon.asset, icon.version)
                .ok_or_else(|| {
                    kaleidoscope_contract::errors::ASSET_APP_ICON_NOT_FOUND(
                        &definition.id,
                        &icon.asset,
                        icon.version,
                    )
                })?;
        icon.validate_format(&definition.id, format)?;
    }
    Ok(definition)
}

pub fn builtin_runtime_specs() -> Vec<kaleidoscope_contract::worker::BuiltinRuntimeSpec> {
    builtin_apps()
        .into_iter()
        .filter_map(|app| {
            let definition = app.version.definition;
            if definition.storage.is_none() && definition.worker.is_none() {
                return None;
            }
            Some(kaleidoscope_contract::worker::BuiltinRuntimeSpec {
                app_id: app.app.id,
                version: app.version.version,
                storage: definition.storage,
                worker: definition.worker,
            })
        })
        .collect()
}

pub fn builtin_app(id: &str) -> Option<RegistryApp> {
    builtin_apps().into_iter().find(|app| app.app.id == id)
}

const MANIFEST: &str = include_str!("../../../apps/assets/manifest.json");
const FILES: &[(&str, &[u8])] = &[
    ("icons/profiler.svg", include_bytes!("../../../apps/assets/icons/profiler.svg")),
    ("icons/agent.svg", include_bytes!("../../../apps/assets/icons/agent.svg")),
    ("icons/explorer.svg", include_bytes!("../../../apps/assets/icons/explorer.svg")),
    ("icons/md-editor.svg", include_bytes!("../../../apps/assets/icons/md-editor.svg")),
    ("icons/html-report.svg", include_bytes!("../../../apps/assets/icons/html-report.svg")),
    ("icons/web-browser.svg", include_bytes!("../../../apps/assets/icons/web-browser.svg")),
    ("icons/calculator.svg", include_bytes!("../../../apps/assets/icons/calculator.svg")),
    ("icons/weather.svg", include_bytes!("../../../apps/assets/icons/weather.svg")),
    ("icons/store.svg", include_bytes!("../../../apps/assets/icons/store.svg")),
    ("icons/profiler-v2.svg", include_bytes!("../../../apps/assets/icons/profiler-v2.svg")),
    ("icons/agent-v2.svg", include_bytes!("../../../apps/assets/icons/agent-v2.svg")),
    ("icons/explorer-v2.svg", include_bytes!("../../../apps/assets/icons/explorer-v2.svg")),
    ("icons/md-editor-v2.svg", include_bytes!("../../../apps/assets/icons/md-editor-v2.svg")),
    ("icons/html-report-v2.svg", include_bytes!("../../../apps/assets/icons/html-report-v2.svg")),
    ("icons/web-browser-v2.svg", include_bytes!("../../../apps/assets/icons/web-browser-v2.svg")),
    ("icons/calculator-v2.svg", include_bytes!("../../../apps/assets/icons/calculator-v2.svg")),
    ("icons/weather-v2.svg", include_bytes!("../../../apps/assets/icons/weather-v2.svg")),
    ("icons/store-v2.svg", include_bytes!("../../../apps/assets/icons/store-v2.svg")),
    (
        "agent/client-v1.js",
        include_bytes!("../../../apps/assets/agent/client-v1.js"),
    ),
    (
        "agent/client-v2.js",
        include_bytes!("../../../apps/assets/agent/client-v2.js"),
    ),
    (
        "agent/client-v3.js",
        include_bytes!("../../../apps/assets/agent/client-v3.js"),
    ),
    (
        "agent/client-v4.js",
        include_bytes!("../../../apps/assets/agent/client-v4.js"),
    ),
    (
        "agent/client-v5.js",
        include_bytes!("../../../apps/assets/agent/client-v5.js"),
    ),
    (
        "agent/client-v6.js",
        include_bytes!("../../../apps/assets/agent/client-v6.js"),
    ),
    (
        "agent/client-v7.js",
        include_bytes!("../../../apps/assets/agent/client-v7.js"),
    ),
    (
        "weather/clear.svg",
        include_bytes!("../../../apps/assets/weather/clear.svg"),
    ),
    (
        "weather/partly-cloudy.svg",
        include_bytes!("../../../apps/assets/weather/partly-cloudy.svg"),
    ),
    (
        "weather/cloudy.svg",
        include_bytes!("../../../apps/assets/weather/cloudy.svg"),
    ),
    (
        "weather/fog.svg",
        include_bytes!("../../../apps/assets/weather/fog.svg"),
    ),
    (
        "weather/rain.svg",
        include_bytes!("../../../apps/assets/weather/rain.svg"),
    ),
    (
        "weather/showers.svg",
        include_bytes!("../../../apps/assets/weather/showers.svg"),
    ),
    (
        "weather/snow.svg",
        include_bytes!("../../../apps/assets/weather/snow.svg"),
    ),
    (
        "weather/thunderstorm.svg",
        include_bytes!("../../../apps/assets/weather/thunderstorm.svg"),
    ),
];

#[derive(Deserialize)]
struct BundledAsset {
    #[serde(flatten)]
    meta: AssetMeta,
    path: String,
}

pub fn bundled_assets() -> Vec<(AssetMeta, &'static [u8])> {
    let manifest: Vec<BundledAsset> = serde_json::from_str(MANIFEST).expect("기본 자산 목록 형식");
    manifest
        .into_iter()
        .map(|entry| {
            let bytes = FILES
                .iter()
                .find(|(path, _)| *path == entry.path)
                .expect("기본 자산 파일")
                .1;
            (entry.meta, bytes)
        })
        .collect()
}

pub fn bundled_asset(id: &str, version: u32) -> Option<(AssetMeta, &'static [u8])> {
    bundled_assets()
        .into_iter()
        .find(|(meta, _)| meta.id == id && meta.version == version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn identities_match_bundled_definitions() {
        let apps = builtin_apps();
        let specs = builtin_runtime_specs();
        assert_eq!(apps.len(), BUILTIN_IDENTITIES.len());
        for identity in BUILTIN_IDENTITIES {
            let app = apps.iter().find(|app| app.app.id == identity.id).unwrap();
            assert_eq!(app.app.name, identity.name);
            assert_eq!(app.version.version, identity.version);
            assert_eq!(app.version.definition.requires.blocks, identity.blocks);
            let definition = &app.version.definition;
            let icon = definition.icon.as_ref().expect("기본 앱 아이콘");
            assert_eq!(icon.asset, format!("builtin-icon-{}", identity.id));
            assert_eq!(icon.version, 2);
            let spec = specs.iter().find(|spec| spec.app_id == identity.id);
            if definition.storage.is_some() || definition.worker.is_some() {
                let spec = spec.expect("실행 선언");
                assert_eq!(spec.version, identity.version);
                assert_eq!(spec.storage, definition.storage);
                assert_eq!(spec.worker, definition.worker);
            } else {
                assert!(spec.is_none());
            }
            assert_eq!(
                app.version.definition.requires.modules,
                identity
                    .modules
                    .iter()
                    .map(|(name, version)| ((*name).to_string(), *version))
                    .collect()
            );
            assert_eq!(
                app.version
                    .definition
                    .assets
                    .iter()
                    .map(|asset| (asset.id.as_str(), asset.version))
                    .collect::<std::collections::BTreeSet<_>>(),
                identity.assets.iter().copied().collect()
            );
            assert!(app.version.definition.assets.iter().all(|asset| {
                kaleidoscope_contract::builtin::is_bundled_asset(&asset.id, asset.version)
            }));
        }
    }

    #[test]
    fn html_report_accepts_a_document_with_revision_and_comment() {
        let app = builtin_app("html-report").unwrap();
        let entry = &app.version.definition.storage.unwrap().entries[0];
        let content = serde_json::json!({"documents":[{"id":"doc","title":"시안","revisions":[{"rev":1,"html":"<h1>제목</h1>","comments":[{"id":"comment","selected_text":"제목","comment":"수정","status":"needs_agent_review","replies":[{"id":"reply","body":"확인","role":"agent"}]}]}]}]});
        assert!(
            kaleidoscope_contract::app_storage::validate_storage_content(entry, &content).is_ok()
        );
    }

    #[test]
    fn manifest_matches_bundled_files_and_reserved_keys() {
        let assets = bundled_assets();
        assert_eq!(assets.len(), FILES.len());
        assert_eq!(
            assets.len(),
            kaleidoscope_contract::builtin::BUNDLED_ASSET_KEYS.len()
        );
        for (meta, bytes) in assets {
            assert!(kaleidoscope_contract::builtin::is_bundled_asset(
                &meta.id,
                meta.version
            ));
            assert_eq!(
                kaleidoscope_contract::builtin::bundled_asset_format(&meta.id, meta.version),
                Some(meta.format)
            );
            assert_eq!(meta.byte_size, bytes.len() as u64);
            assert_eq!(meta.sha256, format!("{:x}", Sha256::digest(bytes)));
            kaleidoscope_data::asset_validation::validate_bytes(meta.format, bytes).unwrap();
        }
    }

    #[test]
    fn builtin_app_icon_obeys_declaration_version_and_format_checks() {
        let mut app: serde_json::Value =
            serde_json::from_str(APPS.iter().find(|(id, _)| *id == "weather").unwrap().1).unwrap();
        app["requires"]["blocks"] =
            serde_json::json!(kaleidoscope_contract::APP_ICON_BLOCK_SET_VERSION);
        app["icon"] = serde_json::json!({"asset":"builtin-weather-clear","version":1});
        assert!(parse_builtin_definition(&app.to_string()).is_ok());
        app["icon"]["version"] = serde_json::json!(2);
        assert_eq!(
            parse_builtin_definition(&app.to_string())
                .unwrap_err()
                .id
                .as_deref(),
            Some("APP_ICON_VERSION_MISMATCH")
        );
        app["assets"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"id":"builtin-agent-client","version":1}));
        app["icon"] = serde_json::json!({"asset":"builtin-agent-client","version":1});
        assert_eq!(
            parse_builtin_definition(&app.to_string())
                .unwrap_err()
                .id
                .as_deref(),
            Some("ASSET_APP_ICON_FORMAT_INVALID")
        );
    }
}
