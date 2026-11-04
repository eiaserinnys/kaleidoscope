//! 기기에서 자손과 수명을 함께하는 프로세스를 띄운다.
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use std::{collections::BTreeMap, io, path::Path, process::Stdio};
use tokio::process::Command;

#[cfg(any(windows, test))]
fn merge_paths(system: &str, user: &str, process: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    [system, user, process]
        .into_iter()
        .flat_map(|path| path.split(';'))
        .filter(|entry| !entry.is_empty() && seen.insert(entry.to_lowercase()))
        .collect::<Vec<_>>()
        .join(";")
}

#[cfg(any(windows, test))]
fn child_path<'a>(env: &'a BTreeMap<String, String>, merged: &'a str) -> &'a str {
    env.iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("PATH"))
        .map_or(merged, |(_, value)| value.as_str())
}

#[cfg(windows)]
fn refreshed_path() -> io::Result<String> {
    use winreg::{enums::*, types::FromRegValue, RegKey};

    fn registry_path(key: RegKey, subkey: &str) -> io::Result<String> {
        let value = key.open_subkey(subkey)?.get_raw_value("Path")?;
        let path = String::from_reg_value(&value)?;
        match value.vtype {
            REG_SZ => Ok(path),
            REG_EXPAND_SZ => expand_environment(&path),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid PATH type",
            )),
        }
    }

    let system = registry_path(
        RegKey::predef(HKEY_LOCAL_MACHINE),
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    )?;
    let user = registry_path(RegKey::predef(HKEY_CURRENT_USER), "Environment")?;
    let process = std::env::var_os("PATH").unwrap_or_default();
    Ok(merge_paths(&system, &user, &process.to_string_lossy()))
}

#[cfg(windows)]
fn expand_environment(value: &str) -> io::Result<String> {
    use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;

    let source: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
    let length = unsafe { ExpandEnvironmentStringsW(source.as_ptr(), std::ptr::null_mut(), 0) };
    if length == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut result = vec![0u16; length as usize];
    let written =
        unsafe { ExpandEnvironmentStringsW(source.as_ptr(), result.as_mut_ptr(), length) };
    if written == 0 {
        return Err(io::Error::last_os_error());
    }
    if written > length {
        return Err(io::Error::other("expanded PATH changed during read"));
    }
    result.truncate((written - 1) as usize);
    Ok(String::from_utf16_lossy(&result))
}

#[cfg(test)]
mod path_tests {
    use super::{child_path, merge_paths};
    use std::collections::BTreeMap;

    #[test]
    fn merged_path_preserves_priority_and_removes_duplicates_and_empty_entries() {
        assert_eq!(
            merge_paths(
                "C:\\System;;C:\\Shared",
                "c:\\shared;C:\\User;",
                ";C:\\USER;C:\\Process;C:\\SYSTEM"
            ),
            "C:\\System;C:\\Shared;C:\\User;C:\\Process"
        );
    }

    #[test]
    fn child_path_prefers_explicit_path_case_insensitively() {
        let mut env = BTreeMap::new();
        assert_eq!(child_path(&env, "merged"), "merged");
        env.insert("pAtH".into(), "explicit".into());
        assert_eq!(child_path(&env, "merged"), "explicit");
    }
}

pub(crate) enum SpawnFailure {
    Resolve(io::Error),
    Spawn(io::Error),
}

impl SpawnFailure {
    pub(crate) fn into_io(self) -> io::Error {
        match self {
            Self::Resolve(error) | Self::Spawn(error) => error,
        }
    }
}

pub(crate) fn spawn(
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
    cwd: &Path,
) -> Result<Box<dyn ChildWrapper>, SpawnFailure> {
    #[cfg(windows)]
    let refreshed = refreshed_path().ok();
    #[cfg(windows)]
    let resolved = match &refreshed {
        Some(path) => which::which_in(command, Some(path), cwd),
        None => which::which(command),
    };
    #[cfg(not(windows))]
    let resolved = which::which(command);
    let path =
        resolved.map_err(|e| SpawnFailure::Resolve(io::Error::new(io::ErrorKind::NotFound, e)))?;
    let mut command = Command::new(path);
    command.args(args).envs(env);
    #[cfg(windows)]
    if let Some(path) = &refreshed {
        command.env("PATH", child_path(env, path));
    }
    command
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut wrapped = CommandWrap::from(command);
    #[cfg(unix)]
    wrapped.wrap(process_wrap::tokio::ProcessGroup::leader());
    #[cfg(windows)]
    {
        wrapped.wrap(process_wrap::tokio::JobObject);
        let mut flags = process_wrap::tokio::CreationFlags(Default::default());
        flags.0 .0 = 0x08000000;
        wrapped.wrap(flags);
    }
    wrapped.wrap(KillOnDrop);
    wrapped.spawn().map_err(SpawnFailure::Spawn)
}

#[cfg(all(test, windows))]
mod windows_path_tests {
    use super::spawn;
    use std::{collections::BTreeMap, fs, io};
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_EXPAND_SZ},
        types::{FromRegValue, ToRegValue},
        RegKey, RegValue,
    };

    struct RestorePath {
        key: RegKey,
        original: Option<RegValue<'static>>,
    }

    impl Drop for RestorePath {
        fn drop(&mut self) {
            let result = match &self.original {
                Some(value) => self.key.set_raw_value("Path", value),
                None => self.key.delete_value("Path"),
            };
            result.expect("사용자 PATH 복원 실패");
        }
    }

    #[test]
    fn windows_process_finds_new_user_path_without_restart() {
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
            .unwrap();
        let original = match key.get_raw_value("Path") {
            Ok(value) => Some(value),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => panic!("사용자 PATH 읽기 실패: {error}"),
        };
        let previous = original
            .as_ref()
            .map(String::from_reg_value)
            .transpose()
            .unwrap()
            .unwrap_or_default();
        let guard = RestorePath { key, original };
        let temp = tempfile::tempdir_in(std::env::var_os("TEMP").unwrap()).unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let name = format!("ks-path-test-{}", uuid::Uuid::new_v4().simple());
        let helper = format!("{name}-child.cmd");
        fs::write(bin.join(&helper), "@exit /b 0\r\n").unwrap();
        fs::write(
            bin.join(format!("{name}.cmd")),
            format!("@echo off\r\ncall {helper}\r\nexit /b %errorlevel%\r\n"),
        )
        .unwrap();
        let path = format!(
            "{previous};%TEMP%\\{}\\bin",
            temp.path().file_name().unwrap().to_string_lossy()
        );
        let mut value = path.to_reg_value();
        value.vtype = REG_EXPAND_SZ;
        guard.key.set_raw_value("Path", &value).unwrap();

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let mut child = spawn(&format!("{name}.cmd"), &[], &BTreeMap::new(), temp.path())
                .unwrap_or_else(|error| panic!("프로세스 시작 실패: {}", error.into_io()));
            let status = tokio::time::timeout(std::time::Duration::from_secs(30), child.wait())
                .await
                .expect("프로세스 종료 시간 초과")
                .unwrap();
            assert_eq!(status.code(), Some(0));
        });
    }
}
