use crate::dto::{BootstrapDto, SettingsDto, SettingsPatch};
use crate::state::{with_db, AppState};
use rusqlite::Connection;
use tauri::{Emitter, Manager, State};

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

/// Writes every field in one transaction, so a failed write cannot half-save a form.
fn save_settings(
    conn: &Connection,
    patch: SettingsPatch,
    saved_views: Option<String>,
) -> Result<SettingsDto, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    use crate::repo::settings::keys;
    let sets: Vec<(&str, Option<String>)> = vec![
        (keys::LANGUAGE, patch.language),
        (keys::AI_ENABLED, patch.ai_enabled.map(|v| v.to_string())),
        (
            keys::AI_BASE_URL,
            patch.ai_base_url.map(|v| v.trim().to_string()),
        ),
        (keys::AI_MODEL, patch.ai_model),
        (keys::AUTOSTART, patch.autostart.map(|v| v.to_string())),
        (
            keys::BACKUP_KEEP_DAYS,
            patch.backup_keep_days.map(|v| v.to_string()),
        ),
        (keys::THEME, patch.theme),
        (
            keys::DESK_ENABLED,
            patch.desk_enabled.map(|v| v.to_string()),
        ),
        (
            keys::DESK_CONTROLS,
            patch.desk_controls.map(|v| v.to_string()),
        ),
        (keys::DESK_PIN, patch.desk_pin),
        (keys::DESK_X, patch.desk_x.map(|v| v.to_string())),
        (keys::DESK_Y, patch.desk_y.map(|v| v.to_string())),
        (keys::TASKS_GROUP_BY, patch.tasks_group_by),
        (
            keys::WEEK_SHOW_EMPTY_DAYS,
            patch.week_show_empty_days.map(|v| v.to_string()),
        ),
        (keys::WEEK_HIDE_DONE, patch.week_hide_done.map(|v| v.to_string())),
        (keys::WEEK_VIEW, patch.week_view),
        (keys::SAVED_VIEWS, saved_views),
        (
            keys::REMINDER_LEAD_MINUTES,
            patch.reminders_lead_minutes.map(|v| v.to_string()),
        ),
        (
            keys::REMINDERS_DIGEST,
            patch.reminders_digest.map(|v| v.to_string()),
        ),
        (keys::MODE_AUTO, patch.mode_auto.map(|v| v.to_string())),
        (keys::MODE_WORK_AT, patch.mode_work_at),
        (keys::MODE_PERSONAL_AT, patch.mode_personal_at),
        (
            keys::MODE_DAYS,
            patch
                .mode_days
                .map(|days| crate::repo::settings::format_mode_days(&days)),
        ),
    ];
    for (key, value) in sets {
        if let Some(value) = value {
            crate::repo::settings::set(&tx, key, &value).map_err(|e| e.to_string())?;
        }
    }
    let settings = crate::repo::settings::dto(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(settings)
}

