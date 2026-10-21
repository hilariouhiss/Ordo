use crate::dto::{BootstrapDto, CategoryDto, SettingsDto, SettingsPatch, TagDto};
use crate::state::{with_db, AppState};
use rusqlite::Connection;
use tauri::{Manager, State};

pub fn build_bootstrap(conn: &Connection) -> Result<BootstrapDto, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let last = crate::repo::settings::get(conn, "last_pass_week")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let queue = crate::services::week::pass_queue(conn)?;
    let pass_needed = last != crate::services::week::week_start(&today) && !queue.is_empty();
    Ok(BootstrapDto {
        people: crate::repo::people::list(conn).map_err(|e| e.to_string())?,
        categories: crate::repo::categories::list(conn).map_err(|e| e.to_string())?,
        tags: crate::repo::tags::list(conn).map_err(|e| e.to_string())?,
        settings: {
            let mut s = crate::repo::settings::dto(conn).map_err(|e| e.to_string())?;
            s.ai_has_key = crate::ai::client::get_key().is_some();
            s
        },
        projects: crate::services::stats::list(conn)?,
        week: queue,
        suspended: crate::services::week::list_suspended(conn)?,
        pass_needed,
        week_stats: crate::services::week::stats(conn, &today)?,
    })
}

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> Result<BootstrapDto, String> {
    crate::state::with_db(&state, |conn| build_bootstrap(conn)).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn pass_needed_follows_last_pass_week() {
        let c = crate::db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", "2026-10-20T08:00:00Z", "t1").unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let week = crate::services::week::week_start(&today);

        crate::repo::settings::set(&c, "last_pass_week", &week).unwrap();
        assert!(!crate::commands::meta::build_bootstrap(&c).unwrap().pass_needed);

        crate::repo::settings::set(&c, "last_pass_week", "2000-01-01").unwrap();
        assert!(crate::commands::meta::build_bootstrap(&c).unwrap().pass_needed);
    }

    #[test]
    fn settings_roundtrip() {
        let c = crate::db::open_in_memory().unwrap();
        crate::repo::settings::set(&c, "shortcut", "Ctrl+Alt+P").unwrap();
        let s = crate::repo::settings::dto(&c).unwrap();
        assert_eq!(s.shortcut, "Ctrl+Alt+P");
    }

    #[test]
    fn theme_defaults_to_system_and_round_trips() {
        let c = crate::db::open_in_memory().unwrap();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().theme, "system");
        crate::repo::settings::set(&c, "theme", "dark").unwrap();
        assert_eq!(crate::repo::settings::dto(&c).unwrap().theme, "dark");
    }

    #[test]
    fn bootstrap_returns_seed() {
        let c = crate::db::open_in_memory().unwrap();
        let b = crate::commands::meta::build_bootstrap(&c).unwrap();
        assert_eq!(b.people.len(), 1);
        assert!(b.people[0].is_me);
        assert_eq!(b.categories.len(), 8);
        assert_eq!(b.settings.shortcut, "Ctrl+Alt+O");
    }
}
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn settings_with_key(conn: &rusqlite::Connection) -> Result<SettingsDto, String> {
    let mut settings = crate::repo::settings::dto(conn).map_err(|e| e.to_string())?;
    settings.ai_has_key = crate::ai::client::get_key().is_some();
    Ok(settings)
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<SettingsDto, String> {
    with_db(&state, |conn| settings_with_key(conn)).await
}

#[tauri::command]
pub async fn set_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<SettingsDto, String> {
    use tauri_plugin_autostart::ManagerExt;
    if let Some(autostart) = patch.autostart {
        let _ = if autostart {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
    }
    with_db(&state, move |conn| {
        let sets: Vec<(&str, Option<String>)> = vec![
            ("ai.enabled", patch.ai_enabled.map(|v| v.to_string())),
            ("ai.base_url", patch.ai_base_url),
            ("ai.model", patch.ai_model),
            ("shortcut", patch.shortcut),
            ("autostart", patch.autostart.map(|v| v.to_string())),
            ("week_start", patch.week_start.map(|v| v.to_string())),
            ("backup_keep_days", patch.backup_keep_days.map(|v| v.to_string())),
            ("theme", patch.theme),
        ];
        for (key, value) in sets {
            if let Some(value) = value {
                crate::repo::settings::set(conn, key, &value).map_err(|e| e.to_string())?;
            }
        }
        settings_with_key(conn)
    })
    .await
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
        let keep_days = crate::repo::settings::get(conn, "backup_keep_days")
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let result = match crate::services::export::backup_today(conn, &dir)? {
            Some(path) => path.to_string_lossy().to_string(),
            None => dir
                .join(format!("ordo-{}.db", today))
                .to_string_lossy()
                .to_string(),
        };
        let _ = crate::services::export::prune(&dir, keep_days, &today);
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn create_category(
    state: State<'_, AppState>,
    name: String,
) -> Result<CategoryDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        let sort = crate::repo::categories::next_sort(conn).map_err(|e| e.to_string())?;
        crate::repo::categories::create(
            conn,
            &uuid::Uuid::new_v4().to_string(),
            name.trim(),
            sort,
            &now,
        )
        .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn rename_category(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::categories::rename(conn, &id, name.trim(), &now).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn delete_category(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::categories::soft_delete_and_detach(conn, &id, &now).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn reorder_categories(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<CategoryDto>, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::categories::reorder(conn, &ids, &now).map_err(|e| e.to_string())?;
        crate::repo::categories::list(conn).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn create_tag(state: State<'_, AppState>, name: String) -> Result<TagDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::tags::find_or_create(
            conn,
            &uuid::Uuid::new_v4().to_string(),
            name.trim(),
            &now,
        )
        .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::tags::soft_delete(conn, &id, &now).map_err(|e| e.to_string())
    })
    .await
}
#[tauri::command]
pub async fn set_shortcut(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    next: String,
) -> Result<crate::services::shortcut::ShortcutOutcome, String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let current = crate::state::with_db(&state, |conn| {
        crate::repo::settings::get(conn, "shortcut")
            .map_err(|e| e.to_string())
            .map(|v| v.unwrap_or_else(|| "Ctrl+Alt+O".into()))
    })
    .await?;

    if let Ok(old) = current.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old);
    }

    let app_for_register = app.clone();
    let outcome = crate::services::shortcut::apply(&current, &next, |candidate| {
        let parsed = candidate.parse::<Shortcut>().map_err(|e| e.to_string())?;
        crate::register_shortcut(&app_for_register, parsed)
    });

    if outcome.warning.is_some() {
        if let Ok(old) = current.parse::<Shortcut>() {
            let _ = crate::register_shortcut(&app, old);
        }
    } else {
        let active = outcome.active.clone();
        crate::state::with_db(&state, move |conn| {
            crate::repo::settings::set(conn, "shortcut", &active).map_err(|e| e.to_string())
        })
        .await?;
    }
    Ok(outcome)
}