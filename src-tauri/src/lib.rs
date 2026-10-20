use tauri::Emitter;
use tauri::Manager;

pub mod ai;
pub mod commands;
pub mod db;
pub mod dto;
pub mod repo;
pub mod reminders;
pub mod services;
pub mod state;

#[tauri::command]
fn greet(name: &str) -> String {
  format!("Hello, {name}! From Rust.")
}


pub fn toggle_capture(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("capture") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit_to("capture", "capture:focus", ());
        }
    }
}

pub fn register_shortcut(
    app: &tauri::AppHandle,
    shortcut: tauri_plugin_global_shortcut::Shortcut,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_capture(app);
            }
        })
        .map_err(|e| e.to_string())
}

fn show_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open = MenuItem::with_id(app, "open", "打开 ordo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      show_main(app);
    }))
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
          api.prevent_close();
          let _ = window.hide();
        }
      }
    })
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
      commands::tasks::list_project_tasks,
      commands::projects::list_projects,
      commands::projects::get_project_summary,
      commands::projects::get_project,
      commands::projects::create_project,
      commands::projects::update_project,
      commands::projects::archive_project,
      commands::projects::restore_project,
      commands::projects::delete_project,
      commands::projects::add_member,
      commands::projects::remove_member,
      commands::projects::owner_candidates,
      commands::projects::list_people,
      commands::archive::list_archive,
      commands::archive::archive_task,
      commands::archive::restore_task,
      commands::archive::delete_task,
      commands::meta::get_settings,
      commands::meta::set_settings,
      commands::meta::export_json,
      commands::meta::backup_now,
      commands::meta::create_category,
      commands::meta::rename_category,
      commands::meta::delete_category,
      commands::meta::reorder_categories,
      commands::meta::create_tag,
      commands::meta::delete_tag,
      commands::meta::set_shortcut,
      commands::ai::set_ai_key,
      commands::ai::clear_ai_key,
      commands::ai::ai_test,
      commands::ai::ai_enrich,
      commands::tasks::mark_notifications_seen
    ])
    .setup(|app| {
      let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
      std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
      let conn = crate::db::open(&data_dir.join("ordo.db")).map_err(|e| e.to_string())?;
      use tauri_plugin_autostart::ManagerExt;
      let autostart = crate::repo::settings::get(&conn, "autostart")
          .ok()
          .flatten()
          .unwrap_or_else(|| "true".into())
          == "true";
      let _ = if autostart {
          app.autolaunch().enable()
      } else {
          app.autolaunch().disable()
      };
      let _ = crate::services::export::backup_today(&conn, &data_dir.join("backups"));
      let shortcut_setting = crate::repo::settings::get(&conn, "shortcut")
          .ok()
          .flatten()
          .unwrap_or_else(|| "Ctrl+Alt+O".into());
      app.manage(crate::state::AppState::new(conn));

      let _capture = tauri::WebviewWindowBuilder::new(
          app,
          "capture",
          tauri::WebviewUrl::App("index.html".into()),
        )
        .title("ordo")
        .inner_size(560.0, 96.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()?;

      if let Ok(shortcut) = shortcut_setting.parse() {
          let _ = register_shortcut(app.handle(), shortcut);
      }

      build_tray(app)?;
      crate::reminders::start(app.handle().clone());

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