/// The schedule is stored canonical: "9:00" becomes "09:00", days are sorted and
/// deduplicated, and two identical points are refused.
fn normalize_mode_fields(patch: &mut SettingsPatch) -> Result<(), String> {
    if let Some(time) = patch.mode_work_at.take() {
        patch.mode_work_at = Some(
            crate::repo::settings::normalize_mode_time(&time)
                .ok_or_else(|| "invalid_time".to_string())?,
        );
    }
    if let Some(time) = patch.mode_personal_at.take() {
        patch.mode_personal_at = Some(
            crate::repo::settings::normalize_mode_time(&time)
                .ok_or_else(|| "invalid_time".to_string())?,
        );
    }
    if let Some(days) = patch.mode_days.as_mut() {
        days.retain(|day| (1..=7).contains(day));
        days.sort_unstable();
        days.dedup();
        if days.is_empty() {
            return Err("invalid_mode_days".into());
        }
    }
    if let (Some(work), Some(personal)) = (&patch.mode_work_at, &patch.mode_personal_at) {
        if work == personal {
            return Err("same_mode_time".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn set_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mut patch: SettingsPatch,
) -> Result<SettingsDto, String> {
    use tauri_plugin_autostart::ManagerExt;
    normalize_mode_fields(&mut patch)?;
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
    if let Some(view) = patch.week_view.as_deref() {
        if !crate::repo::settings::valid_week_view(view) {
            return Err("invalid_week_view".into());
        }
    }
    if let Some(url) = patch.ai_base_url.as_deref() {
        if !crate::repo::settings::valid_ai_base_url(url) {
            return Err("invalid_ai_base_url".into());
        }
    }
    if let Some(views) = patch.saved_task_views.as_deref() {
        if !crate::repo::settings::valid_saved_views(views) {
            return Err("invalid_saved_views".into());
        }
    }
    if let Some(lead) = patch.reminders_lead_minutes {
        if !(0..=crate::limits::LIMITS.reminder_lead_minutes).contains(&lead) {
            return Err("invalid_reminder_lead".into());
        }
    }
    // Only after every field passed validation: the OS change cannot be undone by the
    // rejected DB write. Store the flag only once Windows accepted it too.
    if let Some(autostart) = patch.autostart {
        let result = if autostart {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        result.map_err(|e| {
            eprintln!("自动启动设置失败：{e}");
            format!("autostart_failed: {e}")
        })?;
    }
    let language_requested = patch.language.is_some();
    let desk_requested = patch.desk_enabled.is_some();
    // Names are trimmed before they are stored, so the chip rows stay tidy.
    let saved_views = patch
        .saved_task_views
        .as_ref()
        .map(|views| {
            let trimmed: Vec<crate::dto::SavedTaskViewDto> = views
                .iter()
                .map(|view| crate::dto::SavedTaskViewDto {
                    name: view.name.trim().to_string(),
                    ..view.clone()
                })
                .collect();
            serde_json::to_string(&trimmed).map_err(|e| e.to_string())
        })
        .transpose()?;
    let settings = with_db(&state, move |conn| save_settings(conn, patch, saved_views)).await?;
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

/// A manual switch outranks the schedule until another point arrives; every window
/// hears about it so the palette and lists change together.
#[tauri::command]
pub async fn set_mode(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mode: String,
) -> Result<SettingsDto, String> {
    if !crate::repo::settings::valid_mode(&mode) {
        return Err("invalid_mode".into());
    }
    let now = crate::now_iso();
    let event_mode = mode.clone();
    let settings = with_db(&state, move |conn| {
        crate::services::mode::set_manual(conn, &mode, &now).map_err(|e| e.to_string())?;
        crate::repo::settings::dto(conn).map_err(|e| e.to_string())
    })
    .await?;
    let _ = app.emit("mode:changed", event_mode);
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
    use crate::dto::SettingsPatch;

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
    fn mode_settings_are_normalized_and_stored() {
        let c = crate::db::open_in_memory().unwrap();
        let mut patch = SettingsPatch {
            mode_auto: Some(true),
            mode_work_at: Some("9:05".into()),
            mode_personal_at: Some("18:30".into()),
            mode_days: Some(vec![7, 6, 6]),
            ..Default::default()
        };
        super::normalize_mode_fields(&mut patch).unwrap();
        assert_eq!(patch.mode_work_at.as_deref(), Some("09:05"));
        assert_eq!(patch.mode_days, Some(vec![6, 7]));

        let saved = super::save_settings(&c, patch, None).unwrap();
        assert!(saved.mode_auto);
        assert_eq!(saved.mode_work_at, "09:05");
        assert_eq!(saved.mode_personal_at, "18:30");
        assert_eq!(saved.mode_days, vec![6, 7]);
    }

    #[test]
    fn a_bad_mode_schedule_is_refused_before_it_is_saved() {
        let mut empty = SettingsPatch {
            mode_days: Some(vec![]),
            ..Default::default()
        };
        assert_eq!(
            super::normalize_mode_fields(&mut empty).unwrap_err(),
            "invalid_mode_days"
        );

        let mut same = SettingsPatch {
            mode_work_at: Some("09:00".into()),
            mode_personal_at: Some("9:00".into()),
            ..Default::default()
        };
        assert_eq!(
            super::normalize_mode_fields(&mut same).unwrap_err(),
            "same_mode_time"
        );

        let mut broken = SettingsPatch {
            mode_work_at: Some("25:00".into()),
            ..Default::default()
        };
        assert_eq!(
            super::normalize_mode_fields(&mut broken).unwrap_err(),
            "invalid_time"
        );
    }

    #[test]
    fn a_failed_settings_write_rolls_back_every_field() {
        let c = crate::db::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TRIGGER fail_theme BEFORE INSERT ON settings
             WHEN NEW.key = 'theme' BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .unwrap();
        let patch = crate::dto::SettingsPatch {
            language: Some("en".into()),
            theme: Some("dark".into()),
            ..Default::default()
        };

        assert!(super::save_settings(&c, patch, None).is_err());
        assert!(
            crate::repo::settings::get(&c, "language").unwrap().is_none(),
            "the first field must roll back with the rejected one"
        );
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
