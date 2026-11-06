// Windows 웹뷰 수명과 캡처 및 제어 연결이 한 호스트에 모여 있어 500줄을 넘는다.
use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use kaleidoscope_core::kaleidoscope_contract::{
    errors, CoreError, Rect, WebHistoryAction, WebPage, WindowControlOperation, WindowControlResult,
};
use kaleidoscope_core::{Core, WebHost};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl,
};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
};
use webview2_com::{
    CapturePreviewCompletedHandler, DocumentTitleChangedEventHandler, HistoryChangedEventHandler,
    NavigationCompletedEventHandler, NavigationStartingEventHandler, SourceChangedEventHandler,
};
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

type Page = Arc<Mutex<WebPage>>;

pub struct TauriWebHost {
    app: AppHandle,
    attaching: Mutex<()>,
    pages: Mutex<HashMap<String, Page>>,
    controls: Mutex<HashMap<String, Arc<Mutex<crate::web_control::WindowControlState>>>>,
}

fn with_detail(detail: impl std::fmt::Display, error: CoreError) -> CoreError {
    error.and_details(vec![detail.to_string()])
}
fn allowed(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str() != Some("tauri.localhost")
        && !(url.host_str() == Some("localhost") && url.port_or_known_default() == Some(1420))
}
fn parse_url(url: &str, window: &str) -> Result<tauri::Url, CoreError> {
    let url: tauri::Url = url.parse().map_err(|error| {
        with_detail(
            error,
            errors::WEB_HOST_URL_PARSE_FAILED().and_details(vec![format!("창 ID: {window}")]),
        )
    })?;
    if !allowed(&url) {
        return Err(errors::WEB_HOST_URL_BLOCKED().and_details(vec![format!("창 ID: {window}")]));
    }
    Ok(url)
}
impl TauriWebHost {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            attaching: Mutex::new(()),
            pages: Mutex::new(HashMap::new()),
            controls: Mutex::new(HashMap::new()),
        }
    }
    fn view(&self, id: &str) -> Result<Webview, CoreError> {
        self.app.get_webview(&format!("web-{id}")).ok_or_else(|| {
            errors::WEB_HOST_VIEW_NOT_FOUND().and_details(vec![format!("창 ID: {id}")])
        })
    }

    fn on_main<T: Send + 'static>(
        &self,
        work: impl FnOnce(AppHandle) -> Result<T, CoreError> + Send + 'static,
        failed: impl Fn(&str) -> CoreError + Send + Sync + 'static,
    ) -> Result<T, CoreError> {
        let app = self.app.clone();
        let task_app = app.clone();
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(work(task_app));
        })
        .map_err(|error| {
            let detail = error.to_string();
            with_detail(&detail, failed(&detail))
        })?;
        rx.recv_timeout(Duration::from_secs(2)).map_err(|error| {
            let detail = error.to_string();
            with_detail(&detail, failed(&detail))
        })?
    }
}

// WebView2 이벤트는 UI 스레드에서 오며 코어의 상태와 이벤트에 반영한다.
fn update(app: &AppHandle, id: &str, state: &Page, view: &ICoreWebView2, loading: Option<bool>) {
    let mut page = state.lock().unwrap();
    let previous = page.clone();
    unsafe {
        let mut url = PWSTR::null();
        if view.Source(&mut url).is_ok() {
            let source = webview2_com::CoTaskMemPWSTR::from(url).to_string();
            if source
                .parse::<tauri::Url>()
                .ok()
                .is_some_and(|url| allowed(&url))
            {
                page.url = source;
            }
        }
        let mut title = PWSTR::null();
        if view.DocumentTitle(&mut title).is_ok() {
            page.title = webview2_com::CoTaskMemPWSTR::from(title).to_string();
        }
        let mut back = BOOL(0);
        let mut forward = BOOL(0);
        if view.CanGoBack(&mut back).is_ok() {
            page.can_go_back = back.as_bool();
        }
        if view.CanGoForward(&mut forward).is_ok() {
            page.can_go_forward = forward.as_bool();
        }
    }
    if let Some(loading) = loading {
        page.loading = loading;
    }
    let next = page.clone();
    drop(page);
    if next != previous {
        if let Some(core) = app.try_state::<Arc<Core>>() {
            core.web_update(id, next);
        }
    }
}

