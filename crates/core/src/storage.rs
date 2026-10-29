use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use uuid::Uuid;

use kaleidoscope_contract::{CoreError, DeviceState, SharedState};

use crate::error;

const FORMAT: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct LinkFile {
    pub(crate) format: u32,
    pub(crate) server_url: String,
    pub(crate) device_id: String,
    pub(crate) device_name: String,
    pub(crate) token: String,
}

#[derive(Default, Serialize, Deserialize)]
struct SharedFile {
    format: u32,
    #[serde(flatten)]
    shared: SharedState,
}

#[derive(Default, Serialize, Deserialize)]
struct DeviceFile {
    format: u32,
    #[serde(flatten)]
    device: DeviceState,
}

pub(crate) fn load_shared(data_dir: &Path) -> Result<SharedState, CoreError> {
    let path = data_dir.join("state.json");
    let file: SharedFile = load_file(&path, "state.json")?;
    if file.format == FORMAT {
        Ok(file.shared)
    } else {
        move_broken_if_present(&path, "state.json")?;
        Ok(SharedState::default())
    }
}

pub(crate) fn load_device(data_dir: &Path) -> Result<DeviceState, CoreError> {
    let path = data_dir.join("device.json");
    let file: DeviceFile = load_file(&path, "device.json")?;
    if file.format == FORMAT {
        Ok(file.device)
    } else {
        move_broken_if_present(&path, "device.json")?;
        Ok(DeviceState::default())
    }
}

pub(crate) fn load_link(data_dir: &Path) -> Result<Option<LinkFile>, CoreError> {
    let path = data_dir.join("link.json");
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error::io_error(&error)),
    };

    match serde_json::from_slice::<LinkFile>(&bytes) {
        Ok(file) if file.format == FORMAT => Ok(Some(file)),
        _ => {
            move_broken_if_present(&path, "link.json")?;
            Ok(None)
        }
    }
}

pub(crate) fn save_link(data_dir: &Path, link: &LinkFile) -> Result<(), CoreError> {
    save_atomic(&data_dir.join("link.json"), link)
}

pub(crate) fn remove_link(data_dir: &Path) -> Result<(), CoreError> {
    match fs::remove_file(data_dir.join("link.json")) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error::io_error(&error)),
    }
}

fn load_file<T: DeserializeOwned + Default>(path: &Path, file_name: &str) -> Result<T, CoreError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(T::default()),
        Err(error) => return Err(error::io_error(&error)),
    };

    match serde_json::from_slice(&bytes) {
        Ok(value) => Ok(value),
        Err(_) => {
            let broken_path = broken_path(path, file_name);
            fs::rename(path, broken_path).map_err(|error| error::io_error(&error))?;
            Ok(T::default())
        }
    }
}

fn broken_path(path: &Path, file_name: &str) -> PathBuf {
    let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    path.with_file_name(format!("{file_name}.broken-{timestamp}"))
}

fn move_broken_if_present(path: &Path, file_name: &str) -> Result<(), CoreError> {
    if path.exists() {
        fs::rename(path, broken_path(path, file_name)).map_err(|error| error::io_error(&error))?;
    }
    Ok(())
}

pub(crate) fn save_state(
    data_dir: &Path,
    shared: &SharedState,
    device: &DeviceState,
) -> Result<(), CoreError> {
    save_shared(data_dir, shared)?;
    save_device(data_dir, device)
}

pub(crate) fn save_changed_state(
    data_dir: &Path,
    shared: &SharedState,
    device: &DeviceState,
    shared_changed: bool,
    device_changed: bool,
) -> Result<(), CoreError> {
    if shared_changed {
        save_shared(data_dir, shared)?;
    }
    if device_changed {
        save_device(data_dir, device)?;
    }
    Ok(())
}

fn save_shared(data_dir: &Path, shared: &SharedState) -> Result<(), CoreError> {
    save_atomic(
        &data_dir.join("state.json"),
        &SharedFile {
            format: FORMAT,
            shared: shared.clone(),
        },
    )
}

fn save_device(data_dir: &Path, device: &DeviceState) -> Result<(), CoreError> {
    save_atomic(
        &data_dir.join("device.json"),
        &DeviceFile {
            format: FORMAT,
            device: device.clone(),
        },
    )
}

fn save_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), CoreError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|_| error::make(kaleidoscope_contract::ErrorCode::Io))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    let temp_path = path.with_file_name(format!(".{file_name}.tmp-{}", Uuid::new_v4()));
    fs::write(&temp_path, bytes).map_err(|error| error::io_error(&error))?;
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error::io_error(&error));
    }
    Ok(())
}
