//! Global quick-add shortcut (D-02).
//!
//! One app-wide shortcut (⌘⇧Space on macOS, Ctrl+Shift+Space elsewhere)
//! surfaces the main window and asks the frontend to open its 快速添加任务
//! dialog. Registering it in Rust rather than from the webview is what makes
//! it work no matter what the window is doing — parked in the tray,
//! minimized, or never focused — and it needs no capability entry, because no
//! IPC is involved: the window is shown here and the frontend only listens
//! for an event.

use std::sync::OnceLock;

use tauri::{plugin::TauriPlugin, AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::tray;

/// Event the frontend listens for to open the quick-add dialog.
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

/// The plugin holding the shortcut handler: on press, bring the window
/// forward and let the frontend open the dialog.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if *shortcut == quick_add_shortcut() && event.state == ShortcutState::Pressed {
                open_quick_add(app);
            }
        })
        .build()
}

/// Registers the shortcut. A refusal (another app already owns the
/// combination) is logged rather than fatal: the rest of the app is fine.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    let shortcut = quick_add_shortcut();
    if let Err(error) = app.global_shortcut().register(shortcut) {
        eprintln!("global shortcut {shortcut:?} registration failed: {error}");
    }
}

/// Brings the window to the front and asks the frontend for the dialog.
fn open_quick_add<R: Runtime>(app: &AppHandle<R>) {
    tray::show_main(app);
    if let Err(error) = app.emit(QUICK_ADD_EVENT, ()) {
        eprintln!("emit {QUICK_ADD_EVENT} failed: {error}");
    }
}
