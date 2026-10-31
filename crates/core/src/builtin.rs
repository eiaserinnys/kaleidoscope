//! 쉘이 함께 싣는 자산의 원본.

use kaleidoscope_contract::assets::AssetMeta;
use kaleidoscope_contract::{
    builtin::BUILTIN_IDENTITIES, registry::RegistryApp, validate::parse_app_definition, App,
    AppVersion,
};
use serde::Deserialize;

const APPS: &[(&str, &str)] = &[
    ("agent", include_str!("../../../apps/agent.json")),
    ("explorer", include_str!("../../../apps/explorer.json")),
    ("md-editor", include_str!("../../../apps/md-editor.json")),
    ("md-viewer", include_str!("../../../apps/md-viewer.json")),
    (
        "web-browser",
        include_str!("../../../apps/web-browser.json"),
    ),
    ("calculator", include_str!("../../../apps/calculator.json")),
    ("weather", include_str!("../../../apps/weather.json")),
    ("market", include_str!("../../../apps/market.json")),
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
            let definition = parse_app_definition(json).expect("유효한 기본 앱 정의");
            let date = identity.updated_at.to_string();
            RegistryApp {
                app: App {
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

pub fn builtin_app(id: &str) -> Option<RegistryApp> {
    builtin_apps().into_iter().find(|app| app.app.id == id)
}

const MANIFEST: &str = include_str!("../../../apps/assets/manifest.json");
const FILES: &[(&str, &[u8])] = &[
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
        assert_eq!(apps.len(), BUILTIN_IDENTITIES.len());
        for identity in BUILTIN_IDENTITIES {
            let app = apps.iter().find(|app| app.app.id == identity.id).unwrap();
            assert_eq!(app.app.name, identity.name);
            assert_eq!(app.version.version, identity.version);
            assert_eq!(app.version.definition.requires.blocks, identity.blocks);
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
            assert_eq!(meta.byte_size, bytes.len() as u64);
            assert_eq!(meta.sha256, format!("{:x}", Sha256::digest(bytes)));
            kaleidoscope_data::asset_validation::validate_bytes(meta.format, bytes).unwrap();
        }
    }
}
