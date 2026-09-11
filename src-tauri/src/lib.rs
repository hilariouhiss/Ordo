mod commands;
mod db;
mod error;
pub mod models;
pub mod repositories;
pub(crate) mod scheduler;
pub mod services;
pub mod sort;

use std::path::PathBuf;

use tauri::Manager;

pub use error::AppError;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::task_list,
            commands::task_create,
            commands::task_update,
            commands::task_complete,
            commands::task_soft_delete,
            commands::task_restore,
            commands::tag_list,
            commands::tag_create,
            commands::tag_update,
            commands::tag_delete,
            commands::subtask_list,
            commands::subtask_create,
            commands::subtask_update,
            commands::subtask_complete,
            commands::subtask_delete,
            commands::subtask_reorder,
            commands::project_list,
            commands::project_create,
            commands::project_update,
            commands::project_archive,
            commands::project_restore,
            commands::board_list_columns,
            commands::board_add_column,
            commands::board_update_column,
            commands::board_delete_column,
            commands::board_move_task,
            commands::search_query,
        ])
        .setup(|app| {
            let db = db::init(&db_path(app)?)?;
            app.manage(db.clone());
            scheduler::spawn(app.handle().clone(), db);
            Ok(())
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
