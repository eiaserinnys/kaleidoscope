//! 스토어 앱 폴더 두 뿌리를 견주어 저장소 선언과 자산 판의 호환을 검사한다.
//!
//! 사용법: app_upgrade_check --base <앱 폴더 뿌리> --head <앱 폴더 뿌리>
//!
//! 두 뿌리에 함께 있는 앱(`app.json`이 있는 하위 폴더)마다 저장소 선언을 계약의
//! `validate_storage_upgrade`로 견주고, 같은 자산 ID와 판이 양쪽 `store.json`에 있으면
//! 스토어가 올리는 그 파일의 바이트를 견준다. 어긋나면 `<앱 ID>: <까닭>`을 한 줄씩 찍고 1,
//! 모두 맞으면 0, 인자나 읽기 오류면 2로 끝난다. `head` 앱 정의를 읽지 못하면 1로 알리고,
//! `base` 앱 정의만 읽지 못하면 그 앱은 건너뛰고 한 줄 알린다.

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;

use kaleidoscope_contract::app_upgrade::{
    asset_version_conflicts, storage_upgrade_problems, AssetVersionBytes,
};
use kaleidoscope_contract::validate::parse_app_definition;
use kaleidoscope_contract::AppDefinition;

const USAGE: &str = "사용법: app_upgrade_check --base <앱 폴더 뿌리> --head <앱 폴더 뿌리>";

fn main() {
    let (base_root, head_root) = match arguments() {
        Ok(roots) => roots,
        Err(message) => {
            eprintln!("{message}");
            eprintln!("{USAGE}");
            process::exit(2);
        }
    };
    if !base_root.is_dir() || !head_root.is_dir() {
        eprintln!(
            "앱 폴더 뿌리를 읽을 수 없습니다. base: {}, head: {}",
            base_root.display(),
            head_root.display()
        );
        process::exit(2);
    }
    let base_apps = match app_folders(&base_root) {
        Ok(folders) => folders,
        Err(message) => {
            eprintln!("{message}");
            process::exit(2);
        }
    };
    let head_apps = match app_folders(&head_root) {
        Ok(folders) => folders,
        Err(message) => {
            eprintln!("{message}");
            process::exit(2);
        }
    };

    let mut failed = false;
    let mut read_error = false;
    for folder in base_apps.intersection(&head_apps) {
        let base_dir = base_root.join(folder);
        let head_dir = head_root.join(folder);
        let head_definition = match read_definition(&head_dir) {
            Ok(definition) => definition,
            Err(reason) => {
                println!("{folder}: 새 앱 정의를 읽지 못했습니다: {reason}");
                failed = true;
                continue;
            }
        };
        let base_definition = match read_definition(&base_dir) {
            Ok(definition) => definition,
            Err(reason) => {
                println!("{folder}: 이전 앱 정의를 읽지 못해 건너뜁니다: {reason}");
                continue;
            }
        };
        let app_id = head_definition.id.clone();
        for problem in storage_upgrade_problems(&base_definition, &head_definition) {
            println!("{app_id}: {problem}");
            failed = true;
        }
        match compare_assets(&base_dir, &head_dir) {
            Ok(conflicts) => {
                for asset in conflicts {
                    println!(
                        "{app_id}: 자산 {}의 {}판 내용이 이전과 다릅니다. 새 자산 판 번호로 올리세요.",
                        asset.id, asset.version
                    );
                    failed = true;
                }
            }
            Err(reason) => {
                println!("{app_id}: {reason}");
                read_error = true;
            }
        }
    }
    if read_error {
        process::exit(2);
    }
    if failed {
        process::exit(1);
    }
}

fn arguments() -> Result<(PathBuf, PathBuf), String> {
    let mut base = None;
    let mut head = None;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--base" => {
                if base.is_some() {
                    return Err("--base를 두 번 지정했습니다".into());
                }
                let value = args.next().ok_or("--base에 앱 폴더 뿌리가 필요합니다")?;
                base = Some(PathBuf::from(value));
            }
            "--head" => {
                if head.is_some() {
                    return Err("--head를 두 번 지정했습니다".into());
                }
                let value = args.next().ok_or("--head에 앱 폴더 뿌리가 필요합니다")?;
                head = Some(PathBuf::from(value));
            }
            other => return Err(format!("알 수 없는 인자: {other}")),
        }
    }
    let base = base.ok_or("--base가 필요합니다")?;
    let head = head.ok_or("--head가 필요합니다")?;
    Ok((base, head))
}

