//! 사용자가 한 번 고른 파일과 임시 출력의 창별 수명.
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use kaleidoscope_contract::{
    client::{ClientFile, CLIENT_PICK_FILE_MAX_BYTES},
    data::FileAccept,
    CoreError,
};
use uuid::Uuid;

use crate::Inner;

mod access;
mod error;
use access::require_client;
use error::{export_error, export_not_owned, input_not_owned};

struct Input {
    window: String,
    path: PathBuf,
}
struct Output {
    window: String,
    target: PathBuf,
    temp: PathBuf,
    file: File,
    retain_on_commit: bool,
}
#[derive(Default)]
pub(crate) struct ClientFiles {
    inputs: Mutex<HashMap<String, Input>>,
    outputs: Mutex<HashMap<String, Output>>,
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
        let metadata = fs::metadata(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                kaleidoscope_contract::errors::FILE_CLIENT_PICK_NOT_FOUND(
                    &path.display().to_string(),
                )
                .and_details(vec![error.to_string()])
            } else {
                kaleidoscope_contract::errors::FILE_CLIENT_PICK_IO(&path.display().to_string())
                    .and_details(vec![error.to_string()])
            }
        })?;
        if !metadata.is_file() {
            return Err(kaleidoscope_contract::errors::FILE_CLIENT_PICK_NOT_FILE(
                &path.display().to_string(),
            ));
        }
        if metadata.len() > CLIENT_PICK_FILE_MAX_BYTES {
            return Err(kaleidoscope_contract::errors::FILE_CLIENT_PICK_TOO_LARGE(
                &path.display().to_string(),
                kaleidoscope_contract::size::format_byte_limit(CLIENT_PICK_FILE_MAX_BYTES),
            ));
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                kaleidoscope_contract::errors::FILE_CLIENT_PICK_NAME_INVALID(
                    &path.display().to_string(),
                )
            })?
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
        .ok_or_else(|| input_not_owned(id))?;
    let name = input
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("선택한 파일");
    let file = File::open(&input.path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            kaleidoscope_contract::errors::FILE_CLIENT_READ_NOT_FOUND(name)
                .and_details(vec![error.to_string()])
        } else {
            kaleidoscope_contract::errors::FILE_CLIENT_READ_IO(name)
                .and_details(vec![error.to_string()])
        }
    })?;
    let mut bytes = Vec::new();
    file.take(CLIENT_PICK_FILE_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                kaleidoscope_contract::errors::FILE_CLIENT_READ_NOT_FOUND(name)
                    .and_details(vec![error.to_string()])
            } else {
                kaleidoscope_contract::errors::FILE_CLIENT_READ_IO(name)
                    .and_details(vec![error.to_string()])
            }
        })?;
    if bytes.len() as u64 > CLIENT_PICK_FILE_MAX_BYTES {
        return Err(kaleidoscope_contract::errors::FILE_CLIENT_READ_TOO_LARGE(
            name,
            kaleidoscope_contract::size::format_byte_limit(CLIENT_PICK_FILE_MAX_BYTES),
        ));
    }
    Ok(bytes)
}

pub(crate) fn input_path(inner: &Inner, window: &str, id: &str) -> Result<PathBuf, CoreError> {
    inner
        .client_files
        .inputs
        .lock()
        .unwrap()
        .get(id)
        .filter(|input| input.window == window)
        .map(|input| input.path.clone())
        .ok_or_else(|| input_not_owned(id))
}

pub(crate) fn register(
    inner: &Inner,
    window: &str,
    path: PathBuf,
) -> Result<ClientFile, CoreError> {
    let metadata = fs::metadata(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            kaleidoscope_contract::errors::FILE_CLIENT_REGISTER_NOT_FOUND(
                &path.display().to_string(),
            )
            .and_details(vec![error.to_string()])
        } else {
            kaleidoscope_contract::errors::FILE_CLIENT_REGISTER_IO(&path.display().to_string())
                .and_details(vec![error.to_string()])
        }
    })?;
    if !metadata.is_file() {
        return Err(
            kaleidoscope_contract::errors::FILE_CLIENT_REGISTER_NOT_FILE(
                &path.display().to_string(),
            ),
        );
    }
    if metadata.len() > CLIENT_PICK_FILE_MAX_BYTES {
        return Err(
            kaleidoscope_contract::errors::FILE_CLIENT_REGISTER_TOO_LARGE(
                &path.display().to_string(),
                kaleidoscope_contract::size::format_byte_limit(CLIENT_PICK_FILE_MAX_BYTES),
            ),
        );
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_CLIENT_REGISTER_NAME_INVALID(
                &path.display().to_string(),
            )
        })?
        .to_owned();
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    let id = Uuid::new_v4().to_string();
    inner.client_files.inputs.lock().unwrap().insert(
        id.clone(),
        Input {
            window: window.into(),
            path,
        },
    );
    Ok(ClientFile {
        id,
        name,
        size: metadata.len(),
        mime,
    })
}

