mod commands;
mod db;
mod error;
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

    tauri::Builder::default()
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
            commands::project_unfinished_counts,
            commands::namespace_list,
            commands::namespace_create,
            commands::namespace_update,
            commands::namespace_archive,
            commands::namespace_restore,
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
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
