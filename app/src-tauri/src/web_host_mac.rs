// macOS 웹뷰(WKWebView) 수명과 페이지 상태 관찰, 캡처 연결을 한 호스트에 모은다.
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use kaleidoscope_core::kaleidoscope_contract::{
    errors, CoreError, Rect, WebHistoryAction, WebPage,
};
use kaleidoscope_core::{Core, WebHost};
use objc2::rc::{Retained, Weak};
use objc2::runtime::{AnyObject, NSObject};
use objc2::{define_class, msg_send, sel, AllocAnyThread, DefinedClass};
use objc2_foundation::{
    NSDictionary, NSKeyValueChangeKey, NSKeyValueObservingOptions,
    NSObjectNSKeyValueObserverRegistration, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
};
use objc2_web_kit::WKWebView;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl,
};

type Page = Arc<Mutex<WebPage>>;

pub struct TauriWebHost {
    app: AppHandle,
    attaching: Mutex<()>,
    pages: Mutex<HashMap<String, Page>>,
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

// WKWebView 속성은 메인 스레드에서 읽으며 코어의 상태와 이벤트에 반영한다.
fn update(app: &AppHandle, id: &str, state: &Page, view: &WKWebView, loading: Option<bool>) {
    let mut page = state.lock().unwrap();
    let previous = page.clone();
    unsafe {
        if let Some(source) = view.URL().and_then(|url| url.absoluteString()) {
            let source = source.to_string();
            if source
                .parse::<tauri::Url>()
                .ok()
                .is_some_and(|url| allowed(&url))
            {
                page.url = source;
            }
        }
        page.title = view
            .title()
            .map(|title| title.to_string())
            .unwrap_or_default();
        page.can_go_back = view.canGoBack();
        page.can_go_forward = view.canGoForward();
        page.loading = loading.unwrap_or_else(|| view.isLoading());
    }
    let next = page.clone();
    drop(page);
    if next != previous {
        if let Some(core) = app.try_state::<Arc<Core>>() {
            core.web_update(id, next);
        }
    }
}

// pushState나 document.title 변경은 페이지 로드 이벤트가 없어 KVO로 받는다.
const KEYS: [&str; 5] = ["URL", "title", "canGoBack", "canGoForward", "loading"];

struct ObserverIvars {
    web: Retained<WKWebView>,
    app: AppHandle,
    id: String,
    page: Page,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[ivars = ObserverIvars]
    struct PageObserver;

    impl PageObserver {
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn observe(
            &self,
            _key_path: Option<&NSString>,
            _object: Option<&AnyObject>,
            _change: Option<&NSDictionary<NSKeyValueChangeKey, AnyObject>>,
            _context: *mut c_void,
        ) {
            let ivars = self.ivars();
            update(&ivars.app, &ivars.id, &ivars.page, &ivars.web, None);
        }
    }

