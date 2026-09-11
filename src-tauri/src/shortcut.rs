//! Global quick-add shortcut (D-02).
//!
//! One app-wide shortcut (⌘⇧Space on macOS, Ctrl+Shift+Space elsewhere)
//! surfaces `quick-add` — a small, frameless, always-on-top window holding
//! nothing but the title field. The main window is deliberately left alone:
//! capturing a thought must not drag the whole app in front of whatever the
//! user was doing.
//!
//! Registering it in Rust rather than from the webview is what makes it work
//! no matter what the window is doing — parked in the tray, minimized, or
//! never focused — and it needs no capability entry, because no IPC is
//! involved: the window is shown here and the frontend only listens for an
//! event.

use std::sync::OnceLock;

use tauri::{
    plugin::TauriPlugin, AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Label of the standalone quick-add window. `capabilities/default.json`
/// authorizes the same name, so a mismatch silently disables its IPC.
pub const QUICK_ADD_WINDOW: &str = "quick-add";

/// Event the quick-add window listens for: clear the field and take focus.
pub const QUICK_ADD_EVENT: &str = "quick-add:open";

/// The quick-add shortcut. Both combinations are unclaimed by the OS and
/// reachable one-handed.
///
/// Memoized on purpose: a `Shortcut`'s identity includes a counter, so the
/// handler can only match the registered instance against the *same* value.
pub fn quick_add_shortcut() -> Shortcut {
    static SHORTCUT: OnceLock<Shortcut> = OnceLock::new();
    *SHORTCUT.get_or_init(|| {
        let modifiers = if cfg!(target_os = "macos") {
            Modifiers::SUPER | Modifiers::SHIFT
        } else {
            Modifiers::CONTROL | Modifiers::SHIFT
        };
        Shortcut::new(Some(modifiers), Code::Space)
    })
}

/// The plugin holding the shortcut handler: on press, surface the input.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if *shortcut == quick_add_shortcut() && event.state == ShortcutState::Pressed {
                open_quick_add(app);
            }
        })
        .build()
}

/// Builds the hidden quick-add window. It lives for the whole session, so the
/// shortcut only has to show an already-loaded webview — rebuilding it per
/// press would make the caret wait on a page load. It loads the app's own
/// `index.html` (dev and production alike) and the frontend routes on the
/// window label, so no second entry point or build config is involved.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, QUICK_ADD_WINDOW, WebviewUrl::App("index.html".into()))
        .title("快速添加任务")
        .inner_size(560.0, 150.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .center()
        .build()?;
    Ok(())
}

/// Registers the shortcut. A refusal (another app already owns the
/// combination) is logged rather than fatal: the rest of the app is fine.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    let shortcut = quick_add_shortcut();
    if let Err(error) = app.global_shortcut().register(shortcut) {
        eprintln!("global shortcut {shortcut:?} registration failed: {error}");
    }
}

/// Surfaces the quick-add window and asks it to reset and take focus.
///
/// The event is load-bearing: `autofocus` only fires on page load, and this
/// page was loaded once at startup while the window was still hidden.
fn open_quick_add<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(QUICK_ADD_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit_to(QUICK_ADD_WINDOW, QUICK_ADD_EVENT, ()) {
        eprintln!("emit {QUICK_ADD_EVENT} failed: {error}");
    }
}
