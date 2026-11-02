use std::fs;
use std::path::{Path, PathBuf};

use kaleidoscope_contract::{validate::valid_relative_path, CoreError};

pub(crate) fn resolve_path(
    data_dir: &Path,
    root: &Path,
    relative: &str,
    allow_root: bool,
    allow_missing: bool,
) -> Result<PathBuf, CoreError> {
    if !valid_relative_path(relative, allow_root) {
        return Err(kaleidoscope_contract::errors::FILE_PATH_OUTSIDE_ROOT(
            relative,
        ));
    }
    let candidate = if relative.is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
    let (resolved, exists, missing_details) = match fs::canonicalize(&candidate) {
        Ok(canonical) => {
            if canonical.starts_with(root) {
                Ok((canonical, true, None))
            } else {
                Err(kaleidoscope_contract::errors::FILE_PATH_OUTSIDE_ROOT(
                    relative,
                ))
            }
        }
        Err(io_error) if io_error.kind() == std::io::ErrorKind::NotFound => {
            ensure_missing_path_inside(root, &candidate)?;
            Ok((candidate, false, Some(io_error.to_string())))
        }
        Err(io_error) => {
            let error = if is_path_busy(&io_error) {
                kaleidoscope_contract::errors::FILE_PATH_BUSY(relative)
            } else {
                kaleidoscope_contract::errors::FILE_PATH_IO(relative)
            };
            Err(error.and_details(vec![io_error.to_string()]))
        }
    }?;
    let actual = if exists {
        resolved.clone()
    } else {
        let parent = resolved.parent().ok_or_else(|| {
            kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(&resolved.display().to_string())
        })?;
        fs::canonicalize(parent)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(relative)
                        .and_details(vec![error.to_string()])
                } else {
                    kaleidoscope_contract::errors::FILE_PATH_IO(&resolved.display().to_string())
                        .and_details(vec![error.to_string()])
                }
            })?
            .join(resolved.file_name().ok_or_else(|| {
                kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(&resolved.display().to_string())
            })?)
    };
    let protected = fs::canonicalize(data_dir).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(&data_dir.display().to_string())
                .and_details(vec![error.to_string()])
        } else {
            kaleidoscope_contract::errors::FILE_PATH_IO(&data_dir.display().to_string())
                .and_details(vec![error.to_string()])
        }
    })?;
    if actual.starts_with(protected) {
        return Err(kaleidoscope_contract::errors::FILE_PATH_PROTECTED(
            &actual.display().to_string(),
        ));
    }
    if !exists && !allow_missing {
        return Err(kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(relative)
            .and_details(missing_details.into_iter().collect()));
    }
    Ok(resolved)
}

fn ensure_missing_path_inside(root: &Path, candidate: &Path) -> Result<(), CoreError> {
    match fs::canonicalize(candidate) {
        Ok(canonical) => {
            if canonical.starts_with(root) {
                Ok(())
            } else {
                Err(kaleidoscope_contract::errors::FILE_PATH_OUTSIDE_ROOT(
                    &candidate.display().to_string(),
                ))
            }
        }
        Err(io_error) if io_error.kind() == std::io::ErrorKind::NotFound => {
            if let Ok(metadata) = fs::symlink_metadata(candidate) {
                if metadata.file_type().is_symlink() {
                    let target = fs::read_link(candidate).map_err(|error| {
                        if error.kind() == std::io::ErrorKind::NotFound {
                            kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(
                                &candidate.display().to_string(),
                            )
                            .and_details(vec![error.to_string()])
                        } else {
                            kaleidoscope_contract::errors::FILE_PATH_IO(
                                &candidate.display().to_string(),
                            )
                            .and_details(vec![error.to_string()])
                        }
                    })?;
                    let target = if target.is_absolute() {
                        target
                    } else {
                        candidate
                            .parent()
                            .ok_or_else(|| {
                                kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(
                                    &candidate.display().to_string(),
                                )
                            })?
                            .join(target)
                    };
                    return ensure_missing_path_inside(root, &target);
                }
            }
            let parent = candidate.parent().ok_or_else(|| {
                kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(&candidate.display().to_string())
            })?;
            let canonical_parent = fs::canonicalize(parent).map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    kaleidoscope_contract::errors::FILE_PATH_NOT_FOUND(
                        &candidate.display().to_string(),
                    )
                    .and_details(vec![error.to_string()])
                } else {
                    kaleidoscope_contract::errors::FILE_PATH_IO(&candidate.display().to_string())
                        .and_details(vec![error.to_string()])
                }
            })?;
            if canonical_parent.starts_with(root) {
                Ok(())
            } else {
                Err(kaleidoscope_contract::errors::FILE_PATH_OUTSIDE_ROOT(
                    &candidate.display().to_string(),
                ))
            }
        }
        Err(io_error) => Err(kaleidoscope_contract::errors::FILE_PATH_IO(
            &candidate.display().to_string(),
        )
        .and_details(vec![io_error.to_string()])),
    }
}

#[cfg(windows)]
fn is_path_busy(error: &std::io::Error) -> bool {
    matches!(error.raw_os_error(), Some(32 | 33))
}

#[cfg(not(windows))]
fn is_path_busy(_error: &std::io::Error) -> bool {
    false
}
