use crate::validation::Validated;
use chrono::Utc;
use kaleidoscope_contract::{errors::store_server as e, CoreError, PermissionDecl};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn json_bytes(value: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(value).expect("JSON serialization");
    bytes.push(b'\n');
    bytes
}
fn read_json(path: &Path) -> Result<Value, CoreError> {
    let bytes = fs::read(path).map_err(|_| e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED())?;
    serde_json::from_slice(&bytes).map_err(|_| e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED())
}
fn atomic_json(path: &Path, value: &Value) -> std::io::Result<()> {
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    tmp.write_all(&json_bytes(value))?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}
pub fn initialize(dir: &Path) -> Result<(), CoreError> {
    fs::create_dir_all(dir.join("apps"))
        .and_then(|_| fs::create_dir_all(dir.join(".staging")))
        .map_err(|_| e::STORESERVER_START_DATA_DIRECTORY_FAILED())?;
    let index = dir.join("index.json");
    if !index.exists() {
        atomic_json(&index,&json!({"format":1,"generated_at":now(),"publish":{"method":"direct","path":"publish"},"items":[]}))
            .map_err(|_|e::STORESERVER_START_DATA_DIRECTORY_FAILED())?;
    }
    Ok(())
}
fn write_file(dir: &Path, relative: &str, bytes: &[u8]) -> std::io::Result<()> {
    let path = dir.join(relative);
    fs::create_dir_all(path.parent().unwrap())?;
    fs::write(path, bytes)
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn entry(bytes: &[u8]) -> Value {
    json!({"sha256":digest(bytes),"bytes":bytes.len()})
}
fn current_unchanged(dir: &Path, current: u64, input: &Validated) -> Result<bool, CoreError> {
    let prefix = dir
        .join("apps")
        .join(&input.app.id)
        .join(current.to_string());
    let old_store = read_json(&prefix.join("store.json"))?;
    if old_store != input.store_value {
        return Ok(false);
    }
    let read =
        |path: PathBuf| fs::read(path).map_err(|_| e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED());
    if read(prefix.join("app.json"))? != input.files["app.json"] {
        return Ok(false);
    }
    for a in &input.metadata.assets {
        if read(
            prefix
                .join("assets")
                .join(&a.id)
                .join(a.version.to_string()),
        )? != input.files[&a.file]
        {
            return Ok(false);
        }
    }
    let manifest = read_json(&prefix.join("manifest.json"))?;
    let old_screens: Vec<&str> = manifest["screenshots"]
        .as_array()
        .ok_or_else(e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED)?
        .iter()
        .map(|v| {
            v.as_str()
                .ok_or_else(e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED)
        })
        .collect::<Result<_, _>>()?;
    let screens: Vec<_> = input
        .files
        .keys()
        .filter(|p| p.starts_with("screenshots/"))
        .collect();
    if old_screens.len() != screens.len() {
        return Ok(false);
    }
    for (old, path) in old_screens.iter().zip(screens) {
        if !old.ends_with(&format!("/{path}")) || read(prefix.join(path))? != input.files[path] {
            return Ok(false);
        }
    }
    Ok(true)
}
pub fn publish(dir: &Path, input: Validated) -> Result<(bool, Value), CoreError> {
    let id = &input.app.id;
    let app_dir = dir.join("apps").join(id);
    fs::create_dir_all(&app_dir).map_err(|_| e::STORESERVER_PUBLISH_STAGE_WRITE_FAILED())?;
    let detail_path = app_dir.join("index.json");
    let old_detail = if detail_path.exists() {
        Some(read_json(&detail_path)?)
    } else {
        None
    };
    let current = old_detail
        .as_ref()
        .and_then(|d| d["release"].as_u64())
        .unwrap_or(0);
    if current > 0 && current_unchanged(dir, current, &input)? {
        let manifest = format!("apps/{id}/{current}/manifest.json");
        let bytes = fs::read(dir.join(&manifest))
            .map_err(|_| e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED())?;
        return Ok((
            true,
            json!({"id":id,"release":current,"unchanged":true,"manifest":manifest,"digest":digest(&bytes)}),
        ));
    }
    let mut greatest = current;
    for item in
        fs::read_dir(&app_dir).map_err(|_| e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED())?
    {
        let item = item.map_err(|_| e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED())?;
        if item
            .file_type()
            .map_err(|_| e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED())?
            .is_dir()
        {
            if let Ok(n) = item.file_name().to_string_lossy().parse::<u64>() {
                greatest = greatest.max(n);
            }
        }
    }
    let release = greatest
        .checked_add(1)
        .ok_or_else(e::STORESERVER_PUBLISH_RELEASE_COMMIT_FAILED)?;
    let prefix = format!("apps/{id}/{release}");
    let stage = dir.join(".staging").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&stage).map_err(|_| e::STORESERVER_PUBLISH_STAGE_WRITE_FAILED())?;
    let write = |path: &str, bytes: &[u8]| {
        write_file(&stage, path, bytes).map_err(|_| e::STORESERVER_PUBLISH_STAGE_WRITE_FAILED())
    };
    let app_bytes = &input.files["app.json"];
    write("app.json", app_bytes)?;
    write("store.json", &json_bytes(&input.store_value))?;
    let mut files = serde_json::Map::new();
    files.insert(format!("{prefix}/app.json"), entry(app_bytes));
    for a in &input.metadata.assets {
        let bytes = &input.files[&a.file];
        let relative = format!("assets/{}/{}", a.id, a.version);
        write(&relative, bytes)?;
        let mut info = entry(bytes);
        info["format"] = serde_json::to_value(a.format).expect("format");
        info["source"] = json!(a.source);
        info["license"] = json!(a.license);
        files.insert(format!("{prefix}/{relative}"), info);
    }
    let mut screenshots = Vec::new();
    for (path, bytes) in &input.files {
        if path.starts_with("screenshots/") {
            write(path, bytes)?;
            let full = format!("{prefix}/{path}");
            files.insert(full.clone(), entry(bytes));
            screenshots.push(full);
        }
    }
    let icon = input
        .metadata
        .icon
        .as_ref()
        .and_then(|path| input.metadata.assets.iter().find(|a| &a.file == path))
        .map(|a| format!("{prefix}/assets/{}/{}", a.id, a.version));
    let mut badges = Vec::new();
    if input
        .app
        .permissions
        .iter()
        .any(|p| matches!(p, PermissionDecl::Process { .. }))
    {
        badges.push("process");
    }
    if input.app_value.get("worker").is_some() {
        badges.push("worker");
    }
    let published = now();
    let permissions = input
        .app_value
        .get("permissions")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let mut manifest = json!({"format":1,"store_app_id":id,"release":release,"name":input.app.name,
        "summary":input.metadata.summary,"description":input.metadata.description,"category":input.metadata.category,
        "publisher":input.metadata.publisher,"icon":icon,"screenshots":screenshots,
        "requires":input.app_value["requires"],"permissions":permissions,"badges":badges,"files":files,"published_at":published});
    if let Some(connections) = input.store_value.get("connections") {
        manifest["connections"] = connections.clone();
    }
    let manifest_bytes = json_bytes(&manifest);
    write("manifest.json", &manifest_bytes)?;
    fs::rename(&stage, app_dir.join(release.to_string()))
        .map_err(|_| e::STORESERVER_PUBLISH_RELEASE_COMMIT_FAILED())?;
    let manifest_path = format!("{prefix}/manifest.json");
    let mut releases = old_detail
        .as_ref()
        .and_then(|d| d["releases"].as_array())
        .cloned()
        .unwrap_or_default();
    releases.insert(
        0,
        json!({"release":release,"published_at":published,"manifest":manifest_path}),
    );
    let detail = json!({"format":1,"id":id,"name":input.app.name,"summary":input.metadata.summary,
        "description":input.metadata.description,"category":input.metadata.category,"publisher":input.metadata.publisher,
        "release":release,"icon":icon,"screenshots":screenshots,"releases":releases});
    atomic_json(&detail_path, &detail)
        .map_err(|_| e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED())?;
    let index_path = dir.join("index.json");
    let mut index = read_json(&index_path)?;
    let items = index["items"]
        .as_array_mut()
        .ok_or_else(e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED)?;
    items.retain(|v| v["id"] != id.as_str());
    if input.metadata.listed {
        items.push(json!({"id":id,"name":input.app.name,"summary":input.metadata.summary,"category":input.metadata.category,
            "publisher":input.metadata.publisher,"release":release,"icon":icon,"badges":badges,
            "requires":input.app_value["requires"],"updated_at":published}));
        items.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    }
    index["generated_at"] = json!(now());
    index["publish"] = json!({"method":"direct","path":"publish"});
    atomic_json(&index_path, &index).map_err(|_| e::STORESERVER_PUBLISH_CATALOG_COMMIT_FAILED())?;
    Ok((
        false,
        json!({"id":id,"release":release,"unchanged":false,"manifest":manifest_path,"digest":digest(&manifest_bytes)}),
    ))
}
