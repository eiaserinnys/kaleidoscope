use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::Path;

use kaleidoscope_contract::{file_name::check_file_name, CoreError};

use super::helpers::{file_system_error, named_error, path_exists};

pub(super) fn copy_entry(source: &Path, destination: &Path) -> Result<(), CoreError> {
    let metadata = fs::symlink_metadata(source).map_err(|error| {
        let path = source.display().to_string();
        file_system_error(
            &error,
            || kaleidoscope_contract::errors::FILE_COPY_ENTRY_SOURCE_METADATA_NOT_FOUND(&path),
            || kaleidoscope_contract::errors::FILE_COPY_ENTRY_SOURCE_METADATA_BUSY(&path),
            || kaleidoscope_contract::errors::FILE_COPY_ENTRY_SOURCE_METADATA_IO(&path),
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err(kaleidoscope_contract::errors::FILE_PATH_OUTSIDE_ROOT(
            &source.display().to_string(),
        ));
    }
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|error| {
            let path = destination.display().to_string();
            file_system_error(
                &error,
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_CREATE_FOLDER_NOT_FOUND(&path),
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_CREATE_FOLDER_BUSY(&path),
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_CREATE_FOLDER_IO(&path),
            )
        })?;
        for entry in fs::read_dir(source).map_err(|error| {
            let path = source.display().to_string();
            file_system_error(
                &error,
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_READ_FOLDER_NOT_FOUND(&path),
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_READ_FOLDER_BUSY(&path),
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_READ_FOLDER_IO(&path),
            )
        })? {
            let entry = entry.map_err(|error| {
                let path = source.display().to_string();
                file_system_error(
                    &error,
                    || kaleidoscope_contract::errors::FILE_COPY_ENTRY_READ_ITEM_NOT_FOUND(&path),
                    || kaleidoscope_contract::errors::FILE_COPY_ENTRY_READ_ITEM_BUSY(&path),
                    || kaleidoscope_contract::errors::FILE_COPY_ENTRY_READ_ITEM_IO(&path),
                )
            })?;
            let target = destination.join(entry.file_name());
            copy_entry(&entry.path(), &target)?;
        }
    } else {
        let mut input = File::open(source).map_err(|error| {
            let path = source.display().to_string();
            file_system_error(
                &error,
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_OPEN_FILE_NOT_FOUND(&path),
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_OPEN_FILE_BUSY(&path),
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_OPEN_FILE_IO(&path),
            )
        })?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|error| {
                if error.kind() == io::ErrorKind::AlreadyExists {
                    kaleidoscope_contract::errors::FILE_COPY_NAME_TAKEN(
                        &destination.display().to_string(),
                    )
                    .and_details(vec![error.to_string()])
                } else {
                    let path = destination.display().to_string();
                    file_system_error(
                        &error,
                        || {
                            kaleidoscope_contract::errors::FILE_COPY_ENTRY_CREATE_FILE_NOT_FOUND(
                                &path,
                            )
                        },
                        || kaleidoscope_contract::errors::FILE_COPY_ENTRY_CREATE_FILE_BUSY(&path),
                        || kaleidoscope_contract::errors::FILE_COPY_ENTRY_CREATE_FILE_IO(&path),
                    )
                }
            })?;
        io::copy(&mut input, &mut output).map_err(|error| {
            let path = destination.display().to_string();
            file_system_error(
                &error,
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_WRITE_FILE_NOT_FOUND(&path),
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_WRITE_FILE_BUSY(&path),
                || kaleidoscope_contract::errors::FILE_COPY_ENTRY_WRITE_FILE_IO(&path),
            )
        })?;
    }
    Ok(())
}

pub(super) fn copy_name(
    source: &Path,
    name: &str,
    destination: &Path,
) -> Result<String, CoreError> {
    let is_dir = fs::metadata(source)
        .map_err(|error| {
            let path = source.display().to_string();
            file_system_error(
                &error,
                || kaleidoscope_contract::errors::FILE_COPY_NAME_SOURCE_METADATA_NOT_FOUND(&path),
                || kaleidoscope_contract::errors::FILE_COPY_NAME_SOURCE_METADATA_BUSY(&path),
                || kaleidoscope_contract::errors::FILE_COPY_NAME_SOURCE_METADATA_IO(&path),
            )
        })?
        .is_dir();
    let (stem, extension) = if is_dir {
        (name, None)
    } else if let Some(index) = name.rfind('.').filter(|index| *index > 0) {
        (&name[..index], Some(&name[index..]))
    } else {
        (name, None)
    };
    let suffix = |index: usize| {
        if index == 1 {
            " - 복사본".to_string()
        } else {
            format!(" - 복사본 ({index})")
        }
    };
    for index in 1.. {
        let candidate = format!("{}{}{}", stem, suffix(index), extension.unwrap_or(""));
        check_file_name(&candidate).map_err(|message| named_error(message))?;
        if !path_exists(&destination.join(&candidate))? {
            return Ok(candidate);
        }
    }
    unreachable!()
}

pub(super) fn remove_entry(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}