fn register(view: &Webview, app: AppHandle, id: String, page: Page) -> Result<(), CoreError> {
    let window = id.clone();
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |native| {
        let result = (|| unsafe {
            let controller = native.controller();
            let native = native.controller().CoreWebView2()?;
            let mut token = 0;
            crate::native_webview::register_child_menu(&native)?;
            crate::shell_shortcuts::register(app.clone(), format!("web-{id}"), &controller)?;
            macro_rules! event {
                ($method:ident, $handler:ident, $loading:expr) => {{
                    let app = app.clone();
                    let id = id.clone();
                    let page = page.clone();
                    let callback = $handler::create(Box::new(move |sender, _| {
                        if let Some(sender) = sender {
                            update(&app, &id, &page, &sender, $loading);
                        }
                        Ok(())
                    }));
                    native.$method(&callback, &mut token)?;
                }};
            }
            event!(add_SourceChanged, SourceChangedEventHandler, None);
            event!(add_HistoryChanged, HistoryChangedEventHandler, None);
            event!(
                add_DocumentTitleChanged,
                DocumentTitleChangedEventHandler,
                None
            );
            event!(
                add_NavigationStarting,
                NavigationStartingEventHandler,
                Some(true)
            );
            event!(
                add_NavigationCompleted,
                NavigationCompletedEventHandler,
                Some(false)
            );
            update(&app, &id, &page, &native, None);
            windows::core::Result::<()>::Ok(())
        })();
        let _ = tx.send(result.map_err(|e| e.to_string()));
    })
    .map_err(|error| {
        with_detail(
            error,
            errors::WEB_HOST_REGISTER_FAILED().and_details(vec![format!("창 ID: {window}")]),
        )
    })?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|error| {
            with_detail(
                error,
                errors::WEB_HOST_REGISTER_FAILED().and_details(vec![format!("창 ID: {window}")]),
            )
        })?
        .map_err(|detail| {
            with_detail(
                detail,
                errors::WEB_HOST_REGISTER_FAILED().and_details(vec![format!("창 ID: {window}")]),
            )
        })
}

