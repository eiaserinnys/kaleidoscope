#[cfg(any(windows, test))]
mod context_menu;
#[cfg(feature = "e2e")]
mod e2e;
#[cfg(windows)]
mod freeze_cover;
#[cfg(any(target_os = "macos", all(unix, test)))]
mod login_path;
#[cfg(windows)]
mod native_webview;
#[cfg(windows)]
mod shell_shortcuts;
mod updater;
#[cfg(windows)]
mod web_control;
#[cfg(windows)]
mod web_host;

use std::env;
use std::path::PathBuf;
use std::sync::Arc;

use kaleidoscope_core::kaleidoscope_contract::{
    errors, CoreError, CoreReply, CoreRequest, TAURI_EVENT,
};
use kaleidoscope_core::{Core, CoreConfig, Host, PcRoot};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

// const 문맥에서는 Option::unwrap_or를 부를 수 없어(E0658) match로 고른다.
const SERVER_URL: &str = match option_env!("KALEIDOSCOPE_SERVER_URL") {
    Some(url) => url,
    None => "",
};

struct DialogHost {
    app: AppHandle,
    updater: Arc<updater::TauriUpdateHost>,
    #[cfg(windows)]
    web: Arc<web_host::TauriWebHost>,
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
    fn pick_files(
        &self,
        accept: &[kaleidoscope_core::kaleidoscope_contract::data::FileAccept],
        multiple: bool,
    ) -> Option<Vec<PathBuf>> {
        let parent = self.app.get_window("main")?;
        let mut dialog = self.app.dialog().file().set_parent(&parent);
        for item in accept {
            let extensions: Vec<_> = item
                .extensions
                .iter()
                .map(|extension| extension.trim_start_matches('.'))
                .collect();
            if !extensions.is_empty() {
                dialog = dialog.add_filter(&item.mime, &extensions);
            }
        }
        if multiple {
            dialog
                .blocking_pick_files()?
                .into_iter()
                .map(|path| path.into_path().ok())
                .collect()
        } else {
            Some(vec![dialog.blocking_pick_file()?.into_path().ok()?])
        }
    }
    fn pick_save_file(&self, suggested_name: &str, _mime: &str) -> Option<PathBuf> {
        let parent = self.app.get_window("main")?;
        self.app
            .dialog()
            .file()
            .set_parent(&parent)
            .set_file_name(suggested_name)
            .blocking_save_file()?
            .into_path()
            .ok()
    }
    fn pc_roots(&self) -> Vec<PcRoot> {
        pc_roots()
    }
    #[cfg(windows)]
    fn web(&self) -> Option<&dyn kaleidoscope_core::WebHost> {
        Some(self.web.as_ref())
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
    let observed_request = request.clone();
    #[cfg(feature = "e2e")]
    e2e::observe_ui(&observed_request);
    let core = Arc::clone(core.inner());

    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(feature = "e2e")]
        let started = std::time::Instant::now();
        let result = core.handle(request);
        #[cfg(feature = "e2e")]
        e2e::complete_ui(&observed_request, started.elapsed().as_millis());
        result
    })
    .await
    .unwrap_or_else(|_| Err(errors::SHELL_IPC_CORE_TASK_INTERRUPTED()))
}

