//! 사용자가 한 번 고른 파일과 임시 출력의 창별 수명.
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use kaleidoscope_contract::{
    client::{ClientFile, CLIENT_PICK_FILE_MAX_BYTES},
    data::FileAccept,
    CoreError, ErrorCode,
};
use uuid::Uuid;

use crate::{app_commands, error, Inner};

struct Input {
    window: String,
    path: PathBuf,
}
struct Output {
    window: String,
    target: PathBuf,
    temp: PathBuf,
    file: File,
}
#[derive(Default)]
pub(crate) struct ClientFiles {
    inputs: Mutex<HashMap<String, Input>>,
    outputs: Mutex<HashMap<String, Output>>,
}

fn require_client(inner: &Inner, id: &str) -> Result<(), CoreError> {
    let state = inner.state.lock().unwrap();
    let window = state
        .shared
        .windows
        .iter()
        .find(|window| window.id == id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let definition =
        app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    if definition.client.is_none() {
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    Ok(())
}

pub(crate) fn pick(
    inner: &Inner,
    window: &str,
    accept: &[FileAccept],
    multiple: bool,
) -> Result<(bool, Vec<ClientFile>), CoreError> {
    require_client(inner, window)?;
    let Some(paths) = inner.host.pick_files(accept, multiple) else {
        return Ok((true, Vec::new()));
    };
    let mut files = Vec::new();
    let mut inputs = inner.client_files.inputs.lock().unwrap();
    for path in paths
        .into_iter()
        .take(if multiple { usize::MAX } else { 1 })
    {
        let metadata = fs::metadata(&path).map_err(|error| error::io_error(&error))?;
        if !metadata.is_file() || metadata.len() > CLIENT_PICK_FILE_MAX_BYTES {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?
            .to_string();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let mime = mime_guess::from_path(&path)
            .first_raw()
            .map(str::to_owned)
            .or_else(|| {
                accept
                    .iter()
                    .find(|item| {
                        item.extensions.iter().any(|item| {
                            item.trim_start_matches('.').eq_ignore_ascii_case(extension)
                        })
                    })
                    .filter(|item| !item.mime.contains('*'))
                    .map(|item| item.mime.clone())
            })
            .unwrap_or_else(|| "application/octet-stream".into());
        let id = Uuid::new_v4().to_string();
        inputs.insert(
            id.clone(),
            Input {
                window: window.into(),
                path,
            },
        );
        files.push(ClientFile {
            id,
            name,
            size: metadata.len(),
            mime,
        });
    }
    Ok((files.is_empty(), files))
}

pub(crate) fn read(inner: &Inner, window: &str, id: &str) -> Result<Vec<u8>, CoreError> {
    let inputs = inner.client_files.inputs.lock().unwrap();
    let input = inputs
        .get(id)
        .filter(|input| input.window == window)
        .ok_or_else(|| error::make(ErrorCode::PermissionDenied))?;
    let file = File::open(&input.path).map_err(|error| error::io_error(&error))?;
    let mut bytes = Vec::new();
    file.take(CLIENT_PICK_FILE_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error::io_error(&error))?;
    if bytes.len() as u64 > CLIENT_PICK_FILE_MAX_BYTES {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    Ok(bytes)
}

pub(crate) fn begin(
    inner: &Inner,
    window: &str,
    name: &str,
    mime: &str,
) -> Result<Option<String>, CoreError> {
    require_client(inner, window)?;
    let Some(target) = inner.host.pick_save_file(name, mime) else {
        return Ok(None);
    };
    let parent = target
        .parent()
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
    let id = Uuid::new_v4().to_string();
    let temp = parent.join(format!(".kaleidoscope-{id}.tmp"));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|error| error::io_error(&error))?;
    inner.client_files.outputs.lock().unwrap().insert(
        id.clone(),
        Output {
            window: window.into(),
            target,
            temp,
            file,
        },
    );
    Ok(Some(id))
}

pub(crate) fn write(
    inner: &Inner,
    window: &str,
    id: &str,
    offset: u64,
    bytes: &[u8],
) -> Result<(), CoreError> {
    let mut outputs = inner.client_files.outputs.lock().unwrap();
    let output = outputs
        .get_mut(id)
        .filter(|output| output.window == window)
        .ok_or_else(|| error::make(ErrorCode::PermissionDenied))?;
    output
        .file
        .seek(SeekFrom::Start(offset))
        .and_then(|_| output.file.write_all(bytes))
        .map_err(|error| error::io_error(&error))
}

pub(crate) fn finish(inner: &Inner, window: &str, id: &str, commit: bool) -> Result<(), CoreError> {
    let mut outputs = inner.client_files.outputs.lock().unwrap();
    if outputs.get(id).is_none_or(|output| output.window != window) {
        return Err(error::make(ErrorCode::PermissionDenied));
    }
    let mut output = outputs.remove(id).unwrap();
    if commit {
        if let Err(error) = output.file.flush() {
            drop(output.file);
            let _ = fs::remove_file(&output.temp);
            return Err(error::io_error(&error));
        }
    }
    drop(output.file);
    if commit {
        if let Err(error) = fs::rename(&output.temp, &output.target) {
            let _ = fs::remove_file(&output.temp);
            return Err(error::io_error(&error));
        }
    } else {
        fs::remove_file(&output.temp).map_err(|error| error::io_error(&error))?;
    }
    Ok(())
}

pub(crate) fn release(inner: &Inner, window: &str) {
    inner
        .client_files
        .inputs
        .lock()
        .unwrap()
        .retain(|_, input| input.window != window);
    let ids: Vec<_> = inner
        .client_files
        .outputs
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, output)| output.window == window)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        let _ = finish(inner, window, &id, false);
    }
}

pub(crate) fn release_all(inner: &Inner) {
    let windows: Vec<_> = inner
        .client_files
        .outputs
        .lock()
        .unwrap()
        .values()
        .map(|output| output.window.clone())
        .collect();
    for window in windows {
        release(inner, &window);
    }
    inner.client_files.inputs.lock().unwrap().clear();
}

impl Drop for ClientFiles {
    fn drop(&mut self) {
        if let Ok(outputs) = self.outputs.get_mut() {
            for (_, output) in outputs.drain() {
                drop(output.file);
                let _ = fs::remove_file(output.temp);
            }
        }
    }
}
