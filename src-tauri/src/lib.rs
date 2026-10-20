use tauri::Manager;

pub mod commands;
pub mod db;
pub mod dto;
pub mod repo;
pub mod services;
pub mod state;

#[tauri::command]
fn greet(name: &str) -> String {
  format!("Hello, {name}! From Rust.")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      greet,
      commands::meta::bootstrap,
      commands::tasks::capture,
      commands::tasks::list_week,
      commands::tasks::get_task,
      commands::tasks::update_task,
      commands::tasks::add_step,
      commands::tasks::toggle_step,
      commands::tasks::delete_step,
      commands::tasks::pass_queue,
      commands::tasks::pass_resolve,
      commands::tasks::mark_pass_done,
      commands::tasks::week_stats,
      commands::tasks::list_suspended,
      commands::tasks::resume_task,
      commands::tasks::set_due,
      commands::tasks::add_delay_note,
      commands::projects::list_projects,
      commands::projects::get_project,
      commands::projects::create_project,
      commands::projects::update_project,
      commands::projects::archive_project,
      commands::projects::restore_project,
      commands::projects::delete_project,
      commands::projects::add_member,
      commands::projects::remove_member,
      commands::projects::owner_candidates,
      commands::projects::list_people
    ])
    .setup(|app| {
      let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
      std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
      let conn = crate::db::open(&data_dir.join("ordo.db")).map_err(|e| e.to_string())?;
      app.manage(crate::state::AppState::new(conn));

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
  use super::greet;

  #[test]
  fn greet_formats_name() {
    assert_eq!(greet("Ordo"), "Hello, Ordo! From Rust.");
  }
}