fn app_folders(root: &Path) -> Result<BTreeSet<String>, String> {
    let entries = fs::read_dir(root)
        .map_err(|error| format!("{} 폴더를 읽지 못했습니다: {error}", root.display()))?;
    let mut folders = BTreeSet::new();
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("{} 폴더를 읽지 못했습니다: {error}", root.display()))?;
        let path = entry.path();
        if path.is_dir() && path.join("app.json").is_file() {
            folders.insert(entry.file_name().to_string_lossy().into_owned());
        }
    }
    Ok(folders)
}

fn read_definition(folder: &Path) -> Result<AppDefinition, String> {
    let path = folder.join("app.json");
    let text = fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    parse_app_definition(&text).map_err(|error| format!("{}: {}", path.display(), error.message))
}

struct StoreAsset {
    id: String,
    version: u32,
    file: String,
}

fn compare_assets(
    base_dir: &Path,
    head_dir: &Path,
) -> Result<Vec<kaleidoscope_contract::assets::AssetDep>, String> {
    let base_assets = read_store_assets(base_dir)?;
    let head_assets = read_store_assets(head_dir)?;
    let base_by_key: BTreeMap<(&str, u32), &StoreAsset> = base_assets
        .iter()
        .map(|asset| ((asset.id.as_str(), asset.version), asset))
        .collect();
    let mut previous = Vec::new();
    let mut next = Vec::new();
    for asset in &head_assets {
        let Some(base_asset) = base_by_key.get(&(asset.id.as_str(), asset.version)) else {
            continue;
        };
        let base_bytes = read_asset_bytes(base_dir, base_asset)?;
        let head_bytes = read_asset_bytes(head_dir, asset)?;
        previous.push(AssetVersionBytes {
            id: base_asset.id.clone(),
            version: base_asset.version,
            bytes: base_bytes,
        });
        next.push(AssetVersionBytes {
            id: asset.id.clone(),
            version: asset.version,
            bytes: head_bytes,
        });
    }
    Ok(asset_version_conflicts(&previous, &next))
}

fn read_store_assets(folder: &Path) -> Result<Vec<StoreAsset>, String> {
    let path = folder.join("store.json");
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("{}: {error}", path.display())),
    };
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))?;
    let Some(items) = value.get("assets").and_then(|assets| assets.as_array()) else {
        return Ok(Vec::new());
    };
    let mut assets = Vec::new();
    for item in items {
        let (Some(id), Some(version), Some(file)) = (
            item.get("id").and_then(|value| value.as_str()),
            item.get("version").and_then(|value| value.as_u64()),
            item.get("file").and_then(|value| value.as_str()),
        ) else {
            continue;
        };
        let Ok(version) = u32::try_from(version) else {
            continue;
        };
        assets.push(StoreAsset {
            id: id.to_string(),
            version,
            file: file.to_string(),
        });
    }
    Ok(assets)
}

fn read_asset_bytes(folder: &Path, asset: &StoreAsset) -> Result<Vec<u8>, String> {
    let relative = safe_asset_path(&asset.file).ok_or_else(|| {
        format!(
            "자산 {}의 {}판 파일 경로가 올바르지 않습니다: {}",
            asset.id, asset.version, asset.file
        )
    })?;
    let path = folder.join(relative);
    fs::read(&path).map_err(|error| {
        format!(
            "자산 {}의 {}판 파일({})을 읽지 못했습니다: {error}",
            asset.id,
            asset.version,
            path.display()
        )
    })
}

fn safe_asset_path(file: &str) -> Option<&Path> {
    if !file.starts_with("assets/") || file.contains('\\') {
        return None;
    }
    if file
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return None;
    }
    Some(Path::new(file))
}
