use std::path::PathBuf;
use std::sync::Arc;

use kaleidoscope_core::kaleidoscope_contract::{
    CoreError, CoreEvent, CoreReply, CoreRequest, ErrorCode, TAURI_EVENT,
};
use kaleidoscope_core::{Core, CoreConfig, Host};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

struct DialogHost {
    app: AppHandle,
}

impl Host for DialogHost {
    fn pick_folder(&self) -> Option<PathBuf> {
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
}

#[tauri::command]
async fn core(
    request: CoreRequest,
    core: State<'_, Arc<Core>>,
) -> Result<CoreReply, CoreError> {
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
                },
                Arc::new(DialogHost {
                    app: app.handle().clone(),
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
            app.manage(core);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![core])
        .run(tauri::generate_context!())
        .expect("error while running kaleidoscope application");
}
