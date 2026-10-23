use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::i18n::Lang;

pub const LABEL: &str = "desk";

pub fn enabled(conn: &Connection) -> bool {
    crate::repo::settings::get(conn, "desk.enabled")
        .ok()
        .flatten()
        .as_deref()
        == Some("true")
}

/// The saved pin, normalized so a bad row can never create a window that is neither.
fn saved_pin(conn: &Connection) -> String {
    crate::repo::settings::get(conn, "desk.pin")
        .ok()
        .flatten()
        .filter(|value| crate::repo::settings::valid_desk_pin(value))
        .unwrap_or_else(|| "top".into())
}

/// Builds the widget hidden; the front end positions it and shows it once its
/// first frame is ready, so it never flashes at the default window position.
pub fn ensure(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Some(window);
    }
    let pin = app
        .state::<crate::state::AppState>()
        .db
        .lock()
        .map(|conn| saved_pin(&conn))
        .unwrap_or_else(|_| "top".into());
    // The page draws the card, its rounded corners and its shadow. The system shadow
    // adds a 1px white border and an outer frame the front end cannot see.
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("ordo")
        .inner_size(320.0, 460.0)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .always_on_top(pin != "bottom")
        .always_on_bottom(pin == "bottom");
    match builder.build() {
        Ok(window) => Some(window),
        Err(e) => {
            eprintln!("小窗创建失败：{e}");
            None
        }
    }
}

/// Window creation must not run on a command thread, so the first show pays one
/// event-loop hop. The hidden page shows itself once it has its layout.
fn create_soon(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let _ = ensure(&inner);
        });
    });
}

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = app.emit_to(LABEL, "desk:reveal", ());
    } else {
        create_soon(app);
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

/// Called from the delayed startup thread on the main thread.
pub fn startup(app: &AppHandle) {
    let wanted = app
        .state::<crate::state::AppState>()
        .db
        .lock()
        .map(|conn| enabled(&conn))
        .unwrap_or(false);
    if wanted {
        let _ = ensure(app);
    }
}

/// Applies a state that is already written to settings.
pub fn apply_enabled(app: &AppHandle, enabled: bool) {
    if enabled {
        show(app);
    } else {
        hide(app);
    }
    let lang = app
        .state::<crate::state::AppState>()
        .db
        .lock()
        .map(|conn| crate::i18n::from_conn(&conn))
        .unwrap_or(Lang::Zh);
    crate::refresh_tray(app, lang, enabled);
    let _ = app.emit("desk:changed", enabled);
}

pub fn set_enabled(app: &AppHandle, enabled: bool) {
    if let Ok(conn) = app.state::<crate::state::AppState>().db.lock() {
        let _ = crate::repo::settings::set(
            &conn,
            "desk.enabled",
            if enabled { "true" } else { "false" },
        );
    }
    apply_enabled(app, enabled);
}

pub fn toggle(app: &AppHandle) {
    let current = app
        .state::<crate::state::AppState>()
        .db
        .lock()
        .map(|conn| enabled(&conn))
        .unwrap_or(false);
    set_enabled(app, !current);
}
