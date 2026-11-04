use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use uuid::Uuid;

use kaleidoscope_contract::{
    errors, migrate_window_state, AppVersion, CoreError, DeviceState, SharedState,
};

const FORMAT: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct LinkFile {
    #[serde(default)]
    pub(crate) revoked: bool,
    #[serde(default)]
    pub(crate) mode: kaleidoscope_contract::ServerMode,
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
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SharedState::default())
        }
        Err(error) => {
            return Err(errors::DESK_LOCAL_STATE_READ_FAILED(path.display())
                .and_details(vec![error.to_string()]));
        }
    };
    let raw: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(raw) => raw,
        Err(_) => return recover_shared_state(&path),
    };
    let Some(raw_versions) = raw
        .get("app_versions")
        .and_then(serde_json::Value::as_array)
    else {
        return recover_shared_state(&path);
    };
    let raw_versions = raw_versions.clone();
    let mut without_versions = raw;
    let Some(root) = without_versions.as_object_mut() else {
        return recover_shared_state(&path);
    };
    root.insert("app_versions".into(), serde_json::Value::Array(Vec::new()));
    let mut file: SharedFile = match serde_json::from_value(without_versions) {
        Ok(file) => file,
        Err(_) => return recover_shared_state(&path),
    };
    if file.format != FORMAT {
        return recover_shared_state(&path);
    }

    let mut skipped_versions = Vec::new();
    for raw_version in raw_versions {
        match serde_json::from_value::<AppVersion>(raw_version.clone()) {
            Ok(version) => file.shared.app_versions.push(version),
            Err(reason) => {
                let app_id = raw_version
                    .get("app_id")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("알 수 없음");
                let version_number = raw_version
                    .get("version")
                    .and_then(serde_json::Value::as_u64)
                    .and_then(|version| u32::try_from(version).ok())
                    .unwrap_or_default();
                let error = errors::DESK_LOCAL_STATE_APP_VERSION_SKIPPED(
                    path.display(),
                    app_id,
                    version_number,
                    reason,
                );
                eprintln!(
                    "{}: {}",
                    error
                        .id
                        .as_deref()
                        .unwrap_or("DESK_LOCAL_STATE_APP_VERSION_SKIPPED"),
                    error.message
                );
                if app_id != "알 수 없음" && version_number != 0 {
                    skipped_versions.push((app_id.to_owned(), version_number));
                }
            }
        }
    }
    repair_windows_for_skipped_versions(&mut file.shared, &skipped_versions);
    for desktop in &mut file.shared.desktops {
        desktop.sharing.clear();
    }
    Ok(file.shared)
}

fn recover_shared_state(path: &Path) -> Result<SharedState, CoreError> {
    move_broken_if_present(path, "state.json")?;
    Ok(SharedState::default())
}

fn repair_windows_for_skipped_versions(
    shared: &mut SharedState,
    skipped_versions: &[(String, u32)],
) {
    for (app_id, skipped_version) in skipped_versions {
        let builtin = crate::builtin::builtin_app(app_id);
        let replacement = builtin.as_ref().map(|row| row.version.clone()).or_else(|| {
            shared
                .app_versions
                .iter()
                .filter(|version| version.app_id == *app_id)
                .max_by_key(|version| version.version)
                .cloned()
        });
        let Some(replacement) = replacement else {
            continue;
        };
        for window in shared
            .windows
            .iter_mut()
            .filter(|window| window.app_id == *app_id && window.app_version == *skipped_version)
        {
            window.state = migrate_window_state(&replacement.definition, &window.state);
            window.app_version = replacement.version;
            window.updated_at = replacement.created_at.clone();
        }
        if builtin.is_none() {
            if let Some(app) = shared.apps.iter_mut().find(|app| app.id == *app_id) {
                if app.current_version == *skipped_version {
                    app.name = replacement.definition.name.clone();
                    app.current_version = replacement.version;
                    app.updated_at = replacement.created_at;
                }
            }
        }
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
        Err(error) => {
            return Err(errors::DESK_LOCAL_LINK_READ_FAILED(path.display())
                .and_details(vec![error.to_string()]))
        }
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
        Err(error) => Err(errors::DESK_LOCAL_LINK_REMOVE_FAILED(
            data_dir.join("link.json").display(),
        )
        .and_details(vec![error.to_string()])),
    }
}

