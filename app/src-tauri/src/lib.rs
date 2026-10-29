#[cfg(feature = "e2e")]
mod e2e;
#[cfg(windows)]
mod web_host;

use std::env;
use std::path::PathBuf;
use std::sync::Arc;

use kaleidoscope_core::kaleidoscope_contract::{
    CoreError, CoreReply, CoreRequest, ErrorCode, TAURI_EVENT,
};
use kaleidoscope_core::{Core, CoreConfig, Host};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

// const 문맥에서는 Option::unwrap_or를 부를 수 없어(E0658) match로 고른다.
const SERVER_URL: &str = match option_env!("KALEIDOSCOPE_SERVER_URL") {
    Some(url) => url,
    None => "https://eiaserinnys.me/kaleidoscope",
};

struct DialogHost {
    app: AppHandle,
    #[cfg(windows)]
    web: web_host::TauriWebHost,
}

impl Host for DialogHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        if let Some(path) = env::var_os("KALEIDOSCOPE_E2E_PICK_FOLDER") {
            return Some(path.into());
        }
        let parent = self
            .app
            .get_webview_window("main")
            .expect("main window must exist while picking a folder");

        self.app
            .dialog()
            .file()
            .set_parent(&parent)
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
    }
    #[cfg(windows)]
    fn web(&self) -> Option<&dyn kaleidoscope_core::WebHost> {
        Some(&self.web)
    }
}

#[tauri::command]
async fn core(request: CoreRequest, core: State<'_, Arc<Core>>) -> Result<CoreReply, CoreError> {
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
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let core = match Core::open(
                CoreConfig {
                    data_dir,
                    seed_definitions: vec![include_str!("../../../examples/md-editor.json").into()],
                    server_url: SERVER_URL.into(),
                    device_name: env::var("COMPUTERNAME")
                        .or_else(|_| env::var("HOSTNAME"))
                        .unwrap_or_else(|_| "kaleidoscope".into()),
                },
                Arc::new(DialogHost {
                    app: app.handle().clone(),
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
