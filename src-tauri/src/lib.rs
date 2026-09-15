mod commands;
mod db;
mod error;
pub mod models;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Autostart (D-04) is driven from the settings page, so the webview
        // calls it and `autostart:default` is what lets it.
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(shortcut::plugin())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::task_list,
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
            commands::namespace_list,
            commands::namespace_create,
            commands::namespace_update,
            commands::namespace_archive,
            commands::namespace_restore,
            commands::board_list_columns,
            commands::board_add_column,
            commands::board_update_column,
            commands::board_delete_column,
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
        ])
        .setup(|app| {
            let db = db::init(&db_path(app)?)?;
            app.manage(db.clone());
            scheduler::spawn(app.handle().clone(), db);
            tray::init(app.handle())?;
            shortcut::init(app.handle())?;
            shortcut::register(app.handle());
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
fn db_path(app: &tauri::App) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Db(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Db(e.to_string()))?;
    Ok(dir.join("ordo.db"))
}