pub(crate) fn load_file<T: DeserializeOwned + Default>(
    path: &Path,
    file_name: &str,
) -> Result<T, CoreError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(T::default()),
        Err(error) => {
            return Err(errors::DESK_LOCAL_STATE_READ_FAILED(path.display())
                .and_details(vec![error.to_string()]));
        }
    };

    match serde_json::from_slice(&bytes) {
        Ok(value) => Ok(value),
        Err(_) => {
            let broken_path = broken_path(path, file_name);
            fs::rename(path, broken_path).map_err(|error| recovery_rename_error(error, path))?;
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
        fs::rename(path, broken_path(path, file_name))
            .map_err(|error| recovery_rename_error(error, path))?;
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

pub(crate) fn save_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), CoreError> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        errors::DESK_LOCAL_STATE_SERIALIZE_FAILED().and_details(vec![error.to_string()])
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    let temp_path = path.with_file_name(format!(".{file_name}.tmp-{}", Uuid::new_v4()));
    fs::write(&temp_path, bytes).map_err(|error| {
        let mapped = if error.kind() == std::io::ErrorKind::NotFound {
            errors::DESK_LOCAL_STATE_TEMP_WRITE_NOT_FOUND(path.parent().unwrap_or(path).display())
        } else {
            errors::DESK_LOCAL_STATE_TEMP_WRITE_FAILED(path.parent().unwrap_or(path).display())
        };
        mapped.and_details(vec![error.to_string()])
    })?;
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        let mapped = if error.kind() == std::io::ErrorKind::NotFound {
            errors::DESK_LOCAL_STATE_REPLACE_NOT_FOUND(path.parent().unwrap_or(path).display())
        } else {
            errors::DESK_LOCAL_STATE_REPLACE_FAILED(path.display())
        };
        return Err(mapped.and_details(vec![error.to_string()]));
    }
    Ok(())
}

fn recovery_rename_error(error: std::io::Error, path: &Path) -> CoreError {
    let mapped = if error.kind() == std::io::ErrorKind::NotFound {
        errors::DESK_LOCAL_STATE_RECOVERY_RENAME_NOT_FOUND(path.display())
    } else {
        errors::DESK_LOCAL_STATE_RECOVERY_RENAME_FAILED(path.display())
    };
    mapped.and_details(vec![error.to_string()])
}

#[derive(Default)]
struct DirtyFlags {
    shared: bool,
    device: bool,
    sync: bool,
    stop: bool,
}

#[derive(Default)]
struct FlushSignal {
    dirty: std::sync::Mutex<DirtyFlags>,
    changed: std::sync::Condvar,
}

#[derive(Default)]
pub(crate) struct StorageFlusher {
    signal: std::sync::Arc<FlushSignal>,
    worker: std::sync::Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl StorageFlusher {
    pub(crate) fn schedule(
        &self,
        shared: bool,
        device: bool,
        sync: bool,
        profiler: &crate::profiler::Profiler,
    ) {
        let mut dirty = self.signal.dirty.lock().unwrap();
        let coalesced =
            (shared && dirty.shared) || (device && dirty.device) || (sync && dirty.sync);
        dirty.shared |= shared;
        dirty.device |= device;
        dirty.sync |= sync;
        profiler.debounced(coalesced);
        self.signal.changed.notify_one();
    }
    pub(crate) fn clear_sync(&self) {
        self.signal.dirty.lock().unwrap().sync = false;
    }
    pub(crate) fn stop(&self) {
        let mut dirty = self.signal.dirty.lock().unwrap();
        dirty.stop = true;
        self.signal.changed.notify_one();
        drop(dirty);
        if let Some(worker) = self.worker.lock().unwrap().take() {
            if worker.join().is_err() {
                eprintln!("상태 저장 스레드가 예기치 않게 끝났습니다");
            }
        }
    }
}

impl crate::Inner {
    pub(crate) fn save_state_locked(
        &self,
        state: &crate::CoreState,
        shared: bool,
        device: bool,
        sync: bool,
    ) -> Result<(), CoreError> {
        let mut dirty = self.flusher.signal.dirty.lock().unwrap();
        let write_shared = shared || dirty.shared;
        let write_device = device || dirty.device;
        let write_sync = sync || dirty.sync;
        if !(write_shared || write_device || write_sync) {
            return Ok(());
        }
        let started = std::time::Instant::now();
        save_changed_state(
            &self.data_dir,
            &state.shared,
            &state.device,
            write_shared,
            write_device,
        )?;
        if write_sync {
            crate::sync_state::save(&self.data_dir, &state.sync)?;
        }
        dirty.shared = false;
        dirty.device = false;
        dirty.sync = false;
        self.profiler.span(
            "storage.flush",
            "저장",
            "",
            "",
            started.elapsed().as_secs_f64() * 1000.0,
            0,
            0,
            "",
        );
        Ok(())
    }
}

pub(crate) fn start_flusher(inner: &std::sync::Arc<crate::Inner>) {
    let weak = std::sync::Arc::downgrade(inner);
    let signal = inner.flusher.signal.clone();
    let worker = std::thread::Builder::new()
        .name("kaleidoscope-storage".into())
        .spawn(move || loop {
            let mut dirty = signal.dirty.lock().unwrap();
            while !dirty.stop && !(dirty.shared || dirty.device || dirty.sync) {
                dirty = signal.changed.wait(dirty).unwrap();
            }
            if dirty.stop {
                break;
            }
            let (guard, _) = signal
                .changed
                .wait_timeout_while(dirty, std::time::Duration::from_millis(25), |flags| {
                    !flags.stop
                })
                .unwrap();
            drop(guard);
            let Some(inner) = weak.upgrade() else { break };
            let state = inner.state.lock().unwrap();
            if let Err(err) = inner.save_state_locked(&state, false, false, false) {
                eprintln!("상태를 저장할 수 없습니다: {}", err.message);
            }
        })
        .expect("상태 저장 스레드를 시작할 수 없습니다");
    *inner.flusher.worker.lock().unwrap() = Some(worker);
}
