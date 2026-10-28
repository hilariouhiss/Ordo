use crate::services::shortcut::ShortcutTarget;
use tauri::Emitter;
use tauri::Manager;

pub mod ai;
pub mod commands;
pub mod db;
pub mod dto;
pub mod i18n;
pub mod repo;
pub mod reminders;
pub mod services;
pub mod state;

/// The bundle identifier before the macOS-safe rename; old installs keep their ledger there.
const LEGACY_IDENTIFIER: &str = "com.ordo.app";

/// Every command writes timestamps in this one shape: RFC3339 UTC, second precision.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn toggle_capture(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("capture") else {
        // Building a window inside the shortcut callback is not worth the risk; the next
        // event-loop turn creates it and it reveals itself once its page is loaded.
        create_capture_soon(app, true);
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to("capture", "capture:focus", ());
    }
}

/// Builds the mini window off the startup path. A failure leaves the shortcut inert
/// instead of taking the whole app down.
fn ensure_capture(app: &tauri::AppHandle, reveal_when_loaded: bool) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window("capture") {
        return Some(window);
    }
    let mut builder = tauri::WebviewWindowBuilder::new(
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
    .visible(false);
    if reveal_when_loaded {
        builder = builder.on_page_load(|window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = window.show();
                let _ = window.set_focus();
            }
        });
    }
    match builder.build() {
        Ok(window) => Some(window),
        Err(e) => {
            eprintln!("捕获窗口创建失败：{e}");
            None
        }
    }
}

fn create_capture_soon(app: &tauri::AppHandle, reveal_when_loaded: bool) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let _ = ensure_capture(&inner, reveal_when_loaded);
        });
    });
}

/// Shows and focuses the widget, then asks the page to raise it; the page owns
/// the raise, the expand and the focus-loss restore.
fn summon_widget(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // The widget shortcut has no meaning while the app shows the main window.
    if !widget_mode(app) {
        return;
    }
    // The ledger can lag a failed form switch; a resizable window is the main shape.
    if window.is_resizable().unwrap_or(true) {
        return;
    }
    let hidden = !window.is_visible().unwrap_or(true) || window.is_minimized().unwrap_or(false);
    // The page raises the window after it handles the summon; if this event were
    // missed, leaving it topmost here would strand it above every other window.
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to("main", "widget:summon", hidden);
}

pub fn register_shortcut(
    app: &tauri::AppHandle,
    shortcut: tauri_plugin_global_shortcut::Shortcut,
    target: ShortcutTarget,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                match target {
                    ShortcutTarget::Capture => toggle_capture(app),
                    ShortcutTarget::Desk => summon_widget(app),
                    ShortcutTarget::Main => show_main(app),
                }
            }
        })
        .map_err(|e| e.to_string())
}

/// Whether the main window currently runs as the week widget. The tray and
/// startup read it from the ledger; the front end owns changing it.
fn widget_mode(app: &tauri::AppHandle) -> bool {
    app.state::<crate::state::AppState>()
        .db
        .lock()
        .map(|conn| crate::repo::settings::desk_enabled(&conn))
        .unwrap_or(false)
}

fn show_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        // The page may be the widget; ask it to morph back before navigating.
        let _ = app.emit_to("main", "window:open", ());
    }
}

/// Tells the user, once, that closing the window only hides it.
fn first_close_hint(app: &tauri::AppHandle) {
    let state = app.state::<crate::state::AppState>();
    let (seen, lang) = match state.db.lock() {
        Ok(conn) => (
            crate::repo::settings::get(&conn, "tray_hint_seen")
                .ok()
                .flatten()
                .is_some(),
            crate::i18n::from_conn(&conn),
        ),
        Err(_) => (false, crate::i18n::Lang::Zh),
    };
    if seen {
        return;
    }
    let (title, body) = crate::i18n::tray_hint(lang);
    use tauri_plugin_notification::NotificationExt;
    let shown = app.notification().builder().title(title).body(body).show();
    // Mark it seen only after the toast went out; a suppressed one would otherwise
    // cost the user the only explanation of where the window went.
    if shown.is_ok() {
        if let Ok(conn) = state.db.lock() {
            let _ = crate::repo::settings::set(&conn, "tray_hint_seen", "true");
        }
    }
}

