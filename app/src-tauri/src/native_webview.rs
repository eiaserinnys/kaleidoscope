use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2_11, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND,
    COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR, COREWEBVIEW2_PERMISSION_KIND,
    COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    COREWEBVIEW2_PERMISSION_STATE_DENY,
};
use webview2_com::{ContextMenuRequestedEventHandler, PermissionRequestedEventHandler};
use windows::core::{Interface, PWSTR};

use crate::context_menu::{kept_menu_indices, MenuItem};

pub(crate) fn configure_main(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let main = app.get_webview("main").ok_or("main webview missing")?;
    let config = app.config();
    let window = config
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("main window config missing")?;
    let scheme = if window.use_https_scheme {
        "https"
    } else {
        "http"
    };
    let app_url: tauri::Url = if tauri::is_dev() {
        config.build.dev_url.clone().ok_or("devUrl missing")?
    } else {
        format!("{scheme}://tauri.localhost/").parse()?
    };
    let origin = app_url.origin();
    let shortcuts_app = app.clone();
    main.with_webview(move |native| {
        let result = (|| unsafe {
            crate::shell_shortcuts::register(shortcuts_app, "main".into(), &native.controller())?;
            let webview = native.controller().CoreWebView2()?;
            webview
                .Settings()?
                .SetAreDefaultContextMenusEnabled(false)?;
            let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ {
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    let uri = webview2_com::CoTaskMemPWSTR::from(uri).to_string();
                    let allowed = uri
                        .parse::<tauri::Url>()
                        .ok()
                        .is_some_and(|url| url.origin() == origin);
                    args.SetState(if allowed {
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW
                    } else {
                        COREWEBVIEW2_PERMISSION_STATE_DENY
                    })?;
                }
                Ok(())
            }));
            let mut token = 0;
            webview.add_PermissionRequested(&handler, &mut token)?;
            windows::core::Result::<()>::Ok(())
        })();
        if let Err(error) = result {
            eprintln!("메인 웹뷰 메뉴와 클립보드 설정 실패: {error}");
        }
    })?;
    Ok(())
}

pub(crate) unsafe fn register_child_menu(webview: &ICoreWebView2) -> windows::core::Result<()> {
    let webview: ICoreWebView2_11 = webview.cast()?;
    let handler = ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
        let Some(args) = args else { return Ok(()) };
        let items = args.MenuItems()?;
        let mut count = 0;
        items.Count(&mut count)?;
        let mut names = Vec::with_capacity(count as usize);
        for index in 0..count {
            let item = items.GetValueAtIndex(index)?;
            let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
            item.Kind(&mut kind)?;
            if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                names.push(None);
            } else {
                let mut name = PWSTR::null();
                item.Name(&mut name)?;
                names.push(Some(webview2_com::CoTaskMemPWSTR::from(name).to_string()));
            }
        }
        let menu: Vec<_> = names
            .iter()
            .map(|name| match name {
                Some(name) => MenuItem::Command(name),
                None => MenuItem::Separator,
            })
            .collect();
        let kept = kept_menu_indices(&menu);
        for index in (0..count).rev() {
            if kept.binary_search(&(index as usize)).is_err() {
                items.RemoveValueAtIndex(index)?;
            }
        }
        if kept.is_empty() {
            args.SetHandled(true)?;
        }
        Ok(())
    }));
    let mut token = 0;
    webview.add_ContextMenuRequested(&handler, &mut token)
}
