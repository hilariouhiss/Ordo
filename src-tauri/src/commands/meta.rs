use crate::dto::{BootstrapDto, SettingsDto, SettingsPatch};
use crate::state::{with_db, AppState};
use rusqlite::Connection;
use tauri::{Manager, State};

pub fn build_bootstrap(conn: &Connection) -> Result<BootstrapDto, String> {
    Ok(BootstrapDto {
        people: crate::repo::people::list(conn).map_err(|e| e.to_string())?,
        categories: crate::repo::categories::list(conn).map_err(|e| e.to_string())?,
        tags: crate::repo::tags::list(conn).map_err(|e| e.to_string())?,
        settings: crate::repo::settings::dto(conn).map_err(|e| e.to_string())?,
        projects: crate::services::stats::list(conn)?,
    })
}

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> Result<BootstrapDto, String> {
    crate::state::with_db(&state, |conn| build_bootstrap(conn)).await
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<SettingsDto, String> {
    with_db(&state, |conn| {
        crate::repo::settings::dto(conn).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn set_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<SettingsDto, String> {
    use tauri_plugin_autostart::ManagerExt;
    if let Some(language) = patch.language.as_deref() {
        if !crate::repo::settings::valid_language(language) {
            return Err("invalid_language".into());
        }
    }
    if let Some(pin) = patch.desk_pin.as_deref() {
        if !crate::repo::settings::valid_desk_pin(pin) {
            return Err("invalid_desk_pin".into());
        }
    }
    if let Some(group_by) = patch.tasks_group_by.as_deref() {
        if !crate::repo::settings::valid_task_group_by(group_by) {
            return Err("invalid_task_group_by".into());
        }
    }
    if let Some(url) = patch.ai_base_url.as_deref() {
        if !crate::repo::settings::valid_ai_base_url(url) {
            return Err("invalid_ai_base_url".into());
        }
    }
    if let Some(autostart) = patch.autostart {
        let _ = if autostart {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
    }
    let language_requested = patch.language.is_some();
    let desk_requested = patch.desk_enabled.is_some();
    let settings = with_db(&state, move |conn| {
        let sets: Vec<(&str, Option<String>)> = vec![
            ("language", patch.language),
            ("ai.enabled", patch.ai_enabled.map(|v| v.to_string())),
            ("ai.base_url", patch.ai_base_url.map(|v| v.trim().to_string())),
            ("ai.model", patch.ai_model),
            ("autostart", patch.autostart.map(|v| v.to_string())),
            ("backup_keep_days", patch.backup_keep_days.map(|v| v.to_string())),
            ("theme", patch.theme),
            ("desk.enabled", patch.desk_enabled.map(|v| v.to_string())),
            ("desk.controls", patch.desk_controls.map(|v| v.to_string())),
            ("desk.pin", patch.desk_pin),
            ("desk.x", patch.desk_x.map(|v| v.to_string())),
            ("desk.y", patch.desk_y.map(|v| v.to_string())),
            ("tasks.group_by", patch.tasks_group_by),
        ];
        for (key, value) in sets {
            if let Some(value) = value {
                crate::repo::settings::set(conn, key, &value).map_err(|e| e.to_string())?;
            }
        }
        crate::repo::settings::dto(conn).map_err(|e| e.to_string())
    })
    .await?;
    if language_requested || desk_requested {
        let lang = if settings.language == "en" {
            crate::i18n::Lang::En
        } else {
            crate::i18n::Lang::Zh
        };
        crate::refresh_tray(&app, lang, settings.desk_enabled);
    }
    Ok(settings)
}

#[tauri::command]
pub async fn export_json(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("exports");
    let file = dir.join(format!(
        "ordo-export-{}.json",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));
    with_db(&state, move |conn| {
        crate::services::export::to_json(conn, &file)?;
        Ok(file.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
pub async fn backup_now(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    with_db(&state, move |conn| {
        let result = crate::services::export::backup_snapshot(conn, &dir);
        crate::services::export::record_error(conn, result.as_ref().err().cloned());
        result.map(|path| path.to_string_lossy().to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn settings_roundtrip() {
        let c = crate::db::open_in_memory().unwrap();
        crate::repo::settings::set(&c, "shortcut", "Ctrl+Alt+P").unwrap();
        crate::repo::settings::set(&c, "desk.shortcut", "Ctrl+Alt+D").unwrap();
        crate::repo::settings::set(&c, "main.shortcut", "Ctrl+Alt+N").unwrap();
        crate::repo::settings::set(&c, "main.shortcut_warning", "taken").unwrap();
        crate::repo::settings::set(&c, "backup_error", "disk full").unwrap();
        let s = crate::repo::settings::dto(&c).unwrap();
        assert_eq!(s.shortcut, "Ctrl+Alt+P");
        assert_eq!(s.desk_shortcut, "Ctrl+Alt+D");
        assert_eq!(s.main_shortcut, "Ctrl+Alt+N");
        assert_eq!(s.main_shortcut_warning.as_deref(), Some("taken"));
        assert_eq!(s.backup_error.as_deref(), Some("disk full"));

        crate::repo::settings::set(&c, "backup_error", "").unwrap();
        assert!(crate::repo::settings::dto(&c).unwrap().backup_error.is_none());
    }

    #[test]
    fn theme_defaults_to_system_and_round_trips() {
        let c = crate::db::open_in_memory().unwrap();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().theme, "system");
        crate::repo::settings::set(&c, "theme", "dark").unwrap();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().theme, "dark");
    }

    #[test]
    fn language_falls_back_to_the_system_and_round_trips() {
        let c = crate::db::open_in_memory().unwrap();
        let system = crate::i18n::system_language();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().language, system);
        crate::repo::settings::set(&c, "language", "en").unwrap();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().language, "en");
        crate::repo::settings::set(&c, "language", "zh").unwrap();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().language, "zh");
        crate::repo::settings::set(&c, "language", "fr").unwrap();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().language, system);
        assert!(crate::repo::settings::valid_language("en"));
        assert!(crate::repo::settings::valid_language("zh"));
        assert!(!crate::repo::settings::valid_language("fr"));
    }

    #[test]
    fn bootstrap_returns_seed() {
        let c = crate::db::open_in_memory().unwrap();
        assert!(crate::repo::settings::get(&c, "language").unwrap().is_none());
        let b = super::build_bootstrap(&c).unwrap();
        assert_eq!(b.people.len(), 1);
        assert!(b.people[0].is_me);
        assert_eq!(b.categories.len(), 7);
        assert_eq!(b.settings.language, crate::i18n::system_language());
        assert_eq!(b.settings.shortcut, "Ctrl+Alt+O");
        assert_eq!(b.settings.desk_shortcut, "Ctrl+Alt+W");
        assert_eq!(b.settings.main_shortcut, "Ctrl+Alt+M");
    }

    #[test]
    fn desk_settings_default_and_roundtrip() {
        let c = crate::db::open_in_memory().unwrap();
        let s = crate::repo::settings::dto(&c).unwrap();
        assert!(!s.desk_enabled);
        assert!(s.desk_controls);
        assert_eq!(s.desk_pin, "top");
        assert!(s.desk_x.is_none());
        assert!(s.desk_y.is_none());

        crate::repo::settings::set(&c, "desk.enabled", "true").unwrap();
        crate::repo::settings::set(&c, "desk.controls", "false").unwrap();
        crate::repo::settings::set(&c, "desk.pin", "bottom").unwrap();
        crate::repo::settings::set(&c, "desk.x", "-1200").unwrap();
        crate::repo::settings::set(&c, "desk.y", "40").unwrap();
        let s = crate::repo::settings::dto(&c).unwrap();
        assert!(s.desk_enabled);
        assert!(!s.desk_controls);
        assert_eq!(s.desk_pin, "bottom");
        assert_eq!(s.desk_x, Some(-1200));
        assert_eq!(s.desk_y, Some(40));

        crate::repo::settings::set(&c, "desk.pin", "sideways").unwrap();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().desk_pin, "top");
    }
}
