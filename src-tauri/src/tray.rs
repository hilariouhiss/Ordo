//! System tray (D-01).
//!
//! Ordo lives in the tray: closing the main window hides it instead of
//! quitting, the tray icon's left click toggles the window, and the menu
//! offers an explicit 显示 / 隐藏 / 退出. Quitting is therefore always a
//! deliberate action, and the reminder scheduler keeps running while the
//! window is parked — it is a plain thread on the shared connection and does
//! not depend on a visible webview.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// Label of the app's only window (`tauri.conf.json` declares no label, so
/// Tauri names it `main`; the capability file relies on the same name).
pub const MAIN_WINDOW: &str = "main";

/// The tray's id. `icons` looks the tray up by this to repaint it per theme.
pub const TRAY_ID: &str = "ordo-tray";
const MENU_SHOW: &str = "tray:show";
const MENU_HIDE: &str = "tray:hide";
const MENU_QUIT: &str = "tray:quit";

/// Builds the tray icon and menu and wires their actions.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, MENU_SHOW, "显示主窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, MENU_HIDE, "隐藏主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出 Ordo", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &hide, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Ordo")
        .menu(&menu)
        // Left click toggles the window; the menu stays on right click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW => show_main(app),
            MENU_HIDE => hide_main(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        });

    // The bundled app icon doubles as the tray icon; without one the tray
    // would be invisible on Windows, so it is only set when present.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// Shows, restores and focuses the main window (tray click / 显示).
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Parks the app in the tray (tray 隐藏 / window close).
pub fn hide_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
}

fn toggle_main<R: Runtime>(app: &AppHandle<R>) {
    match app.get_webview_window(MAIN_WINDOW) {
        Some(window) if window.is_visible().unwrap_or(false) => {
            let _ = window.hide();
        }
        Some(_) => show_main(app),
        None => {}
    }
}
