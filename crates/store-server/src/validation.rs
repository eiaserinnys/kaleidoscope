use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    assets::{AssetFormat, AssetUpload},
    errors::store_server as e,
    AppDefinition, CoreError, PermissionDecl,
};
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Asset {
    pub id: String,
    pub version: u32,
    pub file: String,
    pub format: AssetFormat,
    pub source: String,
    pub license: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connection {
    pub name: String,
    pub kind: String,
    pub base_url: String,
    #[serde(default, rename = "issuer")]
    _issuer: Option<String>,
    #[serde(default, rename = "resource")]
    _resource: Option<String>,
    #[serde(default, rename = "scopes")]
    _scopes: Option<String>,
    pub paths: Vec<String>,
    #[serde(rename = "writable")]
    _writable: bool,
    #[serde(rename = "description")]
    _description: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    pub summary: String,
    pub description: String,
    pub category: String,
    pub publisher: String,
    pub listed: bool,
    pub icon: Option<String>,
    pub assets: Vec<Asset>,
    #[serde(default)]
    pub connections: Vec<Connection>,
}
pub struct Validated {
    pub app: AppDefinition,
    pub app_value: Value,
    pub metadata: Metadata,
    pub store_value: Value,
    pub files: BTreeMap<String, Vec<u8>>,
}

fn secret_regex() -> Regex {
    Regex::new(r"sk-ant-[A-Za-z0-9_-]*|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]*|xox[abpr]-[A-Za-z0-9-]*|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----").unwrap()
}
pub fn secret_path(path: &str) -> bool {
    secret_regex().is_match(path)
}
fn contains_secret(v: &Value, re: &Regex) -> bool {
    match v {
        Value::String(s) => re.is_match(s),
        Value::Array(items) => items.iter().any(|v| contains_secret(v, re)),
        Value::Object(fields) => fields
            .iter()
            .any(|(k, v)| re.is_match(k) || contains_secret(v, re)),
        _ => false,
    }
}
pub fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != "..")
}
fn valid_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|b| b.is_ascii_alphanumeric())
        && bytes.all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
fn valid_base_url(s: &str) -> bool {
    url::Url::parse(s).ok().is_some_and(|u| {
        (u.scheme() == "https"
            || (u.scheme() == "http" && matches!(u.host_str(), Some("127.0.0.1" | "localhost"))))
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
            && !s.contains('?')
            && !s.contains('#')
    })
}
fn valid_connection_path(path: &str) -> bool {
    if path == "/" {
        return true;
    }
    if !path.starts_with('/')
        || path
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '?' | '#' | '\\'))
    {
        return false;
    }
    let lower = path.to_ascii_lowercase();
    if lower.contains("%00") {
        return false;
    }
    let normalized = lower
        .replace("%2e", ".")
        .replace("%2f", "/")
        .replace("%5c", "/");
    let rest = &normalized[1..];
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    rest.split('/')
        .all(|s| !s.is_empty() && s != "." && s != "..")
}

