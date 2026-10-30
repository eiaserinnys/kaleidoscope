use std::sync::{Arc, Mutex};
use std::time::Duration;

use kaleidoscope_core::kaleidoscope_contract::{
    UpdateStatus, UPDATE_CHECK_INTERVAL_SECS, UPDATE_FIRST_CHECK_DELAY_SECS,
};
use kaleidoscope_core::{Core, UpdateHost};
use tauri::AppHandle;
use tauri_plugin_updater::{Error, Update, UpdaterExt};

#[derive(Default)]
pub(crate) struct TauriUpdateHost {
    prepared: Mutex<Option<(Update, Vec<u8>)>>,
}

fn reason(action: &str, error: &Error) -> String {
    match error {
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => {
            "서명이 맞지 않아 깔지 않았습니다".into()
        }
        _ => format!("{action}: {}", error.to_string().replace(['\r', '\n'], " ")),
    }
}

impl UpdateHost for TauriUpdateHost {
    fn install(&self) -> Result<(), String> {
        let (update, bytes) = self
            .prepared
            .lock()
            .unwrap()
            .take()
            .ok_or_else(|| "준비된 업데이트가 없습니다".to_string())?;
        update
            .install(bytes)
            .map_err(|error| reason("업데이트 설치를 시작하지 못했습니다", &error))
    }
}

pub(crate) fn start(app: AppHandle, core: Arc<Core>, host: Arc<TauriUpdateHost>) {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(_) => return,
    };
    let current_version = app.package_info().version.to_string();
    core.set_update_status(UpdateStatus::Idle {
        current_version: current_version.clone(),
    });
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(UPDATE_FIRST_CHECK_DELAY_SECS)).await;
        loop {
            match updater.check().await {
                Ok(None) => core.set_update_status(UpdateStatus::Idle {
                    current_version: current_version.clone(),
                }),
                Ok(Some(update)) => {
                    let version = update.version.clone();
                    core.set_update_status(UpdateStatus::Downloading {
                        current_version: current_version.clone(),
                        version: version.clone(),
                    });
                    match update.download(|_, _| {}, || {}).await {
                        Ok(bytes) => {
                            *host.prepared.lock().unwrap() = Some((update, bytes));
                            core.set_update_status(UpdateStatus::Ready {
                                current_version: current_version.clone(),
                                version,
                            });
                            return;
                        }
                        Err(error) => core.set_update_status(UpdateStatus::Failed {
                            current_version: current_version.clone(),
                            version: Some(version),
                            reason: reason("업데이트를 받지 못했습니다", &error),
                        }),
                    }
                }
                Err(error) => core.set_update_status(UpdateStatus::Failed {
                    current_version: current_version.clone(),
                    version: None,
                    reason: reason("업데이트를 확인하지 못했습니다", &error),
                }),
            }
            tokio::time::sleep(Duration::from_secs(UPDATE_CHECK_INTERVAL_SECS)).await;
        }
    });
}