pub(crate) fn begin(
    inner: &Inner,
    window: &str,
    name: &str,
    mime: &str,
) -> Result<Option<String>, CoreError> {
    begin_with_retention(inner, window, name, mime, false)
}

pub(crate) fn save_prompt(
    inner: &Inner,
    window: &str,
    name: &str,
    mime: &str,
) -> Result<Option<String>, CoreError> {
    begin_with_retention(inner, window, name, mime, true)
}

fn begin_with_retention(
    inner: &Inner,
    window: &str,
    name: &str,
    mime: &str,
    retain_on_commit: bool,
) -> Result<Option<String>, CoreError> {
    require_client(inner, window)?;
    let Some(target) = inner.host.pick_save_file(name, mime) else {
        return Ok(None);
    };
    let parent = target
        .parent()
        .ok_or_else(|| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_TARGET_INVALID(name))?;
    let id = Uuid::new_v4().to_string();
    let temp = parent.join(format!(".kaleidoscope-{id}.tmp"));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|error| {
            export_error(
                &error,
                name,
                |name| {
                    kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_TEMP_CREATE_NOT_FOUND(name)
                },
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_TEMP_CREATE_IO(name),
            )
        })?;
    inner.client_files.outputs.lock().unwrap().insert(
        id.clone(),
        Output {
            window: window.into(),
            target,
            temp,
            file,
            retain_on_commit,
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
        .ok_or_else(|| export_not_owned(id))?;
    let name = output
        .target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("내보내는 파일");
    output
        .file
        .seek(SeekFrom::Start(offset))
        .and_then(|_| output.file.write_all(bytes))
        .map_err(|error| {
            export_error(
                &error,
                name,
                |name| {
                    kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_CONTENT_WRITE_NOT_FOUND(name)
                },
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_CONTENT_WRITE_IO(name),
            )
        })
}

pub(crate) fn truncate(inner: &Inner, window: &str, id: &str, size: u64) -> Result<(), CoreError> {
    let mut outputs = inner.client_files.outputs.lock().unwrap();
    let output = outputs
        .get_mut(id)
        .filter(|output| output.window == window)
        .ok_or_else(|| export_not_owned(id))?;
    let name = output
        .target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("내보내는 파일");
    let position = output.file.stream_position().map_err(|error| {
        export_error(
            &error,
            name,
            |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_TRUNCATE_NOT_FOUND(name),
            |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_TRUNCATE_IO(name),
        )
    })?;
    output
        .file
        .set_len(size)
        .and_then(|_| {
            output
                .file
                .seek(SeekFrom::Start(position.min(size)))
                .map(|_| ())
        })
        .map_err(|error| {
            export_error(
                &error,
                name,
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_TRUNCATE_NOT_FOUND(name),
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_TRUNCATE_IO(name),
            )
        })
}

pub(crate) fn finish(inner: &Inner, window: &str, id: &str, commit: bool) -> Result<(), CoreError> {
    let mut outputs = inner.client_files.outputs.lock().unwrap();
    if outputs.get(id).is_none_or(|output| output.window != window) {
        return Err(export_not_owned(id));
    }
    let mut output = outputs.remove(id).unwrap();
    let name = output
        .target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("내보내는 파일")
        .to_string();
    let input = output.retain_on_commit.then(|| Input {
        window: output.window.clone(),
        path: output.target.clone(),
    });
    if commit {
        if let Err(error) = output.file.flush() {
            drop(output.file);
            let _ = fs::remove_file(&output.temp);
            return Err(export_error(
                &error,
                &name,
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_FLUSH_NOT_FOUND(name),
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_FLUSH_IO(name),
            ));
        }
    }
    drop(output.file);
    if commit {
        if let Err(error) = fs::rename(&output.temp, &output.target) {
            let _ = fs::remove_file(&output.temp);
            return Err(export_error(
                &error,
                &name,
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_RENAME_NOT_FOUND(name),
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_RENAME_IO(name),
            ));
        }
    } else {
        fs::remove_file(&output.temp).map_err(|error| {
            export_error(
                &error,
                &name,
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_CANCEL_NOT_FOUND(name),
                |name| kaleidoscope_contract::errors::FILE_CLIENT_EXPORT_CANCEL_IO(name),
            )
        })?;
    }
    drop(outputs);
    if commit {
        if let Some(input) = input {
            inner
                .client_files
                .inputs
                .lock()
                .unwrap()
                .insert(id.to_owned(), input);
        }
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