#[tauri::command]
async fn core_bytes(
    request: tauri::ipc::Request<'_>,
    core: State<'_, Arc<Core>>,
) -> Result<tauri::ipc::Response, CoreError> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
            .ok_or_else(|| match name {
                "x-ks-operation" => errors::SHELL_IPC_OPERATION_HEADER_INVALID(),
                "x-ks-window" => errors::SHELL_IPC_WINDOW_HEADER_INVALID(),
                _ => unreachable!("core_bytes only reads its two required headers"),
            })
    };
    let operation = header("x-ks-operation")?;
    let window = header("x-ks-window")?;
    // WebView2는 값이 빈 헤더를 버리므로 없는 handle은 빈 값으로 읽는다.
    let handle = match request.headers().get("x-ks-handle") {
        Some(value) => value.to_str().map_err(|_| errors::SHELL_IPC_HANDLE_HEADER_INVALID())?,
        None => "",
    };
    let handle = percent_encoding::percent_decode_str(&handle)
        .decode_utf8_lossy()
        .into_owned();
    let offset = request
        .headers()
        .get("x-ks-offset")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err(errors::SHELL_IPC_BODY_INVALID()),
    };
    let core = Arc::clone(core.inner());
    let result = tauri::async_runtime::spawn_blocking(move || match operation.as_str() {
        "files.read_bytes" => core.client_read_file(&window, &handle),
        "export.write" => core
            .client_write_export(
                &window,
                &handle,
                offset.ok_or_else(errors::SHELL_IPC_EXPORT_OFFSET_INVALID)?,
                &bytes,
            )
            .map(|()| Vec::new()),
        "client.http_read"
        | "client.http_request"
        | "client.blob_put"
        | "process.write"
        | "connection.realtime.read"
        | "connection.realtime.send" => {
            #[cfg(feature = "e2e")]
            e2e::observe_bytes(&operation);
            core.client_binary(&operation, &window, &handle, &bytes)
        }
        _ => Err(errors::SHELL_IPC_OPERATION_UNSUPPORTED()),
    })
    .await
    .map_err(|_| errors::SHELL_IPC_BYTES_TASK_INTERRUPTED())??;
    Ok(tauri::ipc::Response::new(result))
}

pub fn run() {
    // 런타임과 스레드가 뜨기 전에 PATH를 정해 두어야 모든 자식 프로세스가 같은 PATH를 받는다.
    #[cfg(target_os = "macos")]
    login_path::apply();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(windows)]
            native_webview::configure_main(app.handle())?;
            let data_dir = app.path().app_data_dir()?;
            let device_name = env::var("COMPUTERNAME")
                .or_else(|_| env::var("HOSTNAME"))
                .unwrap_or_else(|_| "kaleidoscope".into());
            let embedded =
                tauri::async_runtime::block_on(kaleidoscope_orchestrator::EmbeddedServer::start(
                    kaleidoscope_orchestrator::EmbeddedConfig {
                        db_path: data_dir.join("local-orchestrator.db"),
                        token_path: data_dir.join("local-orchestrator.token"),
                        device_name: device_name.clone(),
                    },
                ))
                .map_err(std::io::Error::other)?;
            let embedded_info = kaleidoscope_core::EmbeddedServerInfo {
                server_url: embedded.server_url.clone(),
                device_id: embedded.device_id.clone(),
                token: embedded.token.clone(),
            };
            app.manage(embedded);
            let updater = Arc::new(updater::TauriUpdateHost::default());
            #[cfg(windows)]
            let web = Arc::new(web_host::TauriWebHost::new(app.handle().clone()));
            #[cfg(all(windows, feature = "e2e"))]
            app.manage(Arc::clone(&web));
            let core = match Core::open(
                CoreConfig {
                    media_origin: if cfg!(debug_assertions) {
                        app.config().build.dev_url.as_ref().map(|url| url.origin().ascii_serialization())
                    } else {
                        Some("http://tauri.localhost".into())
                    },
                    embedded_server: Some(embedded_info),
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
                    web,
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
            // 배포 매니페스트는 Windows 설치본만 싣는다. 다른 플랫폼은 업데이터를 켜지 않아 `unavailable`로 남는다.
            #[cfg(not(feature = "e2e"))]
            let run_updater = cfg!(windows);
            if run_updater {
                updater::start(app.handle().clone(), Arc::clone(&core), updater);
            }
            #[cfg(feature = "e2e")]
            e2e::start(app.handle().clone(), core);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core, core_bytes])
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                shell_shortcuts::clear();
            }
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Resized(_)) {
                if let (Some(core), Ok(minimized)) = (
                    window.app_handle().try_state::<Arc<Core>>(),
                    window.is_minimized(),
                ) {
                    core.set_shell_visible(!minimized);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building kaleidoscope application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                #[cfg(windows)]
                shell_shortcuts::clear();
                if let Some(core) = app.try_state::<Arc<Core>>() {
                    core.shutdown();
                }
            }
        });
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
