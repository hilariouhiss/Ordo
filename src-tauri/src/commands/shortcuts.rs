use crate::services::shortcut::{ShortcutOutcome, ShortcutTarget};
use crate::state::{with_db, AppState};
use tauri::State;

/// Swaps one of the shortcuts, rolling back to the old key when the new one is refused.
async fn set_shortcut_for(
    app: &tauri::AppHandle,
    state: &AppState,
    target: ShortcutTarget,
    next: String,
) -> Result<ShortcutOutcome, String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let key = target.settings_key();
    let current = with_db(state, move |conn| {
        crate::repo::settings::get(conn, key)
            .map_err(|e| e.to_string())
            .map(|v| v.unwrap_or_else(|| target.default_value().into()))
    })
    .await?;

    if let Ok(old) = current.parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(old);
    }

    let register_app = app.clone();
    let register = move |candidate: &str| -> Result<(), String> {
        let parsed = candidate.parse::<Shortcut>().map_err(|e| e.to_string())?;
        crate::register_shortcut(&register_app, parsed, target)
    };
    let outcome = crate::services::shortcut::apply(&current, &next, register.clone(), register);

    if outcome.warning.is_none() {
        let active = outcome.active.clone();
        let warning_key = target.warning_key();
        with_db(state, move |conn| {
            crate::repo::settings::set(conn, key, &active).map_err(|e| e.to_string())?;
            crate::repo::settings::set(conn, warning_key, "").map_err(|e| e.to_string())
        })
        .await?;
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn set_shortcut(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    next: String,
) -> Result<ShortcutOutcome, String> {
    set_shortcut_for(&app, &state, ShortcutTarget::Capture, next).await
}

#[tauri::command]
pub async fn set_desk_shortcut(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    next: String,
) -> Result<ShortcutOutcome, String> {
    set_shortcut_for(&app, &state, ShortcutTarget::Desk, next).await
}

#[tauri::command]
pub async fn set_main_shortcut(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    next: String,
) -> Result<ShortcutOutcome, String> {
    set_shortcut_for(&app, &state, ShortcutTarget::Main, next).await
}
