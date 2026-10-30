#[cfg(feature = "e2e")]
mod e2e;
mod updater;
#[cfg(windows)]
mod web_host;

use std::env;
use std::path::PathBuf;
use std::sync::Arc;

use kaleidoscope_core::kaleidoscope_contract::{
    CoreError, CoreReply, CoreRequest, ErrorCode, TAURI_EVENT,
};
use kaleidoscope_core::{Core, CoreConfig, Host, PcRoot};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

// const 문맥에서는 Option::unwrap_or를 부를 수 없어(E0658) match로 고른다.
const SERVER_URL: &str = match option_env!("KALEIDOSCOPE_SERVER_URL") {
    Some(url) => url,
    None => "https://eiaserinnys.me/kaleidoscope",
};

struct DialogHost {
    app: AppHandle,
    updater: Arc<updater::TauriUpdateHost>,
    #[cfg(windows)]
    web: web_host::TauriWebHost,
}

impl Host for DialogHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        let parent = self
            .app
            .get_window("main")
            .expect("main window must exist while picking a folder");
        if let Some(path) = env::var_os("KALEIDOSCOPE_E2E_PICK_FOLDER") {
            return Some(path.into());
        }

        self.app
            .dialog()
            .file()
            .set_parent(&parent)
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
    }
    fn pc_roots(&self) -> Vec<PcRoot> {
        pc_roots()
    }
    #[cfg(windows)]
    fn web(&self) -> Option<&dyn kaleidoscope_core::WebHost> {
        Some(&self.web)
    }
    fn updater(&self) -> Option<&dyn kaleidoscope_core::UpdateHost> {
        Some(self.updater.as_ref())
    }
}

fn pc_roots() -> Vec<PcRoot> {
    use kaleidoscope_core::kaleidoscope_contract::{PcRootKind, PC_KNOWN_FOLDERS};
    let paths = [
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
        dirs::picture_dir(),
        dirs::audio_dir(),
        dirs::video_dir(),
    ];
    let roots: Vec<PcRoot> = PC_KNOWN_FOLDERS
        .iter()
        .zip(paths)
        .filter_map(|((id, name), path)| {
            let path = path.filter(|path| path.is_dir())?;
            Some(PcRoot {
                id: (*id).into(),
                kind: PcRootKind::Known,
                name: (*name).into(),
                path,
            })
        })
        .collect();
    #[cfg(windows)]
    let roots = {
        let mut roots = roots;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{GetLogicalDrives, GetVolumeInformationW};
        let drives = unsafe { GetLogicalDrives() };
        for index in 0..26 {
            if drives & (1 << index) == 0 {
                continue;
            }
            let letter = (b'A' + index as u8) as char;
            let path = format!("{letter}:\\");
            let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let mut volume = [0u16; 256];
            let result = unsafe {
                GetVolumeInformationW(
                    PCWSTR(wide.as_ptr()),
                    Some(&mut volume),
                    None,
                    None,
                    None,
                    None,
                )
            };
            if result.is_err() {
                continue;
            }
            let length = volume.iter().position(|&c| c == 0).unwrap_or(volume.len());
            let label = String::from_utf16_lossy(&volume[..length]);
            let label = if label.is_empty() {
                "로컬 디스크"
            } else {
                &label
            };
            roots.push(PcRoot {
                id: letter.to_string(),
                kind: PcRootKind::Volume,
                name: format!("{label} ({letter}:)"),
                path: PathBuf::from(path),
            });
        }
        roots
    };
    roots
}

#[tauri::command]
async fn core(request: CoreRequest, core: State<'_, Arc<Core>>) -> Result<CoreReply, CoreError> {
    #[cfg(feature = "e2e")]
    e2e::observe_ui(&request);
    let core = Arc::clone(core.inner());

    tauri::async_runtime::spawn_blocking(move || core.handle(request))
        .await
        .unwrap_or_else(|_| {
            Err(CoreError {
                code: ErrorCode::Io,
                message: "코어 작업이 중단되었습니다.".into(),
                details: Vec::new(),
            })
        })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let updater = Arc::new(updater::TauriUpdateHost::default());
            let core = match Core::open(
                CoreConfig {
                    data_dir,
                    seed_definitions: vec![],
                    server_url: SERVER_URL.into(),
                    device_name: env::var("COMPUTERNAME")
                        .or_else(|_| env::var("HOSTNAME"))
                        .unwrap_or_else(|_| "kaleidoscope".into()),
                },
                Arc::new(DialogHost {
                    app: app.handle().clone(),
                    updater: Arc::clone(&updater),
                    #[cfg(windows)]
                    web: web_host::TauriWebHost::new(app.handle().clone()),
                }),
            ) {
                Ok(core) => Arc::new(core),
                Err(error) => {
                    let details = error.details.join("\n");
                    let message = if details.is_empty() {
                        error.message
                    } else {
                        format!("{}\n\n{}", error.message, details)
                    };
                    app.dialog()
                        .message(message)
                        .kind(MessageDialogKind::Error)
                        .title("kaleidoscope를 시작할 수 없습니다")
                        .blocking_show();
                    std::process::exit(1);
                }
            };

            let event_app = app.handle().clone();
            core.subscribe(Box::new(move |event| {
                let _ = event_app.emit(TAURI_EVENT, event);
            }));
            app.manage(Arc::clone(&core));
            #[cfg(feature = "e2e")]
            let run_updater = matches!(
                e2e::setting("SCENARIO")
                    .as_deref()
                    .and_then(std::ffi::OsStr::to_str),
                Some("update" | "update-reject")
            );
            #[cfg(not(feature = "e2e"))]
            let run_updater = true;
            if run_updater {
                updater::start(app.handle().clone(), Arc::clone(&core), updater);
            }
            #[cfg(feature = "e2e")]
            e2e::start(app.handle().clone(), core);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core])
        .run(tauri::generate_context!())
        .expect("error while running kaleidoscope application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn capability_is_restricted_to_main_webview() {
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert_eq!(value["webviews"], serde_json::json!(["main"]));
        assert!(value.get("windows").is_none());
    }
}
