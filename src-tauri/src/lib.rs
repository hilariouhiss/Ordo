mod commands;
mod db;
mod error;
mod icons;
pub mod models;
mod perf;
pub mod repositories;
pub(crate) mod scheduler;
pub mod services;
mod shortcut;
pub mod sort;
mod tray;

use std::path::PathBuf;

use tauri::Manager;

pub use error::AppError;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Q-01 的地基：进程起点。之后再没有哪个时刻比这里更早。
    perf::mark_start();

    let app = tauri::Builder::default()
        // First plugin registered, as the plugin asks: the second process has to
        // be turned away before anything else opens the database. Ordo lives in
        // the tray, so launching it again is how a user reopens it — the second
        // launch surfaces the running window instead of starting a second
        // writer on the same SQLite file (no `busy_timeout`, see QA-11).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Autostart (D-04) is driven from the settings page, so the webview
        // calls it and `autostart:default` is what lets it.
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(shortcut::plugin())
        .invoke_handler(tauri::generate_handler![
            commands::task_list,
            commands::task_list_by_project,
            commands::task_create,
            commands::task_update,
            commands::task_complete,
            commands::task_soft_delete,
            commands::task_restore,
            commands::task_reorder,
            commands::tag_list,
            commands::tag_create,
            commands::tag_update,
            commands::tag_delete,
            commands::dependency_list_all,
            commands::dependency_add,
            commands::dependency_remove,
            commands::project_list,
            commands::project_create,
            commands::project_update,
            commands::project_archive,
            commands::project_restore,
            commands::project_delete,
            commands::project_unfinished_counts,
            commands::namespace_list,
            commands::namespace_create,
            commands::namespace_update,
            commands::namespace_archive,
            commands::namespace_restore,
            commands::namespace_delete,
            commands::board_list_columns,
            commands::board_move_task,
            commands::search_query,
            commands::comment_list,
            commands::comment_create,
            commands::comment_update,
            commands::comment_delete,
            commands::time_list,
            commands::time_create,
            commands::time_update,
            commands::time_delete,
            commands::time_start,
            commands::time_stop,
            commands::stats_trend,
            commands::stats_project_progress,
            commands::stats_time_distribution,
            commands::backup_export,
            commands::backup_import,
            commands::perf_ready,
            // Not in `commands.rs`: they mirror the two themes onto the frame,
            // the title bar, the tray and the taskbar, which is icon state
            // rather than domain state.
            icons::set_theme,
            icons::system_theme,
        ])
        .setup(|app| {
            // Q-01 的启动分界点：Tauri 在调用本闭包**之前**已经建好了主窗口与
            // 它的 WebView，所以这一行的读数 = 事件循环 + 主 WebView 创建。
            perf::note_now("webview-main");
            let db = db::init(&db_path(app)?)?;
            perf::note_now("db");
            app.manage(db.clone());
            scheduler::spawn(app.handle().clone(), db);
            tray::init(app.handle())?;
            perf::note_now("tray");
            // 这一步会建 quick-add 小窗（第二个 WebView），是启动路径上最后一块。
            shortcut::init(app.handle())?;
            shortcut::register(app.handle());
            perf::note_now("backend-ready");
            // Both windows and the tray now exist, so the icon can be chosen for
            // the theme the frame will actually be drawn in.
            icons::apply_current(app.handle());
            Ok(())
        })
        // Closing the window parks the app in the tray (D-01); 退出 in the tray
        // menu is the deliberate way out. Reminders keep firing meanwhile.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            // The quick-add window has no title bar to close it with, so
            // losing focus is how clicking away dismisses it (D-02).
            if window.label() == shortcut::QUICK_ADD_WINDOW {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
            // Raised both when the OS theme changes and when `icons::set_theme`
            // pins one, and the payload cannot tell the two apart — so the tray
            // and the taskbar re-read the OS theme rather than trust it.
            if let tauri::WindowEvent::ThemeChanged(_) = event {
                icons::refresh_system(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Reopen is macOS-only (the variant does not exist elsewhere): the app is
    // re-activated — dock icon, `open -a` — while its window is parked in the
    // tray, and without this nothing happens at all. On Windows and Linux that
    // way back is a second launch, which `tauri-plugin-single-instance` handles
    // above by surfacing the running window.
    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            tray::show_main(_app);
        }
    });
}

/// Resolves the on-disk location of the SQLite database.
///
/// `ORDO_DB` overrides it: the Q-01 acceptance run measures startup against a
/// seeded database and must not touch the user's own.
fn db_path(app: &tauri::App) -> Result<PathBuf, AppError> {
    let path = match std::env::var_os("ORDO_DB") {
        Some(custom) => PathBuf::from(custom),
        None => app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Db(e.to_string()))?
            .join("ordo.db"),
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Db(e.to_string()))?;
    }
    Ok(path)
}