pub fn validate(files: BTreeMap<String, Vec<u8>>) -> Result<Validated, CoreError> {
    let re = secret_regex();
    if files.keys().any(|path| re.is_match(path)) {
        return Err(e::STORESERVER_PUBLISH_SECRET_DETECTED());
    }
    let app_bytes = files
        .get("app.json")
        .ok_or_else(|| e::STORESERVER_PUBLISH_FILE_MISSING("app.json"))?;
    let store_bytes = files
        .get("store.json")
        .ok_or_else(|| e::STORESERVER_PUBLISH_FILE_MISSING("store.json"))?;
    let app_text =
        std::str::from_utf8(app_bytes).map_err(|_| e::STORESERVER_PUBLISH_APP_JSON_INVALID())?;
    let app_value: Value =
        serde_json::from_str(app_text).map_err(|_| e::STORESERVER_PUBLISH_APP_JSON_INVALID())?;
    let mut store_value: Value = serde_json::from_slice(store_bytes)
        .map_err(|_| e::STORESERVER_PUBLISH_METADATA_INVALID())?;
    if contains_secret(&app_value, &re) || contains_secret(&store_value, &re) {
        return Err(e::STORESERVER_PUBLISH_SECRET_DETECTED());
    }
    let obj = store_value
        .as_object_mut()
        .ok_or_else(e::STORESERVER_PUBLISH_METADATA_INVALID)?;
    obj.remove("release");
    for key in [
        "summary",
        "description",
        "category",
        "publisher",
        "listed",
        "icon",
        "assets",
    ] {
        if !obj.contains_key(key) {
            return Err(e::STORESERVER_PUBLISH_METADATA_FIELD_MISSING(key));
        }
    }
    for (key, value) in obj.iter() {
        let valid = match key.as_str() {
            "summary" | "description" | "category" | "publisher" => value.is_string(),
            "listed" => value.is_boolean(),
            "icon" => value.is_string() || value.is_null(),
            "assets" | "connections" => value.is_array(),
            _ => return Err(e::STORESERVER_PUBLISH_METADATA_FIELD_UNKNOWN(key)),
        };
        if !valid {
            return Err(e::STORESERVER_PUBLISH_METADATA_FIELD_TYPE_INVALID(key));
        }
    }
    let metadata: Metadata = serde_json::from_value(store_value.clone())
        .map_err(|_| e::STORESERVER_PUBLISH_METADATA_INVALID())?;
    if !(1..=80).contains(&metadata.summary.chars().count()) {
        return Err(e::STORESERVER_PUBLISH_METADATA_SUMMARY_INVALID());
    }
    if metadata.description.chars().count() > 4000 {
        return Err(e::STORESERVER_PUBLISH_METADATA_DESCRIPTION_INVALID());
    }
    if !(1..=24).contains(&metadata.category.chars().count()) {
        return Err(e::STORESERVER_PUBLISH_METADATA_CATEGORY_INVALID());
    }
    if metadata.publisher.is_empty() {
        return Err(e::STORESERVER_PUBLISH_METADATA_PUBLISHER_INVALID());
    }
    let app = kaleidoscope_contract::validate::parse_app_definition(app_text)?;
    if !valid_name(&app.id) {
        return Err(e::STORESERVER_PUBLISH_APP_ID_INVALID());
    }
    if kaleidoscope_contract::builtin::is_builtin(&app.id)
        || kaleidoscope_contract::builtin::is_retired_builtin(&app.id)
    {
        return Err(e::STORESERVER_PUBLISH_BUILTIN_ID_FORBIDDEN(&app.id));
    }
    let mut keys = BTreeSet::new();
    let mut allowed = BTreeSet::from(["app.json".to_string(), "store.json".to_string()]);
    let mut asset_bytes = 0usize;
    for a in &metadata.assets {
        if !valid_name(&a.id)
            || a.version == 0
            || !a.file.starts_with("assets/")
            || !safe_path(&a.file)
            || !keys.insert((a.id.clone(), a.version))
        {
            return Err(e::STORESERVER_PUBLISH_ASSET_DECLARATION_MISMATCH());
        }
        allowed.insert(a.file.clone());
        let bytes = files
            .get(&a.file)
            .ok_or_else(|| e::STORESERVER_PUBLISH_FILE_MISSING(&a.file))?;
        asset_bytes += bytes.len();
        if asset_bytes > 10 * 1024 * 1024 {
            return Err(e::STORESERVER_PUBLISH_ASSETS_TOO_LARGE());
        }
        if matches!(
            a.format,
            AssetFormat::Html | AssetFormat::Javascript | AssetFormat::Svg
        ) && std::str::from_utf8(bytes)
            .ok()
            .is_some_and(|s| re.is_match(s))
        {
            return Err(e::STORESERVER_PUBLISH_SECRET_DETECTED());
        }
        let upload = AssetUpload {
            id: a.id.clone(),
            version: a.version,
            format: a.format,
            sha256: format!("{:x}", Sha256::digest(bytes)),
            source: a.source.clone(),
            license: a.license.clone(),
            data_base64: STANDARD.encode(bytes),
        };
        kaleidoscope_data::asset_validation::validate_upload(&upload)?;
    }
    let app_keys: BTreeSet<_> = app
        .assets
        .iter()
        .map(|a| (a.id.clone(), a.version))
        .collect();
    if keys != app_keys || app_keys.len() != app.assets.len() {
        return Err(e::STORESERVER_PUBLISH_ASSET_DECLARATION_MISMATCH());
    }
    if metadata
        .icon
        .as_ref()
        .is_some_and(|icon| !metadata.assets.iter().any(|a| &a.file == icon))
    {
        return Err(e::STORESERVER_PUBLISH_ASSET_DECLARATION_MISMATCH());
    }
    if app.icon.is_none() && metadata.icon.is_some() {
        return Err(e::STORESERVER_PUBLISH_ASSET_DECLARATION_MISMATCH());
    }
    if let Some(icon) = &app.icon {
        let asset = metadata
            .assets
            .iter()
            .find(|a| a.id == icon.asset && a.version == icon.version)
            .ok_or_else(e::STORESERVER_PUBLISH_ASSET_DECLARATION_MISMATCH)?;
        if metadata.icon.as_deref() != Some(asset.file.as_str()) || app.requires.blocks < 26 {
            return Err(e::STORESERVER_PUBLISH_ASSET_DECLARATION_MISMATCH());
        }
        icon.validate_format(&app.id, asset.format)?;
    }
    let mut screen_numbers = BTreeSet::new();
    for (path, bytes) in &files {
        if let Some(name) = path.strip_prefix("screenshots/") {
            let valid = name.len() >= 5 && (name.ends_with(".png") || name.ends_with(".webp"));
            let number = name.split('.').next().unwrap_or("");
            if !valid
                || number.len() != 1
                || !matches!(number, "1" | "2" | "3" | "4" | "5")
                || name.matches('.').count() != 1
            {
                return Err(e::STORESERVER_PUBLISH_FILE_UNEXPECTED(path));
            }
            if !screen_numbers.insert(number.to_string()) || screen_numbers.len() > 5 {
                return Err(e::STORESERVER_PUBLISH_SCREENSHOT_COUNT_INVALID());
            }
            if bytes.len() > 2 * 1024 * 1024 {
                return Err(e::STORESERVER_PUBLISH_SCREENSHOT_TOO_LARGE(path));
            }
            let format = if name.ends_with(".png") {
                AssetFormat::Png
            } else {
                AssetFormat::Webp
            };
            kaleidoscope_data::asset_validation::validate_bytes(format, bytes)
                .map_err(|_| e::STORESERVER_PUBLISH_SCREENSHOT_FORMAT_INVALID(path))?;
            allowed.insert(path.clone());
        }
    }
    for path in files.keys() {
        if !allowed.contains(path) {
            return Err(e::STORESERVER_PUBLISH_FILE_UNEXPECTED(path));
        }
    }
    let required: BTreeSet<_> = app
        .permissions
        .iter()
        .filter_map(|p| match p {
            PermissionDecl::Connection { connection, .. } => Some(connection.clone()),
            _ => None,
        })
        .collect();
    let mut names = BTreeSet::new();
    for c in &metadata.connections {
        if c.name.is_empty()
            || c.name.len() > 64
            || !c
                .name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || c.kind != "oauth"
            || !valid_base_url(&c.base_url)
            || c.paths.iter().any(|p| !valid_connection_path(p))
            || !names.insert(c.name.clone())
        {
            return Err(e::STORESERVER_PUBLISH_CONNECTION_INVALID());
        }
    }
    if names != required {
        return Err(e::STORESERVER_PUBLISH_CONNECTION_INVALID());
    }
    Ok(Validated {
        app,
        app_value,
        metadata,
        store_value,
        files,
    })
}