fn tray_menu(
    app: &tauri::AppHandle,
    lang: crate::i18n::Lang,
    desk_enabled: bool,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem};
    let labels = crate::i18n::tray_labels(lang);
    let open = MenuItem::with_id(app, "open", labels[0], true, None::<&str>)?;
    let week = MenuItem::with_id(app, "week", labels[1], true, None::<&str>)?;
    let pass = MenuItem::with_id(app, "pass", labels[2], true, None::<&str>)?;
    let desk = CheckMenuItem::with_id(
        app,
        "desk",
        labels[3],
        true,
        desk_enabled,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", labels[4], true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", labels[5], true, None::<&str>)?;
    Menu::with_items(app, &[&open, &week, &pass, &desk, &settings, &quit])
}

fn build_tray(
    app: &tauri::App,
    lang: crate::i18n::Lang,
    desk_enabled: bool,
) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let menu = tray_menu(app.handle(), lang, desk_enabled)?;

    // Same artwork as the taskbar icon, so the two never drift.
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "week" => {
                show_main(app);
                let _ = app.emit_to("main", "nav:week", ());
            }
            "pass" => {
                show_main(app);
                let _ = app.emit_to("main", "nav:pass", ());
            }
            "desk" => {
                let _ = app.emit_to("main", "widget:set", !widget_mode(app));
            }
            "settings" => {
                show_main(app);
                let _ = app.emit_to("main", "open:settings", ());
            }
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

