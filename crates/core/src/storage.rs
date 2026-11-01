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

pub(crate) fn load_file<T: DeserializeOwned + Default>(
    path: &Path,
    file_name: &str,
) -> Result<T, CoreError> {
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

pub(crate) fn save_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), CoreError> {
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