impl WebHost for TauriWebHost {
    fn control(
        &self,
        id: &str,
        operation: &WindowControlOperation,
    ) -> Result<WindowControlResult, CoreError> {
        let view = self.view(id)?;
        let page = self
            .pages
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| errors::WEB_HOST_VIEW_NOT_FOUND())?;
        let state = self
            .controls
            .lock()
            .unwrap()
            .entry(id.to_string())
            .or_default()
            .clone();
        let mut state = state.lock().unwrap();
        Ok(crate::web_control::control(
            &view,
            id,
            &page,
            &mut state,
            operation,
            || self.capture_control(&view, id),
        ))
    }
    fn attach(&self, id: &str, url: &str) -> Result<WebPage, CoreError> {
        let url = parse_url(url, id)?;
        let _attaching = self.attaching.lock().unwrap();
        if let Some(page) = self.pages.lock().unwrap().get(id).cloned() {
            return Ok(page.lock().unwrap().clone());
        }
        let page = Arc::new(Mutex::new(WebPage {
            url: url.to_string(),
            title: String::new(),
            loading: true,
            can_go_back: false,
            can_go_forward: false,
        }));
        let label = format!("web-{id}");
        let new_app = self.app.clone();
        let new_label = label.clone();
        let load_app = self.app.clone();
        let load_id = id.to_string();
        let load_page = page.clone();
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
            .disable_drag_drop_handler()
            .on_navigation(allowed)
            .on_page_load(move |view, payload| {
                let loading = matches!(payload.event(), PageLoadEvent::Started);
                let app = load_app.clone();
                let id = load_id.clone();
                let page = load_page.clone();
                let _ = view.with_webview(move |native| {
                    if let Ok(native) = unsafe { native.controller().CoreWebView2() } {
                        update(&app, &id, &page, &native, Some(loading));
                    }
                });
            })
            .on_new_window(move |url, _| {
                if allowed(&url) {
                    if let Some(view) = new_app.get_webview(&new_label) {
                        let _ = view.navigate(url);
                    }
                }
                NewWindowResponse::Deny
            });
        let window = self
            .app
            .get_window("main")
            .ok_or_else(errors::WEB_HOST_ATTACH_MAIN_WINDOW_NOT_FOUND)?;
        let view = window
            .add_child(
                builder,
                LogicalPosition::new(0., 0.),
                LogicalSize::new(1., 1.),
            )
            .map_err(|error| {
                with_detail(
                    error,
                    errors::WEB_HOST_ATTACH_FAILED().and_details(vec![format!("창 ID: {id}")]),
                )
            })?;
        view.hide().map_err(|error| {
            with_detail(
                error,
                errors::WEB_HOST_ATTACH_FAILED().and_details(vec![format!("창 ID: {id}")]),
            )
        })?;
        self.pages.lock().unwrap().insert(id.into(), page.clone());
        if let Err(e) = register(&view, self.app.clone(), id.into(), page.clone()) {
            self.pages.lock().unwrap().remove(id);
            let label = label.clone();
            let _ = view.with_webview(move |_| crate::shell_shortcuts::unregister(&label));
            let _ = view.close();
            return Err(e);
        }
        let result = page.lock().unwrap().clone();
        Ok(result)
    }
    fn place(&self, id: &str, bounds: Option<Rect>) -> Result<(), CoreError> {
        let view = self.view(id)?;
        if let Some(b) = bounds {
            view.set_position(LogicalPosition::new(b.x as f64, b.y as f64))
                .map_err(|error| {
                    with_detail(
                        error,
                        errors::WEB_HOST_PLACE_FAILED().and_details(vec![format!("창 ID: {id}")]),
                    )
                })?;
            view.set_size(LogicalSize::new(b.width as f64, b.height as f64))
                .map_err(|error| {
                    with_detail(
                        error,
                        errors::WEB_HOST_PLACE_FAILED().and_details(vec![format!("창 ID: {id}")]),
                    )
                })?;
            view.show().map_err(|error| {
                with_detail(
                    error,
                    errors::WEB_HOST_PLACE_FAILED().and_details(vec![format!("창 ID: {id}")]),
                )
            })
        } else {
            view.hide().map_err(|error| {
                with_detail(
                    error,
                    errors::WEB_HOST_PLACE_FAILED().and_details(vec![format!("창 ID: {id}")]),
                )
            })
        }
    }
    fn navigate(&self, id: &str, url: &str) -> Result<(), CoreError> {
        self.view(id)?
            .navigate(parse_url(url, id)?)
            .map_err(|error| {
                with_detail(
                    error,
                    errors::WEB_HOST_NAVIGATE_FAILED().and_details(vec![format!("창 ID: {id}")]),
                )
            })
    }
    fn history(&self, id: &str, action: WebHistoryAction) -> Result<(), CoreError> {
        let view = self.view(id)?;
        if matches!(action, WebHistoryAction::Reload) {
            return view.reload().map_err(|error| {
                with_detail(
                    error,
                    errors::WEB_HOST_HISTORY_FAILED().and_details(vec![format!("창 ID: {id}")]),
                )
            });
        }
        let (tx, rx) = mpsc::channel();
        view.with_webview(move |native| {
            let result = unsafe {
                native
                    .controller()
                    .CoreWebView2()
                    .and_then(|w| match action {
                        WebHistoryAction::Back => {
                            let mut yes = BOOL(0);
                            w.CanGoBack(&mut yes)?;
                            if yes.as_bool() {
                                w.GoBack()?;
                            }
                            Ok(())
                        }
                        WebHistoryAction::Forward => {
                            let mut yes = BOOL(0);
                            w.CanGoForward(&mut yes)?;
                            if yes.as_bool() {
                                w.GoForward()?;
                            }
                            Ok(())
                        }
                        WebHistoryAction::Stop => w.Stop(),
                        WebHistoryAction::Reload => Ok(()),
                    })
            };
            let _ = tx.send(result.map_err(|e| e.to_string()));
        })
        .map_err(|error| {
            with_detail(
                error,
                errors::WEB_HOST_HISTORY_FAILED().and_details(vec![format!("창 ID: {id}")]),
            )
        })?;
        rx.recv_timeout(Duration::from_secs(2))
            .map_err(|error| {
                with_detail(
                    error,
                    errors::WEB_HOST_HISTORY_FAILED().and_details(vec![format!("창 ID: {id}")]),
                )
            })?
            .map_err(|detail| {
                with_detail(
                    detail,
                    errors::WEB_HOST_HISTORY_FAILED().and_details(vec![format!("창 ID: {id}")]),
                )
            })
    }
    fn capture(&self, id: &str) -> Result<Option<Vec<u8>>, CoreError> {
        capture_view(self.view(id)?, id)
    }

    fn capture_shell(&self) -> Result<Option<(Vec<u8>, f64)>, CoreError> {
        let view = self
            .app
            .get_webview("main")
            .ok_or_else(errors::WEB_HOST_CAPTURE_MAIN_VIEW_NOT_FOUND)?;
        let scale = self
            .app
            .get_window("main")
            .ok_or_else(errors::WEB_HOST_CAPTURE_MAIN_WINDOW_NOT_FOUND)?
            .scale_factor()
            .map_err(|error| with_detail(error, errors::WEB_HOST_CAPTURE_SCALE_FAILED()))?;
        let captured = capture_view(view, "쉘")?.map(|bytes| (bytes, scale));
        crate::freeze_cover::trace("capture.shell");
        Ok(captured)
    }
    fn freeze(&self) -> Result<bool, CoreError> {
        self.on_main(
            |app| {
                let window = app
                    .get_window("main")
                    .ok_or_else(errors::WEB_HOST_FREEZE_MAIN_WINDOW_NOT_FOUND)?;
                let hwnd = window
                    .hwnd()
                    .map_err(|error| with_detail(error, errors::WEB_HOST_FREEZE_FAILED()))?;
                crate::freeze_cover::freeze(hwnd)
                    .map_err(|error| with_detail(error, errors::WEB_HOST_FREEZE_FAILED()))
            },
            |_| errors::WEB_HOST_FREEZE_FAILED(),
        )?;
        if let Err(error) = crate::freeze_cover::flush() {
            let _ = self.on_main(
                |_| {
                    crate::freeze_cover::unfreeze();
                    Ok(())
                },
                |_| errors::WEB_HOST_UNFREEZE_FAILED(),
            );
            return Err(with_detail(error, errors::WEB_HOST_FREEZE_FAILED()));
        }
        crate::freeze_cover::trace("freeze.flushed");
        Ok(true)
    }
    fn unfreeze(&self) -> Result<(), CoreError> {
        crate::freeze_cover::trace("unfreeze.called");
        let before = crate::freeze_cover::flush();
        let destroy = self.on_main(
            |_| {
                crate::freeze_cover::unfreeze();
                Ok(())
            },
            |_| errors::WEB_HOST_UNFREEZE_FAILED(),
        );
        let after = crate::freeze_cover::flush();
        crate::freeze_cover::trace("unfreeze.flushed");
        before
            .and(destroy.map_err(|error| format!("{error:?}")))
            .and(after)
            .map_err(|error| with_detail(error, errors::WEB_HOST_UNFREEZE_FAILED()))
    }
    fn detach(&self, id: &str) -> Result<(), CoreError> {
        self.pages.lock().unwrap().remove(id);
        self.controls.lock().unwrap().remove(id);
        if let Some(view) = self.app.get_webview(&format!("web-{id}")) {
            let label = format!("web-{id}");
            self.on_main(move |_| { crate::shell_shortcuts::unregister(&label); Ok(()) }, |_| errors::WEB_HOST_DETACH_FAILED())?;
            view.close().map_err(|error| {
                with_detail(
                    error,
                    errors::WEB_HOST_DETACH_FAILED().and_details(vec![format!("창 ID: {id}")]),
                )
            })?;
        }
        Ok(())
    }
}