/// Rebuilds the tray menu after a language or widget-state change; a failure
/// keeps the old menu.
pub(crate) fn refresh_tray(
    app: &tauri::AppHandle,
    lang: crate::i18n::Lang,
    desk_enabled: bool,
) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    match tray_menu(app, lang, desk_enabled) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => eprintln!("托盘菜单重建失败：{e}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let result = tauri::Builder::default()
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
          first_close_hint(window.app_handle());
        } else if window.label() == "capture" {
          // The mini window is prebuilt; closing it would leave the shortcut with
          // nothing to show until the next launch.
          api.prevent_close();
          let _ = window.hide();
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      commands::meta::bootstrap,
      commands::tasks::capture,
      commands::tasks::list_week,
      commands::tasks::list_all_tasks,
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
      commands::tasks::start_task,
      commands::tasks::suspend_task,
      commands::tasks::set_due,
      commands::tasks::add_delay_note,
      commands::tasks::list_project_tasks,
      commands::projects::list_projects,
      commands::projects::get_project_summary,
      commands::projects::get_project,
      commands::projects::create_project,
      commands::projects::update_project,
      commands::projects::set_project_group,
      commands::projects::archive_project,
      commands::projects::restore_project,
      commands::projects::delete_project,
      commands::projects::list_project_groups,
      commands::projects::create_project_group,
      commands::projects::rename_project_group,
      commands::projects::delete_project_group,
      commands::projects::add_member,
      commands::projects::remove_member,
      commands::projects::set_member_category,
      commands::projects::owner_candidates,
      commands::projects::list_people,
      commands::projects::create_person,
      commands::projects::rename_person,
      commands::projects::delete_person,
      commands::archive::list_archive,
      commands::archive::archive_task,
      commands::archive::restore_task,
      commands::archive::delete_task,
      commands::meta::get_settings,
      commands::meta::set_window_rect,
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
      commands::meta::set_desk_shortcut,
      commands::meta::set_main_shortcut,
      commands::meta::desk_left_button_down,
      commands::ai::set_ai_key,
      commands::ai::clear_ai_key,
      commands::ai::ai_key_status,
      commands::ai::ai_test,
      commands::ai::ai_enrich,
      commands::tasks::mark_notifications_seen,
      commands::tasks::set_status,
      commands::tasks::move_task
    ])
    .setup(|app| {
      let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
      let legacy_dir = data_dir.with_file_name(LEGACY_IDENTIFIER);
      match crate::db::migrate_legacy_data(&legacy_dir, &data_dir) {
          Ok(true) => eprintln!(
              "旧数据已从 {} 迁到 {}（旧目录保留）",
              legacy_dir.display(),
              data_dir.display()
          ),
          Ok(false) => {}
          Err(e) => {
              let (title, message) = crate::i18n::legacy_migration_failed(
                  crate::i18n::system_lang(),
                  &e.to_string(),
                  &legacy_dir.display().to_string(),
              );
              // stderr is invisible in a windows_subsystem release build, so leave a file.
              eprintln!("{message}");
              let _ = std::fs::create_dir_all(&data_dir);
              let _ = std::fs::write(data_dir.join("startup-error.txt"), &message);
              use tauri_plugin_notification::NotificationExt;
              let _ = app.notification().builder().title(title).body(&message).show();
              return Err(message.into());
          }
      }
      std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
      let backups = data_dir.join("backups");
      let (conn, recovery) =
          match crate::db::open_with_recovery(&data_dir.join("ordo.db"), &backups) {
              Ok(found) => found,
              Err(e) => {
                  let (title, message) = crate::i18n::database_open_failed(
                      crate::i18n::system_lang(),
                      &e,
                      &data_dir.display().to_string(),
                  );
                  // stderr is invisible in a windows_subsystem release build, so leave a file.
                  eprintln!("{message}");
                  let _ = std::fs::write(data_dir.join("startup-error.txt"), &message);
                  use tauri_plugin_notification::NotificationExt;
                  let _ = app.notification().builder().title(title).body(&message).show();
                  return Err(message.into());
              }
          };
      if let Some(recovery) = recovery {
          use tauri_plugin_notification::NotificationExt;
          let lang = crate::i18n::from_conn(&conn);
          let (title, body) = crate::i18n::recovery_notice(
              lang,
              &recovery.restored_from.display().to_string(),
              &recovery.broken_file_kept_at.display().to_string(),
          );
          let _ = app.notification().builder().title(title).body(body).show();
      }
      use tauri_plugin_autostart::ManagerExt;
      let autostart = crate::repo::settings::get(&conn, "autostart")
          .ok()
          .flatten()
          .unwrap_or_else(|| "true".into())
          == "true";
      // Writing the Run key on every launch is wasted startup work.
      if app.autolaunch().is_enabled().unwrap_or(false) != autostart {
          let _ = if autostart {
              app.autolaunch().enable()
          } else {
              app.autolaunch().disable()
          };
      }
      for target in ShortcutTarget::ALL {
          let saved = crate::repo::settings::get(&conn, target.settings_key())
              .ok()
              .flatten()
              .unwrap_or_else(|| target.default_value().into());
          let Ok(shortcut) = saved.parse::<tauri_plugin_global_shortcut::Shortcut>() else {
              continue;
          };
          let warning = match register_shortcut(app.handle(), shortcut, target) {
              Ok(()) => String::new(),
              Err(e) => e,
          };
          let _ = crate::repo::settings::set(&conn, target.warning_key(), &warning);
      }

      let lang = crate::i18n::from_conn(&conn);
      let desk_enabled = crate::repo::settings::desk_enabled(&conn);
      app.manage(crate::state::AppState::new(conn));

      use tauri_plugin_notification::NotificationExt;
      let notification_handle = app.handle().clone();
      let _ = app
          .notification()
          .on_action(move |action| {
              if action.action_id() == "tap" {
                  let state = notification_handle.state::<crate::state::AppState>();
                  let task_id = action
                      .notification()
                      .map(|n| n.id())
                      .and_then(|id| state.reminder_targets.task_for(id));
                  if let Some(task_id) = task_id {
                      let _ = notification_handle.emit_to("main", "reminder:open", task_id);
                  }
                  show_main(&notification_handle);
              }
          });

      build_tray(app, lang, desk_enabled)?;
      crate::reminders::start(app.handle().clone());

      // The main window is created hidden and shows itself after its first paint; the
      // capture window is built a moment later so startup never waits for a second
      // webview. This thread also reveals the main window if the front end never does.
      let deferred = app.handle().clone();
      std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_secs(2));
          let handle = deferred.clone();
          let _ = deferred.run_on_main_thread(move || {
              let _ = ensure_capture(&handle, false);
              if let Some(window) = handle.get_webview_window("main") {
                  if !window.is_visible().unwrap_or(true) {
                      let _ = window.show();
                      let _ = window.set_focus();
                  }
              }
          });
      });

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!());
  if let Err(e) = result {
    eprintln!("ordo 启动失败：{e}");
    std::process::exit(1);
  }
}

#[cfg(test)]
mod tests {
    /// The tray decodes the app icon at startup. A missing size or a repainted file would
    /// otherwise only surface as an app that comes up without its tray icon.
    #[test]
    fn tray_icon_decodes() {
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap();
        assert_eq!((icon.width(), icon.height()), (32, 32));
    }
}