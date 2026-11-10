mod close;
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
    errors, CoreError, CoreReply, CoreRequest, ThemePreference, TAURI_EVENT,
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

/// 코어의 테마 선택을 네이티브 창 테마로 옮긴다. `None`이면 운영체제를 따른다.
/// Windows에서는 창 테마가 바뀌면 그 창의 WebView2 선호 색 구성도 같이 바뀌어, 웹 내용이 `prefers-color-scheme`로 따른다.
fn native_theme(theme: ThemePreference) -> Option<tauri::Theme> {
    match theme {
        ThemePreference::System => None,
        ThemePreference::Light => Some(tauri::Theme::Light),
        ThemePreference::Dark => Some(tauri::Theme::Dark),
    }
}

impl Host for DialogHost {
    fn supports_pick_files(&self) -> bool {
        true
    }

    fn apply_theme(&self, theme: ThemePreference) {
        if let Some(window) = self.app.get_window("main") {
            if let Err(error) = window.set_theme(native_theme(theme)) {
                eprintln!("창 테마를 바꾸지 못했습니다: {error}");
            }
        }
    }
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

/// 설치본 페이지의 Origin. Tauri가 앱 페이지를 내주는 주소와 같아야 미디어 스트림의 Origin 검사를 지난다.
/// Windows와 Android는 `http(s)://tauri.localhost`, 그 밖(macOS 등)은 `tauri://localhost`다.
/// `tauri://`는 비특수 스킴이라 URL에서 유도하면 `"null"`이 나오므로 문자열로 정한다.
fn release_page_origin(localhost_over_http: bool, use_https: bool) -> String {
    if localhost_over_http {
        let scheme = if use_https { "https" } else { "http" };
        format!("{scheme}://tauri.localhost")
    } else {
        "tauri://localhost".into()
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

/// 이 기기를 부를 이름. 기기 목록과 서버 짝짓기에 쓰인다.
/// macOS 앱은 Finder에서 열면 `COMPUTERNAME`도 `HOSTNAME`도 받지 못해, 시스템 설정의 컴퓨터 이름을 읽는다.
fn device_name() -> String {
    #[cfg(target_os = "macos")]
    let computer_name = mac_computer_name;
    #[cfg(not(target_os = "macos"))]
    let computer_name = || None;
    pick_device_name(
        env::var("COMPUTERNAME").ok(),
        env::var("HOSTNAME").ok(),
        computer_name,
    )
}

/// 앞에서부터 비지 않은 이름을 고르고, 서버 짝짓기가 받는 100자 안으로 자른다.
/// 컴퓨터 이름은 환경 변수가 둘 다 비었을 때만 읽는다.
fn pick_device_name(
    computer_name_env: Option<String>,
    hostname_env: Option<String>,
    computer_name: impl FnOnce() -> Option<String>,
) -> String {
    let usable = |name: Option<String>| {
        name.map(|name| name.trim().chars().take(100).collect::<String>())
            .filter(|name| !name.is_empty())
    };
    usable(computer_name_env)
        .or_else(|| usable(hostname_env))
        .or_else(|| usable(computer_name()))
        .unwrap_or_else(|| "kaleidoscope".into())
}

/// 시스템 설정 > 일반 > 정보에 보이는 컴퓨터 이름. 읽지 못하면 `None`이다.
#[cfg(target_os = "macos")]
fn mac_computer_name() -> Option<String> {
    use std::process::{Command, Stdio};
    let output = Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

pub fn run() {
    // 런타임과 스레드가 뜨기 전에 PATH를 정해 두어야 모든 자식 프로세스가 같은 PATH를 받는다.
    #[cfg(target_os = "macos")]
    login_path::apply();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(close::CloseState::default());
            let data_dir = app.path().app_data_dir()?;
            let device_name = device_name();
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
                        let use_https = app
                            .config()
                            .app
                            .windows
                            .iter()
                            .find(|window| window.label == "main")
                            .is_some_and(|window| window.use_https_scheme);
                        Some(release_page_origin(
                            cfg!(windows) || cfg!(target_os = "android"),
                            use_https,
                        ))
                    },
                    embedded_server: Some(embedded_info),
                    data_dir,
                    seed_definitions: vec![],
                    server_url: SERVER_URL.into(),
                    device_name,
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

            // 첫 창은 코어가 고른 테마로 만든다. 설정 파일로 미리 만들면 운영체제 테마로 한 번 그렸다가 바뀐다.
            let main_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or("main window config missing")?
                .clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &main_config)?
                .theme(native_theme(core.theme()))
                .build()?;
            #[cfg(windows)]
            native_webview::configure_main(app.handle())?;

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
        .invoke_handler(tauri::generate_handler![
            core,
            core_bytes,
            close::shell_close_ready,
            close::shell_finish_close
        ])
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
            {
                close::set_ready(webview.app_handle(), false);
            }
        })
        .on_window_event(|window, event| {
            close::handle_close_requested(window, event);
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
    use super::release_page_origin;

    #[test]
    fn release_page_origin_matches_tauri_protocol_origin() {
        assert_eq!(release_page_origin(true, false), "http://tauri.localhost");
        assert_eq!(release_page_origin(true, true), "https://tauri.localhost");
        assert_eq!(release_page_origin(false, false), "tauri://localhost");
        assert_eq!(release_page_origin(false, true), "tauri://localhost");
    }

    #[test]
    fn capability_is_restricted_to_main_webview() {
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert_eq!(value["webviews"], serde_json::json!(["main"]));
        assert!(value.get("windows").is_none());
        let permissions = value["permissions"].as_array().unwrap();
        for permission in ["allow-shell-close-ready", "allow-shell-finish-close"] {
            assert!(
                permissions.iter().any(|item| item == permission),
                "{permission} is missing"
            );
        }
    }

    fn name(value: &str) -> Option<String> {
        Some(value.into())
    }

    #[test]
    fn device_name_prefers_env_in_order() {
        let mac = || panic!("환경 변수가 있으면 컴퓨터 이름을 읽지 않는다");
        assert_eq!(
            super::pick_device_name(name("WIN-PC"), name("host"), mac),
            "WIN-PC"
        );
        assert_eq!(super::pick_device_name(None, name("host"), mac), "host");
        assert_eq!(
            super::pick_device_name(None, None, || name("내 MacBook")),
            "내 MacBook"
        );
        assert_eq!(super::pick_device_name(None, None, || None), "kaleidoscope");
    }

    #[test]
    fn device_name_skips_blank_and_trims() {
        assert_eq!(
            super::pick_device_name(name(""), name("  \t"), || name("  맥북\n")),
            "맥북"
        );
        assert_eq!(
            super::pick_device_name(name(" "), None, || name("\n")),
            "kaleidoscope"
        );
    }

    #[test]
    fn device_name_is_capped_to_pairing_limit() {
        let long = "가".repeat(150);
        let picked = super::pick_device_name(None, None, || Some(long.clone()));
        assert_eq!(picked.chars().count(), 100);
        assert!(long.starts_with(&picked));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_computer_name_reads_scutil() {
        let name = super::mac_computer_name().expect("scutil --get ComputerName");
        assert!(!name.trim().is_empty());
    }
}