    unsafe impl NSObjectProtocol for PageObserver {}
);

impl PageObserver {
    fn new(web: Retained<WKWebView>, app: AppHandle, id: String, page: Page) -> Retained<Self> {
        let this = Self::alloc().set_ivars(ObserverIvars { web, app, id, page });
        let this: Retained<Self> = unsafe { msg_send![super(this), init] };
        for key in KEYS {
            unsafe {
                this.ivars().web.addObserver_forKeyPath_options_context(
                    &this,
                    &NSString::from_str(key),
                    NSKeyValueObservingOptions::New,
                    std::ptr::null_mut(),
                );
            }
        }
        this
    }
}

// 관찰자는 웹뷰를 강하게 잡고 있어 관찰 해제 전에 웹뷰가 먼저 사라지지 않는다.
impl Drop for PageObserver {
    fn drop(&mut self) {
        for key in KEYS {
            unsafe {
                self.ivars()
                    .web
                    .removeObserver_forKeyPath(self, &NSString::from_str(key));
            }
        }
    }
}

thread_local! {
    // 메인 스레드에서만 만들고 지운다.
    static OBSERVERS: RefCell<HashMap<String, Retained<PageObserver>>> = RefCell::new(HashMap::new());
}

fn forget(id: &str) {
    let observer = OBSERVERS.with(|observers| observers.borrow_mut().remove(id));
    drop(observer);
}

fn native(view: &tauri::webview::PlatformWebview) -> Option<Retained<WKWebView>> {
    unsafe { Retained::retain(view.inner().cast::<WKWebView>()) }
}

thread_local! {
    static MAIN: RefCell<Option<Weak<WKWebView>>> = const { RefCell::new(None) };
}

// 메인 웹뷰는 제목 막대 아래부터 그리도록 위쪽을 비워 두는데(obscuredContentInsets), wry는 이 여백 없이 상위 뷰 기준으로 놓아 자식 웹뷰가 제목 막대 높이만큼 위로 밀린다.
// UI가 넘기는 좌표는 메인 웹뷰 뷰포트의 CSS px라 메인 웹뷰 좌표계에서 상위 뷰 좌표계로 바꿔 직접 놓는다.
fn align(child: &WKWebView, bounds: NSRect) {
    let Some(main) = MAIN.with(|slot| slot.borrow().as_ref().and_then(Weak::load)) else {
        return;
    };
    let (Some(parent), Some(window), Some(main_window)) =
        (unsafe { child.superview() }, child.window(), main.window())
    else {
        return;
    };
    if Retained::as_ptr(&window) != Retained::as_ptr(&main_window) {
        return;
    }
    let area = main.bounds();
    let (left, top) = if main.respondsToSelector(sel!(obscuredContentInsets)) {
        let insets = unsafe { main.obscuredContentInsets() };
        (insets.left, insets.top)
    } else {
        (0., 0.)
    };
    let x = area.origin.x + left + bounds.origin.x;
    let y = if main.isFlipped() {
        area.origin.y + top + bounds.origin.y
    } else {
        area.origin.y + area.size.height - top - bounds.origin.y - bounds.size.height
    };
    let frame =
        main.convertRect_toView(NSRect::new(NSPoint::new(x, y), bounds.size), Some(&parent));
    child.setFrame(frame);
}

fn register(view: &Webview, app: AppHandle, id: String, page: Page) -> Result<(), CoreError> {
    let window = id.clone();
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |platform| {
        let result = match native(&platform) {
            Some(web) => {
                update(&app, &id, &page, &web, None);
                let observer = PageObserver::new(web, app, id.clone(), page);
                OBSERVERS.with(|observers| observers.borrow_mut().insert(id, observer));
                Ok(())
            }
            None => Err("WKWebView를 찾지 못했습니다".to_string()),
        };
        let _ = tx.send(result);
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
                let _ = view.with_webview(move |platform| {
                    if let Some(web) = native(&platform) {
                        update(&app, &id, &page, &web, Some(loading));
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
            let id = id.to_string();
            let _ = view.with_webview(move |_| forget(&id));
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
            if let Some(main) = self.app.get_webview("main") {
                let _ = main.with_webview(|platform| {
                    let main = native(&platform).map(|web| Weak::from_retained(&web));
                    MAIN.with(|slot| *slot.borrow_mut() = main);
                });
            }
            let frame = NSRect::new(
                NSPoint::new(b.x as f64, b.y as f64),
                NSSize::new(b.width as f64, b.height as f64),
            );
            view.with_webview(move |platform| {
                if let Some(web) = native(&platform) {
                    align(&web, frame);
                }
            })
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
        view.with_webview(move |platform| {
            let result = native(&platform)
                .ok_or("WKWebView를 찾지 못했습니다")
                .map(|web| unsafe {
                    match action {
                        WebHistoryAction::Back => {
                            if web.canGoBack() {
                                web.goBack();
                            }
                        }
                        WebHistoryAction::Forward => {
                            if web.canGoForward() {
                                web.goForward();
                            }
                        }
                        WebHistoryAction::Stop => web.stopLoading(),
                        WebHistoryAction::Reload => {}
                    }
                });
            let _ = tx.send(result);
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
        crate::mac_capture::capture_view(self.view(id)?, id)
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
        Ok(crate::mac_capture::capture_view(view, "쉘")?.map(|bytes| (bytes, scale)))
    }
    fn freeze(&self) -> Result<bool, CoreError> {
        crate::mac_capture::freeze(&self.app)
    }
    fn unfreeze(&self) -> Result<(), CoreError> {
        crate::mac_capture::unfreeze(&self.app)
    }
    fn detach(&self, id: &str) -> Result<(), CoreError> {
        self.pages.lock().unwrap().remove(id);
        if let Some(view) = self.app.get_webview(&format!("web-{id}")) {
            let key = id.to_string();
            self.on_main(
                move |_| {
                    forget(&key);
                    Ok(())
                },
                |_| errors::WEB_HOST_DETACH_FAILED(),
            )?;
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