impl TauriWebHost {
    fn capture_control(&self, view: &Webview, id: &str) -> Result<Vec<u8>, CoreError> {
        let unavailable = || errors::SHARE_CONTROL_IMAGE_UNAVAILABLE(id);
        if let Some(bytes) = capture_view(view.clone(), id)
            .map_err(|_| unavailable())?
            .filter(|bytes| !bytes.is_empty())
        {
            return Ok(bytes);
        }
        let (tx, rx) = mpsc::channel();
        view.with_webview(move |native| {
            let mut visible = BOOL(0);
            let result = unsafe { native.controller().IsVisible(&mut visible) }
                .map(|_| visible.as_bool())
                .map_err(|_| ());
            let _ = tx.send(result);
        })
        .map_err(|_| unavailable())?;
        if rx
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| unavailable())?
            .map_err(|_| unavailable())?
        {
            return Err(unavailable());
        }
        self.freeze().map_err(|_| unavailable())?;
        let shown = view.show().map_err(|_| unavailable());
        let captured = if shown.is_ok() {
            capture_view(view.clone(), id)
                .map_err(|_| unavailable())
                .and_then(|v| v.filter(|b| !b.is_empty()).ok_or_else(unavailable))
        } else {
            Err(unavailable())
        };
        let hidden = view.hide().map_err(|_| unavailable());
        let unfrozen = self.unfreeze().map_err(|_| unavailable());
        shown?;
        hidden?;
        unfrozen?;
        captured
    }
}

fn capture_view(view: Webview, window: &str) -> Result<Option<Vec<u8>>, CoreError> {
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |native| {
        let started = (|| unsafe {
            let view = native.controller().CoreWebView2()?;
            let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
            let captured = stream.clone();
            let callback = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                let bytes = (|| {
                    result?;
                    let mut stat = STATSTG::default();
                    captured.Stat(&mut stat, STATFLAG_NONAME)?;
                    captured.Seek(0, STREAM_SEEK_SET, None)?;
                    let mut bytes = vec![0; stat.cbSize as usize];
                    let mut read = 0;
                    captured
                        .Read(
                            bytes.as_mut_ptr().cast(),
                            bytes.len() as u32,
                            Some(&mut read),
                        )
                        .ok()?;
                    bytes.truncate(read as usize);
                    windows::core::Result::Ok(bytes)
                })()
                .ok();
                let _ = tx.send(bytes);
                Ok(())
            }));
            view.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &callback,
            )
        })();
        if let Err(error) = started {
            eprintln!("웹뷰 캡처 실패: {error}");
        }
    })
    .map_err(|error| {
        with_detail(
            error,
            errors::WEB_HOST_CAPTURE_FAILED().and_details(vec![format!("창 ID: {window}")]),
        )
    })?;
    Ok(rx.recv_timeout(Duration::from_secs(2)).ok().flatten())
}
